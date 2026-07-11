import { normalizeToolApprovalMode, type ToolApprovalMode, type ToolDefinition, type PermissionRule } from '@shared/types';
import { EventEmitter } from 'node:events';
import { getDb, getSetting } from '../db/client';
import { BUILTIN_TOOLS, builtinExecutors } from './builtin';
import { McpManager } from '../mcp/manager';

export interface ToolContext {
  cwd: string;
  conversationId: string;
  mcpServerIds?: ReadonlySet<string>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  meta?: Record<string, unknown>;
}

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
  conversationId?: string;
}

type Decision = 'allow' | 'deny';

export class ToolRegistry extends EventEmitter {
  private executors = new Map<string, ToolExecutor>();
  private pendingRequests = new Map<string, {
    resolve: (d: Decision) => void;
    grantKey?: string;
    explicitAsk: boolean;
  }>();
  private scopedAllow = new Set<string>();

  constructor(private mcpManager: McpManager | null) {
    super();
    for (const [name, exec] of Object.entries(builtinExecutors)) {
      this.executors.set(name, exec);
    }
  }

  listTools(allowedServerIds?: ReadonlySet<string>): ToolDefinition[] {
    const builtin = BUILTIN_TOOLS;
    const mcp = (this.mcpManager?.getAllTools() || []).filter((tool) =>
      !allowedServerIds || allowedServerIds.has(tool.source.slice('mcp:'.length))
    );
    return [...builtin, ...mcp];
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // MCP — models call MCP tools by their raw advertised name, so resolve the
    // owning server up front. It is needed before the permission check, because
    // whether the tool needs approval depends on that server's trust flag.
    const mcp = this.executors.has(name) ? null : (this.mcpManager?.resolveTool(name, ctx.mcpServerIds) ?? null);

    // Check permissions
    const rule = this.matchRule(name, args);
    if (rule?.action === 'deny') {
      return { content: `Denied by permission rule: ${name}`, isError: true };
    }
    const implicitRisk = !rule && (this.requiresApproval(name) || (mcp !== null && !mcp.trusted));
    if (rule?.action === 'ask' || implicitRisk) {
      const allowed = await this.authorize({
        requestId: cryptoRandom(),
        toolName: name,
        args,
        description: mcp?.serverName ? `MCP server: ${mcp.serverName}` : undefined
      }, ctx, rule?.action === 'ask');
      if (!allowed) return { content: `User denied: ${name}`, isError: true };
    }

    // Built-in
    const builtin = this.executors.get(name);
    if (builtin) {
      try { return await builtin(args, ctx); }
      catch (err) { return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true }; }
    }

    if (mcp) {
      try {
        const result = await this.mcpManager!.callTool(mcp.serverId, mcp.toolName, args);
        const content = Array.isArray(result.content)
          ? (result.content as Array<{ type: string; text?: string }>).map((c) => c.text || JSON.stringify(c)).join('\n')
          : String(result.content);
        return {
          content,
          isError: result.isError,
          meta: { source: `mcp:${mcp.serverId}`, serverName: mcp.serverName }
        };
      } catch (err) {
        return { content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    }

    return { content: `Unknown tool: ${name}`, isError: true };
  }

  matchRule(toolName: string, args: Record<string, unknown>): PermissionRule | null {
    const rows = getDb().prepare('SELECT * FROM permissions').all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const rule: PermissionRule = {
        id: row.id as string,
        toolName: row.tool_name as string,
        pattern: row.pattern as string | undefined,
        action: row.action as 'allow' | 'deny' | 'ask',
        scope: row.scope as 'project' | 'global' | undefined,
        projectPath: row.project_path as string | undefined
      };
      if (rule.toolName !== '*' && rule.toolName !== toolName) continue;
      if (rule.pattern && !matchPattern(rule.pattern, args)) continue;
      return rule;
    }
    return null;
  }

  listRules(): PermissionRule[] {
    const rows = getDb().prepare('SELECT * FROM permissions ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      toolName: row.tool_name as string,
      pattern: row.pattern as string | undefined,
      action: row.action as 'allow' | 'deny' | 'ask',
      scope: row.scope as 'project' | 'global' | undefined,
      projectPath: row.project_path as string | undefined
    }));
  }

  saveRule(rule: PermissionRule): void {
    getDb().prepare(`
      INSERT INTO permissions (id, tool_name, pattern, action, scope, project_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tool_name = excluded.tool_name,
        pattern = excluded.pattern,
        action = excluded.action,
        scope = excluded.scope,
        project_path = excluded.project_path
    `).run(rule.id, rule.toolName, rule.pattern || null, rule.action, rule.scope || null, rule.projectPath || null, Date.now());
  }

  deleteRule(id: string): void {
    getDb().prepare('DELETE FROM permissions WHERE id = ?').run(id);
  }

  decidePermission(requestId: string, decision: Decision): void {
    const p = this.pendingRequests.get(requestId);
    if (p) {
      if (decision === 'allow' && !p.explicitAsk && p.grantKey) this.scopedAllow.add(p.grantKey);
      p.resolve(decision);
      this.pendingRequests.delete(requestId);
    }
  }

  private requiresApproval(name: string): boolean {
    return ['run_shell', 'write_file', 'edit_file'].includes(name);
  }

  /** Provider-native permission callbacks enter the same main-process gate. */
  async requestPermission(req: PermissionRequest, ctx?: ToolContext): Promise<boolean> {
    if (!ctx) return false;
    const rule = this.matchRule(req.toolName, req.args);
    if (rule?.action === 'deny') return false;
    if (rule?.action === 'allow') return true;
    return this.authorize(req, ctx, rule?.action === 'ask');
  }

  private approvalMode(): ToolApprovalMode {
    return normalizeToolApprovalMode(
      (getSetting<{ toolApprovalMode?: unknown }>('appSettings') || {}).toolApprovalMode
    );
  }

  private approvalKey(mode: ToolApprovalMode, ctx: ToolContext, toolName: string): string | undefined {
    if (mode === 'session') return `session\0${ctx.conversationId}\0${toolName}`;
    if (mode === 'project') return `project\0${ctx.cwd}\0${toolName}`;
    return undefined;
  }

  private async authorize(req: PermissionRequest, ctx: ToolContext, explicitAsk: boolean): Promise<boolean> {
    const mode = this.approvalMode();
    const grantKey = this.approvalKey(mode, ctx, req.toolName);
    if (!explicitAsk && (mode === 'never' || (grantKey && this.scopedAllow.has(grantKey)))) return true;

    const request = { ...req, conversationId: ctx.conversationId };
    return new Promise<boolean>((resolve) => {
      const wrap = (allow: boolean): void => resolve(allow);
      this.pendingRequests.set(req.requestId, {
        resolve: ((d: Decision) => wrap(d === 'allow')) as (d: Decision) => void,
        grantKey,
        explicitAsk
      });
      this.emit('request', request);
      // Auto-deny after 2 minutes
      setTimeout(() => {
        if (this.pendingRequests.has(req.requestId)) {
          this.pendingRequests.delete(req.requestId);
          wrap(false);
        }
      }, 120_000);
    });
  }
}

function matchPattern(pattern: string, args: Record<string, unknown>): boolean {
  // Pattern is matched against JSON-stringified args
  try {
    const str = JSON.stringify(args);
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      const re = new RegExp(pattern.slice(1, -1));
      return re.test(str);
    }
    return str.includes(pattern);
  } catch { return false; }
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
