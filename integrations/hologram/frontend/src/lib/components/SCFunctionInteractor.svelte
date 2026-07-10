<script>
  import { createEventDispatcher } from 'svelte';
  import { ParseSCFunctions, InvokeSCFunction } from '../../../wailsjs/go/main/App.js';
  import { walletState, toast } from '../stores/appState.js';
  import { Loader2, Play, AlertTriangle, ChevronDown, Zap, Check, Copy } from 'lucide-svelte';

  export let scid = '';

  const dispatch = createEventDispatcher();

  let functions = [];
  let selectedFunction = null;
  let selectedFunctionName = '';
  let paramValues = {};
  let deroAmount = '';
  let assetScid = '';
  let assetAmount = '';
  let anonymous = false;
  let loading = false;
  let parsing = false;
  let error = '';
  let result = null;
  let copied = false;

  // Parse functions when SCID changes
  $: if (scid && scid.length === 64) {
    parseFunctions();
  }

  async function parseFunctions() {
    parsing = true;
    error = '';
    functions = [];
    selectedFunction = null;
    selectedFunctionName = '';
    result = null;

    try {
      const res = await ParseSCFunctions(scid);
      if (res.success) {
        functions = res.functions || [];
        if (functions.length > 0) {
          selectFunction(functions[0]);
        }
      } else {
        error = res.error || 'Failed to parse functions';
      }
    } catch (e) {
      error = e.message || 'Failed to parse smart contract';
    } finally {
      parsing = false;
    }
  }

  function selectFunction(fn) {
    selectedFunction = fn;
    selectedFunctionName = fn.name;
    paramValues = {};
    // Initialize param values
    fn.params.forEach(p => {
      paramValues[p.name] = '';
    });
    // Reset amounts
    deroAmount = '';
    assetScid = '';
    assetAmount = '';
    result = null;
    error = '';
    // Disable anonymous if SIGNER is used
    if (fn.usesSigner) {
      anonymous = false;
    }
  }

  function handleFunctionChange(event) {
    const fn = functions.find(f => f.name === event.target.value);
    if (fn) {
      selectFunction(fn);
    }
  }

  async function invokeFunction() {
    if (!selectedFunction) return;

    loading = true;
    error = '';
    result = null;

    try {
      // Build params object with correct types
      const params = {};
      selectedFunction.params.forEach(p => {
        const val = paramValues[p.name];
        if (p.type === 'Uint64') {
          params[p.name] = parseInt(val) || 0;
        } else {
          params[p.name] = val || '';
        }
      });

      // Convert DERO amount to atomic units (multiply by 100000)
      const deroValueAtomic = deroAmount ? Math.floor(parseFloat(deroAmount) * 100000) : 0;
      const assetValueAtomic = assetAmount ? parseInt(assetAmount) : 0;

      // Backend expects a single JSON string with InvokeSCFunctionParams shape
      const payload = {
        scid,
        function: selectedFunction.name,
        params,
        deroAmount: deroValueAtomic,
        assetScid: assetScid || '',
        assetAmount: assetValueAtomic,
        anonymous,
      };
      const res = await InvokeSCFunction(JSON.stringify(payload));

      if (res.success) {
        result = res;
        toast.success(`Function ${selectedFunction.name} called successfully`);
        dispatch('invoked', { txid: res.txid, function: selectedFunction.name });
      } else {
        error = res.error || 'Transaction failed';
        toast.error(res.error || 'Transaction failed');
      }
    } catch (e) {
      error = e.message || 'Failed to invoke function';
      toast.error(e.message || 'Failed to invoke function');
    } finally {
      loading = false;
    }
  }

  function copyTxid() {
    if (result?.txid) {
      navigator.clipboard.writeText(result.txid);
      copied = true;
      setTimeout(() => copied = false, 2000);
    }
  }

  function formatFunctionSignature(fn) {
    const params = fn.params.map(p => `${p.name}: ${p.type}`).join(', ');
    return `${fn.name}(${params})`;
  }
</script>

