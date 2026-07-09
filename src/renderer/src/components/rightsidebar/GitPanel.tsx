import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app';

interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export function GitPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cwd = settings.workingDirectory;

  useEffect(() => {
    if (!cwd) {
      setStatus(null);
      setCommits([]);
      return;
    }
    void loadGitInfo();
  }, [cwd]);

  async function loadGitInfo(): Promise<void> {
    if (!cwd) return;
    setLoading(true);
    setError(null);

    try {
      const statusResult = await window.hive.shellRun('git status --porcelain', { cwd });
      const branchResult = await window.hive.shellRun('git branch --show-current', { cwd });
      const logResult = await window.hive.shellRun('git log --oneline -10', { cwd });

      if (statusResult.error) {
        setError('Not a git repository');
        setStatus(null);
        return;
      }

      const branch = branchResult.stdout.trim() || 'main';
      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const line of statusResult.stdout.split('\n')) {
        if (!line.trim()) continue;
        // Porcelain format: X = index (staged) status, Y = worktree status.
        const x = line[0];
        const y = line[1];
        const file = line.slice(3).trim() || line.slice(2).trim();
        if (x === '?' && y === '?') { untracked.push(file); continue; }
        if (x && x !== ' ' && x !== '?') staged.push(file);
        if (y && y !== ' ' && y !== '?') modified.push(file);
      }

      const commitList: GitCommit[] = [];
      for (const l of logResult.stdout.trim().split('\n')) {
        if (!l) continue;
        const spaceIdx = l.indexOf(' ');
        if (spaceIdx > 0) {
          commitList.push({
            hash: l.slice(0, spaceIdx),
            message: l.slice(spaceIdx + 1),
            author: '',
            date: ''
          });
        }
      }

      setStatus({ branch, ahead: 0, behind: 0, staged, modified, untracked });
      setCommits(commitList);
    } catch {
      setError('Failed to load git info');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  if (!cwd) {
    return (
      <div className="p-4 text-center text-fg-subtle text-sm">
        <div className="text-2xl mb-2">📁</div>
        <p>No working directory set</p>
        <p className="text-xs mt-1">Set a project folder in Settings to enable Git features</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-center text-fg-subtle text-sm">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-center text-fg-subtle text-sm">
        <div className="text-2xl mb-2">⚠</div>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {status && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-medium">{status.branch}</span>
            {status.ahead > 0 && <span className="text-xs text-fg-subtle">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-xs text-fg-subtle">↓{status.behind}</span>}
          </div>

          {status.staged.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Staged</div>
              {status.staged.map((f) => (
                <div key={f} className="text-xs text-success truncate">{f}</div>
              ))}
            </div>
          )}

          {status.modified.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Modified</div>
              {status.modified.map((f) => (
                <div key={f} className="text-xs text-warning truncate">{f}</div>
              ))}
            </div>
          )}

          {status.untracked.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Untracked</div>
              {status.untracked.map((f) => (
                <div key={f} className="text-xs text-fg-muted truncate">{f}</div>
              ))}
            </div>
          )}
        </>
      )}

      {commits.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-2">Recent commits</div>
          {commits.map((c) => (
            <div key={c.hash} className="mb-2">
              <div className="text-xs font-mono text-fg-subtle">{c.hash.slice(0, 7)}</div>
              <div className="text-xs text-fg truncate">{c.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
