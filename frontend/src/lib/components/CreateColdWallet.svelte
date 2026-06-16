<script>
  // CreateColdWallet — guided cold-wallet genesis flow.
  //
  // Drives the wallet/genesis backend end to end: generate offline → show the
  // seed↔address self-check as a first-class trust signal → reveal the seed
  // (SECRET treatment) → mine the registration PoW (live progress + cancel) →
  // export the paper wallet (0600 file) and/or the DCSP registration blob.
  //
  // The seed is held in component state only while this flow is open and is
  // cleared on close/destroy. It is never logged or persisted by the frontend.
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import {
    GenerateColdWallet,
    MineRegistration,
    CancelColdRegistration,
    RenderPaperWallet,
    ExportRegistrationDCSP,
  } from '../../../wailsjs/go/main/App.js';
  import { addressFingerprint } from '../utils/addressFingerprint.js';

  export let network = 'mainnet'; // "mainnet" | "simulator"

  const dispatch = createEventDispatcher();

  // ── flow state ──────────────────────────────────────────────────────────
  // 'intro' → 'generated' → 'mining' → 'mined'  (plus error overlay)
  let step = 'intro';
  let busy = false;
  let error = '';

  // generated wallet (in-memory; cleared on close)
  let address = '';
  let seed = '';
  let selfCheckOK = false;
  let seedRevealed = false;

  // registration mining
  let attempts = 0;
  let elapsed = 0;
  let registrationHex = '';

  // export feedback
  let exportNote = '';

  $: fingerprint = address ? addressFingerprint(address) : { short: '', checkwords: '' };
  $: seedWords = seed ? seed.trim().split(/\s+/) : [];

  // ── registration events (namespaced — distinct from the hot wallet's) ─────
  const onProgress = (d) => { attempts = d?.attempts ?? attempts; elapsed = d?.elapsed ?? elapsed; };
  const onComplete = (d) => {
    registrationHex = d?.registrationHex ?? '';
    step = 'mined';
    busy = false;
  };
  const onCancelled = () => { step = 'generated'; busy = false; };
  const onFailed = (d) => { error = d?.error || 'Registration failed'; step = 'generated'; busy = false; };

  EventsOn('genesis:registration_progress', onProgress);
  EventsOn('genesis:registration_complete', onComplete);
  EventsOn('genesis:registration_cancelled', onCancelled);
  EventsOn('genesis:registration_failed', onFailed);

  onDestroy(() => {
    EventsOff('genesis:registration_progress');
    EventsOff('genesis:registration_complete');
    EventsOff('genesis:registration_cancelled');
    EventsOff('genesis:registration_failed');
    wipe();
  });

  function wipe() {
    seed = '';
    seedRevealed = false;
  }

  // ── actions ───────────────────────────────────────────────────────────────
  async function generate() {
    busy = true; error = '';
    try {
      const res = await GenerateColdWallet(network, 0 /* English */, false /* in-memory */);
      if (!res?.success) { error = res?.error || 'Generation failed'; return; }
      address = res.address;
      seed = res.seed;
      selfCheckOK = !!res.selfCheckOK;
      step = 'generated';
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function mine() {
    busy = true; error = ''; attempts = 0; elapsed = 0;
    step = 'mining';
    try {
      const res = await MineRegistration(seed, network);
      if (!res?.success) { error = res?.error || 'Could not start mining'; step = 'generated'; busy = false; }
      // success path resolves via the genesis:registration_complete event.
    } catch (e) {
      error = String(e); step = 'generated'; busy = false;
    }
  }

  async function cancelMine() {
    try { await CancelColdRegistration(); } catch (e) { /* cancel is best-effort */ }
  }

  async function savePaper() {
    exportNote = '';
    try {
      const res = await RenderPaperWallet(network, address, seed, registrationHex);
      if (res?.cancelled) return;
      exportNote = res?.success ? `Saved to ${res.path}` : (res?.error || 'Save failed');
    } catch (e) {
      exportNote = String(e);
    }
  }

  async function exportDcsp() {
    exportNote = '';
    try {
      const res = await ExportRegistrationDCSP(network, address, registrationHex);
      if (!res?.success) { exportNote = res?.error || 'Export failed'; return; }
      // copy the blob to the clipboard for transport to the hot side.
      await navigator.clipboard?.writeText(res.blob);
      exportNote = 'DCSP registration copied to clipboard';
    } catch (e) {
      exportNote = String(e);
    }
  }

  function close() {
    if (busy) return; // don't abandon a mine silently
    wipe();
    dispatch('close');
  }
</script>

<div class="ccw-backdrop" transition:fade={{ duration: 150 }} on:click|self={close}>
  <div class="ccw" transition:fly={{ y: 16, duration: 200 }}>
    <header class="ccw-head">
      <div class="ccw-title">
        <span class="ccw-mark">COLD GENESIS</span>
        <span class="ccw-sub">Offline wallet · air-gapped</span>
      </div>
      <button class="ccw-x" on:click={close} disabled={busy} aria-label="Close">✕</button>
    </header>

    {#if error}
      <div class="ccw-error" transition:fade={{ duration: 120 }}>{error}</div>
    {/if}

    <!-- ── INTRO ── -->
    {#if step === 'intro'}
      <section class="ccw-body">
        <p class="ccw-lead">
          Generates a new wallet entirely in memory. The secret seed is created offline and
          never touches the network or disk unless you save the paper wallet.
        </p>
        <ul class="ccw-notes">
          <li>The seed is the only thing that controls the funds. Back it up on paper or metal.</li>
          <li>The address can receive funds only after its registration is broadcast once.</li>
          <li>For true cold storage, run this on an air-gapped machine.</li>
        </ul>
        <button class="ccw-primary" on:click={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate cold wallet'}
        </button>
      </section>
    {/if}

    <!-- ── GENERATED ── -->
    {#if step === 'generated' || step === 'mining' || step === 'mined'}
      <section class="ccw-body">
        <!-- self-check trust signal -->
        <div class="ccw-check" class:ok={selfCheckOK} class:bad={!selfCheckOK}>
          {selfCheckOK ? '✓ Seed ↔ address self-check passed' : '✕ Self-check FAILED — do not use'}
        </div>

        <!-- address + fingerprint -->
        <div class="ccw-field">
          <span class="ccw-label">Address</span>
          <code class="ccw-addr">{address}</code>
          <div class="ccw-fp">
            <span class="ccw-fp-short">{fingerprint.short}</span>
            <span class="ccw-fp-words">{fingerprint.checkwords}</span>
            <span class="ccw-fp-hint">verify this matches on the broadcasting device</span>
          </div>
        </div>

        <!-- seed (SECRET) -->
        <div class="ccw-vault">
          <div class="ccw-vault-head">
            <span class="ccw-label danger">Recovery seed</span>
            <span class="ccw-stamp">SECRET</span>
          </div>
          {#if seedRevealed}
            <div class="ccw-words" transition:fade={{ duration: 120 }}>
              {#each seedWords as w, i}
                <div class="ccw-word"><span class="n">{i + 1}</span><span class="w">{w}</span></div>
              {/each}
            </div>
            <button class="ccw-ghost" on:click={() => (seedRevealed = false)}>Hide seed</button>
          {:else}
            <button class="ccw-reveal" on:click={() => (seedRevealed = true)}>
              Reveal seed — make sure no one is watching
            </button>
          {/if}
        </div>

        <!-- registration -->
        {#if step === 'generated'}
          <button class="ccw-primary" on:click={mine} disabled={busy}>
            Mine registration (offline proof-of-work)
          </button>
          <p class="ccw-fine">This can take many minutes — even tens. It runs in the background and is cancellable.</p>
        {/if}

        {#if step === 'mining'}
          <div class="ccw-mining">
            <div class="ccw-mining-row">
              <span class="ccw-spinner" />
              <span>Mining registration…</span>
            </div>
            <div class="ccw-stats">
              <span>{attempts.toLocaleString()} attempts</span>
              <span>{Math.round(elapsed)}s elapsed</span>
            </div>
            <button class="ccw-ghost" on:click={cancelMine}>Cancel</button>
          </div>
        {/if}

        {#if step === 'mined'}
          <div class="ccw-done">✓ Registration mined</div>
          <div class="ccw-exports">
            <button class="ccw-primary" on:click={savePaper}>Save paper wallet (.html)</button>
            <button class="ccw-secondary" on:click={exportDcsp}>Copy registration for broadcast</button>
          </div>
          {#if exportNote}<p class="ccw-note">{exportNote}</p>{/if}
          <p class="ccw-fine">
            Broadcast the registration once from an online device to activate the address.
            Then destroy any file containing the seed; keep only paper or metal.
          </p>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .ccw-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(4, 4, 8, 0.72);
    display: flex; align-items: center; justify-content: center;
    padding: var(--s-4);
  }
  .ccw {
    width: min(560px, 100%);
    max-height: 90vh; overflow-y: auto;
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-default, #2e2e3e);
    border-radius: var(--r-xl, 16px);
    box-shadow: 0 24px 80px -32px #000, var(--glow-cyan-xs);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--text-2, #c8c8d4);
  }
  .ccw-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: var(--s-5, 20px); border-bottom: 1px solid var(--border-subtle, #1e1e2a);
  }
  .ccw-title { display: flex; flex-direction: column; gap: 2px; }
  .ccw-mark {
    font-size: var(--text-sm, 13px); font-weight: 700; letter-spacing: 0.22em;
    color: var(--cyan-400, #22d3ee); text-transform: uppercase;
  }
  .ccw-sub { font-size: var(--text-xs, 11px); letter-spacing: 0.12em; color: var(--text-4, #6a6a7a); text-transform: uppercase; }
  .ccw-x {
    background: none; border: none; color: var(--text-4, #6a6a7a); cursor: pointer;
    font-size: 16px; line-height: 1; padding: 4px;
  }
  .ccw-x:disabled { opacity: 0.3; cursor: not-allowed; }
  .ccw-body { padding: var(--s-5, 20px); display: flex; flex-direction: column; gap: var(--s-4, 16px); }
  .ccw-lead { margin: 0; font-size: var(--text-sm, 13px); line-height: 1.6; color: var(--text-2, #c8c8d4); }
  .ccw-notes { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 6px; }
  .ccw-notes li { font-size: var(--text-xs, 11px); line-height: 1.5; color: var(--text-3, #9a9aac); }

  .ccw-error {
    margin: 0 var(--s-5, 20px); padding: 10px 12px;
    background: rgba(248, 113, 113, 0.08); border: 1px solid var(--red-400, #f87171);
    border-radius: var(--r-md, 8px); color: var(--red-400, #f87171); font-size: var(--text-xs, 11px);
  }

  .ccw-check {
    font-size: var(--text-xs, 11px); letter-spacing: 0.06em; padding: 8px 10px;
    border-radius: var(--r-sm, 6px); border: 1px solid transparent;
  }
  .ccw-check.ok { color: var(--emerald-400, #34d399); border-color: var(--emerald-500, #10b981); background: rgba(16, 185, 129, 0.06); }
  .ccw-check.bad { color: var(--red-400, #f87171); border-color: var(--red-400, #f87171); background: rgba(248, 113, 113, 0.08); }

  .ccw-field { display: flex; flex-direction: column; gap: 6px; }
  .ccw-label { font-size: var(--text-xs, 11px); letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-4, #6a6a7a); }
  .ccw-label.danger { color: var(--red-400, #f87171); }
  .ccw-addr {
    font-size: var(--text-xs, 11px); word-break: break-all; line-height: 1.5;
    background: var(--void-deep, #08080e); border: 1px solid var(--border-subtle, #1e1e2a);
    border-radius: var(--r-sm, 6px); padding: 8px 10px; color: var(--text-1, #e8e8f0);
  }
  .ccw-fp { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: var(--text-xs, 11px); }
  .ccw-fp-short { color: var(--text-2, #c8c8d4); }
  .ccw-fp-words {
    color: var(--cyan-300, #67e8f9); font-weight: 700; letter-spacing: 0.08em;
    padding: 2px 8px; border: 1px solid var(--cyan-600, #0891b2); border-radius: var(--r-full, 999px);
  }
  .ccw-fp-hint { color: var(--text-4, #6a6a7a); font-size: 10px; }

  .ccw-vault {
    border: 1px solid var(--red-400, #f87171); border-radius: var(--r-md, 8px);
    padding: var(--s-3, 12px); background: rgba(248, 113, 113, 0.04);
    display: flex; flex-direction: column; gap: 10px;
  }
  .ccw-vault-head { display: flex; align-items: center; gap: 8px; }
  .ccw-stamp {
    font-size: 9px; font-weight: 700; letter-spacing: 0.2em; color: var(--red-400, #f87171);
    border: 1px solid var(--red-400, #f87171); border-radius: 2px; padding: 1px 6px;
  }
  .ccw-words { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px 10px; }
  .ccw-word { display: flex; align-items: baseline; gap: 5px; font-size: 11px; }
  .ccw-word .n { font-size: 8px; color: var(--text-4, #6a6a7a); width: 14px; text-align: right; }
  .ccw-word .w { color: var(--text-1, #e8e8f0); font-weight: 600; }

  .ccw-mining { display: flex; flex-direction: column; gap: 10px; }
  .ccw-mining-row { display: flex; align-items: center; gap: 10px; font-size: var(--text-sm, 13px); color: var(--cyan-300, #67e8f9); }
  .ccw-stats { display: flex; gap: 16px; font-size: var(--text-xs, 11px); color: var(--text-3, #9a9aac); }
  .ccw-spinner {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid var(--cyan-600, #0891b2); border-top-color: var(--cyan-300, #67e8f9);
    animation: ccw-spin 0.8s linear infinite;
  }
  @keyframes ccw-spin { to { transform: rotate(360deg); } }

  .ccw-done, .ccw-exports { display: flex; flex-direction: column; gap: 10px; }
  .ccw-done { color: var(--emerald-400, #34d399); font-size: var(--text-sm, 13px); font-weight: 700; }
  .ccw-note { margin: 0; font-size: var(--text-xs, 11px); color: var(--cyan-300, #67e8f9); }
  .ccw-fine { margin: 0; font-size: 10px; line-height: 1.5; color: var(--text-4, #6a6a7a); }

  .ccw-primary, .ccw-secondary, .ccw-ghost, .ccw-reveal {
    font-family: inherit; font-size: var(--text-sm, 13px); font-weight: 600;
    border-radius: var(--r-md, 8px); padding: 10px 14px; cursor: pointer;
    letter-spacing: 0.02em; transition: all var(--dur-fast, 120ms) var(--ease-out, ease);
  }
  .ccw-primary {
    background: var(--cyan-500, #06b6d4); color: var(--void-pure, #000); border: none;
  }
  .ccw-primary:hover:not(:disabled) { background: var(--cyan-400, #22d3ee); box-shadow: var(--glow-cyan-sm); }
  .ccw-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .ccw-secondary {
    background: transparent; color: var(--cyan-300, #67e8f9);
    border: 1px solid var(--cyan-600, #0891b2);
  }
  .ccw-secondary:hover { background: rgba(34, 211, 238, 0.06); }
  .ccw-ghost {
    background: transparent; color: var(--text-3, #9a9aac);
    border: 1px solid var(--border-default, #2e2e3e); align-self: flex-start;
  }
  .ccw-ghost:hover { color: var(--text-1, #e8e8f0); border-color: var(--border-strong, #3a3a4a); }
  .ccw-reveal {
    background: transparent; color: var(--red-400, #f87171);
    border: 1px dashed var(--red-400, #f87171); width: 100%;
  }
  .ccw-reveal:hover { background: rgba(248, 113, 113, 0.06); }
</style>
