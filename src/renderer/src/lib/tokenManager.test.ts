import assert from 'node:assert/strict';
import {
  estimateTokens,
  estimateMessageTokens,
  latestContextTokens,
  totalCompletionTokens,
  estimateAttachmentsTokens,
  breakdownByRole,
  inferContextWindow,
  resolveContextWindow,
  calculatePressure,
  shouldAutoCompact,
  compactMessages,
  estimateRequestTokens,
  formatTokenCount,
  pressureColor,
  DEFAULT_CONFIG,
} from './tokenManager';
import type { Message, ProviderModel, Attachment } from '@shared/types';

// ─── estimateTokens ────────────────────────────────────────────────────────

assert.equal(estimateTokens(undefined), 0);
assert.equal(estimateTokens(null), 0);
assert.equal(estimateTokens(''), 0);
assert.equal(estimateTokens('abcd'), 1); // 4 chars = 1 token
assert.equal(estimateTokens('0123456789abcdef'), 4); // 16 chars / 4 = 4

// ─── estimateMessageTokens ─────────────────────────────────────────────────

// assistant with usage — uses completionTokens
const assistantWithUsage: Message = {
  id: 'a1', role: 'assistant', content: 'hello', createdAt: 0,
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
};
assert.equal(estimateMessageTokens(assistantWithUsage), 50);

// user message — 'tell me about dogs' = 19 chars → ceil(19/4) = 5
const userMsg: Message = { id: 'u1', role: 'user', content: 'tell me about dogs', createdAt: 0 };
assert.equal(estimateMessageTokens(userMsg), 5);

// tool message — 'tool output here' = 16 chars → ceil(16/4) = 4
const toolMsg: Message = { id: 't1', role: 'tool', content: 'tool output here', createdAt: 0 };
assert.equal(estimateMessageTokens(toolMsg), 4);

// system message — 'you are helpful' = 15 chars → ceil(15/4) = 4
const sysMsg: Message = { id: 's1', role: 'system', content: 'you are helpful', createdAt: 0 };
assert.equal(estimateMessageTokens(sysMsg), 4);

// assistant with reasoning
const reasoningMsg: Message = {
  id: 'r1', role: 'assistant', content: 'the answer is 42',
  reasoning: 'i reasoned about this for a bit',
  createdAt: 0
};
const reasoningTokens = estimateMessageTokens(reasoningMsg);
assert.ok(reasoningTokens > 10); // content + reasoning chars / 4

// assistant with array content (text part)
const arrayMsg: Message = {
  id: 'a2', role: 'assistant',
  content: [{ type: 'text', text: 'hello world' }],
  createdAt: 0
};
assert.equal(estimateMessageTokens(arrayMsg), 3); // 11 chars / 4

// assistant with image_url part
const imageMsg: Message = {
  id: 'a3', role: 'assistant',
  content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } }],
  createdAt: 0
};
assert.equal(estimateMessageTokens(imageMsg), 200); // 800 per image_url part

// assistant with input_audio part
const audioMsg: Message = {
  id: 'a4', role: 'assistant',
  content: [{ type: 'input_audio', input_audio: { data: 'abc', format: 'wav' } }],
  createdAt: 0
};
assert.equal(estimateMessageTokens(audioMsg), 50); // 200 per input_audio

// message with error
const errorMsg: Message = {
  id: 'e1', role: 'assistant', content: 'oops',
  error: 'something went wrong',
  createdAt: 0
};
assert.ok(estimateMessageTokens(errorMsg) > 5);

// message with name — name field is counted in chars
const namedMsg: Message = {
  id: 'n1', role: 'assistant', content: 'answer', name: 'helper', createdAt: 0
};
const namedTokens = estimateMessageTokens(namedMsg);
assert.ok(namedTokens >= 3, `expected >= 3 tokens, got ${namedTokens}`);

// ─── latestContextTokens ───────────────────────────────────────────────────

