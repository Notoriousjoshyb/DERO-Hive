<script>
  import { onMount, onDestroy } from 'svelte';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import {
    GetStorageUsage,
    ClearStorageCategory,
    ClearStorageTier,
    ResetHologram,
  } from '../../../wailsjs/go/main/App.js';
  import { toast, loadSettings } from '../stores/appState.js';
  import { Icons } from './holo';

  let loading = true;
  let usage = { base_path: '', total_bytes: 0, categories: [] };
  let expanded = new Set();
  let busy = new Set();
  let tierBusy = '';
  let resetConfirm = '';
  let resetBusy = false;
  let resetModalOpen = false;

  // Color tokens — mirror the design-system swatches.
  const colorVar = {
    cyan: 'var(--cyan-400)',
    emerald: 'var(--emerald, #34d399)',
    violet: 'var(--violet, #a78bfa)',
    amber: 'var(--amber, #fbbf24)',
    rose: 'var(--rose, #f87171)',
    muted: 'var(--text-3)',
    dim: 'var(--text-4)',
  };

  $: keyRows = (usage.categories || []).filter(c => c.id !== 'wallet_files');
  $: walletRow = (usage.categories || []).find(c => c.id === 'wallet_files');
  $: stackSegments = computeStack(usage);
  $: tierTotals = computeTierTotals(usage);

  function computeStack(u) {
    const cats = (u.categories || []).filter(c => c.managed && c.size_bytes > 0);
    cats.sort((a, b) => b.size_bytes - a.size_bytes);
    const top = cats.slice(0, 5);
    const rest = cats.slice(5).reduce((acc, c) => acc + c.size_bytes, 0);
    const segments = top.map(c => ({ flex: c.size_bytes, color: colorVar[c.color] || colorVar.muted }));
    if (rest > 0) segments.push({ flex: rest, color: colorVar.muted });
    return segments;
  }

  function computeTierTotals(u) {
    const totals = { cache: 0, appdata: 0, settings: 0, infra: 0 };
    for (const c of (u.categories || [])) {
      if (!c.managed) continue;
      if (totals[c.tier] !== undefined) totals[c.tier] += c.size_bytes;
    }
    return totals;
  }

  function formatBytes(n) {
    if (n == null || n === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    return `${(n / Math.pow(k, i)).toFixed(i === 0 ? 0 : (n / Math.pow(k, i) >= 100 ? 0 : 1))} ${units[i]}`;
  }

  function formatLastWrite(ts) {
    if (!ts) return 'never';
    const ms = ts * 1000;
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
    try { return new Date(ms).toLocaleDateString(); }
    catch { return ''; }
  }

  async function refresh() {
    loading = true;
    try {
      usage = await GetStorageUsage();
    } catch (e) {
      console.error('[Storage] GetStorageUsage failed:', e);
      toast.error?.('Failed to load storage usage');
    } finally {
      loading = false;
    }
  }

  function toggleExpand(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    expanded = new Set(expanded);
  }

  async function clearCategory(cat, ev) {
    ev?.stopPropagation?.();
    if (!cat.clearable || busy.has(cat.id)) return;
    busy.add(cat.id);
    busy = new Set(busy);
    try {
      const res = await ClearStorageCategory(cat.id);
      if (res?.success) {
        toast.success?.(`${cat.label} cleared (${formatBytes(res.freed_bytes || 0)} freed)`);
        if (cat.id === 'settings') await loadSettings();
        await refresh();
      } else {
        toast.error?.(res?.error || `Failed to clear ${cat.label}`);
      }
    } catch (e) {
      console.error('[Storage] Clear failed:', e);
      toast.error?.(`Failed to clear ${cat.label}`);
    } finally {
      busy.delete(cat.id);
      busy = new Set(busy);
    }
  }

  async function clearTier(tier) {
    if (tierBusy) return;
    tierBusy = tier;
    try {
      const res = await ClearStorageTier(tier);
      if (res?.success) {
        toast.success?.(`Cleared ${(res.cleared || []).length} categories · ${formatBytes(res.freed_bytes || 0)} freed`);
        await refresh();
      } else {
        toast.error?.(res?.error || `Failed to clear tier`);
      }
    } catch (e) {
      console.error('[Storage] Tier clear failed:', e);
      toast.error?.('Failed to clear tier');
    } finally {
      tierBusy = '';
    }
  }

  async function performReset() {
    if (resetConfirm.trim().toUpperCase() !== 'RESET' || resetBusy) return;
    resetBusy = true;
    try {
      const res = await ResetHologram(resetConfirm.trim().toUpperCase());
      if (res?.success) {
        toast.success?.(`HOLOGRAM reset · ${formatBytes(res.freed_bytes || 0)} freed`);
        resetModalOpen = false;
        resetConfirm = '';
        await loadSettings();
        await refresh();
      } else {
        toast.error?.(res?.error || 'Reset failed');
      }
    } catch (e) {
      console.error('[Storage] Reset failed:', e);
      toast.error?.('Reset failed');
    } finally {
      resetBusy = false;
    }
  }

  function copyPath() {
    if (!usage.base_path) return;
    try {
      navigator.clipboard.writeText(usage.base_path);
      toast.success?.('Path copied');
    } catch {
      toast.error?.('Copy failed');
    }
  }

  const handlers = ['storage:cleared', 'storage:tier_cleared', 'storage:reset', 'settings:restored'];

  onMount(async () => {
    await refresh();
    handlers.forEach(name => EventsOn(name, () => refresh()));
  });

  onDestroy(() => {
    handlers.forEach(name => EventsOff(name));
  });

  function clearLabel(cat) {
    if (cat.id === 'settings') return 'Restore defaults';
    if (cat.id === 'xswd_permissions') return 'Revoke all';
    if (cat.id === 'derod_binary') return 'Remove binary';
    return 'Clear';
  }
</script>

<!-- ──────────────────────────────────────────────────────────────
     Card 1 · OVERVIEW
     Total on disk · base path · proportion bar · complete key
     ────────────────────────────────────────────────────────────── -->
<div class="card-wrapper">
  <div class="explorer-header">
    <div class="explorer-header-left">
      <span class="explorer-header-icon">◎</span>
      <span class="explorer-header-title">OVERVIEW</span>
    </div>
    <div class="explorer-header-right">
      <span class="explorer-header-meta">{keyRows.length} categories</span>
    </div>
  </div>
  <div class="card-content">
    {#if loading && !usage.categories?.length}
      <p class="form-hint">Loading storage usage…</p>
    {:else}
      <div class="settings-row settings-row-stack">
        <div class="overview-headline">
          <div class="overview-headline-l">
            <div class="overview-headline-label">Total on disk</div>
            <div class="overview-headline-value">{formatBytes(usage.total_bytes)}</div>
          </div>
          <div class="overview-path">
            <span class="overview-path-icon">▸</span>
            <code class="overview-path-text">{usage.base_path}</code>
            <button class="btn btn-ghost btn-sm" on:click={copyPath} title="Copy path">Copy</button>
          </div>
        </div>

        <div class="overview-stack" title="Top 5 categories by size">
          {#each stackSegments as seg}
            <div style="flex: {seg.flex}; background: {seg.color};"></div>
          {/each}
          {#if !stackSegments.length}
            <div style="flex: 1; background: var(--void-up);"></div>
          {/if}
        </div>

        <div class="overview-key">
          {#each keyRows as cat}
            <div class="overview-key-row">
              <span class="overview-key-sw" style="background: {colorVar[cat.color] || colorVar.dim};"></span>
              <span class="overview-key-name">{cat.label}</span>
              <span class="overview-key-size">
                {#if cat.size_bytes > 0}{formatBytes(cat.size_bytes)}
                {:else if cat.item_label}{cat.item_label}
                {:else}—{/if}
              </span>
            </div>
          {/each}
          {#if walletRow}
            <div class="overview-key-row">
              <span class="overview-key-sw" style="background: var(--text-5); opacity: 0.35;"></span>
              <span class="overview-key-name dim">{walletRow.label}</span>
              <span class="overview-key-size dim">Not managed</span>
            </div>
          {/if}
        </div>
        <p class="form-hint overview-foot">Top 5 categories shown in the bar above; remaining categories contribute &lt; 1%.</p>
      </div>
    {/if}
  </div>
</div>

<!-- ──────────────────────────────────────────────────────────────
     Card 2 · QUICK ACTIONS
     Three tier-level operations, hoisted up high.
     Settings-row pattern matching every other sister page.
     ────────────────────────────────────────────────────────────── -->
<div class="card-wrapper">
  <div class="explorer-header">
    <div class="explorer-header-left">
      <span class="explorer-header-icon">⬢</span>
      <span class="explorer-header-title">QUICK ACTIONS</span>
    </div>
  </div>
  <div class="card-content">
    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-row-label">Clear all caches</div>
        <div class="settings-row-desc">
          Wipes regenerable caches (offline apps, content filter, NRS, logs). Settings and indexes untouched.
        </div>
      </div>
      <button
        class="btn btn-secondary"
        on:click={() => clearTier('cache')}
        disabled={!!tierBusy || tierTotals.cache === 0}
      >
        {tierBusy === 'cache' ? 'Clearing…' : `Clear · ${formatBytes(tierTotals.cache)}`}
      </button>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-row-label">Clear app data</div>
        <div class="settings-row-desc">
          Wipes the Gnomon index, TELA clones, simulator data, search filters, watched SCs, and disconnects dApps. Requires re-sync.
        </div>
      </div>
      <button
        class="btn btn-secondary"
        on:click={() => clearTier('appdata')}
        disabled={!!tierBusy}
      >
        {tierBusy === 'appdata' ? 'Clearing…' : `Clear · ${formatBytes(tierTotals.appdata)}`}
      </button>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-row-label">Reset HOLOGRAM</div>
        <div class="settings-row-desc">
          Wipes every managed category and restores compile-time defaults. Wallet files are preserved.
        </div>
      </div>
      <button
        class="btn btn-danger-outline"
        on:click={() => { resetModalOpen = true; resetConfirm = ''; }}
        disabled={resetBusy}
      >
        Reset…
      </button>
    </div>
  </div>
</div>

<!-- ──────────────────────────────────────────────────────────────
     Card 3 · ARTIFACTS
     Per-category drill-down with drawer-on-expand.
     ────────────────────────────────────────────────────────────── -->
<div class="card-wrapper">
  <div class="explorer-header">
    <div class="explorer-header-left">
      <span class="explorer-header-icon">▣</span>
      <span class="explorer-header-title">ARTIFACTS</span>
    </div>
    <div class="explorer-header-right">
      <span class="explorer-header-meta">Click any row for path, recovery info, and per-category clear</span>
    </div>
  </div>
  <div class="card-content artifacts-content">
    <div class="artifacts-list">
      {#each (usage.categories || []) as cat}
        <div
          class="artifact-row"
          class:open={expanded.has(cat.id)}
          class:disabled={!cat.managed}
          on:click={() => cat.managed && toggleExpand(cat.id)}
          on:keydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && cat.managed) { e.preventDefault(); toggleExpand(cat.id); } }}
          role="button"
          tabindex={cat.managed ? 0 : -1}
        >
          <span
            class="artifact-dot"
            class:in-use={cat.in_use}
            style="background: {colorVar[cat.color] || colorVar.dim}; color: {colorVar[cat.color] || colorVar.dim};"
          ></span>
          <span class="artifact-name">
            {cat.label}
            {#if cat.in_use}<span class="badge badge-warn">In use</span>{/if}
            {#if cat.id === 'settings'}<span class="badge badge-err">Restore defaults</span>{/if}
            {#if !cat.managed}<span class="badge badge-dim">Not managed here</span>{/if}
          </span>
          <span class="artifact-size" class:dim={!cat.size_bytes && cat.item_label}>
            {#if cat.size_bytes > 0}{formatBytes(cat.size_bytes)}
            {:else if cat.item_label}{cat.item_label}
            {:else}—{/if}
          </span>
          <span class="artifact-chev">▸</span>
        </div>

        {#if expanded.has(cat.id) && cat.managed}
          <div class="artifact-drawer">
            {#if cat.in_use && cat.blocked_by}
              <div class="alert alert-warning">
                <Icons name="info" size={14} />
                {cat.blocked_by}
              </div>
            {/if}
            <div class="artifact-drawer-grid">
              {#if cat.path}
                <div class="artifact-drawer-k">Path</div>
                <div class="artifact-drawer-v"><code>{cat.path}</code></div>
              {:else}
                <div class="artifact-drawer-k">Stored in</div>
                <div class="artifact-drawer-v">{cat.description}</div>
              {/if}
              {#if cat.item_label}
                <div class="artifact-drawer-k">Contents</div>
                <div class="artifact-drawer-v">{cat.item_label}</div>
              {/if}
              {#if cat.last_write}
                <div class="artifact-drawer-k">Last write</div>
                <div class="artifact-drawer-v">{formatLastWrite(cat.last_write)}</div>
              {/if}
              {#if cat.recovery}
                <div class="artifact-drawer-k">Recovery</div>
                <div class="artifact-drawer-v">{cat.recovery}</div>
              {/if}
            </div>
            <div class="artifact-drawer-actions">
              <button
                class="btn btn-sm btn-danger-outline"
                on:click={(e) => clearCategory(cat, e)}
                disabled={!cat.clearable || busy.has(cat.id)}
                title={!cat.clearable ? cat.blocked_by : ''}
              >
                {busy.has(cat.id) ? 'Clearing…' : clearLabel(cat)}
              </button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>

<!-- ──────────────────────────────────────────────────────────────
     Reset confirmation modal — typed-RESET token guard
     ────────────────────────────────────────────────────────────── -->
{#if resetModalOpen}
  <div class="modal-overlay" on:click={() => { if (!resetBusy) { resetModalOpen = false; resetConfirm = ''; } }}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <Icons name="info" size={16} />
          <span>Reset HOLOGRAM</span>
        </div>
        <button class="modal-close" on:click={() => { resetModalOpen = false; resetConfirm = ''; }} disabled={resetBusy}>
          <Icons name="x" size={18} />
        </button>
      </div>
      <div class="modal-body">
        <p class="settings-modal-lead">Wipes every managed category. Equivalent to a clean install.</p>
        <p class="settings-modal-desc">
          Wallet files are preserved — they live outside the app directory. Connected dApps, the Gnomon index,
          downloaded binaries, settings, and caches will all be cleared. Type <strong class="reset-token">RESET</strong>
          to arm the button.
        </p>

        <div class="reset-confirm-row">
          <input
            type="text"
            class="input"
            placeholder="Type RESET to confirm…"
            bind:value={resetConfirm}
            disabled={resetBusy}
            on:keydown={(e) => { if (e.key === 'Enter') performReset(); }}
          />
        </div>

        <div class="alert alert-info">
          <Icons name="info" size={14} />
          Wallets are <strong>not managed here.</strong> Your wallet files stay where you put them.
        </div>
      </div>
      <div class="modal-footer modal-footer-spread">
        <button class="btn btn-secondary" on:click={() => { resetModalOpen = false; resetConfirm = ''; }} disabled={resetBusy}>
          Cancel
        </button>
        <button
          class="btn btn-danger"
          on:click={performReset}
          disabled={resetConfirm.trim().toUpperCase() !== 'RESET' || resetBusy}
        >
          {resetBusy ? 'Resetting…' : 'Reset HOLOGRAM'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* === Re-declared site-shell classes (Svelte CSS isolation forces this) === */
  /* Matches OfflineCacheManager / SafeBrowsingSettings / Settings.svelte */
  .card-wrapper {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    margin-bottom: var(--s-6, 24px);
  }
  .explorer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px;
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }
  .explorer-header-left { display: flex; align-items: center; gap: 12px; }
  .explorer-header-icon { font-size: 16px; color: var(--cyan-400); line-height: 1; }
  .explorer-header-title {
    font-family: var(--font-mono); font-size: 14px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-1);
  }
  .explorer-header-right { display: flex; align-items: center; gap: 16px; }
  .explorer-header-meta {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-4);
  }
  .card-content { padding: 24px; }

  /* Settings rows (copied from Settings.svelte conventions) */
  .settings-row {
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    margin-bottom: var(--s-3);
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--s-4);
  }
  .settings-row:last-child { margin-bottom: 0; }
  .settings-row-info { flex: 1; }
  .settings-row-stack { flex-direction: column; align-items: stretch; }
  .settings-row-label {
    font-size: 13px; font-weight: 500; color: var(--text-1); margin-bottom: 2px;
  }
  .settings-row-desc {
    font-size: 11px; color: var(--text-4); line-height: 1.5;
  }

  /* Danger-outline button (Settings.svelte local) */
  .btn-danger-outline {
    background: transparent;
    border: 1px solid var(--status-err, #f87171);
    color: var(--status-err, #f87171);
  }
  .btn-danger-outline:hover:not(:disabled) {
    background: var(--status-err, #f87171); color: white;
  }

  /* Modal text helpers (Settings.svelte local) */
  .settings-modal-lead {
    margin: 0 0 var(--s-2);
    font-size: 14px; font-weight: 600; color: var(--text-1);
  }
  .settings-modal-desc {
    margin: 0 0 var(--s-4);
    font-size: 12px; color: var(--text-3); line-height: 1.6;
  }

  /* === Overview card internals (component-specific only) === */
  .overview-headline {
    display: flex; align-items: flex-end; justify-content: space-between;
    flex-wrap: wrap; gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .overview-headline-l { display: flex; flex-direction: column; gap: 2px; }
  .overview-headline-label {
    font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-4);
  }
  .overview-headline-value {
    font-size: 26px; font-weight: 700; color: var(--cyan-300); letter-spacing: 0.06em;
    text-shadow: 0 0 14px rgba(34, 211, 238, 0.3);
  }
  .overview-path {
    display: inline-flex; align-items: center; gap: var(--s-2);
    padding: 4px 10px;
    background: var(--void-deep); border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
  }
  .overview-path-icon { color: var(--cyan-400); font-size: 11px; }
  .overview-path-text { color: var(--text-3); font-family: var(--font-mono); font-size: 11px; }

  .overview-stack {
    display: flex; height: 8px; border-radius: 4px; overflow: hidden;
    background: var(--void-deep); border: 1px solid var(--border-subtle);
    margin-bottom: var(--s-3);
  }
  .overview-stack > div { transition: flex 0.3s; }

  .overview-key {
    display: grid; grid-template-columns: 1fr 1fr; gap: 7px var(--s-5);
    padding-top: var(--s-3);
    border-top: 1px solid var(--border-subtle);
  }
  .overview-key-row {
    display: flex; align-items: center; gap: 9px;
    font-size: 11px; color: var(--text-2);
  }
  .overview-key-sw { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
  .overview-key-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .overview-key-name.dim { color: var(--text-4); }
  .overview-key-size {
    color: var(--text-4); font-variant-numeric: tabular-nums; font-size: 10.5px;
  }
  .overview-key-size.dim { color: var(--text-5); }
  .overview-foot {
    margin-top: var(--s-3); padding-top: var(--s-3);
    border-top: 1px dashed var(--border-subtle);
  }

  /* === Artifacts card (zero outer padding so rows hug the card edges) === */
  :global(.card-content.artifacts-content) { padding: 0; }
  .artifacts-list { background: var(--void-mid); }

  .artifact-row {
    display: grid; grid-template-columns: auto 1fr auto auto;
    align-items: center; gap: var(--s-4);
    padding: 14px 24px;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer; transition: background 0.15s;
  }
  .artifact-row:last-of-type { border-bottom: none; }
  .artifact-row:hover { background: var(--void-up); }
  .artifact-row.open { background: var(--void-up); }
  .artifact-row.disabled { opacity: 0.55; cursor: not-allowed; }
  .artifact-row.open .artifact-chev { transform: rotate(90deg); color: var(--cyan-300); }

  .artifact-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .artifact-dot.in-use {
    box-shadow: 0 0 8px currentColor;
    animation: storage-pulse 2.4s ease-in-out infinite;
  }
  @keyframes storage-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }

  .artifact-name {
    font-size: 13px; color: var(--text-1); font-weight: 500;
    display: flex; align-items: center; gap: 8px;
  }
  .artifact-size {
    font-size: 13px; color: var(--cyan-300); font-weight: 600;
    min-width: 80px; text-align: right; font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }
  .artifact-size.dim { color: var(--text-4); font-weight: 500; font-size: 12px; }
  .artifact-chev {
    font-size: 11px; color: var(--text-4); transition: transform 0.2s;
  }

  .artifact-drawer {
    padding: 16px 24px 18px 56px;
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }
  .artifact-drawer .alert { margin-bottom: 12px; }
  .artifact-drawer-grid {
    display: grid; grid-template-columns: 96px 1fr; gap: 7px 18px;
    font-size: 11.5px; margin-bottom: 14px;
  }
  .artifact-drawer-k {
    color: var(--text-4); letter-spacing: 0.08em; text-transform: uppercase;
    align-self: start; line-height: 1.5;
  }
  .artifact-drawer-v {
    color: var(--text-2); font-family: var(--font-mono); line-height: 1.5;
    word-break: break-all;
  }
  .artifact-drawer-v code {
    font-family: var(--font-mono); font-size: 11px; color: var(--cyan-300);
    background: var(--void-mid); padding: 2px 7px; border-radius: 3px;
    border: 1px solid var(--border-subtle);
  }
  .artifact-drawer-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }

  /* === Reset modal extras (component-specific) === */
  .reset-confirm-row { margin: var(--s-3) 0 var(--s-3); }
  .reset-token { color: var(--rose, #f87171); font-family: var(--font-mono); letter-spacing: 0.06em; }
</style>
