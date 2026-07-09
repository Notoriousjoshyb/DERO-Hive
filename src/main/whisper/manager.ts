import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir, cpus } from 'node:os';
import { paths } from '../utils/paths';
import { logger } from '../utils/logger';
import type { WhisperStatus } from '@shared/types';

const BIN_NAME = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';

/**
 * Manages a local whisper.cpp HTTP server child process. The server loads a
 * ggml model into memory once and serves transcription over 127.0.0.1, so
 * dictation stays fully offline. Lifecycle is tied to the app: start() is
 * called after the app is ready and stop() on quit.
 */
export class WhisperManager {
  private proc: ChildProcess | null = null;
  private port: number | null = null;
  private loading = false;
  private lastError: string | null = null;
  private activeModel: string | null = null;
  private onChange?: (status: WhisperStatus) => void;

  constructor(onChange?: (status: WhisperStatus) => void) {
    this.onChange = onChange;
  }

  private binPath(): string {
    return join(paths.whisperBundled, 'bin', BIN_NAME);
  }

  /** Directories that may hold ggml-*.bin models (bundled + user-added). */
  private modelDirs(): string[] {
    return [join(paths.whisperBundled, 'models'), join(paths.whisperUser, 'models')];
  }

  listModels(): string[] {
    const found = new Set<string>();
    for (const dir of this.modelDirs()) {
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('ggml-') && f.endsWith('.bin')) found.add(f);
        }
      } catch { /* dir may not exist */ }
    }
    return [...found].sort();
  }

  private resolveModelPath(model: string | undefined): string | null {
    const name = model || this.listModels()[0];
    if (!name) return null;
    for (const dir of this.modelDirs()) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    return null;
  }

  isInstalled(): boolean {
    return existsSync(this.binPath()) && this.listModels().length > 0;
  }

  status(): WhisperStatus {
    return {
      installed: this.isInstalled(),
      running: this.proc !== null && this.port !== null,
      loading: this.loading,
      port: this.port,
      model: this.activeModel,
      models: this.listModels(),
      error: this.lastError
    };
  }

  private emit(): void {
    this.onChange?.(this.status());
  }

  private async findFreePort(preferred = 8471): Promise<number> {
    const tryPort = (p: number): Promise<number | null> =>
      new Promise((resolve) => {
        const srv = createServer();
        srv.once('error', () => resolve(null));
        srv.once('listening', () => srv.close(() => resolve(p)));
        srv.listen(p, '127.0.0.1');
      });
    for (let p = preferred; p < preferred + 40; p++) {
      const ok = await tryPort(p);
      if (ok) return ok;
    }
    return preferred;
  }

  /** Start (or restart) the server for the given model. Idempotent-ish. */
  async start(model?: string): Promise<WhisperStatus> {
    if (this.proc) {
      if (!model || model === this.activeModel) return this.status();
      await this.stop();
    }
    this.lastError = null;

    if (!existsSync(this.binPath())) {
      this.lastError = 'Whisper binary not found';
      this.emit();
      return this.status();
    }
    const modelPath = this.resolveModelPath(model);
    if (!modelPath) {
      this.lastError = 'No Whisper model found';
      this.emit();
      return this.status();
    }

    this.loading = true;
    this.emit();

    const port = await this.findFreePort();
    const args = [
      '-m', modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-t', String(Math.max(2, Math.min(8, cpus()?.length || 4))),
      '-nt' // no timestamps in output
    ];

    try {
      const proc = spawn(this.binPath(), args, {
        cwd: join(paths.whisperBundled, 'bin'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.proc = proc;
      this.activeModel = model || this.listModels()[0] || null;

      const ready = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok); } };
        const onData = (buf: Buffer): void => {
          const s = buf.toString();
          // whisper.cpp server prints this once it's listening.
          if (/listening|server listening|HTTP server|running on/i.test(s)) done(true);
        };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('error', (err) => { this.lastError = err.message; done(false); });
        proc.on('exit', (code) => {
          if (!settled) { this.lastError = `Whisper server exited (code ${code})`; done(false); }
        });
        // Fallback: assume ready after a short grace period even without the log.
        setTimeout(() => done(true), 4000);
      });

      this.loading = false;

      if (!ready || proc.exitCode !== null) {
        this.proc = null;
        this.port = null;
        if (!this.lastError) this.lastError = 'Whisper server failed to start';
        this.emit();
        return this.status();
      }

      this.port = port;
      proc.on('exit', (code) => {
        logger.info('whisper', `server exited (code ${code})`);
        if (this.proc === proc) {
          this.proc = null;
          this.port = null;
          this.emit();
        }
      });
      logger.info('whisper', `server ready on 127.0.0.1:${port} (${this.activeModel})`);
      this.emit();
      return this.status();
    } catch (err) {
      this.loading = false;
      this.proc = null;
      this.port = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return this.status();
    }
  }

  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    this.port = null;
    if (p) {
      try { p.kill(); } catch { /* ignore */ }
    }
    this.emit();
  }

  /**
   * Transcribe a base64-encoded 16 kHz mono 16-bit WAV via the running server.
   * Starts the server on demand if it isn't up yet.
   */
  async transcribe(wavBase64: string, model?: string): Promise<{ text: string } | { error: string }> {
    if (!this.proc || !this.port) {
      await this.start(model);
    }
    if (!this.port) {
      return { error: this.lastError || 'Whisper server not running' };
    }

    // Write to a temp file and stream it as multipart form-data.
    const tmpDir = join(tmpdir(), 'dero-hive-whisper');
    try { mkdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    const wavPath = join(tmpDir, `rec-${Date.now()}.wav`);
    try {
      writeFileSync(wavPath, Buffer.from(wavBase64, 'base64'));
      const form = new FormData();
      const bytes = Buffer.from(wavBase64, 'base64');
      form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', 'json');
      form.append('temperature', '0.0');

      const res = await fetch(`http://127.0.0.1:${this.port}/inference`, {
        method: 'POST',
        body: form
      });
      if (!res.ok) {
        return { error: `Whisper server error ${res.status}` };
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = (await res.json()) as { text?: string };
        return { text: (data.text || '').trim() };
      }
      const text = await res.text();
      return { text: text.trim() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      try { rmSync(wavPath, { force: true }); } catch { /* ignore */ }
    }
  }
}
