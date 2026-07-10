<script>
  import {
    AlertTriangle,
    CheckCircle,
    Clipboard,
    Copy,
    FolderDown,
    Loader2,
    Server
  } from 'lucide-svelte';

  export let cloneError = '';
  export let cloneResult = null;
  export let cloneScid = '';
  export let cloneLoading = false;
  export let showCloneConfirmModal = false;
  export let copyClonePath = () => {};
  export let openCloneFolder = () => {};
  export let serveClonedContent = () => {};
  export let resetClone = () => {};
  export let cloneContent = () => {};
  export let cancelCloneUpdate = () => {};
  export let confirmCloneUpdate = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Clone TELA Content</h2>
  <p class="content-section-desc">Download TELA content from the blockchain to your local machine.</p>
  
  <!-- Error Display -->
  {#if cloneError}
    <div class="alert alert-error" style="margin-bottom: var(--s-4);">
      <AlertTriangle size={16} />
      <span>{cloneError}</span>
    </div>
  {/if}
  
  <!-- Success Display -->
  {#if cloneResult}
    <div class="clone-success-card">
      <div class="clone-success-header">
        <CheckCircle size={24} class="clone-success-icon" />
        <div>
          <h3 class="clone-success-title">Content Cloned Successfully!</h3>
          <p class="clone-success-subtitle">{cloneResult.contentType}: {cloneResult.name}</p>
        </div>
      </div>
      
      <div class="clone-result-details">
        {#if cloneResult.dURL}
          <div class="clone-detail-row">
            <span class="clone-detail-label">dURL</span>
            <code class="clone-detail-value">{cloneResult.dURL}</code>
          </div>
        {/if}
        
        {#if cloneResult.description}
          <div class="clone-detail-row">
            <span class="clone-detail-label">Description</span>
            <span class="clone-detail-value">{cloneResult.description}</span>
          </div>
        {/if}
        
        {#if cloneResult.fileCount}
          <div class="clone-detail-row">
            <span class="clone-detail-label">Files</span>
            <span class="clone-detail-value">{cloneResult.fileCount} {cloneResult.contentType === 'INDEX' ? 'DOC(s)' : 'file'}</span>
          </div>
        {/if}
        
        <div class="clone-detail-row">
          <span class="clone-detail-label">Location</span>
          <div class="clone-path-row">
            <code class="clone-path">{cloneResult.directory}</code>
            <button class="clone-copy-btn" on:click={copyClonePath} title="Copy path">
              <Clipboard size={14} />
            </button>
          </div>
        </div>
      </div>
      
      <div class="clone-actions">
        <button class="btn btn-secondary" on:click={openCloneFolder}>
          <FolderDown size={16} />
          Open Folder
        </button>
        <button class="btn btn-secondary" on:click={serveClonedContent}>
          <Server size={16} />
          Serve Content
        </button>
        <button class="btn btn-ghost" on:click={resetClone}>
          Clone Another
        </button>
      </div>
    </div>
  {:else}
    <!-- Clone Input Card -->
    <div class="content-card">
      <div class="content-card-header">
        <Copy size={32} class="content-card-icon" />
        <p class="content-card-title">Clone from Blockchain</p>
        <p class="content-card-text">Enter an SCID to download TELA content (DOC or INDEX) to your local machine.</p>
      </div>
      
      <div class="form-group" style="margin-top: var(--s-4);">
        <label class="form-label">SCID <span class="label-hint">(64 characters, or scid@txid for specific version)</span></label>
        <input
          type="text"
          bind:value={cloneScid}
          placeholder="Enter SCID or scid@txid..."
          class="input input-mono"
          disabled={cloneLoading}
        />
      </div>
      
      <button 
        class="btn btn-primary btn-block" 
        style="margin-top: var(--s-4);"
        on:click={() => cloneContent(false)}
        disabled={cloneLoading || !cloneScid || cloneScid.length < 64}
      >
        {#if cloneLoading}
          <Loader2 size={16} class="spinner" />
          Cloning...
        {:else}
          <FolderDown size={16} />
          Clone Content
        {/if}
      </button>
    </div>
    
    <!-- Clone Info -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">About Cloning</p>
        <ul class="info-list">
          <li>Content is downloaded to: <code>~/.tela/datashards/clone/</code></li>
          <li>Use <code>scid@txid</code> format to clone a specific version</li>
          <li>You'll be prompted if content has been updated since original deployment</li>
        </ul>
      </div>
    </div>
  {/if}
</div>

<!-- Clone Update Confirmation Modal -->
{#if showCloneConfirmModal}
  <div class="modal-overlay" on:click={cancelCloneUpdate}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon warning">
            <AlertTriangle size={18} />
          </div>
          <h3 class="modal-title">Content Has Been Updated</h3>
        </div>
      </div>
      
      <div class="modal-body">
        <p>This TELA content has been updated since its original deployment.</p>
        <p style="margin-top: var(--s-3); color: var(--text-3);">
          Do you want to clone the <strong>latest version</strong>?
        </p>
      </div>
      
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" on:click={cancelCloneUpdate}>Cancel</button>
        <button class="modal-btn modal-btn-primary" on:click={confirmCloneUpdate}>
          Clone Latest Version
        </button>
      </div>
    </div>
  </div>
{/if}
