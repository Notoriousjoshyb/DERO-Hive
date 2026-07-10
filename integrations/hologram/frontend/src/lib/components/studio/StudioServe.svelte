<script>
  import { Eye, FolderUp, Loader2, RefreshCw, Server, Square } from 'lucide-svelte';

  export let localServerRunning = false;
  export let serveLoading = false;
  export let serveError = '';
  export let localServerUrl = '';
  export let localServerPort = '';
  export let localServerDirectory = '';
  export let localServerWatcherActive = false;
  export let recentChanges = [];
  export let selectAndServeDirectory = () => {};
  export let formatDirectory = (value) => value;
  export let openInBrowser = () => {};
  export let triggerManualRefresh = () => {};
  export let stopLocalServer = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Local Dev Server</h2>
  <p class="content-section-desc">Preview TELA content locally with hot reload before deploying to the blockchain.</p>
  
  {#if !localServerRunning}
    <!-- Select Directory Card -->
    <div class="content-card">
      <div class="content-card-header">
        <Server size={32} class="content-card-icon" />
        <p class="content-card-title">Select a directory to serve</p>
        <p class="content-card-text">
          Choose a folder containing your TELA app (must have index.html).
          Files will be served locally with hot reload enabled.
        </p>
      </div>
      
      <button 
        class="btn btn-primary btn-block" 
        style="margin-top: var(--s-5);"
        on:click={selectAndServeDirectory}
        disabled={serveLoading}
      >
        {#if serveLoading}
          <Loader2 size={14} class="spin" />
          Starting server...
        {:else}
          <FolderUp size={14} />
          Choose Directory
        {/if}
      </button>
      
      {#if serveError}
        <div class="alert-error" style="margin-top: var(--s-4);">
          {serveError}
        </div>
      {/if}
    </div>
    
    <!-- Features Info Card -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">Features</p>
        <ul class="info-list">
          <li>Local HTTP server serves your files</li>
          <li>Hot reload on file changes (HTML, CSS, JS)</li>
          <li>XSWD works with your connected wallet</li>
          <li>Test wallet interactions before deploying</li>
          <li>No blockchain costs during development</li>
        </ul>
      </div>
    </div>
  {:else}
    <!-- Server Running Card -->
    <div class="server-running-card">
      <div class="server-status-header">
        <div class="server-status-indicator running"></div>
        <span class="server-status-text">Local Dev Server Running</span>
      </div>
      
      <div class="server-info-grid">
        <div class="server-info-item">
          <span class="server-info-label">URL</span>
          <span class="server-info-value mono">{localServerUrl}</span>
        </div>
        <div class="server-info-item">
          <span class="server-info-label">Port</span>
          <span class="server-info-value mono">{localServerPort}</span>
        </div>
        <div class="server-info-item">
          <span class="server-info-label">Directory</span>
          <span class="server-info-value" title={localServerDirectory}>{formatDirectory(localServerDirectory)}</span>
        </div>
        <div class="server-info-item">
          <span class="server-info-label">Hot Reload</span>
          <span class="server-info-value" class:status-ok={localServerWatcherActive} class:status-warn={!localServerWatcherActive}>
            {localServerWatcherActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
      
      <div class="server-actions">
        <button class="btn btn-primary" on:click={openInBrowser}>
          <Eye size={14} />
          Open in Browser
        </button>
        <button class="btn btn-secondary" on:click={triggerManualRefresh}>
          <RefreshCw size={14} />
          Refresh
        </button>
        <button class="btn btn-ghost btn-danger" on:click={stopLocalServer}>
          <Square size={14} />
          Stop Server
        </button>
      </div>
    </div>
    
    <!-- File Changes Log -->
    {#if recentChanges.length > 0}
      <div class="info-panel" style="margin-top: var(--s-4);">
        <div class="info-panel-icon">◎</div>
        <div class="info-panel-content">
          <p class="info-panel-title">Recent Changes (Hot Reload)</p>
          <div class="changes-list">
            {#each recentChanges as change}
              <div class="change-item">
                <span class="change-file">{change.file}</span>
                <span class="change-time">{change.time}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
    
    <!-- XSWD Info Card -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">XSWD Integration</p>
        <p class="info-panel-text">
          XSWD is available for your local TELA app. Your app can call wallet methods 
          using the standard <code>telaHost</code> bridge. Make sure you have a wallet 
          connected to test wallet interactions.
        </p>
      </div>
    </div>
  {/if}
</div>