// uses promptTokens from latest assistant
const msgs1: Message[] = [
  { id: 'x', role: 'user', content: 'a', createdAt: 0 },
  { id: 'y', role: 'assistant', content: 'b', createdAt: 0, usage: { promptTokens: 999, completionTokens: 1, totalTokens: 1000 } }
];
assert.equal(latestContextTokens(msgs1), 999);

// falls back to sum when no promptTokens
const msgs2: Message[] = [
  { id: 'x', role: 'user', content: 'ab', createdAt: 0 },
  { id: 'y', role: 'assistant', content: 'cd', createdAt: 0 }
];
assert.equal(latestContextTokens(msgs2), 2); // ~4 chars / 4 each

// empty array
assert.equal(latestContextTokens([]), 0);

// ─── totalCompletionTokens ────────────────────────────────────────────────

const msgs3: Message[] = [
  { id: 'a', role: 'assistant', content: 'a', createdAt: 0, usage: { promptTokens: 0, completionTokens: 10, totalTokens: 10 } },
  { id: 'b', role: 'user', content: 'b', createdAt: 0 },
  { id: 'c', role: 'assistant', content: 'c', createdAt: 0, usage: { promptTokens: 0, completionTokens: 20, totalTokens: 20 } }
];
assert.equal(totalCompletionTokens(msgs3), 30);

// no usage
const msgs4: Message[] = [
  { id: 'a', role: 'assistant', content: 'a', createdAt: 0 }
];
assert.equal(totalCompletionTokens(msgs4), 0);

// ─── estimateAttachmentsTokens ─────────────────────────────────────────────

const imageAtt: Attachment = { id: 'img1', type: 'image', filename: 'a.png', mimeType: 'image/png', size: 100 };
assert.equal(estimateAttachmentsTokens([imageAtt]), 170); // 170 per image

const audioAtt: Attachment = { id: 'aud1', type: 'audio', filename: 'a.wav', mimeType: 'audio/wav', size: 100 };
assert.equal(estimateAttachmentsTokens([audioAtt]), 200); // 200 per audio

const fileAtt: Attachment = { id: 'fil1', type: 'file', filename: 'a.txt', mimeType: 'text/plain', size: 1000 };
assert.equal(estimateAttachmentsTokens([fileAtt]), 250); // 1000/4 per file

// ─── breakdownByRole ──────────────────────────────────────────────────────

// system: 'sys' = 3 → ceil(3/4) = 1; user: 'hi' = 2 → ceil(2/4) = 1; tool: 'ok' = 2 → ceil(2/4) = 1
const bdMsgs: Message[] = [
  { id: 's', role: 'system', content: 'sys', createdAt: 0 },
  { id: 'u', role: 'user', content: 'hi', createdAt: 0 },
  { id: 'a', role: 'assistant', content: 'ok', createdAt: 0 },
  { id: 't', role: 'tool', content: 'ok', createdAt: 0 }
];
const bd = breakdownByRole(bdMsgs);
assert.equal(bd.system, 1); // 3/4 = 0.75 → ceil = 1
assert.equal(bd.user, 1); // 2/4 = 0.5 → ceil = 1
assert.equal(bd.assistant, 1); // 2/4 = 0.5 → ceil = 1
assert.equal(bd.tool, 1); // 2/4 = 0.5 → ceil = 1
assert.equal(bd.total, 4);

// ─── inferContextWindow ───────────────────────────────────────────────────

// 1M families
assert.equal(inferContextWindow('gemini-2.5-pro'), 1_000_000);
assert.equal(inferContextWindow('minimax-01'), 1_000_000);
assert.equal(inferContextWindow('glm-4.6'), 1_000_000);
assert.equal(inferContextWindow('qwen3-32b'), 1_000_000);
assert.equal(inferContextWindow('grok-4'), 1_000_000);
assert.equal(inferContextWindow('gpt-5-preview'), 1_000_000);
assert.equal(inferContextWindow('o4-mini'), 1_000_000);
assert.equal(inferContextWindow('o3-mini'), 1_000_000);
assert.equal(inferContextWindow('gpt-4.1'), 1_000_000);

