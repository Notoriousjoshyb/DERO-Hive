import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamEvent } from './base';
import { parseSSE } from './streaming';
import type { ProviderConfig, Message, ToolDefinition, ContentPart } from '@shared/types';
import { supportsOpenAIReasoningEffort } from '@shared/thinkingCapabilities';
import { classifyProviderError } from '@shared/errors';
import { logger } from '../utils/logger';

// Generic identifier sent to every OpenAI-compatible request so gateways
// that audit User-Agent see a real client, not the default `Node.js` string
// from undici.
const USER_AGENT = `DERO-Hive/${process.env.npm_package_version || '0.1.0'}`;

// Kimi Code's coding/v1 endpoint is subscription-gated to a whitelist of
// known coding-agent clients (Claude Code, Kimi CLI, Roo Code, ...),
// enforced via the User-Agent header. A request with an unrecognized UA is
// NOT rejected with an auth error — it returns 200 OK with an empty stream,
// which looks like "the chat doesn't return anything". Identify as Claude
// Code (the reference client Kimi's own third-party-integration docs are
// written against) so the subscription gate accepts us.
const KIMI_CODING_USER_AGENT = 'claude-code/0.1.0';

// Pull the human-readable message out of an error response body.
// Handles OpenAI ({error:{message}}) and OpenCode ({type:'error',error:{message}}) shapes.
function extractErrorMessage(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
    if (j.message) return j.message;
  } catch { /* not JSON */ }
  return body ? body.slice(0, 200) : null;
}

// Usage shape across OpenAI-compatible providers: OpenAI-style
// prompt_tokens_details.cached_tokens, DeepSeek-style prompt_cache_hit/miss.
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

// Prompt-cache hits arrive either as OpenAI's prompt_tokens_details.cached_tokens
// or DeepSeek-style prompt_cache_hit_tokens (with prompt_cache_miss_tokens).
// Returns undefined when the provider reported neither (or explicit zeros), so
// cachedTokens stays absent rather than a misleading 0.
export function openAICachedTokens(u: OpenAIUsage): number | undefined {
  const detailed = u.prompt_tokens_details?.cached_tokens;
  if (typeof detailed === 'number' && detailed > 0) return detailed;
  const hit = u.prompt_cache_hit_tokens;
  if (typeof hit === 'number' && hit > 0) return hit;
  return undefined;
}

