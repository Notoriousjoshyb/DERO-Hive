<script>
  import { createEventDispatcher } from 'svelte';
  import { 
    InvokeSCFromExplorer, 
    RateTELAApp, 
    LikeTELAApp, 
    DislikeTELAApp,
    EstimateSCGas,
    GetXSWDStatus,
    CheckAppSupportsEpoch,
    SubmitRatingWithPicker
  } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  import { ThumbsUp, ThumbsDown, Star, Zap, Play, Loader2, ChevronDown, ChevronUp } from 'lucide-svelte';
  import RatingPicker from './RatingPicker.svelte';
  
  export let scid = '';
  export let scName = '';
  
  const dispatch = createEventDispatcher();
  
  let xswdConnected = false;
  let supportsEpoch = false;
  let loading = false;
  let showAdvanced = false;
  
  // Rating state
  let showRatingPicker = false;
  let selectedRatingData = null;
  
  // Custom invoke state
  let customEntrypoint = '';
  let customArgs = '';
  let customDeposit = '';
  let gasEstimate = null;
  let estimating = false;
  
  // Guard to prevent repeated checkStatus calls
  let lastCheckedScid = '';
  let isCheckingStatus = false;
  
  $: if (scid && scid !== lastCheckedScid && !isCheckingStatus) {
    lastCheckedScid = scid;
    checkStatus();
  }
  
  async function checkStatus() {
    if (isCheckingStatus) return;
    isCheckingStatus = true;
    
    try {
      const status = await GetXSWDStatus();
      xswdConnected = status.connected;
      
      if (scid) {
        const epochResult = await CheckAppSupportsEpoch(scid);
        supportsEpoch = epochResult.supports_epoch;
      }
    } catch (e) {
      console.error('Status check failed:', e);
    } finally {
      isCheckingStatus = false;
    }
  }
  
  function handleRatingChange(event) {
    selectedRatingData = event.detail;
  }
  
  async function submitRating() {
    if (!xswdConnected) {
      toast.error('Connect wallet via XSWD to rate');
      return;
    }
    
    if (!selectedRatingData) {
      toast.error('Please select a rating');
      return;
    }
    
    loading = true;
    try {
      const result = await SubmitRatingWithPicker(scid, selectedRatingData.category, selectedRatingData.detail);
      if (result.success) {
        toast.success(`Rated ${scName || 'app'}: ${selectedRatingData.parsed?.displayText || selectedRatingData.rating}!`);
        dispatch('action', { type: 'rate', rating: selectedRatingData.rating, txid: result.txid });
        showRatingPicker = false;
        selectedRatingData = null;
      } else {
        toast.error(result.error || 'Rating failed');
      }
    } catch (e) {
      toast.error(e.message || 'Rating failed');
    } finally {
      loading = false;
    }
  }
  
  async function handleLike() {
    if (!xswdConnected) {
      toast.error('Connect wallet via XSWD to like');
      return;
    }
    
    loading = true;
    try {
      const result = await LikeTELAApp(scid);
      if (result.success) {
        toast.success(`Liked ${scName || 'app'}!`);
        dispatch('action', { type: 'like', txid: result.txid });
      } else {
        toast.error(result.error || 'Like failed');
      }
    } catch (e) {
      toast.error(e.message || 'Like failed');
    } finally {
      loading = false;
    }
  }
  
  async function handleDislike() {
    if (!xswdConnected) {
      toast.error('Connect wallet via XSWD to dislike');
      return;
    }
    
    loading = true;
    try {
      const result = await DislikeTELAApp(scid);
      if (result.success) {
        toast.success(`Disliked ${scName || 'app'}`);
        dispatch('action', { type: 'dislike', txid: result.txid });
      } else {
        toast.error(result.error || 'Dislike failed');
      }
    } catch (e) {
      toast.error(e.message || 'Dislike failed');
    } finally {
      loading = false;
    }
  }
  
  async function estimateGas() {
    if (!customEntrypoint.trim()) {
      toast.error('Enter a function name');
      return;
    }
    
    estimating = true;
    gasEstimate = null;
    
    try {
      let args = [];
      if (customArgs.trim()) {
        try {
          args = JSON.parse(customArgs);
        } catch (e) {
          toast.error('Invalid JSON arguments');
          estimating = false;
          return;
        }
      }
      
      const result = await EstimateSCGas(scid, customEntrypoint.trim(), args);
      if (result.success) {
        gasEstimate = result;
      } else {
        toast.error(result.error || 'Gas estimation failed');
      }
    } catch (e) {
      toast.error(e.message || 'Gas estimation failed');
    } finally {
      estimating = false;
    }
  }
  
  async function handleCustomInvoke() {
    if (!xswdConnected) {
      toast.error('Connect wallet via XSWD to invoke');
      return;
    }
    
    if (!customEntrypoint.trim()) {
      toast.error('Enter a function name');
      return;
    }
    
    loading = true;
    
    try {
      let args = [];
      if (customArgs.trim()) {
        try {
          args = JSON.parse(customArgs);
        } catch (e) {
          toast.error('Invalid JSON arguments');
          loading = false;
          return;
        }
      }
      
      const deposit = parseInt(customDeposit) || 0;
      
      const result = await InvokeSCFromExplorer(scid, customEntrypoint.trim(), args, deposit);
      if (result.success) {
        toast.success(`Function ${customEntrypoint} called! TXID: ${result.txid?.slice(0, 12)}...`);
        dispatch('action', { type: 'invoke', entrypoint: customEntrypoint, txid: result.txid });
        
        // Clear form
        customEntrypoint = '';
        customArgs = '';
        customDeposit = '';
        gasEstimate = null;
      } else {
        toast.error(result.error || 'Invocation failed');
      }
    } catch (e) {
      toast.error(e.message || 'Invocation failed');
    } finally {
      loading = false;
    }
  }
