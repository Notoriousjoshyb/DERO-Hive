import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamEvent } from './base';
import type { Message, ProviderConfig, ProviderModel, ThinkingOption } from '@shared/types';
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
}

interface SessionState {
  sessionId: string;
  model: string;
  bootstrapped: boolean;
}

interface Runtime {
  proc: ChildProcessWithoutNullStreams;
  conn: acp.ClientSideConnection;
  init: InitializeResponse;
  queues: Map<string, AsyncQueue<AcpEvent>>;
  permissionHandlers: Map<string, (request: { requestId: string; toolName: string; args: Record<string, unknown>; description?: string }) => Promise<boolean>>;
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

function defaultCodexAcpPath(): string {
  const candidates = [
    join(process.resourcesPath || '', 'app.asar.unpacked/node_modules/@agentclientprotocol/codex-acp/dist/index.js'),
    join(process.cwd(), 'node_modules/@agentclientprotocol/codex-acp/dist/index.js'),
    join(__dirname, '../../../node_modules/@agentclientprotocol/codex-acp/dist/index.js'),
    join(__dirname, '../../node_modules/@agentclientprotocol/codex-acp/dist/index.js'),
    'codex-acp'
  ];
  return candidates.find((candidate) => candidate === 'codex-acp' || existsSync(candidate)) || candidates[0];
}

function bundledCodexPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
  const candidates = [
    join(process.resourcesPath || '', `app.asar.unpacked/node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`),
    join(process.cwd(), `node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`),
    join(__dirname, `../../node_modules/@openai/${packageName}/vendor/${target}/bin/codex.exe`)
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

function contentBlocksFromMessages(messages: Message[], systemPrompt?: string): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  if (systemPrompt) blocks.push({ type: 'text', text: systemPrompt });
  for (const message of messages) {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    blocks.push({ type: 'text', text: `[${message.role}]: ${text}` });
  }
  return blocks;
}

/** Routes ACP notifications to the queue for the session that produced them. */
class CodexAcpClient implements Client {
  constructor(
    private readonly queues: Map<string, AsyncQueue<AcpEvent>>,
    private readonly permissionHandlers: Runtime['permissionHandlers']
  ) {}

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const handler = this.permissionHandlers.get(params.sessionId);
    if (!handler) return { outcome: { outcome: 'cancelled' } };

    const rawInput = params.toolCall.rawInput;
    const args = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : { input: rawInput ?? null };
    const allowed = await handler({
      requestId: `codex-${randomUUID()}`,
      toolName: params.toolCall.title || params.toolCall.kind || 'Codex tool',
      args,
      description: 'Codex needs permission to perform this action.'
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
    }
    // tool_call notifications describe work Codex is already executing. They
    // are not function-call requests for Hive's outer tool loop.
  }

  readTextFile(params: acp.ReadTextFileRequest): acp.ReadTextFileResponse {
    try { return { content: readFileSync(resolveWithinAllowed(params.path), 'utf-8') }; }
    catch { return { content: '' }; }
  }

