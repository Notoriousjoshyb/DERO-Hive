import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamEvent } from './base';
import type { ContentPart, Message, ProviderConfig, ProviderModel, ThinkingOption } from '@shared/types';
import { logger } from '../utils/logger';
import { getWorkspaceRoot, resolveWithinAllowed } from '../utils/pathPolicy';

// The SDK is ESM-only while Electron's main bundle is CommonJS-compatible.
import type * as acp from '@agentclientprotocol/sdk';
import type { Client, InitializeResponse, SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';

const ACP_PROTOCOL_VERSION = 1;

let acpModule: typeof import('@agentclientprotocol/sdk') | null = null;
async function loadAcp(): Promise<typeof import('@agentclientprotocol/sdk')> {
  if (!acpModule) acpModule = await import('@agentclientprotocol/sdk');
  return acpModule;
}

interface AcpEvent {
  type: ProviderStreamEvent['type'];
  content?: string;
  reasoning?: string;
  error?: string;
  toolActivity?: NonNullable<ProviderStreamEvent['toolActivity']>;
}

interface SessionState {
  sessionId: string;
  model: string;
  bootstrapped: boolean;
  cwd: string;
}

interface Runtime {
  proc: ChildProcessWithoutNullStreams;
  conn: acp.ClientSideConnection;
  init: InitializeResponse;
  queues: Map<string, AsyncQueue<AcpEvent>>;
  permissionHandlers: Map<string, (request: { requestId: string; toolName: string; args: Record<string, unknown>; description?: string }) => Promise<boolean>>;
  readOnlySessions: Set<string>;
  sessions: Map<string, SessionState>;
  authenticationAttempt: Promise<void> | null;
}

class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];

  push(item: T): void {
    const resolve = this.resolvers.shift();
    if (resolve) resolve(item);
    else this.items.push(item);
  }

  next(): Promise<T> {
    const item = this.items.shift();
    return item !== undefined ? Promise.resolve(item) : new Promise((resolve) => this.resolvers.push(resolve));
  }
}

/**
 * Vendor-specific knobs for an ACP-wrapped agent. The protocol handling below
 * is shared; what differs between Codex (ChatGPT) and Claude Code (Anthropic)
 * is how the adapter binary is found, which advertised auth method to pick,
 * and how strictly session config (model/effort) must be honoured.
 */
interface AcpVendorSpec {
  /** Log channel + toolActivity meta.source. */
  logTag: string;
  /** Human-readable agent name for errors and permission prompts. */
  displayName: string;
  /** node_modules-relative path to the adapter's JS entry. */
  packagePath: string;
  /** Bare command fallback when no packaged copy exists. */
  bareCommand: string;
  /** Package spec for the `npx -y` fallback. */
  npxPackage: string;
  /** Selects the browser-login method among init.authMethods. */
  authMethodPattern: RegExp;
  /** When no method matches the pattern, fall back to the first advertised one. */
  authFallbackToFirst?: boolean;
  authMissingError: string;
  authHint: string;
  /** Extra environment for the spawned adapter process. */
  extraEnv?: () => Record<string, string>;
  /** Inherited env vars to remove before spawning the adapter. */
  stripEnv?: string[];
  /** Used when the agent does not advertise a model config option. */
  fallbackModels?: string[];
  /** Treat session-config failures (model/effort) as non-fatal. */
  lenientConfig?: boolean;
}

const CODEX_SPEC: AcpVendorSpec = {
  logTag: 'codex-acp',
  displayName: 'Codex',
  packagePath: '@agentclientprotocol/codex-acp/dist/index.js',
  bareCommand: 'codex-acp',
  npxPackage: '@agentclientprotocol/codex-acp',
  authMethodPattern: /chatgpt|chat-gpt/i,
  authMissingError: 'Codex ACP did not advertise ChatGPT authentication. Ensure NO_BROWSER is not enabled.',
  authHint: 'Make sure ChatGPT Codex access is enabled for the account, then try Models again.',
  extraEnv: (): Record<string, string> => {
    const codexPath = bundledCodexPath();
    return codexPath ? { CODEX_PATH: codexPath } : {};
  }
};

