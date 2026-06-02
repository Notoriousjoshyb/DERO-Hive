<script>
  import { toast } from '../../stores/appState.js';
  import {
    InstallSmartContract, ValidateSCCode, SelectFile, ReadTextFile
  } from '../../../../wailsjs/go/main/App.js';
  import { ClipboardSetText } from '../../../../wailsjs/runtime/runtime.js';
  import {
    AlertTriangle, CheckCircle, Copy, FileCode, Info, Loader2, Zap,
    Upload, Shield, Check, X, FolderOpen
  } from 'lucide-svelte';

  export let isSimulator = false;
  export let walletIsOpen = false;
  export let currentNetwork = 'mainnet';
  export let showDeployConfirmation = () => {};

  // State
  let scCode = '';
  let scAnonymous = false;
  let scDeploying = false;
  let scDeployResult = null;
  let scDeployError = '';

  // Validation state
  let validationResult = null;
  let validating = false;
  let loadedFilename = '';

  // Reactive line/char count
  $: lineCount = scCode ? scCode.split('\n').length : 0;
  $: charCount = scCode ? scCode.length : 0;
  $: functionCount = validationResult?.count || 0;

  // Validate code
  async function validateCode() {
    if (!scCode.trim()) {
      scDeployError = 'Please enter smart contract code first';
      return;
    }

    validating = true;
    scDeployError = '';
    validationResult = null;

    try {
      const result = await ValidateSCCode(scCode);
      validationResult = result;

      if (result.success) {
        if (!result.hasInitialize) {
          toast.warning('Warning: No Initialize() or InitializePrivate() entrypoint found. One is required for deployment.');
        } else {
          toast.success(`Valid: ${result.count} function${result.count !== 1 ? 's' : ''} parsed`);
        }
      } else {
        scDeployError = result.error || 'Validation failed';
        toast.error(scDeployError);
      }
    } catch (e) {
      scDeployError = e.message || 'Validation failed';
      toast.error(scDeployError);
    } finally {
      validating = false;
    }
  }

  // Load .bas file from disk
  async function loadFromFile() {
    try {
      const path = await SelectFile();
      if (!path) return;

      const result = await ReadTextFile(path);
      if (result.success) {
        scCode = result.content;
        loadedFilename = result.filename;
        validationResult = null;
        scDeployError = '';
        toast.success(`Loaded ${result.filename} (${result.size} bytes)`);
      } else {
        toast.error(result.error || 'Failed to load file');
      }
    } catch (e) {
      toast.error('Failed to load file: ' + e.message);
    }
  }

  // Prepare deployment (triggers confirmation modal on mainnet)
  export function prepareSCDeployment() {
    if (!scCode.trim()) {
      scDeployError = 'Please enter smart contract code';
      return;
    }
    if (!walletIsOpen && !isSimulator) {
      scDeployError = 'Please open a wallet first';
      return;
    }

    if (isSimulator) {
      deploySmartContract();
    } else {
      showDeployConfirmation('sc', {
        lineCount,
        charCount,
        functionCount: validationResult?.count || '?',
        anonymous: scAnonymous,
        network: currentNetwork,
        hasValidation: validationResult?.success === true,
      });
    }
  }

  // Actual deployment
  export async function deploySmartContract() {
    scDeploying = true;
    scDeployError = '';
    scDeployResult = null;

    try {
      const result = await InstallSmartContract(scCode, scAnonymous);

      if (result.success) {
        scDeployResult = {
          txid: result.txid,
          message: result.message
        };
        toast.success('Smart contract deployed successfully!');
      } else {
        scDeployError = result.error || 'Deployment failed';
        toast.error(scDeployError);
      }
    } catch (e) {
      scDeployError = e.message || 'Deployment failed';
      toast.error(scDeployError);
    } finally {
      scDeploying = false;
    }
  }

  function resetSCDeploy() {
    scCode = '';
    scAnonymous = false;
    scDeployResult = null;
    scDeployError = '';
    validationResult = null;
    loadedFilename = '';
  }

  function copyTxid() {
    if (scDeployResult?.txid) {
      ClipboardSetText(scDeployResult.txid);
      toast.success('TXID copied to clipboard');
    }
  }

  const placeholder = `Function Initialize() Uint64
10 STORE("owner", SIGNER())
20 STORE("counter", 0)
30 RETURN 0
End Function

Function Increment() Uint64
10 STORE("counter", LOAD("counter") + 1)
20 RETURN 0
End Function`;
</script>

