import { useEffect, useState } from 'react';
import type { IntegrationId, IntegrationStatus } from '@shared/types';

const DETAILS: Record<IntegrationId, string> = {
  hologram: 'Optional DERO/TELA desktop app. Hive can start and stop the installed executable.',
  purewolf: 'Native Messaging helper. Your browser owns its lifecycle after registration.',
  hermes: 'External gateway only. Hive never installs or starts the Hermes Python runtime.'
};

function replaceStatus(list: IntegrationStatus[], next: IntegrationStatus): IntegrationStatus[] {
  return list.map((item) => item.id === next.id ? next : item);
}

export function IntegrationsPanel(): JSX.Element {
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Partial<Record<IntegrationId, string>>>({});
  const [busy, setBusy] = useState<IntegrationId | null>(null);

  const load = async (): Promise<void> => {
    setLoadError(null);
    try {
      setStatuses(await window.hive.integrationList());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void load();
    return window.hive.onIntegrationChanged((status) => {
      setStatuses((current) => current ? replaceStatus(current, status) : current);
    });
  }, []);

  const toggleHologram = async (status: IntegrationStatus): Promise<void> => {
    setBusy(status.id);
    setActionErrors((current) => ({ ...current, [status.id]: undefined }));
    try {
      const next = status.running
        ? await window.hive.integrationStop(status.id)
        : await window.hive.integrationStart(status.id);
      setStatuses((current) => current ? replaceStatus(current, next) : [next]);
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [status.id]: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Integrations</h3>
        <p className="mt-1 text-xs text-fg-muted">
          Optional products stay in their own processes. Hive reports availability and manages only Hologram.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
          <span>Integration status could not be loaded: {loadError}</span>
          <button type="button" onClick={() => void load()} className="rounded-md border border-danger/30 px-2.5 py-1 font-medium hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Retry
          </button>
        </div>
      )}

      {!statuses && !loadError ? (
        <p role="status" className="rounded-xl border border-border bg-bg-elev/50 p-4 text-sm text-fg-muted">Checking integrations…</p>
      ) : (
        <div className="space-y-2" aria-live="polite">
          {statuses?.map((status) => {
            const available = status.id === 'hermes' ? status.installed : status.running || status.installed;
            const label = status.running ? 'Running' : status.id === 'hermes' ? (status.installed ? 'Configured' : 'Not configured') : (status.installed ? 'Installed' : 'Not installed');
            const error = actionErrors[status.id] || status.error;

            return (
              <article key={status.id} className="relative overflow-hidden rounded-xl border border-border bg-bg-elev/50 p-4">
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-0.5 ${status.running ? 'bg-success' : available ? 'bg-accent' : 'bg-fg-subtle/40'}`} />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium text-fg">{status.name}</h4>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.running ? 'bg-success/15 text-success' : available ? 'bg-accent-soft text-accent' : 'bg-bg-sidebar text-fg-subtle'}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.running ? 'bg-success' : available ? 'bg-accent' : 'bg-fg-subtle'}`} />
                        {label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{DETAILS[status.id]}</p>
                    {status.id === 'hologram' && !status.installed && (
                      <p className="mt-2 text-[11px] text-fg-subtle">Stage Hologram.exe for release packaging or set DERO_HIVE_HOLOGRAM_PATH before starting Hive.</p>
                    )}
                    {status.id === 'purewolf' && (
                      <p className="mt-2 text-[11px] text-fg-subtle">Register the native host with Chrome or Edge; the browser starts it when the extension connects.</p>
                    )}
                    {status.id === 'hermes' && (
                      <p className="mt-2 truncate font-mono text-[11px] text-fg-subtle" title={status.endpoint ?? undefined}>
                        {status.endpoint ?? 'Set HERMES_GATEWAY_URL before starting Hive.'}
                      </p>
                    )}
                    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
                  </div>

                  {status.id === 'hologram' && (
                    <button
                      type="button"
                      onClick={() => void toggleHologram(status)}
                      disabled={busy === status.id || (!status.installed && !status.running)}
                      className="flex-shrink-0 rounded-lg border border-border bg-bg-input px-3 py-1.5 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-bg-elev disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {busy === status.id ? 'Working…' : status.running ? 'Stop' : 'Start'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