// Claude Code via Zed's ACP adapter around Anthropic's Claude Agent SDK. This
// is the sanctioned way to use a Claude Pro/Max subscription outside Claude
// Code itself: authentication is owned end-to-end by Anthropic's own tooling
// (the adapter's login flow / `claude /login`), no tokens ever touch Hive.
const CLAUDE_SPEC: AcpVendorSpec = {
  logTag: 'claude-acp',
  displayName: 'Claude Code',
  packagePath: '@zed-industries/claude-code-acp/dist/index.js',
  bareCommand: 'claude-code-acp',
  npxPackage: '@zed-industries/claude-code-acp',
  authMethodPattern: /claude|anthropic|log.?in/i,
  authFallbackToFirst: true,
  authMissingError: 'Claude Code ACP did not advertise a login method. Run `claude /login` in a terminal to sign in with your Claude subscription, then try again.',
  authHint: 'Sign in with your Claude (Pro/Max) account. If no browser login appears, run `claude /login` in a terminal, then click Models again.',
  // The adapter may not expose a model selector; the Agent SDK accepts these
  // aliases and otherwise uses the account default.
  fallbackModels: ['sonnet', 'opus', 'haiku'],
  lenientConfig: true,
  // The Agent SDK refuses to start when it thinks it is nested inside another
  // Claude Code session. If Hive itself was launched from a Claude Code
  // terminal these leak in and break every session.
  stripEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']
};

function defaultAcpPath(spec: AcpVendorSpec): string {
  const appRoot = process.env.HIVE_APP_ROOT || process.cwd();
  const candidates = [
    join(process.resourcesPath || '', `app.asar.unpacked/node_modules/${spec.packagePath}`),
    join(appRoot, `node_modules/${spec.packagePath}`),
    join(process.cwd(), `node_modules/${spec.packagePath}`),
    spec.bareCommand
  ];
  return candidates.find((candidate) => candidate === spec.bareCommand || existsSync(candidate)) || candidates[0];
}

function bundledCodexPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const appRoot = process.env.HIVE_APP_ROOT || process.cwd();
  const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
  const candidates = [
    join(process.resourcesPath || '', `app.asar.unpacked/node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`),
    join(appRoot, `node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`),
    join(process.cwd(), `node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`),
  ];
  return candidates.find(existsSync);
}

function findSelectOption(options: SessionConfigOption[] | null | undefined, category: string, id?: string): SessionConfigOption | undefined {
  return options?.find((option) => option.type === 'select' && (option.category === category || option.id === id));
}

function flattenSelectOptions(option: SessionConfigOption | undefined): SessionConfigSelectOption[] {
  if (!option || option.type !== 'select' || !option.options) return [];
  return option.options.flatMap((entry) => 'options' in entry && Array.isArray(entry.options)
    ? entry.options as SessionConfigSelectOption[]
    : [entry as SessionConfigSelectOption]);
}

