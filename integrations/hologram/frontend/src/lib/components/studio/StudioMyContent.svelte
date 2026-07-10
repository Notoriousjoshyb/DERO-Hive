<script>
  import {
    AlertTriangle,
    Check,
    Copy,
    Database,
    Eye,
    FileText,
    History,
    Layers,
    Loader2,
    Lock,
    Package,
    RefreshCw,
    Wallet
  } from 'lucide-svelte';

  export let walletIsOpen = false;
  export let myContentGnomonRequired = false;
  export let myContentError = '';
  export let myContentLoading = false;
  export let myDocs = [];
  export let myIndexes = [];
  export let myContentTab = 'all';
  export let availableDocTypes = [];
  export let myContentDocTypeFilter = '';
  export let copiedScid = null;
  export let refreshMyContent = () => {};
  export let loadMyDOCs = () => {};
  export let copyMyContentScid = () => {};
  export let viewMyContentInBrowser = () => {};
  export let viewVersionHistoryFromMyContent = () => {};
  export let updateMyContent = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">My Content</h2>
  <p class="content-section-desc">View and manage DOCs and INDEXes deployed by your wallet.</p>
  
  {#if !walletIsOpen}
    <!-- Wallet Required State -->
    <div class="content-card">
      <div class="content-card-header">
        <Lock size={32} class="content-card-icon" />
        <p class="content-card-title">Wallet Required</p>
        <p class="content-card-text">Connect a wallet to view your deployed DOCs and INDEXes.</p>
      </div>
      
      <button class="btn btn-primary btn-block" style="margin-top: var(--s-5);" on:click={() => window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'wallet' }))}>
        <Wallet size={16} />
        Open Wallet
      </button>
    </div>
  {:else if myContentGnomonRequired}
    <!-- Gnomon Required State - Special handling to prevent infinite loop -->
    <div class="content-card centered">
      <Database size={32} class="content-card-icon" style="color: var(--cyan-400);" />
      <p class="content-card-title">Gnomon Indexer Required</p>
      <p class="content-card-text">The Gnomon indexer needs to be running to discover your deployed content. Start Gnomon in Settings, or use the SCID directly in the Browser.</p>
      
      <div style="display: flex; gap: var(--s-3); margin-top: var(--s-5); justify-content: center;">
        <button class="btn btn-primary" on:click={() => window.dispatchEvent(new CustomEvent('status-click', { detail: { tab: 'settings', section: 'gnomon' } }))}>
          <Database size={16} />
          Open Settings
        </button>
        <button class="btn btn-secondary" on:click={refreshMyContent}>
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    </div>
  {:else if myContentError}
    <!-- Error State -->
    <div class="alert alert-error" style="margin-bottom: var(--s-4);">
      <AlertTriangle size={16} />
      <span>{myContentError}</span>
    </div>
    <button class="btn btn-secondary" on:click={refreshMyContent}>
      <RefreshCw size={16} />
      Retry
    </button>
  {:else if myContentLoading}
    <!-- Loading State -->
    <div class="content-card centered">
      <Loader2 size={32} class="content-card-icon spin" />
      <p class="content-card-text">Loading your content...</p>
    </div>
  {:else}
    <!-- Main Content Card -->
    <div class="content-card" style="text-align: left; padding: var(--s-6);">
      <!-- Stats Row -->
      <div class="mc-stats-row">
        <div class="mc-stat">
          <span class="mc-stat-value">{myDocs.length}</span>
          <span class="mc-stat-label">DOCS</span>
        </div>
        <div class="mc-stat">
          <span class="mc-stat-value">{myIndexes.length}</span>
          <span class="mc-stat-label">INDEXES</span>
        </div>
        <div class="mc-stat">
          <span class="mc-stat-value">{myDocs.length + myIndexes.length}</span>
          <span class="mc-stat-label">TOTAL</span>
        </div>
        <button class="btn btn-ghost btn-sm mc-refresh-btn" on:click={refreshMyContent} title="Refresh">
          <span class:spin={myContentLoading}><RefreshCw size={14} /></span>
        </button>
      </div>
      
      <!-- Tab Filter -->
      <div class="mc-tabs">
        <button 
          class="mc-tab" 
          class:active={myContentTab === 'all'}
          on:click={() => myContentTab = 'all'}
        >
          All ({myDocs.length + myIndexes.length})
        </button>
        <button 
          class="mc-tab" 
          class:active={myContentTab === 'docs'}
          on:click={() => myContentTab = 'docs'}
        >
          <FileText size={14} />
          DOCs ({myDocs.length})
        </button>
        <button 
          class="mc-tab" 
          class:active={myContentTab === 'indexes'}
          on:click={() => myContentTab = 'indexes'}
        >
          <Layers size={14} />
          INDEXes ({myIndexes.length})
        </button>
      </div>
      
      <!-- DOC Type Filter (for docs tab) -->
      {#if myContentTab === 'docs' && availableDocTypes.length > 0}
        <div class="mc-filter">
          <label class="mc-filter-label">FILTER BY TYPE:</label>
          <select class="mc-filter-select" bind:value={myContentDocTypeFilter} on:change={loadMyDOCs}>
            <option value="">All Types</option>
            {#each availableDocTypes as docType}
              <option value={docType}>{docType}</option>
            {/each}
          </select>
        </div>
      {/if}
      
      <!-- Content List -->
      <div class="mc-list">
        {#if myContentTab === 'all' || myContentTab === 'indexes'}
          {#each myIndexes as index}
            <div class="mc-item">
              <div class="mc-item-icon index">
                <Layers size={18} />
              </div>
              <div class="mc-item-info">
                <div class="mc-item-header">
                  <span class="mc-item-name">{index.display_name || index.durl || 'INDEX'}</span>
                  <span class="mc-badge index">INDEX</span>
                </div>
                {#if index.description}
                  <p class="mc-item-desc">{index.description}</p>
                {/if}
                <div class="mc-item-meta">
                  <code class="mc-scid">{index.scid.slice(0, 8)}...{index.scid.slice(-8)}</code>
                  {#if index.doc_count}
                    <span class="mc-doc-count">{index.doc_count} DOC(s)</span>
                  {/if}
                </div>
              </div>
              <div class="mc-item-actions">
                <button class="btn btn-icon" title="Copy SCID" on:click={() => copyMyContentScid(index.scid)}>
                  {#if copiedScid === index.scid}
                    <Check size={14} />
                  {:else}
                    <Copy size={14} />
                  {/if}
                </button>
                <button class="btn btn-icon" title="View in Browser" on:click={() => viewMyContentInBrowser(index.scid)}>
                  <Eye size={14} />
                </button>
                <button class="btn btn-icon" title="Version History" on:click={() => viewVersionHistoryFromMyContent(index.scid)}>
                  <History size={14} />
                </button>
                <button class="btn btn-icon" title="Update INDEX" on:click={() => updateMyContent(index.scid)}>
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          {/each}
        {/if}
        
        {#if myContentTab === 'all' || myContentTab === 'docs'}
          {#each myDocs as doc}
            <div class="mc-item">
              <div class="mc-item-icon doc">
                <FileText size={18} />
              </div>
              <div class="mc-item-info">
                <div class="mc-item-header">
                  <span class="mc-item-name">{doc.display_name || doc.name || 'DOC'}</span>
                  <span class="mc-badge doc">DOC</span>
                  {#if doc.docType}
                    <span class="mc-badge-doctype">{doc.docType}</span>
                  {/if}
                </div>
                {#if doc.description}
                  <p class="mc-item-desc">{doc.description}</p>
                {/if}
                <div class="mc-item-meta">
                  <code class="mc-scid">{doc.scid.slice(0, 8)}...{doc.scid.slice(-8)}</code>
                  {#if doc.subDir}
                    <span class="mc-subdir">{doc.subDir}</span>
                  {/if}
                </div>
              </div>
              <div class="mc-item-actions">
                <button class="btn btn-icon" title="Copy SCID" on:click={() => copyMyContentScid(doc.scid)}>
                  {#if copiedScid === doc.scid}
                    <Check size={14} />
                  {:else}
                    <Copy size={14} />
                  {/if}
                </button>
                <button class="btn btn-icon" title="View" on:click={() => viewMyContentInBrowser(doc.scid)}>
                  <Eye size={14} />
                </button>
              </div>
            </div>
          {/each}
        {/if}
        
        <!-- Empty State -->
        {#if (myContentTab === 'all' && myDocs.length === 0 && myIndexes.length === 0) || 
             (myContentTab === 'docs' && myDocs.length === 0) || 
             (myContentTab === 'indexes' && myIndexes.length === 0)}
          <div class="mc-empty">
            <Package size={32} />
            <p class="mc-empty-title">
              {#if myContentTab === 'all'}
                No content deployed yet
              {:else if myContentTab === 'docs'}
                No DOCs deployed yet
              {:else}
                No INDEXes deployed yet
              {/if}
            </p>
            <p class="mc-empty-hint">
              Deploy DOCs and INDEXes using the Install tabs above.
            </p>
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Info Panel (matching other Studio pages) -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">About My Content</p>
        <ul class="info-list">
          <li>Shows DOCs and INDEXes where your wallet is the owner</li>
          <li>Gnomon must be running to index and discover your content</li>
          <li>Use the action buttons to copy SCIDs, view in browser, or update</li>
        </ul>
      </div>
    </div>
  {/if}
</div>
