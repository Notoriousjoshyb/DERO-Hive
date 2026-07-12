import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { WhisperStatus, AppSettings, ToolApprovalMode, ProviderConfig, ProviderFallback } from '@shared/types';

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

        <Field label="Theme preset" hint="Override the light/dark palette with a curated colour scheme.">
          <select
            value={settings.themePreset || ''}
            onChange={(e) => updateSettings({ themePreset: e.target.value || undefined })}
            className="input"
          >
            <option value="">Default</option>
            <option value="solarized">Solarized Dark</option>
            <option value="nord">Nord</option>
            <option value="catppuccin">Catppuccin Mocha</option>
            <option value="gruvbox">Gruvbox Dark</option>
          </select>
        </Field>

        <Field label="Custom CSS" hint="Injected after the app's styles — targets any selector. Leave empty to disable.">
          <div className="flex flex-col items-end gap-2">
            <textarea
              value={settings.customCss || ''}
              onChange={(e) => updateSettings({ customCss: e.target.value || undefined })}
              placeholder={'.prose-hive { line-height: 1.8; }\n[data-message-id] { border-radius: 4px; }'}
              rows={5}
              spellCheck={false}
              className="input w-full resize-y font-mono text-xs leading-relaxed"
            />
            <button
              onClick={() => void loadCustomCssFromFile(updateSettings)}
              className="btn-secondary text-xs px-2 py-1"
            >
              Load from file
            </button>
          </div>
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
        <Field label="Agent tool rounds" hint="How many model → tool → model cycles one task can take before it stops. Tool permissions still apply.">
          <select
            value={settings.maxAgenticRounds ?? 20}
            onChange={(e) => updateSettings({ maxAgenticRounds: parseInt(e.target.value, 10) })}
            className="input"
          >
            <option value={1}>1 round</option>
            <option value={5}>5 rounds</option>
            <option value={10}>10 rounds</option>
            <option value={20}>20 rounds (default)</option>
            <option value={35}>35 rounds</option>
            <option value={50}>50 rounds</option>
          </select>
        </Field>
        <Field label="Tool approval" hint="Always/never apply to every call. Session and project modes ask once per tool, then remember the decision for the rest of that scope.">
          <select value={settings.toolApprovalMode} onChange={(e) => updateSettings({ toolApprovalMode: e.target.value as ToolApprovalMode })} className="input">
            <option value="always">Always ask</option>
            <option value="session">Ask once per conversation</option>
            <option value="project">Ask once per project</option>
            <option value="never">Never ask</option>
          </select>
        </Field>
        <Field label="Provider fallback chain" hint="If the selected provider errors before producing any output, Hive tries these next, in order.">
          <FallbackChainEditor
            chain={settings.providerFallbackChain || []}
            providers={providers}
            onChange={(chain) => updateSettings({ providerFallbackChain: chain })}
          />
        </Field>
        <Field label="Spellcheck" hint="Use the browser/OS spellchecker on the composer input.">
          <input type="checkbox" checked={settings.spellcheckEnabled !== false} onChange={(e) => updateSettings({ spellcheckEnabled: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        {settings.spellcheckEnabled !== false && (
          <Field label="Spellcheck language">
            <select
              value={settings.spellcheckLanguage || 'en'}
              onChange={(e) => updateSettings({ spellcheckLanguage: e.target.value })}
              className="input"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ru">Russian</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
            </select>
          </Field>
        )}
      </Section>

      <Section title="Focus mode">
        <Field label="Pomodoro timer" hint="Minutes for the focus-mode countdown. 0 disables the timer.">
          <select
            value={settings.focusModeTimerMinutes ?? 25}
            onChange={(e) => updateSettings({ focusModeTimerMinutes: parseInt(e.target.value, 10) })}
            className="input"
          >
            <option value={0}>Off</option>
            <option value={15}>15 minutes</option>
            <option value={25}>25 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={50}>50 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </Field>
        <Field label="Word-count goal" hint="Target number of words while in focus mode. 0 disables the goal.">
          <Stepper
            value={settings.focusModeWordGoal ?? 0}
            defaultValue={0}
            min={0}
            max={10000}
            step={100}
            unit="words"
            onChange={(v) => updateSettings({ focusModeWordGoal: v })}
          />
        </Field>
      </Section>

      <Section title="Voice">
        <Field label="Text-to-speech" hint="Speak assistant responses when they finish.">
          <input type="checkbox" checked={settings.ttsEnabled ?? false} onChange={(e) => updateSettings({ ttsEnabled: e.target.checked })} className="accent-accent w-4 h-4" />
        </Field>
        {settings.ttsEnabled && (
          <Field label="TTS voice">
            <TtsVoiceSelector value={settings.ttsVoiceUri} onChange={(voiceUri) => updateSettings({ ttsVoiceUri: voiceUri || undefined })} />
          </Field>
        )}
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

      <Section title="Usage & budget">
        <Field label="Daily token budget" hint="Show a warning when today's token usage exceeds this threshold. 0 disables the alert.">
          <Stepper
            value={settings.dailyTokenBudget || 0}
            defaultValue={0}
            min={0}
            max={10000000}
            step={10000}
            unit=""
            onChange={(v) => void updateSettings({ dailyTokenBudget: v })}
          />
        </Field>
        <Field label="Monthly token budget" hint="Show a warning when this month's token usage exceeds this threshold. 0 disables the alert.">
          <Stepper
            value={settings.monthlyTokenBudget || 0}
            defaultValue={0}
            min={0}
            max={100000000}
            step={100000}
            unit=""
            onChange={(v) => void updateSettings({ monthlyTokenBudget: v })}
          />
        </Field>
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

function TtsVoiceSelector({ value, onChange }: { value?: string; onChange: (voiceUri?: string) => void }): JSX.Element {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const update = () => setVoices(window.speechSynthesis?.getVoices() || []);
    update();
    window.speechSynthesis?.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
  }, []);

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="input"
    >
      <option value="">Default system voice</option>
      {voices.map((v) => (
        <option key={v.voiceURI} value={v.voiceURI}>
          {v.name} {v.lang ? `(${v.lang})` : ''}
        </option>
      ))}
    </select>
  );
}

