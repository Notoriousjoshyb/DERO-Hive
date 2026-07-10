<script>
  // CreateColdWallet — cold-wallet genesis flow (faithful v1 port).
  //
  // Design locked via mockup waves (docs/HOLOGRAM/.../explorations/cold-genesis-*):
  //   container  = full-route takeover (v1 .wallet-page/.wallet-container)
  //   layout     = module stack — each step is a cmd-panel module (Ⅲ-6)
  //   done-state = completed module collapses to its header bar + ✓ DONE (Ⅳ-A)
  //   active     = cmd-live-badge (bordered LIVE pill + pulse-glow dot)
  //   mining     = cmd-stat-value triple readout (attempts/H·s/elapsed) (Ⅱ-C)
  //   fingerprint= checkword pill (offline [R3] cue) (Ⅰ-A)
  // All chrome is ported from shipped v1 hologram.css — no invented vocabulary.
  //
  // The seed lives in component state only while the flow is open; wiped on close.
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ShieldCheck, Snowflake, AlertTriangle, Check, ArrowRight } from 'lucide-svelte';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import {
    GenerateColdWallet,
    MineRegistration,
    CancelColdRegistration,
    SaveColdBackup,
    ExportRegistrationDCSP,
  } from '../../../wailsjs/go/main/App.js';
  import { addressFingerprint } from '../utils/addressFingerprint.js';
  import { toast } from '../stores/appState.js';

  export let network = 'mainnet';
  const dispatch = createEventDispatcher();

  // step: 0 intro · 1 generated · 2 mining · 3 mined
  let step = 0;
  let busy = false;
  let error = '';

  let address = '';
  let seed = '';
  let selfCheckOK = false;
  let registrationHex = '';

  let attempts = 0;
  let hashRate = 0;
  let elapsed = 0;

  // export task state (Direction B: two jobs, each with a visible done-state)
  let backupSaved = false;
  let backupPath = '';
  let registrationCopied = false;
  $: exportDone = backupSaved && registrationCopied;

  $: fingerprint = address ? addressFingerprint(address) : { short: '', checkwords: '' };
  $: seedWords = seed ? seed.trim().split(/\s+/) : [];

  // ── namespaced registration events (distinct from the hot wallet's) ──
  const onProgress = (d) => {
    attempts = d?.attempts ?? attempts;
    elapsed = d?.elapsed ?? elapsed;
    if (elapsed > 0) hashRate = Math.round(attempts / elapsed);
  };
  const onComplete = (d) => { registrationHex = d?.registrationHex ?? ''; step = 3; busy = false; };
  const onCancelled = () => { step = 1; busy = false; };
  const onFailed = (d) => { error = d?.error || 'Registration failed'; step = 1; busy = false; };

  EventsOn('genesis:registration_progress', onProgress);
  EventsOn('genesis:registration_complete', onComplete);
  EventsOn('genesis:registration_cancelled', onCancelled);
  EventsOn('genesis:registration_failed', onFailed);

  onDestroy(() => {
    EventsOff('genesis:registration_progress');
    EventsOff('genesis:registration_complete');
    EventsOff('genesis:registration_cancelled');
    EventsOff('genesis:registration_failed');
    seed = '';
  });

  async function generate() {
    busy = true; error = '';
    try {
      const res = await GenerateColdWallet(network, 0, false);
      if (!res?.success) { error = res?.error || 'Generation failed'; return; }
      address = res.address; seed = res.seed; selfCheckOK = !!res.selfCheckOK;
      step = 1;
    } catch (e) { error = String(e); } finally { busy = false; }
  }

  async function mine() {
    busy = true; error = ''; attempts = 0; hashRate = 0; elapsed = 0; step = 2;
    try {
      const res = await MineRegistration(seed, network);
      if (!res?.success) { error = res?.error || 'Could not start mining'; step = 1; busy = false; }
    } catch (e) { error = String(e); step = 1; busy = false; }
  }

  async function cancelMine() { try { await CancelColdRegistration(); } catch (e) {} }

  async function saveBackup() {
    try {
      const res = await SaveColdBackup(network, address, seed, registrationHex);
      if (res?.cancelled) return;
      if (res?.success) {
        backupSaved = true;
        backupPath = res.path || '';
        toast.success('Cold wallet backup saved');
      } else {
        toast.error(res?.error || 'Save failed');
      }
    } catch (e) { toast.error(String(e)); }
  }

  async function copyRegistration() {
    try {
      const res = await ExportRegistrationDCSP(network, address, registrationHex);
      if (!res?.success) { toast.error(res?.error || 'Export failed'); return; }
      await navigator.clipboard?.writeText(res.blob);
      registrationCopied = true;
      toast.success('Registration copied — ready to broadcast');
    } catch (e) { toast.error(String(e)); }
  }

  function close() { if (busy) return; seed = ''; dispatch('close'); }
  const fmt = (n) => (n ?? 0).toLocaleString();
