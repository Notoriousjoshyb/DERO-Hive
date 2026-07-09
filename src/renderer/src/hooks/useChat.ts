import { useEffect } from 'react';
import { useAppStore } from '../stores/app';
import type { StreamEvent } from '@shared/types';

export function useChat(): void {
  const appendDelta = useAppStore((s) => s.appendStreamDelta);
  const appendReasoning = useAppStore((s) => s.appendStreamReasoning);
  const finish = useAppStore((s) => s.finishStreaming);
  const recordToolResult = useAppStore((s) => s.recordToolResult);
  const addPendingPermission = useAppStore((s) => s.addPendingPermission);
  const currentId = useAppStore((s) => s.currentConversationId);

  useEffect(() => {
    // Clear stale todos, compaction history, and file-change counters when switching
    useAppStore.getState().clearTodos();
    useAppStore.getState().clearCompactionHistory();
    useAppStore.getState().clearFileChanges();

    // Listen for auto-compaction events from the main process
    const offCompacted = window.hive.onConvCompacted((data) => {
      if (data.conversationId !== currentId) return;
      useAppStore.getState().recordCompaction(data);
      // Re-sync the conversation so the UI reflects the compacted state
      if (data.conversationId) void useAppStore.getState().selectConversation(data.conversationId);
    });

    const offStream = window.hive.onChatStream((evt: StreamEvent) => {
      if (evt.conversationId !== currentId) return;
      switch (evt.type) {
        case 'delta':
          if (evt.content) appendDelta(evt.content);
          if (evt.reasoning) appendReasoning(evt.reasoning);
          break;
        case 'tool_calls':
        case 'usage':
          break;
        case 'done':
          finish();
          if (currentId) void useAppStore.getState().selectConversation(currentId);
          void useAppStore.getState().loadConversations();
          break;
        case 'error':
          finish();
          useAppStore.getState().setChatError(evt.error || 'Streaming error');
          if (currentId) void useAppStore.getState().selectConversation(currentId);
          break;
      }
    });

    const offToolResult = window.hive.onToolResult((data: { messageId: string; toolCallId: string; toolName?: string; result: string; isError: boolean; durationMs: number; meta?: Record<string, unknown> }) => {
      recordToolResult(data.messageId, data.toolCallId, data.result, data.isError, data.durationMs);
      if (data.toolName === 'todo_write' && data.meta && Array.isArray((data.meta as { todos?: unknown }).todos)) {
        const todos = (data.meta as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; active_form?: string }> }).todos;
        useAppStore.getState().setTodos(todos);
      }
      // Track file diffs for the session (GitHub-style +/- line counts)
      if (!data.isError && data.meta && (data.toolName === 'write_file' || data.toolName === 'edit_file')) {
        const m = data.meta as { path?: string; kind?: 'write' | 'edit'; linesAdded?: number; linesRemoved?: number; bytesAdded?: number; isNewFile?: boolean };
        if (m.path && m.kind) {
          useAppStore.getState().recordFileChange({
            path: m.path,
            kind: m.kind,
            linesAdded: m.linesAdded || 0,
            linesRemoved: m.linesRemoved || 0,
            bytesAdded: m.bytesAdded || 0,
            isNewFile: m.isNewFile
          });
        }
      }
    });

    // Session grants live in the main process, per tool. A request only reaches
    // the renderer when it still needs a decision.
    const offPermission = window.hive.onToolPermissionRequest((req) => {
      addPendingPermission(req);
    });

    return () => { offStream(); offToolResult(); offPermission(); offCompacted(); };
  }, [appendDelta, appendReasoning, finish, recordToolResult, addPendingPermission, currentId]);
}