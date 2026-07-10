<script>
  import { onMount } from 'svelte';
  import {
    GetContentFilterConfig,
    SetContentFilterConfig,
    GetContentFilterStats,
    GetContentFilterHistory
  } from '../../../wailsjs/go/main/App.js';
  import { Icons } from './holo';

  // Config state
  let config = {
    Enabled: true,
    MinimumRating: 0,
    BlockMalware: true,
    BlockUnrated: false,
    RequireEpochSupport: false,
    ShowWarnings: true,
    ParentalControlLevel: 'off',
    EpochSupportBonus: 5
  };

  let stats = null;
  let history = [];
  let isLoading = true;
  let isSaving = false;
  let error = null;
  let saveMessage = '';

  onMount(async () => {
    await loadConfig();
  });

  async function loadConfig() {
    isLoading = true;
    error = null;

    try {
      const [configRes, statsRes, historyRes] = await Promise.all([
        GetContentFilterConfig(),
        GetContentFilterStats(),
        GetContentFilterHistory(20)
      ]);

      if (configRes.success && configRes.config) {
        config = { ...config, ...configRes.config };
      }

      if (statsRes.success) {
        stats = statsRes.stats;
      }

      if (historyRes.success) {
        history = historyRes.history || [];
      }
    } catch (e) {
      error = e.message;
    } finally {
      isLoading = false;
    }
  }

  async function saveConfig() {
    isSaving = true;
    error = null;
    saveMessage = '';

    try {
      const result = await SetContentFilterConfig(
        config.Enabled,
        config.MinimumRating,
        config.BlockMalware,
        config.BlockUnrated,
        config.RequireEpochSupport,
        config.ShowWarnings,
        config.ParentalControlLevel,
        config.EpochSupportBonus
      );

      if (result.success) {
        saveMessage = 'Settings saved';
        setTimeout(() => saveMessage = '', 3000);
      } else {
        error = result.error;
      }
    } catch (e) {
      error = e.message;
    } finally {
      isSaving = false;
    }
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      return date.toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function getDecisionIcon(decision) {
    switch (decision) {
      case 'allow': return 'check-circle';
      case 'block': return 'x-circle';
      case 'warn': return 'alert-triangle';
      default: return 'help-circle';
    }
  }

  function getDecisionClass(decision) {
    switch (decision) {
      case 'allow': return 'c-emerald';
      case 'block': return 'c-err';
      case 'warn': return 'c-warn';
      default: return '';
    }
  }
</script>

<div class="safe-browsing-settings">
  {#if saveMessage}
    <div class="save-toast">
      <Icons name="check" size={14} />
      <span>{saveMessage}</span>
    </div>
  {/if}

  {#if error}
    <div class="alert alert-danger">{error}</div>
  {/if}

  {#if isLoading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading settings...</p>
    </div>
  {:else}
    <!-- Main Toggle -->
    <div class="card-wrapper">
      <div class="explorer-header">
        <div class="explorer-header-left">
          <span class="explorer-header-icon">◎</span>
          <span class="explorer-header-title">CONTENT FILTERING</span>
        </div>
      </div>
      <div class="card-content">
        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-icon"><Icons name="shield" size={20} /></span>
          <div>
              <span class="settings-row-label">Enable Content Filtering</span>
              <span class="settings-row-desc">Enable safe browsing controls</span>
          </div>
        </div>
        <label class="toggle-wrap">
          <input
            type="checkbox"
            bind:checked={config.Enabled}
            on:change={saveConfig}
            class="toggle"
          />
        </label>
        </div>
      </div>
    </div>

    {#if config.Enabled}
      <!-- Rating Controls -->
      <div class="card-wrapper">
        <div class="explorer-header">
          <div class="explorer-header-left">
            <span class="explorer-header-icon">◆</span>
            <span class="explorer-header-title">RATING CONTROLS</span>
          </div>
        </div>
        <div class="card-content">
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-icon"><Icons name="star" size={20} /></span>
            <div>
                <span class="settings-row-label">Minimum Rating</span>
                <span class="settings-row-desc">Only show apps with this rating or higher</span>
            </div>
          </div>
          <div class="slider-control">
            <span class="slider-value">{config.MinimumRating}</span>
            <input
              type="range"
              min="0"
              max="90"
              step="10"
              bind:value={config.MinimumRating}
              on:change={saveConfig}
              class="slider"
            />
          </div>
        </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-icon"><Icons name="bug" size={20} /></span>
            <div>
                <span class="settings-row-label">Block Malware</span>
                <span class="settings-row-desc">Block apps rated 0-9 (known malware)</span>
            </div>
          </div>
          <label class="toggle-wrap">
            <input
              type="checkbox"
              bind:checked={config.BlockMalware}
              on:change={saveConfig}
              class="toggle"
            />
          </label>
        </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-icon"><Icons name="help-circle" size={20} /></span>
            <div>
                <span class="settings-row-label">Block Unrated Apps</span>
                <span class="settings-row-desc">Block apps that have no ratings yet</span>
            </div>
          </div>
          <label class="toggle-wrap">
            <input
              type="checkbox"
              bind:checked={config.BlockUnrated}
              on:change={saveConfig}
              class="toggle"
            />
          </label>
          </div>
        </div>
      </div>

      <!-- Behavior Controls -->
      <div class="card-wrapper">
        <div class="explorer-header">
          <div class="explorer-header-left">
            <span class="explorer-header-icon">⬢</span>
            <span class="explorer-header-title">BEHAVIOR</span>
          </div>
        </div>
        <div class="card-content">
          <div class="settings-row">
            <div class="settings-row-info" style="flex: 1; min-width: 0; margin-right: 16px;">
              <span class="settings-row-icon"><Icons name="alert-triangle" size={20} /></span>
              <div style="flex: 1; min-width: 0;">
                <span class="settings-row-label">Show Warnings Instead of Blocking</span>
                <span class="settings-row-desc" style="display: block; line-height: 1.4; margin-top: 4px; word-wrap: break-word;">Let you proceed after seeing a warning</span>
              </div>
            </div>
            <label class="toggle-wrap" style="flex-shrink: 0;">
              <input
                type="checkbox"
                bind:checked={config.ShowWarnings}
                on:change={saveConfig}
                class="toggle"
              />
            </label>
          </div>

          <div class="settings-row">
            <div class="settings-row-info" style="flex: 1; min-width: 0; margin-right: 16px;">
              <span class="settings-row-icon"><Icons name="users" size={20} /></span>
              <div style="flex: 1; min-width: 0;">
                <span class="settings-row-label">Parental Controls</span>
                <span class="settings-row-desc" style="display: block; line-height: 1.4; margin-top: 4px; word-wrap: break-word;">Restrict content based on maturity level</span>
              </div>
            </div>
            <select
              bind:value={config.ParentalControlLevel}
              on:change={saveConfig}
              class="select"
              style="width: 140px; max-width: 140px; flex-shrink: 0;"
            >
              <option value="off">Off</option>
              <option value="low">Low (Adult content only)</option>
              <option value="medium">Medium (Rating under 50)</option>
              <option value="high">High (Rating under 70)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Filter Statistics -->
      {#if stats}
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">STATISTICS</span>
            </div>
          </div>
          <div class="card-content">
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-value">{stats.TotalChecks || 0}</span>
              <span class="stat-label">Total Checks</span>
            </div>
            <div class="stat-item">
              <span class="stat-value c-emerald">{stats.TotalAllowed || 0}</span>
              <span class="stat-label">Allowed</span>
            </div>
            <div class="stat-item">
              <span class="stat-value c-warn">{stats.TotalWarnings || 0}</span>
              <span class="stat-label">Warnings</span>
            </div>
            <div class="stat-item">
              <span class="stat-value c-err">{stats.TotalBlocked || 0}</span>
              <span class="stat-label">Blocked</span>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Recent Filter History -->
      {#if history.length > 0}
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">RECENT DECISIONS</span>
            </div>
          </div>
          <div class="card-content">
          <div class="history-list">
            {#each history.slice(0, 10) as item}
              <div class="history-item">
                  <span class="history-icon"><Icons name={getDecisionIcon(item.Decision)} size={16} /></span>
                <div class="history-info">
                  <span class="history-name">{item.AppName || 'Unknown App'}</span>
                  <span class="history-reason">{item.Reason}</span>
                </div>
                <span class="history-decision {getDecisionClass(item.Decision)}">
                  {item.Decision}
                </span>
              </div>
            {/each}
            </div>
          </div>
        </div>
      {/if}
    {:else}
      <div class="disabled-notice">
        <Icons name="info" size={20} />
        <p>Content filtering is disabled. All apps will be shown without restrictions.</p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .safe-browsing-settings {
    padding: 0;
  }

  /* Save Toast */
  .save-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    margin-bottom: var(--s-4, 16px);
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--status-ok);
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

  .card-content {
    padding: 24px;
  }

  /* Settings Row - v6.1 Pattern */
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4, 16px);
    padding: var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
    margin-bottom: 12px;
  }

  .settings-row:last-child {
    margin-bottom: 0;
  }

  .settings-row-info {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3, 12px);
    flex: 1;
  }

  .settings-row-icon {
    color: var(--cyan);
    min-width: 28px;
    text-align: center;
  }

  .settings-row-label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
  }

  .settings-row-desc {
    display: block;
    font-size: 11px;
    color: var(--text-4);
    margin-top: 2px;
  }

  /* Toggle */
  .toggle-wrap {
    cursor: pointer;
    flex-shrink: 0;
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

  /* Slider */
  .slider-control {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    min-width: 140px;
  }

  .slider-value {
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--cyan);
    min-width: 32px;
    text-align: right;
  }

  .slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    background: var(--void-up);
    border-radius: 3px;
    outline: none;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    background: var(--cyan-400, #22d3ee);
    border-radius: 50%;
    cursor: pointer;
  }

  /* Select */
  .select {
    padding: 8px 12px;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: 5px;
    color: var(--text-1);
    font-size: 13px;
    cursor: pointer;
    outline: none;
  }

  .select:focus {
    border-color: var(--cyan);
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-4, 16px);
  }

  .stat-item {
    text-align: center;
    padding: var(--s-4, 16px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
  }

  .stat-value {
    display: block;
    font-size: 20px;
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

  /* History List */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    padding: var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
  }

  .history-icon {
    color: var(--text-3);
  }

  .history-info {
    flex: 1;
    min-width: 0;
  }

  .history-name {
    display: block;
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-reason {
    display: block;
    font-size: 10px;
    color: var(--text-4);
  }

  .history-decision {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--void-up);
  }

  /* Disabled Notice */
  .disabled-notice {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    padding: var(--s-5, 20px);
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: 12px;
    color: var(--text-3);
  }

  .disabled-notice p {
    margin: 0;
    font-size: 13px;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

