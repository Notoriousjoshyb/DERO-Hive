<script>
  import {
    AlertTriangle,
    ArrowRight,
    Database,
    FileText,
    Layers,
    Library,
    Minus,
    Package,
    RefreshCw,
    Search,
    ThumbsDown,
    ThumbsUp,
    X
  } from 'lucide-svelte';

  export let librarySearchQuery = '';
  export let librariesLoading = false;
  export let librariesLoadingStatus = '';
  export let librariesError = '';
  export let gnomonRequired = false;
  export let libraries = [];
  export let filteredLibraries = [];
  export let loadLibrariesData = () => {};
  export let goToSettings = () => {};
  export let openLibraryDetails = () => {};
</script>

<div class="content-section libraries-section">
  <h2 class="content-section-title">TELA Libraries</h2>
  <p class="content-section-desc">Reusable code libraries deployed to the TELA network.</p>
  
  <!-- Toolbar -->
  <div class="libs-toolbar">
    <label class="search-box">
      <Search size={16} />
      <input
        type="text"
        bind:value={librarySearchQuery}
        placeholder="Search by name, dURL, or description..."
        class="search-input"
        disabled={librariesLoading}
      />
      {#if librarySearchQuery}
        <button class="search-clear" type="button" on:click={() => librarySearchQuery = ''}>
          <X size={14} />
        </button>
      {/if}
    </label>
    
    <button 
      on:click={() => loadLibrariesData(true)} 
      class="btn btn-ghost libs-refresh-btn" 
      disabled={librariesLoading}
      title="Refresh library list"
    >
      <span class:spin={librariesLoading}><RefreshCw size={14} /></span>
      <span class="libs-refresh-text">Refresh</span>
    </button>
  </div>
  
  <!-- Content Area -->
  <div class="libs-content">
    {#if librariesLoading}
      <div class="libs-loading">
        <div class="libs-loading-animation">
          <div class="libs-loading-ring"></div>
          <Library size={32} class="libs-loading-icon" />
        </div>
        <div class="libs-loading-text">
          <p class="libs-loading-title">Loading Libraries</p>
          <p class="libs-loading-status">{librariesLoadingStatus || 'Please wait...'}</p>
        </div>
      </div>
    {:else if librariesError}
      <div class="libs-error">
        <div class="libs-error-icon">
          <AlertTriangle size={40} />
        </div>
        <h3 class="libs-error-title">Unable to Load Libraries</h3>
        <p class="libs-error-message">{librariesError}</p>
        <div class="libs-error-actions">
          {#if gnomonRequired}
            <button on:click={goToSettings} class="btn btn-primary">
              <Database size={14} />
              Go to Settings
            </button>
          {/if}
          <button on:click={() => loadLibrariesData(true)} class="btn btn-secondary">
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      </div>
    {:else if libraries.length === 0}
      <!-- Empty State - Using content-card pattern like Clone/Serve/DocShards -->
      <div class="content-card">
        <div class="content-card-header">
          <Library size={32} class="content-card-icon" />
          <p class="content-card-title">No Libraries Found</p>
          <p class="content-card-text">Libraries are TELA content with a <code>.lib</code> suffix in their dURL.</p>
        </div>
        
        <button 
          class="btn btn-primary btn-block" 
          style="margin-top: var(--s-4);"
          on:click={() => loadLibrariesData(true)}
        >
          <RefreshCw size={16} />
          Check Again
        </button>
      </div>
      
      <!-- Info Panel - Using info-panel pattern like Clone/DocShards -->
      <div class="info-panel" style="margin-top: var(--s-4);">
        <div class="info-panel-icon">◎</div>
        <div class="info-panel-content">
          <p class="info-panel-title">About Libraries</p>
          <ul class="info-list">
            <li>Deploy reusable JavaScript, CSS, or HTML snippets</li>
            <li>Reference libraries in your TELA apps using dURL</li>
            <li>Example: <code>mylib.lib</code> or <code>utils.lib</code></li>
          </ul>
        </div>
      </div>
    {:else if filteredLibraries.length === 0}
      <div class="libs-no-results">
        <span class="libs-no-results-icon"><Search size={32} /></span>
        <p>No libraries match "<strong>{librarySearchQuery}</strong>"</p>
        <button on:click={() => librarySearchQuery = ''} class="btn btn-ghost">
          Clear search
        </button>
      </div>
    {:else}
      <div class="libs-results-info">
        Showing {filteredLibraries.length} {filteredLibraries.length === 1 ? 'library' : 'libraries'}
        {#if librarySearchQuery}
          matching "<strong>{librarySearchQuery}</strong>"
        {/if}
      </div>
      <div class="libs-grid">
        {#each filteredLibraries as lib}
          <button class="lib-card" on:click={() => openLibraryDetails(lib)}>
            <div class="lib-card-header">
              <div class="lib-card-icon" class:lib-card-icon-index={lib.type === 'INDEX'}>
                {#if lib.type === 'INDEX'}
                  <Layers size={20} />
                {:else}
                  <FileText size={20} />
                {/if}
              </div>
              <div class="lib-card-badges">
                <span class="lib-card-type" class:lib-type-index={lib.type === 'INDEX'}>
                  {lib.type || 'DOC'}
                </span>
                {#if lib.rating && lib.rating.count > 0}
                  <span class="lib-card-rating" title="{lib.rating.likes} likes / {lib.rating.dislikes} dislikes">
                    {#if lib.rating.likes > lib.rating.dislikes}
                      <ThumbsUp size={10} />
                    {:else if lib.rating.likes === lib.rating.dislikes}
                      <Minus size={10} />
                    {:else}
                      <ThumbsDown size={10} />
                    {/if}
                    {lib.rating.count}
                  </span>
                {/if}
              </div>
            </div>
            
            <div class="lib-card-body">
              <h3 class="lib-card-name">{lib.display_name || lib.name || 'Unnamed Library'}</h3>
              {#if lib.durl}
                <code class="lib-card-durl">{lib.durl}</code>
              {/if}
              {#if lib.description}
                <p class="lib-card-desc">{lib.description.slice(0, 100)}{lib.description.length > 100 ? '...' : ''}</p>
              {/if}
            </div>
            
            <div class="lib-card-footer">
              {#if lib.type === 'INDEX' && lib.doc_count > 0}
                <span class="lib-card-meta">
                  <Package size={12} />
                  {lib.doc_count} file{lib.doc_count > 1 ? 's' : ''}
                </span>
              {:else}
                <span class="lib-card-meta"></span>
              {/if}
              <span class="lib-card-arrow-wrap">
                <span class="lib-card-arrow-text">View</span>
                <ArrowRight size={14} />
              </span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
