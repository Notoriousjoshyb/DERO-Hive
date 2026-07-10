<script>
  // RevealSecretModal: Engram-shaped reveal flow for the wallet's recovery seed
  // and secret/public keys.
  //
  // Security invariants (matches Engram's pattern + a few extras):
  //   1. Decrypted material lives ONLY inside this component's local lets.
  //      When the parent unmounts the modal (close, wallet change, wallet close,
  //      route change, ESC), the binding goes out of scope and is GC'd.
  //   2. Password is required on every reveal. There is no sticky "revealed"
  //      state that survives navigating away and back.
  //   3. The wallet handle is checked server-side on every call; we never trust
  //      a previous reveal.
  //   4. Auto-hide after AUTO_HIDE_MS so an unattended screen does not leak.
  //   5. Clipboard auto-clear after CLIPBOARD_CLEAR_MS on copy.
  //
  // The component is intentionally self-contained. The parent only sets `show`
  // and `kind`; everything else (password, secret, timers) lives here.

  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { GetSeedPhrase, GetWalletKeys, ClipboardClearIf } from '../../../wailsjs/go/main/App.js';
  import { toast, handleBackendError } from '../stores/appState.js';
  import PasswordInput from './PasswordInput.svelte';
  import { AlertTriangle, Copy, Loader2, Lock, Shield, X, Eye, Key } from 'lucide-svelte';

  export let show = false;
  /** @type {'seed' | 'keys'} */
  export let kind = 'seed';

  const dispatch = createEventDispatcher();

  const AUTO_HIDE_MS = 60_000;
  const CLIPBOARD_CLEAR_MS = 30_000;
  const TICK_MS = 1_000;

  // === LOCAL STATE — the only place decrypted material exists in the UI ===
  let password = '';
  let loading = false;
  let error = null;
  let revealed = false;
  let seed = '';
  let secretKey = '';
  let publicKey = '';

  // Auto-hide countdown
  let autoHideTimer = null;
  let autoHideTickTimer = null;
  let autoHideRemainingMs = AUTO_HIDE_MS;

  // Clipboard auto-clear scheduling
  /** @type {{ timer: any, value: string } | null} */
  let clipboardScrub = null;

  $: title = kind === 'seed' ? 'RECOVERY SEED' : 'WALLET KEYS';
  $: lockSubtitle =
    kind === 'seed'
      ? 'Enter your wallet password to view your recovery seed phrase'
      : 'Enter your wallet password to view your secret and public keys';

  function clearAutoHide() {
    if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
    if (autoHideTickTimer) { clearInterval(autoHideTickTimer); autoHideTickTimer = null; }
  }

  function startAutoHide() {
    clearAutoHide();
    autoHideRemainingMs = AUTO_HIDE_MS;
    const startedAt = Date.now();
    autoHideTickTimer = setInterval(() => {
      autoHideRemainingMs = Math.max(0, AUTO_HIDE_MS - (Date.now() - startedAt));
    }, TICK_MS);
    autoHideTimer = setTimeout(() => {
      toast.info('Auto-hidden after 60s');
      close('auto-hide');
    }, AUTO_HIDE_MS);
  }

  function scrubLocalSecrets(reason) {
    seed = '';
    secretKey = '';
    publicKey = '';
    password = '';
    revealed = false;
    error = null;
    loading = false;
    clearAutoHide();
    autoHideRemainingMs = AUTO_HIDE_MS;
  }

  async function close(reason = 'user') {
    scrubLocalSecrets(reason);
    show = false;
    dispatch('close', { reason });
  }

  // Parent toggles `show`. When it goes false-from-true, scrub immediately.
  // When it goes true-from-false, ensure we start with a clean slate.
  let prevShow = false;
  $: if (show !== prevShow) {
    if (show) {
      scrubLocalSecrets('open');
      tick().then(() => {
        const el = document.querySelector('.reveal-modal-overlay .password-input input');
        if (el) el.focus();
      });
    } else {
      scrubLocalSecrets('hidden-by-parent');
    }
    prevShow = show;
  }

  async function reveal() {
    if (!password.trim() || loading) return;
    loading = true;
    error = null;
    try {
      const result = kind === 'seed'
        ? await GetSeedPhrase(password)
        : await GetWalletKeys(password);

      password = '';

      if (result?.success) {
        if (kind === 'seed') {
          seed = result.seed || '';
        } else {
          secretKey = result.secretKey || '';
          publicKey = result.publicKey || '';
        }
        revealed = true;
        startAutoHide();
      } else {
        error = handleBackendError(result, { showToast: false }) ||
          (kind === 'seed' ? 'Failed to retrieve seed phrase' : 'Failed to retrieve wallet keys');
      }
    } catch (err) {
      console.error('[RevealSecretModal] reveal error:', err);
      error = err.message || 'Unexpected error';
    } finally {
      loading = false;
    }
  }

  async function copyAndScheduleClear(text, label) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} (clipboard auto-clears in 30s)`, 2500);
    } catch (e) {
      toast.error('Failed to copy to clipboard');
      return;
    }
    if (clipboardScrub?.timer) clearTimeout(clipboardScrub.timer);
    const value = text;
    clipboardScrub = {
      value,
      timer: setTimeout(async () => {
        try {
          const result = await ClipboardClearIf(value);
          if (result?.cleared) {
            toast.info('Clipboard cleared');
          }
        } catch (e) {
          console.error('[RevealSecretModal] clipboard scrub failed:', e);
        }
        clipboardScrub = null;
      }, CLIPBOARD_CLEAR_MS),
    };
  }

  function handleKeydown(e) {
    if (!show) return;
    if (e.key === 'Escape') close('escape');
    if (e.key === 'Enter' && !revealed && !loading && password.trim()) reveal();
  }

  onDestroy(() => {
    scrubLocalSecrets('destroy');
    if (clipboardScrub?.timer) {
      clearTimeout(clipboardScrub.timer);
      clipboardScrub = null;
    }
  });

  $: secondsRemaining = Math.ceil(autoHideRemainingMs / 1000);
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
  <div class="modal-overlay reveal-modal-overlay" on:click|self={() => close('overlay-click')}>
    <div class="modal-content modal-content-wide seed-modal-content">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-title">
          {#if kind === 'seed'}
            <span class="modal-icon warning"><Eye size={16} /></span>
          {:else}
            <span class="modal-icon warning"><Key size={16} /></span>
          {/if}
          <span>{title}</span>
        </div>
        <div class="modal-header-right">
          {#if revealed}
            <div class="auto-hide-pill">
              <Lock size={12} />
              <span>Auto-hides in {secondsRemaining}s</span>
            </div>
          {/if}
          <button class="modal-close" on:click={() => close('close-button')} title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        {#if !revealed}
          <!-- Password Prompt State -->
          <div class="backup-warning">
            <AlertTriangle size={16} />
            <span>{lockSubtitle}</span>
          </div>

          {#if kind === 'keys'}
            <div class="keys-warning-critical">
              <AlertTriangle size={16} />
              <div>
                <strong>CRITICAL:</strong> Your secret key provides full control over your wallet. Never share it with anyone.
              </div>
            </div>
          {/if}

          <div class="form-group">
            <label class="form-label">Wallet Password</label>
            <div class="password-input">
              <PasswordInput bind:value={password} placeholder="Enter wallet password" />
            </div>
          </div>

          {#if error}
            <div class="alert alert-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          {/if}
        {:else}
          <!-- Revealed State -->
          {#if kind === 'seed'}
            <!-- Seed Display -->
            <div class="seed-header-compact">
              <h2 class="seed-title">Your Recovery Seed</h2>
              <p class="seed-subtitle">Write down these 25 words in order. This is the ONLY way to recover your wallet.</p>
            </div>

            <div class="seed-grid">
              {#each seed.split(' ') as word, i}
                <div class="seed-word">
                  <span class="seed-num">{i + 1}</span>
                  <span class="seed-text">{word}</span>
                </div>
              {/each}
            </div>

            <div class="seed-warnings">
              <div class="warning-item">
                <AlertTriangle size={12} />
                <span>NEVER share your seed with anyone</span>
              </div>
              <div class="warning-item">
                <AlertTriangle size={12} />
                <span>Hologram will NEVER ask for your seed</span>
              </div>
              <div class="warning-item">
                <AlertTriangle size={12} />
                <span>Store this offline in a safe place</span>
              </div>
            </div>
          {:else}
            <!-- Keys Display -->
            <div class="keys-display">
              <!-- Secret Key -->
              <div class="key-section">
                <div class="key-header">
                  <span class="key-label">SECRET KEY</span>
                  <span class="key-warning-badge">CRITICAL</span>
                </div>
                <div class="key-value-box">
                  <code class="key-value mono">{secretKey}</code>
                </div>
                <button class="btn btn-secondary btn-sm" on:click={() => copyAndScheduleClear(secretKey, 'Secret key copied')}>
                  <Copy size={14} />
                  Copy Secret Key
                </button>
                <div class="key-warning-text">
                  <AlertTriangle size={14} />
                  <span>This key grants full wallet control. Never share it.</span>
                </div>
              </div>

              <!-- Separator -->
              <div class="key-separator"></div>

              <!-- Public Key -->
              <div class="key-section">
                <div class="key-header">
                  <span class="key-label">PUBLIC KEY</span>
                </div>
                <div class="key-value-box">
                  <code class="key-value mono">{publicKey}</code>
                </div>
                <button class="btn btn-secondary btn-sm" on:click={() => copyAndScheduleClear(publicKey, 'Public key copied')}>
                  <Copy size={14} />
                  Copy Public Key
                </button>
                <div class="key-info-text">
                  <span>Public key can be shared safely. It's used to verify signatures.</span>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer modal-footer-spread">
        {#if !revealed}
          <button class="btn btn-ghost" on:click={() => close('cancel')}>Cancel</button>
          <button class="btn btn-primary" disabled={loading || !password.trim()} on:click={reveal}>
            {#if loading}
              <Loader2 size={14} class="spin" />
              Verifying...
            {:else}
              View {kind === 'seed' ? 'Seed Phrase' : 'Keys'}
            {/if}
          </button>
        {:else}
          {#if kind === 'seed'}
            <button class="btn btn-secondary" on:click={() => copyAndScheduleClear(seed, 'Seed phrase copied')}>
              <Copy size={14} />
              Copy Seed Phrase
            </button>
          {/if}
          <button class="btn btn-primary" on:click={() => close('hide')}>
            <Lock size={14} />
            Hide
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Use HOLOGRAM design system tokens and patterns */

  /* Seed modal needs extra height to show all content comfortably */
  :global(.seed-modal-content) {
    max-height: 92vh;
    min-height: 580px;
  }

  :global(.seed-modal-content > .modal-body) {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* Modal header right section */
  .modal-header-right {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  /* Auto-hide countdown pill - now in header */
  .auto-hide-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-full);
    font-size: 11px;
    color: var(--text-4);
  }

  /* Seed Display - compact header without large icon */
  .seed-header-compact {
    text-align: center;
    margin-bottom: var(--s-4);
  }

  .seed-title {
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0 0 var(--s-1) 0;
  }

  .seed-subtitle { 
    font-size: 12px; 
    color: var(--text-3); 
    margin: 0; 
  }

  .seed-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--s-2);
    background: var(--void-deep);
    padding: var(--s-4);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }

  .seed-word {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-2);
    background: var(--void-mid);
    border-radius: var(--r-sm);
  }

  .seed-num { 
    font-size: 9px; 
    color: var(--text-4); 
    margin-bottom: 2px; 
  }

  .seed-text { 
    font-family: var(--font-mono); 
    font-size: 11px; 
    color: var(--text-1); 
    font-weight: 500; 
  }

  .seed-warnings { 
    display: flex; 
    flex-direction: column; 
    gap: 6px; 
  }

  .warning-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 6px var(--s-3);
    background: rgba(251, 191, 36, 0.08);
    border-radius: var(--r-sm);
    font-size: 11px;
    color: var(--status-warn);
  }

  /* Backup Warning Banner */
  .backup-warning {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
    font-size: 12px;
    color: var(--status-warn);
  }

  /* Keys Display - matches original Wallet.svelte styling */
  .keys-warning-critical {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
    font-size: 12px;
    color: var(--status-err);
  }

  .keys-warning-critical strong {
    font-weight: 600;
  }

  .keys-display {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .key-section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .key-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
  }

  .key-label {
    color: var(--text-2);
  }

  .key-warning-badge {
    padding: 2px 8px;
    background: rgba(248, 113, 113, 0.15);
    color: var(--status-err);
    border-radius: var(--r-xs);
    font-size: 9px;
    font-weight: 600;
  }

  .key-value-box {
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-md);
    word-break: break-all;
  }

  .key-value {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-1);
    line-height: 1.6;
    display: block;
  }

  .key-value.mono {
    font-variant-numeric: tabular-nums;
  }

  .key-warning-text {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: rgba(251, 191, 36, 0.1);
    border-radius: var(--r-sm);
    font-size: 11px;
    color: var(--status-warn);
  }

  .key-info-text {
    padding: var(--s-2) var(--s-3);
    font-size: 11px;
    color: var(--text-4);
    font-style: italic;
  }

  .key-separator {
    height: 1px;
    background: var(--border-dim);
    margin: var(--s-2) 0;
  }

  /* Spin Animation */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
