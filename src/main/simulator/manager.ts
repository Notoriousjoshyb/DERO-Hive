import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { IPC } from '@shared/types';
import type { SimulatorStatus, SimulatorStartOptions } from '@shared/types';

const DEFAULT_BIN_NAME = process.platform === 'win32' ? 'derod-simulator.exe' : 'derod-simulator';
const SECONDARY_BIN_NAME = process.platform === 'win32' ? 'simulator.exe' : 'simulator';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 8_000;

/**
 * Manages the DERO blockchain simulator (`derod-simulator`) as a child process.
 * The simulator is sourced from cmd/simulator in DEROFDN/derohe and is intended
 * to be either bundled in `resources/simulator/bin/` or provided by the user.
 *
 * Only one simulator instance can run at a time. stdout/stderr are streamed
 * verbatim to the renderer so they can be displayed in the in-app terminal.
 */
export class SimulatorManager {
  private proc: ChildProcess | null = null;
  private starting = false;
  private binaryPath: string | null = null;
  private args: string[] = [];
  private cwd: string | null = null;
  private startedAt: number | null = null;
  private exitCode: number | null = null;
  private lastError: string | null = null;
  private readonly onChange?: (status: SimulatorStatus) => void;

  constructor(onChange?: (status: SimulatorStatus) => void) {
    this.onChange = onChange;
  }

  /** Best-effort guess at where a usable simulator binary lives. */
  static detectBinaryPath(override?: string): string | null {
    const candidates: string[] = [];
    const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');

    // 1. Explicit override.
    if (override && override.trim().length > 0) candidates.push(override.trim());

    // 2. Bundled in resources/simulator/bin (e.g. shipped with the installer).
    candidates.push(join(resourcesRoot, 'simulator', 'bin', DEFAULT_BIN_NAME));
    candidates.push(join(resourcesRoot, 'simulator', 'bin', SECONDARY_BIN_NAME));

    // 3. Dev tree location (resources/simulator/bin from app root).
    candidates.push(join(app.getAppPath(), 'resources', 'simulator', 'bin', DEFAULT_BIN_NAME));
    candidates.push(join(app.getAppPath(), 'resources', 'simulator', 'bin', SECONDARY_BIN_NAME));

    // 4. User-provided copy in app userData.
    candidates.push(join(app.getPath('userData'), 'simulator', DEFAULT_BIN_NAME));
    candidates.push(join(app.getPath('userData'), 'simulator', SECONDARY_BIN_NAME));

    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    return null;
  }

  status(): SimulatorStatus {
    const knownBinary = this.binaryPath && existsSync(this.binaryPath)
      ? this.binaryPath
      : SimulatorManager.detectBinaryPath();
    return {
      installed: knownBinary !== null,
      running: this.proc !== null,
      starting: this.starting,
      pid: this.proc?.pid ?? null,
      binaryPath: this.binaryPath,
      args: this.args,
      cwd: this.cwd,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      error: this.lastError
    };
  }

  async start(options: SimulatorStartOptions = {}): Promise<SimulatorStatus> {
    if (this.proc || this.starting) return this.status();

    const resolved = SimulatorManager.detectBinaryPath(options.binaryPath);
    this.binaryPath = resolved ?? options.binaryPath?.trim() ?? null;

    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      this.lastError = `Simulator binary not found. Place "${DEFAULT_BIN_NAME}" in resources/simulator/bin (or set a custom path via SIMULATOR_START).`;
      this.emit();
      return this.status();
    }

    this.lastError = null;
    this.exitCode = null;
    this.starting = true;
    // Default to a writable data dir under userData. Note: cmd/simulator's
    // docopt usage has no "--simulator" flag; passing unknown flags makes it
    // print usage and exit immediately.
    const dataDir = join(app.getPath('userData'), 'simulator-data');
    try { mkdirSync(dataDir, { recursive: true }); } catch { /* best-effort */ }
    this.args = options.args ?? [`--data-dir=${dataDir}`];
    this.cwd = options.cwd ?? dataDir;
    this.emit();

    logger.info('simulator', `starting ${this.binaryPath} ${this.args.join(' ')}`);

    return new Promise<SimulatorStatus>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = `Simulator failed to start within ${START_TIMEOUT_MS}ms.`;
        this.starting = false;
        this.emit(resolve);
      }, START_TIMEOUT_MS);

      try {
        const child = spawn(this.binaryPath!, this.args, {
          cwd: this.cwd ?? undefined,
          env: { ...process.env, ...(options.env ?? {}) },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        this.proc = child;
        this.startedAt = Date.now();

        const onStream = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
          const data = chunk.toString('utf8');
          this.sendOutput(stream, data);
        };

        child.stdout?.on('data', onStream('stdout'));
        child.stderr?.on('data', onStream('stderr'));

        child.on('error', (err) => {
          logger.error('simulator', 'spawn error', err);
          this.lastError = err.message;
        });

        child.on('exit', (code, signal) => {
          logger.info('simulator', `exited code=${code} signal=${signal}`);
          this.exitCode = code;
          this.proc = null;
          this.startedAt = null;
          if (settled) {
            this.starting = false;
            this.emit();
          } else {
            settled = true;
            clearTimeout(timer);
            this.starting = false;
            // If it exited before we marked it started, it's a failure.
            if (code !== 0 && code !== null) {
              this.lastError = `Simulator exited with code ${code}`;
            }
            this.emit(resolve);
          }
        });

        // Once we've hooked everything up, declare "running" even if the
        // process hasn't emitted anything yet. We treat the child being alive
        // as success.
        settled = true;
        clearTimeout(timer);
        this.starting = false;
        this.emit(resolve);
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
        }
        this.lastError = err instanceof Error ? err.message : String(err);
        this.starting = false;
        this.emit(resolve);
      }
    });
  }

  async stop(): Promise<SimulatorStatus> {
    if (!this.proc) {
      this.starting = false;
      this.emit();
      return this.status();
    }

    const proc = this.proc;
    const exited = new Promise<void>((resolve) => {
      if (!proc) return resolve();
      proc.once('exit', () => resolve());
      try {
        if (process.platform === 'win32') {
          // Try graceful, then force.
          proc.kill();
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        // already gone
        resolve();
      }
    });

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));

    await Promise.race([exited, timeout]);

    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.proc = null;
      this.startedAt = null;
    }

    this.starting = false;
    this.emit();
    return this.status();
  }

  async restart(options: SimulatorStartOptions = {}): Promise<SimulatorStatus> {
    await this.stop();
    return this.start(options);
  }

  private sendOutput(stream: 'stdout' | 'stderr', data: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SIMULATOR_OUTPUT, { stream, data });
    }
  }

  private emit(extra?: (s: SimulatorStatus) => void): void {
    const s = this.status();
    try {
      this.onChange?.(s);
    } catch (err) {
      logger.error('simulator', 'onChange handler threw', err);
    }
    if (extra) extra(s);
  }
}
