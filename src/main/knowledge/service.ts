import { randomUUID } from 'node:crypto';
import type { McpManager } from '../mcp/manager';
import { getDb } from '../db/client';
import {
  normalizeKnowledgePath,
  normalizeProjectConfig,
  type KnowledgeAppendRequest,
  type KnowledgeBootstrapResult,
  type KnowledgeCapability,
  type KnowledgeCaptureRequest,
  type KnowledgeCaptureResult,
  type KnowledgeListResult,
  type KnowledgeOpenRequest,
  type KnowledgePatchRequest,
  type KnowledgeReadResult,
  type KnowledgeRetryResult,
  type KnowledgeSearchHit,
  type KnowledgeStatus,
  type KnowledgeWriteResult,
  type ProjectConfig
} from '@shared/types';

const TOOLS: Record<KnowledgeCapability, string> = {
  list: 'vault_list',
  read: 'vault_read',
  search: 'search_simple',
  write: 'vault_write',
  append: 'vault_append',
  patch: 'vault_patch',
  open: 'open_file'
};
const CAPABILITIES = Object.keys(TOOLS) as KnowledgeCapability[];
const MAX_CONTENT = 1024 * 1024;

interface ProjectContext {
  projectId: string;
  projectName: string;
  serverId: string;
  folder: string;
  allowAutomationWrites: boolean;
  capabilities: KnowledgeCapability[];
}

export interface KnowledgeWriteOptions { automated?: boolean }

export class KnowledgeService {
  constructor(private readonly mcp: Pick<McpManager, 'getInstance' | 'callTool'>) {}

  status(projectId: string): KnowledgeStatus {
    const base = { projectId, configured: false, connected: false, capabilities: [] as KnowledgeCapability[], missing: [...CAPABILITIES] };
    try {
      const project = this.project(projectId);
      const knowledge = project.config.knowledge;
      if (!knowledge) return { ...base, error: 'Project knowledge is not configured' };
      const instance = this.mcp.getInstance(knowledge.serverId);
      const capabilities = instance ? this.discover(instance.tools.map((tool) => tool.name)) : [];
      return {
        projectId,
        configured: true,
        connected: instance?.status === 'connected',
        serverId: knowledge.serverId,
        folder: knowledge.folder,
        capabilities,
        missing: CAPABILITIES.filter((capability) => !capabilities.includes(capability)),
        ...(!instance || instance.status !== 'connected' ? { error: 'Configured Obsidian MCP server is not connected' } : {})
      };
    } catch (error) {
      return { ...base, error: errorMessage(error) };
    }
  }

  async list(projectId: string, path = ''): Promise<KnowledgeListResult> {
    const context = this.context(projectId);
    const relative = normalizeKnowledgePath(path, true);
    const text = await this.call(context, 'list', { path: scopedPath(context.folder, relative) });
    const parsed = parseJson(text, 'list') as { files?: unknown };
    if (!Array.isArray(parsed.files)) throw new Error('Invalid Obsidian MCP list response');
    return {
      path: relative,
      entries: parsed.files.flatMap((entry) => {
        if (typeof entry !== 'string') return [];
        const directory = entry.endsWith('/');
        try { return [{ name: normalizeKnowledgePath(directory ? entry.slice(0, -1) : entry), directory }]; }
        catch { return []; }
      })
    };
  }

  async read(projectId: string, path: string): Promise<KnowledgeReadResult> {
    const context = this.context(projectId);
    const relative = normalizeKnowledgePath(path);
    const text = await this.call(context, 'read', { path: scopedPath(context.folder, relative) });
    const parsed = parseJson(text, 'read') as { content?: unknown };
    if (typeof parsed.content !== 'string') throw new Error('Invalid Obsidian MCP read response');
    return { path: relative, content: parsed.content };
  }

