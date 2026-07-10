import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { logger } from '../utils/logger';

/**
 * Loopback LLM proxy for the in-page Agent mode (page-agent).
 *
 * page-agent runs in the renderer and speaks the OpenAI chat-completions
 * protocol directly to a baseURL — but provider API keys are sealed in the
 * main process and must never reach the renderer. This proxy bridges the two:
 * the renderer talks to 127.0.0.1:<port> with a per-session bearer token, and
 * the proxy forwards to the configured provider with the real key injected.
 * It only runs while Agent mode is in use.
 */

interface ProxyTarget {
  baseUrl: string; // OpenAI-compatible base, e.g. https://api.openai.com/v1
  apiKey: string;
  customHeaders?: Record<string, string>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

let server: Server | null = null;
let port = 0;
let token = '';
let target: ProxyTarget | null = null;

export async function startAgentProxy(t: ProxyTarget): Promise<{ port: number; token: string }> {
  target = t; // retarget on every start so provider switches take effect
  if (server) return { port, token };

  token = randomBytes(24).toString('hex');
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  logger.info('agent', `LLM proxy listening on 127.0.0.1:${port}`);
  return { port, token };
}

export function stopAgentProxy(): void {
  if (!server) return;
  server.close();
  server = null;
  port = 0;
  token = '';
  target = null;
  logger.info('agent', 'LLM proxy stopped');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!LOOPBACK.has(req.socket.remoteAddress || '')) {
      res.writeHead(403);
      res.end();
      return;
    }

    // CORS preflight carries no Authorization header — answer it before the
    // token check. The token (not the origin) is what gates actual use.
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type'
      });
      res.end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method !== 'POST' || !(req.url || '').endsWith('/chat/completions') || !target) {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(target.customHeaders || {})
    };
    if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;

    const upstream = await fetch(`${target.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: Buffer.concat(chunks)
    });

    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json'
    });
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (err) {
    logger.warn('agent', 'proxy request failed', err);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }));
  }
}
