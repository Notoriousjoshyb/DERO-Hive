<script>
  import { createEventDispatcher } from 'svelte';
  import { TransferToken } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  import { X, ArrowUp, Loader2, AlertTriangle, Eye, EyeOff, Check, Copy } from 'lucide-svelte';
  
  export let show = false;
  export let token = null; // { scid, name, symbol, balance }
  
  const dispatch = createEventDispatcher();
  
  // Form state
  let step = 1; // 1: Enter, 2: Review, 3: Success
  let destination = '';
  let amount = '';
  let ringsize = 16;
  let password = '';
  let showPassword = false;
  let loading = false;
  let error = null;
  let txid = null;
  
  // Computed
  $: tokenName = token?.name || token?.symbol || 'Token';
  $: tokenSymbol = token?.symbol || '';
  $: availableBalance = token?.balance || 0;
  $: availableFormatted = formatBalance(availableBalance);
  // Math.round, not floor: IEEE754 makes e.g. 1.13 * 100000 = 112999.99999999999,
  // and flooring that silently sends one atomic unit less than the user typed.
  // Input is clamped to 5 decimals below, so round can't overshoot the typed value.
  $: amountAtomic = Math.round(parseFloat(amount || '0') * 100000);
  $: isValidAmount = !isNaN(amountAtomic) && amountAtomic > 0 && amountAtomic <= availableBalance;
  $: isValidAddress = destination.startsWith('dero1') || destination.startsWith('deto1');
  $: canProceed = isValidAmount && isValidAddress;
  
  function close() {
    show = false;
    reset();
    dispatch('close');
  }
  
  function reset() {
    step = 1;
    destination = '';
    amount = '';
    ringsize = 16;
    password = '';
    error = null;
    txid = null;
    loading = false;
  }
  
  function setMaxAmount() {
    amount = (availableBalance / 100000).toFixed(5);
  }
  
  function formatBalance(atomic) {
    return (atomic / 100000).toFixed(5);
  }
  
  function formatAddress(addr) {
    if (!addr) return '';
    return addr.slice(0, 12) + '...' + addr.slice(-8);
  }
  
  async function executeSend() {
    if (!password) {
      error = 'Please enter your wallet password';
      return;
    }
    
    loading = true;
    error = null;
    
    try {
      const result = await TransferToken(token.scid, destination, amountAtomic, password, ringsize);
      
      if (result.success) {
        txid = result.txid;
        step = 3;
        toast.success('Token transfer sent successfully!');
        dispatch('sent', { txid, token, amount: amountAtomic, destination });
      } else {
        error = result.error || 'Transfer failed';
      }
    } catch (err) {
      error = err.message || 'Transfer failed';
    } finally {
      loading = false;
    }
  }
  
  function copyTxid() {
    if (txid) {
      navigator.clipboard.writeText(txid);
      toast.success('TXID copied!');
    }
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show && token}
  <div class="modal-overlay" on:click|self={close}>
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title">
          <ArrowUp size={18} />
          <span>Send {tokenName}</span>
        </div>
        <button class="modal-close" on:click={close}>
          <X size={18} />
        </button>
      </div>
      
      <div class="modal-body">
        {#if step === 1}
          <!-- STEP 1: Enter Details -->
          <div class="token-info-bar">
            <span class="token-icon">⬡</span>
            <span class="token-name">{tokenName}</span>
            {#if tokenSymbol}
              <span class="token-symbol">({tokenSymbol})</span>
            {/if}
            <span class="token-balance">Balance: {availableFormatted}</span>
          </div>
          
          <div class="form-group">
            <label class="form-label">Recipient Address</label>
            <input 
              type="text" 
              class="input" 
              class:input-error={destination && !isValidAddress}
              bind:value={destination} 
              placeholder="dero1..."
            />
            {#if destination && !isValidAddress}
              <span class="form-error">Invalid DERO address</span>
            {/if}
          </div>
          
          <div class="form-group">
            <div class="form-label-row">
              <label class="form-label">Amount</label>
              <span class="form-hint">Available: {availableFormatted} {tokenSymbol || 'tokens'}</span>
            </div>
            <div class="input-with-action">
              <input
                type="number"
                class="input"
                class:input-error={amount && !isValidAmount}
                bind:value={amount}
                placeholder="0.00000"
                step="0.00001"
                min="0"
                on:input={(e) => {
                  const v = String(e.target.value);
                  if (/\.\d{6,}/.test(v)) {
                    const [whole, frac] = v.split('.');
                    amount = parseFloat(`${whole}.${frac.slice(0, 5)}`);
                  }
                }}
              />
              <button class="btn btn-ghost btn-sm" on:click={setMaxAmount}>MAX</button>
            </div>
            {#if amount && !isValidAmount}
              <span class="form-error">
                {amountAtomic <= 0 ? 'Amount must be positive' : 'Insufficient balance'}
              </span>
            {/if}
          </div>

          <div class="form-group">
            <label class="form-label">Ring Size</label>
            <select class="select" bind:value={ringsize}>
              <option value={2}>2 (Non-anonymous)</option>
              <option value={16}>16 (Standard)</option>
              <option value={32}>32</option>
              <option value={64}>64</option>
              <option value={128}>128</option>
            </select>
          </div>
          
        {:else if step === 2}
          <!-- STEP 2: Review & Confirm -->
          <div class="confirm-details">
            <div class="confirm-row">
              <span class="confirm-label">Sending</span>
              <span class="confirm-value confirm-value-amount">{amount} {tokenSymbol || tokenName}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">Token</span>
              <span class="confirm-value">{tokenName}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">To</span>
              <span class="confirm-value confirm-value-address">{formatAddress(destination)}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">Ring Size</span>
              <span class="confirm-value">{ringsize}{ringsize === 2 ? ' (non-anonymous)' : ''}</span>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Wallet Password</label>
            <div class="input-wrap">
              {#if showPassword}
                <input type="text" class="input" bind:value={password} placeholder="Enter password" />
              {:else}
                <input type="password" class="input" bind:value={password} placeholder="Enter password" />
              {/if}
              <button type="button" class="input-action" on:click={() => showPassword = !showPassword}>
                {#if showPassword}
                  <EyeOff size={16} />
                {:else}
                  <Eye size={16} />
                {/if}
              </button>
            </div>
          </div>
          
          {#if error}
            <div class="alert alert-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          {/if}
          
        {:else}
          <!-- STEP 3: Success -->
          <div class="success-state">
            <div class="success-icon">
              <Check size={48} />
            </div>
            <h3 class="success-title">Transfer Sent!</h3>
            <p class="success-text">{amount} {tokenSymbol || tokenName} sent successfully</p>
            
            <div class="txid-display">
              <span class="txid-label">Transaction ID</span>
              <div class="txid-row">
                <code class="txid-value">{txid?.slice(0, 24)}...</code>
                <button class="btn-icon-sm" on:click={copyTxid}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        {#if step === 1}
          <button class="btn btn-ghost" on:click={close}>Cancel</button>
          <button class="btn btn-primary" disabled={!canProceed} on:click={() => step = 2}>
            Review Transfer
          </button>
        {:else if step === 2}
          <button class="btn btn-ghost" on:click={() => { step = 1; error = null; }}>
            ← Back
          </button>
          <button class="btn btn-primary" disabled={loading || !password} on:click={executeSend}>
            {#if loading}
              <Loader2 size={14} class="spin" />
              Sending...
            {:else}
              Confirm & Send
            {/if}
          </button>
        {:else}
          <button class="btn btn-primary" on:click={close}>Done</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .token-info-bar {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }
  
  .token-icon {
    font-size: 18px;
    color: var(--cyan-400);
  }
  
  .token-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .token-symbol {
    font-size: 12px;
    color: var(--text-3);
  }
  
  .token-balance {
    margin-left: auto;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-3);
  }
  
  .form-label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .input-with-action {
    display: flex;
    gap: var(--s-2);
  }
  
  .input-with-action .input {
    flex: 1;
  }
  
  .confirm-details {
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-4);
    margin-bottom: var(--s-4);
  }
  
  .confirm-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .confirm-row:last-child {
    border-bottom: none;
  }
  
  .confirm-label {
    font-size: 12px;
    color: var(--text-3);
  }
  
  .confirm-value {
    font-size: 13px;
    color: var(--text-1);
    font-family: var(--font-mono);
  }
  
  .confirm-value-amount {
    color: var(--cyan-400);
    font-weight: 600;
    font-size: 16px;
  }
  
  .confirm-value-address {
    font-size: 11px;
  }
  
  .success-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--s-4);
  }
  
  .success-icon {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(52, 211, 153, 0.1);
    border-radius: 50%;
    color: var(--status-ok);
    margin-bottom: var(--s-4);
  }
  
  .success-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0 0 var(--s-2) 0;
  }
  
  .success-text {
    font-size: 13px;
    color: var(--text-3);
    margin: 0 0 var(--s-4) 0;
  }
  
  .txid-display {
    width: 100%;
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-3);
  }
  
  .txid-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-4);
    margin-bottom: var(--s-2);
    display: block;
  }
  
  .txid-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
  }
  
  .txid-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  
  .btn-icon-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-4);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .btn-icon-sm:hover {
    background: var(--void-hover);
    color: var(--cyan-400);
  }
  
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
