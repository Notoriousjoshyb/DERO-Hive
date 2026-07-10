<script>
  import {
    AlertTriangle,
    Check,
    CheckCircle,
    Clipboard,
    Gamepad2,
    Layers,
    Loader2,
    Lock,
    Plus,
    Puzzle,
    RefreshCw,
    Wrench,
    Zap
  } from 'lucide-svelte';
  import { Database, Eye, X } from 'lucide-svelte';

  export let indexInstallResult = null;
  export let indexInstallError = '';
  export let indexInstalling = false;
  export let indexName = '';
  export let indexDURL = '';
  export let indexDurlTag = null;
  export let indexDescription = '';
  export let indexIconURL = '';
  export let indexIconValidation = { valid: true, warning: false, message: '' };
  export let indexDocScids = [];
  export let newIndexDocScid = '';
  export let indexRingsize = 2;
  export let indexEnableMods = false;
  export let indexSelectedVsMod = '';
  export let indexSelectedTxMods = [];
  export let showModPickerModal = false;
  export let modsLoading = false;
  export let isSimulator = false;
  export let currentNetwork = '';
  export let copiedScid = null;
  export let walletIsOpen = false;
  export let INDEX_BASE_GAS = 0;
  export let resetIndexForm = () => {};
  export let copyScid = () => {};
  export let previewInBrowser = () => {};
  export let removeDocFromNewIndex = () => {};
  export let addDocToNewIndex = () => {};
  export let prepareIndexDeployment = () => {};
  export let getVsModOptions = () => [];
  export let getTxModOptions = () => [];
  export let toggleTxMod = () => {};
  export let getModTags = () => '';
  export let formatGas = () => '';
  export let gasToDero = () => '';
</script>