function thinkingOptionsFromConfig(options: SessionConfigOption[] | null | undefined): ThinkingOption[] {
  const option = findSelectOption(options, 'thought_level', 'reasoning_effort');
  return flattenSelectOptions(option).flatMap((entry) => {
    const id = entry.value as ThinkingOption['id'];
    if (!['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(id)) return [];
    return [{ id, label: entry.name || id, description: entry.description || `${entry.name || id} reasoning` }];
  });
}

function attachmentBlock(part: ContentPart): acp.ContentBlock[] {
  if (part.type === 'text') return [{ type: 'text', text: part.text }];
  if (part.type === 'image_url') {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(part.image_url.url);
    return match
      ? [{ type: 'image', mimeType: match[1], data: match[2] }]
      : [{ type: 'resource_link', name: 'image', uri: part.image_url.url }];
  }
  if (part.type === 'input_audio') {
    return [{ type: 'audio', mimeType: part.input_audio.format === 'wav' ? 'audio/wav' : 'audio/mpeg', data: part.input_audio.data }];
  }
  if (part.type === 'file') {
    const uri = `hive-attachment:///${encodeURIComponent(part.file.filename)}`;
    if (/^(text\/|application\/(json|javascript|xml))/u.test(part.file.mimeType)) {
      return [{ type: 'resource', resource: { uri, mimeType: part.file.mimeType, text: Buffer.from(part.file.data, 'base64').toString('utf8') } }];
    }
    return [{ type: 'resource', resource: { uri, mimeType: part.file.mimeType, blob: part.file.data } }];
  }
  return [{ type: 'resource_link', name: part.attachment.filename, uri: `hive-attachment:///${part.attachment.id}`, mimeType: part.attachment.mimeType, size: part.attachment.size }];
}

function contentBlocksFromMessages(messages: Message[], systemPrompt?: string): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  if (systemPrompt) blocks.push({ type: 'text', text: systemPrompt });
  for (const message of messages) {
    if (typeof message.content === 'string') {
      blocks.push({ type: 'text', text: `[${message.role}]: ${message.content}` });
      continue;
    }
    blocks.push({ type: 'text', text: `[${message.role} message]` });
    for (const part of message.content) blocks.push(...attachmentBlock(part));
  }
  return blocks;
}

function toolArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { input: value ?? null };
}

function toolResult(update: acp.ToolCall | acp.ToolCallUpdate, spec: AcpVendorSpec): { content: string; meta: Record<string, unknown> } {
  const rendered: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const item of update.content || []) {
    if (item.type === 'diff') {
      const oldLines = (item.oldText || '').split('\n').length;
      const newLines = item.newText.split('\n').length;
      linesAdded += Math.max(0, newLines - oldLines);
      linesRemoved += Math.max(0, oldLines - newLines);
      rendered.push(`Updated ${item.path} (+${Math.max(0, newLines - oldLines)} -${Math.max(0, oldLines - newLines)})`);
    } else if (item.type === 'terminal') {
      rendered.push(`Terminal: ${item.terminalId}`);
    } else if (item.content.type === 'text') {
      rendered.push(item.content.text);
    } else {
      rendered.push(`[${item.content.type} result]`);
    }
  }
  if (update.rawOutput !== undefined) {
    rendered.push(typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput, null, 2));
  }
  return {
    content: rendered.filter(Boolean).join('\n') || (update.status === 'failed' ? `${spec.displayName} tool failed.` : `${spec.displayName} tool completed.`),
    meta: {
      source: spec.logTag,
      ...(update.kind ? { kind: update.kind } : {}),
      ...(update.locations?.length ? { locations: update.locations } : {}),
      ...(linesAdded || linesRemoved ? { linesAdded, linesRemoved } : {})
    }
  };
}

/** Routes ACP notifications to the queue for the session that produced them. */
class AcpClientImpl implements Client {
  private readonly tools = new Map<string, { name: string; args: Record<string, unknown>; startedAt: number; kind?: acp.ToolKind }>();

  constructor(
    private readonly spec: AcpVendorSpec,
    private readonly queues: Map<string, AsyncQueue<AcpEvent>>,
    private readonly permissionHandlers: Runtime['permissionHandlers'],
    private readonly readOnlySessions: Set<string>
  ) {}

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    if (this.readOnlySessions.has(params.sessionId)) return { outcome: { outcome: 'cancelled' } };
    const handler = this.permissionHandlers.get(params.sessionId);
    if (!handler) return { outcome: { outcome: 'cancelled' } };

