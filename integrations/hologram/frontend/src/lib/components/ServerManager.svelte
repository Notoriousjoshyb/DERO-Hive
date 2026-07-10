<script>
  import { onMount, onDestroy } from 'svelte';
  import { 
    ListActiveServers, ShutdownServer, ShutdownAllServers,
    GetServerPortRange, SetServerPortStart, SetMaxServers,
    OpenURLInBrowserIfAllowed
  } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  
  let servers = [];
  let loading = false;
  let portStart = 44390;
  let maxServers = 10;
  let showSettings = false;
  let refreshInterval;
  
  onMount(async () => {
    await refreshServers();
    await loadPortSettings();
    
    // Auto-refresh every 5 seconds
    refreshInterval = setInterval(refreshServers, 5000);
  });
  
  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
  
  async function refreshServers() {
    try {
      const result = await ListActiveServers();
      if (result.success) {
        servers = result.servers || [];
      }
    } catch (e) {
      console.error('Failed to list servers:', e);
    }
  }
  
  async function loadPortSettings() {
    try {
      const result = await GetServerPortRange();
      if (result.success) {
        portStart = result.startPort;
        maxServers = result.maxServers;
      }
    } catch (e) {
      console.error('Failed to load port settings:', e);
    }
  }
  
  async function shutdownOne(name) {
    loading = true;
    try {
      const result = await ShutdownServer(name);
      if (result.success) {
        toast.success(`Server "${name}" stopped`);
        await refreshServers();
      } else {
        toast.error(result.error || 'Failed to stop server');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to stop server');
    } finally {
      loading = false;
    }
  }
  
  async function shutdownAll() {
    if (!confirm('Stop all active TELA servers?')) return;
    
    loading = true;
    try {
      const result = await ShutdownAllServers();
      if (result.success) {
        toast.success(`Stopped ${result.count} servers`);
        await refreshServers();
      } else {
        toast.error(result.error || 'Failed to stop servers');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to stop servers');
    } finally {
      loading = false;
    }
  }
  
  async function savePortStart() {
    try {
      const result = await SetServerPortStart(portStart);
      if (result.success) {
        toast.success('Port start updated');
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e.message);
    }
  }
  
  async function saveMaxServers() {
    try {
      const result = await SetMaxServers(maxServers);
      if (result.success) {
        toast.success('Max servers updated');
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e.message);
    }
  }
  
  async function openServerURL(url) {
    if (!url) return;
    try {
      const res = await OpenURLInBrowserIfAllowed(url);
      if (!res?.success) {
        return;
      }
    } catch (e) {
      toast.error(e.message || 'Failed to open URL');
    }
  }
  
  function truncateSCID(scid) {
    if (!scid || scid.length < 20) return scid || 'Local';
    return scid.substring(0, 8) + '...' + scid.substring(scid.length - 8);
  }
</script>

<div class="server-manager">
  <!-- Header (uses standard card-wrapper pattern) -->
  <div class="card-wrapper">
    <div class="explorer-header">
      <div class="explorer-header-left">
        <span class="explorer-header-icon">◎</span>
        <span class="explorer-header-title">ACTIVE TELA SERVERS</span>
        <span class="server-count">{servers.length}</span>
      </div>
      <div class="explorer-header-right">
        <button 
          class="btn-icon" 
          on:click={() => showSettings = !showSettings}
          title="Server Settings"
        >
          ⚙
        </button>
        <button 
          class="btn-icon" 
          on:click={refreshServers}
          disabled={loading}
          title="Refresh"
        >
          ↻
        </button>
        {#if servers.length > 0}
          <button 
            class="btn-danger" 
            on:click={shutdownAll}
            disabled={loading}
          >
            Stop All
          </button>
        {/if}
      </div>
    </div>
  
  <!-- Card Content -->
    <div class="card-content">
      <!-- Settings Panel -->
      {#if showSettings}
        <div class="settings-panel">
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">Port Start</label>
              <span class="setting-hint">First port for TELA servers (1024-65535)</span>
            </div>
            <div class="setting-input">
              <input 
                type="number" 
                bind:value={portStart} 
                min="1024" 
                max="65535"
                class="input-number"
              />
              <button class="btn-sm" on:click={savePortStart}>Save</button>
            </div>
          </div>
          
          <div class="setting-row">
            <div class="setting-info">
              <label class="setting-label">Max Servers</label>
              <span class="setting-hint">Maximum concurrent servers (1-100)</span>
            </div>
            <div class="setting-input">
              <input 
                type="number" 
                bind:value={maxServers} 
                min="1" 
                max="100"
                class="input-number"
              />
              <button class="btn-sm" on:click={saveMaxServers}>Save</button>
            </div>
          </div>
          
          <div class="port-range-info">
            Port Range: {portStart} - {portStart + maxServers - 1}
          </div>
        </div>
      {/if}
      
      <!-- Server List -->
      <div class="server-list">
        {#if servers.length === 0}
          <div class="empty-state">
            <span class="empty-icon">◎</span>
            <p class="empty-text">No active servers</p>
            <p class="empty-hint">Servers will appear here when you browse or serve TELA content</p>
          </div>
        {:else}
          {#each servers as server}
            <div class="server-card">
              <div class="server-info">
                <div class="server-name">
                  {server.name || 'Unnamed'}
                  {#if server.isLocal}
                    <span class="badge local">Local</span>
                  {:else}
                    <span class="badge tela">TELA</span>
                  {/if}
                </div>
                {#if server.scid}
                  <div class="server-scid" title={server.scid}>
                    {truncateSCID(server.scid)}
                  </div>
                {/if}
                {#if server.url || server.address}
                  <div class="server-url">
                    {server.url || server.address}
                  </div>
                {/if}
              </div>
              <div class="server-actions">
                {#if server.url}
                  <button 
                    class="btn-icon small" 
                    on:click={() => openServerURL(server.url)}
                    title="Open in browser"
                  >
                    ↗
                  </button>
                {/if}
                <button 
                  class="btn-icon small danger" 
                  on:click={() => shutdownOne(server.name)}
                  disabled={loading}
                  title="Stop server"
                >
                  ✕
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* === Card styles (must match Settings.svelte exactly) === */
  .card-wrapper {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
    margin-bottom: var(--s-6, 24px);
  }
  
  .explorer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--void-deep, #08080e);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  }
  
  .explorer-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .explorer-header-icon {
    font-size: 16px;
    color: var(--cyan-400, #22d3ee);
    line-height: 1;
  }
  
  .explorer-header-title {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-1, #f8f8fc);
  }
  
  .explorer-header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .card-content {
    padding: 24px;
  }
  
  /* === Component-specific styles === */
  .server-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--void-up, #181824);
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-3, #707088);
  }
  
  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: var(--void-up, #181824);
    border: none;
    border-radius: var(--r-xs, 4px);
    color: var(--text-3, #707088);
    font-size: 11px;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-icon:hover {
    background: var(--void-surface, #1e1e2a);
    color: var(--text-1, #f8f8fc);
  }
  
  .btn-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-icon.small {
    width: 18px;
    height: 18px;
    font-size: 10px;
  }
  
  .btn-icon.danger:hover {
    background: rgba(248, 113, 113, 0.2);
    color: var(--status-err, #f87171);
  }
  
  .btn-danger {
    padding: var(--s-1, 4px) var(--s-3, 12px);
    background: rgba(248, 113, 113, 0.15);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--r-md, 8px);
    color: var(--status-err, #f87171);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-danger:hover {
    background: rgba(248, 113, 113, 0.25);
  }
  
  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Settings Panel */
  .settings-panel {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4, 16px);
    margin-bottom: var(--s-3, 12px);
  }
  
  .setting-row:last-of-type {
    margin-bottom: var(--s-3, 12px);
  }
  
  .setting-info {
    display: flex;
    flex-direction: column;
    gap: var(--s-1, 4px);
  }
  
  .setting-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .setting-hint {
    font-size: 11px;
    color: var(--text-5, #404058);
  }
  
  .setting-input {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  .input-number {
    width: 100px;
    padding: var(--s-1, 4px) var(--s-2, 8px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-md, 8px);
    color: var(--text-1, #f8f8fc);
    font-size: 13px;
    font-family: var(--font-mono);
    text-align: center;
  }
  
  .input-number:focus {
    outline: none;
    border-color: var(--cyan-500, #06b6d4);
  }
  
  .btn-sm {
    padding: var(--s-1, 4px) var(--s-3, 12px);
    background: var(--void-up, #181824);
    border: none;
    border-radius: var(--r-md, 8px);
    color: var(--text-3, #707088);
    font-size: 12px;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-sm:hover {
    background: var(--cyan-500, #06b6d4);
    color: var(--void-pure, #000);
  }
  
  .port-range-info {
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-md, 8px);
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-4, #505068);
    text-align: center;
  }
  
  /* Server List */
  .server-list {
    padding: var(--s-4, 16px);
    max-height: 320px;
    overflow-y: auto;
  }
  
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-8, 32px);
    text-align: center;
  }
  
  .empty-icon {
    font-size: 32px;
    color: var(--text-5, #404058);
    margin-bottom: var(--s-3, 12px);
  }
  
  .empty-text {
    font-size: 14px;
    color: var(--text-3, #707088);
    margin: 0 0 var(--s-1, 4px) 0;
  }
  
  .empty-hint {
    font-size: 12px;
    color: var(--text-5, #404058);
    margin: 0;
  }
  
  .server-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    margin-bottom: var(--s-2, 8px);
  }
  
  .server-card:last-child {
    margin-bottom: 0;
  }
  
  .server-info {
    display: flex;
    flex-direction: column;
    gap: var(--s-1, 4px);
    min-width: 0;
    flex: 1;
  }
  
  .server-name {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1, #f8f8fc);
  }
  
  .badge {
    padding: 2px 6px;
    border-radius: var(--r-xs, 3px);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  
  .badge.local {
    background: rgba(251, 191, 36, 0.2);
    color: var(--amber-400, #fbbf24);
  }
  
  .badge.tela {
    background: rgba(6, 182, 212, 0.2);
    color: var(--cyan-400, #22d3ee);
  }
  
  .server-scid {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-4, #505068);
  }
  
  .server-url {
    font-size: 12px;
    color: var(--cyan-400, #22d3ee);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  
  .server-actions {
    display: flex;
    align-items: center;
    gap: var(--s-1, 4px);
    flex-shrink: 0;
  }
</style>

