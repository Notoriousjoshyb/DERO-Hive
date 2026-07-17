import { normalizeToolApprovalMode, type ToolApprovalMode, type ToolDefinition, type PermissionRule } from '@shared/types';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb, getSetting } from '../db/client';
import { logger } from '../utils/logger';
import { redactArgs } from '../utils/redact';
import { BUILTIN_TOOLS, builtinExecutors } from './builtin';
import { McpManager } from '../mcp/manager';

export interface ToolContext {
  cwd: string;
  conversationId: string;
  toolCallId?: string;
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
  projectPath?: string;
}

type Decision = 'allow' | 'deny';

/** Per-project trust level for tool automation (ProjectConfig.trust). */
type ProjectTrust = 'untrusted' | 'standard' | 'trusted';

/** Trust lookups are cached per normalized cwd for 30s — a plain TTL, no fs watching. */
const TRUST_CACHE_TTL_MS = 30_000;

export class ToolRegistry extends EventEmitter {
  private executors = new Map<string, ToolExecutor>();
  private pendingRequests = new Map<string, {
    resolve: (d: Decision) => void;
    grantKey?: string;
    explicitAsk: boolean;
  }>();
  private scopedAllow = new Set<string>();
  private trustCache = new Map<string, { trust: ProjectTrust; at: number }>();

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
    const startedAt = Date.now();
    // Audit state for the row written in the finally below — every path out of
    // execute() records exactly one tool_executions row (see writeAuditRow).
    const audit: { decision: Decision; status: 'success' | 'error' | 'denied'; filesTouched: string[] } = {
      decision: 'allow',
      status: 'success',
      filesTouched: []
    };
    try {
      // MCP — models call MCP tools by their raw advertised name, so resolve the
      // owning server up front. It is needed before the permission check, because
      // whether the tool needs approval depends on that server's trust flag.
      const mcp = this.executors.has(name) ? null : (this.mcpManager?.resolveTool(name) ?? null);

      // Check permissions
      const rule = this.matchRule(name, args, ctx);
      if (rule?.action === 'deny') {
        audit.decision = 'deny';
        audit.status = 'denied';
        audit.filesTouched = this.filesTouchedFor(name, args, ctx);
        return { content: `Denied by permission rule: ${name}`, isError: true };
      }

      // Per-project trust (GAP_ANALYSIS 1C): an 'untrusted' project turns every
      // execution into an explicit ask — the 'never' approval mode, remembered
      // session/project grants, and persisted allow rules are all ignored (an
      // explicit ask skips all of those shortcuts in authorize()). Persisted
      // deny rules still deny outright (handled above). 'standard' and
      // 'trusted' keep the behavior below unchanged.
      const forceAsk = this.projectTrust(ctx.cwd) === 'untrusted';

      // An explicit `ask` rule always prompts. With no rule, sensitive built-ins
      // prompt, and so does any tool from an MCP server the user has not trusted.
      // A trusted server still prompts when the resolved tool name matches the
      // write heuristic (requiresApproval) — server trust is not a blanket pass
      // for irreversible actions.
      const mcpRisk = mcp !== null && (!mcp.trusted || this.requiresApproval(mcp.toolName));
      const implicitRisk = !rule && (this.requiresApproval(name) || mcpRisk);
      if (forceAsk || rule?.action === 'ask' || implicitRisk) {
        const allowed = await this.authorize({
          requestId: cryptoRandom(),
          toolName: name,
          args,
          description: mcp?.serverName ? `MCP server: ${mcp.serverName}` : undefined
        }, ctx, forceAsk || rule?.action === 'ask');
        if (!allowed) {
          audit.decision = 'deny';
          audit.status = 'denied';
          audit.filesTouched = this.filesTouchedFor(name, args, ctx);
          return { content: `User denied: ${name}`, isError: true };
        }
      }

      // Built-in
      const builtin = this.executors.get(name);
      if (builtin) {
        let result: ToolResult;
        try { result = await builtin(args, ctx); }
        catch (err) { result = { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true }; }
        if (result.isError) audit.status = 'error';
        audit.filesTouched = this.filesTouchedFor(name, args, ctx, result);
        return result;
      }

      if (mcp) {
        let result: ToolResult;
        try {
          const raw = await this.mcpManager!.callTool(mcp.serverId, mcp.toolName, args);
          const content = Array.isArray(raw.content)
            ? (raw.content as Array<{ type: string; text?: string }>).map((c) => c.text || JSON.stringify(c)).join('\n')
            : String(raw.content);
          result = {
            content,
            isError: raw.isError,
            meta: { source: `mcp:${mcp.serverId}`, serverName: mcp.serverName }
          };
        } catch (err) {
          result = { content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
        if (result.isError) audit.status = 'error';
        // filesTouched stays [] — the registry cannot know which files (if
        // any) a remote MCP tool touched.
        return result;
      }

      audit.status = 'error';
      return { content: `Unknown tool: ${name}`, isError: true };
    } catch (err) {
      // Paths that throw out of execute (e.g. a 'request' listener raising
      // inside authorize) still get exactly one audit row — as an error.
      audit.status = 'error';
      throw err;
    } finally {
      this.writeAuditRow(name, args, ctx, audit, Date.now() - startedAt);
    }
  }

  matchRule(toolName: string, args: Record<string, unknown>, ctx?: ToolContext): PermissionRule | null {
    const rows = getDb().prepare('SELECT * FROM permissions').all() as Array<Record<string, unknown>>;
    let askRule: PermissionRule | null = null;
    let allowRule: PermissionRule | null = null;
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
      if (rule.scope === 'project') {
        if (!rule.projectPath || !ctx) continue;
        const expected = normalizeProjectPath(rule.projectPath);
        const actual = normalizeProjectPath(ctx.cwd);
        if (expected !== actual) continue;
      }
      // A matching deny is absolute. Explicit asks then take precedence over
      // allows so a broad allow rule cannot mask a narrower safety rule.
      if (rule.action === 'deny') return rule;
      if (rule.action === 'ask') askRule ||= rule;
      if (rule.action === 'allow') allowRule ||= rule;
    }
    return askRule || allowRule;
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
    // 'always'/'session'/'project' all ask for sensitive built-ins; 'never' never does.
    // The scope of what "remembering" a decision means is handled in authorize().
    if (this.approvalMode() === 'never') return false;
    // Media generation, dapp scaffolding and wallet creation spend money or
    // have side effects beyond the workspace — they gate like shell/file writes.
    const sensitiveBuiltins = [
      'run_shell', 'write_file', 'edit_file',
      'generate_tela_dapp', 'generate_image', 'generate_audio', 'generate_video',
      'simulator_create_wallet'
    ];
    const deroWritePatterns = ['invoke', 'deploy', 'transfer', 'send', 'sign'];
    if (sensitiveBuiltins.includes(name)) return true;
    const lower = name.toLowerCase();
    if (deroWritePatterns.some(p => lower.includes(p))) return true;
    return false;
  }