    const rawInput = params.toolCall.rawInput;
    const args = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : { input: rawInput ?? null };
    const allowed = await handler({
      requestId: `${this.spec.logTag}-${randomUUID()}`,
      toolName: params.toolCall.title || params.toolCall.kind || `${this.spec.displayName} tool`,
      args,
      description: `${this.spec.displayName} needs permission to perform this action.`
    });
    if (!allowed) return { outcome: { outcome: 'cancelled' } };

    const option = params.options.find((item) => item.kind === 'allow_once')
      || params.options.find((item) => item.kind === 'allow_always');
    return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
  }

  sessionUpdate(params: acp.SessionNotification): void {
    const queue = this.queues.get(params.sessionId);
    if (!queue) return;
    const update = params.update;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' && update.content.text) {
      queue.push({ type: 'delta', content: update.content.text });
    } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text' && update.content.text) {
      queue.push({ type: 'reasoning', reasoning: update.content.text });
    } else if (update.sessionUpdate === 'tool_call') {
      const state = { name: update.title, args: toolArgs(update.rawInput), startedAt: Date.now(), kind: update.kind };
      this.tools.set(`${params.sessionId}\0${update.toolCallId}`, state);
      queue.push({
        type: 'tool_start',
        toolActivity: { id: update.toolCallId, name: update.title, args: state.args, status: 'running', meta: { source: this.spec.logTag, kind: update.kind } }
      });
      if (update.status === 'completed' || update.status === 'failed') {
        const result = toolResult(update, this.spec);
        queue.push({
          type: 'tool_result',
          toolActivity: {
            id: update.toolCallId, name: update.title, args: state.args,
            status: update.status === 'failed' ? 'error' : 'success', result: result.content,
            durationMs: Date.now() - state.startedAt, meta: result.meta
          }
        });
        this.tools.delete(`${params.sessionId}\0${update.toolCallId}`);
      }
    } else if (update.sessionUpdate === 'tool_call_update') {
      const key = `${params.sessionId}\0${update.toolCallId}`;
      const current = this.tools.get(key) || {
        name: update.title || update.kind || `${this.spec.displayName} tool`, args: toolArgs(update.rawInput), startedAt: Date.now(), kind: update.kind || undefined
      };
      if (update.title) current.name = update.title;
      if (update.rawInput !== undefined) current.args = toolArgs(update.rawInput);
      if (update.kind) current.kind = update.kind;
      if (!this.tools.has(key)) {
        this.tools.set(key, current);
        queue.push({ type: 'tool_start', toolActivity: { id: update.toolCallId, name: current.name, args: current.args, status: 'running', meta: { source: this.spec.logTag, kind: current.kind } } });
      }
      if (update.status === 'completed' || update.status === 'failed') {
        const result = toolResult(update, this.spec);
        queue.push({
          type: 'tool_result',
          toolActivity: {
            id: update.toolCallId, name: current.name, args: current.args,
            status: update.status === 'failed' ? 'error' : 'success', result: result.content,
            durationMs: Date.now() - current.startedAt, meta: result.meta
          }
        });
        this.tools.delete(key);
      }
    }
  }

  readTextFile(params: acp.ReadTextFileRequest): acp.ReadTextFileResponse {
    try { return { content: readFileSync(resolveWithinAllowed(params.path), 'utf-8') }; }
    catch { return { content: '' }; }
  }

  writeTextFile(params: acp.WriteTextFileRequest): acp.WriteTextFileResponse | void {
    if (this.readOnlySessions.has(params.sessionId)) throw new Error('Plan mode is read-only; file writes are disabled.');
    try {
      const path = resolveWithinAllowed(params.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, params.content, 'utf-8');
    } catch (error) {
      logger.warn(this.spec.logTag, `write failed: ${String(error)}`);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function extractAcpError(error: unknown): { message: string; details?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const data = (error as { data?: { details?: string; message?: string } }).data;
  return { message, details: data?.details || data?.message };
}

export class AcpAdapter implements ProviderAdapter {
  readonly id: string;
  private runtimePromise: Promise<Runtime> | null = null;
  private disposed = false;

  constructor(private readonly cfg: ProviderConfig, protected readonly spec: AcpVendorSpec) {
    this.id = cfg.id;
  }

  private async createRuntime(): Promise<Runtime> {
    const sdk = await loadAcp();
    const commandPath = this.cfg.customHeaders?.commandPath || defaultAcpPath(this.spec);
    const isJs = commandPath.endsWith('.js');
    const command = isJs ? process.execPath : commandPath;
    const args = isJs ? [commandPath] : commandPath === 'npx' ? ['-y', this.spec.npxPackage] : [];

    logger.info(this.spec.logTag, `starting persistent adapter: ${command} ${args.join(' ')}`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(isJs ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ...(this.cfg.customHeaders?.noBrowser === '1' ? { NO_BROWSER: '1' } : {}),
      ...(this.spec.extraEnv?.() || {})
    };
    for (const key of this.spec.stripEnv || []) delete env[key];
    const proc = spawn(command, args, { env, windowsHide: true });
    const queues = new Map<string, AsyncQueue<AcpEvent>>();
    const permissionHandlers = new Map<string, Runtime['permissionHandlers'] extends Map<string, infer T> ? T : never>();
    const readOnlySessions = new Set<string>();
    proc.stderr.on('data', (data: Buffer) => logger.debug(this.spec.logTag, data.toString().trim()));
    proc.on('error', (error) => logger.error(this.spec.logTag, `process error: ${error.message}`));
    proc.on('exit', (code) => {
      logger.info(this.spec.logTag, `process exited (${code ?? 'signal'})`);
      for (const queue of queues.values()) queue.push({ type: 'error', error: `${this.spec.displayName} ACP process exited unexpectedly.` });
      this.runtimePromise = null;
    });

    const stream = sdk.ndJsonStream(
      Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
    );
    const conn = new sdk.ClientSideConnection(() => new AcpClientImpl(this.spec, queues, permissionHandlers, readOnlySessions), stream);
    const init = await withTimeout(conn.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: 'DERO Hive', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        session: { configOptions: { boolean: {} } }
      }
    }), 30_000, `ACP initialize timed out. Is ${this.spec.bareCommand} running?`);

    return { proc, conn, init, queues, permissionHandlers, readOnlySessions, sessions: new Map(), authenticationAttempt: null };
  }

  private getRuntime(): Promise<Runtime> {
    if (this.disposed) return Promise.reject(new Error(`${this.spec.displayName} provider has been disposed`));
    if (!this.runtimePromise) {
      this.runtimePromise = this.createRuntime().catch((error) => {
        this.runtimePromise = null;
        throw error;
      });
    }
    return this.runtimePromise;
  }

  private async authenticate(runtime: Runtime): Promise<void> {
    // Concurrent first messages must share one login flow rather than each
    // opening their own browser or command window.
    if (runtime.authenticationAttempt) return runtime.authenticationAttempt;
    runtime.authenticationAttempt = this.authenticateOnce(runtime)
      .finally(() => { runtime.authenticationAttempt = null; });
    return runtime.authenticationAttempt;
  }

  private async authenticateOnce(runtime: Runtime): Promise<void> {
    const methods = runtime.init.authMethods || [];
    const method = methods.find((item) => this.spec.authMethodPattern.test(`${item.id} ${item.name}`))
      || (this.spec.authFallbackToFirst ? methods[0] : undefined);
    if (!method) throw new Error(this.spec.authMissingError);
    logger.info(this.spec.logTag, `starting ${this.spec.displayName} authentication (${method.id})`);
    await withTimeout(runtime.conn.authenticate({ methodId: method.id }), 180_000, `${this.spec.displayName} authentication timed out.`);
  }

  private async newSession(runtime: Runtime, cwd: string): Promise<acp.NewSessionResponse> {
    try {
      return await runtime.conn.newSession({ cwd, mcpServers: [] });
    } catch (firstError) {
      const { message, details } = extractAcpError(firstError);
      if (!/auth|login|sign.?in|unauth/i.test(`${message} ${details || ''}`)) throw firstError;
      await this.authenticate(runtime);
      return runtime.conn.newSession({ cwd, mcpServers: [] });
    }
  }

  private async configureSession(
    runtime: Runtime,
    session: SessionState,
    model: string,
    effort?: string
  ): Promise<SessionConfigOption[]> {
    let options: SessionConfigOption[] = [];
    if (model && session.model !== model) {
      const response = await runtime.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: 'model', value: model });
      options = response.configOptions || [];
      session.model = model;
    }
    if (effort) {
      const reasoningOption = findSelectOption(options, 'thought_level', 'reasoning_effort');
      const supported = flattenSelectOptions(reasoningOption).some((item) => item.value === effort);
      if (!supported && options.length > 0) throw new Error(`${effort} reasoning is not supported by ${model}`);
      const response = await runtime.conn.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: reasoningOption?.id || 'reasoning_effort',
        value: effort
      });
      options = response.configOptions || options;
    }
    return options;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; models?: string[]; modelDetails?: Record<string, Partial<ProviderModel>>; hint?: string }> {
    let sessionId: string | undefined;
    try {
      const runtime = await this.getRuntime();
      const response = await withTimeout(this.newSession(runtime, getWorkspaceRoot()), 180_000, `${this.spec.displayName} sign-in or session creation timed out.`);
      sessionId = response.sessionId;
      const modelOption = findSelectOption(response.configOptions, 'model', 'model');
      let models = flattenSelectOptions(modelOption).map((item) => item.value);
      const details: Record<string, Partial<ProviderModel>> = {};
      const state: SessionState = { sessionId, model: '', bootstrapped: false, cwd: getWorkspaceRoot() };

      for (const model of models) {
        try {
          const options = await this.configureSession(runtime, state, model);
          const thinkingOptions = thinkingOptionsFromConfig(options);
          details[model] = { supportsReasoning: thinkingOptions.length > 0, thinkingOptions };
        } catch (configError) {
          if (!this.spec.lenientConfig) throw configError;
          details[model] = {};
        }
      }
      if (models.length === 0) {
        if (!this.spec.fallbackModels?.length) throw new Error(`No models were reported by ${this.spec.displayName} ACP.`);
        // Agent runs on the account default and switches by alias; the session
        // itself worked, which is what this test is for.
        models = this.spec.fallbackModels;
      }
      return { ok: true, models, modelDetails: details };
    } catch (error) {
      const { message, details } = extractAcpError(error);
      logger.error(this.spec.logTag, `connection test failed: ${message}${details ? ` - ${details}` : ''}`);
      return {
        ok: false,
        error: details || message,
        hint: this.spec.authHint
      };
    } finally {
      if (sessionId) {
        try { await (await this.getRuntime()).conn.closeSession({ sessionId }); } catch { /* best effort */ }
      }
    }
  }

  async *stream(req: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    const runtime = await this.getRuntime();
    const requestedCwd = resolve(req.cwd || getWorkspaceRoot());
    let session = runtime.sessions.get(req.conversationId);
    if (session && resolve(session.cwd) !== requestedCwd) {
      try { await runtime.conn.closeSession({ sessionId: session.sessionId }); } catch { /* recreate below */ }
      runtime.sessions.delete(req.conversationId);
      runtime.queues.delete(session.sessionId);
      runtime.permissionHandlers.delete(session.sessionId);
      runtime.readOnlySessions.delete(session.sessionId);
      session = undefined;
    }
    if (!session) {
      const created = await this.newSession(runtime, requestedCwd);
      session = { sessionId: created.sessionId, model: '', bootstrapped: false, cwd: requestedCwd };
      runtime.sessions.set(req.conversationId, session);
    }

    try {
      await this.configureSession(runtime, session, req.model, req.reasoning?.effort);
    } catch (configError) {
      // Lenient agents (Claude Code) may not expose model/effort switches;
      // the session still runs on the account default.
      if (!this.spec.lenientConfig) throw configError;
      logger.debug(this.spec.logTag, `session config skipped: ${extractAcpError(configError).message}`);
    }
    if (req.planMode) runtime.readOnlySessions.add(session.sessionId);
    else runtime.readOnlySessions.delete(session.sessionId);
    const queue = new AsyncQueue<AcpEvent>();
    runtime.queues.set(session.sessionId, queue);
    if (req.requestPermission) runtime.permissionHandlers.set(session.sessionId, req.requestPermission);

    const messages = session.bootstrapped ? req.messages.slice(-1) : req.messages;
    const prompt = contentBlocksFromMessages(messages, session.bootstrapped ? undefined : req.systemPrompt);
    for (const attachment of req.attachments || []) {
      if (attachment.type === 'image') prompt.push({ type: 'image', data: attachment.data, mimeType: attachment.mimeType });
      else if (/^(text\/|application\/(json|javascript|xml))/u.test(attachment.mimeType)) {
        prompt.push({
          type: 'resource',
          resource: {
            uri: `hive-attachment:///${encodeURIComponent(attachment.filename)}`,
            mimeType: attachment.mimeType,
            text: Buffer.from(attachment.data, 'base64').toString('utf8')
          }
        });
      } else {
        prompt.push({
          type: 'resource',
          resource: { uri: `hive-attachment:///${encodeURIComponent(attachment.filename)}`, mimeType: attachment.mimeType, blob: attachment.data }
        });
      }
    }

    const onAbort = (): void => { void runtime.conn.cancel({ sessionId: session!.sessionId }); };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    const promptPromise = runtime.conn.prompt({ sessionId: session.sessionId, prompt })
      .then(() => queue.push({ type: 'done' }))
      .catch((error) => queue.push({ type: 'error', error: extractAcpError(error).details || extractAcpError(error).message }));

    try {
      while (true) {
        const event = await queue.next();
        yield event;
        if (event.type === 'done' || event.type === 'error') break;
      }
      await promptPromise;
      session.bootstrapped = true;
    } finally {
      req.signal?.removeEventListener('abort', onAbort);
      runtime.queues.delete(session.sessionId);
      runtime.permissionHandlers.delete(session.sessionId);
    }
  }

  async closeConversation(conversationId: string): Promise<void> {
    const runtime = await this.runtimePromise?.catch(() => null);
    const session = runtime?.sessions.get(conversationId);
    if (!runtime || !session) return;
    runtime.sessions.delete(conversationId);
    runtime.queues.delete(session.sessionId);
    runtime.permissionHandlers.delete(session.sessionId);
    runtime.readOnlySessions.delete(session.sessionId);
    try { await runtime.conn.closeSession({ sessionId: session.sessionId }); }
    catch (error) { logger.debug(this.spec.logTag, `close session failed: ${String(error)}`); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const runtime = await this.runtimePromise?.catch(() => null);
    if (!runtime) return;
    for (const session of runtime.sessions.values()) {
      try { await runtime.conn.closeSession({ sessionId: session.sessionId }); } catch { /* best effort */ }
    }
    try { runtime.proc.kill(); } catch { /* best effort */ }
    this.runtimePromise = null;
  }
}

export class CodexAcpAdapter extends AcpAdapter {
  constructor(cfg: ProviderConfig) {
    super(cfg, CODEX_SPEC);
  }
}

export class ClaudeAcpAdapter extends AcpAdapter {
  constructor(cfg: ProviderConfig) {
    super(cfg, CLAUDE_SPEC);
  }
}
