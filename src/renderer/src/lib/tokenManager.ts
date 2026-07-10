import type { Message, ProviderModel, Attachment } from '@shared/types';

// OpenChamber-style token management.
// Tracks context pressure and decides when to compact, truncate, or warn.

export interface TokenBreakdown {
  system: number;
  user: number;
  assistant: number;
  tool: number;
  reasoning: number;
  total: number;
}

export interface ContextPressure {
  used: number;
  limit: number;
  percent: number;
  level: 'ok' | 'warn' | 'high' | 'critical' | 'over';
}

export interface CompactionConfig {
  // Trigger compaction when context usage exceeds this fraction of the limit.
  autoCompactThreshold: number;
  // Drop oldest non-system messages when compacting, keep this many recent turns.
  keepRecentMessages: number;
  // Per-message cap (chars) when truncating tool outputs.
  truncateToolOutputChars: number;
  // Per-message cap (chars) for assistant history during compaction.
  maxHistoryMessageChars: number;
}

export const DEFAULT_CONFIG: CompactionConfig = {
  autoCompactThreshold: 0.85,
  keepRecentMessages: 6,
  truncateToolOutputChars: 4000,
  maxHistoryMessageChars: 8000
};

// Heuristic token estimation when real usage data isn't available.
// Real-world English is closer to ~4 chars/token; mixed code+text closer to ~3.5.
// We default to 4.0 (OpenAI tiktoken's ballpark for English) which avoids over-estimation.
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(m: Message): number {
  // For assistant turns: usage.promptTokens is the FULL context size at that turn
  // (includes everything). We don't want to sum promptTokens across turns because
  // that double-counts. Callers should use `latestPromptTokens(messages)` instead.
  // For non-assistant messages, estimate from content size.
  if (m.role === 'assistant' && m.usage) {
    return m.usage.completionTokens;
  }
  let chars = 0;
  if (typeof m.content === 'string') {
    chars = m.content.length;
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if ('text' in part && typeof part.text === 'string') chars += part.text.length;
      else if ('image_url' in part) chars += 800;
      else if ('input_audio' in part) chars += 200;
      else if ('file' in part && typeof part.file.data === 'string') chars += part.file.data.length / 4;
      else if (part.type === 'attachment_ref') chars += part.attachment.type === 'image' ? 800 : part.attachment.type === 'audio' ? 200 : part.attachment.size / 4;
    }
  }
  if (m.reasoning) chars += m.reasoning.length;
  if (m.name && m.content) chars += m.name.length;
  if (m.error) chars += m.error.length;
  return Math.ceil(chars / 4);
}

/**
 * Returns the most accurate single-number estimate of the actual context size
 * sent to the model on the latest turn. Prefers the latest assistant turn's
 * reported `promptTokens` (the API told us this is what we sent). Falls back
 * to summing individual message estimates only when usage data is absent.
 */
export function latestContextTokens(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.usage?.promptTokens) {
      return m.usage.promptTokens;
    }
  }
  // No usage data — fall back to summing estimates.
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Total completion tokens across all assistant turns in this conversation
 * (useful for cost display; sums incrementally so each turn is counted once).
 */
export function totalCompletionTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.role === 'assistant' && m.usage) total += m.usage.completionTokens;
  }
  return total;
}

export function estimateAttachmentsTokens(attachments: Attachment[]): number {
  let total = 0;
  for (const a of attachments) {
    // Vision models charge by tile/detail: low ~85 tokens, high ~170 per image.
    if (a.type === 'image') total += 170;
    else if (a.type === 'audio') total += 200;
    else if (a.type === 'file' || a.type === 'pdf') total += Math.ceil(a.size / 2);
  }
  return total;
}

export function breakdownByRole(messages: Message[]): TokenBreakdown {
  const b: TokenBreakdown = { system: 0, user: 0, assistant: 0, tool: 0, reasoning: 0, total: 0 };
  for (const m of messages) {
    const tokens = estimateMessageTokens(m);
    if (m.role === 'user') b.user += tokens;
    else if (m.role === 'assistant') {
      b.assistant += tokens;
      if (m.reasoning) {
        // Reasoning tokens are reported in usage but separate from content
        b.reasoning += estimateTokens(m.reasoning);
      }
    } else if (m.role === 'tool') b.tool += tokens;
    else if (m.role === 'system') b.system += tokens;
    b.total += tokens;
  }
  return b;
}