  /**
   * Resolve the trust level of the project owning `cwd` (GAP_ANALYSIS 1C).
   * Matches the projects row by normalized path — the same normalization used
   * for project-scoped permission rules — and reads `config.trust`, defaulting
   * to 'standard'. Results are cached per normalized cwd with a 30s TTL so a
   * burst of tool calls does not re-query the projects table every time.
   * Fail-open: any lookup problem yields 'standard' (previous behavior) and is
   * logged, never thrown.
   */
  private projectTrust(cwd: string): ProjectTrust {
    const key = normalizeProjectPath(cwd);
    const now = Date.now();
    const cached = this.trustCache.get(key);
    if (cached && now - cached.at < TRUST_CACHE_TTL_MS) return cached.trust;
    let trust: ProjectTrust = 'standard';
    try {
      const rows = getDb().prepare('SELECT path, config FROM projects').all() as Array<{ path: string; config: string | null }>;
      const row = rows.find((r) => typeof r.path === 'string' && normalizeProjectPath(r.path) === key);
      if (row?.config) {
        const config = JSON.parse(row.config) as { trust?: unknown };
        if (config.trust === 'untrusted' || config.trust === 'standard' || config.trust === 'trusted') {
          trust = config.trust;
        }
      }
    } catch (err) {
      logger.warn('tools', `project trust lookup failed for ${cwd}; defaulting to 'standard'`, err);
    }
    // Keep the cache bounded — one entry per distinct cwd is tiny, but an
    // app-lifetime registry can see many workspaces. Past the ceiling, sweep
    // expired entries (or clear outright if everything is still fresh).
    if (this.trustCache.size >= 128) {
      for (const [k, v] of this.trustCache) {
        if (now - v.at >= TRUST_CACHE_TTL_MS) this.trustCache.delete(k);
      }
      if (this.trustCache.size >= 128) this.trustCache.clear();
    }
    this.trustCache.set(key, { trust, at: now });
    return trust;
  }

