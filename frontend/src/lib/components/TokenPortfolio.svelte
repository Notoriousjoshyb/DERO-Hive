<script context="module">
  // Wallets we've already fired the quiet first-view auto-scan for this session.
  // Module-scoped (not component-instance) so navigating away from the portfolio
  // and back doesn't re-trigger a full Gnomon sweep — the guard is keyed to wallet
  // identity, not component lifetime. Cleared on app restart, which is fine: a
  // fresh session re-checking once per wallet is the intended behavior.
  const autoScannedWallets = new Set();
</script>

<script>
  import { onMount, onDestroy } from 'svelte';
  import { GetTokenPortfolio, GetXSWDStatus, GetTrackedTokens, ScanWalletForTokens } from '../../../wailsjs/go/main/App.js';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import { walletState, balanceMasked, toast, appState } from '../stores/appState.js';
  import { Coins, RefreshCw, Copy, Plus, ArrowUp, Trash2, Info, Search } from 'lucide-svelte';

  import AddTokenModal from './AddTokenModal.svelte';
  import TokenSendModal from './TokenSendModal.svelte';
  import RemoveTokenModal from './RemoveTokenModal.svelte';
  import RefreshTokenModal from './RefreshTokenModal.svelte';

  let tokens = [];
  let loading = false;
  let error = null;
  let xswdConnected = false;
  let localWalletOpen = false;

  // Wallet scan (auto-detect tokens via the Gnomon index)
  let scanning = false;
  let scanScanned = 0;
  let scanTotal = 0;
  let scanFound = 0;
  let autoScanInFlight = false;

  // Modals
  let showAddToken = false;
  let showSendToken = false;
  let showRemoveToken = false;
  let showRefreshToken = false;
  let selectedToken = null;

  // Reactive to wallet state changes
  $: localWalletOpen = $walletState.isOpen;

  // Scanning needs a running Gnomon index for its candidate set; reflect that in
  // the button and empty-state so a user with Gnomon off sees a persistent reason
  // rather than a Scan button that flashes a toast and looks clickable.
  $: gnomonRunning = $appState.gnomonRunning;

  // Token balances follow the shared mask, so the whole portfolio goes quiet
  // at once when Signal Dark is armed (or hide-balance is toggled).
  
  onMount(async () => {
    EventsOn('wallet:scanProgress', (data) => {
      scanScanned = data?.scanned || 0;
      scanTotal = data?.total || 0;
      scanFound = data?.found || 0;
    });
    EventsOn('wallet:scanComplete', async (data) => {
      const wasAuto = autoScanInFlight;
      autoScanInFlight = false;
      scanning = false;
      const added = data?.added || 0;
      const errors = data?.errors || 0;
      const partial = data?.partial === true;
      const coverage = Math.floor(data?.coverage ?? 100);
      // A partial Gnomon index means the scan only checked the SCIDs indexed so
      // far, so an empty result is NOT authoritative — the user could hold tokens
      // Gnomon hasn't reached yet. Always surface this (even on a quiet auto-scan)
      // so a partial scan is never mistaken for "you hold nothing."
      const partialNote = partial
        ? ` Gnomon is ${coverage}% synced — re-scan once it finishes for complete results.`
        : '';
      // Errors mean some contracts couldn't be checked, i.e. partial coverage of a
      // different kind. Surface it even on an auto-scan — the first-run auto-scan is
      // exactly when transient balance-read errors are most likely, so that's the
      // worst place to hide the caveat.
      const errorNote = errors > 0
        ? ` ${errors} ${errors === 1 ? 'contract' : 'contracts'} couldn't be checked — re-scan to retry.`
        : '';
      if (added > 0) {
        toast.success(`Found ${added} ${added === 1 ? 'token' : 'tokens'} in your wallet.${partialNote}${errorNote}`);
        await loadTokens();
      } else if (partial || errors > 0) {
        // Empty + incomplete coverage is the dangerous false-negative — say so even
        // on an auto-scan so it's never mistaken for "you hold nothing."
        toast.info(`No new tokens found yet —${partialNote}${errorNote}`);
      } else if (!wasAuto) {
        // Fully-synced, error-free empty result: only a user-initiated scan reports it.
        toast.info('No new tokens found');
      }
    });
    await checkAndLoad();
  });

  onDestroy(() => {
    EventsOff('wallet:scanProgress');
    EventsOff('wallet:scanComplete');
  });
  
  // Reload when wallet state changes
  $: if (localWalletOpen) {
    checkAndLoad();
  }

  // Watchdog: if the wallet closes mid-scan, the backend's scanComplete may never
  // reach us (its emit is guarded on a live app context). Reset the scan state so
  // the progress bar can't pin forever and bleed a stale "Scanning N/M" into the
  // next session.
  $: if (!localWalletOpen && scanning) {
    scanning = false;
    autoScanInFlight = false;
    scanScanned = 0;
    scanTotal = 0;
    scanFound = 0;
  }
  
  async function checkAndLoad() {
    try {
      const status = await GetXSWDStatus();
      xswdConnected = status.connected;
      
      await loadTokens();
    } catch (e) {
      console.error('Token load failed:', e);
    }
  }
  
  async function loadTokens() {
    loading = true;
    error = null;
    
    try {
      let result = null;
      let useXSWD = false;
      
      // If local wallet is open, ALWAYS try GetTrackedTokens first (it includes native DERO)
      if (localWalletOpen) {
        result = await GetTrackedTokens();
        if (result.success) {
          tokens = result.tokens || [];
          tokens.sort((a, b) => {
            if (a.native) return -1;
            if (b.native) return 1;
            return (b.balance || 0) - (a.balance || 0);
          });
          error = null;
          loading = false;
          maybeAutoScan();
          return;
        }
      }
      
      // If XSWD is connected and local wallet didn't work, try XSWD
      if (xswdConnected) {
        result = await GetTokenPortfolio();
        if (result.success) {
          tokens = result.tokens || [];
          tokens.sort((a, b) => {
            if (a.native) return -1;
            if (b.native) return 1;
            return (b.balance || 0) - (a.balance || 0);
          });
          useXSWD = true;
          error = null;
          loading = false;
          return;
        }
      }
      
      // No wallet source available
      if (!localWalletOpen && !xswdConnected) {
        tokens = [];
        error = null;
      } else if (localWalletOpen) {
        // Local wallet is open but GetTrackedTokens failed - show empty state
        tokens = [];
        error = null;
      } else {
        // XSWD says connected but GetTokenPortfolio failed
        error = result?.error || 'Failed to load tokens';
      }
    } catch (e) {
      console.error('Token load error:', e);
      // If local wallet is open, show empty state instead of error
      if (localWalletOpen) {
        tokens = [];
        error = null;
      } else {
        error = e.message || 'Failed to load token portfolio';
      }
    } finally {
      loading = false;
    }
  }
  
  function openRemoveModal(token) {
    selectedToken = token;
    showRemoveToken = true;
  }

  function openRefreshModal(token) {
    selectedToken = token;
    showRefreshToken = true;
  }
  
  async function handleScan() {
    if (scanning) return;
    scanning = true;
    scanScanned = 0;
    scanTotal = 0;
    scanFound = 0;
    try {
      const result = await ScanWalletForTokens();
      if (!result.success) {
        scanning = false;
        toast.error(result.error || 'Scan failed');
        return;
      }
      // total === 0 means there was nothing new to check; backend still emits
      // scanComplete, which flips scanning off and toasts.
      scanTotal = result.total || 0;
    } catch (e) {
      scanning = false;
      toast.error('Scan failed');
    }
  }

  // Auto-scan once per mount when the portfolio holds nothing but native DERO —
  // mirrors Engram's first-view rescan. Runs quietly: a no-result auto-scan
  // shows no toast, and if Gnomon isn't running the backend just returns an
  // error we swallow (the manual Scan button surfaces it on demand).
  async function maybeAutoScan() {
    if (scanning || !localWalletOpen) return;
    const addr = $walletState.address;
    if (!addr || autoScannedWallets.has(addr)) return;
    const onlyNative = tokens.length <= 1 && tokens.every(t => t.native);
    if (!onlyNative) return;
    autoScannedWallets.add(addr);
    try {
      const result = await ScanWalletForTokens();
      if (result.success && (result.total || 0) > 0) {
        autoScanInFlight = true;
        scanning = true;
        scanScanned = 0;
        scanTotal = result.total || 0;
        scanFound = 0;
      }
    } catch (e) {
      // silent — auto-scan is best-effort
    }
  }

  function openSendModal(token) {
    selectedToken = token;
    showSendToken = true;
  }
  
  function formatBalance(balance, decimals = 5) {
    if (!balance) return '0';
    const num = balance / Math.pow(10, decimals);
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
  }
  
  function formatSCID(scid) {
    if (!scid) return '';
    if (scid === '0000000000000000000000000000000000000000000000000000000000000000') {
      return 'Native DERO';
    }
    return scid.substring(0, 8) + '...' + scid.substring(scid.length - 6);
  }
  
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  }

  // Icon rendering is privacy-gated. A token's icon comes from an attacker-
  // controllable on-chain header, and a remote <img src> would fire an outbound
  // request on render that leaks the user's IP/timing. The backend already drops
  // remote icons at ingestion (sanitizeIconURL), but tokens persisted before that
  // guard — or fetched over the XSWD remote path — could still carry one, so we
  // re-gate here: only inline data:image icons ever load. Anything else (and any
  // icon that fails to load) falls back to the ⬡ glyph.
  let failedIcons = new Set();

  function handleIconError(iconUrl) {
    failedIcons.add(iconUrl);
    failedIcons = failedIcons; // trigger Svelte reactivity
  }

  function shouldShowIcon(iconUrl) {
    return iconUrl && /^data:image\//i.test(iconUrl) && !failedIcons.has(iconUrl);
  }
