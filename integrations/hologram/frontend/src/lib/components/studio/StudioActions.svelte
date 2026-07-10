<script>
  import {
    AlertTriangle,
    ArrowRight,
    Copy,
    Eye,
    FileText,
    GitBranch,
    History,
    Layers,
    Lightbulb,
    Loader2,
    Package,
    RefreshCw,
    Search,
    Wallet,
    X
  } from 'lucide-svelte';

  export let actionsError = '';
  export let actionsScid = '';
  export let actionsLoading = false;
  export let actionsContentInfo = null;
  export let myIndexes = [];
  export let myContentLoaded = false;
  export let walletIsOpen = false;
  export let loadActionsContent = () => {};
  export let openVersionHistory = () => {};
  export let viewMyContentInBrowser = () => {};
  export let onCloneLatest = () => {};
  export let onUpdateIndex = () => {};
  export let onGoToMyContent = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Version Control</h2>
  <p class="content-section-desc">View version history, compare commits, and perform actions on TELA content.</p>
  
  <!-- Error Display -->
  {#if actionsError}
    <div class="alert alert-error" style="margin-bottom: var(--s-4);">
      <AlertTriangle size={16} />
      <span>{actionsError}</span>
      <button class="btn btn-ghost btn-sm" on:click={() => actionsError = ''}>
        <X size={14} />
      </button>
    </div>
  {/if}
  
  <!-- SCID Input Card -->
  <div class="content-card">
    <div class="content-card-header">
      <GitBranch size={32} class="content-card-icon" />
      <p class="content-card-title">Load an INDEX to Update</p>
      <p class="content-card-text">Enter the SCID of an INDEX you own to modify its metadata and DOC references.</p>
    </div>
    
    <div class="form-group" style="margin-top: var(--s-4);">
      <label class="form-label">SCID <span class="label-hint">(64-character INDEX Smart Contract ID)</span></label>
      <input
        type="text"
        bind:value={actionsScid}
        placeholder="64-character SCID..."
        class="input input-mono"
        maxlength="64"
        on:keydown={(e) => e.key === 'Enter' && actionsScid.length === 64 && !actionsLoading && loadActionsContent()}
      />
    </div>
    
    <button 
      class="btn btn-primary btn-block" 
      style="margin-top: var(--s-4);"
      on:click={loadActionsContent}
      disabled={actionsLoading || actionsScid.length !== 64}
    >
      {#if actionsLoading}
        <Loader2 size={16} class="spinner" />
        Loading...
      {:else}
        <Search size={16} />
        Load INDEX
      {/if}
    </button>
  </div>
  
  <!-- Loaded Content Info & Actions -->
  {#if actionsContentInfo}
    <div class="vc-loaded-card">
      <div class="vc-loaded-header">
        <div class="vc-loaded-icon">
          {#if actionsContentInfo.type === 'INDEX'}
            <Layers size={24} />
          {:else}
            <FileText size={24} />
          {/if}
        </div>
        <div class="vc-loaded-info">
          <h3 class="vc-loaded-name">{actionsContentInfo.name}</h3>
          <div class="vc-loaded-meta">
            <span class="badge badge-cyan">{actionsContentInfo.type}</span>
            {#if actionsContentInfo.durl}
              <code class="vc-loaded-durl">{actionsContentInfo.durl}</code>
            {/if}
            {#if actionsContentInfo.docCount}
              <span class="vc-loaded-docs">{actionsContentInfo.docCount} DOC(s)</span>
            {/if}
          </div>
          {#if actionsContentInfo.description}
            <p class="vc-loaded-desc">{actionsContentInfo.description}</p>
          {/if}
        </div>
      </div>
      
      <div class="vc-loaded-scid">
        <code>{actionsContentInfo.scid}</code>
      </div>
      
      <!-- Action Buttons -->
      <div class="vc-actions-grid">
        <button class="btn btn-primary" on:click={() => openVersionHistory(actionsContentInfo.scid)}>
          <History size={16} />
          Version History
        </button>
        <button class="btn btn-secondary" on:click={() => onCloneLatest(actionsContentInfo.scid)}>
          <Copy size={16} />
          Clone Latest
        </button>
        <button class="btn btn-secondary" on:click={() => onUpdateIndex(actionsContentInfo.scid)}>
          <RefreshCw size={16} />
          Update INDEX
        </button>
        <button class="btn btn-secondary" on:click={() => viewMyContentInBrowser(actionsContentInfo.scid)}>
          <Eye size={16} />
          Preview
        </button>
      </div>
    </div>
  {/if}
  
  <!-- Quick Access: Your INDEXes -->
  {#if !walletIsOpen}
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon"><Wallet size={16} /></div>
      <div class="info-panel-content">
        <p class="info-panel-title">Connect a wallet to see your INDEXes for quick access.</p>
      </div>
    </div>
  {:else if myIndexes.length > 0}
    <div class="vc-quick-section">
      <h3 class="vc-section-title">
        <Package size={16} />
        Your INDEXes
      </h3>
      <div class="vc-quick-list">
        {#each myIndexes.slice(0, 5) as index}
          <button 
            class="vc-quick-item"
            on:click={() => { actionsScid = index.scid; loadActionsContent(); }}
          >
            <div class="vc-quick-icon">
              <Layers size={16} />
            </div>
            <div class="vc-quick-info">
              <span class="vc-quick-name">{index.display_name || index.durl || 'INDEX'}</span>
              <code class="vc-quick-scid">{index.scid.slice(0, 12)}...{index.scid.slice(-8)}</code>
            </div>
            <ArrowRight size={16} class="vc-quick-arrow" />
          </button>
        {/each}
      </div>
      
      {#if myIndexes.length > 5}
        <p class="vc-quick-more">
          <a href="#my-content" on:click|preventDefault={onGoToMyContent}>
            View all {myIndexes.length} INDEXes →
          </a>
        </p>
      {/if}
    </div>
  {:else if walletIsOpen && myContentLoaded}
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon"><Lightbulb size={16} /></div>
      <div class="info-panel-content">
        <p class="info-panel-title">No INDEXes Found</p>
        <p class="info-panel-text">Deploy your first INDEX to use version control features.</p>
      </div>
    </div>
  {/if}
  
  <!-- How It Works Info Card -->
  <div class="info-panel" style="margin-top: var(--s-4);">
    <div class="info-panel-icon">◎</div>
    <div class="info-panel-content">
      <p class="info-panel-title">How TELA Version Control Works</p>
      <ul class="info-list">
        <li><strong>Immutable DOCs</strong> — TELA-DOC-1 contracts are immutable once deployed. The code never changes.</li>
        <li><strong>Mutable INDEXes</strong> — TELA-INDEX-1 contracts (deployed with ringsize 2) can be updated by their owner.</li>
        <li><strong>Commit History</strong> — Each update creates a new "commit" with a TXID. You can view, compare, or revert to any version.</li>
        <li><strong>Clone at Version</strong> — Use <code>scid@txid</code> format to clone content at a specific version.</li>
      </ul>
    </div>
  </div>
</div>
