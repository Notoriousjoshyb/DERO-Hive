import type { ToolDefinition, PermissionRule } from '@shared/types';
import { EventEmitter } from 'node:events';
import { getDb, getSetting } from '../db/client';
import { BUILTIN_TOOLS, builtinExecutors } from './builtin';
import { McpManager } from '../mcp/manager';

export interface ToolContext {
  cwd: string;
  conversationId: string;
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
}

type Decision = 'allow' | 'deny';

export class ToolRegistry extends EventEmitter {
  private executors = new Map<string, ToolExecutor>();
  private pendingRequests = new Map<string, { resolve: (d: Decision) => void; rule: PermissionRule }>();

  constructor(private mcpManager: McpManager | null) {
    super();
    for (const [name, exec] of Object.entries(builtinExecutors)) {
      this.executors.set(name, exec);
    }
  }

  listTools(): ToolDefinition[] {
    const builtin = BUILTIN_TOOLS;
    const mcp = this.mcpManager?.getAllTools() || [];
    return [...builtin, ...mcp];
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // MCP — models call MCP tools by their raw advertised name, so resolve the
    // owning server up front. It is needed before the permission check, because
    // whether the tool needs approval depends on that server's trust flag.
    const mcp = this.executors.has(name) ? null : (this.mcpManager?.resolveTool(name) ?? null);

    // Check permissions
    const rule = this.matchRule(name, args);
    if (rule?.action === 'deny') {
      return { content: `Denied by permission rule: ${name}`, isError: true };
    }
    // An explicit `ask` rule always prompts. With no rule, sensitive built-ins
    // prompt, and so does any tool from an MCP server the user has not trusted.
    const needsApproval = rule?.action === 'ask'
      || (!rule && (this.requiresApproval(name) || (mcp !== null && !mcp.trusted)));
    if (needsApproval) {
      const allowed = await this.requestPermission({ requestId: cryptoRandom(), toolName: name, args });
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
        return { content, isError: result.isError };
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
      p.resolve(decision);
      this.pendingRequests.delete(requestId);
    }
  }

  private requiresApproval(name: string): boolean {
    // Honor toolApprovalMode from settings: 'never' → no prompts at all, 'always' → ask for sensitive tools
    const mode = (getSetting<{ toolApprovalMode?: 'always' | 'project' | 'never' }>('appSettings') || {}).toolApprovalMode || 'always';
    if (mode === 'never') return false;
    // Shell commands and writes always ask in 'always' mode unless rule overrides
    return ['run_shell', 'write_file', 'edit_file'].includes(name);
  }

  async requestPermission(req: PermissionRequest): Promise<boolean> {
    this.emit('request', req);
    return new Promise<boolean>((resolve) => {
      const wrap = (allow: boolean): void => resolve(allow);
      this.pendingRequests.set(req.requestId, {
        resolve: ((d: Decision) => wrap(d === 'allow')) as (d: Decision) => void,
        rule: { id: req.requestId, toolName: req.toolName, action: 'ask' }
      });
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