</script>

<div class="token-portfolio">
  <div class="portfolio-header">
    <div class="header-left">
      <Coins size={18} strokeWidth={1.5} />
      <h3>Token Portfolio</h3>
    </div>
    <div class="header-actions">
      {#if localWalletOpen}
        <button
          class="btn-icon"
          on:click={handleScan}
          disabled={scanning || !gnomonRunning}
          title={gnomonRunning ? 'Scan wallet for tokens' : 'Start Gnomon in Settings to scan for tokens'}
        >
          <Search size={14} class={scanning ? 'spin' : ''} />
        </button>
        <button class="btn-icon" on:click={() => showAddToken = true} title="Add Token">
          <Plus size={14} />
        </button>
      {/if}
      <button class="btn-icon" on:click={loadTokens} disabled={loading} title="Refresh">
        <RefreshCw size={14} class={loading ? 'spin' : ''} />
      </button>
    </div>
  </div>

  {#if scanning}
    <div class="scan-progress">
      <div class="scan-bar">
        <div class="scan-bar-fill" style="width: {scanTotal > 0 ? Math.round((scanScanned / scanTotal) * 100) : 0}%"></div>
      </div>
      <span class="scan-label">
        Scanning {scanScanned}/{scanTotal}{scanFound > 0 ? ` · found ${scanFound}` : ''}
      </span>
    </div>
  {/if}

  {#if !xswdConnected && !localWalletOpen}
    <!-- No wallet open -->
    <div class="portfolio-empty">
      <Coins size={24} strokeWidth={1} />
      <p>Open a wallet to view your token portfolio</p>
    </div>
    
  {:else if loading && tokens.length === 0}
    <div class="portfolio-loading">
      <RefreshCw size={20} class="spin" />
      <span>Loading tokens...</span>
    </div>
    
  {:else if error}
    <div class="portfolio-error">
      <p>{error}</p>
      <button class="btn-sm" on:click={loadTokens}>Retry</button>
    </div>
    
  {:else if tokens.length === 0}
    <div class="portfolio-empty">
      <Coins size={24} strokeWidth={1} />
      <p>No tokens found</p>
      {#if localWalletOpen && !gnomonRunning}
        <p class="empty-hint">Start Gnomon in Settings to auto-detect tokens your wallet holds.</p>
      {/if}
      {#if localWalletOpen}
        <button class="btn btn-primary btn-sm" on:click={() => showAddToken = true}>
          <Plus size={14} />
          Add Token
        </button>
      {/if}
    </div>
    
  {:else}
    <div class="token-list">
      {#each tokens as token}
        <div class="token-row" class:native={token.native}>
          <div class="token-icon">
            {#if shouldShowIcon(token.icon)}
              <img src={token.icon} alt={token.name || 'Token'} on:error={() => handleIconError(token.icon)} />
            {:else if token.native}
              <span class="dero-icon">◆</span>
            {:else}
              <span class="default-icon">⬡</span>
            {/if}
          </div>
          
          <div class="token-info">
            <div class="token-name">
              {token.name || 'Unknown Token'}
              {#if token.symbol}
                <span class="token-symbol">({token.symbol})</span>
              {/if}
            </div>
            <div class="token-scid">
              <span>{formatSCID(token.scid)}</span>
              {#if !token.native}
                <button class="copy-btn" on:click={() => copyToClipboard(token.scid)} title="Copy SCID">
                  <Copy size={10} />
                </button>
              {/if}
            </div>
          </div>
          
          <!-- Row actions sit between the token info and the balance, matching the
               approved row-actions mockup: ghost squares that fade in on row
               hover, glyph+border tint on button hover (no solid fill).
               Gate on localWalletOpen, NOT xswdConnected: these actions mutate
               the local wallet's tracked-token list, which is exactly the data
               shown whenever a local wallet is open (loadTokens returns early on
               the local path). xswdConnected is true whenever HOLOGRAM's own
               XSWD *server* is running — always, on most setups — which hid
               these buttons permanently rather than only for remote portfolios. -->
          <div class="row-actions">
            {#if !token.native && localWalletOpen}
              <button
                class="row-action"
                on:click={() => openRefreshModal(token)}
                title="Refresh metadata"
              >
                <RefreshCw size={13} strokeWidth={2} />
              </button>
            {/if}
            {#if token.balance > 0}
              <button
                class="row-action"
                on:click={() => openSendModal(token)}
                title="Send {token.symbol || 'Token'}"
              >
                <ArrowUp size={13} strokeWidth={2} />
              </button>
            {/if}
            {#if !token.native && localWalletOpen}
              <button
                class="row-action row-action-danger"
                on:click={() => openRemoveModal(token)}
                title="Remove"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            {/if}
          </div>

          <div class="token-balance">
            <span class="balance-value" class:balance-unknown={token.balanceUnknown}>
              {#if $balanceMasked}
                ••••••
              {:else if token.balanceUnknown}
                <span title="Balance unavailable — daemon offline or sync pending">—</span>
              {:else}
                {formatBalance(token.balance)}
              {/if}
            </span>
            {#if token.symbol && !token.balanceUnknown}
              <span class="balance-symbol">{token.symbol}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    
    {#if !xswdConnected && localWalletOpen}
      <div class="portfolio-info">
        <Info size={14} />
        <div class="info-content">
          <p class="info-title">Token Discovery</p>
          <p class="info-text">
            Use Scan to auto-detect tokens your wallet holds (requires Gnomon), or add one manually by its SCID.
          </p>
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- Modals -->
<AddTokenModal bind:show={showAddToken} on:added={loadTokens} />
<TokenSendModal bind:show={showSendToken} token={selectedToken} on:sent={loadTokens} />
<RemoveTokenModal bind:show={showRemoveToken} token={selectedToken} on:removed={loadTokens} />
<RefreshTokenModal bind:show={showRefreshToken} token={selectedToken} on:refreshed={loadTokens} />

<style>
  .token-portfolio {
    background: var(--void-mid);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  
  .portfolio-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-4);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-2);
  }
  
  .header-left h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    color: var(--text-1);
  }
  
  .header-actions {
    display: flex;
    gap: var(--s-1);
  }

  .scan-progress {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--border-dim);
    background: rgba(34, 211, 238, 0.04);
  }

  .scan-bar {
    flex: 1;
    height: 4px;
    background: var(--void-deep);
    border-radius: 2px;
    overflow: hidden;
  }

  .scan-bar-fill {
    height: 100%;
    background: var(--cyan-400);
    border-radius: 2px;
    transition: width 200ms ease;
  }

  .scan-label {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-3);
    white-space: nowrap;
  }
  
  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .btn-icon:hover:not(:disabled) {
    background: var(--void-up);
    color: var(--cyan-400);
  }
  
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .portfolio-loading,
  .portfolio-empty,
  .portfolio-error {
    padding: var(--s-8);
    text-align: center;
    color: var(--text-4);
    font-size: 13px;
  }
  
  .portfolio-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
  }

  .empty-hint {
    margin: 0;
    max-width: 260px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-3);
  }

  .portfolio-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
  }
  
  .portfolio-error {
    color: var(--status-err);
  }
  
  .portfolio-error button {
    margin-top: var(--s-3);
    background: var(--void-up);
    border: 1px solid var(--border-dim);
    color: var(--text-2);
    padding: 6px 12px;
    border-radius: var(--r-md);
    cursor: pointer;
  }
  
  .portfolio-info {
    display: flex;
    gap: var(--s-3);
    padding: var(--s-4);
    background: rgba(34, 211, 238, 0.05);
    border-top: 1px solid var(--border-dim);
    color: var(--text-3);
  }
  
  .info-content {
    flex: 1;
  }
  
  .info-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    margin: 0 0 var(--s-1) 0;
  }
  
  .info-text {
    font-size: 11px;
    line-height: 1.5;
    margin: 0;
    color: var(--text-4);
  }
  
  .token-list {
    max-height: 360px;
    overflow-y: auto;
  }
  
  .token-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border-dim);
    transition: background 0.2s;
  }
  
  .token-row:last-child {
    border-bottom: none;
  }
  
  .token-row:hover {
    background: var(--void-up);
  }
  
  .token-row.native {
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.05), transparent);
  }
  
  .token-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--void-deep);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }
  
  .token-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .dero-icon {
    font-size: 18px;
    color: var(--cyan-400);
  }
  
  .default-icon {
    font-size: 16px;
    color: var(--text-4);
  }
  
  .token-info {
    flex: 1;
    min-width: 0;
  }
  
  .token-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .token-symbol {
    font-weight: 400;
    color: var(--text-3);
    font-size: 12px;
    margin-left: 4px;
  }
  
  .token-scid {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-4);
    margin-top: 2px;
  }
  
  .copy-btn {
    background: transparent;
    border: none;
    color: var(--text-4);
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.2s;
  }
  
  .token-row:hover .copy-btn {
    opacity: 1;
  }
  
  .copy-btn:hover {
    color: var(--cyan-400);
  }
  
  .token-balance {
    text-align: right;
    flex-shrink: 0;
  }
  
  .balance-value {
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-1);
  }

  .balance-value.balance-unknown {
    color: var(--text-4);
    cursor: help;
  }
  
  .balance-symbol {
    display: block;
    font-size: 10px;
    color: var(--text-4);
    margin-top: 2px;
  }
  
  .row-actions {
    display: flex;
    gap: var(--s-2);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .token-row:hover .row-actions {
    opacity: 1;
  }

  .row-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: pointer;
    transition: color 150ms ease, border-color 150ms ease;
  }

  /* Pin the icon geometry explicitly: lucide SVGs inside the old action
     buttons rendered zero-visible on some setups, so don't rely on inherited
     sizing — force the glyph's box and stroke source. */
  .row-action :global(svg) {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    flex-shrink: 0;
  }

  .row-action:hover {
    color: var(--cyan-400);
    border-color: rgba(34, 211, 238, 0.4);
  }

  .row-action-danger:hover {
    color: var(--status-err);
    border-color: rgba(248, 113, 113, 0.4);
  }
  
  /* Spin Animation */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
