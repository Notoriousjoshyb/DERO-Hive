<script>
  import {
    AlertTriangle,
    CheckCircle,
    Package,
    Loader2,
    RefreshCw
  } from 'lucide-svelte';
  import { AddSCIDToIndex } from '../../../../wailsjs/go/main/App.js';

  // Component state
  let scidInput = '';
  let loading = false;
  let error = '';
  let result = null;

  // Input validation
  $: isValidScid = scidInput.trim().length === 64 && /^[a-fA-F0-9]+$/.test(scidInput.trim());

  async function handleAddSCID() {
    if (!isValidScid) {
      error = 'Please enter a valid 64-character hex SCID';
      return;
    }

    loading = true;
    error = '';
    result = null;

    try {
      const res = await AddSCIDToIndex(scidInput.trim());
      
      if (res.success) {
        result = res;
        error = '';
      } else {
        error = res.error || 'Failed to add SCID to index';
      }
    } catch (e) {
      error = e.message || 'An unexpected error occurred';
    } finally {
      loading = false;
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && isValidScid && !loading) {
      handleAddSCID();
    }
  }

  function reset() {
    scidInput = '';
    result = null;
    error = '';
  }
</script>

<div class="content-section">
  <h2 class="content-section-title">Add SCID to Index</h2>
  <p class="content-section-desc">Manually index a smart contract that Gnomon fastsync missed.</p>
  
  <!-- Error Display -->
  {#if error}
    <div class="alert alert-error" style="margin-bottom: var(--s-4);">
      <AlertTriangle size={16} />
      <span>{error}</span>
    </div>
  {/if}
  
  <!-- Success Display -->
  {#if result}
    <div class="clone-success-card">
      <div class="clone-success-header">
        <CheckCircle size={24} class="clone-success-icon" />
        <div>
          <h3 class="clone-success-title">SCID Indexed Successfully!</h3>
          <p class="clone-success-subtitle">{result.class || 'SC'}: {result.name || result.scid?.slice(0, 16) + '...'}</p>
        </div>
      </div>
      
      {#if (result.vars_count || 0) === 0}
        <div class="alert alert-warning" style="margin-bottom: var(--s-3);">
          <AlertTriangle size={16} />
          <span>
            {#if result.gnomonSyncing}
              0 variables stored — Gnomon is still syncing ({Math.floor(result.syncProgress || 0)}%). Retry when it catches up.
            {:else}
              0 variables stored — Gnomon may still be syncing, or the contract holds no state. Retry once sync completes.
            {/if}
          </span>
        </div>
      {/if}

      <div class="clone-result-details">
        <div class="clone-detail-row">
          <span class="clone-detail-label">SCID</span>
          <code class="clone-detail-value">{result.scid?.slice(0, 24)}...{result.scid?.slice(-8)}</code>
        </div>
        
        <div class="clone-detail-row">
          <span class="clone-detail-label">Class</span>
          <span class="clone-detail-value">{result.class || 'Unknown'}</span>
        </div>
        
        {#if result.name}
          <div class="clone-detail-row">
            <span class="clone-detail-label">Name</span>
            <span class="clone-detail-value">{result.name}</span>
          </div>
        {/if}
        
        {#if result.durl}
          <div class="clone-detail-row">
            <span class="clone-detail-label">dURL</span>
            <code class="clone-detail-value">{result.durl}</code>
          </div>
        {/if}
        
        {#if result.description}
          <div class="clone-detail-row">
            <span class="clone-detail-label">Description</span>
            <span class="clone-detail-value">{result.description}</span>
          </div>
        {/if}
        
        <div class="clone-detail-row">
          <span class="clone-detail-label">Variables</span>
          <span class="clone-detail-value">{result.vars_count || 0} stored</span>
        </div>
      </div>
      
      <div class="clone-actions">
        <button class="btn btn-ghost" on:click={reset}>
          <RefreshCw size={16} />
          Add Another
        </button>
      </div>
    </div>
  {:else}
    <!-- Input Card -->
    <div class="content-card">
      <div class="content-card-header">
        <Package size={32} class="content-card-icon" />
        <p class="content-card-title">Index Missing Contract</p>
        <p class="content-card-text">
          Enter the SCID of a smart contract deployed before Gnomon started. 
          The contract will be fetched from the daemon and added to Gnomon's index.
        </p>
      </div>
      
      <div class="form-group" style="margin-top: var(--s-4);">
        <label class="form-label">
          SCID <span class="label-hint">(64 hex characters)</span>
        </label>
        <input
          type="text"
          bind:value={scidInput}
          on:keydown={handleKeydown}
          placeholder="Enter SCID to index..."
          class="input input-mono"
          disabled={loading}
        />
      </div>
      
      <button 
        class="btn btn-primary btn-block" 
        style="margin-top: var(--s-4);"
        on:click={handleAddSCID}
        disabled={loading || !isValidScid}
      >
        {#if loading}
          <Loader2 size={16} class="spinner" />
          Indexing...
        {:else}
          <Package size={16} />
          Add to Index
        {/if}
      </button>
    </div>
    
    <!-- Info Panel -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">About AddSCIDToIndex</p>
        <ul class="info-list">
          <li>Fixes Gnomon fastsync's limitation with historical contracts</li>
          <li>Fetches current variable state from the daemon</li>
          <li>Contract becomes discoverable in Browser after indexing</li>
          <li>Works with any contract type: TELA INDEX, DOC, or custom SC</li>
        </ul>
      </div>
    </div>
  {/if}
</div>