</script>

<div class="cmd-stats-panel">
  <div class="cmd-panel-header">
    <div class="cmd-panel-title">
      <span class="cmd-panel-icon">◎</span>
      QUICK ACTIONS
    </div>
    <div class="cmd-panel-meta">
      {#if supportsEpoch}
        <span class="cmd-badge epoch">EPOCH</span>
      {/if}
    </div>
  </div>
  
  {#if !xswdConnected}
    <div class="cmd-panel-body">
      <p class="cmd-empty-text">Connect wallet via XSWD to interact</p>
    </div>
  {:else}
    <!-- Rating Section -->
    <div class="action-section">
      <div class="rating-header">
        <label class="action-label">Rate this app</label>
        <button 
          class="toggle-picker-btn"
          on:click={() => showRatingPicker = !showRatingPicker}
        >
          <Star size={12} />
          {showRatingPicker ? 'Hide' : 'Show'} Rating Picker
        </button>
      </div>
      
      {#if showRatingPicker}
        <div class="rating-picker-container">
          <RatingPicker compact on:change={handleRatingChange} />
          
          <div class="rating-submit-row">
            <button 
              class="action-btn rate" 
              on:click={submitRating} 
              disabled={loading || !selectedRatingData}
            >
              {#if loading}
                <span class="spin"><Loader2 size={14} /></span>
              {:else}
                <Star size={14} />
              {/if}
              Submit Rating
            </button>
          </div>
        </div>
      {/if}
    </div>
    
    <!-- Like/Dislike Section -->
    <div class="action-section">
      <label class="action-label">Quick feedback</label>
      <div class="feedback-row">
        <button class="action-btn like" on:click={handleLike} disabled={loading}>
          <ThumbsUp size={14} />
          Like
        </button>
        <button class="action-btn dislike" on:click={handleDislike} disabled={loading}>
          <ThumbsDown size={14} />
          Dislike
        </button>
      </div>
    </div>
    
    <!-- Advanced: Custom Function Call -->
    <button class="advanced-toggle" on:click={() => showAdvanced = !showAdvanced}>
      {#if showAdvanced}
        <ChevronUp size={14} />
      {:else}
        <ChevronDown size={14} />
      {/if}
      Advanced: Call Function
    </button>
    
    {#if showAdvanced}
      <div class="cmd-advanced-section">
        <div class="cmd-form-row">
          <input 
            type="text" 
            bind:value={customEntrypoint}
            placeholder="Function name (e.g. Transfer)"
            class="cmd-input"
          />
        </div>
        
        <div class="cmd-form-row">
          <textarea 
            bind:value={customArgs}
            placeholder={'Arguments as JSON array:\n[{"name": "arg", "datatype": "S", "value": "..."}]'}
            rows="3"
            class="cmd-textarea"
          ></textarea>
        </div>
        
        <div class="cmd-form-row">
          <input 
            type="number" 
            bind:value={customDeposit}
            placeholder="DERO deposit (atomic units, optional)"
            class="cmd-input"
          />
        </div>
        
        <div class="cmd-action-row">
          <button class="cmd-btn cmd-btn-ghost" on:click={estimateGas} disabled={estimating || !customEntrypoint.trim()}>
            {#if estimating}
              <Loader2 size={14} class="spin" />
            {:else}
              <Zap size={14} />
            {/if}
            Estimate Gas
          </button>
          
          <button class="cmd-btn cmd-btn-primary" on:click={handleCustomInvoke} disabled={loading || !customEntrypoint.trim()}>
            {#if loading}
              <Loader2 size={14} class="spin" />
            {:else}
              <Play size={14} />
            {/if}
            Execute
          </button>
        </div>
        
        {#if gasEstimate}
          <div class="cmd-gas-estimate">
            <span>Compute: {gasEstimate.gascompute}</span>
            <span>Storage: {gasEstimate.gasstorage}</span>
            <span class="gas-total">Total: {gasEstimate.total} (~{gasEstimate.cost_dero})</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* HOLOGRAM Design System - cmd-stats-panel pattern */
  .cmd-stats-panel {
    background: var(--void-mid, #12121a);
    border: 1px solid var(--border-dim, rgba(255,255,255,0.06));
    border-radius: var(--radius-lg, 12px);
    margin-top: var(--s-4, 16px);
  }
  
  .cmd-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-3, 12px) var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255,255,255,0.06));
  }
  
  .cmd-panel-title {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary, #a8a8b8);
  }
  
  .cmd-panel-icon {
    color: var(--cyan, #00d4aa);
  }
  
  .cmd-panel-meta {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  .cmd-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    letter-spacing: 0.05em;
  }
  
  .cmd-badge.epoch {
    background: rgba(0, 212, 170, 0.15);
    color: var(--cyan, #00d4aa);
    border: 1px solid rgba(0, 212, 170, 0.3);
  }
  
  .cmd-panel-body {
    padding: var(--s-4, 16px);
  }
  
  .cmd-empty-text {
    text-align: center;
    color: var(--text-muted, #505068);
    font-size: 13px;
    margin: 0;
  }
  
  /* Action Sections */
  .action-section {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255,255,255,0.06));
  }
  
  .action-section:last-of-type {
    border-bottom: none;
  }
  
  .action-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #505068);
    margin-bottom: 10px;
  }
  
  .rating-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  
  .toggle-picker-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--void-up, #1a1a24);
    border: 1px solid var(--border-dim, rgba(255,255,255,0.06));
    border-radius: 6px;
    color: var(--text-tertiary, #707088);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .toggle-picker-btn:hover {
    border-color: var(--cyan-dim, rgba(0, 212, 170, 0.3));
    color: var(--cyan, #00d4aa);
  }
  
  .rating-picker-container {
    margin-top: 10px;
  }
  
  .rating-submit-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
  
  .feedback-row {
    display: flex;
    gap: var(--s-3, 12px);
  }
  
  /* HOLOGRAM Button Styles */
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--radius-md, 8px);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .action-btn.rate {
    background: var(--cyan, #00d4aa);
    color: var(--void-pure, #0a0a0f);
  }
  
  .action-btn.rate:hover:not(:disabled) {
    background: var(--cyan-400, #00f5c4);
  }
  
  .action-btn.like {
    flex: 1;
    background: var(--void-up, #1a1a24);
    border-color: rgba(16, 185, 129, 0.3);
    color: var(--emerald, #10b981);
  }
  
  .action-btn.like:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.5);
  }
  
  .action-btn.dislike {
    flex: 1;
    background: var(--void-up, #1a1a24);
    border-color: rgba(239, 68, 68, 0.3);
    color: var(--danger, #ef4444);
  }
  
  .action-btn.dislike:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.5);
  }
  
  /* Advanced Toggle */
  .advanced-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border-dim, rgba(255,255,255,0.06));
    color: var(--text-tertiary, #707088);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .advanced-toggle:hover {
    background: var(--void-up, #1a1a24);
    color: var(--text-secondary, #a8a8b8);
  }
  
  /* Advanced Section */
  .cmd-advanced-section {
    padding: var(--s-4, 16px);
    border-top: 1px solid var(--border-dim, rgba(255,255,255,0.06));
  }
  
  .cmd-form-row {
    margin-bottom: var(--s-3, 12px);
  }
  
  .cmd-input, .cmd-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--void-deep, #0a0a0f);
    border: 1px solid var(--border-dim, rgba(255,255,255,0.06));
    border-radius: var(--radius-md, 8px);
    color: var(--text-primary, #e8e8f0);
    font-size: 12px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }
  
  .cmd-input:focus, .cmd-textarea:focus {
    outline: none;
    border-color: var(--cyan-dim, rgba(0, 212, 170, 0.3));
  }
  
  .cmd-textarea {
    resize: vertical;
    min-height: 60px;
  }
  
  .cmd-action-row {
    display: flex;
    gap: var(--s-3, 12px);
  }
  
  .cmd-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 10px 16px;
    border-radius: var(--radius-md, 8px);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  
  .cmd-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .cmd-btn-ghost {
    background: var(--void-up, #1a1a24);
    border-color: var(--border-dim, rgba(255,255,255,0.06));
    color: var(--text-secondary, #a8a8b8);
  }
  
  .cmd-btn-ghost:hover:not(:disabled) {
    border-color: var(--cyan-dim, rgba(0, 212, 170, 0.3));
    color: var(--cyan, #00d4aa);
  }
  
  .cmd-btn-primary {
    background: var(--cyan, #00d4aa);
    color: var(--void-pure, #0a0a0f);
  }
  
  .cmd-btn-primary:hover:not(:disabled) {
    background: var(--cyan-400, #00f5c4);
  }
  
  .cmd-gas-estimate {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3, 12px);
    margin-top: var(--s-3, 12px);
    padding: var(--s-3, 12px);
    background: var(--void-deep, #0a0a0f);
    border-radius: var(--radius-md, 8px);
    font-size: 11px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--text-tertiary, #707088);
  }
  
  .gas-total {
    color: var(--cyan, #00d4aa);
    font-weight: 600;
  }
  
  /* Animation */
  .spin {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

