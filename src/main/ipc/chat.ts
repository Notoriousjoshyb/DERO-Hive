import { ipcMain, BrowserWindow, Notification } from 'electron';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { IPC, normalizeProjectConfig, type AppSettings, type ChatRequest, type StreamEvent, type Message, type ProviderConfig, type ProviderFallback, type ProviderModel } from '@shared/types';
import { logger } from '../utils/logger';
import { getAdapter, listProviders } from '../providers/registry';
import type { ProviderStreamEvent } from '../providers/base';
import { ToolRegistry } from '../tools/registry';
import { McpManager } from '../mcp/manager';
import { getDb } from '../db/client';
import { getSetting } from '../db/client';
import { getDefaultWorkspace } from '../utils/paths';
import { truncateMessagesForContext } from '../utils/tokenBudget';
import { composeSystemPrompt } from '../utils/systemPrompt';
import { hydrateAttachmentRefs, validateAttachmentRefs } from '../utils/attachments';
import { resolveAgent } from '@shared/agents';

const activeRequests = new Map<string, AbortController>();
const queuedUserMessages = new Map<string, Message[]>();
const streamObservers = new Set<(event: StreamEvent) => void>();
const MAX_STREAM_RETRIES = 2;
const STREAM_RETRY_BASE_DELAY_MS = 800;

// Used by the loopback Browser Companion bridge. Observers only receive the
// same normalized stream events already sent to the renderer.
export function onChatStreamEvent(observer: (event: StreamEvent) => void): () => void {
  streamObservers.add(observer);
  return () => streamObservers.delete(observer);
}

