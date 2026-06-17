<script>
  import { onMount } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import FirstRunWizard from './lib/components/FirstRunWizard.svelte';
  import SplashScreen from './lib/components/SplashScreen.svelte';
  import WalletModal from './lib/components/WalletModal.svelte';
  import Toast from './lib/components/Toast.svelte';
  import Browser from './routes/Browser.svelte';
  import Studio from './routes/Studio.svelte';
  import Explorer from './routes/Explorer.svelte';
  import Wallet from './routes/Wallet.svelte';
  import Settings from './routes/Settings.svelte';
  // Mining tab removed - Developer Support now in Settings > Developer Support
  // Network tab removed - node controls moved to Settings > Node
  import { appState, walletState, settingsState, updateStatus, addExternalRequest, dismissWalletRequest, toast, loadSettings, syncNetworkMode, navigateTo, requestPayment } from './lib/stores/appState.js';
  import { GetSetting, RespondToXSWDRequest, RespondToXSWDRequestWithPermissions, NotifyWizardComplete, ConsumeLaunchURL } from '../wailsjs/go/main/App.js';
  import { EventsOn } from '../wailsjs/runtime/runtime.js';
  import { waitForWails } from './lib/utils/wails.js';
  
  // Module-level interval ID to prevent duplicates during HMR
  let statusPollingInterval = null;
  
  let currentTab = 'explorer'; // Default to explorer (landing page)
  let sidebarCollapsed = false;
  let showWizard = false;
  let wizardChecked = false;
  
  // Pending search result to pass to Explorer/Browser after navigation
  let pendingSearchResult = null;
  
  // Section navigation state for Settings
  let pendingSection = null;
  
  // Noise overlay element (texture generated once via canvas for WebKitGTK performance)
  let noiseOverlay;
  
  const tabs = [
    { id: 'explorer', label: 'Explorer', icon: 'search' },
    { id: 'browser', label: 'Browser', icon: 'globe' },
    { id: 'wallet', label: 'Wallet', icon: 'wallet' },
    { id: 'studio', label: 'Studio', icon: 'palette' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  function handleTabChange(tabId) {
    currentTab = tabId;
  }
  
  async function handleWizardComplete() {
    showWizard = false;
    // Notify the backend so it can start background services
    // (EPOCH, StatusBroadcaster, block monitoring, etc.)
    try {
      await NotifyWizardComplete();
    } catch (err) {
      console.error('Failed to notify backend of wizard completion:', err);
    }
  }

  // Generate static noise texture as a tiled background (runs once, no per-frame cost).
  // Replaces SVG feTurbulence which is expensive on Linux/WebKitGTK.
  function generateNoiseTexture() {
    if (!noiseOverlay) return;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i] = v;       // R
      data[i + 1] = v;   // G
      data[i + 2] = v;   // B
      data[i + 3] = 255; // A
    }
    ctx.putImageData(imageData, 0, 0);
    noiseOverlay.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
    noiseOverlay.style.backgroundRepeat = 'repeat';
    noiseOverlay.style.backgroundSize = `${size}px ${size}px`;
  }

  onMount(async () => {
    console.log('Hologram initializing...');
    
    // Generate noise texture once (replaces expensive SVG feTurbulence filter)
    generateNoiseTexture();
    
    // Fix for Wails/WebView scroll focus issue on macOS
    // When the app loses and regains focus, scroll events may not work until
    // the webview is explicitly focused. This handler restores scroll functionality.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to ensure window is fully focused
        setTimeout(() => {
          // Focus the document body to restore scroll event handling
          document.body.focus();
          // Also trigger a reflow to ensure scroll containers are responsive
          document.body.style.pointerEvents = 'none';
          requestAnimationFrame(() => {
            document.body.style.pointerEvents = '';
          });
        }, 50);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Also handle window focus events directly
    const handleWindowFocus = () => {
      // Ensure scroll containers are responsive after window regains focus
      setTimeout(() => {
        document.body.focus();
      }, 50);
    };
    window.addEventListener('focus', handleWindowFocus);

    // Prevent WebKit from navigating to dropped files (Linux #3686).
    // Only preventDefault — do not stopPropagation, so Wails drag listeners still run.
    const preventFileDropNavigation = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };
    for (const evtName of ['dragover', 'drop', 'dragleave', 'dragenter']) {
      window.addEventListener(evtName, preventFileDropNavigation, true);
    }
    
    // Minimum splash duration (allows animation to complete)
    const splashMinTime = new Promise(resolve => setTimeout(resolve, 3500));
    
    // Wait for Wails Go bindings to be available before any backend calls
    try {
      await waitForWails();
    } catch (err) {
      console.error('Wails runtime failed to initialize:', err);
    }
    
    // Load settings from backend on app startup
    await loadSettings();

    // Handle launch deep links (e.g. dero://example.tela or dero://deroi1...) captured by backend.
    // Payment URIs route to Wallet via the pendingPayment store; app URIs route to Browser as before.
    try {
      const launchURL = await ConsumeLaunchURL();
      if (launchURL && launchURL.toLowerCase().startsWith('dero://')) {
        const cleanURL = launchURL.slice(7);
        const lower = cleanURL.toLowerCase();
        const isPaymentURI = lower.startsWith('deroi1') || lower.startsWith('dero1') || lower.startsWith('detoi1') || lower.startsWith('deto1');
        if (isPaymentURI) {
          requestPayment(launchURL);
          currentTab = 'wallet';
          toast.info('Payment URI received — opening Wallet');
        } else {
          navigateTo(cleanURL);
          currentTab = 'browser';
        }
      }
    } catch (e) {
      console.error('Failed to consume launch URL:', e);
    }
    
    // Check if wizard has been completed
    try {
      const wizardComplete = await GetSetting('wizard_complete');
      showWizard = !wizardComplete || wizardComplete === 'false';
    } catch (e) {
      // First run - show wizard
      showWizard = true;
    }
    
    // Wait for minimum splash time before proceeding
    await splashMinTime;
    wizardChecked = true;
    
    // Initial status fetch and network sync (reconciles persisted "simulator" with actual mainnet connection on restart)
    updateStatus();
    syncNetworkMode();
    
    // Listen for status updates from backend (replaces polling)
    EventsOn("status:update", (status) => {
      // Update app state from broadcasted status
      if (status.node) {
        appState.update(state => ({
          ...state,
          nodeConnected: status.node.connected,
          chainHeight: status.node.chainHeight,
          topoHeight: status.node.topoHeight,
          hashrate: status.node.hashrate,
          difficulty: status.node.difficulty,
          txPoolSize: status.node.txPoolSize,
          peerCount: status.node.peerCount,
          nodeVersion: status.node.version,
          network: status.node.network,
        }));
      }
      if (status.xswd) {
        appState.update(state => ({
          ...state,
          xswdConnected: status.xswd.connected,
          xswdServerRunning: status.xswd.serverRunning || false,
          engramConnected: status.xswd.engramConnected || false,
        }));
      }
      if (status.gnomon) {
        appState.update(state => ({
          ...state,
          gnomonRunning: status.gnomon.running,
          gnomonIndexedHeight: status.gnomon.indexed_height,
          gnomonChainHeight: status.gnomon.chain_height,
          gnomonProgress: status.gnomon.progress,
          // Clear the one-time re-index flag once the index has caught up.
          gnomonReindexing: state.gnomonReindexing && status.gnomon.running && (status.gnomon.progress || 0) < 100,
        }));
      }
      if (status.wallet) {
        appState.update(state => ({
          ...state,
          walletOpen: status.wallet.open,
          walletAddress: status.wallet.address || '',
          walletBalance: status.wallet.balance || 0,
        }));
        walletState.update(state => ({
          ...state,
          isOpen: !!status.wallet.open,
          address: status.wallet.address || '',
          balance: status.wallet.balance || 0,
          lockedBalance: status.wallet.lockedBalance || 0,
          walletPath: status.wallet.open ? state.walletPath : '',
        }));
      }
    });
    
    // Fallback polling in case events don't fire (e.g., during reconnection)
    // Clear any existing interval first (prevents duplicates during HMR)
    if (statusPollingInterval) {
      clearInterval(statusPollingInterval);
    }
    statusPollingInterval = setInterval(updateStatus, 30000); // Reduced frequency as backup
    
    // Listen for tab switch events from child components
    const handleTabSwitch = (e) => {
      if (e.detail && tabs.find(t => t.id === e.detail)) {
        currentTab = e.detail;
      }
    };
    window.addEventListener('switch-tab', handleTabSwitch);
    
    // Global keyboard shortcuts
    const handleGlobalKeydown = (e) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Switch to explorer tab if not already there
        currentTab = 'explorer';
        // Dispatch event to focus the search input
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('focus-search'));
        }, 50);
      }
      
      // Cmd+1-7 / Ctrl+1-7 to switch tabs
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '7') {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabs[tabIndex]) {
          currentTab = tabs[tabIndex].id;
        }
      }
      
      // Escape to blur active input (handled by individual components)
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    
    // Listen for search navigation events (from Search landing page)
    const handleSearchNavigate = (e) => {
      const { tab, type, query, result } = e.detail;
      if (tab && tabs.find(t => t.id === tab)) {
        // Store the search result to pass to the target component
        pendingSearchResult = { type, query, result };
        currentTab = tab;
        
        // Dispatch event to the target component after a short delay
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('search-result', { detail: pendingSearchResult }));
          pendingSearchResult = null;
        }, 100);
      }
    };
    window.addEventListener('search-navigate', handleSearchNavigate);
    
    // Listen for status indicator clicks from Sidebar
    const handleStatusClick = (e) => {
      const { tab, section } = e.detail;
      if (tab && tabs.find(t => t.id === tab)) {
        currentTab = tab;
        if (section) {
          // Store section to pass to component
          pendingSection = section;
          // Dispatch event after component mounts
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('navigate-section', { detail: { section } }));
            pendingSection = null;
          }, 100);
        }
      }
    };
    window.addEventListener('status-click', handleStatusClick);

    // One-time re-index after a token-discovery filter change: flag it so the UI
    // shows "Updating token index…" instead of appearing to hang. Cleared in the
    // status:update gnomon block once the index catches up.
    EventsOn("gnomon:reindexing", () => {
      appState.update(state => ({ ...state, gnomonReindexing: true }));
      toast.info('Updating token index to detect more tokens — this runs once.');
    });

    // Listen for toast notifications from backend
    EventsOn("toast:show", (data) => {
      const type = data.type || 'info';
      const message = data.message || 'Notification';
      switch (type) {
        case 'success': toast.success(message); break;
        case 'warning': toast.warning(message); break;
        case 'error': toast.error(message); break;
        default: toast.info(message);
      }
    });
    
    // Listen for XSWD requests
    EventsOn("xswd:request", (req) => {
      console.log('Received XSWD request:', req);
      const requestType = req.type || (req.method ? 'sign' : 'connect');
      const appName = req.appName || 'External dApp';
      
      // Build payload for signing requests with comprehensive SC and transfer parsing
      let payload;
      if (requestType === 'connect') {
        payload = {
          appName: appName,
          description: req.description,
          origin: req.origin || 'XSWD',
        };
      } else {
        // Parse SC data from sc_rpc array
        const scRpc = req.params?.sc_rpc || req.params?.sc_data || [];
        
        // Extract entrypoint from sc_rpc if present
        let entrypoint = req.params?.entrypoint;
        if (!entrypoint && Array.isArray(scRpc)) {
          const entrypointArg = scRpc.find(arg => arg.name === 'entrypoint');
          if (entrypointArg) {
            entrypoint = entrypointArg.value;
          }
        }
        
        // Parse transfers - handle both array and single transfer formats
        let transfers = req.params?.transfers;
        
        // For scinvoke without explicit transfers, check if there's a DERO amount
        // being sent with the SC call (common pattern for SC interactions)
        if (!transfers && req.params?.scid) {
          // SC invoke without transfers - may still have implicit value
          transfers = [];
        }
        
        // Extract SC arguments (excluding entrypoint) for display
        let scArgs = [];
        if (Array.isArray(scRpc)) {
          scArgs = scRpc.filter(arg => arg.name !== 'entrypoint').map(arg => ({
            name: arg.name,
            type: arg.datatype,
            value: arg.value
          }));
        }
        
        payload = {
          method: req.method,
          transfers: transfers,
          sc_data: scRpc,
          sc_args: scArgs,
          scid: req.params?.scid,
          entrypoint: entrypoint,
          ringsize: req.params?.ringsize,
        };
      }

      // Show toast notification for incoming request
      const toastMessage = requestType === 'connect'
        ? `${appName} wants to connect`
        : `${appName} requests wallet action`;
      toast.info(toastMessage, 4000);

      addExternalRequest({
        id: req.id,
        type: requestType,
        payload,
        appName: appName,
        origin: req.origin || 'XSWD',
        // Include permission info for connect requests
        requestedPermissions: req.requestedPermissions,
        existingPermissions: req.existingPermissions,
        isReadOnly: req.isReadOnly || false
      }, 
      // On Approve
      (result) => {
        console.log('Approving XSWD request:', req.id, 'permissions:', result.permissions);
        // Use new function with permissions for connect requests
        if (requestType === 'connect' && result.permissions) {
          RespondToXSWDRequestWithPermissions(req.id, true, result.password || "", result.permissions);
        } else {
          RespondToXSWDRequest(req.id, true, result.password || "");
        }
        toast.success(`Request approved for ${appName}`, 3000);
      },
      // On Deny
      () => {
        console.log('Denying XSWD request:', req.id);
        RespondToXSWDRequest(req.id, false, "");
        toast.warning(`Request denied for ${appName}`, 3000);
      });
    });
    
    // Listen for request timeout (backend timed out waiting for user approval)
    EventsOn("xswd:request_timeout", (data) => {
      console.log('XSWD request timed out:', data.id);
      dismissWalletRequest(data.id, 'timed out');
      toast.warning('Transaction request timed out. The dApp can retry.', 5000);
    });
    
    // Listen for request cancellation (dApp disconnected while request was pending)
    EventsOn("xswd:request_cancelled", (data) => {
      console.log('XSWD request cancelled:', data.id, 'reason:', data.reason);
      dismissWalletRequest(data.id, data.reason || 'cancelled');
      toast.info('Transaction request cancelled — dApp disconnected.', 4000);
    });
    
    return () => {
      if (statusPollingInterval) {
        clearInterval(statusPollingInterval);
        statusPollingInterval = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('switch-tab', handleTabSwitch);
      window.removeEventListener('search-navigate', handleSearchNavigate);
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('status-click', handleStatusClick);
    };
  });