// OpenAI Chat Completions compatible adapter. Works with any service that
// implements that format (OpenAI, OpenCode Zen/Go, Groq, OpenRouter, Moonshot, Ollama, etc.)
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  constructor(private readonly cfg: ProviderConfig, private readonly apiKey: string) {
    this.id = cfg.id;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }> {
    const baseUrl = this.cfg.baseUrl.replace(/\/$/, '');

    // 1. Try a tiny chat completion first — this is the real auth test.
    //    /models is often public and doesn't prove the key can actually chat.
    try {
      const probeModel = this.cfg.models[0]?.id || 'test';
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: probeModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      });
      if (r.ok) return { ok: true, models: this.cfg.models.map((m) => m.id) };
      const body = await r.text();
      if (r.status === 401 || r.status === 403) {
        // Some gateways (OpenCode Zen/Go) return 401 for other problems too
        // (e.g. "model not supported") — surface the provider's own message.
        const detail = extractErrorMessage(body);
        // Kimi Code returns the same 401 shape for a wrong key AND for the
        // HighSpeed model on a non-Allegretto plan — disambiguate the latter
        // so the user doesn't keep editing the wrong field.
        const isKimiHighspeed = this.cfg.presetId === 'kimi'
          && /highspeed/i.test(probeModel)
          && (this.cfg.baseUrl.includes('kimi.com') || this.cfg.baseUrl.includes('moonshot'));
        return {
          ok: false,
          error: `Auth failed (${r.status})${detail ? `: ${detail}` : ': check your API key.'}`,
          hint: isKimiHighspeed
            ? 'kimi-for-coding-highspeed requires an Allegretto plan or above. Switch the default model to kimi-for-coding, or upgrade your plan.'
            : detail && /model/i.test(detail)
              ? 'The probe model may not exist on this endpoint — refresh the model list.'
              : 'Edit the provider and re-enter the key.'
        };
      }
      if (r.status === 404) {
        // Fall through to /models test below
      } else {
        return { ok: false, error: `${r.status} ${r.statusText}: ${body.slice(0, 200)}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
        return { ok: false, error: `DNS lookup failed for "${this.cfg.baseUrl}"`, hint: 'Check the hostname. Is the service running?' };
      }
      if (/ECONNREFUSED/i.test(msg)) {
        return { ok: false, error: `Connection refused at "${this.cfg.baseUrl}"`, hint: 'Is the service running on that host/port?' };
      }
      // Network error — try /models below
    }

    // 2. Fallback: GET /models (useful for local/ollama or public gateways)
    try {
      const r = await fetch(`${baseUrl}/models`, { headers: this.headers() });
      if (r.ok) {
        const data = (await r.json()) as { data?: { id: string }[] };
        return { ok: true, models: (data.data || []).map((m) => m.id) };
      }
      // 401/403 with /models usually means the key is wrong; report that early.
      if (r.status === 401 || r.status === 403) {
        const detail = extractErrorMessage(await r.text());
        return { ok: false, error: `Auth failed (${r.status})${detail ? `: ${detail}` : ': check your API key.'}`, hint: 'Edit the provider and re-enter the key.' };
      }
      // 404: try common URL variants
      if (r.status === 404) {
        const host = this.extractHost();
        const probes = await Promise.allSettled([
          this.probeUrl(`https://${host}/v1/models`),
          this.probeUrl(`https://${host}/api/v1/models`),
          this.probeUrl(`https://api.${host}/v1/models`),
          this.probeUrl(`https://${host}/openai/v1/models`)
        ]);
        const found = probes.find((p) => p.status === 'fulfilled');
        if (found && found.value) {
          return {
            ok: false,
            error: `404 at "${this.cfg.baseUrl}"`,
            hint: `Try base URL "${found.value}" instead — that one responded successfully.`
          };
        }
        return {
          ok: false,
          error: `404 — endpoint not found at "${this.cfg.baseUrl}"`,
          hint: 'The base URL is wrong. Check the provider\'s dashboard for the exact API endpoint. Common shapes: https://api.example.com/v1, https://example.com/openai/v1.'
        };
      }
      return { ok: false, error: `${r.status} ${r.statusText}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
        return { ok: false, error: `DNS lookup failed for "${this.cfg.baseUrl}"`, hint: 'Check the hostname. Is the service running?' };
      }
      if (/ECONNREFUSED/i.test(msg)) {
        return { ok: false, error: `Connection refused at "${this.cfg.baseUrl}"`, hint: 'Is the service running on that host/port?' };
      }
      return { ok: false, error: msg };
    }
  }

  private extractHost(): string {
    try {
      const u = new URL(this.cfg.baseUrl);
      return u.host;
    } catch {
      return this.cfg.baseUrl.replace(/^https?:\/\//, '').split('/')[0];
    }
  }

  private async probeUrl(url: string): Promise<string | null> {
    try {
      const r = await fetch(url, { headers: this.headers(), method: 'GET' });
      if (r.ok || r.status === 401) {
        // 200 or auth-required means this URL is the right shape
        return url.replace(/\/models$/, '');
      }
    } catch { /* ignore */ }
    return null;
  }

  private isKimiCoding(): boolean {
    return this.cfg.presetId === 'kimi' || /api\.kimi\.com\/coding/i.test(this.cfg.baseUrl);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.isKimiCoding() ? KIMI_CODING_USER_AGENT : USER_AGENT,
      ...(this.cfg.customHeaders || {})
    };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private toOpenAIMessages(messages: Message[]): unknown[] {
    const out: unknown[] = [];
    // A provider can occasionally end a stream with truncated tool arguments.
    // Do not replay those records: OpenAI-compatible APIs reject the entire
    // request when even one historical `arguments` field is invalid JSON.
    // Keep the valid call ids so their corresponding tool results remain
    // paired correctly, while orphaned results are skipped below.
    const validToolCallIds = new Set<string>();
    for (const m of messages) {
      // tool result message
      if (m.role === 'tool' && m.toolCallId) {
        if (!validToolCallIds.has(m.toolCallId)) {
          logger.warn('openai', `skipping orphaned or malformed tool result ${m.toolCallId}`);
          continue;
        }
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        continue;
      }
      // assistant tool_calls
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        const validCalls = m.toolCalls.filter((tc) => {
          if (!tc.id || !tc.function?.name || typeof tc.function.arguments !== 'string') return false;
          try {
            const args: unknown = JSON.parse(tc.function.arguments);
            return typeof args === 'object' && args !== null && !Array.isArray(args);
          } catch {
            return false;
          }
        });
        for (const tc of validCalls) validToolCallIds.add(tc.id);
        if (validCalls.length !== m.toolCalls.length) {
          logger.warn('openai', `skipping ${m.toolCalls.length - validCalls.length} malformed historical tool call(s)`);
        }
        if (validCalls.length === 0) {
          // Preserve any normal assistant text, but omit unusable tool metadata.
          out.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '' });
          continue;
        }
        out.push({
          role: 'assistant',
          content: typeof m.content === 'string' ? m.content : '',
          tool_calls: validCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        });
        continue;
      }
      // multipart content
      if (Array.isArray(m.content)) {
        out.push({ role: m.role, content: this.partsToOpenAI(m.content) });
        continue;
      }
      out.push({ role: m.role, content: m.content });
    }
    return out;
  }

  private partsToOpenAI(parts: ContentPart[]): unknown[] {
    const out: unknown[] = [];
    for (const p of parts) {
      if (p.type === 'text') out.push({ type: 'text', text: p.text });
      else if (p.type === 'image_url') out.push({ type: 'image_url', image_url: p.image_url });
      else if (p.type === 'input_audio') out.push({ type: 'input_audio', input_audio: p.input_audio });
      else if (p.type === 'file') {
        if (/^(text\/|application\/(json|javascript|xml))/u.test(p.file.mimeType)) {
          out.push({
            type: 'text',
            text: `[Attached file: ${p.file.filename}]\n${Buffer.from(p.file.data, 'base64').toString('utf8')}`
          });
        } else {
          out.push({
            type: 'file',
            file: {
              filename: p.file.filename,
              file_data: `data:${p.file.mimeType};base64,${p.file.data}`
            }
          });
        }
      }
    }
    return out;
  }

  private usesMoonshotSchema(): boolean {
    return this.cfg.presetId === 'kimi' || this.cfg.presetId === 'moonshot'
      || /kimi\.com|moonshot/i.test(this.cfg.baseUrl);
  }

  // Moonshot's tool-schema validator (used by both Kimi Code and the
  // Moonshot platform) rejects any property that has `enum` but no `type` —
  // valid JSON Schema everywhere else, but a 400 here. Our own builtin tools
  // are fixed at the source, but MCP servers supply their own inputSchema
  // verbatim and are out of our control, so patch defensively for these
  // presets only rather than mutating the schema every provider sees.
  private sanitizeMoonshotSchema(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((n) => this.sanitizeMoonshotSchema(n));
    if (!node || typeof node !== 'object') return node;
    const obj = { ...(node as Record<string, unknown>) };
    if (obj.enum && !obj.type) obj.type = 'string';
    if (obj.properties && typeof obj.properties === 'object') {
      obj.properties = Object.fromEntries(
        Object.entries(obj.properties as Record<string, unknown>).map(([k, v]) => [k, this.sanitizeMoonshotSchema(v)])
      );
    }
    for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf']) {
      if (key in obj) obj[key] = this.sanitizeMoonshotSchema(obj[key]);
    }
    return obj;
  }

  private toOpenAITools(tools?: ToolDefinition[]): unknown[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    const patch = this.usesMoonshotSchema();
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: patch ? this.sanitizeMoonshotSchema(t.parameters) : t.parameters
      }
    }));
  }

  async *stream(req: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
        ...this.toOpenAIMessages(req.messages)
      ],
      stream: true,
      stream_options: { include_usage: true }
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.reasoning && supportsOpenAIReasoningEffort(this.cfg.presetId, req.model)) {
      body.reasoning_effort = req.reasoning.effort;
    }
    const tools = this.toOpenAITools(req.tools);
    if (tools) body.tools = tools;
    if (tools && req.tools) body.tool_choice = 'auto';

    logger.debug('openai', `POST ${url} model=${req.model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.debug('openai', `response error ${response.status}: ${errText.slice(0, 500)}`);
      yield {
        type: 'error',
        error: `${response.status} ${response.statusText}: ${errText.slice(0, 500)}`,
        errorInfo: classifyProviderError({
          status: response.status,
          message: extractErrorMessage(errText) || errText.slice(0, 200),
          providerId: this.id,
          model: req.model
        })
      };
      return;
    }

    const contentType = response.headers.get('content-type') || '';

    // Some providers ignore `stream: true` and return a single JSON object.
    // Handle that gracefully instead of producing an empty stream.
    if (contentType.includes('application/json')) {
      try {
        const json = (await response.json()) as Record<string, unknown>;
        const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0];
        const message = choice?.message as Record<string, unknown> | undefined;
        const content = typeof message?.content === 'string' ? message.content : undefined;
        if (content) yield { type: 'delta', content };
        const reasoning = (message as { reasoning_content?: string; reasoning?: string } | undefined)?.reasoning_content
          ?? (message as { reasoning_content?: string; reasoning?: string } | undefined)?.reasoning;
        if (reasoning) yield { type: 'reasoning', reasoning };
        const tc = (message?.tool_calls as Array<Record<string, unknown>> | undefined) ?? (choice?.tool_calls as Array<Record<string, unknown>> | undefined);
        if (tc && tc.length > 0) {
          yield {
            type: 'tool_calls',
            toolCalls: tc.map((t) => ({
              id: (t.id as string) || '',
              name: ((t.function as { name?: string } | undefined)?.name as string) || '',
              arguments: ((t.function as { arguments?: string } | undefined)?.arguments as string) || ''
            }))
          };
        }
        const u = json.usage as OpenAIUsage | undefined;
        if (u) {
          const cachedTokens = openAICachedTokens(u);
          yield {
            type: 'usage',
            usage: {
              promptTokens: u.prompt_tokens || 0,
              completionTokens: u.completion_tokens || 0,
              totalTokens: u.total_tokens || 0,
              ...(cachedTokens !== undefined ? { cachedTokens } : {})
            }
          };
        }
      } catch (err) {
        logger.debug('openai', `failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`);
      }
      yield { type: 'done' };
      return;
    }

    // Aggregate tool calls by id as they stream in
    const toolAcc = new Map<string, { id: string; name: string; arguments: string }>();
    let usage: OpenAIUsage | undefined;
    // Tracks whether the stream produced any user-visible output. If Kimi or
    // another OpenAI-compat gateway returns 200 OK with a body but no content
    // chunks (e.g. because the model declined silently or a request field is
    // unsupported), surfacing a real error is much better than ending the turn
    // with a blank assistant bubble.
    let committed = false;

    for await (const evt of parseSSE(response, req.signal)) {
      if (evt.raw === '[DONE]') break;
      const data = evt.data as Record<string, unknown> | undefined;
      if (!data) continue;

      // OpenAI error in stream
      if (data.error) {
        const e = data.error as { message?: string; code?: string };
        yield {
          type: 'error',
          error: e.message || JSON.stringify(e),
          errorInfo: classifyProviderError({
            code: typeof e.code === 'string' ? e.code : undefined,
            message: e.message,
            providerId: this.id,
            model: req.model
          })
        };
        return;
      }

      // Log the first event shape when debugging so we can diagnose provider quirks.
      if (process.env.HIVE_DEBUG) {
        logger.debug('openai', `sse event: ${JSON.stringify(data).slice(0, 400)}`);
      }

      const choice = (data.choices as Record<string, unknown>[] | undefined)?.[0];
      if (choice) {
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (delta) {
          // Content — try common field names used by OpenAI-compatible gateways
          const content = delta.content as string | undefined
            ?? delta.text as string | undefined
            ?? (delta.message as Record<string, unknown> | undefined)?.content as string | undefined;
          if (content) { committed = true; yield { type: 'delta', content }; }

          // Reasoning content (o1/o3 style, or custom fields)
          const reasoning = (delta as { reasoning_content?: string; reasoning?: string }).reasoning_content
            ?? (delta as { reasoning_content?: string; reasoning?: string }).reasoning;
          if (reasoning) { committed = true; yield { type: 'reasoning', reasoning }; }

          // Tool calls
          const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (tcs) {
            for (const tc of tcs) {
              const idx = (tc.index as number) ?? 0;
              const key = String(idx);
              let acc = toolAcc.get(key);
              if (!acc) { acc = { id: '', name: '', arguments: '' }; toolAcc.set(key, acc); }
              if (tc.id) acc.id = tc.id as string;
              const fn = tc.function as { name?: string; arguments?: string } | undefined;
              if (fn?.name) acc.name = fn.name;
              if (fn?.arguments) acc.arguments += fn.arguments;
            }
          }
        }

        // Stop reason — checked outside the delta block: many providers send
        // finish_reason in a chunk with no (or an empty) delta.
        if (choice.finish_reason === 'tool_calls' && toolAcc.size > 0) {
          committed = true;
          yield { type: 'tool_calls', toolCalls: Array.from(toolAcc.values()) };
          toolAcc.clear();
        }
      }

      // Usage comes in final chunk when stream_options.include_usage = true
      const u = data.usage as typeof usage;
      if (u) usage = u;
    }

    // Some providers close the stream without a finish_reason 'tool_calls'
    // chunk — don't drop tool calls that were accumulated but never flushed.
    if (toolAcc.size > 0) {
      committed = true;
      yield { type: 'tool_calls', toolCalls: Array.from(toolAcc.values()) };
      toolAcc.clear();
    }

    if (usage) {
      const cachedTokens = openAICachedTokens(usage);
      yield {
        type: 'usage',
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          ...(cachedTokens !== undefined ? { cachedTokens } : {})
        }
      };
    }

    // Silent-stream guard: 200 OK but no user-visible events. Without this the
    // chat loop completes with an empty assistant bubble and the user has no
    // signal about what went wrong. Surface a real error with Kimi-specific
    // guidance, since their coding endpoint whitelists the User-Agent and
    // gates HighSpeed behind plan tier.
    if (!committed) {
      const isKimi = this.cfg.presetId === 'kimi'
        || /kimi\.com|moonshot/i.test(this.cfg.baseUrl);
      const detail = isKimi
        ? 'Kimi Code accepted the request but returned no content. Common causes: (1) kimi-for-coding-highspeed is set but the plan does not include Allegretto tier — switch to kimi-for-coding; (2) the API key is correct but the membership is paused; (3) a custom User-Agent override in provider settings is masking the required client identity. Try Test Connection in Settings → Providers to confirm auth.'
        : 'Provider returned 200 OK but streamed no content. The model may have refused the request, the key may lack access to the requested model, or the request body uses an unsupported field.';
      logger.warn('openai', `empty stream from ${this.cfg.name} (${req.model}) at ${this.cfg.baseUrl}`);
      yield {
        type: 'error',
        error: detail,
        errorInfo: classifyProviderError({
          message: detail,
          providerId: this.id,
          model: req.model
        })
      };
    }

    yield { type: 'done' };
  }
}