// Retry a streaming adapter if it fails before producing any events. This
// smooths over transient network blips without duplicating partial content.
async function* streamWithRetry<T>(
  makeStream: () => AsyncIterable<T>,
  signal: AbortSignal,
  maxRetries = MAX_STREAM_RETRIES,
  baseDelayMs = STREAM_RETRY_BASE_DELAY_MS,
  retryAllowed: () => boolean = () => true
): AsyncGenerator<T> {
  let attempt = 0;
  while (true) {
    if (signal.aborted) return;
    let produced = false;
    try {
      for await (const evt of makeStream()) {
        produced = true;
        yield evt;
      }
      return;
    } catch (err) {
      if (signal.aborted) throw err;
      if (produced || !retryAllowed() || attempt >= maxRetries) throw err;
      attempt++;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
}

export interface ProviderChainResolution {
  targets: Array<ProviderFallback & { modelDef: ProviderModel }>;
  unavailable: string[];
}

export function resolveProviderChain(
  primary: ProviderFallback,
  fallbackValue: unknown,
  providers: readonly ProviderConfig[]
): ProviderChainResolution {
  const refs: ProviderFallback[] = [primary];
  if (Array.isArray(fallbackValue)) {
    for (const value of fallbackValue) {
      if (!value || typeof value !== 'object') continue;
      const providerId = (value as { providerId?: unknown }).providerId;
      const model = (value as { model?: unknown }).model;
      if (typeof providerId === 'string' && typeof model === 'string') refs.push({ providerId, model });
    }
  }

  const available = new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const targets: ProviderChainResolution['targets'] = [];
  const unavailable: string[] = [];
  for (const ref of refs) {
    const providerId = ref.providerId.trim();
    const model = ref.model.trim();
    const key = `${providerId}\0${model}`;
    if (!providerId || !model || seen.has(key)) continue;
    seen.add(key);
    const provider = available.get(providerId);
    if (!provider) {
      unavailable.push(`Provider "${providerId}" is not configured or enabled.`);
      continue;
    }
    const modelDef = provider.models.find((item) => item.id === model);
    if (!modelDef) {
      unavailable.push(`Model "${model}" is not configured for provider "${provider.name}".`);
      continue;
    }
    targets.push({ providerId, model, modelDef });
  }
  return { targets, unavailable };
}

function commitsProviderOutput(event: ProviderStreamEvent): boolean {
  return (event.type === 'delta' && Boolean(event.content))
    || (event.type === 'reasoning' && Boolean(event.reasoning))
    || (event.type === 'tool_calls' && Boolean(event.toolCalls?.length))
    || event.type === 'usage';
}

export async function* streamWithFallback<T extends ProviderFallback>(
  targets: readonly T[],
  makeStream: (target: T) => AsyncIterable<ProviderStreamEvent>,
  signal: AbortSignal,
  fallbackAllowed: () => boolean = () => true,
  retryAllowed: () => boolean = () => true,
  maxRetries = MAX_STREAM_RETRIES,
  baseDelayMs = STREAM_RETRY_BASE_DELAY_MS
): AsyncGenerator<{ target: T; event: ProviderStreamEvent }> {
  const failures: string[] = [];
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    let committed = false;
    try {
      for await (const event of streamWithRetry(
        () => makeStream(target), signal, maxRetries, baseDelayMs, retryAllowed
      )) {
        if (commitsProviderOutput(event)) committed = true;
        if (event.type === 'error') throw new Error(event.error || 'Provider stream failed');
        yield { target, event };
      }
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      failures.push(`${target.providerId}/${target.model}: ${error instanceof Error ? error.message : String(error)}`);
      const hasNext = index + 1 < targets.length;
      if (committed || !fallbackAllowed() || !hasNext) {
        if (!committed && fallbackAllowed() && failures.length > 1) {
          throw new Error(`Provider fallback chain exhausted: ${failures.join(' | ')}`, { cause: error });
        }
        throw error;
      }
    }
  }
}

// Native OS notification when a response finishes or fails while the window is
// in the background. Toggleable in Settings → General; best-effort only.
function notifyStreamOutcome(win: BrowserWindow | null, kind: 'done' | 'error', text: string): void {
  try {
    const appSettings = getSetting<{ desktopNotifications?: boolean }>('appSettings');
    if (appSettings?.desktopNotifications === false) return;
    if (!win || win.isDestroyed() || win.isFocused()) return;
    if (!Notification.isSupported()) return;
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    const n = new Notification({
      title: kind === 'error' ? 'DERO Hive — response failed' : 'DERO Hive — response ready',
      body: preview || (kind === 'error' ? 'Something went wrong.' : 'The assistant finished responding.')
    });
    n.on('click', () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.show();
  } catch { /* notifications are best-effort */ }
}

// Build a concise project snapshot: git status and a shallow file tree. This
// is appended to the system prompt so the assistant has current project context.
function buildProjectSnapshot(cwd: string): string {
  const parts: string[] = [];
  parts.push(`Project directory: ${cwd}`);

  if (existsSync(`${cwd}/.git`)) {
    try {
      const status = execSync('git status --short', { cwd, encoding: 'utf-8', timeout: 3000 });
      if (status.trim()) {
        parts.push('Git status (changed files):\n' + status.trim().split('\n').slice(0, 30).join('\n'));
      } else {
        parts.push('Git status: clean');
      }
    } catch {
      parts.push('Git status: unavailable');
    }
  }

  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const tree: string[] = [];
    for (const e of entries.slice(0, 40)) {
      const prefix = e.isDirectory() ? '📁' : '📄';
      tree.push(`${prefix} ${e.name}`);
    }
    if (tree.length) parts.push('File structure:\n' + tree.join('\n'));
  } catch {
    /* ignore unreadable directories */
  }

  return parts.join('\n\n');
}

export function registerChatHandlers(getWin: () => BrowserWindow | null, mcpManager: McpManager | null): void {
  const tools = new ToolRegistry(mcpManager);

  // Bridge permission requests from tools to renderer
  tools.on('request', (req) => {
    getWin()?.webContents.send(IPC.TOOL_PERMISSION_REQUEST, req);
  });

  ipcMain.handle(IPC.TOOL_PERMISSION_DECIDE, (_e, { requestId, decision }) => {
    tools.decidePermission(requestId, decision === 'allow' ? 'allow' : 'deny');
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_ABORT, (_e, conversationId: string) => {
    const c = activeRequests.get(conversationId);
    if (c) { c.abort(); activeRequests.delete(conversationId); }
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_QUEUE_MESSAGE, async (_e, conversationId: string, message: Message) => {
    await validateAttachmentRefs(message.content, 20 * 1024 * 1024, 25 * 1024 * 1024);
    const q = queuedUserMessages.get(conversationId) || [];
    q.push(message);
    queuedUserMessages.set(conversationId, q);
  });

  ipcMain.handle(IPC.CHAT_SEND, async (_e, req: ChatRequest) => {
    return runChat(req, getWin, tools);
  });
}

async function runChat(
  req: ChatRequest,
  getWin: () => BrowserWindow | null,
  tools: ToolRegistry
): Promise<{ messageId: string }> {
  const abort = new AbortController();
  const messageId = randomUUID();

  // Persist user message immediately
  const userMsg = req.messages[req.messages.length - 1];
  if (userMsg?.role === 'user') {
    await validateAttachmentRefs(userMsg.content, 20 * 1024 * 1024, 25 * 1024 * 1024);
  }
  if (userMsg && userMsg.role === 'user' && shouldPersistUserMessage(req.conversationId, userMsg.id)) {
    persistMessage(req.conversationId, userMsg);
    updateConversationPreview(req.conversationId, userMsg);
  }
  activeRequests.set(req.conversationId, abort);
  // Clear any stale queued messages from a previous run.
  queuedUserMessages.delete(req.conversationId);

  const win = getWin();
  const send = (evt: StreamEvent): void => {
    win?.webContents.send(IPC.CHAT_STREAM, evt);
    for (const observer of streamObservers) observer(evt);
  };

  // Run async without blocking the invoke response
  (async () => {
    try {
      const appSettings = getSetting<Partial<AppSettings>>('appSettings');
      const resolution = resolveProviderChain(
        { providerId: req.providerId, model: req.model },
        appSettings?.providerFallbackChain,
        listProviders()
      );
      const providerTargets = resolution.targets.flatMap((target) => {
        const adapter = getAdapter(target.providerId);
        if (adapter) return [{ ...target, adapter }];
        resolution.unavailable.push(`Provider "${target.providerId}" could not be loaded.`);
        return [];
      });
      if (resolution.unavailable.length) logger.warn('chat', resolution.unavailable.join(' '));
      if (providerTargets.length === 0) {
        const error = resolution.unavailable.join(' ') || 'No configured provider/model is available.';
        send({ type: 'error', conversationId: req.conversationId, messageId, error });
        send({ type: 'done', conversationId: req.conversationId, messageId });
        return;
      }

      send({ type: 'start', conversationId: req.conversationId, messageId });

      // Resolve working directory: project path > global setting > the app's
      // default workspace (Documents\DERO Hive) — never the app's own folder.
      const conv = getDb().prepare('SELECT project_id, system_prompt FROM conversations WHERE id = ?').get(req.conversationId) as { project_id?: string; system_prompt?: string } | undefined;
      let projectPath: string | undefined;
      let projectMcpServerIds: ReadonlySet<string> | undefined;
      if (conv?.project_id) {
        const proj = getDb().prepare('SELECT path, config FROM projects WHERE id = ?').get(conv.project_id) as { path?: string; config?: string } | undefined;
        projectPath = proj?.path;
        if (proj?.config) {
          try {
            const config = normalizeProjectConfig(JSON.parse(proj.config));
            if (config.mcpServerIds !== undefined) projectMcpServerIds = new Set(config.mcpServerIds);
          } catch (error) {
            projectMcpServerIds = new Set();
            logger.warn('chat', `invalid project MCP profile; MCP tools disabled: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      const cwd = projectPath || getSetting<string>('workingDirectory') || getDefaultWorkspace();
      if (projectPath) {
        logger.info('chat', `using project cwd: ${projectPath}`);
      }

      // The built-in core is immutable. Agent instructions are resolved from
      // main-process settings; the renderer supplies only an id.
      const corePrompt = composeSystemPrompt({
        appInstructions: getSetting<string>('defaultSystemPrompt', ''),
        conversationInstructions: conv?.system_prompt,
        projectPath,
        planMode: req.planMode
      });
      const customAgents = appSettings?.customAgents;
      const agentPrompt = resolveAgent(req.agentId, customAgents)?.prompt.trim();
      const additiveLayers = agentPrompt ? [agentPrompt] : [];
      if (projectPath) additiveLayers.push(buildProjectSnapshot(projectPath));
      const systemPrompt = [corePrompt, ...additiveLayers].join('\n\n');
      let messages = req.messages;

      let activeTargets = providerTargets;
      let modelDef: ProviderModel | null = activeTargets[0].modelDef;

      // Block vision if the model doesn't support it
      const hasImage = messages.some((message) => Array.isArray(message.content) && message.content.some((part) =>
        'image_url' in part || (part.type === 'attachment_ref' && part.attachment.type === 'image')
      ));
      if (hasImage) {
        activeTargets = activeTargets.filter((target) => target.modelDef.supportsVision);
        if (activeTargets.length === 0) {
          send({ type: 'error', conversationId: req.conversationId, messageId, error: 'No configured model in the provider fallback chain supports image input.' });
          send({ type: 'done', conversationId: req.conversationId, messageId });
          return;
        }
        modelDef = activeTargets[0].modelDef;
      }

      // ---- OpenChamber-style AUTO COMPACTION ----
      // Estimate context pressure before sending. If over threshold (default 85%),
      // run compaction once automatically before the LLM call.
      const AUTO_COMPACT_THRESHOLD = 0.85;
      const contextWindow = modelDef?.contextWindow || 128_000;
      const MAX_OUTPUT_RESERVE = 4096;
      const effectiveLimit = Math.max(contextWindow - MAX_OUTPUT_RESERVE, 1024);

      function estimateCurrentTokens(msgs: typeof messages): number {
        // Prefer the most recent assistant turn's prompt_tokens (ground truth from API).
        // This is what we actually sent; summing per-message estimates double-counts
        // since every prior message is already inside each prompt_tokens value.
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === 'assistant' && m.usage?.promptTokens) {
            return m.usage.promptTokens;
          }
        }
        // No usage data yet — estimate from system + sum of message sizes (4 chars/token).
        let total = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
        for (const m of msgs) {
          if (m.role === 'assistant' && m.usage) continue; // already excluded above
          let chars = 0;
          if (typeof m.content === 'string') chars = m.content.length;
          else if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if ('text' in p && typeof p.text === 'string') chars += p.text.length;
              else if ('image_url' in p) chars += 170;
              else if ('input_audio' in p) chars += 200;
              else if ('file' in p && typeof p.file.data === 'string') chars += p.file.data.length / 2;
            }
          }
          if (m.reasoning) chars += m.reasoning.length;
          if (m.name) chars += m.name.length;
          total += Math.ceil(chars / 4);
        }
        return total;
      }

      const initialTokens = estimateCurrentTokens(messages);
      const initialPercent = initialTokens / effectiveLimit;

      if (initialPercent >= AUTO_COMPACT_THRESHOLD && messages.length > 8) {
        logger.info('chat', `auto-compacting conversation ${req.conversationId} (${Math.round(initialPercent * 100)}% of ${effectiveLimit} tokens)`);
        try {
          const compactResult = await compactConversationInPlace(req.conversationId);
          if (compactResult.removedCount > 0) {
            // Reload the message list from DB
            const freshMessages = getDb().prepare(
              'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC'
            ).all(req.conversationId) as Array<Record<string, unknown>>;
            messages = freshMessages.map(rowToMessage);

            // Notify renderer (so it can show CompactionToast + update UI)
            BrowserWindow.getAllWindows().forEach((w) => {
              w.webContents.send(IPC.CONV_COMPACTED, {
                conversationId: req.conversationId,
                removedCount: compactResult.removedCount,
                tokensSaved: compactResult.tokensSaved,
                beforeTokens: compactResult.beforeTokens,
                afterTokens: compactResult.afterTokens
              });
            });

            logger.info('chat', `auto-compaction complete: ${compactResult.removedCount} messages → ${compactResult.afterTokens} tokens`);
          }
        } catch (err) {
          logger.warn('chat', 'auto-compaction failed', err);
        }
      }

      let currentMessages = messages;

      // Multi-turn agentic loop. Each round lets the model inspect its tool
      // results and decide the next action. Keep it bounded so a mistaken or
      // repetitive plan cannot run indefinitely.
      const availableTools = tools.listTools(projectMcpServerIds);
      const configuredRounds = appSettings?.maxAgenticRounds ?? 20;
      const maxAgenticRounds = Number.isFinite(configuredRounds)
        ? Math.min(50, Math.max(1, Math.floor(configuredRounds)))
        : 20;

      let lastTurnId = messageId;
      let selectedTarget = activeTargets[0];
      let fallbackAllowed = true;
      for (let round = 0; round < maxAgenticRounds; round++) {
        const turnId = round === 0 ? messageId : randomUUID();
        lastTurnId = turnId;
        if (round > 0) send({ type: 'start', conversationId: req.conversationId, messageId: turnId });

        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let assistantContent = '';
        let assistantReasoning = '';
        const roundUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const preparedTargets = await Promise.all(activeTargets.map(async (target) => ({
          ...target,
          providerMessages: await hydrateAttachmentRefs(
            truncateMessagesForContext(currentMessages, target.modelDef, systemPrompt)
          )
        })));
        let sideEffectOccurred = false;
        try {
          for await (const { event: evt } of streamWithFallback(
            preparedTargets,
            (target) => {
              if (selectedTarget.providerId !== target.providerId || selectedTarget.model !== target.model) {
                logger.info('chat', `falling back to ${target.providerId}/${target.model}`);
              }
              selectedTarget = target;
              return target.adapter.stream({
                conversationId: req.conversationId,
                cwd,
                model: target.model,
                messages: target.providerMessages,
                tools: availableTools,
                systemPrompt,
                temperature: req.temperature,
                topP: req.topP,
                maxTokens: req.maxTokens,
                reasoning: req.reasoning,
                signal: abort.signal,
                requestPermission: (permission) => {
                  sideEffectOccurred = true;
                  fallbackAllowed = false;
                  return tools.requestPermission(permission, { cwd, conversationId: req.conversationId, mcpServerIds: projectMcpServerIds });
                }
              });
            },
            abort.signal,
            () => fallbackAllowed,
            () => !sideEffectOccurred
          )) {
            if (abort.signal.aborted) break;
            if (commitsProviderOutput(evt)) fallbackAllowed = false;
            if (evt.type === 'delta' && evt.content) {
              assistantContent += evt.content;
              send({ type: 'delta', conversationId: req.conversationId, messageId: turnId, content: evt.content });
            } else if (evt.type === 'reasoning' && evt.reasoning) {
              assistantReasoning += evt.reasoning;
              send({ type: 'delta', conversationId: req.conversationId, messageId: turnId, reasoning: evt.reasoning });
            } else if (evt.type === 'tool_calls' && evt.toolCalls) {
              toolCalls.push(...evt.toolCalls);
              send({ type: 'tool_calls', conversationId: req.conversationId, messageId: turnId, toolCalls: [] });
            } else if (evt.type === 'usage' && evt.usage) {
              roundUsage.promptTokens += evt.usage.promptTokens;
              roundUsage.completionTokens += evt.usage.completionTokens;
              roundUsage.totalTokens += evt.usage.totalTokens;
              send({ type: 'usage', conversationId: req.conversationId, messageId: turnId, usage: evt.usage });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          send({ type: 'error', conversationId: req.conversationId, messageId: turnId, error: errorMessage });
          send({ type: 'done', conversationId: req.conversationId, messageId: turnId });
          notifyStreamOutcome(win, 'error', errorMessage);
          return;
        }
        activeTargets = [selectedTarget];

        // Persist assistant message
        const assistantMsg: Message = {
          id: turnId,
          role: 'assistant',
          content: assistantContent,
          reasoning: assistantReasoning || undefined,
          toolCalls: toolCalls.length ? toolCalls.map((tc) => ({
            id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
          })) : undefined,
          createdAt: Date.now(),
          model: selectedTarget.model,
          provider: selectedTarget.providerId,
          usage: roundUsage.totalTokens > 0 ? { ...roundUsage } : undefined
        };
        persistMessage(req.conversationId, assistantMsg);
        updateConversationTokens(req.conversationId, roundUsage.totalTokens);

        // If aborted mid-stream, keep the partial message but don't execute
        // tools or start another round.
        if (abort.signal.aborted) {
          send({ type: 'done', conversationId: req.conversationId, messageId: turnId });
          return;
        }

        // Check for messages the user queued while the model was streaming. If
        // there are no tool calls and no queued messages, the turn is done. If
        // there are queued messages, we continue the loop so the assistant can
        // respond to them, even if there were no tool calls this round.
        let queued = queuedUserMessages.get(req.conversationId) || [];
        if (toolCalls.length === 0 && queued.length === 0) {
          send({ type: 'done', conversationId: req.conversationId, messageId: turnId });
          notifyStreamOutcome(win, 'done', assistantContent);
          void maybeGenerateTitle(req.conversationId, selectedTarget.providerId, selectedTarget.model);
          return;
        }

        // Execute tools sequentially
        const toolResults: Message[] = [];
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.arguments); } catch { /* leave empty */ }
          const ctx = { cwd, conversationId: req.conversationId, mcpServerIds: projectMcpServerIds };
          const start = Date.now();
          const result = await tools.execute(tc.name, args, ctx);
          const duration = Date.now() - start;

          // Update tool call with result for UI display (via separate event)
          win?.webContents.send('chat:tool-result', {
            messageId: turnId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: result.content,
            isError: !!result.isError,
            durationMs: duration,
            meta: result.meta
          });

          toolResults.push({
            id: randomUUID(),
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: result.content,
            createdAt: Date.now()
          });
        }

        // Persist tool messages
        for (const tr of toolResults) persistMessage(req.conversationId, tr);

        // Check again for messages queued while tools were executing, then
        // persist them and fold them into the conversation for the next round.
        const queuedAfterTools = queuedUserMessages.get(req.conversationId) || [];
        if (queuedAfterTools.length > 0) {
          queuedUserMessages.delete(req.conversationId);
          queued = queuedAfterTools;
          for (const qm of queued) persistMessage(req.conversationId, qm);
        }

        // Continue with the messages + results + queued user messages
        currentMessages = [...currentMessages, assistantMsg, ...toolResults, ...queued];

        // Loop continues — next iteration will call model again with tool results
        // and any queued user messages.
      }

      // The agent reached its configured safety budget. Close the turn that is
      // actually streaming in the renderer, which after round 0 is no longer
      // the original message, and make the stop reason visible to the user.
      const limitMessage = `Agent stopped after ${maxAgenticRounds} tool round${maxAgenticRounds === 1 ? '' : 's'} to prevent an unbounded loop. Increase “Agent tool rounds” in Settings → General to let it continue further.`;
      send({ type: 'error', conversationId: req.conversationId, messageId: lastTurnId, error: limitMessage });
      send({ type: 'done', conversationId: req.conversationId, messageId: lastTurnId });
      notifyStreamOutcome(win, 'error', limitMessage);
    } catch (err) {
      logger.error('chat', 'runChat failed', {
        conversationId: req.conversationId,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        code: (err as { code?: string }).code
      });
      const errMsg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', conversationId: req.conversationId, messageId, error: errMsg });
      send({ type: 'done', conversationId: req.conversationId, messageId });
      notifyStreamOutcome(win, 'error', errMsg);
    } finally {
      activeRequests.delete(req.conversationId);
    }
  })();

  return { messageId };
}

function persistMessage(conversationId: string, msg: Message): void {
  const maxOrder = (getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM messages WHERE conversation_id = ?').get(conversationId) as { m: number }).m;
  getDb().prepare(`
    INSERT INTO messages (id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, name, model, provider, usage, error, created_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id, conversationId, msg.role,
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    msg.reasoning || null,
    msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    msg.toolCallId || null, msg.name || null,
    msg.model || null, msg.provider || null,
    msg.usage ? JSON.stringify(msg.usage) : null,
    msg.error || null,
    msg.createdAt, maxOrder + 1
  );

  // Update FTS index
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  getDb().prepare('INSERT INTO messages_fts (rowid, content, conversation_id, message_id) VALUES ((SELECT rowid FROM messages WHERE id = ?), ?, ?, ?)')
    .run(msg.id, content, conversationId, msg.id);

  // Update message count
  getDb().prepare('UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), conversationId);
}

export interface MessageLookupDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/** Regeneration reuses a persisted user message id; only genuinely new ids are inserted. */
export function shouldPersistUserMessage(
  conversationId: string,
  messageId: string,
  db: MessageLookupDb = getDb() as unknown as MessageLookupDb
): boolean {
  return !db.prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND id = ?').get(conversationId, messageId);
}

function updateConversationPreview(conversationId: string, msg: Message): void {
  const content = typeof msg.content === 'string' ? msg.content : (msg.content.find((p) => p.type === 'text') as { text: string } | undefined)?.text || '';
  getDb().prepare('UPDATE conversations SET preview = ?, updated_at = ? WHERE id = ?')
    .run(content.slice(0, 200), Date.now(), conversationId);
}

function updateConversationTokens(conversationId: string, tokens: number): void {
  getDb().prepare('UPDATE conversations SET total_tokens = total_tokens + ? WHERE id = ?')
    .run(tokens, conversationId);
}

async function maybeGenerateTitle(conversationId: string, providerId: string, model: string): Promise<void> {
  try {
    const conv = getDb().prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined;
    if (!conv) return;
    const isDefault = !conv.title || conv.title === 'New chat' || conv.title === 'New conversation';
    if (!isDefault) return;

    const rows = getDb().prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
      .all(conversationId) as Array<{ role: string; content: string }>;
    const userRow = rows.find((r) => r.role === 'user');
    const assistantRow = rows.find((r) => r.role === 'assistant');
    if (!userRow || !assistantRow) return;

    const adapter = getAdapter(providerId);
    if (!adapter) return;

    let title = '';
    for await (const evt of adapter.stream({
      conversationId,
      model,
      messages: [
        { id: randomUUID(), role: 'user', content: userRow.content, createdAt: Date.now() },
        { id: randomUUID(), role: 'assistant', content: assistantRow.content, createdAt: Date.now() }
      ],
      systemPrompt: 'Create a concise title (3-6 words) for this conversation. Reply with only the title, no quotes or extra text.',
      maxTokens: 20,
      temperature: 0.3
    })) {
      if (evt.type === 'delta' && evt.content) title += evt.content;
      if (evt.type === 'error') break;
    }

    title = title.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').slice(0, 60);
    if (!title) return;
    getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), conversationId);
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send(IPC.CONV_TITLE_GENERATED, { conversationId, title });
    });
  } catch (err) {
    logger.warn('chat', 'title generation failed', err);
  }
}

// Inline auto-compaction: called from chat loop before sending when context
// is over the threshold. Mirrors the logic in conversations.ts IPC handler.
export interface CompactionDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

export async function compactConversationInPlace(
  conversationId: string,
  _providerId = '',
  _model = '',
  db: CompactionDb = getDb() as unknown as CompactionDb
): Promise<{ removedCount: number; beforeTokens: number; afterTokens: number; tokensSaved: number }> {
  void _providerId;
  void _model;
  const config = { keepRecentMessages: 6, truncateToolOutputChars: 4000, maxHistoryMessageChars: 8000 };
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC'
  ).all(conversationId) as Array<Record<string, unknown>>;

  if (messages.length <= config.keepRecentMessages) {
    return { removedCount: 0, beforeTokens: 0, afterTokens: 0, tokensSaved: 0 };
  }

  const beforeTokens = messages.reduce((sum, m) => {
    const t = typeof m.content === 'string' ? m.content.length : 0;
    return sum + Math.ceil(t / 3.7) + ((m.reasoning as string)?.length || 0) / 4;
  }, 0);

  const systemMsgs = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  // A tool result cannot be kept without the assistant turn that requested
  // it; both provider APIs reject that orphaned pair on the next request.
  let split = Math.max(0, nonSystem.length - config.keepRecentMessages);
  while (split > 0 && nonSystem[split]?.role === 'tool') split--;
  const recent = nonSystem.slice(split);
  const older = nonSystem.slice(0, split);

  const userTurns: string[] = [];
  const decisions: string[] = [];
  const files = new Set<string>();
  const errors: string[] = [];
  for (const m of older) {
    const text = typeof m.content === 'string' ? m.content : '';
    if (!text) continue;
    if (m.role === 'user') {
      const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      if (cleaned) userTurns.push(`• ${cleaned}`);
    } else if (m.role === 'assistant' && /^(let me|now i|next,? i|I'll|going to|here's)/i.test(text)) {
      const sent = text.split(/[.!?]\s+/).find((s) => /^(let me|now i|next,? i|I'll|going to|here's)/i.test(s));
      if (sent && sent.length < 250) decisions.push(`• ${sent.trim()}`);
    } else if (m.role === 'tool') {
      const fileMatch = text.match(/(?:^|\s)([A-Z]:[\\\\/][^\s'"<>|]+|\/[\w./-]+|\.\.?\/[\w./-]+)/);
      if (fileMatch) files.add(fileMatch[1]);
      if (m.name === 'run_shell' && /(?:error|fatal|failed|exception)/i.test(text)) {
        errors.push(`• [${m.name}] ${text.slice(0, 200)}`);
      }
    }
  }

  const sections: string[] = ['<context_compaction>', `Compacted ${older.length} older messages.`];
  if (userTurns.length) sections.push('\n## User requests', userTurns.slice(0, 12).join('\n'));
  if (decisions.length) sections.push('\n## Decisions / progress', decisions.slice(0, 12).join('\n'));
  if (files.size) sections.push('\n## Files referenced', Array.from(files).slice(0, 20).map((f) => `• ${f}`).join('\n'));
  if (errors.length) sections.push('\n## Errors observed', errors.slice(0, 5).join('\n'));
  sections.push('</context_compaction>');

  const summaryText = sections.join('\n').slice(0, config.maxHistoryMessageChars * 2);
  const summaryMsgId = randomUUID();
  const summarySortOrder = -1;
  const now = Date.now();

  // Compute post-compaction tokens (BEFORE transaction)
  const afterContents = [
    ...systemMsgs.map((m) => m.content as string),
    summaryText,
    ...recent.map((m) => m.content as string)
  ];
  const afterTokens = afterContents.reduce((sum, c) => sum + Math.ceil((c?.length || 0) / 3.7), 0);
  const tokensSaved = Math.max(0, Math.round(beforeTokens) - Math.round(afterTokens));

  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM messages_fts WHERE conversation_id = ?').run(conversationId);

    const insert = db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, name, model, provider, usage, error, created_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO messages_fts (rowid, content, conversation_id, message_id)
      VALUES (last_insert_rowid(), ?, ?, ?)
    `);

    let i = 0;
    for (const m of systemMsgs) {
      insert.run(
        m.id as string, conversationId, m.role as string, m.content as string,
        m.reasoning as string || null, m.tool_calls as string || null,
        m.tool_call_id as string || null, m.name as string || null,
        m.model as string || null, m.provider as string || null,
        m.usage as string || null, m.error as string || null,
        m.created_at as number, i++
      );
      if (typeof m.content === 'string') insertFts.run(m.content as string, conversationId, m.id as string);
    }

    insert.run(
      summaryMsgId, conversationId, 'system', summaryText,
      null, null, null, null, null, null, null, null,
      now, summarySortOrder
    );
    insertFts.run(summaryText, conversationId, summaryMsgId);

    for (const m of recent) {
      let content = m.content as string;
      if ((m.role === 'tool' || m.role === 'assistant') && content && content.length > config.truncateToolOutputChars) {
        content = content.slice(0, config.truncateToolOutputChars) + `\n... [truncated during compaction]`;
      }
      const newId = randomUUID();
      insert.run(
        newId, conversationId, m.role as string, content,
        m.reasoning as string || null, m.tool_calls as string || null,
        m.tool_call_id as string || null, m.name as string || null,
        m.model as string || null, m.provider as string || null,
        m.usage as string || null, m.error as string || null,
        m.created_at as number || now, i++
      );
      if (typeof content === 'string') insertFts.run(content, conversationId, newId);
    }

    db.prepare(`
      UPDATE conversations
      SET message_count = ?, total_tokens = ?,
          compaction_count = COALESCE(compaction_count, 0) + 1,
          last_compaction_at = ?,
          tokens_saved_by_compaction = COALESCE(tokens_saved_by_compaction, 0) + ?,
          updated_at = ?
      WHERE id = ?
    `).run(systemMsgs.length + 1 + recent.length, Math.round(afterTokens), now, tokensSaved, Date.now(), conversationId);
  })();

  return {
    removedCount: older.length,
    beforeTokens: Math.round(beforeTokens),
    afterTokens: Math.round(afterTokens),
    tokensSaved
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  const content = row.content as string;
  let parsed: string | Message['content'] = content;
  try {
    const j = JSON.parse(content);
    if (Array.isArray(j)) parsed = j;
  } catch { /* keep as string */ }

  let toolCalls: Message['toolCalls'];
  if (row.tool_calls) {
    try { toolCalls = JSON.parse(row.tool_calls as string); } catch { /* ignore */ }
  }
  let usage: Message['usage'];
  if (row.usage) {
    try { usage = JSON.parse(row.usage as string); } catch { /* ignore */ }
  }

  return {
    id: row.id as string,
    role: row.role as Message['role'],
    content: parsed,
    reasoning: row.reasoning as string | undefined,
    toolCalls,
    toolCallId: row.tool_call_id as string | undefined,
    name: row.name as string | undefined,
    model: row.model as string | undefined,
    provider: row.provider as string | undefined,
    usage,
    error: row.error as string | undefined,
    createdAt: row.created_at as number
  };
}