<div class="content-section">
  <h2 class="content-section-title">Install TELA INDEX</h2>
  <p class="content-section-desc">Create a TELA INDEX to organize and serve your DOCs as a web application.</p>
  
  {#if indexInstallResult?.type === 'success'}
    <!-- Success Display -->
    <div class="deployment-success-card">
      <div class="success-header">
        <div class="success-icon">
          <CheckCircle size={24} />
        </div>
        <div class="success-info">
          <h4 class="success-title">INDEX Created Successfully!</h4>
          <p class="success-meta">
            {#if indexInstallResult.network === 'simulator'}
              <span class="network-badge simulator">Simulator</span>
            {:else}
              <span class="network-badge {indexInstallResult.network}">{indexInstallResult.network}</span>
            {/if}
            • {indexInstallResult.timestamp}
          </p>
        </div>
        <button class="success-close" on:click={resetIndexForm}>
          <X size={16} />
        </button>
      </div>
      
      <div class="deployed-item">
        <div class="deployed-file-info">
          <Layers size={16} class="deployed-icon" />
          <div class="deployed-details">
            <span class="deployed-name">{indexName}</span>
            <span class="deployed-size">dURL: {indexInstallResult.durl}</span>
          </div>
        </div>
        
        <div class="deployed-scid-row">
          <span class="scid-label">SCID:</span>
          <code class="scid-value">{indexInstallResult.scid}</code>
        </div>
        
        <div class="deployed-actions">
          <button 
            class="action-btn copy-btn" 
            on:click={() => copyScid(indexInstallResult.scid)}
            title="Copy SCID"
          >
            {#if copiedScid === indexInstallResult.scid}
              <Check size={14} />
              <span>Copied!</span>
            {:else}
              <Clipboard size={14} />
              <span>Copy SCID</span>
            {/if}
          </button>
          <button 
            class="action-btn preview-btn" 
            on:click={() => previewInBrowser(indexInstallResult.scid)}
            title="View in Browser"
          >
            <Eye size={14} />
            <span>Preview</span>
          </button>
        </div>
      </div>
      
      {#if indexInstallResult.network === 'simulator'}
        <div class="success-note">
          <Gamepad2 size={12} />
          <span>INDEX deployed to local simulator. Preview it above or use dero://{indexInstallResult.durl}</span>
        </div>
      {/if}
      
      <button 
        class="btn btn-ghost" 
        style="margin-top: var(--s-4);"
        on:click={resetIndexForm}
      >
        <Plus size={14} />
        Create Another INDEX
      </button>
    </div>
  {:else}
    <!-- INDEX Form -->
    <div class="form-stack">
      <!-- Application Name -->
      <div class="form-group">
        <label class="form-label">
          Application Name <span class="required">*</span>
        </label>
        <input
          type="text"
          bind:value={indexName}
          placeholder="My TELA App"
          class="input"
        />
      </div>
      
      <!-- dURL (Required for INDEX) with tag detection -->
      <!-- NOTE: dURL uniqueness is not enforced at the protocol level. Multiple INDEXes
           can share the same dURL. Future work should consider collision detection and
           disambiguation (e.g., listing all TELA apps using a given dURL). -->
      <div class="form-group">
        <label class="form-label">
          dURL <span class="required">*</span>
          {#if indexDurlTag}
            <span class="durl-tag-badge" class:tag-violet={indexDurlTag.color === 'violet'} class:tag-cyan={indexDurlTag.color === 'cyan'} class:tag-amber={indexDurlTag.color === 'amber'}>
              <span class="tag-icon">{indexDurlTag.icon}</span>
              {indexDurlTag.name}
            </span>
          {/if}
        </label>
        <input
          type="text"
          bind:value={indexDURL}
          placeholder="my-app.tela"
          class="input"
          title="dURL is not globally unique -- other INDEXes may use the same name"
        />
        {#if indexDurlTag && indexDurlTag.tag !== '.tela'}
          <p class="form-hint durl-tag-hint" class:hint-violet={indexDurlTag.color === 'violet'} class:hint-cyan={indexDurlTag.color === 'cyan'} class:hint-amber={indexDurlTag.color === 'amber'}>
            {indexDurlTag.description}
          </p>
        {:else}
          <p class="form-hint">Accessible via dero://{indexDURL || 'my-app'}</p>
        {/if}
      </div>
      
      <!-- Description -->
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea
          bind:value={indexDescription}
          placeholder="Describe your application..."
          rows="3"
          class="input textarea"
        ></textarea>
      </div>
      
      <!-- Icon URL with validation -->
      <div class="form-group">
        <label class="form-label">Icon URL</label>
        <div class="icon-url-input-wrapper">
          <input
            type="text"
            bind:value={indexIconURL}
            placeholder="Icon DOC SCID (recommended) or URL"
            class="input"
            class:input-valid={indexIconURL && indexIconValidation.valid && !indexIconValidation.warning}
            class:input-warning={indexIconValidation.warning}
            class:input-error={indexIconURL && !indexIconValidation.valid}
          />
          {#if indexIconURL}
            <span class="icon-url-status" class:valid={indexIconValidation.valid && !indexIconValidation.warning} class:warning={indexIconValidation.warning} class:invalid={!indexIconValidation.valid}>
              {#if indexIconValidation.valid && !indexIconValidation.warning}
                <CheckCircle size={14} />
              {:else if indexIconValidation.warning}
                <AlertTriangle size={14} />
              {:else}
                <X size={14} />
              {/if}
            </span>
          {/if}
        </div>
        {#if indexIconURL && indexIconValidation.message}
          <p class="form-hint" class:hint-valid={indexIconValidation.valid && !indexIconValidation.warning} class:hint-warning={indexIconValidation.warning} class:hint-error={!indexIconValidation.valid}>
            {indexIconValidation.message}
          </p>
        {:else}
          <p class="form-hint">Recommended: use an on-chain icon DOC SCID (100x100 SVG/PNG works well).</p>
        {/if}
      </div>
      
      <!-- DOC References Section -->
      <div class="form-group">
        <label class="form-label">
          DOC References <span class="required">*</span>
          <span class="text-text-4">({indexDocScids.length})</span>
        </label>
        
        {#if indexDocScids.length > 0}
          <div class="docs-list" style="margin-bottom: var(--s-3);">
            {#each indexDocScids as scid, i}
              <div class="doc-item">
                <span class="doc-item-num">{i + 1}.</span>
                <span class="doc-item-scid">{scid.slice(0, 16)}...{scid.slice(-8)}</span>
                <button
                  on:click={() => removeDocFromNewIndex(scid)}
                  class="remove-btn"
                  title="Remove DOC"
                >
                  <X size={14} />
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="form-hint" style="margin-bottom: var(--s-3); color: var(--text-3);">
            Add at least one DOC SCID that will be part of this INDEX
          </p>
        {/if}
        
        <!-- Add DOC Input -->
        <div class="doc-add-row">
          <input
            type="text"
            bind:value={newIndexDocScid}
            placeholder="Enter DOC SCID (64 characters)..."
            class="input input-mono"
            on:keydown={(e) => e.key === 'Enter' && addDocToNewIndex()}
          />
          <button
            on:click={addDocToNewIndex}
            class="btn btn-secondary"
            disabled={newIndexDocScid.length !== 64}
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>
      
      <!-- Ringsize Selector for INDEX -->
      <div class="ringsize-section">
        <label class="form-label">Update Permissions</label>
        <div class="ringsize-options">
          <button 
            class="ringsize-option" 
            class:selected={indexRingsize === 2}
            on:click={() => indexRingsize = 2}
          >
            <RefreshCw size={14} />
            <span class="ringsize-label">Updateable</span>
            <span class="ringsize-hint">Ring 2 - can modify DOCs later</span>
          </button>
          <button 
            class="ringsize-option" 
            class:selected={indexRingsize === 16}
            class:disabled={indexEnableMods}
            on:click={() => !indexEnableMods && (indexRingsize = 16)}
            disabled={indexEnableMods}
            title={indexEnableMods ? 'MODs require updateable INDEX (Ring 2)' : ''}
          >
            <Lock size={14} />
            <span class="ringsize-label">Immutable</span>
            <span class="ringsize-hint">{indexEnableMods ? 'Disabled when MODs enabled' : 'Ring 16+ - permanent INDEX'}</span>
          </button>
        </div>
      </div>
      
      <!-- TELA-MODs Section (matching tela-cli modsPrompt) -->
      <div class="mods-section">
        <div class="mods-header">
          <label class="form-label">
            <Puzzle size={14} />
            TELA-MODs
          </label>
          <div class="mods-header-actions">
            <button 
              class="mods-advanced-btn"
              on:click={() => showModPickerModal = true}
              title="Open MOD picker"
            >
              <Wrench size={12} />
              Advanced
            </button>
            <button 
              class="mods-toggle"
              class:enabled={indexEnableMods}
              on:click={() => indexEnableMods = !indexEnableMods}
            >
              <div class="mods-toggle-track">
                <div class="mods-toggle-thumb"></div>
              </div>
              <span>{indexEnableMods ? 'Enabled' : 'Disabled'}</span>
            </button>
          </div>
        </div>
        
        {#if indexEnableMods}
          <div class="mods-content">
            {#if modsLoading}
              <div class="mods-loading">
                <Loader2 size={16} class="spin" />
                <span>Loading MODs...</span>
              </div>
            {:else}
              <p class="mods-description">
                MODs add smart contract functionality to your INDEX. MODs require Ring 2 (updateable).
              </p>
              
              <!-- Variable Store MOD (single selection) -->
              <div class="mod-group">
                <label class="mod-group-label">
                  <Database size={12} />
                  Variable Store
                  <span class="mod-group-hint">(select one)</span>
                </label>
                <div class="mod-options">
                  <button 
                    class="mod-option"
                    class:selected={indexSelectedVsMod === ''}
                    on:click={() => indexSelectedVsMod = ''}
                  >
                    <span class="mod-option-name">None</span>
                  </button>
                  {#each getVsModOptions() as mod}
                    <button 
                      class="mod-option"
                      class:selected={indexSelectedVsMod === mod.tag}
                      on:click={() => indexSelectedVsMod = mod.tag}
                      title={mod.description}
                    >
                      <span class="mod-option-tag">{mod.tag}</span>
                      <span class="mod-option-name">{mod.name.replace('Variable store ', '')}</span>
                    </button>
                  {/each}
                </div>
              </div>
              
              <!-- Transfer MODs (multi-selection) -->
              <div class="mod-group">
                <label class="mod-group-label">
                  <Zap size={12} />
                  Transfers
                  <span class="mod-group-hint">(select multiple)</span>
                </label>
                <div class="mod-options">
                  {#each getTxModOptions() as mod}
                    <button 
                      class="mod-option"
                      class:selected={indexSelectedTxMods.includes(mod.tag)}
                      on:click={() => toggleTxMod(mod.tag)}
                      title={mod.description}
                    >
                      <span class="mod-option-tag">{mod.tag}</span>
                      <span class="mod-option-name">{mod.name}</span>
                      {#if indexSelectedTxMods.includes(mod.tag)}
                        <Check size={12} class="mod-check" />
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
              
              <!-- Selected MODs summary -->
              {#if getModTags()}
                <div class="mods-summary">
                  <span class="mods-summary-label">Selected:</span>
                  <code class="mods-summary-tags">{getModTags()}</code>
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <p class="mods-hint">
            Enable to add smart contract functionality (variable stores, deposits, transfers)
          </p>
        {/if}
      </div>
      
      <!-- Gas Estimate -->
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
            {:else}
              <p class="gas-value c-emerald">~{formatGas(INDEX_BASE_GAS + (indexDocScids.length * 1000))} gas</p>
              <p class="gas-dero">≈ {gasToDero(INDEX_BASE_GAS + (indexDocScids.length * 1000))} DERO</p>
            {/if}
          </div>
          <Layers size={24} class="gas-icon" />
        </div>
        {#if currentNetwork === 'mainnet' && !isSimulator}
          <p class="gas-note">
            INDEX contracts have a base cost. Additional DOC references may increase cost.
          </p>
        {/if}
        {#if isSimulator}
          <div class="simulator-info">
            <Gamepad2 size={12} />
            <span>Deploy instantly with auto-confirmation</span>
          </div>
        {/if}
      </div>
      
      <!-- Error Display -->
      {#if indexInstallError}
        <div class="alert-error">
          <AlertTriangle size={14} />
          {indexInstallError}
        </div>
      {/if}
      
      <!-- Create Button -->
      <div class="deploy-row">
        <button
          on:click={prepareIndexDeployment}
          disabled={(!walletIsOpen && !isSimulator) || !indexName.trim() || !indexDURL.trim() || indexDocScids.length === 0 || indexInstalling}
          class="btn btn-primary"
          class:btn-simulator={isSimulator}
        >
          {#if indexInstalling}
            <Loader2 size={14} class="spin" />
            Creating INDEX...
          {:else if isSimulator}
            <Gamepad2 size={14} />
            Create INDEX (Simulator)
          {:else}
            <Layers size={14} />
            Create INDEX
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
    </div>
  {/if}
</div>