  /**
   * Files an execution touched (or would have touched, for denials). Only the
   * built-in file-mutation tools have a determinable target: prefer the
   * executor's resolved absolute path from the result meta, fall back to a
   * lexical resolve of args.path (covers denials, where no result exists).
   * MCP and all other tools record [].
   */
  private filesTouchedFor(name: string, args: Record<string, unknown>, ctx: ToolContext, result?: ToolResult): string[] {
    if (name !== 'write_file' && name !== 'edit_file') return [];
    const fromMeta = result?.meta?.path;
    if (typeof fromMeta === 'string' && fromMeta) return [fromMeta];
    const p = args.path;
    if (typeof p !== 'string' || !p) return [];
    try { return [resolve(ctx.cwd, p)]; } catch { return []; }
  }

  /**
   * Append one row to the tool_executions audit table (GAP_ANALYSIS 1D).
   * Best-effort by design: audit failures are logged and swallowed so they can
   * never break tool execution.
   */
  private writeAuditRow(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    audit: { decision: Decision; status: 'success' | 'error' | 'denied'; filesTouched: string[] },
    durationMs: number
  ): void {
    try {
      getDb().prepare(`
        INSERT INTO tool_executions (id, conversation_id, tool, args_redacted, decision, duration_ms, status, files_touched, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        ctx.conversationId,
        name,
        redactArgs(args),
        audit.decision,
        durationMs,
        audit.status,
        JSON.stringify(audit.filesTouched),
        Date.now()
      );
    } catch (err) {
      logger.warn('tools', `audit write failed for ${name}`, err);
    }
  }

  /** Provider-native permission callbacks enter the same main-process gate. */
  async requestPermission(req: PermissionRequest, ctx?: ToolContext): Promise<boolean> {
    if (!ctx) return false;
    const rule = this.matchRule(req.toolName, req.args, ctx);
    if (rule?.action === 'deny') return false;
    // Same per-project trust gate as execute(): an 'untrusted' project forces an
    // explicit ask, so persisted allow rules and the 'never' approval mode do
    // not silently pass provider-native (e.g. codex-acp) tool calls through.
    const forceAsk = this.projectTrust(ctx.cwd) === 'untrusted';
    if (!forceAsk && rule?.action === 'allow') return true;
    return this.authorize(req, ctx, forceAsk || rule?.action === 'ask');
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

    const request = { ...req, conversationId: ctx.conversationId, projectPath: ctx.cwd };
    return new Promise<boolean>((resolve) => {
      const wrap = (allow: boolean): void => resolve(allow);
      this.pendingRequests.set(req.requestId, {
        resolve: ((d: Decision) => wrap(d === 'allow')) as (d: Decision) => void,
        grantKey,
        explicitAsk
      });
      this.emit('request', request);
      // Auto-deny after 2 minutes. unref so a decided/expired request never
      // keeps a headless (CLI/test) process alive.
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(req.requestId)) {
          this.pendingRequests.delete(req.requestId);
          wrap(false);
        }
      }, 120_000);
      timer.unref();
    });
  }
}

function normalizeProjectPath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function matchPattern(pattern: string, args: Record<string, unknown>): boolean {
  // Pattern is matched against JSON-stringified args. The length>1 guard keeps
  // parity with the permissions IPC validator: a lone '/' is a substring, not
  // an (empty) regex.
  try {
    const str = JSON.stringify(args);
    if (pattern.length > 1 && pattern.startsWith('/') && pattern.endsWith('/')) {
      const re = new RegExp(pattern.slice(1, -1));
      return re.test(str);
    }
    return str.includes(pattern);
  } catch { return false; }
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