  async search(projectId: string, query: string, limit = 50, contextLength = 100): Promise<KnowledgeSearchHit[]> {
    const context = this.context(projectId);
    const normalizedQuery = requiredText(query, 'Search query', 1_000);
    const text = await this.call(context, 'search', {
      query: normalizedQuery,
      contextLength: clampInteger(contextLength, 0, 1_000, 100)
    });
    const parsed = parseJson(text, 'search');
    if (!Array.isArray(parsed)) throw new Error('Invalid Obsidian MCP search response');
    const prefix = `${context.folder}/`;
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const hit = value as Record<string, unknown>;
      if (typeof hit.filename !== 'string') return [];
      let filename: string;
      try { filename = normalizeKnowledgePath(hit.filename); } catch { return []; }
      if (!filename.startsWith(prefix)) return [];
      return [{
        path: filename.slice(prefix.length),
        ...(typeof hit.score === 'number' ? { score: hit.score } : {}),
        matches: Array.isArray(hit.matches) ? hit.matches : []
      }];
    }).slice(0, clampInteger(limit, 1, 200, 50));
  }

  async bootstrap(projectId: string, options: KnowledgeWriteOptions = {}): Promise<KnowledgeBootstrapResult> {
    const context = this.context(projectId);
    this.assertAutomation(context, options);
    this.require(context, 'read');
    this.require(context, 'write');
    const files: Array<[string, string]> = [
      ['Project.md', `# ${context.projectName}\n\n`],
      ['Decisions.md', '# Decisions\n\n'],
      ['Open Questions.md', '# Open Questions\n\n'],
      ['Inbox/Raw/README.md', '# Raw Inbox\n\nUnedited captures.\n'],
      ['Daily/README.md', '# Daily Notes\n'],
      ['Weekly/README.md', '# Weekly Syntheses\n'],
      ['Evidence/README.md', '# Evidence\n']
    ];
    const result: KnowledgeBootstrapResult = { created: [], existing: [] };
    for (const [path, content] of files) {
      try {
        await this.call(context, 'read', { path: scopedPath(context.folder, path) });
        result.existing.push(path);
      } catch (error) {
        if (!/not found|does not exist|404/i.test(errorMessage(error))) throw error;
        await this.call(context, 'write', { path: scopedPath(context.folder, path), content });
        result.created.push(path);
      }
    }
    return result;
  }

  async append(input: KnowledgeAppendRequest, options: KnowledgeWriteOptions = {}): Promise<KnowledgeWriteResult> {
    const context = this.context(input.projectId);
    this.assertAutomation(context, options);
    const path = normalizeKnowledgePath(input.path);
    const content = requiredText(input.content, 'Knowledge content', MAX_CONTENT, false);
    await this.call(context, 'append', { path: scopedPath(context.folder, path), content });
    return { path };
  }

  async patch(input: KnowledgePatchRequest, options: KnowledgeWriteOptions = {}): Promise<KnowledgeWriteResult> {
    const context = this.context(input.projectId);
    this.assertAutomation(context, options);
    const path = normalizeKnowledgePath(input.path);
    const content = requiredText(input.content, 'Knowledge content', MAX_CONTENT, false);
    if (!['heading', 'block', 'frontmatter'].includes(input.targetType)) throw new Error('Invalid patch target type');
    if (!['replace', 'prepend', 'append'].includes(input.operation)) throw new Error('Invalid patch operation');
    if (input.contentType !== undefined && !['text/markdown', 'application/json'].includes(input.contentType)) {
      throw new Error('Invalid patch content type');
    }
    if (input.createTargetIfMissing !== undefined && typeof input.createTargetIfMissing !== 'boolean') {
      throw new Error('createTargetIfMissing must be a boolean');
    }
    if (input.rejectIfContentPreexists !== undefined && typeof input.rejectIfContentPreexists !== 'boolean') {
      throw new Error('rejectIfContentPreexists must be a boolean');
    }
    await this.call(context, 'patch', {
      path: scopedPath(context.folder, path),
      targetType: input.targetType,
      target: requiredText(input.target, 'Patch target', 1_000),
      operation: input.operation,
      content,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.createTargetIfMissing === undefined ? {} : { createTargetIfMissing: !!input.createTargetIfMissing }),
      ...(input.rejectIfContentPreexists === undefined ? {} : { rejectIfContentPreexists: !!input.rejectIfContentPreexists })
    });
    return { path };
  }

  async open(input: KnowledgeOpenRequest): Promise<KnowledgeWriteResult> {
    const context = this.context(input.projectId);
    const path = normalizeKnowledgePath(input.path);
    if (input.newLeaf !== undefined && typeof input.newLeaf !== 'boolean') throw new Error('newLeaf must be a boolean');
    await this.call(context, 'open', { path: scopedPath(context.folder, path), newLeaf: !!input.newLeaf });
    return { path };
  }

  async capture(input: KnowledgeCaptureRequest, options: KnowledgeWriteOptions = {}): Promise<KnowledgeCaptureResult> {
    const project = this.project(input.projectId);
    const knowledge = project.config.knowledge;
    if (!knowledge) throw new Error('Project knowledge is not configured');
    if (options.automated && !knowledge.allowAutomationWrites) {
      throw new Error('Automated knowledge writes are disabled for this project');
    }
    const content = requiredText(input.content, 'Capture content', MAX_CONTENT);
    const timestamp = new Date().toISOString();
    const path = `Inbox/Raw/${timestamp.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.md`;
    const body = [
      '---',
      `created: ${JSON.stringify(timestamp)}`,
      ...(input.source ? [`source: ${JSON.stringify(requiredText(input.source, 'Capture source', 200))}`] : []),
      ...(input.title ? [`title: ${JSON.stringify(requiredText(input.title, 'Capture title', 300))}`] : []),
      '---', '', content, ''
    ].join('\n');
    try {
      const context = this.context(input.projectId);
      await this.call(context, 'write', { path: scopedPath(context.folder, path), content: body });
      return { path, queued: false };
    } catch (error) {
      const id = randomUUID();
      const now = Date.now();
      const message = errorMessage(error).slice(0, 2_000);
      getDb().prepare(`
        INSERT INTO knowledge_outbox (id, project_id, path, content, attempts, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, input.projectId, path, body, message, now, now);
      return { path, queued: true, outboxId: id, error: message };
    }
  }

  async retryOutbox(projectId?: string, options: KnowledgeWriteOptions = {}): Promise<KnowledgeRetryResult> {
    if (projectId !== undefined) requiredText(projectId, 'Project id', 200);
    const rows = getDb().prepare(
      projectId
        ? 'SELECT * FROM knowledge_outbox WHERE project_id = ? ORDER BY created_at'
        : 'SELECT * FROM knowledge_outbox ORDER BY created_at'
    ).all(...(projectId ? [projectId] : [])) as Array<Record<string, unknown>>;
    const result: KnowledgeRetryResult = { retried: rows.length, delivered: 0, failed: 0 };
    for (const row of rows) {
      try {
        const context = this.context(row.project_id as string);
        this.assertAutomation(context, options);
        const path = normalizeKnowledgePath(row.path);
        await this.call(context, 'write', { path: scopedPath(context.folder, path), content: row.content as string });
        getDb().prepare('DELETE FROM knowledge_outbox WHERE id = ?').run(row.id);
        result.delivered++;
      } catch (error) {
        getDb().prepare(`
          UPDATE knowledge_outbox SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?
        `).run(errorMessage(error).slice(0, 2_000), Date.now(), row.id);
        result.failed++;
      }
    }
    return result;
  }

  private project(projectId: string): { name: string; config: ProjectConfig } {
    const id = requiredText(projectId, 'Project id', 200);
    const row = getDb().prepare('SELECT name, config FROM projects WHERE id = ?').get(id) as { name: string; config?: string } | undefined;
    if (!row) throw new Error('Project not found');
    let value: unknown;
    try { value = row.config ? JSON.parse(row.config) : {}; } catch { throw new Error('Project config is invalid'); }
    return { name: row.name, config: normalizeProjectConfig(value) };
  }

  private context(projectId: string): ProjectContext {
    const project = this.project(projectId);
    const knowledge = project.config.knowledge;
    if (!knowledge) throw new Error('Project knowledge is not configured');
    const instance = this.mcp.getInstance(knowledge.serverId);
    if (!instance || instance.status !== 'connected') throw new Error('Configured Obsidian MCP server is not connected');
    return {
      projectId,
      projectName: project.name,
      serverId: knowledge.serverId,
      folder: knowledge.folder,
      allowAutomationWrites: !!knowledge.allowAutomationWrites,
      capabilities: this.discover(instance.tools.map((tool) => tool.name))
    };
  }

  private discover(toolNames: string[]): KnowledgeCapability[] {
    const names = new Set(toolNames);
    return CAPABILITIES.filter((capability) => names.has(TOOLS[capability]));
  }

  private require(context: ProjectContext, capability: KnowledgeCapability): string {
    if (!context.capabilities.includes(capability)) {
      throw new Error(`Obsidian MCP server is missing required capability: ${capability} (${TOOLS[capability]})`);
    }
    return TOOLS[capability];
  }

  private async call(context: ProjectContext, capability: KnowledgeCapability, args: Record<string, unknown>): Promise<string> {
    const result = await this.mcp.callTool(context.serverId, this.require(context, capability), args);
    const text = mcpText(result.content);
    if (result.isError) throw new Error(text || `Obsidian MCP ${capability} failed`);
    return text;
  }

  private assertAutomation(context: ProjectContext, options: KnowledgeWriteOptions): void {
    if (options.automated && !context.allowAutomationWrites) {
      throw new Error('Automated knowledge writes are disabled for this project');
    }
  }
}

let activeService: KnowledgeService | null = null;
export function initializeKnowledgeService(mcp: McpManager): KnowledgeService {
  activeService = new KnowledgeService(mcp);
  return activeService;
}
export function getKnowledgeService(): KnowledgeService | null { return activeService; }

function scopedPath(folder: string, path: string): string { return path ? `${folder}/${path}` : folder; }

function requiredText(value: unknown, label: string, max: number, trim = true): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const result = trim ? value.trim() : value;
  if (!result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, number));
}

function parseJson(value: string, operation: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error(`Invalid Obsidian MCP ${operation} response`); }
}

function mcpText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(mcpText).filter(Boolean).join('\n');
  if (content && typeof content === 'object') {
    const value = content as Record<string, unknown>;
    if (typeof value.text === 'string') return value.text;
  }
  return '';
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