  writeTextFile(params: acp.WriteTextFileRequest): acp.WriteTextFileResponse | void {
    try {
      const path = resolveWithinAllowed(params.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, params.content, 'utf-8');
    } catch (error) {
      logger.warn('codex-acp', `write failed: ${String(error)}`);
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

export class CodexAcpAdapter implements ProviderAdapter {
  readonly id: string;
  private runtimePromise: Promise<Runtime> | null = null;
  private disposed = false;

  constructor(private readonly cfg: ProviderConfig) {
    this.id = cfg.id;
  }

  private async createRuntime(): Promise<Runtime> {
    const sdk = await loadAcp();
    const commandPath = this.cfg.customHeaders?.commandPath || defaultCodexAcpPath();
    const isJs = commandPath.endsWith('.js');
    const command = isJs ? process.execPath : commandPath;
    const args = isJs ? [commandPath] : commandPath === 'npx' ? ['-y', '@agentclientprotocol/codex-acp'] : [];

    logger.info('codex-acp', `starting persistent adapter: ${command} ${args.join(' ')}`);
    const codexPath = bundledCodexPath();
    const proc = spawn(command, args, {
      env: {
        ...process.env,
        ...(isJs ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...(this.cfg.customHeaders?.noBrowser === '1' ? { NO_BROWSER: '1' } : {}),
        ...(codexPath ? { CODEX_PATH: codexPath } : {})
      },
      windowsHide: true
    });
    const queues = new Map<string, AsyncQueue<AcpEvent>>();
    const permissionHandlers = new Map<string, Runtime['permissionHandlers'] extends Map<string, infer T> ? T : never>();
    proc.stderr.on('data', (data: Buffer) => logger.debug('codex-acp', data.toString().trim()));
    proc.on('error', (error) => logger.error('codex-acp', `process error: ${error.message}`));
    proc.on('exit', (code) => {
      logger.info('codex-acp', `process exited (${code ?? 'signal'})`);
      for (const queue of queues.values()) queue.push({ type: 'error', error: 'Codex ACP process exited unexpectedly.' });
      this.runtimePromise = null;
    });

    const stream = sdk.ndJsonStream(
      Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
    );
    const conn = new sdk.ClientSideConnection(() => new CodexAcpClient(queues, permissionHandlers), stream);
    const init = await withTimeout(conn.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: 'DERO Hive', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        session: { configOptions: { boolean: {} } }
      }
    }), 30_000, 'ACP initialize timed out. Is codex-acp running?');

    return { proc, conn, init, queues, permissionHandlers, sessions: new Map(), authenticationAttempt: null };
  }

  private getRuntime(): Promise<Runtime> {
    if (this.disposed) return Promise.reject(new Error('Codex provider has been disposed'));
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
    const method = methods.find((item) => /chatgpt|chat-gpt/i.test(`${item.id} ${item.name}`));
    if (!method) throw new Error('Codex ACP did not advertise ChatGPT authentication. Ensure NO_BROWSER is not enabled.');
    logger.info('codex-acp', `starting ChatGPT authentication (${method.id})`);
    await withTimeout(runtime.conn.authenticate({ methodId: method.id }), 180_000, 'ChatGPT authentication timed out.');
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
      const response = await withTimeout(this.newSession(runtime, getWorkspaceRoot()), 180_000, 'Codex sign-in or session creation timed out.');
      sessionId = response.sessionId;
      const modelOption = findSelectOption(response.configOptions, 'model', 'model');
      const models = flattenSelectOptions(modelOption).map((item) => item.value);
      const details: Record<string, Partial<ProviderModel>> = {};
      const state: SessionState = { sessionId, model: '', bootstrapped: false };

      for (const model of models) {
        const options = await this.configureSession(runtime, state, model);
        const thinkingOptions = thinkingOptionsFromConfig(options);
        details[model] = { supportsReasoning: thinkingOptions.length > 0, thinkingOptions };
      }
      if (models.length === 0) throw new Error('No models were reported by Codex ACP.');
      return { ok: true, models, modelDetails: details };
    } catch (error) {
      const { message, details } = extractAcpError(error);
      logger.error('codex-acp', `connection test failed: ${message}${details ? ` - ${details}` : ''}`);
      return {
        ok: false,
        error: details || message,
        hint: 'Make sure ChatGPT Codex access is enabled for the account, then try Models again.'
      };
    } finally {
      if (sessionId) {
        try { await (await this.getRuntime()).conn.closeSession({ sessionId }); } catch { /* best effort */ }
      }
    }
  }

  async *stream(req: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    const runtime = await this.getRuntime();
    let session = runtime.sessions.get(req.conversationId);
    if (!session) {
      const created = await this.newSession(runtime, req.cwd || getWorkspaceRoot());
      session = { sessionId: created.sessionId, model: '', bootstrapped: false };
      runtime.sessions.set(req.conversationId, session);
    }

    await this.configureSession(runtime, session, req.model, req.reasoning?.effort);
    const queue = new AsyncQueue<AcpEvent>();
    runtime.queues.set(session.sessionId, queue);
    if (req.requestPermission) runtime.permissionHandlers.set(session.sessionId, req.requestPermission);

    const messages = session.bootstrapped ? req.messages.slice(-1) : req.messages;
    const prompt = contentBlocksFromMessages(messages, session.bootstrapped ? undefined : req.systemPrompt);
    for (const attachment of req.attachments || []) {
      if (attachment.type === 'image') prompt.push({ type: 'image', data: attachment.data, mimeType: attachment.mimeType });
      else prompt.push({ type: 'resource', resource: { uri: `file://${attachment.filename}`, mimeType: attachment.mimeType, text: attachment.data } });
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
    try { await runtime.conn.closeSession({ sessionId: session.sessionId }); }
    catch (error) { logger.debug('codex-acp', `close session failed: ${String(error)}`); }
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