// 256k
assert.equal(inferContextWindow('moonshot-v1-128k'), 262_144);
assert.equal(inferContextWindow('k2'), 262_144);

// 200k
assert.equal(inferContextWindow('claude-sonnet-4'), 200_000);
assert.equal(inferContextWindow('claude-opus-3'), 200_000);
assert.equal(inferContextWindow('sonnet'), 200_000);
assert.equal(inferContextWindow('haiku'), 200_000);

// 128k
assert.equal(inferContextWindow('gpt-4o'), 128_000);
assert.equal(inferContextWindow('gpt-4-turbo'), 128_000);
assert.equal(inferContextWindow('llama-3.1-70b'), 128_000);
assert.equal(inferContextWindow('deepseek-v3'), 128_000);
assert.equal(inferContextWindow('mistral-large'), 128_000);

// 32k
assert.equal(inferContextWindow('mixtral-8x7b'), 32_768);
assert.equal(inferContextWindow('moonshot-v1-8k'), 16_385);
assert.equal(inferContextWindow('gpt-3.5-turbo'), 16_385);

// default
assert.equal(inferContextWindow('unknown-model'), 128_000);
assert.equal(inferContextWindow(undefined), 128_000);
assert.equal(inferContextWindow(null), 128_000);

// ─── resolveContextWindow ──────────────────────────────────────────────────

const model128k: ProviderModel = { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128_000 } as ProviderModel;
assert.equal(resolveContextWindow(model128k), 128_000);

// model without contextWindow — falls back to inference
const modelNoLimit: ProviderModel = { id: 'my-model', provider: 'openai', name: 'my-model' } as ProviderModel;
assert.equal(resolveContextWindow(modelNoLimit), 128_000); // default

// null/undefined
assert.equal(resolveContextWindow(null), 128_000);
assert.equal(resolveContextWindow(undefined), 128_000);

// ─── calculatePressure ────────────────────────────────────────────────────

const pOk = calculatePressure(50_000, model128k);
assert.equal(pOk.level, 'ok');
assert.equal(pOk.limit, 128_000);
assert.equal(pOk.percent, 39);
assert.equal(pOk.used, 50_000);

const pWarn = calculatePressure(90_000, model128k);
assert.equal(pWarn.level, 'warn'); // 70%

const pHigh = calculatePressure(110_000, model128k);
assert.equal(pHigh.level, 'high'); // 85%

const pCritical = calculatePressure(122_000, model128k);
assert.equal(pCritical.level, 'critical'); // 95%

const pOver = calculatePressure(200_000, model128k);
assert.equal(pOver.level, 'over'); // >100%

// no model — uses 128k default
const pNoModel = calculatePressure(200_000, undefined);
assert.equal(pNoModel.level, 'over');

// ─── shouldAutoCompact ─────────────────────────────────────────────────────

const pressureOk: ReturnType<typeof calculatePressure> = { used: 50_000, limit: 128_000, percent: 39, level: 'ok' };
assert.equal(shouldAutoCompact(pressureOk), false);

const pressureHigh: ReturnType<typeof calculatePressure> = { used: 120_000, limit: 128_000, percent: 94, level: 'high' };
assert.equal(shouldAutoCompact(pressureHigh), true);

// custom config
const customConfig = { autoCompactThreshold: 0.5, keepRecentMessages: 4, truncateToolOutputChars: 1000, maxHistoryMessageChars: 4000 };
const pressure50: ReturnType<typeof calculatePressure> = { used: 65_000, limit: 128_000, percent: 50, level: 'warn' };
assert.equal(shouldAutoCompact(pressure50, customConfig), true);
assert.equal(shouldAutoCompact(pressure50, { ...customConfig, autoCompactThreshold: 0.8 }), false);

// ─── compactMessages ───────────────────────────────────────────────────────

// below keepRecentMessages — returns unchanged
const shortMsgs: Message[] = [
  { id: 's', role: 'system', content: 'sys', createdAt: 0 },
  { id: 'a', role: 'assistant', content: 'hi', createdAt: 0 }
];
const shortResult = compactMessages(shortMsgs);
assert.equal(shortResult.messages.length, 2);
assert.equal(shortResult.summaryText, '');
assert.equal(shortResult.removedCount, 0);

