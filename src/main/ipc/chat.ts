import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type ChatRequest, type StreamEvent, type Message, type ProviderModel } from '@shared/types';
import { DEFAULT_SYSTEM_PROMPT } from '@shared/defaults';
import { logger } from '../utils/logger';
import { getAdapter } from '../providers/registry';
import { ToolRegistry } from '../tools/registry';
import { McpManager } from '../mcp/manager';
import { getDb } from '../db/client';
import { getSetting } from '../db/client';
import { getDefaultWorkspace } from '../utils/paths';
import { truncateMessagesForContext } from '../utils/tokenBudget';

const activeRequests = new Map<string, AbortController>();

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

  ipcMain.handle(IPC.CHAT_SEND, async (_e, req: ChatRequest & { systemPrompt?: string }) => {
    return runChat(req as ChatRequest, getWin, tools);
  });
}

async function runChat(
  req: ChatRequest,
  getWin: () => BrowserWindow | null,
  tools: ToolRegistry
): Promise<{ messageId: string }> {
  const abort = new AbortController();
  activeRequests.set(req.conversationId, abort);
  const messageId = randomUUID();

  // Persist user message immediately
  const userMsg = req.messages[req.messages.length - 1];
  if (userMsg && userMsg.role === 'user') {
    persistMessage(req.conversationId, userMsg);
    updateConversationPreview(req.conversationId, userMsg);
  }

  const win = getWin();
  const send = (evt: StreamEvent): void => {
    win?.webContents.send(IPC.CHAT_STREAM, evt);
  };

  // Run async without blocking the invoke response
  (async () => {
    try {
      const adapter = getAdapter(req.providerId);
      if (!adapter) {
        send({ type: 'error', conversationId: req.conversationId, messageId, error: `Provider ${req.providerId} not configured` });
        send({ type: 'done', conversationId: req.conversationId, messageId });
        return;
      }

      send({ type: 'start', conversationId: req.conversationId, messageId });

      // Resolve working directory: project path > global setting > the app's
      // default workspace (Documents\DERO Hive) — never the app's own folder.
      const conv = getDb().prepare('SELECT project_id FROM conversations WHERE id = ?').get(req.conversationId) as { project_id?: string } | undefined;
      let projectPath: string | undefined;
      if (conv?.project_id) {
        const proj = getDb().prepare('SELECT path FROM projects WHERE id = ?').get(conv.project_id) as { path?: string } | undefined;
        projectPath = proj?.path;
      }
      const cwd = projectPath || getSetting<string>('workingDirectory') || getDefaultWorkspace();
      if (projectPath) {
        logger.info('chat', `using project cwd: ${projectPath}`);
      }

      const baseSystemPrompt = req.systemPrompt || getSetting<string>('defaultSystemPrompt', '') || DEFAULT_SYSTEM_PROMPT;
      const systemPrompt = projectPath
        ? `${baseSystemPrompt}\n\nThe user has selected a project folder: ${projectPath}\nTreat this directory as the working context for file operations, shell commands, and any code-related tasks. When the user refers to "the project" or "the codebase", they mean this folder.`
        : baseSystemPrompt;
      let messages = req.messages;

      // Look up model context window for adaptive truncation
      const providerRow = getDb().prepare('SELECT models FROM providers WHERE id = ?').get(req.providerId) as { models?: string } | undefined;
      let modelDef: ProviderModel | null = null;
      if (providerRow?.models) {
        try {
          const list = JSON.parse(providerRow.models) as ProviderModel[];
          modelDef = list.find((m) => m.id === req.model) || null;
        } catch { /* ignore */ }
      }

      // Block vision if the model doesn't support it
      const modelSupportsVision = modelDef?.supportsVision ?? false;
      if (!modelSupportsVision) {
        for (const m of messages) {
          const parts = Array.isArray(m.content) ? m.content : [];
          for (const p of parts) {
            if ('image_url' in p) {
              send({ type: 'error', conversationId: req.conversationId, messageId, error: `Model "${req.model}" does not support image input. Please switch to a vision-capable model or remove the image attachment.` });
              send({ type: 'done', conversationId: req.conversationId, messageId });
              return;
            }
          }
        }
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

      // Multi-turn tool loop. Up to 20 rounds.
      const availableTools = tools.listTools();

      let lastTurnId = messageId;
      for (let round = 0; round < 20; round++) {
        const turnId = round === 0 ? messageId : randomUUID();
        lastTurnId = turnId;
        if (round > 0) send({ type: 'start', conversationId: req.conversationId, messageId: turnId });

        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let assistantContent = '';
        let assistantReasoning = '';
        const roundUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        for await (const evt of adapter.stream({
          conversationId: req.conversationId,
          cwd,
          model: req.model,
          messages: truncateMessagesForContext(currentMessages, modelDef, systemPrompt),
          tools: availableTools,
          systemPrompt,
          temperature: req.temperature,
          topP: req.topP,
          maxTokens: req.maxTokens,
          reasoning: req.reasoning,
          signal: abort.signal,
          requestPermission: (permission) => tools.requestPermission(permission)
        })) {
          if (abort.signal.aborted) break;
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
          } else if (evt.type === 'error' && evt.error) {
            send({ type: 'error', conversationId: req.conversationId, messageId: turnId, error: evt.error });
            send({ type: 'done', conversationId: req.conversationId, messageId: turnId });
            return;
          }
        }

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
          model: req.model,
          provider: req.providerId,
          usage: roundUsage.totalTokens > 0 ? { ...roundUsage } : undefined
        };
        persistMessage(req.conversationId, assistantMsg);
        updateConversationTokens(req.conversationId, roundUsage.totalTokens);

        // If aborted mid-stream, keep the partial message but don't execute
        // tools or start another round.
        if (abort.signal.aborted || toolCalls.length === 0) {
          send({ type: 'done', conversationId: req.conversationId, messageId: turnId });
          return;
        }

        // Execute tools sequentially
        const toolResults: Message[] = [];
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.arguments); } catch { /* leave empty */ }
          const ctx = { cwd, conversationId: req.conversationId };
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

        // Continue with the messages + results
        currentMessages = [...currentMessages, assistantMsg, ...toolResults];

        // Loop continues — next iteration will call model again with tool results
      }

      // Tool-round budget exhausted. Close the turn that is actually streaming
      // in the renderer, which after round 0 is no longer the original message.
      send({ type: 'done', conversationId: req.conversationId, messageId: lastTurnId });
    } catch (err) {
      logger.error('chat', 'runChat failed', err);
      send({ type: 'error', conversationId: req.conversationId, messageId, error: err instanceof Error ? err.message : String(err) });
      send({ type: 'done', conversationId: req.conversationId, messageId });
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

function updateConversationPreview(conversationId: string, msg: Message): void {
  const content = typeof msg.content === 'string' ? msg.content : (msg.content.find((p) => p.type === 'text') as { text: string } | undefined)?.text || '';
  getDb().prepare('UPDATE conversations SET preview = ?, updated_at = ? WHERE id = ?')
    .run(content.slice(0, 200), Date.now(), conversationId);
}

function updateConversationTokens(conversationId: string, tokens: number): void {
  getDb().prepare('UPDATE conversations SET total_tokens = total_tokens + ? WHERE id = ?')
    .run(tokens, conversationId);
}

// Inline auto-compaction: called from chat loop before sending when context
// is over the threshold. Mirrors the logic in conversations.ts IPC handler.
async function compactConversationInPlace(
  conversationId: string,
): Promise<{ removedCount: number; beforeTokens: number; afterTokens: number; tokensSaved: number }> {
  const config = { keepRecentMessages: 6, truncateToolOutputChars: 4000, maxHistoryMessageChars: 8000 };
  const messages = getDb().prepare(
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
  const recent = nonSystem.slice(-config.keepRecentMessages);
  const older = nonSystem.slice(0, nonSystem.length - config.keepRecentMessages);

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

  const db = getDb();
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
