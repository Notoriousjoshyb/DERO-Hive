<script>
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import {
    BatchPrefetchFavorites,
    CheckAllForUpdates,
    CheckAppForUpdate,
    UpdateCachedApp,
    DiffCachedVsOnChain,
    GetCachedApps
  } from '../../../wailsjs/go/main/App.js';
  import { favorites } from '../stores/favorites.js';
  import { Icons } from './holo';

  // State
  let cachedApps = [];
  let syncStatuses = [];
  let minRating = 50;
  let isLoading = false;
  let isSyncing = false;
  let isCheckingUpdates = false;
  let error = null;
  let lastSyncResult = null;
  let lastUpdateCheck = null;
  let expandedDiff = null;
  let diffData = null;
  let isDiffLoading = false;

  onMount(async () => {
    await refreshCachedApps();
  });

  async function refreshCachedApps() {
    isLoading = true;
    error = null;
    try {
      const res = await GetCachedApps();
      if (res.success) {
        cachedApps = res.apps || [];
      }
    } catch (e) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  async function handleBatchPrefetch() {
    isSyncing = true;
    error = null;
    lastSyncResult = null;
    
    // Allow DOM to update before starting async work
    await tick();

    try {
      const favs = get(favorites);
      if (favs.length === 0) {
        error = 'No favorites to sync. Add some favorites first!';
        isSyncing = false;
        return;
      }

      // Transform favorites to match expected format
      const favsData = favs.map(f => ({
        scid: f.scid,
        durl: f.durl,
        name: f.name
      }));

      const result = await BatchPrefetchFavorites(favsData, minRating);
      
      // Let DOM settle before updating result state
      await tick();
      lastSyncResult = result;
      
      if (result.success) {
        await refreshCachedApps();
      }
    } catch (e) {
      error = e.message;
    } finally {
      isSyncing = false;
      await tick(); // Ensure final state update is smooth
    }
  }

  async function handleCheckUpdates() {
    isCheckingUpdates = true;
    error = null;
    lastUpdateCheck = null;
    syncStatuses = [];
    
    // Allow DOM to update before starting async work
    await tick();

    try {
      const result = await CheckAllForUpdates();
      
      // Let DOM settle before updating result state
      await tick();
      lastUpdateCheck = result;
      
      if (result.success) {
        syncStatuses = result.apps || [];
        await refreshCachedApps();
      }
    } catch (e) {
      error = e.message;
    } finally {
      isCheckingUpdates = false;
      await tick(); // Ensure final state update is smooth
    }
  }

  async function handleUpdateApp(scid) {
    try {
      const result = await UpdateCachedApp(scid);
      if (result.success) {
        // Refresh to show updated status
        await handleCheckUpdates();
      } else {
        error = result.error || 'Failed to update app';
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function handleViewDiff(scid) {
    if (expandedDiff === scid) {
      expandedDiff = null;
      diffData = null;
      return;
    }

    expandedDiff = scid;
    isDiffLoading = true;
    diffData = null;

    try {
      const result = await DiffCachedVsOnChain(scid);
      if (result.success) {
        diffData = result;
      } else {
        error = result.error || 'Failed to generate diff';
      }
    } catch (e) {
      error = e.message;
    } finally {
      isDiffLoading = false;
    }
  }

  function formatScid(scid) {
    if (!scid) return '';
    return scid.substring(0, 12) + '...' + scid.substring(scid.length - 8);
  }

  function getUpdateCountText() {
    if (!lastUpdateCheck) return '';
    const count = lastUpdateCheck.updates_found || 0;
    return count === 1 ? '1 update' : `${count} updates`;
  }

  function getStatusColor(status) {
    if (status.has_update) return 'var(--status-warn)';
    if (status.error) return 'var(--status-err)';
    return 'var(--status-ok)';
  }

  $: favoritesCount = $favorites.length;
</script>

<div class="sync-manager" tabindex="-1">
  {#if error}
    <div class="alert alert-error">
      <Icons name="alert-triangle" size={14} />
      <span class="alert-text">{error}</span>
      <button class="alert-dismiss" on:click={() => error = null}>
        <Icons name="x" size={14} />
      </button>
    </div>
  {/if}

  <!-- Batch Prefetch Section -->
  <div class="card-wrapper">
    <div class="card-header-util">
      <div class="card-header-left">
        <span class="card-header-icon">◎</span>
        <span class="card-header-title">BATCH SYNC</span>
      </div>
      <div class="card-header-right">
        <span class="badge badge-cyan">{favoritesCount} favorites</span>
      </div>
    </div>
    <div class="card-body">
      <p class="section-desc">
        Clone all your favorited TELA apps locally. Apps are cached to Graviton for instant offline access.
      </p>

      <div class="controls-row">
        <div class="rating-control">
          <label class="form-label" for="min-rating">Minimum Rating</label>
          <div class="rating-input-group">
            <input
              id="min-rating"
              type="range"
              min="0"
              max="99"
              bind:value={minRating}
              class="slider"
            />
            <span class="rating-value">{minRating}</span>
          </div>
          <span class="form-hint">Skip apps rated below this threshold</span>
        </div>

        <button
          class="btn btn-primary"
          on:click={handleBatchPrefetch}
          disabled={isSyncing || favoritesCount === 0}
        >
          {#if isSyncing}
            <span class="loading-spinner sm"></span>
            Syncing...
          {:else}
            <Icons name="download" size={14} />
            Sync Favorites
          {/if}
        </button>
      </div>

      {#if lastSyncResult}
        <div class="sync-result">
          <div class="result-header">
            <Icons name="check-circle" size={16} />
            <span>Sync Complete</span>
          </div>
          <div class="result-stats">
            <span class="result-stat">
              <strong>{lastSyncResult.prefetched}</strong> prefetched
            </span>
            <span class="result-stat">
              <strong>{lastSyncResult.already_cached}</strong> already cached
            </span>
            {#if lastSyncResult.skipped > 0}
              <span class="result-stat warn">
                <strong>{lastSyncResult.skipped}</strong> skipped
              </span>
            {/if}
            {#if lastSyncResult.failed > 0}
              <span class="result-stat err">
                <strong>{lastSyncResult.failed}</strong> failed
              </span>
            {/if}
          </div>
          <span class="result-duration">Completed in {lastSyncResult.duration_ms}ms</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Update Check Section -->
  <div class="card-wrapper">
    <div class="card-header-util">
      <div class="card-header-left">
        <span class="card-header-icon">◉</span>
        <span class="card-header-title">UPDATE CHECK</span>
      </div>
      {#if lastUpdateCheck && lastUpdateCheck.updates_found > 0}
        <div class="card-header-right">
          <span class="badge badge-warn">{getUpdateCountText()} available</span>
        </div>
      {/if}
    </div>
    <div class="card-body">
      <p class="section-desc">
        Compare your cached apps against their current on-chain versions. View diffs before updating.
      </p>

      <div class="controls-row">
        <button
          class="btn btn-secondary"
          on:click={handleCheckUpdates}
          disabled={isCheckingUpdates || cachedApps.length === 0}
        >
          {#if isCheckingUpdates}
            <span class="loading-spinner sm"></span>
            Checking...
          {:else}
            <Icons name="refresh-cw" size={14} />
            Check for Updates
          {/if}
        </button>

        {#if cachedApps.length === 0}
          <span class="form-hint">No cached apps to check</span>
        {/if}
      </div>

      {#if syncStatuses.length > 0}
        <div class="update-list">
          {#each syncStatuses as status}
            <div class="update-item" class:has-update={status.has_update} class:has-error={status.error}>
              <div class="update-icon" style="color: {getStatusColor(status)}">
                {#if status.has_update}
                  <Icons name="arrow-up-circle" size={20} />
                {:else if status.error}
                  <Icons name="alert-circle" size={20} />
                {:else}
                  <Icons name="check-circle" size={20} />
                {/if}
              </div>
              <div class="update-info">
                <span class="update-name">{status.name || formatScid(status.scid)}</span>
                <span class="update-scid">{formatScid(status.scid)}</span>
                {#if status.has_update}
                  <span class="update-version">
                    v{status.cached_version} → v{status.onchain_version}
                  </span>
                {:else if status.error}
                  <span class="update-error">{status.error}</span>
                {:else}
                  <span class="update-current">Up to date (v{status.cached_version})</span>
                {/if}
              </div>
              <div class="update-actions">
                {#if status.has_update}
                  <button 
                    class="btn btn-ghost btn-sm"
                    on:click={() => handleViewDiff(status.scid)}
                    title="View diff"
                  >
                    <Icons name="file-diff" size={14} />
                    Diff
                  </button>
                  <button 
                    class="btn btn-primary btn-sm"
                    on:click={() => handleUpdateApp(status.scid)}
                    title="Update to latest"
                  >
                    <Icons name="download" size={14} />
                    Update
                  </button>
                {/if}
              </div>
            </div>

            <!-- Diff Viewer -->
            {#if expandedDiff === status.scid}
              <div class="diff-viewer">
                {#if isDiffLoading}
                  <div class="diff-loading">
                    <span class="loading-spinner sm"></span>
                    <span>Generating diff...</span>
                  </div>
                {:else if diffData}
                  <div class="diff-header">
                    <span class="diff-stat added">+{diffData.lines_added} added</span>
                    <span class="diff-stat removed">-{diffData.lines_removed} removed</span>
                    <span class="diff-stat modified">~{diffData.lines_modified} modified</span>
                    <span class="diff-size">
                      {diffData.cached_size}B → {diffData.onchain_size}B
                    </span>
                  </div>
                  {#if diffData.diff && diffData.diff.length > 0}
                    <div class="diff-content">
                      {#each diffData.diff.slice(0, 50) as line}
                        <div class="diff-line {line.type}">
                          <span class="line-num">{line.line_num || ''}</span>
                          <span class="line-content">{line.content || ''}</span>
                        </div>
                      {/each}
                      {#if diffData.diff.length > 50}
                        <div class="diff-truncated">
                          ... and {diffData.diff.length - 50} more lines
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <div class="diff-empty">
                      <Icons name="check" size={14} />
                      No content differences detected
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .sync-manager {
    padding: 0;
  }

  /* Alert - matches hologram.css pattern */
  .alert {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-4);
    border-radius: var(--r-md);
    font-size: 13px;
  }

  .alert-error {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: var(--status-err);
  }

  .alert-text {
    flex: 1;
  }

  .alert-dismiss {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: var(--s-1);
    opacity: 0.7;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .alert-dismiss:hover {
    opacity: 1;
  }

  /* Card Wrapper - matches hologram.css */
  .card-wrapper {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    margin-bottom: var(--s-6);
  }

  /* Card Header - Utilitarian style from design system */
  .card-header-util {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4) var(--s-5);
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }

  .card-header-left {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .card-header-icon {
    font-size: 16px;
    color: var(--cyan-400);
    line-height: 1;
  }

  .card-header-title {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-2);
  }

  .card-header-right {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .card-body {
    padding: var(--s-5);
  }

  .section-desc {
    margin: 0 0 var(--s-5) 0;
    font-size: 13px;
    font-style: italic;
    color: var(--text-3);
    line-height: 1.5;
  }

  /* Badges - from design system */
  .badge {
    padding: 2px 10px;
    font-size: 9px;
    font-weight: 500;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: var(--r-xs);
    border: 1px solid;
  }

  .badge-cyan {
    border-color: var(--cyan-500);
    color: var(--cyan-400);
    background: transparent;
  }

  .badge-warn {
    border-color: var(--status-warn);
    color: var(--status-warn);
    background: rgba(251, 191, 36, 0.08);
  }

  /* Controls */
  .controls-row {
    display: flex;
    align-items: flex-end;
    gap: var(--s-6);
    flex-wrap: wrap;
  }

  .rating-control {
    flex: 1;
    min-width: 200px;
  }

  .form-label {
    display: block;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-3);
    margin-bottom: var(--s-2);
  }

  .rating-input-group {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  /* Slider - from design system */
  .slider {
    flex: 1;
    height: 6px;
    appearance: none;
    -webkit-appearance: none;
    background: var(--void-hover);
    border-radius: 9999px;
    outline: none;
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: var(--cyan-400);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(34, 211, 238, 0.4);
  }

  .slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: var(--cyan-400);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .rating-value {
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 600;
    color: var(--cyan-400);
    min-width: 28px;
    text-align: right;
  }

  .form-hint {
    display: block;
    font-size: 10px;
    color: var(--text-4);
    margin-top: var(--s-2);
  }

  /* Buttons - from design system */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: 8px 16px;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms ease;
    border: none;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--cyan-500);
    color: var(--void-pure);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 0 16px rgba(34, 211, 238, 0.4);
  }

  .btn-secondary {
    background: transparent;
    color: var(--cyan-400);
    border: 1px solid var(--cyan-500);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(34, 211, 238, 0.1);
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-2);
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--void-hover);
    color: var(--text-1);
  }

  .btn-sm {
    padding: 4px 12px;
    font-size: 11px;
  }

  /* Loading Spinner - from design system */
  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .loading-spinner.sm {
    width: 14px;
    height: 14px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Sync Result */
  .sync-result {
    margin-top: var(--s-5);
    padding: var(--s-4);
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.2);
    border-radius: var(--r-md);
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--status-ok);
    font-weight: 500;
    font-size: 13px;
    margin-bottom: var(--s-3);
  }

  .result-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4);
  }

  .result-stat {
    font-size: 12px;
    color: var(--text-3);
  }

  .result-stat strong {
    color: var(--text-1);
    margin-right: 4px;
  }

  .result-stat.warn strong { color: var(--status-warn); }
  .result-stat.err strong { color: var(--status-err); }

  .result-duration {
    display: block;
    margin-top: var(--s-3);
    font-size: 11px;
    color: var(--text-4);
    font-family: var(--font-mono);
  }

  /* Update List */
  .update-list {
    margin-top: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .update-item {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    transition: border-color 200ms ease;
  }

  .update-item.has-update {
    border-color: rgba(251, 191, 36, 0.3);
  }

  .update-item.has-error {
    border-color: rgba(248, 113, 113, 0.3);
  }

  .update-icon {
    flex-shrink: 0;
  }

  .update-info {
    flex: 1;
    min-width: 0;
  }

  .update-name {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
  }

  .update-scid {
    display: block;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-4);
    margin-top: 2px;
  }

  .update-version {
    display: block;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--status-warn);
    margin-top: var(--s-1);
  }

  .update-error {
    display: block;
    font-size: 11px;
    color: var(--status-err);
    margin-top: var(--s-1);
  }

  .update-current {
    display: block;
    font-size: 11px;
    color: var(--status-ok);
    margin-top: var(--s-1);
  }

  .update-actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  /* Diff Viewer */
  .diff-viewer {
    margin: calc(-1 * var(--s-2)) 0 var(--s-2) 0;
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-top: none;
    border-radius: 0 0 var(--r-md) var(--r-md);
  }

  .diff-loading {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-3);
    font-size: 12px;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--s-3);
  }

  .diff-stat {
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .diff-stat.added { color: var(--status-ok); }
  .diff-stat.removed { color: var(--status-err); }
  .diff-stat.modified { color: var(--status-warn); }

  .diff-size {
    margin-left: auto;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-4);
  }

  .diff-content {
    max-height: 300px;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .diff-line {
    display: flex;
    padding: 2px 0;
    line-height: 1.5;
  }

  .diff-line.added {
    background: rgba(52, 211, 153, 0.1);
    color: var(--status-ok);
  }

  .diff-line.removed {
    background: rgba(248, 113, 113, 0.1);
    color: var(--status-err);
  }

  .diff-line.modified {
    background: rgba(251, 191, 36, 0.1);
    color: var(--status-warn);
  }

  .line-num {
    width: 40px;
    text-align: right;
    padding-right: var(--s-3);
    color: var(--text-4);
    user-select: none;
  }

  .line-content {
    flex: 1;
    white-space: pre;
  }

  .diff-truncated {
    padding: var(--s-2) 0;
    text-align: center;
    color: var(--text-4);
    font-style: italic;
  }

  .diff-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-4);
    color: var(--status-ok);
    font-size: 12px;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .controls-row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