</script>

<!-- Splash Screen (shows while initializing) -->
<SplashScreen show={!wizardChecked} />

<!-- First Run Wizard -->
{#if wizardChecked && showWizard}
  <FirstRunWizard on:complete={handleWizardComplete} />
{/if}

<!-- Integrated Wallet Modal -->
<WalletModal />

<!-- Toast Notifications -->
<Toast />

<!-- v6.1 Noise Overlay (subtle film grain - canvas-generated for WebKitGTK performance) -->
<div bind:this={noiseOverlay} class="noise-overlay"></div>

<!-- SVG Definitions for gradients -->
<svg width="0" height="0" style="position: absolute;">
  <defs>
    <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color: #22d3ee; stop-opacity: 0.6" />
      <stop offset="100%" style="stop-color: #22d3ee; stop-opacity: 0" />
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color: #22d3ee" />
      <stop offset="100%" style="stop-color: #a78bfa" />
    </linearGradient>
  </defs>
</svg>

<div class="app-shell">
  <!-- Sidebar -->
  <Sidebar 
    {tabs} 
    {currentTab} 
    collapsed={sidebarCollapsed}
    on:tabChange={(e) => handleTabChange(e.detail)}
    on:toggleCollapse={() => sidebarCollapsed = !sidebarCollapsed}
    on:statusClick={(e) => {
      const event = new CustomEvent('status-click', { detail: e.detail });
      window.dispatchEvent(event);
    }}
  />

  <!-- Main Content Area -->
  <div class="app-main">
    <!-- Content -->
    <main class="app-content">
      {#key currentTab}
      {#if currentTab === 'browser'}
        <Browser />
      {:else if currentTab === 'wallet'}
        <Wallet />
      {:else if currentTab === 'explorer'}
        <Explorer />
      {:else if currentTab === 'studio'}
        <Studio />
      {:else if currentTab === 'settings'}
        <Settings initialSection={pendingSection || ''} />
      {/if}
      {/key}
    </main>
  </div>
</div>
