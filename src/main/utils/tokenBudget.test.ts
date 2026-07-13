import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  estimateTokens,
  estimateMessageTokens,
  latestContextTokens,
  estimateContextTokens,
  calculateContextInfo
} from './tokenBudget';
import type { Message } from '@shared/types';

describe('tokenBudget', () => {
  // estimateTokens
  it('returns 0 for empty/undefined/null', () => {
    assert.equal(estimateTokens(undefined), 0);
    assert.equal(estimateTokens(null as unknown as string), 0);
    assert.equal(estimateTokens(''), 0);
  });

  it('estimates correctly at 4 chars/token', () => {
    assert.equal(estimateTokens('1234'), 1);
    assert.equal(estimateTokens('12345'), 2);
    assert.equal(estimateTokens('aaaaaaaa'), 2);
    assert.equal(estimateTokens('a'.repeat(100)), 25);
  });

  // estimateMessageTokens — string content
  it('counts string content correctly', () => {
    const msg = { role: 'user', content: 'hello world' } as Message;
    assert.equal(estimateMessageTokens(msg), 3); // 11 chars / 4
  });

  // estimateMessageTokens — assistant with usage (prefers usage)
  it('prefers usage.completionTokens for assistant', () => {
    const msg = {
      role: 'assistant',
      content: 'short',
      usage: { promptTokens: 999, completionTokens: 7, totalTokens: 1006 }
    } as Message;
    assert.equal(estimateMessageTokens(msg), 7);
  });

  // estimateMessageTokens — array content with text parts
  it('counts text array parts', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' }
      ]
    } as unknown as Message;
    // 'part1'(5) + 'part2'(5) = 10 chars; ceil(10/4) = 3
    assert.equal(estimateMessageTokens(msg), 3);
  });

  // estimateMessageTokens — image_url part
  it('adds 170 for image_url parts', () => {
    const msg = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:...' } }]
    } as unknown as Message;
    assert.equal(estimateMessageTokens(msg), 43); // 170/4
  });

  // estimateMessageTokens — attachment_ref image
  it('adds 170 for image attachment_ref', () => {
    const msg = {
      role: 'user',
      content: [{
        type: 'attachment_ref',
        attachment: { type: 'image', data: '', filename: 'x.png', mimeType: 'image/png', size: 1000 }
      }]
    } as unknown as Message;
    assert.equal(estimateMessageTokens(msg), 43); // 170/4
  });

  // estimateMessageTokens — reasoning field
  it('adds reasoning length', () => {
    const msg = { role: 'assistant', content: 'x', reasoning: '1234' } as Message;
    assert.equal(estimateMessageTokens(msg), 2); // 'x' + '1234' = 5 chars = 2 tokens
  });

  // latestContextTokens — uses promptTokens when available
  it('prefers latest assistant usage.promptTokens', () => {
    const msgs = [
      { role: 'user', content: 'a' } as Message,
      { role: 'assistant', content: 'b', usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } } as Message,
      { role: 'user', content: 'c' } as Message,
      { role: 'assistant', content: 'd', usage: { promptTokens: 99, completionTokens: 11, totalTokens: 110 } } as Message
    ];
    assert.equal(latestContextTokens('sys', msgs), 99);
  });

  // latestContextTokens — falls back to estimation
  it('estimates when no usage.promptTokens', () => {
    const msgs = [
      { role: 'user', content: 'hello' } as Message
    ];
    // 'hello' = 5 chars / 4 = 2 tokens, system = 3 chars / 4 = 1
    assert.equal(latestContextTokens('sys', msgs), 1 + 2);
  });

  // estimateContextTokens — alias of latestContextTokens
  it('estimateContextTokens is alias for latestContextTokens', () => {
    const msgs = [{ role: 'user', content: 'test' }] as Message[];
    assert.equal(estimateContextTokens('sys', msgs), latestContextTokens('sys', msgs));
  });

  // calculateContextInfo — defaults: maxOutput=4096, contextWindow=128000
  // effectiveLimit = max(128000 - 4096, 1024) = 123904
  it('levels are correct', () => {
    const info = calculateContextInfo(500, { id: 'x', name: 'x', contextWindow: 128000 });
    assert.equal(info.used, 500);
    assert.equal(info.limit, 123904);
    assert.equal(info.percent, 0);
    assert.equal(info.level, 'ok');
  });

  it('warn at 70%', () => {
    // 0.70 * 123904 = 86732
    const info = calculateContextInfo(86732, { id: 'x', name: 'x', contextWindow: 128000 });
    assert.equal(info.level, 'warn');
  });

  it('critical at 95%', () => {
    // 0.95 * 123904 = 117709
    const info = calculateContextInfo(117709, { id: 'x', name: 'x', contextWindow: 128000 });
    assert.equal(info.level, 'critical');
  });

  it('over at >= 100%', () => {
    const info = calculateContextInfo(123905, { id: 'x', name: 'x', contextWindow: 128000 });
    assert.equal(info.level, 'over');
  });
});