<div class="content-section">
  <h2 class="content-section-title">Deploy Smart Contract</h2>
  <p class="content-section-desc">Deploy a raw DVM-BASIC smart contract directly to the blockchain.</p>

  <!-- Error Display -->
  {#if scDeployError}
    <div class="alert alert-error" style="margin-bottom: var(--s-4);">
      <AlertTriangle size={16} />
      <span>{scDeployError}</span>
    </div>
  {/if}

  <!-- Success Display -->
  {#if scDeployResult}
    <div class="clone-success-card">
      <div class="clone-success-header">
        <CheckCircle size={24} class="clone-success-icon" />
        <div>
          <h3 class="clone-success-title">Smart Contract Deployed!</h3>
          <p class="clone-success-subtitle">Transaction submitted successfully</p>
        </div>
      </div>

      <div class="clone-result-details">
        <div class="clone-detail-row">
          <span class="clone-detail-label">Transaction ID</span>
          <code class="clone-detail-value" style="font-size: 11px;">{scDeployResult.txid}</code>
        </div>
        <div class="clone-detail-row">
          <span class="clone-detail-label">Status</span>
          <span class="clone-detail-value">Pending confirmation</span>
        </div>
      </div>

      <div class="alert alert-info sc-deploy-alert">
        <span class="alert-icon">
          <Info size={14} />
        </span>
        <div class="alert-content">
          <div class="alert-text">The SCID will be the same as the TXID once confirmed. Copy the TXID above.</div>
        </div>
      </div>

      <div class="clone-actions">
        <button class="btn btn-secondary" on:click={copyTxid}>
          <Copy size={14} />
          Copy TXID
        </button>
        <button class="btn btn-ghost" on:click={resetSCDeploy}>
          Deploy Another
        </button>
      </div>
    </div>
  {:else}
    <!-- Deployment Form -->
    <div class="content-card">
      <div class="content-card-header">
        <FileCode size={32} class="content-card-icon" />
        <p class="content-card-title">DVM-BASIC Code</p>
        <p class="content-card-text">
          Enter your smart contract code below, or load a <code>.bas</code> file from disk.
          {#if loadedFilename}
            <span class="sc-loaded-badge">
              <Check size={12} />
              {loadedFilename}
            </span>
          {/if}
        </p>
      </div>

      <!-- Toolbar: Load File + Validate -->
      <div class="sc-toolbar" style="margin-top: var(--s-3);">
        <button class="btn btn-ghost btn-sm" on:click={loadFromFile}>
          <FolderOpen size={14} />
          Load File
        </button>
        <button
          class="btn btn-ghost btn-sm"
          on:click={validateCode}
          disabled={validating || !scCode.trim()}
        >
          {#if validating}
            <Loader2 size={14} class="spinner" />
            Validating...
          {:else}
            <Shield size={14} />
            Validate
          {/if}
        </button>
      </div>

      <div class="form-group" style="margin-top: var(--s-3);">
        <label class="form-label">Smart Contract Code <span class="required">*</span></label>
        <textarea
          bind:value={scCode}
          {placeholder}
          class="textarea sc-code-textarea"
          rows="18"
          spellcheck="false"
          on:input={() => { validationResult = null; scDeployError = ''; scDeployResult = null; }}
        ></textarea>
        <div class="sc-meta-row">
          <span class="form-hint">{lineCount} line{lineCount !== 1 ? 's' : ''} &middot; {charCount} char{charCount !== 1 ? 's' : ''}{functionCount > 0 ? ` \u00B7 ${functionCount} function${functionCount !== 1 ? 's' : ''}` : ''}</span>
        </div>
      </div>

      <!-- Validation Result -->
      {#if validationResult}
        <div class="sc-validation-result" class:sc-valid={validationResult.success} class:sc-invalid={!validationResult.success}>
          {#if validationResult.success}
            <div class="sc-validation-header">
              <Check size={14} />
              <span>Valid &mdash; {validationResult.count} exported function{validationResult.count !== 1 ? 's' : ''}</span>
              {#if !validationResult.hasInitialize}
                <span class="sc-validation-warn">Missing entrypoint</span>
              {/if}
            </div>
            {#if validationResult.functions && validationResult.functions.length > 0}
              <div class="sc-functions-list">
                {#each validationResult.functions as fn}
                  <div class="sc-function-item">
                    <code class="sc-function-name">{fn.name}({fn.params.map(p => `${p.name} ${p.type}`).join(', ')})</code>
                    <div class="sc-function-tags">
                      {#if fn.usesDero}<span class="sc-tag dero">DERO</span>{/if}
                      {#if fn.usesAsset}<span class="sc-tag asset">Asset</span>{/if}
                      {#if fn.usesSigner}<span class="sc-tag signer">Signer</span>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="sc-validation-header">
              <X size={14} />
              <span>{validationResult.error}</span>
            </div>
          {/if}
        </div>
      {/if}

      <div class="form-group" style="margin-top: var(--s-3);">
        <label class="checkbox-wrap">
          <input type="checkbox" bind:checked={scAnonymous} class="checkbox" />
          <span class="checkbox-label">Anonymous Deployment (Ring 16+)</span>
        </label>
        <span class="form-hint">Use higher ring size for enhanced privacy. Standard deployment uses Ring 2.</span>
      </div>

      <!-- Wallet Check -->
      {#if !walletIsOpen && !isSimulator}
        <div class="alert alert-warning" style="margin-top: var(--s-4);">
          <AlertTriangle size={16} />
          <span>Please open a wallet to deploy smart contracts</span>
        </div>
      {/if}

      <button
        class="btn btn-primary btn-block"
        style="margin-top: var(--s-4);"
        on:click={prepareSCDeployment}
        disabled={scDeploying || !scCode.trim() || (!walletIsOpen && !isSimulator)}
      >
        {#if scDeploying}
          <Loader2 size={16} class="spinner" />
          Deploying...
        {:else}
          <Zap size={16} />
          Deploy Smart Contract
        {/if}
      </button>
    </div>

    <!-- Info Panel -->
    <div class="info-panel" style="margin-top: var(--s-4);">
      <div class="info-panel-icon">◎</div>
      <div class="info-panel-content">
        <p class="info-panel-title">About DVM-BASIC Smart Contracts</p>
        <ul class="info-list">
          <li>Every SC <strong>must</strong> have an <code>Initialize()</code> or <code>InitializePrivate()</code> entrypoint that returns <code>Uint64</code></li>
          <li><code>RETURN 0</code> = success (state commits), <code>RETURN 1</code> = failure (state reverts)</li>
          <li><code>STORE(key, value)</code> / <code>LOAD(key)</code> for persistent on-chain state</li>
          <li><code>SIGNER()</code> for access control, <code>DEROVALUE()</code> to receive DERO</li>
          <li>Line numbers are the control flow mechanism &mdash; use <code>GOTO</code> to jump</li>
          <li>The SCID equals the deployment TXID once confirmed</li>
          <li>Anonymous mode (Ring 16+) enhances privacy but costs more gas</li>
        </ul>
      </div>
    </div>
  {/if}
</div>

<style>
  .sc-toolbar {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }

  .sc-loaded-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--emerald-400);
    background: rgba(52, 211, 153, 0.1);
    border-radius: var(--r-sm);
    padding: 2px 8px;
    margin-left: var(--s-1);
  }

  .sc-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--s-1);
  }

  .sc-validation-result {
    margin-top: var(--s-3);
    border-radius: var(--r-md);
    padding: var(--s-3);
    font-size: 13px;
  }

  .sc-validation-result.sc-valid {
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.25);
  }

  .sc-validation-result.sc-invalid {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .sc-validation-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 500;
  }

  .sc-valid .sc-validation-header {
    color: var(--emerald-400);
  }

  .sc-invalid .sc-validation-header {
    color: var(--red-400);
  }

  .sc-validation-warn {
    font-size: 11px;
    color: var(--amber-400);
    background: rgba(245, 158, 11, 0.1);
    padding: 2px 8px;
    border-radius: var(--r-sm);
    margin-left: auto;
  }

  .sc-functions-list {
    margin-top: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }

  .sc-function-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--r-sm);
  }

  .sc-function-name {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }

  .sc-function-tags {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .sc-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .sc-tag.dero {
    color: var(--cyan-400);
    background: rgba(34, 211, 238, 0.12);
  }

  .sc-tag.asset {
    color: var(--amber-400);
    background: rgba(245, 158, 11, 0.12);
  }

  .sc-tag.signer {
    color: var(--violet-400);
    background: rgba(139, 92, 246, 0.12);
  }

  .sc-deploy-alert {
    margin-bottom: var(--s-4);
  }
</style>
