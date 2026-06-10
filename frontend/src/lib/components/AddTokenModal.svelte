<script>
  import { createEventDispatcher } from 'svelte';
  import { AddTrackedToken } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  import { X, Coins, Loader2, AlertTriangle } from 'lucide-svelte';
  
  export let show = false;
  
  const dispatch = createEventDispatcher();
  
  let scid = '';
  let name = '';
  let symbol = '';
  let loading = false;
  let error = null;
  
  $: isValidSCID = scid.length === 64 && /^[0-9a-fA-F]+$/.test(scid);
  
  function close() {
    show = false;
    scid = '';
    name = '';
    symbol = '';
    error = null;
    dispatch('close');
  }
  
  async function addToken() {
    if (!isValidSCID) {
      error = 'Invalid SCID format';
      return;
    }
    
    loading = true;
    error = null;
    
    try {
      const result = await AddTrackedToken(scid, name, symbol);
      if (result.success) {
        if (result.metadataResolved) {
          toast.success('Token added to portfolio!');
        } else if (result.gnomonRunning === false) {
          toast.warning('Token added — metadata pending. Start Gnomon to resolve its name.', 7000);
        } else {
          toast.warning('Token added — no name found on-chain yet. Use Studio → Add SCID if it stays unknown.', 7000);
        }
        dispatch('added', result.token);
        close();
      } else {
        error = result.error || 'Failed to add token';
      }
    } catch (err) {
      error = err.message || 'Failed to add token';
    } finally {
      loading = false;
    }
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
  <div class="modal-overlay" on:click|self={close}>
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title">
          <Coins size={18} />
          <span>Add Token</span>
        </div>
        <button class="modal-close" on:click={close}>
          <X size={18} />
        </button>
      </div>
      
      <div class="modal-body">
        <p class="modal-desc">
          Enter the Smart Contract ID (SCID) of the token you want to track.
        </p>
        
        <div class="form-group">
          <label class="form-label">Token SCID *</label>
          <input 
            type="text" 
            class="input mono" 
            class:input-error={scid && !isValidSCID}
            bind:value={scid} 
            placeholder="Enter 64-character hex SCID..."
            maxlength="64"
          />
          {#if scid && !isValidSCID}
            <span class="form-error">SCID must be 64 hexadecimal characters</span>
          {:else}
            <span class="form-hint">{scid.length}/64 characters</span>
          {/if}
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Name (optional)</label>
            <input 
              type="text" 
              class="input" 
              bind:value={name} 
              placeholder="Token Name"
            />
          </div>
          
          <div class="form-group">
            <label class="form-label">Symbol (optional)</label>
            <input 
              type="text" 
              class="input" 
              bind:value={symbol} 
              placeholder="TKN"
              maxlength="10"
            />
          </div>
        </div>
        
        <div class="info-box">
          <AlertTriangle size={14} />
          <span>Token metadata (name, symbol) will be auto-fetched from the blockchain if available.</span>
        </div>
        
        {#if error}
          <div class="alert alert-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <button class="btn btn-primary" disabled={!isValidSCID || loading} on:click={addToken}>
          {#if loading}
            <Loader2 size={14} class="spin" />
            Adding...
          {:else}
            Add Token
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-desc {
    font-size: 13px;
    color: var(--text-3);
    margin: 0 0 var(--s-4) 0;
    line-height: 1.5;
  }
  
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }
  
  .mono {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  
  .info-box {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3);
    background: rgba(34, 211, 238, 0.05);
    border: 1px solid rgba(34, 211, 238, 0.1);
    border-radius: var(--r-md);
    font-size: 11px;
    color: var(--text-3);
    margin-top: var(--s-4);
  }
  
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