</script>

<div class="cg-page" transition:fade={{ duration: 120 }}>
  <div class="cg-container">
    <div class="cg-head">
      <Snowflake size={18} class="cg-head-icon" />
      <div class="cg-head-text">
        <div class="cg-head-title">Cold Genesis</div>
        <div class="cg-head-sub">Offline wallet · air-gapped</div>
      </div>
      <button class="cg-close" on:click={close} disabled={busy} aria-label="Close">✕</button>
    </div>

    {#if error}<div class="cg-error" transition:fade={{ duration: 100 }}>{error}</div>{/if}

    <!-- MODULE 1 · Generate -->
    <div class="cg-module" class:collapsed={step >= 1}>
      <div class="cg-mod-head">
        <span class="cg-mod-title" class:active={step === 0} class:done={step >= 1}>
          {#if step >= 1}<Check size={12} class="cg-chk" />{/if} Generate
        </span>
        {#if step >= 1}<span class="cg-badge-done">done</span>{/if}
      </div>
      {#if step === 0}
        <div class="cg-mod-body">
          <div class="cg-warn"><AlertTriangle size={14} /> Generated offline · never touches the network</div>
          <p class="cg-lead">The seed is created in memory and shown once. Back it up on paper or metal before broadcasting the registration.</p>
          <button class="cg-btn cg-btn-primary" on:click={generate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate cold wallet'}
          </button>
        </div>
      {/if}
    </div>

    <!-- MODULE 2 · Verify (address + self-check + fingerprint + seed) -->
    <div class="cg-module" class:collapsed={step >= 2}>
      <div class="cg-mod-head">
        <span class="cg-mod-title" class:active={step === 1} class:done={step >= 2}>
          {#if step >= 2}<Check size={12} class="cg-chk" />{/if} Verify
        </span>
        {#if step >= 2}<span class="cg-fp-pill">{fingerprint.checkwords}</span>{/if}
      </div>
      {#if step === 1}
        <div class="cg-mod-body">
          <div class="cg-ok"><ShieldCheck size={14} /> Seed ↔ address self-check {selfCheckOK ? 'passed' : 'FAILED'}</div>
          <div class="cg-field">
            <span class="cg-label">Address</span>
            <code class="cg-addr">{address}</code>
          </div>
          <div class="cg-verify-row">
            <span class="cg-label">Verify</span>
            <span class="cg-fp-pill">{fingerprint.checkwords}</span>
            <span class="cg-fp-hint">matches on the broadcasting device</span>
          </div>
          <div class="cg-field">
            <span class="cg-label cg-secret">Recovery seed · SECRET</span>
            <div class="cg-seed-grid">
              {#each seedWords as w, i}
                <div class="cg-seed-word"><span class="cg-seed-num">{i + 1}</span><span class="cg-seed-text">{w}</span></div>
              {/each}
            </div>
          </div>
          <button class="cg-btn cg-btn-primary" on:click={mine} disabled={busy}>Mine registration</button>
          <p class="cg-fine">The proof-of-work can take many minutes — even tens. It runs in the background and is cancellable.</p>
        </div>
      {/if}
    </div>

    <!-- MODULE 3 · Mine -->
    <div class="cg-module" class:collapsed={step >= 3}>
      <div class="cg-mod-head">
        <span class="cg-mod-title" class:active={step === 2} class:done={step >= 3}>
          {#if step >= 3}<Check size={12} class="cg-chk" />{/if} Mine registration
        </span>
        {#if step === 2}
          <span class="cg-live"><span class="cg-live-dot"></span> Live</span>
        {:else if step >= 3}<span class="cg-badge-done">done</span>{/if}
      </div>
      {#if step === 2}
        <div class="cg-mod-body">
          <div class="cg-stat-row">
            <div class="cg-stat"><div class="cg-stat-value">{fmt(attempts)}</div><div class="cg-stat-label">attempts</div></div>
            <div class="cg-stat"><div class="cg-stat-value">{fmt(hashRate)}</div><div class="cg-stat-label">H/s</div></div>
            <div class="cg-stat"><div class="cg-stat-value">{Math.round(elapsed)}s</div><div class="cg-stat-label">elapsed</div></div>
          </div>
          <p class="cg-fine">~16 min typical · runs in the background</p>
          <button class="cg-btn cg-btn-ghost" on:click={cancelMine}>Cancel</button>
        </div>
      {/if}
    </div>

    <!-- MODULE 4 · Export (Direction B: two tasks → explicit complete state) -->
    <div class="cg-module">
      <div class="cg-mod-head">
        <span class="cg-mod-title" class:active={step === 3}>
          {#if exportDone}<Check size={12} class="cg-chk" />{/if} Export{#if exportDone} · complete{/if}
        </span>
        {#if step < 3}<span class="cg-badge-pending">pending</span>
        {:else}<span class="cg-export-count" class:all-done={exportDone}>{(backupSaved ? 1 : 0) + (registrationCopied ? 1 : 0)} / 2</span>{/if}
      </div>
      {#if step === 3}
        <div class="cg-mod-body">
          <!-- Task 1 · back up the seed -->
          <div class="cg-task" class:done={backupSaved}>
            <div class="cg-task-icon">{#if backupSaved}<Check size={13} />{:else}1{/if}</div>
            <div class="cg-task-main">
              <div class="cg-task-name">Back up the seed</div>
              <div class="cg-task-why">Saves a plain-text file with your 25 words. The only way to recover the wallet — transcribe to paper or metal, then destroy the file.</div>
              {#if backupSaved}<div class="cg-task-state">{backupPath}</div>{/if}
            </div>
            <button class="cg-btn cg-btn-task" class:cg-btn-task-done={backupSaved} on:click={saveBackup}>
              {backupSaved ? 'Save again' : 'Save .txt'}
            </button>
          </div>

          <!-- Task 2 · activate the address -->
          <div class="cg-task" class:done={registrationCopied}>
            <div class="cg-task-icon">{#if registrationCopied}<Check size={13} />{:else}2{/if}</div>
            <div class="cg-task-main">
              <div class="cg-task-name">Activate the address</div>
              <div class="cg-task-why">Copies the registration. Broadcast it once from an online device to make the address able to receive funds.</div>
              {#if registrationCopied}<div class="cg-task-state">ready to broadcast · DCSP registration on clipboard</div>{/if}
            </div>
            <button class="cg-btn cg-btn-task" class:cg-btn-task-done={registrationCopied} on:click={copyRegistration}>
              {registrationCopied ? 'Copy again' : 'Copy'}
            </button>
          </div>

          <!-- next step / completion -->
          {#if exportDone}
            <div class="cg-next" transition:fade={{ duration: 120 }}>
              <div class="cg-next-head"><ArrowRight size={13} /> One step left, on an online device</div>
              <div class="cg-next-body">Open HOLOGRAM ▸ Wallet ▸ Broadcast registration, paste the copied blob, confirm the <span class="cg-fp-inline">{fingerprint.checkwords}</span> fingerprint matches, and send. Your cold address is then live.</div>
            </div>
          {/if}
          <div class="cg-warn"><AlertTriangle size={14} /> Destroy the .txt after transcribing — keep only paper or metal.</div>
        </div>
      {/if}
    </div>

  </div>
</div>

<style>
  /* full-route takeover (v1 .wallet-page / .wallet-container) */
  .cg-page { position: absolute; inset: 0; z-index: 50; overflow: auto; padding: var(--s-6); background: var(--void-base); }
  .cg-container { max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--s-3); }

  .cg-head { display: flex; align-items: center; gap: var(--s-3); padding-bottom: var(--s-3); border-bottom: 1px solid var(--border-dim); }
  :global(.cg-head-icon) { color: var(--cyan-400); }
  .cg-head-text { display: flex; flex-direction: column; }
  .cg-head-title { font-family: var(--font-mono); font-size: 16px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-1); }
  .cg-head-sub { font-size: 11px; color: var(--text-4); letter-spacing: 0.04em; }
  .cg-close { margin-left: auto; background: none; border: none; color: var(--text-4); font-size: 15px; cursor: pointer; }
  .cg-close:disabled { opacity: 0.3; cursor: not-allowed; }

  .cg-error { padding: 8px 12px; background: rgba(248,113,113,0.08); border: 1px solid var(--status-err); border-radius: var(--r-sm); color: var(--status-err); font-size: 11px; }

  /* cmd-panel module */
  .cg-module { border: 1px solid var(--border-subtle); border-radius: var(--r-md); overflow: hidden; background: var(--void-mid); }
  .cg-mod-head { display: flex; align-items: center; justify-content: space-between; padding: var(--s-3) var(--s-4); background: var(--void-deep); border-bottom: 1px solid var(--border-subtle); }
  .cg-module.collapsed .cg-mod-head { border-bottom: none; }
  .cg-mod-title { display: flex; align-items: center; gap: var(--s-2); font-size: 11px; font-weight: 500; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.1em; }
  .cg-mod-title.active { color: var(--cyan-400); }
  .cg-mod-title.done { color: var(--text-4); }
  :global(.cg-chk) { color: var(--status-ok); }
  .cg-mod-body { padding: var(--s-4); display: flex; flex-direction: column; gap: var(--s-3); }

  /* badges */
  .cg-badge-done { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--status-ok); }
  .cg-badge-pending { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-5); }
  .cg-live { display: flex; align-items: center; gap: var(--s-1); padding: 3px var(--s-2); border: 1px solid rgba(52,211,153,0.4); border-radius: var(--r-xs, 3px); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--status-ok); }
  .cg-live-dot { width: 6px; height: 6px; background: var(--status-ok); border-radius: 50%; animation: cg-pulse-glow 2s ease-in-out infinite; }
  @keyframes cg-pulse-glow { 0%,100% { opacity: 1; box-shadow: 0 0 4px var(--status-ok); } 50% { opacity: 0.5; box-shadow: 0 0 8px var(--status-ok); } }

  /* fields */
  .cg-field { display: flex; flex-direction: column; gap: 6px; }
  .cg-label { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-4); font-weight: 500; }
  .cg-secret { color: var(--status-warn); }
  .cg-addr { font-size: 10px; word-break: break-all; line-height: 1.5; background: var(--void-deep); border: 1px solid var(--border-subtle); border-radius: var(--r-sm); padding: 8px 10px; color: var(--text-1); }
  .cg-verify-row { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
  .cg-fp-pill { color: var(--cyan-300); font-weight: 700; letter-spacing: 0.08em; padding: 2px 9px; border: 1px solid var(--cyan-600); border-radius: var(--r-full); font-size: 10px; }
  .cg-fp-hint { font-size: 10px; color: var(--text-4); }

  /* seed grid (v1 .seed-grid) */
  .cg-seed-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--s-2); background: var(--void-deep); padding: var(--s-3); border-radius: var(--r-md); }
  .cg-seed-word { display: flex; flex-direction: column; align-items: center; padding: var(--s-2); background: var(--void-mid); border-radius: var(--r-sm); }
  .cg-seed-num { font-size: 9px; color: var(--text-4); margin-bottom: 2px; }
  .cg-seed-text { font-family: var(--font-mono); font-size: 10px; color: var(--text-1); font-weight: 500; }

  /* mining readout (v1 cmd-stat-value) */
  .cg-stat-row { display: flex; gap: var(--s-4); padding: var(--s-4); background: var(--void-deep); border: 1px solid var(--border-subtle); border-radius: var(--r-md); }
  .cg-stat { display: flex; flex-direction: column; }
  .cg-stat-value { font-family: var(--font-mono); font-size: 20px; font-weight: 500; color: var(--cyan-400); line-height: 1; }
  .cg-stat-label { font-size: 9px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-5); margin-top: var(--s-1); }

  /* warnings / ok / notes */
  .cg-warn { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); background: rgba(251,191,36,0.1); border-radius: var(--r-sm); font-size: 11px; color: var(--status-warn); }
  .cg-ok { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); background: rgba(52,211,153,0.08); border-radius: var(--r-sm); font-size: 11px; color: var(--status-ok); }
  .cg-lead { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }
  .cg-fine { margin: 0; font-size: 10px; line-height: 1.5; color: var(--text-4); }

  /* buttons (v1 .btn) */
  .cg-btn { padding: var(--s-3) var(--s-4); border-radius: var(--r-md); font-weight: 500; border: 1px solid transparent; cursor: pointer; font-family: inherit; font-size: 13px; }
  .cg-btn-primary { background: var(--cyan-500); color: var(--void-pure); }
  .cg-btn-primary:hover:not(:disabled) { filter: brightness(1.1); box-shadow: var(--glow-cyan-sm); }
  .cg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .cg-btn-ghost { background: var(--void-up); color: var(--text-3); border-color: var(--border-default); align-self: flex-start; }

  /* export tasks (Direction B) */
  .cg-export-count { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-4); }
  .cg-export-count.all-done { color: var(--status-ok); }
  .cg-task { display: flex; align-items: flex-start; gap: var(--s-3); padding: var(--s-3); border: 1px solid var(--border-subtle); border-radius: var(--r-md); background: var(--void-deep); }
  .cg-task.done { border-color: rgba(52,211,153,0.35); }
  .cg-task-icon { width: 24px; height: 24px; border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; flex: none; font-size: 11px; background: var(--void-mid); color: var(--text-4); border: 1px solid var(--border-subtle); }
  .cg-task.done .cg-task-icon { color: var(--status-ok); border-color: rgba(52,211,153,0.4); }
  .cg-task-main { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .cg-task-name { font-size: 12px; color: var(--text-1); font-weight: 500; }
  .cg-task-why { font-size: 10px; line-height: 1.5; color: var(--text-4); }
  .cg-task-state { font-size: 10px; color: var(--status-ok); word-break: break-all; }
  .cg-btn-task { padding: 7px var(--s-3); font-size: 11px; background: transparent; color: var(--cyan-400); border-color: var(--cyan-600); white-space: nowrap; align-self: flex-start; }
  .cg-btn-task-done { color: var(--status-ok); border-color: rgba(52,211,153,0.4); }
  .cg-next { display: flex; flex-direction: column; gap: 6px; padding: var(--s-3); background: rgba(34,211,238,0.05); border: 1px solid rgba(34,211,238,0.3); border-radius: var(--r-sm); }
  .cg-next-head { display: flex; align-items: center; gap: var(--s-2); font-size: 11px; color: var(--text-1); }
  .cg-next-body { font-size: 10px; line-height: 1.6; color: var(--text-3); padding-left: 21px; }
  .cg-fp-inline { color: var(--cyan-300); font-weight: 700; }
</style>
