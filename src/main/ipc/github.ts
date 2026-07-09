import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { logger } from '../utils/logger';

interface GhIssue {
  type: 'issue' | 'pr';
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  url: string;
  repo: string;
  body: string;
  labels: string[];
  createdAt: string;
  commentCount: number;
}

const GITHUB_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/;

export function registerGithubHandlers(): void {
  ipcMain.handle(IPC.GH_FETCH_URL, async (_e, rawUrl: string): Promise<GhIssue | { error: string }> => {
    try {
      const m = GITHUB_URL.exec(rawUrl.trim());
      if (!m) return { error: 'Not a GitHub issue/PR URL' };
      const [, owner, repo, kind, num] = m;
      const path = kind === 'pull' ? `https://api.github.com/repos/${owner}/${repo}/pulls/${num}` : `https://api.github.com/repos/${owner}/${repo}/issues/${num}`;
      const headers: Record<string, string> = {
        'accept': 'application/vnd.github+json',
        'user-agent': 'dero-hive',
        'x-github-api-version': '2022-11-28'
      };
      const res = await fetch(path, { headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = await res.json();
      const issue: GhIssue = {
        type: kind === 'pull' ? 'pr' : 'issue',
        number: Number(num),
        title: json.title ?? '',
        state: kind === 'pull'
          ? (json.merged ? 'merged' : json.state === 'open' ? 'open' : 'closed')
          : (json.state === 'open' ? 'open' : 'closed'),
        author: json.user?.login ?? '?',
        url: rawUrl,
        repo: `${owner}/${repo}`,
        body: json.body ?? '',
        labels: (json.labels ?? []).map((l: { name?: string }) => l.name).filter(Boolean),
        createdAt: json.created_at ?? '',
        commentCount: json.comments ?? 0
      };
      return issue;
    } catch (err) {
      logger.warn('gh', 'fetch failed', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}