// compaction — 8 non-system messages, keepRecent=6 → removedCount > 0
const longMsgs: Message[] = [
  { id: 's', role: 'system', content: 'sys', createdAt: 0 },
  { id: 'u1', role: 'user', content: 'u1', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: 'a1', createdAt: 2 },
  { id: 'u2', role: 'user', content: 'u2', createdAt: 3 },
  { id: 'a2', role: 'assistant', content: 'a2', createdAt: 4 },
  { id: 'u3', role: 'user', content: 'u3', createdAt: 5 },
  { id: 'a3', role: 'assistant', content: 'a3', createdAt: 6 },
  { id: 'u4', role: 'user', content: 'u4', createdAt: 7 },
  { id: 'a4', role: 'assistant', content: 'a4', createdAt: 8 }
];
const longResult = compactMessages(longMsgs, DEFAULT_CONFIG);
// system + summary + recent messages
assert.ok(longResult.messages.length >= 3);
assert.ok(longResult.removedCount > 0);
assert.ok(longResult.summaryText.length > 0);
// summary message is role=system
assert.ok(longResult.messages.some(m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('compacted')));

// tool output truncation — 5000 chars exceeds 4000 limit
const toolLong: Message = {
  id: 'tool1', role: 'tool', content: 'x'.repeat(5000),
  createdAt: 0
};
const truncResult = compactMessages([
  { id: 's', role: 'system', content: 'sys', createdAt: 0 },
  ...Array(8).fill(null).map((_, i) => ({ id: `m${i}`, role: 'user' as const, content: 'x', createdAt: i })),
  toolLong
], { autoCompactThreshold: 0.85, keepRecentMessages: 6, truncateToolOutputChars: 4000, maxHistoryMessageChars: 8000 });
const keptTool = truncResult.messages.find(m => m.role === 'tool');
assert.ok(keptTool !== undefined, 'tool message should survive compaction');
if (typeof keptTool!.content === 'string') {
  assert.ok(keptTool!.content.length < 5000, `expected < 5000, got ${keptTool!.content.length}`);
  assert.ok(keptTool!.content.includes('truncated'), 'truncated tool content should include marker');
} // content may be ContentPart[] if tool survived as non-string

// ─── estimateRequestTokens ─────────────────────────────────────────────────

const reqTokens = estimateRequestTokens(
  'system prompt here',
  [{ id: 'u', role: 'user', content: 'hi', createdAt: 0 }],
  []
);
assert.ok(reqTokens > 0);

// no system prompt
const noSys = estimateRequestTokens(undefined, [], []);
assert.equal(noSys, 0);

// with attachments
const reqWithAtt = estimateRequestTokens('sys', [], [{ id: 'att1', type: 'image', filename: 'a.png', mimeType: 'image/png', size: 100 }]);
assert.ok(reqWithAtt > 170); // 170 for image + system tokens

// ─── formatTokenCount ──────────────────────────────────────────────────────

assert.equal(formatTokenCount(0), '0');
assert.equal(formatTokenCount(999), '999');
assert.equal(formatTokenCount(1000), '1.00k');
assert.equal(formatTokenCount(1500), '1.50k');
assert.equal(formatTokenCount(10000), '10.0k');
assert.equal(formatTokenCount(100000), '100k'); // 100.toFixed(1) = '100.0'
assert.equal(formatTokenCount(1_000_000), '1.00M');
assert.equal(formatTokenCount(2_500_000), '2.50M');

// ─── pressureColor ─────────────────────────────────────────────────────────

assert.equal(pressureColor('ok'), 'text-fg-subtle');
assert.equal(pressureColor('warn'), 'text-warn');
assert.equal(pressureColor('high'), 'text-warn');
assert.equal(pressureColor('critical'), 'text-danger');
assert.equal(pressureColor('over'), 'text-danger');