// Best-effort context window when a provider doesn't report one and the model
// isn't in our known-models table. Matches on common family name fragments so
// the context meter reflects reality instead of always defaulting to 128k.
export function inferContextWindow(modelId: string | undefined | null): number {
  if (!modelId) return 128_000;
  const id = modelId.toLowerCase();
  // 1M+ context families
  if (/(gemini|minimax|mimo|glm-4\.6|qwen3|grok-4)/.test(id)) return 1_000_000;
  if (/(gpt-5|o[34]-|o4-mini|gpt-4\.1)/.test(id)) return 1_000_000;
  // ~256k
  if (/(kimi|moonshot-v1-128|k2)/.test(id)) return 262_144;
  // 200k (Claude and friends)
  if (/(claude|sonnet|opus|haiku)/.test(id)) return 200_000;
  // 128k tier
  if (/(gpt-4o|gpt-4-turbo|llama-3|llama3|command-r|deepseek|mistral-large|codestral|big-pickle)/.test(id)) return 128_000;
  // small models
  if (/(gpt-3\.5|moonshot-v1-8k|-8k)/.test(id)) return 16_385;
  if (/(mixtral|-32k|32768|gemini-pro\b)/.test(id)) return 32_768;
  return 128_000;
}

export function resolveContextWindow(model?: ProviderModel | null): number {
  return model?.contextWindow || inferContextWindow(model?.id);
}

export function calculatePressure(used: number, model?: ProviderModel | null): ContextPressure {
  const limit = resolveContextWindow(model);
  const percent = Math.min(999, Math.round((used / limit) * 100));
  let level: ContextPressure['level'] = 'ok';
  if (percent >= 100) level = 'over';
  else if (percent >= 95) level = 'critical';
  else if (percent >= 85) level = 'high';
  else if (percent >= 70) level = 'warn';
  return { used, limit, percent, level };
}

export function shouldAutoCompact(pressure: ContextPressure, config: CompactionConfig = DEFAULT_CONFIG): boolean {
  return pressure.percent / 100 >= config.autoCompactThreshold;
}

// Build a compacted version of the message history.
// Strategy: keep the system prompt + the most recent N messages intact.
// Summarize older messages into a single "history" system message.
// Truncate tool outputs aggressively in the kept-recent window if needed.
export function compactMessages(
  messages: Message[],
  config: CompactionConfig = DEFAULT_CONFIG
): { messages: Message[]; summaryText: string; removedCount: number } {
  if (messages.length <= config.keepRecentMessages) {
    return { messages: [...messages], summaryText: '', removedCount: 0 };
  }

  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const recent = nonSystem.slice(-config.keepRecentMessages);
  const older = nonSystem.slice(0, nonSystem.length - config.keepRecentMessages);

  // Build a textual summary of older messages.
  const summaryLines: string[] = [];
  for (const m of older) {
    const preview = summarizeMessage(m);
    if (preview) summaryLines.push(`[${m.role}] ${preview}`);
  }
  const summaryText = summaryLines.join('\n').slice(0, config.maxHistoryMessageChars * 2);

  const summaryMsg: Message = {
    id: `summary-${Date.now()}`,
    role: 'system',
    content: `Previous conversation summary (${older.length} messages compacted):\n${summaryText}`,
    createdAt: Date.now()
  };

  // Truncate tool outputs in the recent window to keep the compacted context lean.
  const truncatedRecent = recent.map((m) => truncateToolOutput(m, config.truncateToolOutputChars));

  return {
    messages: [...systemMessages, summaryMsg, ...truncatedRecent],
    summaryText,
    removedCount: older.length
  };
}

function summarizeMessage(m: Message): string {
  if (typeof m.content === 'string') return m.content.slice(0, 240);
  if (Array.isArray(m.content)) {
    const text = m.content
      .map((p) => ('text' in p ? p.text : ''))
      .join(' ')
      .trim();
    return text.slice(0, 240);
  }
  return '';
}

function truncateToolOutput(m: Message, maxChars: number): Message {
  if (m.role !== 'tool' && m.role !== 'assistant') return m;
  if (typeof m.content !== 'string') return m;
  if (m.content.length <= maxChars) return m;
  return {
    ...m,
    content: m.content.slice(0, maxChars) + `\n... [truncated to ${maxChars} chars during compaction]`
  };
}

// Estimate the tokens needed to inject the system prompt + message list
// (what the model actually sees per turn).
export function estimateRequestTokens(
  systemPrompt: string | undefined,
  messages: Message[],
  attachments: Attachment[]
): number {
  const sysTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;
  const msgTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const attTokens = estimateAttachmentsTokens(attachments);
  return sysTokens + msgTokens + attTokens;
}

// Format a token count for display.
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toLocaleString();
}

// Color class for a given pressure level (Tailwind).
export function pressureColor(level: ContextPressure['level']): string {
  switch (level) {
    case 'over': return 'text-danger';
    case 'critical': return 'text-danger';
    case 'high': return 'text-warn';
    case 'warn': return 'text-warn';
    case 'ok':
    default: return 'text-fg-subtle';
  }
}
