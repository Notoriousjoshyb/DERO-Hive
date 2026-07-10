<script>
  import DropZone from '../DropZone.svelte';
  import {
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCircle,
    Clipboard,
    Eye,
    FileArchive,
    FileText,
    Gamepad2,
    Lock,
    RefreshCw,
    X
  } from 'lucide-svelte';

  export let dropzoneElement = null;
  export let stagedFiles = [];
  export let docDescription = '';
  export let docIconURL = '';
  export let docRingsize = 2;
  export let docCompression = false;
  export let totalGasEstimate = 0;
  export let gasLoading = false;
  export let isSimulator = false;
  export let currentNetwork = '';
  export let deploymentStatus = null;
  export let copiedScid = null;
  export let walletIsOpen = false;
  export let handleFilesStaged = () => {};
  export let removeFile = () => {};
  export let canCompressFiles = () => false;
  export let formatGas = () => '';
  export let gasToDero = () => '';
  export let prepareDocDeployment = () => {};
  export let copyScid = () => {};
  export let previewInBrowser = () => {};
  export let clearDeploymentResults = () => {};
  export let formatFileSize = () => '';
  export let onSwitchToBatch = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Install TELA DOC</h2>
  <p class="content-section-desc">
    Deploy a single file as a standalone DOC smart contract.
    <button class="batch-hint-link" on:click={onSwitchToBatch}>
      For multi-file apps, use Batch Upload <ArrowRight size={12} />
    </button>
  </p>
  
  <!-- Drop Zone (dropzoneElement used by Studio.svelte native OnFileDrop on Linux) -->
  <div bind:this={dropzoneElement} class="studio-doc-drop-host">
    <DropZone on:filesStaged={handleFilesStaged} />
  </div>
  
  <!-- v6.1 Staged Files List -->
  {#if stagedFiles.length > 0}
    <div class="staged-section">
      <h3 class="content-section-title">Staged Files <span class="text-text-4">({stagedFiles.length})</span></h3>
      
      <!-- Multi-file info banner -->
      {#if stagedFiles.length > 1}
        <div class="multi-file-info">
          <AlertTriangle size={14} />
          <span>
            Multiple files will create <strong>{stagedFiles.length} separate DOCs</strong> (no INDEX linking them).
          </span>
          <button class="info-action-btn" on:click={onSwitchToBatch}>
            Use Batch Upload instead <ArrowRight size={12} />
          </button>
        </div>
      {/if}
      
      <!-- Enhanced staged file list with editable fields -->
      <div class="staged-list">
        {#each stagedFiles as file, index}
          <div class="staged-item-enhanced">
            <div class="staged-item-header">
              <FileText size={16} class="staged-icon" />
              <div class="staged-info">
                <div class="staged-name">{file.name}</div>
                <div class="staged-meta">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
              <button on:click={() => removeFile(index)} class="staged-remove" title="Remove file">
                <X size={14} />
              </button>
            </div>
            
            <div class="staged-item-fields">
              <!-- Editable SubDir -->
              <div class="staged-item-field">
                <label class="staged-field-label">SubDir</label>
                <input
                  type="text"
                  bind:value={file.subDir}
                  placeholder="/"
                  class="input input-sm"
                />
              </div>
              
              <!-- DocType Selector (matching Batch Upload) -->
              <div class="staged-item-field">
                <label class="staged-field-label">Doc Type</label>
                <select
                  bind:value={file.telaDocType}
                  class="input input-sm doctype-select"
                  title="Select TELA document type"
                >
                  <option value="TELA-HTML-1">HTML</option>
                  <option value="TELA-CSS-1">CSS</option>
                  <option value="TELA-JS-1">JavaScript</option>
                  <option value="TELA-JSON-1">JSON</option>
                  <option value="TELA-MD-1">Markdown</option>
                  <option value="TELA-GO-1">Go</option>
                  <option value="TELA-STATIC-1">Static/Binary</option>
                </select>
              </div>
            </div>
          </div>
        {/each}
      </div>
      
      <!-- DOC Metadata Section -->
      <div class="doc-metadata-section">
        <h4 class="metadata-title">DOC Metadata <span class="text-text-4">(optional)</span></h4>
        
        <div class="metadata-grid">
          <div class="form-group">
            <label class="form-label">Description</label>
            <input
              type="text"
              bind:value={docDescription}
              placeholder="Brief description of this content..."
              class="input"
            />
          </div>
          
          <div class="form-group">
            <label class="form-label">Icon URL</label>
            <input
              type="text"
              bind:value={docIconURL}
              placeholder="https://... or SCID"
              class="input"
            />
          </div>
        </div>
        
        <!-- Ringsize Selector -->
        <div class="ringsize-section">
          <label class="form-label">Update Permissions</label>
          <div class="ringsize-options">
            <button 
              class="ringsize-option" 
              class:selected={docRingsize === 2}
              on:click={() => docRingsize = 2}
            >
              <RefreshCw size={14} />
              <span class="ringsize-label">Updateable</span>
              <span class="ringsize-hint">Ring 2 - can modify later</span>
            </button>
            <button 
              class="ringsize-option" 
              class:selected={docRingsize === 16}
              on:click={() => docRingsize = 16}
            >
              <Lock size={14} />
              <span class="ringsize-label">Immutable</span>
              <span class="ringsize-hint">Ring 16+ - permanent</span>
            </button>
          </div>
        </div>
        
        <!-- Compression Toggle (matching tela-cli) -->
        {#if stagedFiles.length > 0 && canCompressFiles(stagedFiles)}
          <div class="compression-section">
            <label class="form-label">Compression</label>
            <button 
              class="compression-toggle"
              class:enabled={docCompression}
              on:click={() => docCompression = !docCompression}
            >
              <div class="compression-toggle-track">
                <div class="compression-toggle-thumb"></div>
              </div>
              <div class="compression-info">
                <span class="compression-label">
                  {docCompression ? 'Enabled' : 'Disabled'}
                </span>
                <span class="compression-hint">
                  {docCompression 
                    ? 'Files will be gzip compressed (smaller on-chain size)' 
                    : 'Files will be stored uncompressed'}
                </span>
              </div>
            </button>
            {#if docCompression}
              <div class="compression-note">
                <FileArchive size={12} />
                <span>Text files (HTML, CSS, JS, JSON, MD, Go) will be gzip compressed before deployment</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
      
      <!-- v6.1 Gas Estimate -->
      {#if totalGasEstimate > 0 || gasLoading || isSimulator}
        <div class="gas-estimate" class:simulator-mode={isSimulator}>
          <div class="gas-row">
            <div>
              <p class="data-label">Estimated Cost</p>
              {#if isSimulator}
                <p class="gas-value gas-free">
                  <Gamepad2 size={14} />
                  FREE (Simulator)
                </p>
                <p class="gas-dero simulator-note">No real DERO required</p>
              {:else if gasLoading}
                <p class="gas-value loading">Calculating...</p>
              {:else}
                <p class="gas-value c-emerald">~{formatGas(totalGasEstimate)} gas</p>
                <p class="gas-dero">≈ {gasToDero(totalGasEstimate)} DERO</p>
              {/if}
            </div>
            <div class="text-right">
              <p class="data-label">Total Size</p>
              <p class="gas-size">
                {(stagedFiles.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          {#if currentNetwork === 'mainnet' && totalGasEstimate > 100000}
            <div class="gas-warning">
              <AlertTriangle size={12} />
              <span>Large deployment - consider testing on Simulator first</span>
            </div>
          {/if}
          {#if isSimulator}
            <div class="simulator-info">
              <Gamepad2 size={12} />
              <span>Deploy instantly with auto-confirmation</span>
            </div>
          {/if}
        </div>
      {/if}
      
      <!-- v6.1 Deploy Button -->
      <div class="deploy-row">
        <button
          on:click={prepareDocDeployment}
          disabled={!walletIsOpen && !isSimulator}
          class="btn btn-primary"
          class:btn-simulator={isSimulator}
        >
          {#if isSimulator}
            <Gamepad2 size={14} />
            Deploy to Simulator ({stagedFiles.length} DOC{stagedFiles.length > 1 ? 's' : ''})
          {:else}
            Deploy {stagedFiles.length} DOC{stagedFiles.length > 1 ? 's' : ''}
          {/if}
        </button>
        {#if !walletIsOpen && !isSimulator}
          <span class="wallet-warning">
            <AlertTriangle size={14} />
            Wallet required for deployment
          </span>
        {:else if isSimulator}
          <span class="simulator-badge-small">
            <Gamepad2 size={12} />
            Auto-mines to confirm
          </span>
        {/if}
      </div>
      
      {#if deploymentStatus}
        {#if deploymentStatus.type === 'success' && deploymentStatus.results?.length > 0}
          <!-- Success Card with SCID Display -->
          <div class="deployment-success-card">
            <div class="success-header">
              <div class="success-icon">
                <CheckCircle size={24} />
              </div>
              <div class="success-info">
                <h4 class="success-title">Deployment Successful!</h4>
                <p class="success-meta">
                  {deploymentStatus.results.length} DOC{deploymentStatus.results.length > 1 ? 's' : ''} deployed 
                  {#if deploymentStatus.network === 'simulator'}
                    <span class="network-badge simulator">Simulator</span>
                  {:else}
                    <span class="network-badge {deploymentStatus.network}">{deploymentStatus.network}</span>
                  {/if}
                  • {deploymentStatus.timestamp}
                </p>
              </div>
              <button class="success-close" on:click={clearDeploymentResults}>
                <X size={16} />
              </button>
            </div>
            
            {#each deploymentStatus.results as result, i}
              <div class="deployed-item">
                <div class="deployed-file-info">
                  <FileText size={16} class="deployed-icon" />
                  <div class="deployed-details">
                    <span class="deployed-name">{result.fileName}</span>
                    <span class="deployed-size">{formatFileSize(result.fileSize)}</span>
                  </div>
                </div>
                
                {#if result.scid}
                  <div class="deployed-scid-row">
                    <span class="scid-label">SCID:</span>
                    <code class="scid-value">{result.scid}</code>
                  </div>
                  
                  <div class="deployed-actions">
                    <button 
                      class="action-btn copy-btn" 
                      on:click={() => copyScid(result.scid)}
                      title="Copy SCID"
                    >
                      {#if copiedScid === result.scid}
                        <Check size={14} />
                        <span>Copied!</span>
                      {:else}
                        <Clipboard size={14} />
                        <span>Copy SCID</span>
                      {/if}
                    </button>
                    <button 
                      class="action-btn preview-btn" 
                      on:click={() => previewInBrowser(result.scid)}
                      title="View in Browser"
                    >
                      <Eye size={14} />
                      <span>Preview</span>
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
            
            {#if deploymentStatus.network === 'simulator'}
              <div class="success-note">
                <Gamepad2 size={12} />
                <span>Content deployed to local simulator. Preview it above or paste the SCID in the browser.</span>
              </div>
            {/if}
          </div>
        {:else}
          <!-- Standard status message (error/info) -->
          <div class="deployment-status deployment-status-{deploymentStatus.type}">
            {deploymentStatus.message}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
  
  <!-- Deployment Status (OUTSIDE stagedFiles check so it persists after success) -->
  {#if deploymentStatus && !stagedFiles.length}
    {#if deploymentStatus.type === 'success' && deploymentStatus.results?.length > 0}
      <!-- Success Card with SCID Display -->
      <div class="deployment-success-card">
        <div class="success-header">
          <div class="success-icon">
            <CheckCircle size={24} />
          </div>
          <div class="success-info">
            <h4 class="success-title">Deployment Successful!</h4>
            <p class="success-meta">
              {deploymentStatus.results.length} DOC{deploymentStatus.results.length > 1 ? 's' : ''} deployed 
              {#if deploymentStatus.network === 'simulator'}
                <span class="network-badge simulator">Simulator</span>
              {:else}
                <span class="network-badge {deploymentStatus.network}">{deploymentStatus.network}</span>
              {/if}
              • {deploymentStatus.timestamp}
            </p>
          </div>
          <button class="success-close" on:click={clearDeploymentResults}>
            <X size={16} />
          </button>
        </div>
        
        {#each deploymentStatus.results as result, i}
          <div class="deployed-item">
            <div class="deployed-file-info">
              <FileText size={16} class="deployed-icon" />
              <div class="deployed-details">
                <span class="deployed-name">{result.fileName}</span>
                <span class="deployed-size">{formatFileSize(result.fileSize)}</span>
              </div>
            </div>
            
            {#if result.scid}
              <div class="deployed-scid-row">
                <span class="scid-label">SCID:</span>
                <code class="scid-value">{result.scid}</code>
              </div>
              
              <div class="deployed-actions">
                <button 
                  class="action-btn copy-btn" 
                  on:click={() => copyScid(result.scid)}
                  title="Copy SCID"
                >
                  {#if copiedScid === result.scid}
                    <Check size={14} />
                    <span>Copied!</span>
                  {:else}
                    <Clipboard size={14} />
                    <span>Copy SCID</span>
                  {/if}
                </button>
                <button 
                  class="action-btn preview-btn" 
                  on:click={() => previewInBrowser(result.scid)}
                  title="View in Browser"
                >
                  <Eye size={14} />
                  <span>Preview</span>
                </button>
              </div>
            {/if}
          </div>
        {/each}
        
        {#if deploymentStatus.network === 'simulator'}
          <div class="success-note">
            <Gamepad2 size={12} />
            <span>Content deployed to local simulator. Preview it above or paste the SCID in the browser.</span>
          </div>
        {/if}
      </div>
    {:else if deploymentStatus.type === 'error'}
      <!-- Error message when no staged files -->
      <div class="deployment-status deployment-status-error">
        {deploymentStatus.message}
      </div>
    {/if}
  {/if}
</div>
