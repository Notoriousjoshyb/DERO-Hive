import { ipcMain, BrowserWindow } from 'electron';
import { IPC, type Conversation, type Message } from '@shared/types';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client';
import { closeConversationSessions } from '../providers/registry';

export function registerConvHandlers(): void {
  ipcMain.handle(IPC.CONV_LIST, (_e, opts?: { archived?: boolean; projectPath?: string }) => {
    const arch = opts?.archived ? 1 : 0;
    const rows = getDb().prepare(`
      SELECT * FROM conversations WHERE archived = ? ORDER BY pinned DESC, updated_at DESC LIMIT 500
    `).all(arch) as Array<Record<string, unknown>>;
    return rows.map(rowToConv);
  });

  ipcMain.handle(IPC.CONV_GET, (_e, id: string) => {
    const conv = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!conv) return null;
    const messages = getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC').all(id) as Array<Record<string, unknown>>;
    return {
      ...rowToConv(conv),
      messages: messages.map(rowToMsg)
    };
  });

  ipcMain.handle(IPC.CONV_CREATE, (_e, data: Partial<Conversation>) => {
    const id = data.id || randomUUID();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, provider_id, model, system_prompt, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.title || 'New conversation',
      now, now,
      data.providerId || null,
      data.model || null,
      data.systemPrompt || null,
      data.projectId || null
    );
    return { id };
  });

  ipcMain.handle(IPC.CONV_UPDATE, (_e, { id, data }: { id: string; data: Partial<Conversation> }) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      title: 'title', providerId: 'provider_id', model: 'model',
      systemPrompt: 'system_prompt', pinned: 'pinned', archived: 'archived',
      projectId: 'project_id'
    };
    for (const [k, v] of Object.entries(data)) {
      if (k in map) {
        fields.push(`${map[k]} = ?`);
        // undefined means "clear this field" (e.g. detach from a project) —
        // sqlite can't bind undefined, so store NULL.
        values.push(v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb().prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return { ok: true };
  });

  ipcMain.handle(IPC.CONV_DELETE, async (_e, id: string) => {
    await closeConversationSessions(id);
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
    getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    getDb().prepare('DELETE FROM messages_fts WHERE conversation_id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle(IPC.CONV_REVERT, (_e, { conversationId, messageId }: { conversationId: string; messageId: string }) => {
    const messages = getDb().prepare('SELECT id, sort_order FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC').all(conversationId) as Array<{ id: string; sort_order: number }>;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return { ok: false, error: 'message not found' };
    const keepIds = messages.slice(0, idx + 1).map((m) => m.id);
    const placeholders = keepIds.map(() => '?').join(',');
    const db = getDb();
    db.transaction(() => {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (${placeholders})`).run(conversationId, ...keepIds);
      db.prepare('DELETE FROM messages_fts WHERE conversation_id = ? AND message_id NOT IN (' + placeholders + ')').run(conversationId, ...keepIds);
      db.prepare('UPDATE conversations SET updated_at = ?, message_count = ? WHERE id = ?').run(Date.now(), keepIds.length, conversationId);
    })();
    return { ok: true, keptCount: keepIds.length };
  });

  ipcMain.handle(IPC.CONV_FORK, (_e, { conversationId, messageId }: { conversationId: string; messageId?: string }) => {
    const conv = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as Record<string, unknown> | undefined;
    if (!conv) return null;

    const messages = getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC').all(conversationId) as Array<Record<string, unknown>>;

    let startIndex = 0;
    if (messageId) {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx >= 0) startIndex = idx;
    }

    const newConvId = randomUUID();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, provider_id, model, system_prompt, project_id, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newConvId,
      `Fork: ${conv.title}`,
      now, now,
      conv.provider_id,
      conv.model,
      conv.system_prompt,
      conv.project_id,
      conversationId
    );

    const insertMsg = getDb().prepare(`
      INSERT INTO messages (id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, name, model, provider, usage, error, created_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = startIndex; i < messages.length; i++) {
      const m = messages[i];
      insertMsg.run(
        randomUUID(),
        newConvId,
        m.role,
        m.content,
        m.reasoning || null,
        m.tool_calls || null,
        m.tool_call_id || null,
        m.name || null,
        m.model || null,
        m.provider || null,
        m.usage || null,
        m.error || null,
        now + (i - startIndex),
        i - startIndex
      );
    }

    return { id: newConvId };
  });

  ipcMain.handle(IPC.MSG_BOOKMARK, (_e, { messageId, bookmarked }: { messageId: string; bookmarked: boolean }) => {
    getDb().prepare('UPDATE messages SET bookmarked = ? WHERE id = ?').run(bookmarked ? 1 : 0, messageId);
    return { ok: true };
  });

  ipcMain.handle(IPC.MSG_UPDATE, (_e, { messageId, content }: { messageId: string; content: string }) => {
    const msg = getDb().prepare('SELECT conversation_id, content FROM messages WHERE id = ?').get(messageId) as { conversation_id: string; content: string } | undefined;
    if (!msg) return { ok: false, error: 'message not found' };
    const contentText = typeof content === 'string' ? content : JSON.stringify(content);
    getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(contentText, messageId);
    // Re-sync FTS index
    getDb().prepare('DELETE FROM messages_fts WHERE rowid = (SELECT rowid FROM messages WHERE id = ?)').run(messageId);
    getDb().prepare('INSERT INTO messages_fts (rowid, content, conversation_id, message_id) VALUES ((SELECT rowid FROM messages WHERE id = ?), ?, ?, ?)')
      .run(messageId, contentText, msg.conversation_id, messageId);
    getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), msg.conversation_id);
    return { ok: true };
  });

  ipcMain.handle(IPC.BOOKMARK_LIST, () => {
    const rows = getDb().prepare(`
      SELECT m.id AS message_id, m.conversation_id, m.role, m.content, m.created_at, c.title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.bookmarked = 1
      ORDER BY m.created_at DESC
      LIMIT 200
    `).all() as Array<{ message_id: string; conversation_id: string; role: string; content: string; created_at: number; title: string }>;
    return rows.map((r) => {
      // Content may be a JSON content-part array — extract the first text part.
      let preview = r.content;
      try {
        const j = JSON.parse(r.content);
        if (Array.isArray(j)) preview = (j.find((p) => p?.type === 'text') as { text?: string } | undefined)?.text || '[attachment]';
      } catch { /* plain string */ }
      return {
        messageId: r.message_id,
        conversationId: r.conversation_id,
        conversationTitle: r.title,
        role: r.role,
        preview: preview.replace(/\s+/g, ' ').trim().slice(0, 120),
        createdAt: r.created_at
      };
    });
  });

  // Token usage aggregated per model for the dashboard. usage is stored as a
  // JSON blob on assistant messages — SQLite's json_extract does the math.
  ipcMain.handle(IPC.USAGE_STATS, () => {
    const query = getDb().prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COALESCE(provider, 'unknown') AS provider,
        COUNT(*) AS messages,
        COALESCE(SUM(json_extract(usage, '$.promptTokens')), 0) AS promptTokens,
        COALESCE(SUM(json_extract(usage, '$.completionTokens')), 0) AS completionTokens,
        COALESCE(SUM(json_extract(usage, '$.totalTokens')), 0) AS totalTokens
      FROM messages
      WHERE role = 'assistant' AND usage IS NOT NULL AND created_at >= ?
      GROUP BY model, provider
      ORDER BY totalTokens DESC
    `);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const now = Date.now();
    return {
      today: query.all(startOfToday.getTime()),
      week: query.all(now - 7 * 24 * 3600_000),
      month: query.all(now - 30 * 24 * 3600_000)
    };
  });

  ipcMain.handle(IPC.CONV_SEARCH, (_e, q: string) => {
    if (!q.trim()) return [];
    // Quote each term so FTS5 operators/punctuation in user input ("-", '"',
    // parens…) can't cause a MATCH syntax error; last term is a prefix match.
    const terms = q.trim().split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"`);
    const match = terms.map((t, i) => (i === terms.length - 1 ? `${t}*` : t)).join(' ');
    const rows = getDb().prepare(`
      SELECT m.conversation_id, m.id AS message_id, m.role, snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id
      WHERE messages_fts MATCH ?
      ORDER BY rank LIMIT 100
    `).all(match) as Array<{ conversation_id: string; message_id: string; role: string; snippet: string }>;
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      messageId: r.message_id,
      role: r.role as 'user' | 'assistant' | 'tool' | 'system',
      snippet: r.snippet,
      score: 1
    }));
  });

  ipcMain.handle(IPC.CONV_COMPACT, (_e, conversationId: string) => {
    const config = {
      keepRecentMessages: 6,
      truncateToolOutputChars: 4000,
      maxHistoryMessageChars: 8000
    };

    const messages = getDb().prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC'
    ).all(conversationId) as Array<Record<string, unknown>>;

    if (messages.length <= config.keepRecentMessages) {
      return { removedCount: 0, summaryText: '', beforeTokens: 0, afterTokens: 0 };
    }

    // Compute pre-compaction tokens (heuristic)
    const beforeTokens = messages.reduce((sum, m) => {
      const t = typeof m.content === 'string' ? m.content.length : 0;
      return sum + Math.ceil(t / 3.7) + ((m.reasoning as string)?.length || 0) / 4;
    }, 0);

    const systemMsgs = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const recent = nonSystem.slice(-config.keepRecentMessages);
    const older = nonSystem.slice(0, nonSystem.length - config.keepRecentMessages);

    // OpenChamber-style structured summary
    const userTurns: string[] = [];
    const assistantDecisions: string[] = [];
    const filesTouched = new Set<string>();
    const codeSnippets: string[] = [];
    const errors: string[] = [];

    for (const m of older) {
      const text = typeof m.content === 'string' ? m.content : '';
      if (!text) continue;
      if (m.role === 'user') {
        const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (cleaned) userTurns.push(`• ${cleaned}`);
      } else if (m.role === 'assistant') {
        // Extract decisions / instructions
        if (/^(let me|now i|next,? i|I'll|i will|going to|here's|we should)\b/i.test(text)) {
          const sent = text.split(/[.!?]\s+/).find((s) => /^(let me|now i|next,? i|I'll|i will|going to|here's|we should)\b/i.test(s));
          if (sent && sent.length < 250) assistantDecisions.push(`• ${sent.trim()}`);
        }
      } else if (m.role === 'tool') {
        // Track files / errors / code
        const fileMatch = text.match(/(?:^|\s)([A-Z]:[\\\\/][^\s'"<>|]+|\/[\w./-]+|\.\.?\/[\w./-]+)/);
        if (fileMatch) filesTouched.add(fileMatch[1]);
        if (m.name === 'run_shell' && /(?:error|fatal|failed|exception)/i.test(text)) {
          errors.push(`• [${m.name}] ${text.slice(0, 200)}`);
        }
        // Pull code-ish blocks
        if (text.length > 80 && text.length < 4000 && /\n {2,}|\n\t|function |class |def |=> /.test(text)) {
          codeSnippets.push(text.slice(0, 400));
        }
      }
    }

    const summarySections: string[] = [];
    summarySections.push(`<context_compaction>`);
    summarySections.push(`Compacted ${older.length} older messages from this conversation.`);
    if (userTurns.length) {
      summarySections.push(`\n## User requests`);
      summarySections.push(userTurns.slice(0, 12).join('\n'));
    }
    if (assistantDecisions.length) {
      summarySections.push(`\n## Decisions / progress`);
      summarySections.push(assistantDecisions.slice(0, 12).join('\n'));
    }
    if (filesTouched.size) {
      summarySections.push(`\n## Files referenced`);
      summarySections.push(Array.from(filesTouched).slice(0, 20).map((f) => `• ${f}`).join('\n'));
    }
    if (codeSnippets.length) {
      summarySections.push(`\n## Code snippets retained`);
      summarySections.push(codeSnippets.slice(0, 3).join('\n---\n'));
    }
    if (errors.length) {
      summarySections.push(`\n## Errors observed`);
      summarySections.push(errors.slice(0, 5).join('\n'));
    }
    summarySections.push(`</context_compaction>`);

    const summaryText = summarySections.join('\n').slice(0, config.maxHistoryMessageChars * 2);
    const summaryMsgId = randomUUID();
    const summaryContent = summaryText;
    const summarySortOrder = -1;

    // Compute post-compaction tokens (BEFORE the transaction so they're available outside)
    const afterMessages = [
      ...systemMsgs.map((m) => m.content as string),
      summaryContent,
      ...recent.map((m) => m.content as string)
    ];
    const afterTokens = afterMessages.reduce((sum, c) => sum + Math.ceil((c?.length || 0) / 3.7), 0);
    const tokensSaved = Math.max(0, Math.round(beforeTokens - afterTokens));

    const db = getDb();
    db.transaction(() => {
      // Wipe existing messages for this conversation
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

      const now = Date.now();
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

      // Insert structured summary message
      insert.run(
        summaryMsgId, conversationId, 'system', summaryContent,
        null, null, null, null, null, null, null, null,
        now, summarySortOrder
      );
      insertFts.run(summaryContent, conversationId, summaryMsgId);

      // Insert recent messages with truncated tool outputs
      for (const m of recent) {
        let content = m.content as string;
        if ((m.role === 'tool' || m.role === 'assistant') && content && content.length > config.truncateToolOutputChars) {
          content = content.slice(0, config.truncateToolOutputChars) + `\n... [truncated to ${config.truncateToolOutputChars} chars during compaction]`;
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

// Update conversation metadata with telemetry
        db.prepare(`
        UPDATE conversations
        SET message_count = ?,
            total_tokens = ?,
            compaction_count = COALESCE(compaction_count, 0) + 1,
            last_compaction_at = ?,
            tokens_saved_by_compaction = COALESCE(tokens_saved_by_compaction, 0) + ?,
            updated_at = ?
        WHERE id = ?
      `).run(systemMsgs.length + 1 + recent.length, Math.round(afterTokens), now, tokensSaved, Date.now(), conversationId);
    })();

    const compactResult = {
      removedCount: older.length,
      summaryText,
      beforeTokens: Math.round(beforeTokens),
      afterTokens: Math.round(afterTokens),
      tokensSaved: Math.max(0, Math.round(beforeTokens - afterTokens))
    };

    // Notify renderer so it can show a "context compacted" toast / badge
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send(IPC.CONV_COMPACTED, { conversationId, ...compactResult });
    });

    return compactResult;
  });
}

function rowToConv(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    providerId: (row.provider_id as string) || '',
    model: (row.model as string) || '',
    systemPrompt: row.system_prompt as string | undefined,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    projectId: row.project_id as string | undefined,
    parentId: row.parent_id as string | undefined,
    totalTokens: row.total_tokens as number | undefined,
    messageCount: row.message_count as number,
    preview: row.preview as string | undefined,
    compactionCount: (row.compaction_count as number) ?? 0,
    lastCompactionAt: row.last_compaction_at as number | undefined,
    tokensSavedByCompaction: (row.tokens_saved_by_compaction as number) ?? 0
  };
}

function rowToMsg(row: Record<string, unknown>): Message {
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
    createdAt: row.created_at as number,
    bookmarked: row.bookmarked === 1
  };
}
