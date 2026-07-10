import type { ProviderAdapter, ProviderStreamRequest, ProviderStreamEvent } from './base';
import { parseSSE } from './streaming';
import type { ProviderConfig, Message, ToolDefinition, ContentPart } from '@shared/types';
import { logger } from '../utils/logger';

// OpenAI Chat Completions compatible adapter. Works with any service that
// implements that format (OpenAI, OpenCode Zen/Go, Groq, OpenRouter, Moonshot, Ollama, etc.)
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  constructor(private readonly cfg: ProviderConfig, private readonly apiKey: string) {
    this.id = cfg.id;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }> {
    const baseUrl = this.cfg.baseUrl.replace(/\/$/, '');

    // 1. Try GET /models
    try {
      const r = await fetch(`${baseUrl}/models`, { headers: this.headers() });
      if (r.ok) {
        const data = (await r.json()) as { data?: { id: string }[] };
        return { ok: true, models: (data.data || []).map((m) => m.id) };
      }
      // 401/403 with /models usually means the key is wrong; report that early.
      if (r.status === 401 || r.status === 403) {
        return { ok: false, error: `Auth failed (${r.status}): check your API key.`, hint: 'Edit the provider and re-enter the key.' };
      }
      // 404 / 405: provider doesn't list models — fall through to chat probe
    } catch { /* network error — try chat probe */ }

    // 2. Fallback: tiny chat completion to prove the endpoint accepts requests
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
        return { ok: false, error: `Auth failed (${r.status}): check your API key.`, hint: 'Edit the provider and re-enter the key.' };
      }
      if (r.status === 404) {
        // Try common URL variants to diagnose — maybe the user is just one segment off
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
      return { ok: false, error: `${r.status} ${r.statusText}: ${body.slice(0, 200)}` };
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

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.cfg.customHeaders || {})
    };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private toOpenAIMessages(messages: Message[]): unknown[] {
    const out: unknown[] = [];
    for (const m of messages) {
      // tool result message
      if (m.role === 'tool' && m.toolCallId) {
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
        continue;
      }
      // assistant tool_calls
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        out.push({
          role: 'assistant',
          content: typeof m.content === 'string' ? m.content : '',
          tool_calls: m.toolCalls.map((tc) => ({
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
        // OpenAI doesn't have a native file content part for chat completions;
        // many compatible providers accept it. Otherwise embed as text.
        out.push({ type: 'file', file: p.file });
      }
    }
    return out;
  }

  private toOpenAITools(tools?: ToolDefinition[]): unknown[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
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
    if (req.reasoning) body.reasoning_effort = req.reasoning.effort;
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
      yield { type: 'error', error: `${response.status} ${response.statusText}: ${errText.slice(0, 500)}` };
      return;
    }

    // Aggregate tool calls by id as they stream in
    const toolAcc = new Map<string, { id: string; name: string; arguments: string }>();
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    for await (const evt of parseSSE(response, req.signal)) {
      if (evt.raw === '[DONE]') break;
      const data = evt.data as Record<string, unknown> | undefined;
      if (!data) continue;

      // OpenAI error in stream
      if (data.error) {
        const e = data.error as { message?: string; code?: string };
        yield { type: 'error', error: e.message || JSON.stringify(e) };
        return;
      }

      const choice = (data.choices as Record<string, unknown>[] | undefined)?.[0];
      if (choice) {
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (delta) {
          // Content
          const content = delta.content as string | undefined;
          if (content) yield { type: 'delta', content };

          // Reasoning content (o1/o3 style, or custom fields)
          const reasoning = (delta as { reasoning_content?: string; reasoning?: string }).reasoning_content
            ?? (delta as { reasoning_content?: string; reasoning?: string }).reasoning;
          if (reasoning) yield { type: 'reasoning', reasoning };

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
      yield { type: 'tool_calls', toolCalls: Array.from(toolAcc.values()) };
      toolAcc.clear();
    }

    if (usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        }
      };
    }
    yield { type: 'done' };
  }
}
