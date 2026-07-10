<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { Check, X, Diamond, AlertTriangle, Zap, Shield, Heart, Gamepad2, Terminal } from 'lucide-svelte';
  import Wordmark from './Wordmark.svelte';
  import { 
    DetectRunningNode, CheckDerodStatus,
    DetectExistingBlockchain, StartNode,
    StartSimulatorMode, SetDevSupportEnabled, TestAndConnectEndpoint
  } from '../../../wailsjs/go/main/App.js';
  import { waitForWails } from '../utils/wails.js';
  import { saveSetting, syncNetworkMode } from '../stores/appState.js';
  
  const dispatch = createEventDispatcher();
  
  // Wizard state
  let step = 'checking';
  let error = '';
  
  // Detection results
  let existingNode = null;
  let derodInstalled = false;
  let blockchainLocations = [];
  
  // User choices
  let selectedLocation = '';
  let customLocation = '';
  let useExternalNode = false;
  let externalEndpoint = 'http://192.168.1.1:10102';
  
  // Connection testing state
  let testingConnection = false;
  let connectionTestResult = null;
  let completing = false;
  
  onMount(async () => {
    try {
      // Wait for Wails Go bindings to be available
      await waitForWails();
      await runInitialChecks();
    } catch (err) {
      console.error('Failed to initialize wizard:', err);
      error = err.message || 'Failed to initialize. Please restart the application.';
      step = 'error';
    }
  });
  
  async function runInitialChecks() {
    step = 'checking';
    error = '';
    
    try {
      // Check for existing running node
      const nodeResult = await DetectRunningNode();
      if (nodeResult.found) {
        existingNode = nodeResult;
        step = 'found_external';
        return;
      }
      
      // Check if derod is installed
      const derodStatus = await CheckDerodStatus();
      derodInstalled = derodStatus.installed;
      
      // Check for existing blockchain data
      const blockchainResult = await DetectExistingBlockchain();
      if (blockchainResult.locations) {
        blockchainLocations = blockchainResult.locations;
        if (blockchainLocations.length > 0) {
          selectedLocation = blockchainLocations[0].path;
        }
      }
      
      // Determine next step
      if (derodInstalled) {
        step = 'choose_data';
      } else {
        step = 'no_node';
      }
    } catch (err) {
      error = err.message || 'Failed to perform initial checks';
      step = 'error';
    }
  }
  
  function chooseExternalNode() {
    useExternalNode = true;
    step = 'external_config';
  }
  
  async function testAndConnectExternal() {
    if (!externalEndpoint) {
      connectionTestResult = { success: false, error: 'Please enter an endpoint' };
      return;
    }
    
    testingConnection = true;
    connectionTestResult = null;
    
    try {
      // Test the connection first
      const result = await TestAndConnectEndpoint(externalEndpoint);
      connectionTestResult = result;
      
      if (result.success) {
        // Connection successful - save settings and proceed
        await saveSetting('daemonEndpoint', result.endpoint);
        await saveSetting('useEmbeddedNode', false);
        
        // Brief delay to show success message
        setTimeout(() => {
          showEpochInfo();
        }, 1500);
      }
    } catch (err) {
      connectionTestResult = { 
        success: false, 
        error: err.message || 'Connection test failed' 
      };
    } finally {
      testingConnection = false;
    }
  }
  
  // Legacy function for backwards compatibility
  async function connectToExternal() {
    await testAndConnectExternal();
  }
  
  async function useFoundExternal() {
    try {
      await saveSetting('daemonEndpoint', existingNode.endpoint);
      await saveSetting('useEmbeddedNode', false);
      
      showEpochInfo();
    } catch (err) {
      error = err.message || 'Failed to save settings';
    }
  }
  
  async function startWithEmbedded() {
    step = 'starting';
    
    try {
      const dataDir = customLocation || selectedLocation || '~/.dero/mainnet';
      
      // Save settings (using correct backend keys via saveSetting)
      await saveSetting('useEmbeddedNode', true);
      await saveSetting('nodeDataDir', dataDir);
      
      // Start the node
      const result = await StartNode(dataDir);
      if (result.success) {
        showEpochInfo();
      } else {
        throw new Error(result.error || 'Failed to start node');
      }
    } catch (err) {
      error = err.message || 'Failed to start node';
      step = 'error';
    }
  }
  
  function showEpochInfo() {
    // Show the EPOCH info step before completing
    step = 'epoch_info';
  }
  
  async function complete() {
    // Mark wizard as complete and dispatch event
    await saveSetting('wizardComplete', true);
    dispatch('complete');
  }
  
  async function finalizeWizard(devSupportEnabled) {
    if (completing) return;
    completing = true;
    try {
      await Promise.race([
        SetDevSupportEnabled(devSupportEnabled),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out enabling developer support')), 3000))
      ]);
    } catch (err) {
      console.error('Failed to update developer support setting:', err);
    }
    await saveSetting('wizardComplete', true);
    dispatch('complete');
    completing = false;
  }
  
  async function enableEpochAndComplete() {
    // Enable developer support and complete wizard
    // Use backend method which also starts the worker
    await finalizeWizard(true);
  }
  
  async function disableEpochAndComplete() {
    // Disable developer support and complete wizard
    // Use backend method which also stops the worker
    await finalizeWizard(false);
  }
  
  function skipWizard() {
    // Skip directly to EPOCH info, then complete
    step = 'epoch_info';
  }
  
  async function useSimulatorInstead() {
    // User wants to use Simulator instead of the detected mainnet node
    step = 'starting_simulator';
    
    try {
      const result = await StartSimulatorMode();
      if (result.success) {
        // Sync network mode to update frontend state (sidebar, etc.)
        await syncNetworkMode();
        // Simulator started, go to EPOCH info then complete
        showEpochInfo();
      } else {
        error = result.error || 'Failed to start simulator';
        step = 'error';
      }
    } catch (err) {
      error = err.message || 'Failed to start simulator';
      step = 'error';
    }
  }
