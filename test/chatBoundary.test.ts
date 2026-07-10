import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { shouldPersistUserMessage, type MessageLookupDb } from '../src/main/ipc/chat';

describe('public chat boundary', () => {
  test('does not expose raw prompt, trust, persistence, or round overrides', () => {
    const source = readFileSync(resolve('src/shared/types.ts'), 'utf8');
    const request = source.match(/export interface ChatRequest \{([\s\S]*?)\n\}/)?.[1] || '';
    for (const forbidden of ['systemPrompt', 'agentPrompt', 'toolApprovalModeOverride', 'skipUserPersist', 'maxAgenticRounds', 'attachments']) {
      expect(request).not.toContain(forbidden);
    }
    expect(request).toContain('agentId?: string');
  });

  test('derives regeneration persistence from the database', () => {
    const db: MessageLookupDb = {
      prepare: () => ({
        get: (conversationId, messageId) => conversationId === 'c1' && messageId === 'existing' ? { 1: 1 } : undefined
      })
    };
    expect(shouldPersistUserMessage('c1', 'new', db)).toBe(true);
    expect(shouldPersistUserMessage('c1', 'existing', db)).toBe(false);
    expect(shouldPersistUserMessage('c2', 'existing', db)).toBe(true);
  });
});
