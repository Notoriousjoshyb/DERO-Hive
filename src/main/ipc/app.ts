import { ipcMain, shell, app } from 'electron';
import { IPC } from '@shared/types';
import { logger } from '../utils/logger';

const GITHUB_REPO = 'Notoriousjoshyb/DERO-Hive';

function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProjectReleaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && (parsed.pathname === `/${GITHUB_REPO}/releases` || parsed.pathname.startsWith(`/${GITHUB_REPO}/releases/`));
  } catch {
    return false;
  }
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0).slice(0, 3);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, (_e, url: string) => {
    if (!isAllowedExternalUrl(url)) throw new Error(`URL not allowed: ${url}`);
    return shell.openExternal(url);
  });
  ipcMain.handle(IPC.APP_PLATFORM, () => process.platform);
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());

  // Query GitHub for the newest release (falling back to tags when the repo
  // has no formal releases yet) and compare against the running version.
  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    const current = app.getVersion();
    const headers = { 'User-Agent': 'DERO-Hive', Accept: 'application/vnd.github+json' };
    try {
      let latest = '';
      let url = `https://github.com/${GITHUB_REPO}/releases/latest`;
      let assetUrl: string | undefined;
      let assetName: string | undefined;
      let notes = '';

      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
      if (r.ok) {
        const rel = await r.json() as {
          tag_name?: string; name?: string; html_url?: string; body?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        latest = rel.tag_name || rel.name || '';
        url = rel.html_url || url;
        notes = (rel.body || '').slice(0, 2000);
        // Pick the installer asset matching this platform so one click updates.
        const ext = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.appimage';
        const asset = (rel.assets || []).find((a) => a.name?.toLowerCase().endsWith(ext));
        if (asset?.browser_download_url) {
          assetUrl = asset.browser_download_url;
          assetName = asset.name;
        }
      } else if (r.status === 404) {
        // No releases published — fall back to the newest tag.
        const t = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=1`, { headers });
        if (t.ok) {
          const tags = await t.json() as Array<{ name?: string }>;
          latest = tags[0]?.name || '';
          url = `https://github.com/${GITHUB_REPO}/tags`;
        }
      } else {
        return { ok: false, current, error: `GitHub returned ${r.status}` };
      }

      if (!latest) {
        return { ok: true, current, updateAvailable: false, noReleases: true };
      }
      const updateAvailable = isNewer(latest, current);
      logger.info('update', `check: current=${current} latest=${latest} available=${updateAvailable}`);
      return { ok: true, current, latest, updateAvailable, url, assetUrl, assetName, notes };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('update', `check failed: ${msg}`);
      return { ok: false, current, error: msg };
    }
  });

  // Installers must be code-signed and verified before the app executes them.
  // Until release verification is implemented, route users to the canonical
  // GitHub release page rather than downloading and launching arbitrary files.
  ipcMain.handle(IPC.UPDATE_INSTALL, async (_e, a: { assetUrl?: string; assetName?: string; url: string }) => {
    try {
      if (!isProjectReleaseUrl(a.url)) throw new Error('Invalid release URL');
      await shell.openExternal(a.url);
      return { ok: true, launched: false };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