<!-- Uses cmd-stats-panel pattern from hologram.css -->
<div class="cmd-stats-panel" style="margin-top: var(--s-4);">
  <div class="cmd-panel-header">
    <div class="cmd-panel-title">
      <span class="cmd-panel-icon"><Zap size={14} strokeWidth={1.5} /></span>
      CALL SMART CONTRACT FUNCTION
    </div>
    <div class="cmd-panel-meta">
      {#if functions.length > 0}
        <span class="cmd-badge">{functions.length} functions</span>
      {/if}
    </div>
  </div>

  <div class="cmd-panel-body">
    {#if parsing}
      <div class="sc-interactor-state">
        <Loader2 size={16} class="spin" />
        <span>Parsing smart contract...</span>
      </div>
    {:else if error && functions.length === 0}
      <div class="sc-interactor-state sc-interactor-error">
        <AlertTriangle size={16} />
        <span>{error}</span>
      </div>
    {:else if functions.length === 0}
      <div class="sc-interactor-state">
        <span>No callable functions found in this contract</span>
      </div>
    {:else}
      <!-- Function Selector -->
      <div class="sc-interactor-row">
        <div class="sc-interactor-label">FUNCTION</div>
        <div class="sc-interactor-select-wrap">
          <select bind:value={selectedFunctionName} on:change={handleFunctionChange}>
            {#each functions as fn}
              <option value={fn.name}>
                {formatFunctionSignature(fn)}
              </option>
            {/each}
          </select>
          <ChevronDown size={14} class="sc-interactor-select-icon" />
        </div>
      </div>

      {#if selectedFunction}
        <!-- Parameters -->
        {#if selectedFunction.params.length > 0}
          <div class="sc-interactor-section">
            <div class="sc-interactor-label">PARAMETERS</div>
            {#each selectedFunction.params as param}
              <div class="sc-interactor-param">
                <div class="sc-interactor-param-header">
                  <span class="sc-interactor-param-name">{param.name}</span>
                  <span class="cmd-badge cmd-badge-dim">{param.type}</span>
                </div>
                {#if param.type === 'Uint64'}
                  <input
                    type="number"
                    bind:value={paramValues[param.name]}
                    placeholder="0"
                    class="sc-interactor-input"
                  />
                {:else}
                  <input
                    type="text"
                    bind:value={paramValues[param.name]}
                    placeholder="Enter value..."
                    class="sc-interactor-input"
                  />
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- DERO Value (if detected) -->
        {#if selectedFunction.usesDero}
          <div class="sc-interactor-value-box">
            <div class="sc-interactor-value-header">
              <span class="cmd-badge cmd-badge-info">DEROVALUE</span>
              <span>DERO Amount to Send</span>
            </div>
            <div class="sc-interactor-value-row">
              <input
                type="number"
                step="0.00001"
                min="0"
                bind:value={deroAmount}
                placeholder="0.00000"
                class="sc-interactor-input"
              />
              <span class="sc-interactor-unit">DERO</span>
            </div>
          </div>
        {/if}

        <!-- Asset Value (if detected) -->
        {#if selectedFunction.usesAsset}
          <div class="sc-interactor-value-box">
            <div class="sc-interactor-value-header">
              <span class="cmd-badge" style="background: rgba(139, 92, 246, 0.2); border-color: rgba(139, 92, 246, 0.4); color: var(--violet-400);">ASSETVALUE</span>
              <span>Token Transfer</span>
            </div>
            <input
              type="text"
              bind:value={assetScid}
              placeholder="Token SCID (64 hex characters)"
              class="sc-interactor-input"
              style="margin-bottom: var(--s-2);"
            />
            <div class="sc-interactor-value-row">
              <input
                type="number"
                min="0"
                bind:value={assetAmount}
                placeholder="Amount (atomic units)"
                class="sc-interactor-input"
              />
              <span class="sc-interactor-unit">units</span>
            </div>
          </div>
        {/if}

        <!-- Anonymous Option -->
        <div class="sc-interactor-checkbox-row">
          <label class="sc-interactor-checkbox">
            <input
              type="checkbox"
              bind:checked={anonymous}
              disabled={selectedFunction.usesSigner}
            />
            <span>Anonymous transaction (ringsize 16)</span>
          </label>
          {#if selectedFunction.usesSigner}
            <div class="sc-interactor-signer-warn">
              <AlertTriangle size={12} />
              <span>SIGNER() detected - anonymous mode disabled</span>
            </div>
          {/if}
        </div>

        <!-- Error Display -->
        {#if error}
          <div class="sc-interactor-error-box">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        {/if}

        <!-- Result Display -->
        {#if result}
          <div class="sc-interactor-result-box">
            <div class="sc-interactor-result-header">
              <Check size={14} />
              <span>Transaction Sent</span>
            </div>
            <div class="sc-interactor-result-txid">
              <span class="sc-interactor-txid-label">TXID:</span>
              <code class="sc-interactor-txid">{result.txid}</code>
              <button class="cmd-copy-btn" on:click={copyTxid} title="Copy TXID">
                {#if copied}
                  <Check size={12} />
                {:else}
                  <Copy size={12} />
                {/if}
              </button>
            </div>
          </div>
        {/if}

        <!-- Submit Button -->
        <button
          class="cmd-link-btn sc-interactor-submit"
          on:click={invokeFunction}
          disabled={loading || (!$walletState.isOpen && !$walletState.xswdConnected)}
        >
          {#if loading}
            <Loader2 size={14} class="spin" />
            <span>Calling {selectedFunction.name}...</span>
          {:else}
            <Play size={14} />
            <span>Call {selectedFunction.name}</span>
          {/if}
        </button>

        {#if !$walletState.isOpen && !$walletState.xswdConnected}
          <p class="sc-interactor-wallet-warn">Open a wallet or connect via XSWD to call functions</p>
        {/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  /* SC Interactor - follows cmd-stats-panel pattern */
  
  .sc-interactor-state {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
  }
  
  .sc-interactor-state.sc-interactor-error {
    color: var(--status-err);
    background: rgba(239, 68, 68, 0.1);
    border-radius: var(--r-md);
  }
  
  .sc-interactor-row {
    margin-bottom: var(--s-3);
  }
  
  .sc-interactor-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: var(--s-2);
  }
  
  .sc-interactor-select-wrap {
    position: relative;
  }
  
  .sc-interactor-select-wrap select {
    width: 100%;
    padding: var(--s-2) var(--s-3);
    padding-right: var(--s-6);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 12px;
    appearance: none;
    cursor: pointer;
  }
  
  .sc-interactor-select-wrap select:focus {
    outline: none;
    border-color: var(--cyan-500);
  }
  
  .sc-interactor-select-wrap :global(.sc-interactor-select-icon) {
    position: absolute;
    right: var(--s-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-4);
    pointer-events: none;
  }
  
  .sc-interactor-section {
    margin-bottom: var(--s-3);
  }
  
  .sc-interactor-param {
    margin-bottom: var(--s-2);
  }
  
  .sc-interactor-param-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-1);
  }
  
  .sc-interactor-param-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
    font-weight: 500;
  }
  
  .sc-interactor-input {
    width: 100%;
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  
  .sc-interactor-input:focus {
    outline: none;
    border-color: var(--cyan-500);
  }
  
  .sc-interactor-input::placeholder {
    color: var(--text-5);
  }
  
  .sc-interactor-value-box {
    margin-bottom: var(--s-3);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
    border: 1px solid var(--border-subtle);
  }
  
  .sc-interactor-value-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
    margin-bottom: var(--s-2);
  }
  
  .sc-interactor-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .sc-interactor-unit {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-4);
    font-weight: 500;
  }
  
  .sc-interactor-checkbox-row {
    margin-bottom: var(--s-3);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
  }
  
  .sc-interactor-checkbox {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
  }
  
  .sc-interactor-checkbox input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
    accent-color: var(--cyan-500);
  }
  
  .sc-interactor-checkbox input[type="checkbox"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .sc-interactor-signer-warn {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-top: var(--s-2);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--status-warn);
  }
  
  .sc-interactor-error-box {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--status-err);
    border-radius: var(--r-md);
    color: var(--status-err);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-bottom: var(--s-3);
  }
  
  .sc-interactor-result-box {
    padding: var(--s-3);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid var(--status-ok);
    border-radius: var(--r-md);
    margin-bottom: var(--s-3);
  }
  
  .sc-interactor-result-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--status-ok);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    margin-bottom: var(--s-2);
  }
  
  .sc-interactor-result-txid {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .sc-interactor-txid-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-4);
    text-transform: uppercase;
  }
  
  .sc-interactor-txid {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2);
    background: var(--void-deep);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .sc-interactor-submit {
    width: 100%;
    justify-content: center;
    padding: var(--s-2) var(--s-3);
    margin-top: var(--s-2);
  }
  
  .sc-interactor-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .sc-interactor-wallet-warn {
    margin-top: var(--s-2);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-4);
    text-align: center;
  }
  
  /* Spin animation for loader */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
