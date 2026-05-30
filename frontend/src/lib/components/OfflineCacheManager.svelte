<script>
  import { onMount } from 'svelte';
  import {
    GetCachedApps,
    GetOfflineCacheStats,
    RemoveCachedApp,
    SetOfflineCacheEnabled,
    CheckAppForUpdate,
    UpdateCachedApp
  } from '../../../wailsjs/go/main/App.js';
  import { HoloCard, Icons } from './holo';

  // State
  let cachedApps = [];
  let stats = null;
  let isEnabled = true;
  let isLoading = true;
  let error = null;

  onMount(async () => {
    await refreshData();
  });

  async function refreshData() {
    isLoading = true;
    error = null;

    try {
      const [appsRes, statsRes] = await Promise.all([
        GetCachedApps(),
        GetOfflineCacheStats()
      ]);

      if (appsRes.success) {
        cachedApps = appsRes.apps || [];
      }

      if (statsRes.success) {
        stats = statsRes;
      }
    } catch (e) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  async function handleToggleEnabled() {
    try {
      const newState = !isEnabled;
      await SetOfflineCacheEnabled(newState);
      isEnabled = newState;
    } catch (e) {
      error = e.message;
    }
  }

  async function handleRemoveApp(scid) {
    try {
      await RemoveCachedApp(scid);
      await refreshData();
    } catch (e) {
      error = e.message;
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return bytes.toFixed(1) + ' ' + units[i];
  }

  function formatScid(scid) {
    if (!scid) return '';
    return scid.substring(0, 12) + '...' + scid.substring(scid.length - 8);
  }

  function getTimeSince(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return date.toLocaleDateString();
    } catch (e) {
      return 'Unknown';
    }
  }
</script>

<div class="offline-cache-manager">
  {#if error}
    <div class="alert alert-danger">{error}</div>
  {/if}

  {#if isLoading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading cache data...</p>
    </div>
  {:else}
    <!-- Cache Stats -->
    {#if stats}
      <div class="card-wrapper">
        <div class="explorer-header">
          <div class="explorer-header-left">
            <span class="explorer-header-icon">◎</span>
            <span class="explorer-header-title">STORAGE</span>
          </div>
          <div class="explorer-header-right">
            <label class="toggle-label">
              <span class="toggle-text">{isEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                bind:checked={isEnabled}
                on:change={handleToggleEnabled}
                class="toggle"
              />
            </label>
          </div>
        </div>
        <div class="card-content">
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">{stats.stats?.total_apps || 0}</span>
            <span class="stat-label">Cached Apps</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{stats.stats?.total_files || 0}</span>
            <span class="stat-label">Files</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{stats.used_size_str || '0 B'}</span>
            <span class="stat-label">Used</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{stats.max_size_str || '0 B'}</span>
            <span class="stat-label">Max Size</span>
          </div>
        </div>
        
        <!-- Usage Bar -->
        <div class="usage-bar-container">
          <div class="usage-bar" style="width: {stats.usage_percent || 0}%"></div>
        </div>
        <div class="usage-label">
          {(stats.usage_percent || 0).toFixed(1)}% used
          </div>
        </div>
      </div>
    {/if}

    <!-- Cached Apps List -->
    <div class="card-wrapper">
      <div class="explorer-header">
        <div class="explorer-header-left">
          <span class="explorer-header-icon">◊</span>
          <span class="explorer-header-title">CACHED APPS</span>
        </div>
        {#if cachedApps.length > 0}
          <div class="explorer-header-right">
            <span class="form-hint" style="font-size:10.5px;letter-spacing:.04em;">
              Bulk clear in <strong style="color:var(--cyan-300);">Data &amp; Storage</strong>
            </span>
          </div>
        {/if}
      </div>
      <div class="card-content">
      {#if cachedApps.length === 0}
        <div class="empty-state">
          <h4>No Apps Cached</h4>
          <p>Use the "Download for Offline" button on apps to cache them locally.</p>
        </div>
      {:else}
        <div class="apps-list">
          {#each cachedApps as app}
            <div class="app-card">
              <div class="app-icon">
                {#if app.supports_epoch}
                  <span class="epoch-badge" title="Supports EPOCH"><Icons name="gem" size={24} /></span>
                {:else}
                  <Icons name="smartphone" size={24} />
                {/if}
              </div>
              <div class="app-info">
                <span class="app-name">{app.name || 'Unnamed App'}</span>
                <span class="app-scid">{formatScid(app.scid)}</span>
                <span class="app-meta">
                  {app.file_count} files • {formatBytes(app.total_size)} • Cached {getTimeSince(app.cached_at)}
                </span>
              </div>
              <div class="app-actions">
                {#if app.has_update}
                  <span class="update-badge" title="Update available: v{app.version} → v{app.onchain_version}">
                    <Icons name="arrow-up" size={12} />
                    Update
                  </span>
                {:else if app.is_complete}
                  <span class="complete-badge">
                    <Icons name="check" size={12} />
                    Complete
                  </span>
                {:else}
                  <span class="incomplete-badge">Partial</span>
                {/if}
                <button 
                  class="btn btn-ghost btn-sm"
                  on:click={() => handleRemoveApp(app.scid)}
                  title="Remove from cache"
                >
                  <Icons name="x" size={14} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      </div>
    </div>

    <!-- Cache Info -->
    <div class="card-wrapper">
      <div class="explorer-header">
        <div class="explorer-header-left">
          <span class="explorer-header-icon">□</span>
          <span class="explorer-header-title">ABOUT CACHING</span>
        </div>
      </div>
      <div class="card-content">
      <div class="info-card">
        <Icons name="info" size={16} />
        <div class="info-content">
          <ul>
            <li>Cached apps load instantly without network access</li>
            <li>Content is verified against blockchain hashes</li>
            <li>Old cached apps are automatically removed when space is needed</li>
            <li>Cache location: <code>~/datashards/offline_cache/</code></li>
          </ul>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .offline-cache-manager {
    padding: 0;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-3);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .toggle-text {
    color: var(--text-3);
  }

  .toggle {
    width: 44px;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background: var(--void-up);
    border-width: 1px !important;
    border-style: solid !important;
    border-color: #1e1e2a !important;
    outline: none !important;
    box-shadow: none !important;
    border-radius: 11px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .toggle:checked {
    background: var(--cyan);
    border-color: var(--cyan) !important;
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: #ffffff;
    border-width: 0 !important;
    border-style: none !important;
    border-color: transparent !important;
    box-shadow: none !important;
    border-radius: 50%;
    transition: transform 0.2s ease;
  }

  .toggle:checked::after {
    transform: translateX(22px);
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-12, 48px);
    color: var(--text-4);
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-dim);
    border-top-color: var(--cyan);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: var(--s-4);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Card Wrapper - Explorer Style */
  .card-wrapper {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    margin-bottom: var(--s-6, 24px);
  }

  .explorer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }

  .explorer-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .explorer-header-icon {
    font-size: 16px;
    color: var(--cyan-400);
    line-height: 1;
  }

  .explorer-header-title {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-1);
  }

  .explorer-header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .card-content {
    padding: 24px;
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-4, 16px);
    margin-bottom: var(--s-4, 16px);
  }

  .stat-item {
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 18px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-1);
  }

  .stat-label {
    display: block;
    font-size: 10px;
    color: var(--text-4);
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .usage-bar-container {
    height: 6px;
    background: var(--void-deep);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .usage-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--cyan), var(--emerald));
    transition: width 0.3s;
  }

  .usage-label {
    font-size: 11px;
    color: var(--text-4);
    text-align: right;
  }

  /* Empty State */
  .empty-state {
    text-align: center;
    padding: var(--s-8, 32px);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .empty-state h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-2);
  }

  .empty-state p {
    margin: 0;
    font-size: 12px;
    color: var(--text-4);
  }

  .apps-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3, 12px);
  }

  .app-card {
    display: flex;
    align-items: center;
    gap: var(--s-4, 16px);
    padding: var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
  }

  .app-icon {
    color: var(--cyan);
    position: relative;
  }

  .epoch-badge {
    display: inline-block;
    color: var(--violet);
  }

  .app-info {
    flex: 1;
    min-width: 0;
  }

  .app-name {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-scid {
    display: block;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-3);
    margin-top: 2px;
  }

  .app-meta {
    display: block;
    font-size: 10px;
    color: var(--text-4);
    margin-top: 4px;
  }

  .app-actions {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
  }

  .complete-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(16, 185, 129, 0.15);
    color: var(--emerald);
    border-radius: 4px;
    font-size: 11px;
  }

  .incomplete-badge {
    padding: 4px 8px;
    background: rgba(234, 179, 8, 0.15);
    color: var(--warn, #eab308);
    border-radius: 4px;
    font-size: 11px;
  }

  .update-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(245, 158, 11, 0.15);
    color: var(--amber, #f59e0b);
    border-radius: 4px;
    font-size: 11px;
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    50% { box-shadow: 0 0 8px 2px rgba(245, 158, 11, 0.3); }
  }

  /* Info Card */
  .info-card {
    display: flex;
    gap: var(--s-3, 12px);
    padding: var(--s-4, 16px);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .info-content ul {
    margin: 0;
    padding-left: 16px;
    font-size: 11px;
    color: var(--text-4);
    line-height: 1.6;
  }

  .info-content code {
    padding: 2px 6px;
    background: var(--void-up);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