async function loadCustomCssFromFile(updateSettings: (s: Partial<AppSettings>) => Promise<void>): Promise<void> {
  try {
    const path = await window.hive.fsPickFile([{ name: 'CSS files', extensions: ['css'] }]);
    if (!path) return;
    const { content } = await window.hive.fsRead(path, { encoding: 'utf-8' });
    await updateSettings({ customCss: content || undefined });
  } catch (err) {
    console.error('Failed to load custom CSS', err);
  }
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

function FallbackChainEditor({ chain, providers, onChange }: {
  chain: ProviderFallback[];
  providers: ProviderConfig[];
  onChange: (chain: ProviderFallback[]) => void;
}): JSX.Element {
  const enabled = providers.filter((p) => p.enabled && p.models.length > 0);
  const modelName = (entry: ProviderFallback): string => {
    const provider = enabled.find((p) => p.id === entry.providerId);
    return provider ? `${provider.name} · ${provider.models.find((m) => m.id === entry.model)?.name || entry.model}` : `${entry.providerId} · ${entry.model} (unavailable)`;
  };
  const move = (index: number, delta: number): void => {
    const next = [...chain];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const remove = (index: number): void => onChange(chain.filter((_, i) => i !== index));
  const add = (): void => {
    const first = enabled[0];
    const model = first?.models[0];
    if (!first || !model) return;
    onChange([...chain, { providerId: first.id, model: model.id }]);
  };
  const update = (index: number, patch: Partial<ProviderFallback>): void => {
    onChange(chain.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  };

  return (
    <div className="space-y-1.5 w-64">
      {chain.length === 0 && <div className="text-xs text-fg-subtle">No fallback configured.</div>}
      {chain.map((entry, index) => {
        const provider = enabled.find((p) => p.id === entry.providerId);
        return (
          <div key={index} className="flex items-center gap-1">
            <select
              value={entry.providerId}
              onChange={(e) => {
                const nextProvider = enabled.find((p) => p.id === e.target.value);
                update(index, { providerId: e.target.value, model: nextProvider?.models[0]?.id || '' });
              }}
              className="input text-xs flex-1 min-w-0"
            >
              {enabled.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={entry.model}
              onChange={(e) => update(index, { model: e.target.value })}
              className="input text-xs flex-1 min-w-0"
            >
              {(provider?.models || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={() => move(index, -1)} disabled={index === 0} className="text-fg-subtle hover:text-fg disabled:opacity-30" title="Move up">↑</button>
            <button onClick={() => move(index, 1)} disabled={index === chain.length - 1} className="text-fg-subtle hover:text-fg disabled:opacity-30" title="Move down">↓</button>
            <button onClick={() => remove(index)} className="text-fg-subtle hover:text-danger" title="Remove">×</button>
          </div>
        );
      })}
      <button onClick={add} disabled={enabled.length === 0} className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline">+ Add fallback</button>
      {chain.length > 0 && (
        <div className="text-[10px] text-fg-subtle pt-0.5">
          {chain.map(modelName).join(' → ')}
        </div>
      )}
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
