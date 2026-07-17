// Secret redaction for audit rows and logs. Tool args pass through here
// before they are persisted so API keys and tokens never land in the
// database or log files.

// Order matters only for readability — every pattern replaces its full match
// with the same placeholder, except the JSON-ish one which keeps the key name.
const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // PEM private key blocks
  { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, replacement: '[REDACTED]' },
  // Authorization: Bearer <token>
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, replacement: 'Bearer [REDACTED]' },
  // OpenAI / Anthropic / OpenRouter style API keys (sk-..., sk-ant-..., sk-or-...)
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: '[REDACTED]' },
  // AWS access key ids
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED]' },
  // GCP API keys
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '[REDACTED]' },
  // JSON-ish "api_key" / "apiKey" / "authorization" / "token" values
  { pattern: /("(?:api_key|apiKey|authorization|token)"\s*:\s*")[^"]*(")/gi, replacement: '$1[REDACTED]$2' }
];

const MAX_ARGS_LENGTH = 4000;

export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** JSON-stringify tool args, scrub secrets, and cap the length so a single
 *  audit row cannot balloon (e.g. a full-file write payload). */
export function redactArgs(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? String(value);
  } catch {
    json = String(value);
  }
  const redacted = redactSecrets(json);
  return redacted.length > MAX_ARGS_LENGTH ? redacted.slice(0, MAX_ARGS_LENGTH) : redacted;
}
