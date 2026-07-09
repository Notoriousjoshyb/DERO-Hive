import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../stores/app';
import { blobToWhisperWavBase64, pcmToWhisperWavBase64 } from '../lib/audioWav';
import type { WhisperStatus } from '@shared/types';

interface Props {
  // Emits the FULL transcript of the current utterance on each update.
  onResult: (text: string, isFinal: boolean) => void;
}

interface SpeechRecognitionType { new (): SpeechRecognitionInstance }
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent { results: SpeechRecognitionResultList }
interface SpeechRecognitionResultList { length: number; [index: number]: SpeechRecognitionResult }
interface SpeechRecognitionResult { isFinal: boolean; length: number; [index: number]: { transcript: string } }
interface SpeechRecognitionErrorEvent { error: string; message: string }

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionType;
    webkitSpeechRecognition?: SpeechRecognitionType;
  }
}

type Mode = 'whisper' | 'endpoint' | 'browser';
type State = 'idle' | 'recording' | 'transcribing';

const LIVE_INTERVAL_MS = 1400;

export function VoiceInput({ onResult }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);

  // Shared
  const streamRef = useRef<MediaStream | null>(null);
  // Endpoint (MediaRecorder) path
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Browser speech path
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Whisper live path
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const captureRateRef = useRef<number>(48000);
  const liveTimerRef = useRef<number | null>(null);
  const tickBusyRef = useRef<boolean>(false);
  const lastLenRef = useRef<number>(0);
  const lastFullRef = useRef<string>('');

  const sttEndpoint = settings.voiceSttEndpoint;
  const mode: Mode = whisper?.installed ? 'whisper' : sttEndpoint ? 'endpoint' : 'browser';

  useEffect(() => {
    let mounted = true;
    void window.hive.whisperStatus().then((s) => { if (mounted) setWhisper(s); });
    const off = window.hive.onWhisperStatus((s) => setWhisper(s));
    return () => { mounted = false; off(); };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => () => { teardown(); }, []);

  const playNotificationSound = useCallback((type: 'start' | 'stop') => {
    if (settings.voiceNotificationSounds === false) return;
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const vol = (settings.voiceNotificationVolume ?? 0.5) * 0.3;
      osc.type = 'sine';
      const t0 = ctx.currentTime;
      osc.frequency.setValueAtTime(type === 'start' ? 660 : 550, t0);
      osc.frequency.exponentialRampToValueAtTime(type === 'start' ? 990 : 380, t0 + 0.12);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.start(t0);
      osc.stop(t0 + 0.16);
      osc.onended = () => { void ctx.close(); };
    } catch { /* ignore */ }
  }, [settings.voiceNotificationSounds, settings.voiceNotificationVolume]);

  const micConstraints = (): MediaStreamConstraints => ({
    audio: settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : true
  });

  function teardown(): void {
    if (liveTimerRef.current !== null) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { /* ignore */ } recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { try { mediaRecorderRef.current.stop(); } catch { /* ignore */ } }
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    sourceNodeRef.current = null;
    if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }

  // ————— Whisper live capture —————
  const buildPcm = (): Float32Array => {
    const chunks = pcmChunksRef.current;
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Float32Array(len);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  };

  const transcribePcm = async (isFinal: boolean): Promise<void> => {
    const pcm = buildPcm();
    if (pcm.length < captureRateRef.current * 0.35) { if (isFinal) setState('idle'); return; } // <0.35s
    const wav = pcmToWhisperWavBase64(pcm, captureRateRef.current);
    const res = await window.hive.whisperTranscribe(wav, settings.whisperModel);
    if ('error' in res) { if (isFinal) setError(res.error); return; }
    if (res.text) onResult(res.text, isFinal);
  };

  const startWhisperLive = async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    streamRef.current = stream;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    captureRateRef.current = ctx.sampleRate;
    pcmChunksRef.current = [];
    lastLenRef.current = 0;

    const source = ctx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      pcmChunksRef.current.push(new Float32Array(ch));
    };
    // Route through a muted gain so onaudioprocess fires without echoing to speakers.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);

    // Periodically transcribe the growing utterance for a live-typing effect.
    liveTimerRef.current = window.setInterval(() => {
      if (tickBusyRef.current) return;
      let total = 0;
      for (const c of pcmChunksRef.current) total += c.length;
      if (total === lastLenRef.current) return; // no new audio
      lastLenRef.current = total;
      tickBusyRef.current = true;
      void transcribePcm(false).finally(() => { tickBusyRef.current = false; });
    }, LIVE_INTERVAL_MS);
  };

  // ————— Endpoint (record then POST once) —————
  const startEndpointRecording = async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    streamRef.current = stream;
    audioChunksRef.current = [];
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (blob.size < 1200) { setState('idle'); return; }
      setState('transcribing');
      try { await sendToEndpoint(blob); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setState('idle'); }
    };
    mr.start();
  };

  const sendToEndpoint = async (blob: Blob): Promise<void> => {
    const endpoint = sttEndpoint || 'http://localhost:2700/transcribe';
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: btoa(bin), format: 'webm' })
    });
    if (res.ok) { const r = await res.json(); if (r.text) onResult(r.text, true); }
    else setError(`STT endpoint error ${res.status}`);
  };

  // ————— Browser Web Speech (live, cumulative) —————
  const startBrowserSpeech = async (): Promise<void> => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('Speech recognition not supported');
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    streamRef.current = stream;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (event) => {
      let full = '';
      for (let i = 0; i < event.results.length; i++) full += event.results[i][0]?.transcript || '';
      lastFullRef.current = full.trim();
      onResult(lastFullRef.current, false);
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'network' || event.error === 'service-not-allowed') setError('Browser speech unavailable. Local Whisper is recommended.');
      else if (event.error === 'not-allowed') setError('Microphone permission denied');
      else setError(event.error);
    };
    rec.onend = () => { stop(true); };
    rec.start();
    recognitionRef.current = rec;
  };

  const start = async (): Promise<void> => {
    setError(null);
    lastFullRef.current = '';
    try {
      if (mode === 'whisper') await startWhisperLive();
      else if (mode === 'browser') await startBrowserSpeech();
      else await startEndpointRecording();
      setState('recording');
      playNotificationSound('start');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('NotAllowed') || msg.includes('Permission')) setError('Microphone permission denied');
      else if (msg.includes('NotFound')) setError('No microphone found');
      else setError(msg);
      setState('idle');
    }
  };

  const stop = (fromEvent = false): void => {
    playNotificationSound('stop');
    if (mode === 'whisper') {
      if (liveTimerRef.current !== null) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
      try { processorRef.current?.disconnect(); } catch { /* ignore */ }
      try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
      setState('transcribing');
      void transcribePcm(true).finally(() => {
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
        if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        processorRef.current = null;
        sourceNodeRef.current = null;
        pcmChunksRef.current = [];
        setState('idle');
      });
    } else if (recognitionRef.current) {
      if (!fromEvent) { try { recognitionRef.current.stop(); } catch { /* ignore */ } }
      recognitionRef.current = null;
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      // Commit the last transcript the browser reported.
      if (lastFullRef.current) onResult(lastFullRef.current, true);
      setState('idle');
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop(); // onstop handles transcription
    } else {
      setState('idle');
    }
  };

  const toggle = (): void => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  };

  const browserUnsupported = mode === 'browser' && !window.SpeechRecognition && !window.webkitSpeechRecognition;

  const title = browserUnsupported
    ? 'Voice input unavailable — enable Whisper in Settings → Voice'
    : state === 'recording'
    ? `Stop (${mode === 'whisper' ? 'Whisper — live' : mode})`
    : state === 'transcribing'
    ? 'Transcribing…'
    : mode === 'whisper'
    ? (whisper?.running ? 'Voice input (local Whisper, live)' : 'Voice input (Whisper starting…)')
    : 'Voice input';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={browserUnsupported || state === 'transcribing'}
        title={error || title}
        className={`p-1.5 rounded transition relative ${
          state === 'recording' ? 'text-danger bg-danger/10'
          : state === 'transcribing' ? 'text-accent'
          : browserUnsupported ? 'text-fg-subtle/40 cursor-not-allowed'
          : 'text-fg-muted hover:text-fg hover:bg-bg-elev'
        }`}
      >
        {state === 'transcribing' ? <SpinnerIcon /> : <MicIcon />}
        {state === 'recording' && (
          <span className="absolute -top-0.5 -right-0.5 flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-70 animate-ping" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-danger" />
          </span>
        )}
        {mode === 'whisper' && state === 'idle' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-success" title="Local Whisper ready" />
        )}
      </button>
      {error && (
        <div
          onClick={() => setError(null)}
          className="absolute bottom-full right-0 mb-2 px-2.5 py-1.5 bg-danger text-white text-[11px] rounded-lg shadow-elev-md w-52 z-50 cursor-pointer leading-snug animate-fade-in"
          title="Click to dismiss"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function MicIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a2.5 2.5 0 00-2.5 2.5v3a2.5 2.5 0 005 0v-3A2.5 2.5 0 008 2z" />
      <path d="M3.5 7.5a4.5 4.5 0 009 0" />
      <path d="M8 12v2" />
      <path d="M5.5 14.5h5" />
    </svg>
  );
}

function SpinnerIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
