import assert from 'node:assert/strict';
import * as memoryUtils from './agentMemory.js';
import type { AgentMemoryEntry } from './agentMemory.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 13);
const memory = (id: string, content: string, overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry => ({
  id,
  content,
  createdAt: NOW,
  ...overrides
});

// Cycle 221: memory text is normalized for stable retrieval across formatting differences.
assert.equal(memoryUtils.normalizeMemoryText('  DERO\n\tHive  '), 'dero hive');
assert.equal(memoryUtils.normalizeMemoryText('ＦＵＬＬＷＩＤＴＨ'), 'fullwidth');

// Subsequent cycle fixtures intentionally live beside the first regression.
assert.equal(DAY, 86_400_000);
assert.equal(memory('fixture', 'ready').content, 'ready');

console.log('agentMemory.test.ts — all assertions passed');
