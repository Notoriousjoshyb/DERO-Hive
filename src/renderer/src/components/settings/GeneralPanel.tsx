import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { WhisperStatus, AppSettings } from '@shared/types';

interface AudioDevice {
  deviceId: string;
  label: string;
}

export function GeneralPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDevice[]>([]);
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);

  useEffect(() => {
    async function loadDevices(): Promise<void> {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 8)}` }));
        setAudioInputDevices(audioInputs);
      } catch {
        setAudioInputDevices([]);
      }
    }
    void loadDevices();
    void window.hive.whisperStatus().then(setWhisper);
    const off = window.hive.onWhisperStatus(setWhisper);
    return () => off();
  }, []);

  const toggleWhisper = async (enabled: boolean): Promise<void> => {
    await updateSettings({ whisperEnabled: enabled });
    setWhisper(enabled ? await window.hive.whisperStart(settings.whisperModel) : await window.hive.whisperStop());
  };

  const changeWhisperModel = async (model: string): Promise<void> => {
    await updateSettings({ whisperModel: model });
    if (settings.whisperEnabled !== false) setWhisper(await window.hive.whisperStart(model));
  };

  const defaultProvider = providers.find((p) => p.id === settings.defaultProviderId);
  return (
    <div className="space-y-6 max-w-xl">
      <Section title="Appearance">
        <Field label="Theme">
          <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })} className="input">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </Field>
        <Field label="Interface font">
          <select value={settings.interfaceFont || 'inter'} onChange={(e) => updateSettings({ interfaceFont: e.target.value as AppSettings['interfaceFont'] })} className="input">
            <option value="inter">Inter</option>
            <option value="system">System UI</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </Field>
        <Field label="Code font">
          <select value={settings.codeFont || 'jetbrains-mono'} onChange={(e) => updateSettings({ codeFont: e.target.value as AppSettings['codeFont'] })} className="input">
            <option value="jetbrains-mono">JetBrains Mono</option>
            <option value="fira-code">Fira Code</option>
            <option value="consolas">Consolas</option>
            <option value="mono">Monospace</option>
          </select>
        </Field>
        <Field label="Interface font size" hint="Base text scale as a percentage.">
          <Stepper
            value={settings.interfaceFontSize ?? 120}
            defaultValue={120}
            min={50}
            max={200}
            step={5}
            unit="%"
            onChange={(v) => updateSettings({ interfaceFontSize: v })}
          />
        </Field>
        
        <Field label="Terminal font size" hint="Font size for terminal panels.">
          <Stepper
            value={settings.terminalFontSize ?? 15}
            defaultValue={15}
            min={8}
            max={32}
            step={1}
            unit="px"
            onChange={(v) => updateSettings({ terminalFontSize: v })}
          />
        </Field>
        
        <Field label="Spacing density" hint="Padding and gap density across the chat.">
          <Stepper
            value={settings.spacingDensity ?? 100}
            defaultValue={100}
            min={50}
            max={200}
            step={5}
            unit="%"
            onChange={(v) => updateSettings({ spacingDensity: v })}
          />
        </Field>
        
        <Field label="Input bar offset" hint="Distance of the composer from the window bottom.">
          <Stepper
            value={settings.inputBarOffset ?? 0}
            defaultValue={0}
            min={0}
            max={200}
            step={5}
            unit="px"
            onChange={(v) => updateSettings({ inputBarOffset: v })}
          />
        </Field>
        
        <Field label="Font size" hint="Controls the base font size across the app (13 / 14 / 16 px).">
          <select value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: e.target.value as 'small' | 'medium' | 'large' })} className="input">
            <option value="small">Small (13px)</option>
            <option value="medium">Medium (14px)</option>
            <option value="large">Large (16px)</option>
          </select>
        </Field>
        
        <Field label="Code editor theme" hint="Syntax colours for the Code tab editor.">
          <select
            value={settings.codeTheme || 'vscode'}
            onChange={(e) => updateSettings({ codeTheme: e.target.value as 'vscode' | 'onedark' | 'dracula' | 'monokai' })}
            className="input"
          >
            <option value="vscode">VS Code Dark+</option>
            <option value="onedark">One Dark</option>
            <option value="dracula">Dracula</option>
            <option value="monokai">Monokai</option>
          </select>
        </Field>

        <Field label="Accent colour" hint="Overrides the theme accent everywhere. Reset to return to the default.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.accentColor || '#c26647'}
              onChange={(e) => updateSettings({ accentColor: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border p-0.5"
            />
            {settings.accentColor && (
              <button
                onClick={() => updateSettings({ accentColor: undefined })}
                className="btn-secondary text-xs"
              >
                Reset
              </button>
            )}
          </div>
        </Field>

        <Field label="Custom CSS" hint="Injected after the app's styles — targets any selector. Leave empty to disable.">
          <textarea
            value={settings.customCss || ''}
            onChange={(e) => updateSettings({ customCss: e.target.value || undefined })}
            placeholder={'.prose-hive { line-height: 1.8; }\n[data-message-id] { border-radius: 4px; }'}
            rows={5}
            spellCheck={false}
            className="input w-full resize-y font-mono text-xs leading-relaxed"
          />
        </Field>
      </Section>

      <Section title="Default model">
        <Field label="Provider" hint="Auto-selected when the app starts or no model is chosen.">
          <select
            value={settings.defaultProviderId || ''}
            onChange={(e) => updateSettings({ defaultProviderId: e.target.value || undefined, defaultModelId: undefined })}
            className="input"
          >
            <option value="">(none — pick on first chat)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Model" hint="Star models in the dropdown to keep your favourites handy.">
          <select
            value={settings.defaultModelId || ''}
            onChange={(e) => updateSettings({ defaultModelId: e.target.value || undefined })}
            className="input"
            disabled={!defaultProvider}
          >
            <option value="">(use first available)</option>
            {(defaultProvider?.models || []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
        {(settings.favouriteModels || []).length > 0 && (
          <Field label="Favourites" hint="Click the ★ in the model dropdown to add/remove.">
            <div className="flex flex-wrap gap-1.5">
              {(settings.favouriteModels || []).map((key) => {
                const [pid, mid] = key.split(':');
                const p = providers.find((pp) => pp.id === pid);
                const m = p?.models.find((mm) => mm.id === mid);
                if (!p || !m) return null;
                return (
                  <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bg-elev border border-border text-xs">
                    <span className="text-warn">★</span>
                    <span className="text-fg-muted">{p.name}</span>
                    <span className="text-fg">/</span>
                    <span className="text-fg">{m.name}</span>
                  </span>
                );
              })}
            </div>
          </Field>
        )}
      </Section>

      <Section title="Behavior">
        <Field label="Press Enter to send" hint="When off, use Shift+Enter to send.">
          <input type="checkbox" checked={settings.sendOnEnter} onChange={(e) => updateSettings({ sendOnEnter: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        <Field label="Auto-generate conversation titles">
          <input type="checkbox" checked={settings.autoTitle} onChange={(e) => updateSettings({ autoTitle: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        <Field label="Show token usage" hint="Display token counts under assistant messages.">
          <input type="checkbox" checked={settings.showTokenUsage} onChange={(e) => updateSettings({ showTokenUsage: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        <Field label="Desktop notifications" hint="Notify when a response finishes while the window is in the background.">
          <input type="checkbox" checked={settings.desktopNotifications ?? true} onChange={(e) => updateSettings({ desktopNotifications: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        <Field label="Show reasoning" hint="Display extended thinking content when supported.">
          <input type="checkbox" checked={settings.showReasoning} onChange={(e) => updateSettings({ showReasoning: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        <Field label="Tool approval">
          <select value={settings.toolApprovalMode} onChange={(e) => updateSettings({ toolApprovalMode: e.target.value as 'always' | 'project' | 'never' })} className="input">
            <option value="always">Always ask</option>
            <option value="project">Ask per project</option>
            <option value="never">Never ask</option>
          </select>
        </Field>
      </Section>

      <Section title="Voice">
        <div className="rounded-lg border border-border bg-bg-elev/50 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Local Whisper (offline STT)</span>
              <WhisperBadge status={whisper} />
            </div>
            <input
              type="checkbox"
              checked={settings.whisperEnabled !== false}
              onChange={(e) => void toggleWhisper(e.target.checked)}
              disabled={!whisper?.installed}
              className="accent-accent w-4 h-4"
            />
          </div>
          {whisper?.installed ? (
            <>
              <p className="text-xs text-fg-subtle leading-relaxed">
                Runs whisper.cpp on your machine — starts with the app and shuts down when you quit. Nothing leaves your computer.
              </p>
              {whisper.models.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-fg-muted">Model</span>
                  <select
                    value={settings.whisperModel || whisper.model || whisper.models[0]}
                    onChange={(e) => void changeWhisperModel(e.target.value)}
                    className="input text-xs"
                  >
                    {whisper.models.map((m) => (
                      <option key={m} value={m}>{m.replace(/^ggml-|\.bin$/g, '')}</option>
                    ))}
                  </select>
                </div>
              )}
              {whisper.error && <div className="text-xs text-danger">{whisper.error}</div>}
            </>
          ) : (
            <p className="text-xs text-fg-subtle leading-relaxed">
              Whisper binary/model not found in <span className="font-mono">resources/whisper</span>. Add a model file (ggml-*.bin) to enable offline dictation.
            </p>
          )}
        </div>

        <Field label="Microphone" hint="Select the microphone device for voice input.">
          <select
            value={settings.microphoneDeviceId || ''}
            onChange={(e) => void updateSettings({ microphoneDeviceId: e.target.value || undefined })}
            className="input"
          >
            <option value="">System default</option>
            {audioInputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Recording sounds" hint="Play a beep when starting/stopping recording.">
          <input
            type="checkbox"
            checked={settings.voiceNotificationSounds ?? true}
            onChange={(e) => void updateSettings({ voiceNotificationSounds: e.target.checked })}
            className="accent-accent w-4 h-4"
          />
        </Field>
        {settings.voiceNotificationSounds && (
          <Field label="Notification volume">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.voiceNotificationVolume ?? 0.5}
              onChange={(e) => void updateSettings({ voiceNotificationVolume: parseFloat(e.target.value) })}
              className="w-24"
            />
          </Field>
        )}
        <Field label="STT Endpoint" hint="Fallback custom STT server, used only when local Whisper is off/unavailable.">
          <input
            type="text"
            value={settings.voiceSttEndpoint || ''}
            onChange={(e) => void updateSettings({ voiceSttEndpoint: e.target.value || undefined })}
            placeholder="http://localhost:2700"
            className="input flex-1 font-mono text-xs"
          />
        </Field>
        <div className="text-xs text-fg-subtle mt-1">
          {audioInputDevices.length === 0 && 'No microphones detected. Click the mic button in the chat to grant permission.'}
        </div>
      </Section>

      <Section title="About">
        <div className="text-sm text-fg-muted">
          DERO Hive v0.1.0 — A feature-rich AI harness.
        </div>
      </Section>

      <style>{`
        .input {
          background: var(--bg-input);
          border: 1px solid var(--border);
          color: var(--fg);
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 13px;
        }
        .input:focus { outline: none; border-color: var(--accent); }
        .input:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-secondary {
          background: var(--bg-input);
          border: 1px solid var(--border);
          color: var(--fg);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .btn-secondary:hover { background: var(--bg-elev); }
      `}</style>
    </div>
  );
}

function WhisperBadge({ status }: { status: WhisperStatus | null }): JSX.Element {
  if (!status) return <span className="text-[10px] text-fg-subtle">checking…</span>;
  if (!status.installed) return <Pill color="subtle" label="Not installed" />;
  if (status.loading) return <Pill color="warn" label="Starting…" />;
  if (status.running) return <Pill color="success" label="Running" />;
  if (status.error) return <Pill color="danger" label="Error" />;
  return <Pill color="subtle" label="Stopped" />;
}

function Pill({ color, label }: { color: 'success' | 'warn' | 'danger' | 'subtle'; label: string }): JSX.Element {
  const cls = color === 'success' ? 'bg-success/15 text-success'
    : color === 'warn' ? 'bg-warn/15 text-warn'
    : color === 'danger' ? 'bg-danger/15 text-danger'
    : 'bg-bg-input text-fg-subtle';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {(color === 'success' || color === 'warn') && <span className={`w-1.5 h-1.5 rounded-full ${color === 'success' ? 'bg-success' : 'bg-warn animate-pulse'}`} />}
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-fg-subtle mt-0.5">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stepper({ value, defaultValue, min, max, step, unit, onChange }: {
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}): JSX.Element {
  const change = (delta: number): void => {
    const next = Math.min(max, Math.max(min, value + delta * step));
    if (next !== value) onChange(next);
  };
  const reset = (): void => {
    if (value !== defaultValue) onChange(defaultValue);
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => change(-1)}
        className="w-7 h-7 rounded-md bg-bg-input border border-border text-fg hover:bg-bg-elev hover:border-border-strong transition flex items-center justify-center"
        aria-label="Decrease"
      >
        −
      </button>
      <div className="min-w-[4.5rem] text-center text-sm font-medium tabular-nums">
        {value}
        <span className="text-fg-subtle text-xs ml-0.5">{unit}</span>
      </div>
      <button
        onClick={() => change(1)}
        className="w-7 h-7 rounded-md bg-bg-input border border-border text-fg hover:bg-bg-elev hover:border-border-strong transition flex items-center justify-center"
        aria-label="Increase"
      >
        +
      </button>
      <button
        onClick={reset}
        disabled={value === defaultValue}
        className="text-xs text-fg-subtle hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed px-1 py-0.5 rounded transition"
        title="Revert to default"
      >
        Revert
      </button>
    </div>
  );
}
