<script>
  import {
    AlertTriangle,
    CheckCircle,
    Clipboard,
    Gamepad2,
    Loader2,
    Lock,
    RefreshCw
  } from 'lucide-svelte';
  import { Eye, X } from 'lucide-svelte';

  export let updateResult = null;
  export let updateIndexInfo = null;
  export let updateIndexScid = '';
  export let updateIndexDocs = [];
  export let updateIndexLoading = false;
  export let updateIndexError = '';
  export let updateIndexName = '';
  export let updateIndexDescription = '';
  export let updateIndexIcon = '';
  export let newDocScid = '';
  export let updateInProgress = false;
  export let updateIsSimulator = false;
  export let showUpdateConfirmModal = false;
  export let walletIsOpen = false;
  export let loadIndexInfo = () => {};
  export let resetUpdateIndex = () => {};
  export let canUpdateIndex = () => false;
  export let removeDocFromIndex = () => {};
  export let addDocToIndex = () => {};
  export let prepareIndexUpdate = () => {};
  export let submitIndexUpdate = () => {};
  export let cancelUpdateConfirm = () => {};
  export let copyText = () => {};
  export let navigateTo = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Update TELA INDEX</h2>
  <p class="content-section-desc">Update an existing INDEX with new DOCs or configuration.</p>
  
  <!-- Success Display -->
  {#if updateResult?.type === 'success'}
    <div class="update-success-card">
      <div class="update-success-header">
        <CheckCircle size={24} class="update-success-icon" />
        <div>
          <h3 class="update-success-title">INDEX Updated Successfully!</h3>
          <p class="update-success-subtitle">{updateIndexInfo?.name}</p>
        </div>
      </div>
      
      <div class="update-result-details">
        <div class="update-detail-row">
          <span class="update-detail-label">SCID</span>
          <div class="update-scid-row">
            <code class="update-scid">{updateIndexScid}</code>
            <button class="update-copy-btn" on:click={() => copyText(updateIndexScid)} title="Copy SCID">
              <Clipboard size={14} />
            </button>
          </div>
        </div>
        
        <div class="update-detail-row">
          <span class="update-detail-label">TXID</span>
          <div class="update-scid-row">
            <code class="update-scid">{updateResult.txid}</code>
            <button class="update-copy-btn" on:click={() => copyText(updateResult.txid)} title="Copy TXID">
              <Clipboard size={14} />
            </button>
          </div>
        </div>
        
        <div class="update-detail-row">
          <span class="update-detail-label">DOCs</span>
          <span class="update-detail-value">{updateIndexDocs.length} document(s)</span>
        </div>
      </div>
      
      <div class="update-actions">
        <button class="btn btn-secondary" on:click={() => {
          navigateTo(`tela://${updateIndexInfo?.durl}`);
          window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
        }}>
          <Eye size={16} />
          Preview
        </button>
        <button class="btn btn-ghost" on:click={resetUpdateIndex}>
          Update Another
        </button>
      </div>
    </div>
  {:else if !updateIndexInfo}
    <!-- v6.1 SCID Input -->
    <div class="content-card">
      <div class="content-card-header">
        <RefreshCw size={32} class="content-card-icon" />
        <p class="content-card-title">Load an INDEX to Update</p>
        <p class="content-card-text">Enter the SCID of an INDEX you own to modify its metadata and DOC references.</p>
      </div>
      
      <div class="form-group" style="margin-top: var(--s-4);">
        <input
          type="text"
          bind:value={updateIndexScid}
          placeholder="64-character SCID..."
          class="input input-mono"
          disabled={updateIndexLoading}
          on:keydown={(e) => e.key === 'Enter' && updateIndexScid.length >= 64 && !updateIndexLoading && loadIndexInfo()}
        />
      </div>
      
      <button
        on:click={loadIndexInfo}
        disabled={updateIndexLoading || updateIndexScid.length < 64}
        class="btn btn-primary btn-block"
        style="margin-top: var(--s-4);"
      >
        {#if updateIndexLoading}
          <Loader2 size={16} class="spinner" />
          Loading...
        {:else}
          Load INDEX
        {/if}
      </button>
      
      {#if updateIndexError}
        <div class="alert alert-error" style="margin-top: var(--s-4);">
          <AlertTriangle size={16} />
          <span>{updateIndexError}</span>
        </div>
      {/if}
    </div>
  {:else}
    <!-- INDEX Info Display -->
    <div class="index-info-display">
      <!-- Header with Reset and Mode Badge -->
      <div class="index-info-header">
        <div>
          <div class="index-info-name-row">
            <h3 class="index-info-name">{updateIndexInfo.name}</h3>
            {#if updateIsSimulator}
              <span class="mode-badge simulator">
                <Gamepad2 size={12} />
                SIMULATOR
              </span>
            {/if}
          </div>
          <p class="index-info-scid">{updateIndexScid.slice(0, 16)}...{updateIndexScid.slice(-8)}</p>
        </div>
        <button on:click={resetUpdateIndex} class="btn btn-ghost">
          ← Load Different
        </button>
      </div>
      
      <!-- Version Warning -->
      {#if updateIndexInfo.currentVersion && !updateIndexInfo.isLatest}
        <div class="alert alert-info" style="margin-bottom: var(--s-4);">
          <RefreshCw size={16} />
          <span>INDEX version {updateIndexInfo.currentVersion} will be upgraded to {updateIndexInfo.latestVersion}</span>
        </div>
      {/if}
      
      <!-- Ownership Status -->
      {#if !updateIndexInfo.canUpdate}
        <div class="alert alert-error" style="margin-bottom: var(--s-4);">
          <Lock size={16} />
          <span>This INDEX is immutable (deployed with Ring 16+) and cannot be updated.</span>
        </div>
      {:else if !updateIndexInfo.isOwner && !updateIsSimulator}
        <div class="alert alert-warning" style="margin-bottom: var(--s-4);">
          <AlertTriangle size={16} />
          <div>
            <p>Your wallet is not the owner of this INDEX.</p>
            <p style="font-size: 11px; margin-top: 4px; color: var(--text-4);">Owner: {updateIndexInfo.owner?.slice(0, 24)}...</p>
          </div>
        </div>
      {:else if updateIndexInfo.isOwner}
        <div class="alert alert-success" style="margin-bottom: var(--s-4);">
          <CheckCircle size={16} />
          <span>You are the owner of this INDEX.</span>
        </div>
      {/if}
      
      <!-- Error Display -->
      {#if updateResult?.type === 'error'}
        <div class="alert alert-error" style="margin-bottom: var(--s-4);">
          <AlertTriangle size={16} />
          <span>{updateResult.message}</span>
        </div>
      {/if}
      
      <!-- Editable Metadata -->
      <div class="card-section">
        <h4 class="card-section-title">INDEX Metadata</h4>
        
        <div class="form-group">
          <label class="form-label">Name</label>
          <input
            type="text"
            bind:value={updateIndexName}
            placeholder="INDEX name..."
            class="input"
            disabled={!canUpdateIndex()}
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">dURL <span class="label-hint">(cannot be changed)</span></label>
          <input
            type="text"
            value={updateIndexInfo.durl || ''}
            class="input input-mono"
            disabled
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea
            bind:value={updateIndexDescription}
            placeholder="Description..."
            class="input"
            rows="2"
            disabled={!canUpdateIndex()}
          ></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Icon URL</label>
          <input
            type="text"
            bind:value={updateIndexIcon}
            placeholder="Icon DOC SCID (recommended) or URL"
            class="input"
            disabled={!canUpdateIndex()}
          />
          <p class="form-hint">Recommended: use an on-chain icon DOC SCID (100x100 SVG/PNG works well). Note: older INDEX versions may require a contract upgrade before header icon changes persist.</p>
        </div>
      </div>
      
      <!-- DOCs List -->
      <div class="card-section">
        <div class="docs-list-header">
          <h4 class="card-section-title">DOC References ({updateIndexDocs.length})</h4>
        </div>
        
        {#if updateIndexDocs.length > 0}
          <div class="docs-list">
            {#each updateIndexDocs as doc, i}
              <div class="doc-item">
                <span class="doc-item-num">{i + 1}.</span>
                <span class="doc-item-scid">{doc}</span>
                <button
                  on:click={() => removeDocFromIndex(doc)}
                  class="remove-btn"
                  disabled={!canUpdateIndex()}
                >
                  <X size={14} />
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="docs-list-empty">No DOCs in this INDEX</p>
        {/if}
        
        <!-- Add DOC -->
        {#if canUpdateIndex()}
          <div class="doc-add-row">
            <input
              type="text"
              bind:value={newDocScid}
              placeholder="Add DOC SCID..."
              class="input input-mono"
              on:keydown={(e) => e.key === 'Enter' && addDocToIndex()}
            />
            <button
              on:click={addDocToIndex}
              disabled={newDocScid.length < 64}
              class="btn btn-secondary"
            >
              + Add
            </button>
          </div>
        {/if}
      </div>
      
      <!-- Submit Button -->
      <div class="submit-row">
        <button
          on:click={prepareIndexUpdate}
          disabled={!canUpdateIndex() || updateInProgress}
          class="btn btn-primary btn-lg btn-block"
        >
          {#if updateInProgress}
            <Loader2 size={16} class="spinner" />
            Updating...
          {:else}
            <RefreshCw size={16} />
            Update INDEX
          {/if}
        </button>
        
        {#if updateIsSimulator}
          <p class="simulator-note">
            <Gamepad2 size={12} />
            Simulator mode: Free transactions, auto-mines
          </p>
        {:else if !walletIsOpen}
          <p class="wallet-warning">Connect wallet to update INDEX</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Update Confirmation Modal -->
{#if showUpdateConfirmModal}
  <div class="modal-overlay" on:click={cancelUpdateConfirm}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon"><RefreshCw size={20} /></div>
          <h3 class="modal-title">Confirm INDEX Update</h3>
        </div>
      </div>
      
      <div class="modal-body">
        <p style="color: var(--text-2); margin-bottom: var(--s-3);">You are about to update:</p>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">Name</span>
            <span class="confirm-value">{updateIndexName}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">dURL</span>
            <code class="confirm-value">{updateIndexInfo?.durl}</code>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">DOCs</span>
            <span class="confirm-value">{updateIndexDocs.length} document(s)</span>
          </div>
        </div>
        <p class="modal-warning">
          <AlertTriangle size={14} />
          This transaction cannot be undone.
        </p>
      </div>
      
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" on:click={cancelUpdateConfirm}>Cancel</button>
        <button class="modal-btn modal-btn-primary" on:click={submitIndexUpdate}>
          Confirm Update
        </button>
      </div>
    </div>
  </div>
{/if}