</script>

<div class="wizard-backdrop">
  <!-- Mandatory noise overlay per HOLOGRAM rulebook -->
  <div class="noise-overlay"></div>
  
  <!-- Logo/Header - HOLOGRAM wordmark + tagline -->
  <div class="wizard-header">
    <Wordmark size="lg" glow={true} />
    <p class="wizard-subtitle">Explore the DERO Decentralized Web</p>
  </div>
    
  <!-- Wizard Card -->
  <div class="wizard-card">
    <div class="wizard-content">
      
      {#if step === 'checking'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Initializing</span>
          </div>
          <span class="wizard-badge live">SCANNING</span>
        </div>
        
        <div class="wizard-center">
          <div class="wizard-icon wizard-icon-info">
            <Diamond size={28} strokeWidth={1.5} />
          </div>
          <h2 class="wizard-step-title">Detecting Network</h2>
          <p class="wizard-step-desc">Searching for existing DERO node...</p>
        </div>
      
      {:else if step === 'found_external'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot"></span>
            <span class="wizard-status-text">Node Detected</span>
          </div>
          <span class="wizard-badge">LIVE</span>
        </div>
        
        <!-- Refined node info display -->
        <div class="wizard-node-card">
          <!-- Primary info: Network badge + block height -->
          <div class="wizard-node-header">
            <span class="wizard-network-badge" class:mainnet={existingNode.network === 'mainnet'} class:simulator={existingNode.network === 'simulator'}>
              {existingNode.network || 'mainnet'}
            </span>
            <div class="wizard-block-info">
              <span class="wizard-block-height">{(existingNode.height || 0).toLocaleString()}</span>
              <span class="wizard-block-label">blocks</span>
            </div>
          </div>
          
          <!-- Secondary info grid -->
          <div class="wizard-node-details">
            <div class="wizard-detail-row">
              <span class="wizard-detail-label">Endpoint</span>
              <span class="wizard-detail-value mono">{existingNode.endpoint}</span>
            </div>
            <div class="wizard-detail-row">
              <span class="wizard-detail-label">Version</span>
              <span class="wizard-detail-value mono">{existingNode.version?.split('.').slice(0, 3).join('.') || 'Unknown'}</span>
            </div>
          </div>
        </div>
        
        <div class="wizard-buttons">
          <button on:click={useFoundExternal} class="wizard-btn wizard-btn-primary">
            Use This Node
          </button>
          <button on:click={() => step = 'no_node'} class="wizard-btn wizard-btn-secondary">
            Set Up New Node
          </button>
        </div>
      
      {:else if step === 'no_node'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot warn"></span>
            <span class="wizard-status-text">Not Connected</span>
          </div>
          <span class="wizard-badge live">SETUP</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-2);">
          <h2 class="wizard-step-title">Choose Connection</h2>
          <p class="wizard-step-desc">How would you like to connect to the DERO network?</p>
        </div>
        
        <div class="wizard-options grid-3">
          <button on:click={() => step = 'build_instructions'} class="wizard-option primary">
            <span class="wizard-option-icon"><Terminal size={20} /></span>
            <div class="wizard-option-title">Build Node</div>
            <div class="wizard-option-desc">Build from source</div>
            <span class="wizard-option-badge ok">RECOMMENDED</span>
          </button>
          <button on:click={chooseExternalNode} class="wizard-option">
            <span class="wizard-option-icon">⬡</span>
            <div class="wizard-option-title">LAN / External</div>
            <div class="wizard-option-desc">Connect to existing node</div>
            <span class="wizard-option-badge cyan">POWER USER</span>
          </button>
          <button on:click={useSimulatorInstead} class="wizard-option">
            <span class="wizard-option-icon">◌</span>
            <div class="wizard-option-title">Simulator</div>
            <div class="wizard-option-desc">Local test environment</div>
            <span class="wizard-option-badge ok">SAFE • NO COST</span>
          </button>
        </div>
      
      {:else if step === 'build_instructions'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Build from Source</span>
          </div>
          <span class="wizard-badge live">INSTRUCTIONS</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-2);">
          <h2 class="wizard-step-title">Build DERO Node</h2>
          <p class="wizard-step-desc">Run this command in the HOLOGRAM directory:</p>
        </div>
        
        <div class="wizard-code-block">
          <code>make all</code>
        </div>
        
        <p class="wizard-step-desc" style="margin-top: var(--s-3); color: var(--text-3);">
          This builds HOLOGRAM along with derod and simulator from source.
          <br/>Binaries will be placed in <code>build/bin/</code>
        </p>
        
        <div class="wizard-buttons" style="margin-top: var(--s-4);">
          <button on:click={runInitialChecks} class="wizard-btn wizard-btn-primary">
            I've Built It - Check Again
          </button>
          <button on:click={() => step = 'no_node'} class="wizard-btn wizard-btn-ghost">
            ← Back
          </button>
        </div>
      
      {:else if step === 'choose_data'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Configure</span>
          </div>
          <span class="wizard-badge live">DATA</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-2);">
          <h2 class="wizard-step-title">Data Location</h2>
          <p class="wizard-step-desc">Select blockchain data storage</p>
        </div>
          
          {#if blockchainLocations.length > 0}
          <p class="wizard-form-label" style="color: var(--status-ok); margin-bottom: var(--s-2);">Found existing data:</p>
          <div class="wizard-radio-list">
              {#each blockchainLocations as loc}
              <button
                class="wizard-radio-item"
                class:selected={selectedLocation === loc.path}
                on:click={() => selectedLocation = loc.path}
              >
                <span class="wizard-radio-dot"></span>
                <span class="wizard-radio-text">{loc.path}</span>
                <span class="wizard-radio-meta">{loc.sizeGB?.toFixed(2)} GB</span>
              </button>
              {/each}
            </div>
          {/if}
          
        <div class="wizard-form-group">
          <label class="wizard-form-label">Custom location:</label>
            <input
              type="text"
              bind:value={customLocation}
              placeholder="~/.dero/mainnet"
            class="input"
            />
          </div>
          
        <button on:click={startWithEmbedded} class="wizard-btn wizard-btn-primary">
            Start Node
          </button>
        
        <button on:click={chooseExternalNode} class="wizard-skip wizard-skip-lan">
          <Zap size={14} /> Connect to LAN / External node instead
        </button>
      
      {:else if step === 'external_config'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Configure</span>
          </div>
          <span class="wizard-badge live">LAN / EXTERNAL</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-2);">
          <h2 class="wizard-step-title">Connect to Node</h2>
          <p class="wizard-step-desc">Enter your LAN or external node address</p>
        </div>
          
        <div class="wizard-form-group">
          <label class="wizard-form-label">Daemon Endpoint</label>
          <div class="wizard-endpoint-row">
            <input
              type="text"
              bind:value={externalEndpoint}
              placeholder="http://192.168.1.100:10102"
              class="input"
              disabled={testingConnection}
              on:keydown={(e) => e.key === 'Enter' && testAndConnectExternal()}
            />
            <button 
              on:click={testAndConnectExternal} 
              disabled={testingConnection}
              class="wizard-btn wizard-btn-primary"
            >
              {#if testingConnection}
                <span class="wizard-spinner wizard-spinner-sm"></span>
                Testing...
              {:else}
                Test & Connect
              {/if}
            </button>
          </div>
          <p class="wizard-form-hint">
            Example: http://192.168.1.71:10102 (your LAN node IP)
          </p>
        </div>
        
        <!-- Connection Test Result -->
        {#if connectionTestResult}
          {#if connectionTestResult.success}
            <div class="wizard-alert wizard-alert-success">
              <Check size={18} />
              <div class="wizard-alert-content">
                <strong>Connected to {connectionTestResult.network} node</strong>
                <span class="wizard-alert-details">
                  Version {connectionTestResult.version} • Height {connectionTestResult.height?.toLocaleString()}
                </span>
              </div>
            </div>
          {:else}
            <div class="wizard-alert wizard-alert-error">
              <X size={18} />
              <div class="wizard-alert-content">
                <strong>Connection failed</strong>
                <span class="wizard-alert-details">{connectionTestResult.error}</span>
              </div>
            </div>
          {/if}
        {/if}
          
        <div class="wizard-buttons" style="margin-top: var(--s-4);">
          <button on:click={() => { connectionTestResult = null; step = 'no_node'; }} class="wizard-btn wizard-btn-ghost">
            ← Back
          </button>
        </div>
      
      {:else if step === 'starting'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Starting</span>
          </div>
          <span class="wizard-badge live">INITIALIZING</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-6);">
          <div class="wizard-icon wizard-icon-info">
            <Zap size={28} strokeWidth={1.5} />
          </div>
          <h2 class="wizard-step-title">Starting Node</h2>
          <p class="wizard-step-desc">Initializing DERO daemon...</p>
        </div>
      
      {:else if step === 'starting_simulator'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot cyan"></span>
            <span class="wizard-status-text">Starting</span>
          </div>
          <span class="wizard-badge live">SIMULATOR</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-6);">
          <div class="wizard-icon wizard-icon-info">
            <Zap size={28} strokeWidth={1.5} />
          </div>
          <h2 class="wizard-step-title">Starting Simulator</h2>
          <p class="wizard-step-desc">Launching local test environment...</p>
        </div>
      
      {:else if step === 'epoch_info'}
        <!-- Status Bar - matches found_external -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot"></span>
            <span class="wizard-status-text">Ready</span>
          </div>
          <span class="wizard-badge">OPTIONAL</span>
        </div>
        
        <!-- Compact info card - same structure as node card for button alignment -->
        <div class="wizard-node-card">
          <div class="wizard-node-header">
            <div class="wizard-epoch-icon">
              <Zap size={20} strokeWidth={1.5} />
            </div>
            <div class="wizard-block-info">
              <span class="wizard-block-height" style="font-size: 18px;">Developer Support</span>
              <span class="wizard-block-label">passive background hashing</span>
            </div>
          </div>
          
          <div class="wizard-node-details">
            <div class="wizard-detail-row">
              <span class="wizard-detail-label">Impact</span>
              <span class="wizard-detail-value">Very light (~2 threads)</span>
            </div>
            <div class="wizard-detail-row">
              <span class="wizard-detail-label">Privacy</span>
              <span class="wizard-detail-value">100% private contributions</span>
            </div>
          </div>
        </div>
        
        <div class="wizard-buttons">
          <button on:click={enableEpochAndComplete} class="wizard-btn wizard-btn-primary" disabled={completing}>
            Enable Developer Support
          </button>
          <button on:click={disableEpochAndComplete} class="wizard-btn wizard-btn-secondary" disabled={completing}>
            No Thanks
          </button>
        </div>
      
      {:else if step === 'error'}
        <!-- Status Bar -->
        <div class="wizard-status-bar">
          <div class="wizard-status-left">
            <span class="wizard-status-dot err"></span>
            <span class="wizard-status-text">Error</span>
          </div>
          <span class="wizard-badge" style="color: var(--status-err); border-color: rgba(248, 113, 113, 0.4);">FAILED</span>
        </div>
        
        <div class="wizard-center" style="padding-top: var(--s-4);">
          <div class="wizard-icon wizard-icon-error">
            <AlertTriangle size={28} strokeWidth={1.5} />
          </div>
          <h2 class="wizard-step-title">Something Went Wrong</h2>
          <p class="wizard-error">{error}</p>
        </div>
        
        <div class="wizard-buttons">
          <button on:click={runInitialChecks} class="wizard-btn wizard-btn-primary">
              Retry
            </button>
          <button on:click={skipWizard} class="wizard-btn wizard-btn-ghost">
              Skip Setup
            </button>
        </div>
      {/if}
    </div>
    </div>
    
    <!-- Footer option - contextual based on step -->
  <div class="wizard-footer">
    {#if step === 'found_external'}
      <button on:click={useSimulatorInstead} class="wizard-skip wizard-skip-simulator">
        <Gamepad2 size={14} /> Use Simulator Instead
      </button>
    {:else if step === 'checking' || step === 'starting' || step === 'starting_simulator' || step === 'epoch_info' || step === 'build_instructions'}
      <!-- Hide skip on loading/transition states -->
    {:else}
      <button on:click={skipWizard} class="wizard-skip">
        Skip setup and configure later
      </button>
    {/if}
  </div>
</div>

<style>
  .wizard-code-block {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    padding: var(--s-3) var(--s-4);
    font-family: var(--font-mono);
    font-size: 16px;
    color: var(--accent-cyan);
    text-align: center;
    user-select: all;
    cursor: text;
  }
  
  .wizard-code-block code {
    background: none;
    padding: 0;
  }
</style>
