<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { walletState, settingsState, navigateTo, syncNetworkMode, toast } from '../lib/stores/appState.js';
  import StudioBatchUpload from '../lib/components/studio/StudioBatchUpload.svelte';
  import DiffViewer from '../lib/components/DiffViewer.svelte';
  import ModPickerModal from '../lib/components/ModPickerModal.svelte';
  import VersionHistory from '../lib/components/VersionHistory.svelte';
  import StudioDiff from '../lib/components/studio/StudioDiff.svelte';
  import StudioModules from '../lib/components/studio/StudioModules.svelte';
  import StudioLibraries from '../lib/components/studio/StudioLibraries.svelte';
  import StudioServe from '../lib/components/studio/StudioServe.svelte';
  import StudioClone from '../lib/components/studio/StudioClone.svelte';
  import StudioMyContent from '../lib/components/studio/StudioMyContent.svelte';
  import StudioUpdateIndex from '../lib/components/studio/StudioUpdateIndex.svelte';
  import StudioInstallIndex from '../lib/components/studio/StudioInstallIndex.svelte';
  import StudioInstallDoc from '../lib/components/studio/StudioInstallDoc.svelte';
  import StudioShards from '../lib/components/studio/StudioShards.svelte';
  import StudioActions from '../lib/components/studio/StudioActions.svelte';
  import StudioDeploySC from '../lib/components/studio/StudioDeploySC.svelte';
  import StudioAddSCID from '../lib/components/studio/StudioAddSCID.svelte';
  import { 
    SetSetting, GetGasEstimate, InstallDOC, InstallINDEX, GetINDEXInfo, UpdateINDEX, SelectFolder, SelectFile,
    IsInSimulatorMode, GetSimulatorDeploymentInfo, CloneTELA, GetClonePath,
    StartLocalDevServer, StopLocalDevServer, GetLocalDevServerStatus, RefreshLocalDevServer,
    StartSimulatorMode, StopSimulatorMode, GetSimulatorStatus, SetNetworkMode,
    ShardFile, ConstructFromShards, OpenURLInBrowserIfAllowed,
    ResolveDropPaths, LoadFilesFromPaths
  } from '../../wailsjs/go/main/App.js';
  import { ClipboardSetText } from '../../wailsjs/runtime/runtime.js';
  import { EventsOn, EventsOff, OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime.js';
  import { isDropPointInElement } from '../lib/utils/fileDrop.js';
  import { 
    Globe, FlaskConical, Gamepad2, FileText, FolderUp, FolderDown, Layers, RefreshCw, 
    Package, Copy, Server, GitCompare, AlertTriangle, X, Plus, Loader2, Lock, Eye, Square,
    Puzzle, Library, Palette, Zap, Database, Shield, Wrench, Search, ArrowRight, Check,
    Radio, Wallet, Diamond, ExternalLink, CheckCircle, Clipboard, FileArchive,
    Link, Lightbulb, ThumbsUp, ThumbsDown, Minus, GitBranch, History, RotateCcw,
    Scissors, FolderOpen, FileCode, Info
  } from 'lucide-svelte';
  import { GetMODsList, GetMODInfo, GetAllMODClasses, PrepareMODInstall, GetTELALibraries, EnsureGnomonRunning, SearchMyContent, SearchMyDOCs, SearchMyINDEXes, GetAvailableDOCTypes, GetCommitHistory, GetCommitContent, DiffCommits } from '../../wailsjs/go/main/App.js';
  
  // Diff viewer state
  let showDiffViewer = false;
  
  // Copy feedback state
  let copiedScid = null;
  
  let activeTab = 'install-doc';
  let stagedFiles = [];
  let deploymentStatus = null;
  let batchFolderPath = '';
  let batchDragging = false;
  let totalGasEstimate = 0;
  let gasLoading = false;
  
  // INDEX base cost estimate (approximately)
  const INDEX_BASE_GAS = 10000;
  
  // =====================================================
  // Install INDEX state (matching tela-cli install-index)
  // =====================================================
  let indexName = '';
  let indexDURL = '';
  let indexDescription = '';
  let indexIconURL = '';
  let indexDocScids = [];      // Array of DOC SCIDs to include
  let newIndexDocScid = '';    // Input for adding new DOC SCID
  let indexRingsize = 2;       // 2 = updateable, 16+ = immutable
  let indexInstalling = false;
  let indexInstallResult = null;
  let indexInstallError = '';
  
  // MODs state for Install INDEX (matching tela-cli modsPrompt)
  let indexEnableMods = false;        // Toggle to enable MODs
  let indexSelectedVsMod = '';        // Variable Store MOD (single selection)
  let indexSelectedTxMods = [];       // Transfer MODs (multi-selection)
  let showModPickerModal = false;     // Modal for advanced MOD selection
  // Note: Uses allMods and modsLoading from MODULES section below
  
  // =====================================================
  // Install DOC state (matching tela-cli install-doc)
  // =====================================================
  let docDURL = '';            // Optional dURL for the DOC
  let docDescription = '';     // Description header
  let docIconURL = '';         // Icon URL header
  let docRingsize = 2;         // 2 = updateable, 16+ = immutable
  let docCompression = false;  // Whether to compress the file
  
  // Confirmation modal state
  let showConfirmModal = false;
  let confirmModalType = '';   // 'doc' or 'index'
  let confirmModalData = null;
  let deployAcknowledged = false; // User must check acknowledgement box
  
  // Update INDEX state
  let updateIndexScid = '';
  let updateIndexLoading = false;
  let updateIndexInfo = null;
  let updateIndexError = '';
  let updateIndexDocs = [];
  let newDocScid = '';
  let updateInProgress = false;
  let updateResult = null;
  
  // Local Dev Server state
  let localServerRunning = false;
  let localServerUrl = '';
  let localServerDirectory = '';
  let localServerPort = 0;
  let localServerWatcherActive = false;
  let serveError = '';
  let serveLoading = false;
  let recentChanges = [];
  
  // =====================================================
  // Clone state
  // =====================================================
  let cloneScid = '';
  let cloneLoading = false;
  let cloneResult = null;
  let cloneError = '';
  let showCloneConfirmModal = false;  // For "content updated" confirmation
  
  // =====================================================
  // My Content state (matching tela-cli search my docs/indexes)
  // =====================================================
  let myContentLoading = false;
  let myContentError = '';
  let myContentGnomonRequired = false;  // True when Gnomon needs to be started
  let myDocs = [];
  let myIndexes = [];
  let myContentTab = 'all';  // 'all', 'docs', 'indexes'
  let myContentDocTypeFilter = '';  // Filter DOCs by type
  let availableDocTypes = [];
  let myContentLoaded = false;
  
  // =====================================================
  // Version History / Actions state (Git-like version control)
  // =====================================================
  let showVersionHistory = false;
  let versionHistoryScid = '';
  let actionsScid = '';           // SCID input for Actions page
  let actionsLoading = false;
  let actionsContentInfo = null;  // Info about the loaded content
  let actionsError = '';

  // =====================================================
  // DocShards state (inline - matching Clone/Serve pattern)
  // =====================================================
  let shardMode = 'shard';        // 'shard' or 'reconstruct'
  let shardFilePath = '';         // File to shard
  let shardFolderPath = '';       // Folder containing shards to reconstruct
  let shardCompress = true;       // Enable GZIP compression
  let shardLoading = false;
  let shardResult = null;
  let shardError = '';

  // =====================================================
  // Deploy SC state moved to StudioDeploySC.svelte
  let deploySCRef; // Reference to StudioDeploySC component for confirmation flow

  // Dropzone element references for native drag-and-drop (Wails OnFileDrop)
  let batchDropzoneElement;
  let docDropzoneElement;
  let shardDropzoneElement;
  let shardDragging = false;
  
  // Check local server status on mount
  onMount(async () => {
    await checkLocalServerStatus();
    
    // Listen for file change events (hot reload)
    EventsOn('localdev:reload', handleFileChange);
    
    // Native file drop (real filesystem paths). Register after DOM is ready — required on Linux.
    // useDropTarget=false: we hit-test ourselves (fixes DPI/coord mismatch with Wails filter).
    await tick();
    OnFileDrop(handleNativeFileDrop, false);
  });

  async function handleNativeFileDrop(x, y, paths) {
    if (!paths || paths.length === 0) {
      return;
    }

    batchDragging = false;
    shardDragging = false;

    // Install DOC — one or more files onto the drop zone
    if (activeTab === 'install-doc' && isDropPointInElement(x, y, docDropzoneElement)) {
      try {
        const result = await LoadFilesFromPaths(paths);
        if (result?.success && result.files?.length) {
          await handleFilesStaged({ detail: { files: result.files } });
        } else if (result?.error) {
          toast.error(result.error);
        }
      } catch (err) {
        console.error('[Studio] Install DOC drop failed:', err);
        toast.error('Could not load dropped files');
      }
      return;
    }

    // Batch Upload — folder or multi-file selection (e.g. Dolphin)
    if (activeTab === 'batch-upload' && !batchFolderPath && isDropPointInElement(x, y, batchDropzoneElement)) {
      try {
        const resolved = await ResolveDropPaths(paths);
        if (resolved?.success && resolved.folderPath) {
          batchFolderPath = resolved.folderPath;
        } else if (resolved?.error) {
          toast.error(resolved.error);
        }
      } catch (err) {
        console.error('[Studio] Batch drop failed:', err);
        toast.error('Could not use dropped folder');
      }
      return;
    }

    // DocShards — single file
    if (activeTab === 'shards' && shardMode === 'shard' && !shardFilePath && isDropPointInElement(x, y, shardDropzoneElement)) {
      try {
        const loaded = await LoadFilesFromPaths(paths);
        if (loaded?.success && loaded.files?.[0]?.path) {
          shardFilePath = loaded.files[0].path;
          shardError = '';
        } else if (loaded?.error) {
          toast.error(loaded.error);
        }
      } catch (err) {
        console.error('[Studio] Shard file drop failed:', err);
      }
      return;
    }

    // DocShards — reconstruct folder
    if (activeTab === 'shards' && shardMode === 'reconstruct' && !shardFolderPath && isDropPointInElement(x, y, shardDropzoneElement)) {
      try {
        const resolved = await ResolveDropPaths(paths);
        if (resolved?.success && resolved.folderPath) {
          shardFolderPath = resolved.folderPath;
          shardError = '';
        } else if (resolved?.error) {
          toast.error(resolved.error);
        }
      } catch (err) {
        console.error('[Studio] Shard folder drop failed:', err);
      }
    }
  }
  
  onDestroy(() => {
    EventsOff('localdev:reload');
    OnFileDropOff();
  });
  
  async function checkLocalServerStatus() {
    try {
      const status = await GetLocalDevServerStatus();
      localServerRunning = status.running || false;
      localServerUrl = status.url || '';
      localServerDirectory = status.directory || '';
      localServerPort = status.port || 0;
      localServerWatcherActive = status.watcherActive || false;
    } catch (e) {
      console.error('Failed to get local server status:', e);
      toast.error('Failed to check local server status');
    }
  }
  
  async function selectAndServeDirectory() {
    serveError = '';
    
    try {
      // First select the folder (don't show loading yet - dialog is blocking)
      const selected = await SelectFolder();
      if (!selected) {
        return; // User cancelled
      }
      
      // NOW show loading - we have a folder and are starting the server
      serveLoading = true;
      
      const result = await StartLocalDevServer(selected);
      
      if (result.success) {
        localServerRunning = true;
        localServerUrl = result.url;
        localServerDirectory = result.directory;
        localServerPort = result.port;
        localServerWatcherActive = true;
        recentChanges = [];
      } else {
        serveError = result.error || 'Failed to start server';
      }
    } catch (e) {
      serveError = e.message || 'Failed to start server';
    } finally {
      serveLoading = false;
    }
  }
  
  async function stopLocalServer() {
    try {
      await StopLocalDevServer();
      localServerRunning = false;
      localServerUrl = '';
      localServerDirectory = '';
      localServerPort = 0;
      localServerWatcherActive = false;
      recentChanges = [];
    } catch (e) {
      console.error('Failed to stop server:', e);
    }
  }
  
  function openInBrowser() {
    if (localServerUrl && localServerDirectory) {
      // Set pending navigation with the local URL
      navigateTo(`local://${localServerDirectory}`);
      // Switch to Browser tab
      window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
    }
  }
  
  async function triggerManualRefresh() {
    try {
      await RefreshLocalDevServer();
    } catch (e) {
      console.error('Failed to trigger refresh:', e);
    }
  }
  
  // =====================================================
  // Clone Functions
  // =====================================================
  
  async function cloneContent(allowUpdates = false) {
    if (!cloneScid || cloneScid.trim() === '') {
      cloneError = 'Please enter an SCID';
      return;
    }
    
    cloneLoading = true;
    cloneError = '';
    cloneResult = null;
    showCloneConfirmModal = false;
    
    try {
      const result = await CloneTELA(cloneScid.trim(), allowUpdates);
      
      if (result.success) {
        cloneResult = result;
        cloneError = '';
      } else if (result.requiresConfirm) {
        // Content has been updated - show confirmation modal
        showCloneConfirmModal = true;
        cloneError = '';
      } else {
        cloneError = result.error || 'Clone failed';
      }
    } catch (e) {
      cloneError = e.message || 'Failed to clone content';
    } finally {
      cloneLoading = false;
    }
  }
  
  function confirmCloneUpdate() {
    showCloneConfirmModal = false;
    cloneContent(true);  // Clone with allowUpdates = true
  }
  
  function cancelCloneUpdate() {
    showCloneConfirmModal = false;
  }
  
  function resetClone() {
    cloneScid = '';
    cloneResult = null;
    cloneError = '';
    showCloneConfirmModal = false;
  }
  
  function copyClonePath() {
    if (cloneResult?.directory) {
      ClipboardSetText(cloneResult.directory);
    }
  }
  
  async function openCloneFolder() {
    if (cloneResult?.directory) {
      try {
        await OpenURLInBrowserIfAllowed(`file://${cloneResult.directory}`);
      } catch (e) {
        console.error('Failed to open folder:', e);
      }
    }
  }
  
  function serveClonedContent() {
    if (cloneResult?.directory) {
      // Navigate to Serve tab and start serving the cloned content
      // For now, just switch to serve tab - user can select the folder
      activeTab = 'serve';
    }
  }

  // =====================================================
  // DocShards Functions (matching Clone/Serve inline pattern)
  // =====================================================
  
  async function selectShardFile() {
    try {
      const path = await SelectFile();
      if (path) {
        shardFilePath = path;
        shardError = '';
      }
    } catch (e) {
      console.error('File selection error:', e);
      shardError = 'Failed to select file';
    }
  }
  
  async function selectShardFolder() {
    try {
      const path = await SelectFolder();
      if (path) {
        shardFolderPath = path;
        shardError = '';
      }
    } catch (e) {
      console.error('Folder selection error:', e);
      shardError = 'Failed to select folder';
    }
  }
  
  async function performShard() {
    if (!shardFilePath) {
      toast.warning('Please select a file to shard');
      return;
    }
    
    shardLoading = true;
    shardResult = null;
    shardError = '';
    
    try {
      const res = await ShardFile(shardFilePath, shardCompress);
      if (res.success) {
        shardResult = { ...res, mode: 'shard' };
        toast.success(`File sharded into ${res.shardCount} parts`);
      } else {
        shardError = res.error || 'Sharding failed';
        toast.error(shardError);
      }
    } catch (e) {
      shardError = e.message || 'Sharding failed';
      toast.error(shardError);
    } finally {
      shardLoading = false;
    }
  }
  
  async function performReconstruct() {
    if (!shardFolderPath) {
      toast.warning('Please select a folder containing shard files');
      return;
    }
    
    shardLoading = true;
    shardResult = null;
    shardError = '';
    
    try {
      const res = await ConstructFromShards(shardFolderPath);
      if (res.success) {
        shardResult = { ...res, mode: 'reconstruct' };
        toast.success('File reconstructed successfully');
      } else {
        shardError = res.error || 'Reconstruction failed';
        toast.error(shardError);
      }
    } catch (e) {
      shardError = e.message || 'Reconstruction failed';
      toast.error(shardError);
    } finally {
      shardLoading = false;
    }
  }
  
  function resetShard() {
    shardFilePath = '';
    shardFolderPath = '';
    shardResult = null;
    shardError = '';
  }
  
  function formatShardBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // =====================================================
  // Deploy SC functions moved to StudioDeploySC.svelte

  // =====================================================
  // My Content Functions (matching tela-cli search my docs/indexes)
  // =====================================================
  
  async function loadMyContent() {
    if (myContentLoading) return;
    
    myContentLoading = true;
    myContentError = '';
    myContentGnomonRequired = false;
    
    try {
      const result = await SearchMyContent();
      
      if (result.success) {
        myDocs = result.docs || [];
        myIndexes = result.indexes || [];
        
        // Also load available doc types for filtering
        const typesResult = await GetAvailableDOCTypes();
        if (typesResult.success) {
          availableDocTypes = typesResult.types || [];
        }
      } else {
        // Check if the error is about Gnomon not running
        const errorMsg = result.error || 'Failed to load content';
        if (errorMsg.toLowerCase().includes('gnomon')) {
          myContentGnomonRequired = true;
        }
        myContentError = errorMsg;
      }
    } catch (e) {
      myContentError = e.message || 'Failed to load content';
    } finally {
      myContentLoading = false;
      // IMPORTANT: Always mark as loaded to prevent infinite loop
      // The error state will be shown instead of retrying automatically
      myContentLoaded = true;
    }
  }
  
  async function loadMyDOCs() {
    myContentLoading = true;
    myContentError = '';
    
    try {
      const result = await SearchMyDOCs(myContentDocTypeFilter);
      
      if (result.success) {
        myDocs = result.results || [];
      } else {
        myContentError = result.error || 'Failed to load DOCs';
      }
    } catch (e) {
      myContentError = e.message || 'Failed to load DOCs';
    } finally {
      myContentLoading = false;
    }
  }
  
  async function loadMyINDEXes() {
    myContentLoading = true;
    myContentError = '';
    
    try {
      const result = await SearchMyINDEXes();
      
      if (result.success) {
        myIndexes = result.results || [];
      } else {
        myContentError = result.error || 'Failed to load INDEXes';
      }
    } catch (e) {
      myContentError = e.message || 'Failed to load INDEXes';
    } finally {
      myContentLoading = false;
    }
  }
  
  function refreshMyContent() {
    myContentLoaded = false;
    myContentError = '';
    myContentGnomonRequired = false;
    loadMyContent();
  }
  
  function copyMyContentScid(scid) {
    ClipboardSetText(scid);
    copiedScid = scid;
    setTimeout(() => { copiedScid = null; }, 2000);
  }
  
  function viewMyContentInBrowser(scid) {
    navigateTo(scid);
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
  }
  
  function updateMyContent(scid) {
    updateIndexScid = scid;
    activeTab = 'update-index';
  }
  
  // =====================================================
  // Actions / Version History Functions
  // =====================================================
  
  async function loadActionsContent() {
    if (!actionsScid || actionsScid.length !== 64) {
      actionsError = 'Please enter a valid 64-character SCID';
      return;
    }
    
    actionsLoading = true;
    actionsError = '';
    actionsContentInfo = null;
    
    try {
      // Try to get INDEX info first
      const indexResult = await GetINDEXInfo(actionsScid);
      if (indexResult.success) {
        actionsContentInfo = {
          type: 'INDEX',
          scid: actionsScid,
          name: indexResult.name || 'Unnamed INDEX',
          durl: indexResult.durl || '',
          description: indexResult.description || '',
          docCount: indexResult.docs?.length || 0,
        };
      } else {
        // Fallback - it might be a DOC or other SC
        actionsContentInfo = {
          type: 'Unknown',
          scid: actionsScid,
          name: 'Smart Contract',
          description: 'Unable to determine content type',
        };
      }
    } catch (e) {
      actionsError = e.message || 'Failed to load content info';
    } finally {
      actionsLoading = false;
    }
  }
  
  function openVersionHistory(scid) {
    versionHistoryScid = scid || actionsScid;
    showVersionHistory = true;
  }
  
  function closeVersionHistory() {
    showVersionHistory = false;
  }
  
  async function handleVersionRevert(event) {
    const commit = event.detail;
    // Clone at that specific version, then prompt to update
    const cloneScidAtVersion = `${versionHistoryScid}@${commit.txid || commit.height}`;
    cloneScid = cloneScidAtVersion;
    activeTab = 'clone';
    showVersionHistory = false;
  }
  
  async function handleVersionClone(event) {
    const commit = event.detail;
    if (commit.txid) {
      cloneScid = `${versionHistoryScid}@${commit.txid}`;
    } else if (commit.height) {
      // CloneAtCommit requires a TXID, but this commit only has a block height.
      // Fall back to cloning the latest version and notify the user.
      cloneScid = versionHistoryScid;
      toast.warning('TXID unavailable for this commit -- cloning latest version instead');
    }
    activeTab = 'clone';
    showVersionHistory = false;
  }
  
  function viewVersionHistoryFromMyContent(scid) {
    actionsScid = scid;
    versionHistoryScid = scid;
    showVersionHistory = true;
  }
  
  // Track previous wallet address to detect actual changes
  let previousWalletAddress = '';
  
  // Auto-load My Content when switching to the tab
  $: if (activeTab === 'my-content' && !myContentLoaded && !myContentLoading && $walletState.isOpen) {
    loadMyContent();
  }
  
  // Reload when wallet address ACTUALLY changes (not just any wallet state update)
  $: if ($walletState.address && $walletState.address !== previousWalletAddress) {
    previousWalletAddress = $walletState.address;
    myContentLoaded = false;
    if (activeTab === 'my-content') {
      loadMyContent();
    }
  }
  
  function handleFileChange(data) {
    const fileName = data.file || 'unknown';
    const time = new Date().toLocaleTimeString();
    
    recentChanges = [
      { file: fileName, time },
      ...recentChanges.slice(0, 9) // Keep last 10
    ];
  }
  
  function formatDirectory(dir) {
    if (!dir) return '';
    // Show just the last 2 parts of the path
    const parts = dir.split('/').filter(Boolean);
    if (parts.length <= 2) return dir;
    return '.../' + parts.slice(-2).join('/');
  }
  
  // Network state - reactive to settings store
  $: currentNetwork = $settingsState.network || 'mainnet';
  $: currentNetConfig = getNetworkConfig(currentNetwork);
  $: isSimulator = currentNetwork === 'simulator';
  
  const networks = [
    { 
      id: 'mainnet', 
      label: 'Mainnet', 
      icon: 'globe', 
      status: 'err',
      warning: 'Permanent • Costs DERO',
      description: 'Live blockchain - transactions are irreversible'
    },
    { 
      id: 'simulator', 
      label: 'Simulator', 
      icon: 'gamepad', 
      status: 'ok',
      warning: 'Safe Testing',
      description: 'Local simulation - perfect for testing'
    },
  ];
  
  function getNetworkConfig(id) {
    return networks.find(n => n.id === id) || networks[0];
  }
  
  // Simulator modal state
  let showSimModal = false;
  let simModalAction = null; // 'start' or 'stop'
  let simIsRunning = false;
  let simIsLoading = false;
  
  // Check simulator status on mount
  onMount(async () => {
    try {
      const status = await GetSimulatorStatus();
      simIsRunning = status?.isInitialized || false;
    } catch (e) {
      simIsRunning = false;
    }
  });
  
  async function switchNetwork(networkId) {
    // Special handling for simulator mode
    if (networkId === 'simulator') {
      if (!simIsRunning) {
        // Show confirmation modal to start simulator
        simModalAction = 'start';
        showSimModal = true;
        return;
      }
    } else if (currentNetwork === 'simulator' && simIsRunning) {
      // Switching away from running simulator - ask to stop
      simModalAction = 'stop';
      showSimModal = true;
      return;
    }
    
    // For non-simulator switches, just update the network mode
    try {
      const result = await SetNetworkMode(networkId);
      if (result.success) {
        await syncNetworkMode();
      } else {
        console.error('Failed to switch network:', result.error);
      }
    } catch (err) {
      console.error('Failed to switch network:', err);
    }
  }
  
  function cancelSimModal() {
    showSimModal = false;
    simModalAction = null;
  }
  
  async function confirmSimModal() {
    showSimModal = false;
    simIsLoading = true;
    
    try {
      if (simModalAction === 'start') {
        const result = await StartSimulatorMode();
        if (result.success) {
          simIsRunning = true;
          await syncNetworkMode();
        } else {
          console.error('Failed to start simulator:', result.error);
          toast.error('Failed to start simulator: ' + result.error);
        }
      } else if (simModalAction === 'stop') {
        await StopSimulatorMode();
        simIsRunning = false;
        // Switch to mainnet after stopping
        const result = await SetNetworkMode('mainnet');
        if (result.success) {
          await syncNetworkMode();
        }
      }
    } catch (e) {
      console.error('Simulator action failed:', e);
      toast.error('Simulator action failed: ' + e.message);
    }
    
    simIsLoading = false;
    simModalAction = null;
  }
  
  const tabs = [
    { id: 'install-doc', label: 'Install DOC', icon: 'file' },
    { id: 'batch-upload', label: 'Batch Upload', icon: 'folder' },
    { id: 'install-index', label: 'Install INDEX', icon: 'layers' },
    { id: 'update-index', label: 'Update INDEX', icon: 'refresh' },
    { id: 'deploy-sc', label: 'Deploy SC', icon: 'code' },
    { id: 'my-content', label: 'My Content', icon: 'package' },
    { id: 'actions', label: 'Version Control', icon: 'git' },
    { id: 'clone', label: 'Clone', icon: 'copy' },
    { id: 'serve', label: 'Serve', icon: 'server' },
    { id: 'diff', label: 'Diff', icon: 'diff' },
    { id: 'shards', label: 'DocShards', icon: 'file' },
    { id: 'add-scid', label: 'Add SCID', icon: 'package' },
  ];
  
  // MODULES section tabs
  const moduleTabs = [
    { id: 'modules', label: 'Modules', icon: 'puzzle' },
    { id: 'libraries', label: 'Libraries', icon: 'library' },
  ];
  
  // MODs state
  let modsLoading = false;
  let allMods = [];
  let filteredMods = [];
  let modClasses = [];
  let selectedModClass = 'all';
  let modSearchQuery = '';
  let modsError = null;
  let selectedMod = null;
  let modDetails = null;
  let loadingModDetails = false;
  let showModInstallWizard = false;
  let modInstallScid = '';
  let modInstallLoading = false;
  let modInstallResult = null;
  let modInstallError = null;
  
  // Map class names to icons
  const modClassIconMap = {
    'vs': Palette,
    'tx': Zap,
    'storage': Database,
    'auth': Shield,
  };
  
  function getModClassIcon(className) {
    return modClassIconMap[className?.toLowerCase()] || Wrench;
  }
  
  // Libraries state
  let librariesLoading = false;
  let librariesLoadingStatus = ''; // Shows current loading step
  let libraries = [];
  let librariesError = null;
  let librarySearchQuery = '';
  let selectedLibrary = null;
  let gnomonRequired = false; // Tracks if Gnomon needs to be started
  let librariesLoaded = false; // Prevents re-fetching on tab switch
  
  // Load Libraries data
  async function loadLibrariesData(forceRefresh = false) {
    if (librariesLoading) return; // Prevent double-loading
    
    librariesLoading = true;
    librariesError = null;
    librariesLoadingStatus = 'Checking Gnomon indexer...';
    gnomonRequired = false;
    
    try {
      // Check/start Gnomon with timeout
      const gnomonResult = await Promise.race([
        EnsureGnomonRunning(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gnomon startup timed out')), 30000))
      ]);
      
      if (!gnomonResult.success && !gnomonResult.alreadyRunning) {
        gnomonRequired = true;
        librariesError = 'Gnomon indexer is required to browse libraries. Enable it in Settings → Gnomon.';
        librariesLoading = false;
        return;
      }
      
      librariesLoadingStatus = 'Fetching libraries from network...';
      
      // Fetch libraries with timeout
      const result = await Promise.race([
        GetTELALibraries(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 15000))
      ]);
      
      if (result.success) {
        libraries = result.libraries || [];
        librariesLoaded = true;
      } else {
        librariesError = result.error || 'Failed to load libraries';
      }
    } catch (e) {
      console.error('Libraries load error:', e);
      librariesError = e.message || 'An error occurred while loading libraries';
    } finally {
      librariesLoading = false;
      librariesLoadingStatus = '';
    }
  }
  
  // Filter libraries by search
  $: filteredLibraries = libraries.filter(lib => {
    if (!librarySearchQuery.trim()) return true;
    const query = librarySearchQuery.toLowerCase();
    return (lib.name?.toLowerCase().includes(query)) ||
           (lib.durl?.toLowerCase().includes(query)) ||
           (lib.description?.toLowerCase().includes(query));
  });
  
  // Load libraries when switching to libraries tab (only first time)
  $: if (activeTab === 'libraries' && !librariesLoaded && !librariesLoading && !librariesError) {
    loadLibrariesData();
  }
  
  function openLibraryDetails(lib) {
    selectedLibrary = lib;
  }
  
  function closeLibraryDetails() {
    selectedLibrary = null;
  }
  
  function copyLibraryScid() {
    if (selectedLibrary?.scid) {
      ClipboardSetText(selectedLibrary.scid);
      // Visual feedback
      copiedScid = selectedLibrary.scid;
      setTimeout(() => { copiedScid = null; }, 2000);
    }
  }
  
  async function cloneLibrary() {
    if (!selectedLibrary?.scid) return;
    try {
      const result = await CloneTELA(selectedLibrary.scid, false);
      if (result.success) {
        toast.success(`Library cloned to: ${result.directory}`);
      } else {
        toast.error(`Clone failed: ${result.error}`);
      }
    } catch (e) {
      toast.error(`Clone error: ${e.message}`);
    }
  }
  
  function previewLibrary() {
    if (selectedLibrary?.scid) {
      navigateTo(`tela://${selectedLibrary.durl || selectedLibrary.scid}`);
      window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
      closeLibraryDetails();
    }
  }
  
  // Embed library into Install INDEX (adds SCID to DOC references)
  function embedLibraryInIndex() {
    if (!selectedLibrary?.scid) return;
    
    // Check if already added
    if (indexDocScids.includes(selectedLibrary.scid)) {
      toast.info(`Library already added to INDEX`);
      return;
    }
    
    // Add to DOC references
    indexDocScids = [...indexDocScids, selectedLibrary.scid];
    closeLibraryDetails();
    
    // Switch to Install INDEX tab
    activeTab = 'install-index';
    toast.success(`Added ${selectedLibrary.durl || 'library'} to DOC references`);
  }
  
  // Navigate to Settings > Gnomon section to enable Gnomon
  function goToSettings() {
    window.dispatchEvent(new CustomEvent('status-click', { detail: { tab: 'settings', section: 'gnomon' } }));
  }
  
  // Load MODs data
  async function loadModsData() {
    modsLoading = true;
    modsError = null;
    
    try {
      const modsResult = await GetMODsList();
      if (modsResult.success) {
        allMods = modsResult.mods || [];
        filteredMods = [...allMods];
      } else {
        modsError = modsResult.error || 'Failed to load Modules';
      }
      
      const classesResult = await GetAllMODClasses();
      if (classesResult.success) {
        modClasses = classesResult.classes || [];
      }
    } catch (e) {
      modsError = e.message || 'An error occurred';
    } finally {
      modsLoading = false;
    }
  }
  
  function filterMods() {
    let result = [...allMods];
    
    if (selectedModClass !== 'all') {
      result = result.filter(m => m.class === selectedModClass);
    }
    
    if (modSearchQuery.trim()) {
      const query = modSearchQuery.toLowerCase();
      result = result.filter(m => 
        m.name.toLowerCase().includes(query) ||
        m.tag.toLowerCase().includes(query) ||
        m.description?.toLowerCase().includes(query)
      );
    }
    
    filteredMods = result;
  }
  
  $: if (selectedModClass || modSearchQuery !== undefined) {
    filterMods();
  }
  
  async function openModDetails(mod) {
    selectedMod = mod;
    modDetails = null;
    loadingModDetails = true;
    
    try {
      const result = await GetMODInfo(mod.tag);
      if (result.success) {
        modDetails = result;
      }
    } catch (e) {
      console.error('Failed to load MOD details:', e);
    } finally {
      loadingModDetails = false;
    }
  }
  
  function closeModDetails() {
    selectedMod = null;
    modDetails = null;
  }
  
  function openModInstallWizard() {
    showModInstallWizard = true;
    modInstallScid = '';
    modInstallResult = null;
    modInstallError = null;
  }
  
  function closeModInstallWizard() {
    showModInstallWizard = false;
    modInstallScid = '';
    modInstallResult = null;
    modInstallError = null;
  }
  
  async function prepareModInstall() {
    if (!selectedMod || !modInstallScid || modInstallScid.length < 64) {
      modInstallError = 'Please enter a valid 64-character SCID';
      return;
    }
    
    modInstallLoading = true;
    modInstallError = null;
    modInstallResult = null;
    
    try {
      const result = await PrepareMODInstall(modInstallScid, selectedMod.tag);
      if (result.success) {
        modInstallResult = result;
      } else {
        modInstallError = result.error || 'Failed to prepare installation';
      }
    } catch (e) {
      modInstallError = e.message || 'An error occurred';
    } finally {
      modInstallLoading = false;
    }
  }
  
  function copyModCode(text, label = 'Code') {
    navigator.clipboard.writeText(text);
    // Could add toast here
  }
  
  // Load MODs when switching to modules tab
  $: if (activeTab === 'modules' && allMods.length === 0 && !modsLoading) {
    loadModsData();
  }
  
  async function handleFilesStaged(event) {
    // Initialize telaDocType for each file based on extension/MIME type
    stagedFiles = event.detail.files.map(file => ({
      ...file,
      telaDocType: file.telaDocType || getTelaDocType(file.name, file.type)
    }));
    await calculateTotalGas();
  }
  
  async function removeFile(index) {
    stagedFiles = stagedFiles.filter((_, i) => i !== index);
    await calculateTotalGas();
  }
  
  async function calculateTotalGas() {
    if (stagedFiles.length === 0) {
      totalGasEstimate = 0;
      return;
    }
    
    gasLoading = true;
    let total = 0;
    
    try {
      for (const file of stagedFiles) {
        // Use backend gas estimate
        const docInfo = JSON.stringify({
          size: file.size,
          path: file.path || '',
        });
        const result = await GetGasEstimate(docInfo);
        if (result.success) {
          total += result.gasEstimate;
        } else {
          // Fallback: simple estimation
          total += 5000 + (file.size * 10);
        }
      }
    } catch (e) {
      // Fallback: simple estimation
      total = stagedFiles.reduce((sum, f) => sum + 5000 + (f.size * 10), 0);
    }
    
    totalGasEstimate = total;
    gasLoading = false;
  }
  
  function formatGas(gas) {
    if (gas >= 1000000) {
      return (gas / 1000000).toFixed(2) + 'M';
    } else if (gas >= 1000) {
      return (gas / 1000).toFixed(1) + 'K';
    }
    return gas.toLocaleString();
  }
  
  function gasToDero(gas) {
    // Rough conversion: gas cost varies, but roughly 1 DERO = 10000 gas in storage
    // This is an estimate - actual costs depend on network conditions
    return (gas / 100000).toFixed(5);
  }
  
  // Check if any staged files can benefit from compression (text-based types)
  // Matches tela-cli's canCompress logic
  function canCompressFiles(files) {
    const compressibleTypes = [
      'text/html', 'text/css', 'text/javascript', 'application/javascript',
      'application/json', 'text/markdown', 'text/x-go', 'text/plain'
    ];
    const compressibleExtensions = ['.html', '.htm', '.css', '.js', '.json', '.md', '.go', '.txt'];
    
    return files.some(file => {
      const ext = file.name?.toLowerCase().split('.').pop();
      const type = file.type?.toLowerCase() || '';
      
      // Skip already compressed files
      if (file.name?.endsWith('.gz')) return false;
      
      return compressibleTypes.some(t => type.includes(t)) ||
             compressibleExtensions.some(e => `.${ext}` === e);
    });
  }
  
  // Update INDEX state - additional vars
  let updateIndexName = '';
  let updateIndexDescription = '';
  let updateIndexIcon = '';
  let updateIsSimulator = false;
  let showUpdateConfirmModal = false;
  
  // Update INDEX functions
  async function loadIndexInfo() {
    if (!updateIndexScid || updateIndexScid.length < 64) {
      updateIndexError = 'Please enter a valid 64-character SCID';
      return;
    }
    
    updateIndexLoading = true;
    updateIndexError = '';
    updateIndexInfo = null;
    updateResult = null;
    
    try {
      // Check if in simulator mode
      updateIsSimulator = await IsInSimulatorMode();
      
      const result = await GetINDEXInfo(updateIndexScid);
      if (result.success) {
        updateIndexInfo = result;
        updateIndexDocs = [...(result.docs || [])];
        // Initialize editable fields with current values
        updateIndexName = result.name || '';
        updateIndexDescription = result.description || '';
        updateIndexIcon = result.icon || '';
        
        // Check if INDEX can be updated
        if (!result.canUpdate) {
          updateIndexError = 'This INDEX is immutable (deployed with Ring 16+) and cannot be updated.';
        } else if (!result.isOwner && !updateIsSimulator) {
          updateIndexError = 'Your wallet is not the owner of this INDEX.';
        }
      } else {
        updateIndexError = result.error || 'Failed to load INDEX info';
      }
    } catch (e) {
      updateIndexError = e.message || 'Failed to load INDEX info';
    } finally {
      updateIndexLoading = false;
    }
  }
  
  function addDocToIndex() {
    if (!newDocScid || newDocScid.length < 64) {
      return;
    }
    if (!updateIndexDocs.includes(newDocScid)) {
      updateIndexDocs = [...updateIndexDocs, newDocScid];
    }
    newDocScid = '';
  }
  
  function removeDocFromIndex(scid) {
    updateIndexDocs = updateIndexDocs.filter(d => d !== scid);
  }
  
  function prepareIndexUpdate() {
    // In simulator mode, skip confirmation
    if (updateIsSimulator) {
      submitIndexUpdate();
    } else {
      showUpdateConfirmModal = true;
    }
  }
  
  function cancelUpdateConfirm() {
    showUpdateConfirmModal = false;
  }
  
  async function submitIndexUpdate() {
    showUpdateConfirmModal = false;
    
    // In simulator mode, wallet may not be needed (uses sim wallet)
    if (!updateIndexInfo) return;
    if (!updateIsSimulator && !$walletState.isOpen) {
      updateResult = { type: 'error', message: 'Please connect your wallet' };
      return;
    }
    
    updateInProgress = true;
    updateResult = null;
    
    try {
      const indexData = JSON.stringify({
        name: updateIndexName,
        description: updateIndexDescription,
        durl: updateIndexInfo.durl,  // dURL cannot be changed
        iconUrl: updateIndexIcon,
        docScids: updateIndexDocs,
      });
      
      const result = await UpdateINDEX(updateIndexScid, indexData);
      if (result.success) {
        updateResult = { 
          type: 'success', 
          message: 'INDEX updated successfully!',
          txid: result.txid
        };
      } else {
        updateResult = { type: 'error', message: result.error || 'Update failed' };
      }
    } catch (e) {
      updateResult = { type: 'error', message: e.message || 'Update failed' };
    } finally {
      updateInProgress = false;
    }
  }
  
  function resetUpdateIndex() {
    updateIndexScid = '';
    updateIndexInfo = null;
    updateIndexDocs = [];
    updateIndexError = '';
    updateResult = null;
    updateIndexName = '';
    updateIndexDescription = '';
    updateIndexIcon = '';
    showUpdateConfirmModal = false;
  }
  
  function isOwner() {
    // Use the backend's isOwner check
    return updateIndexInfo?.isOwner || false;
  }
  
  function canUpdateIndex() {
    return updateIndexInfo?.canUpdate && (updateIndexInfo?.isOwner || updateIsSimulator);
  }
  
  function getDocTypeIcon(docType) {
    const icons = {
      'text/html': 'file-code',
      'text/css': 'palette',
      'application/javascript': 'code',
      'image/svg+xml': 'image',
      'image/png': 'image',
      'image/jpeg': 'image',
      'application/json': 'braces',
    };
    return icons[docType] || 'file';
  }
  
  // Convert browser MIME type or file extension to TELA doc type
  // TELA requires specific types like TELA-JS-1, TELA-CSS-1, etc.
  function getTelaDocType(fileName, mimeType) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    
    // Map by extension (most reliable)
    const extMap = {
      'html': 'TELA-HTML-1',
      'htm': 'TELA-HTML-1',
      'css': 'TELA-CSS-1',
      'js': 'TELA-JS-1',
      'mjs': 'TELA-JS-1',
      'json': 'TELA-JSON-1',
      'md': 'TELA-MD-1',
      'markdown': 'TELA-MD-1',
      'go': 'TELA-GO-1',
      // Static files (images, fonts, etc.)
      'svg': 'TELA-STATIC-1',
      'png': 'TELA-STATIC-1',
      'jpg': 'TELA-STATIC-1',
      'jpeg': 'TELA-STATIC-1',
      'gif': 'TELA-STATIC-1',
      'webp': 'TELA-STATIC-1',
      'ico': 'TELA-STATIC-1',
      'woff': 'TELA-STATIC-1',
      'woff2': 'TELA-STATIC-1',
      'ttf': 'TELA-STATIC-1',
      'eot': 'TELA-STATIC-1',
    };
    
    if (extMap[ext]) {
      return extMap[ext];
    }
    
    // Fallback: map by MIME type
    const mimeMap = {
      'text/html': 'TELA-HTML-1',
      'text/css': 'TELA-CSS-1',
      'application/javascript': 'TELA-JS-1',
      'application/x-javascript': 'TELA-JS-1',
      'text/javascript': 'TELA-JS-1',
      'application/json': 'TELA-JSON-1',
      'text/markdown': 'TELA-MD-1',
      'image/svg+xml': 'TELA-STATIC-1',
      'image/png': 'TELA-STATIC-1',
      'image/jpeg': 'TELA-STATIC-1',
      'image/gif': 'TELA-STATIC-1',
      'image/webp': 'TELA-STATIC-1',
    };
    
    return mimeMap[mimeType] || 'TELA-STATIC-1'; // Default to static for unknown types
  }
  
  async function deployBatch() {
    // Allow deployment if wallet is open OR if in simulator mode (uses simulator wallet)
    if (!$walletState.isOpen && !isSimulator) {
      deploymentStatus = { type: 'error', message: 'Please open a wallet first' };
      return;
    }
    
    if (stagedFiles.length === 0) {
      deploymentStatus = { type: 'error', message: 'No files staged for deployment' };
      return;
    }
    
    deploymentStatus = { type: 'info', message: `Deploying ${stagedFiles.length} DOC${stagedFiles.length > 1 ? 's' : ''}...` };
    
    try {
      const results = [];
      for (const stagedFile of stagedFiles) {
        // Read file contents - either from browser File object or from backend data
        let fileContent = '';
        if (stagedFile.data) {
          // Data already provided (from Wails native file picker)
          fileContent = stagedFile.data;
        } else if (stagedFile.file) {
          // Read from browser File object (drag & drop)
          fileContent = await readFileAsText(stagedFile.file);
        }
        
        const docInfo = {
          name: stagedFile.name,
          path: '', // Don't use path - we're sending data directly
          subDir: stagedFile.subDir || '/',
          docType: stagedFile.telaDocType || getTelaDocType(stagedFile.name, stagedFile.type), // Use user-selected type or auto-detect
          size: stagedFile.size,
          description: docDescription || '',  // From metadata fields
          iconUrl: docIconURL || '',          // From metadata fields
          ringsize: docRingsize,              // 2 = updateable, 16+ = immutable
          compressed: docCompression,         // Enable gzip compression (tela-cli parity)
          data: fileContent // Send the actual file content
        };
        
        const result = await InstallDOC(JSON.stringify(docInfo));
        results.push({ file: stagedFile.name, ...result });
        
        if (!result.success) {
          deploymentStatus = { type: 'error', message: `Failed to deploy ${stagedFile.name}: ${result.error}` };
          return;
        }
      }
      
      // All succeeded - store detailed results for success UI
      const deployedResults = results.map((r, i) => ({
        scid: r.txid || r.scid || '',
        txid: r.txid || '',
        fileName: stagedFiles[i]?.name || 'unknown',
        fileSize: stagedFiles[i]?.size || 0,
        fileType: stagedFiles[i]?.type || 'text/html',
      }));
      
      deploymentStatus = { 
        type: 'success', 
        message: `Successfully deployed ${stagedFiles.length} DOC${stagedFiles.length > 1 ? 's' : ''}!`,
        results: deployedResults,
        timestamp: new Date().toLocaleTimeString(),
        network: currentNetwork,
      };
      
      // Clear staged files on success (keep deployment results visible)
      stagedFiles = [];
      
    } catch (e) {
      deploymentStatus = { type: 'error', message: e.message || 'Deployment failed' };
    }
  }
  
  // Helper to read File object as text
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
  
  // Copy SCID to clipboard with feedback
  async function copyScid(scid) {
    try {
      await navigator.clipboard.writeText(scid);
      copiedScid = scid;
      setTimeout(() => { copiedScid = null; }, 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }
  
  // Navigate to Browser tab with SCID
  function previewInBrowser(scid) {
    navigateTo(scid);
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
  }
  
  // Clear deployment results and start fresh
  function clearDeploymentResults() {
    deploymentStatus = null;
  }
  
  // Format file size for display
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  
  // =====================================================
  // INDEX Installation Functions (matching tela-cli)
  // =====================================================
  
  // Add a DOC SCID to the INDEX
  function addDocToNewIndex() {
    if (!newIndexDocScid || newIndexDocScid.length !== 64) {
      indexInstallError = 'Please enter a valid 64-character SCID';
      return;
    }
    if (indexDocScids.includes(newIndexDocScid)) {
      indexInstallError = 'This DOC is already added';
      return;
    }
    indexDocScids = [...indexDocScids, newIndexDocScid];
    newIndexDocScid = '';
    indexInstallError = '';
  }
  
  // Remove a DOC SCID from the INDEX
  function removeDocFromNewIndex(scid) {
    indexDocScids = indexDocScids.filter(s => s !== scid);
  }
  
  // Install the INDEX
  async function installIndex() {
    // Validate requirements
    if (!indexName.trim()) {
      indexInstallError = 'Application name is required';
      return;
    }
    if (!indexDURL.trim()) {
      indexInstallError = 'dURL is required for INDEX';
      return;
    }
    if (indexDocScids.length === 0) {
      indexInstallError = 'At least one DOC is required';
      return;
    }
    if (!$walletState.isOpen && !isSimulator) {
      indexInstallError = 'Please open a wallet first';
      return;
    }
    
    indexInstalling = true;
    indexInstallError = '';
    indexInstallResult = null;
    
    try {
      const indexData = {
        name: indexName.trim(),
        durl: indexDURL.trim(),
        description: indexDescription.trim(),
        iconUrl: indexIconURL.trim(),
        docScids: indexDocScids,
        licenses: [],
        ringsize: indexRingsize, // 2 = updateable, 16+ = immutable
        mods: indexEnableMods ? getModTags() : '', // MOD tags if enabled
      };
      
      const result = await InstallINDEX(JSON.stringify(indexData));
      
      if (result.success) {
        indexInstallResult = {
          type: 'success',
          scid: result.txid,
          durl: indexDURL,
          message: `INDEX created successfully!`,
          timestamp: new Date().toLocaleTimeString(),
          network: currentNetwork,
        };
        // Clear form on success
        // Keep result visible, let user clear manually
      } else {
        indexInstallError = result.error || 'Failed to create INDEX';
      }
    } catch (e) {
      indexInstallError = e.message || 'Failed to create INDEX';
    } finally {
      indexInstalling = false;
    }
  }
  
  // Reset INDEX form
  function resetIndexForm() {
    indexName = '';
    indexDURL = '';
    indexDescription = '';
    indexIconURL = '';
    indexDocScids = [];
    newIndexDocScid = '';
    indexRingsize = 2;
    indexInstallResult = null;
    indexInstallError = '';
    // Reset MODs state
    indexEnableMods = false;
    indexSelectedVsMod = '';
    indexSelectedTxMods = [];
  }
  
  // =====================================================
  // Icon URL Validation (matching tela-cli format support)
  // =====================================================
  // Valid formats:
  // - Empty (optional field)
  // - HTTPS URL: https://example.com/icon.png
  // - HTTP URL: http://example.com/icon.png (warning: not recommended)
  // - SCID: 64 hex characters (on-chain image reference)
  // - IPFS: ipfs://... (future support)
  
  function validateIconURL(url) {
    if (!url || url.trim() === '') {
      return { valid: true, type: 'empty', message: '' };
    }
    
    const trimmed = url.trim();
    
    // Check if it's a valid SCID (64 hex characters)
    const scidPattern = /^[a-fA-F0-9]{64}$/;
    if (scidPattern.test(trimmed)) {
      return { valid: true, type: 'scid', message: 'Valid SCID (on-chain reference)' };
    }
    
    // Check for HTTPS URL
    if (trimmed.startsWith('https://')) {
      // Basic URL validation
      try {
        new URL(trimmed);
        return { valid: true, type: 'https', message: 'HTTPS URL' };
      } catch {
        return { valid: false, type: 'invalid', message: 'Invalid URL format' };
      }
    }
    
    // Check for HTTP URL (warning)
    if (trimmed.startsWith('http://')) {
      try {
        new URL(trimmed);
        return { valid: true, type: 'http', message: 'HTTP URL (HTTPS recommended)', warning: true };
      } catch {
        return { valid: false, type: 'invalid', message: 'Invalid URL format' };
      }
    }
    
    // Check for IPFS
    if (trimmed.startsWith('ipfs://')) {
      return { valid: true, type: 'ipfs', message: 'IPFS reference' };
    }
    
    // Unknown format - might be invalid
    return { valid: false, type: 'unknown', message: 'Use HTTPS URL, SCID (64 chars), or IPFS' };
  }
  
  // Reactive icon validation for Install INDEX
  $: indexIconValidation = validateIconURL(indexIconURL);
  
  // =====================================================
  // dURL Tag Detection (must match backend conventions in blockchain.go)
  // =====================================================
  // Special dURL suffixes indicate content type:
  // - .tela.lib       = Library (collection of reusable DOCs)
  // - .tela.shard     = DocShard DOC
  // - .tela.shards    = DocShards INDEX (requires reconstruction)
  // - .tela.bootstrap = Bootstrap INDEX (collection of apps)
  
  const DURL_TAGS = {
    '.tela.lib': {
      name: 'Library',
      icon: 'lib',
      description: 'A collection of reusable DOCs that can be embedded in other apps',
      color: 'violet'
    },
    '.tela.shard': {
      name: 'DocShard',
      icon: 'shard',
      description: 'A shard DOC (part of a larger file split across multiple contracts)',
      color: 'cyan'
    },
    '.tela.shards': {
      name: 'DocShards',
      icon: 'shards',
      description: 'An INDEX containing DocShards that require reconstruction',
      color: 'cyan'
    },
    '.tela.bootstrap': {
      name: 'Bootstrap',
      icon: 'bootstrap',
      description: 'A collection of TELA apps/content for bootstrapping',
      color: 'amber'
    }
  };
  
  function detectDurlTag(durl) {
    if (!durl || durl.trim() === '') {
      return null;
    }
    
    const trimmed = durl.trim().toLowerCase();
    
    for (const [tag, info] of Object.entries(DURL_TAGS)) {
      if (trimmed.endsWith(tag)) {
        return { tag, ...info };
      }
    }
    
    // Standard .tela suffix (optional but conventional)
    if (trimmed.endsWith('.tela')) {
      return {
        tag: '.tela',
        name: 'Standard',
        icon: '◇',
        description: 'Standard TELA application',
        color: 'default'
      };
    }
    
    return null;
  }
  
  // Reactive dURL tag detection for Install INDEX
  $: indexDurlTag = detectDurlTag(indexDURL);
  
  // Get MODs grouped by class (uses allMods from MODULES section)
  function getVsModOptions() {
    return allMods.filter(m => m.tag.startsWith('vs'));
  }
  
  function getTxModOptions() {
    return allMods.filter(m => m.tag.startsWith('tx'));
  }
  
  // Toggle a Transfer MOD
  function toggleTxMod(tag) {
    if (indexSelectedTxMods.includes(tag)) {
      indexSelectedTxMods = indexSelectedTxMods.filter(t => t !== tag);
    } else {
      indexSelectedTxMods = [...indexSelectedTxMods, tag];
    }
  }
  
  // Get combined MOD tags string
  function getModTags() {
    const tags = [];
    if (indexSelectedVsMod) tags.push(indexSelectedVsMod);
    tags.push(...indexSelectedTxMods);
    return tags.join(',');
  }
  
  // Watch for MODs toggle to load MODs and force ringsize
  $: if (indexEnableMods) {
    if (allMods.length === 0 && !modsLoading) {
      loadModsData(); // Reuse existing function from MODULES section
    }
    indexRingsize = 2; // MODs require ringsize 2
  }
  
  // Handle MOD picker modal confirmation
  function handleModPickerConfirm(event) {
    const { vsMod, txMods } = event.detail;
    indexSelectedVsMod = vsMod;
    indexSelectedTxMods = txMods;
    if (vsMod || txMods.length > 0) {
      indexEnableMods = true;
    }
    showModPickerModal = false;
  }
  
  // =====================================================
  // Confirmation Modal Functions
  // =====================================================
  
  function showDeployConfirmation(type, data) {
    confirmModalType = type;
    confirmModalData = data;
    showConfirmModal = true;
  }
  
  function cancelConfirmation() {
    showConfirmModal = false;
    confirmModalType = '';
    confirmModalData = null;
    deployAcknowledged = false;
  }
  
  async function confirmDeployment() {
    if (!deployAcknowledged) return; // Extra safety check
    showConfirmModal = false;
    deployAcknowledged = false;
    
    if (confirmModalType === 'doc') {
      await deployBatch();
    } else if (confirmModalType === 'index') {
      await installIndex();
    } else if (confirmModalType === 'sc') {
      if (deploySCRef) await deploySCRef.deploySmartContract();
    }
    
    confirmModalType = '';
    confirmModalData = null;
  }
  
  // Prepare DOC deployment with confirmation
  function prepareDocDeployment() {
    if (!$walletState.isOpen && !isSimulator) {
      deploymentStatus = { type: 'error', message: 'Please open a wallet first' };
      return;
    }
    if (stagedFiles.length === 0) {
      deploymentStatus = { type: 'error', message: 'No files staged for deployment' };
      return;
    }
    
    // Show confirmation for mainnet, auto-deploy for simulator
    if (isSimulator) {
      deployBatch();
    } else {
      showDeployConfirmation('doc', {
        files: stagedFiles,
        gasEstimate: totalGasEstimate,
        network: currentNetwork,
      });
    }
  }
  
  // Prepare INDEX deployment with confirmation  
  function prepareIndexDeployment() {
    // Validate
    if (!indexName.trim()) {
      indexInstallError = 'Application name is required';
      return;
    }
    if (!indexDURL.trim()) {
      indexInstallError = 'dURL is required for INDEX';
      return;
    }
    if (indexDocScids.length === 0) {
      indexInstallError = 'At least one DOC is required';
      return;
    }
    if (!$walletState.isOpen && !isSimulator) {
      indexInstallError = 'Please open a wallet first';
      return;
    }
    
    // Show confirmation for mainnet, auto-deploy for simulator
    if (isSimulator) {
      installIndex();
    } else {
      showDeployConfirmation('index', {
        name: indexName,
        durl: indexDURL,
        docCount: indexDocScids.length,
        gasEstimate: INDEX_BASE_GAS,
        network: currentNetwork,
      });
    }
  }
</script>

<div class="page-layout">
  <!-- Page Header -->
  <div class="page-header">
    <div class="page-header-inner">
      <div class="page-header-left">
        <h1 class="page-header-title">
          <Palette size={18} class="page-header-icon" strokeWidth={1.5} />
          Studio
        </h1>
        <p class="page-header-desc">Create and deploy TELA applications</p>
      </div>
      <div class="page-header-actions">
        <span 
          class="badge" 
          class:badge-warn={currentNetConfig.status === 'err'} 
          class:badge-ok={currentNetConfig.status === 'ok'} 
          class:badge-cyan={currentNetConfig.status === 'warn'}
          title={currentNetConfig.description}
        >
          {currentNetConfig.warning}
        </span>
        <div class="network-toggle-group">
          {#each networks as network}
            <button
              on:click={() => switchNetwork(network.id)}
              class="network-toggle-btn"
              class:active={currentNetwork === network.id}
            >
              {#if network.icon === 'globe'}<Globe size={14} />
              {:else if network.icon === 'flask'}<FlaskConical size={14} />
              {:else}<Gamepad2 size={14} />{/if}
              <span>{network.label}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
  
  <!-- v5.6 Unified Page Body -->
  <div class="page-body">
    <!-- Sidebar -->
    <div class="page-sidebar">
      <div class="page-sidebar-section">ACTIONS</div>
      <nav class="page-sidebar-nav">
    {#each tabs as tab}
      <button
        on:click={() => activeTab = tab.id}
            class="page-sidebar-item"
            class:active={activeTab === tab.id}
      >
            <span class="page-sidebar-item-icon">
        {#if tab.icon === 'file'}<FileText size={14} />
        {:else if tab.icon === 'folder'}<FolderUp size={14} />
        {:else if tab.icon === 'layers'}<Layers size={14} />
        {:else if tab.icon === 'refresh'}<RefreshCw size={14} />
        {:else if tab.icon === 'package'}<Package size={14} />
        {:else if tab.icon === 'history'}<History size={14} />
        {:else if tab.icon === 'copy'}<Copy size={14} />
        {:else if tab.icon === 'server'}<Server size={14} />
        {:else if tab.icon === 'git'}<GitBranch size={14} />
        {:else if tab.icon === 'code'}<FileCode size={14} />
        {:else}<GitCompare size={14} />{/if}
            </span>
            <span class="page-sidebar-item-label">{tab.label}</span>
      </button>
    {/each}
      </nav>
      
      <!-- MODULES Section -->
      <div class="page-sidebar-section" style="margin-top: var(--s-5);">MODULES</div>
      <nav class="page-sidebar-nav">
        {#each moduleTabs as tab}
          <button
            on:click={() => activeTab = tab.id}
            class="page-sidebar-item"
            class:active={activeTab === tab.id}
          >
            <span class="page-sidebar-item-icon">
              {#if tab.icon === 'puzzle'}
                <Puzzle size={14} />
              {:else if tab.icon === 'library'}
                <Library size={14} />
              {:else}
                <Puzzle size={14} />
              {/if}
            </span>
            <span class="page-sidebar-item-label">{tab.label}</span>
            {#if tab.id === 'modules' && allMods.length > 0}
              <span class="page-sidebar-item-count">({allMods.length})</span>
            {:else if tab.id === 'libraries' && libraries.length > 0}
              <span class="page-sidebar-item-count">({libraries.length})</span>
            {/if}
          </button>
        {/each}
      </nav>
  </div>
  
    <!-- Content Area -->
    <div class="page-content">
    {#if activeTab === 'install-doc'}
      <StudioInstallDoc
        bind:dropzoneElement={docDropzoneElement}
        walletIsOpen={$walletState.isOpen}
        bind:docDescription
        bind:docIconURL
        bind:docRingsize
        bind:docCompression
        {stagedFiles}
        {totalGasEstimate}
        {gasLoading}
        {isSimulator}
        {currentNetwork}
        {deploymentStatus}
        {copiedScid}
        {handleFilesStaged}
        {removeFile}
        {canCompressFiles}
        {formatGas}
        {gasToDero}
        {prepareDocDeployment}
        {copyScid}
        {previewInBrowser}
        {clearDeploymentResults}
        {formatFileSize}
        onSwitchToBatch={() => activeTab = 'batch-upload'}
      />
    
    {:else if activeTab === 'batch-upload'}
      <StudioBatchUpload
        bind:batchFolderPath
        bind:batchDragging
        bind:batchDropzoneElement
        selectFolder={SelectFolder}
        on:preview={(e) => {
          previewInBrowser(e.detail.scid);
        }}
      />
    
    {:else if activeTab === 'install-index'}
      <StudioInstallIndex
        walletIsOpen={$walletState.isOpen}
        bind:indexName
        bind:indexDURL
        bind:indexDescription
        bind:indexIconURL
        bind:indexRingsize
        bind:indexEnableMods
        bind:indexSelectedVsMod
        bind:indexSelectedTxMods
        bind:showModPickerModal
        bind:newIndexDocScid
        {indexInstallResult}
        {indexInstallError}
        {indexInstalling}
        {indexDurlTag}
        {indexIconValidation}
        {indexDocScids}
        {modsLoading}
        {isSimulator}
        {currentNetwork}
        {copiedScid}
        {INDEX_BASE_GAS}
        {resetIndexForm}
        {copyScid}
        {previewInBrowser}
        {removeDocFromNewIndex}
        {addDocToNewIndex}
        {prepareIndexDeployment}
        {getVsModOptions}
        {getTxModOptions}
        {toggleTxMod}
        {getModTags}
        {formatGas}
        {gasToDero}
      />
    
    {:else if activeTab === 'update-index'}
      <StudioUpdateIndex
        walletIsOpen={$walletState.isOpen}
        bind:updateIndexScid
        bind:updateIndexName
        bind:updateIndexDescription
        bind:updateIndexIcon
        bind:newDocScid
        {updateResult}
        {updateIndexInfo}
        {updateIndexDocs}
        {updateIndexLoading}
        {updateIndexError}
        {updateInProgress}
        {updateIsSimulator}
        {showUpdateConfirmModal}
        {loadIndexInfo}
        {resetUpdateIndex}
        {canUpdateIndex}
        {removeDocFromIndex}
        {addDocToIndex}
        {prepareIndexUpdate}
        {submitIndexUpdate}
        {cancelUpdateConfirm}
        copyText={ClipboardSetText}
        {navigateTo}
      />
    
    {:else if activeTab === 'my-content'}
      <StudioMyContent
        walletIsOpen={$walletState.isOpen}
        bind:myContentTab
        bind:myContentDocTypeFilter
        {myContentGnomonRequired}
        {myContentError}
        {myContentLoading}
        {myDocs}
        {myIndexes}
        {availableDocTypes}
        {copiedScid}
        {refreshMyContent}
        {loadMyDOCs}
        {copyMyContentScid}
        {viewMyContentInBrowser}
        {viewVersionHistoryFromMyContent}
        {updateMyContent}
      />
    
    {:else if activeTab === 'actions'}
      <StudioActions
        walletIsOpen={$walletState.isOpen}
        bind:actionsError
        bind:actionsScid
        {actionsLoading}
        {actionsContentInfo}
        {myIndexes}
        {myContentLoaded}
        {loadActionsContent}
        {openVersionHistory}
        {viewMyContentInBrowser}
        onCloneLatest={(scid) => { cloneScid = scid; activeTab = 'clone'; }}
        onUpdateIndex={(scid) => { updateIndexScid = scid; activeTab = 'update-index'; }}
        onGoToMyContent={() => { activeTab = 'my-content'; }}
      />
    
    {:else if activeTab === 'clone'}
      <StudioClone
        bind:cloneScid
        {cloneError}
        {cloneResult}
        {cloneLoading}
        {showCloneConfirmModal}
        {copyClonePath}
        {openCloneFolder}
        {serveClonedContent}
        {resetClone}
        {cloneContent}
        {cancelCloneUpdate}
        {confirmCloneUpdate}
      />
    
    {:else if activeTab === 'serve'}
      <StudioServe
        {localServerRunning}
        {serveLoading}
        {serveError}
        {localServerUrl}
        {localServerPort}
        {localServerDirectory}
        {localServerWatcherActive}
        {recentChanges}
        {selectAndServeDirectory}
        {formatDirectory}
        {openInBrowser}
        {triggerManualRefresh}
        {stopLocalServer}
      />
    
    {:else if activeTab === 'diff'}
      <StudioDiff onOpenDiffViewer={() => showDiffViewer = true} />
    
    <!-- MODULES SECTION -->
    {:else if activeTab === 'modules'}
      <StudioModules
        bind:modSearchQuery
        bind:selectedModClass
        {allMods}
        {modClasses}
        {filteredMods}
        {modsLoading}
        {modsError}
        {loadModsData}
        {openModDetails}
        {getModClassIcon}
      />
    
    <!-- LIBRARIES SECTION -->
    {:else if activeTab === 'libraries'}
      <StudioLibraries
        bind:librarySearchQuery
        {librariesLoading}
        {librariesLoadingStatus}
        {librariesError}
        {gnomonRequired}
        {libraries}
        {filteredLibraries}
        {loadLibrariesData}
        {goToSettings}
        {openLibraryDetails}
      />
    
    {:else if activeTab === 'shards'}
      <StudioShards
        bind:shardMode
        bind:shardFilePath
        bind:shardFolderPath
        bind:shardCompress
        bind:shardDropzoneElement
        bind:shardDragging
        {shardError}
        {shardResult}
        {shardLoading}
        {formatShardBytes}
        {resetShard}
        {selectShardFile}
        {selectShardFolder}
        {performShard}
        {performReconstruct}
      />
    
    {:else if activeTab === 'add-scid'}
      <StudioAddSCID />
    
    {:else if activeTab === 'deploy-sc'}
      <StudioDeploySC
        bind:this={deploySCRef}
        {isSimulator}
        walletIsOpen={$walletState.isOpen}
        {currentNetwork}
        {showDeployConfirmation}
      />
    {/if}
    </div>
  </div>
</div>

<!-- Library Details Modal -->
{#if selectedLibrary}
  <div class="modal-overlay" on:click={closeLibraryDetails}>
    <div class="modal-content lib-modal" on:click|stopPropagation>
      <div class="lib-modal-header">
        <div class="lib-modal-header-bg"></div>
        <button on:click={closeLibraryDetails} class="modal-close lib-modal-close">
          <X size={20} />
        </button>
        <div class="lib-modal-header-content">
          <div class="lib-modal-icon" class:lib-modal-icon-index={selectedLibrary.type === 'INDEX'}>
            {#if selectedLibrary.type === 'INDEX'}
              <Layers size={28} />
            {:else}
              <FileText size={28} />
            {/if}
          </div>
          <h2 class="lib-modal-title">{selectedLibrary.display_name || selectedLibrary.name || 'Library'}</h2>
          <div class="lib-modal-badges">
            {#if selectedLibrary.durl}
              <code class="lib-modal-durl">{selectedLibrary.durl}</code>
            {/if}
            <span class="lib-modal-type" class:lib-type-index={selectedLibrary.type === 'INDEX'}>
              {selectedLibrary.type || 'DOC'}
            </span>
          </div>
        </div>
      </div>
      
      <div class="modal-body lib-modal-body">
        {#if selectedLibrary.description}
          <div class="lib-modal-section">
            <p class="lib-modal-description">{selectedLibrary.description}</p>
          </div>
        {/if}
        
        <div class="lib-modal-section">
          <h3 class="lib-modal-section-title">
            <Database size={14} />
            Contract Details
          </h3>
          <div class="lib-details-grid">
            <div class="lib-detail-item lib-detail-full">
              <span class="lib-detail-label">SCID</span>
              <div class="lib-detail-scid-row">
                <code class="lib-detail-scid-value">{selectedLibrary.scid}</code>
                <button 
                  class="lib-copy-btn" 
                  on:click={copyLibraryScid} 
                  title={copiedScid === selectedLibrary.scid ? 'Copied!' : 'Copy SCID'}
                >
                  {#if copiedScid === selectedLibrary.scid}
                    <Check size={12} />
                  {:else}
                    <Copy size={12} />
                  {/if}
                </button>
              </div>
            </div>
            
            {#if selectedLibrary.type === 'INDEX' && selectedLibrary.doc_count > 0}
              <div class="lib-detail-item">
                <span class="lib-detail-label">Files</span>
                <span class="lib-detail-value lib-detail-highlight">
                  {selectedLibrary.doc_count} DOC{selectedLibrary.doc_count > 1 ? 's' : ''}
                </span>
              </div>
            {/if}
            
            <div class="lib-detail-item">
              <span class="lib-detail-label">Author</span>
              <code class="lib-detail-value lib-detail-mono">
                {selectedLibrary.owner?.slice(0, 12)}...{selectedLibrary.owner?.slice(-8)}
              </code>
            </div>
            
            {#if selectedLibrary.rating && selectedLibrary.rating.count > 0}
              <div class="lib-detail-item">
                <span class="lib-detail-label">Community Rating</span>
                <div class="lib-detail-rating">
                  <span class="lib-rating-likes"><ThumbsUp size={12} /> {selectedLibrary.rating.likes || 0}</span>
                  <span class="lib-rating-sep">/</span>
                  <span class="lib-rating-dislikes"><ThumbsDown size={12} /> {selectedLibrary.rating.dislikes || 0}</span>
                  <span class="lib-rating-count">({selectedLibrary.rating.count} votes)</span>
                </div>
              </div>
            {/if}
          </div>
        </div>
        
        <div class="lib-modal-section">
          <h3 class="lib-modal-section-title">
            <Zap size={14} />
            Usage
          </h3>
          <div class="lib-usage-box">
            <p class="lib-usage-hint">Reference this library in your TELA content using:</p>
            <code class="lib-usage-code">tela://{selectedLibrary.durl || selectedLibrary.scid}</code>
          </div>
        </div>
      </div>
      
      <div class="modal-footer lib-modal-footer">
        <button on:click={cloneLibrary} class="btn btn-ghost">
          <FolderDown size={14} />
          Clone
        </button>
        <div class="lib-modal-footer-right">
          <button on:click={closeLibraryDetails} class="btn btn-secondary">Cancel</button>
          <button on:click={embedLibraryInIndex} class="btn btn-secondary lib-embed-btn" title="Add library SCID to Install INDEX DOC references">
            <Link size={14} />
            Embed in INDEX
          </button>
          <button on:click={previewLibrary} class="btn btn-primary">
            <Eye size={14} />
            Open in Browser
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- MOD Details Modal -->
{#if selectedMod}
  <div class="modal-overlay" on:click={closeModDetails}>
    <div class="modal-content mod-modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon">
            <svelte:component this={getModClassIcon(selectedMod.class)} size={24} />
          </div>
          <div>
            <h2 class="modal-title">{selectedMod.name}</h2>
            <div class="modal-meta">
              <span class="modal-tag">{selectedMod.tag}</span>
              <span class="badge badge-cyan">{selectedMod.class}</span>
            </div>
          </div>
        </div>
        <button on:click={closeModDetails} class="modal-close">
          <X size={20} />
        </button>
      </div>
      
      <div class="modal-body">
        {#if loadingModDetails}
          <div class="modal-loading">
            <Loader2 size={24} class="spin" />
          </div>
        {:else if modDetails}
          <div class="modal-section">
            <h3 class="modal-section-title">Description</h3>
            <p class="modal-section-text">{modDetails.description || selectedMod.description || 'No description available'}</p>
          </div>
          
          {#if modDetails.functionNames?.length > 0}
            <div class="modal-section">
              <h3 class="modal-section-title">Functions ({modDetails.functionNames.length})</h3>
              <div class="function-tags">
                {#each modDetails.functionNames as funcName}
                  <span class="function-tag">{funcName}()</span>
                {/each}
              </div>
            </div>
          {/if}
          
          {#if modDetails.functionCode}
            <div class="modal-section">
              <div class="code-header">
                <h3 class="modal-section-title">DVM Code</h3>
                <button on:click={() => copyModCode(modDetails.functionCode, 'MOD code')} class="copy-btn">
                  <Copy size={12} />
                  <span>Copy</span>
                </button>
              </div>
              <pre class="code-block">{modDetails.functionCode}</pre>
            </div>
          {/if}
        {:else}
          <p class="modal-empty">No additional details available</p>
        {/if}
      </div>
      
      <div class="modal-footer">
        <button on:click={closeModDetails} class="btn btn-ghost">Close</button>
        <button on:click={openModInstallWizard} disabled={!modDetails} class="btn btn-primary">
          <Wrench size={14} />
          Install to SC
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MOD Install Wizard Modal -->
{#if showModInstallWizard && selectedMod}
  <div class="modal-overlay nested" on:click={closeModInstallWizard}>
    <div class="modal-content mod-modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <Wrench size={20} class="modal-icon-inline" />
          <div>
            <h2 class="modal-title">Install: {selectedMod.name}</h2>
            <p class="modal-subtitle">Prepare module for installation</p>
          </div>
        </div>
      </div>
      
      <div class="modal-body">
        {#if !modInstallResult}
          <div class="install-form">
            <div class="form-group">
              <label class="form-label">Target Smart Contract SCID</label>
              <input
                type="text"
                bind:value={modInstallScid}
                placeholder="Enter 64-character SCID..."
                class="input input-mono"
              />
              <p class="form-hint">You must be the owner of this SC to install modules</p>
            </div>
            
            {#if modInstallError}
              <div class="install-error">
                <AlertTriangle size={14} />
                <span>{modInstallError}</span>
              </div>
            {/if}
            
            {#if !$walletState.isOpen}
              <div class="install-warning">
                <AlertTriangle size={14} />
                <span>Please open a wallet first</span>
              </div>
            {/if}
          </div>
        {:else}
          <div class="install-success">
            <Check size={16} />
            <div>
              <span class="install-success-title">Module Code Prepared!</span>
              <p class="install-success-text">Copy the updated code and use UPDATE_SC_CODE via XSWD to update your SC.</p>
            </div>
          </div>
          
          {#if modInstallResult.functionNames?.length > 0}
            <div class="modal-section">
              <h4 class="modal-section-title">Added Functions</h4>
              <div class="function-tags">
                {#each modInstallResult.functionNames as funcName}
                  <span class="function-tag">{funcName}()</span>
                {/each}
              </div>
            </div>
          {/if}
          
          <div class="modal-section">
            <div class="code-header">
              <h4 class="modal-section-title">Updated SC Code</h4>
              <button on:click={() => copyModCode(modInstallResult.updatedCode)} class="copy-btn">
                <Copy size={12} />
                <span>Copy Full Code</span>
              </button>
            </div>
            <pre class="code-block small">{modInstallResult.updatedCode?.slice(-500) || ''}...</pre>
            <p class="form-hint">Showing last 500 characters</p>
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        <button on:click={closeModInstallWizard} class="btn btn-ghost">
          {modInstallResult ? 'Done' : 'Cancel'}
        </button>
        
        {#if !modInstallResult}
          <button
            on:click={prepareModInstall}
            disabled={modInstallLoading || !modInstallScid || modInstallScid.length < 64 || !$walletState.isOpen}
            class="btn btn-primary"
          >
            {#if modInstallLoading}
              <Loader2 size={14} class="spin" />
              Preparing...
            {:else}
              Prepare Installation
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Diff Viewer Modal -->
<DiffViewer bind:visible={showDiffViewer} on:close={() => showDiffViewer = false} />

<!-- Version History Modal -->
<VersionHistory 
  scid={versionHistoryScid} 
  bind:show={showVersionHistory}
  on:close={closeVersionHistory}
  on:revert={handleVersionRevert}
  on:clone={handleVersionClone}
/>

<!-- Simulator Confirmation Modal - Hologram v6.1 Style -->
{#if showSimModal}
  <div class="sim-modal-backdrop" on:click={cancelSimModal}>
    <div class="sim-modal-card" on:click|stopPropagation>
      <!-- Status Bar -->
      <div class="sim-modal-status">
        <div class="sim-modal-status-left">
          <span class="sim-modal-status-dot" class:start={simModalAction === 'start'} class:stop={simModalAction === 'stop'}></span>
          <span class="sim-modal-status-text">{simModalAction === 'start' ? 'Confirm' : 'Warning'}</span>
        </div>
        <span class="sim-modal-badge" class:start={simModalAction === 'start'} class:stop={simModalAction === 'stop'}>
          {simModalAction === 'start' ? 'SIMULATOR' : 'STOPPING'}
        </span>
      </div>
      
      <!-- Icon + Title -->
      <div class="sim-modal-header">
        <div class="sim-modal-icon" class:start={simModalAction === 'start'} class:stop={simModalAction === 'stop'}>
          <Gamepad2 size={28} strokeWidth={1.5} />
        </div>
        <h2 class="sim-modal-title">
          {#if simModalAction === 'start'}
            Start Simulator Mode
          {:else}
            Stop Simulator
          {/if}
        </h2>
        <p class="sim-modal-desc">
          {#if simModalAction === 'start'}
            Launch a local test environment for safe development
          {:else}
            Return to production network
          {/if}
        </p>
      </div>
      
      <!-- Content -->
      <div class="sim-modal-body">
        {#if simModalAction === 'start'}
          <div class="sim-modal-features">
            <div class="sim-modal-feature">
              <Radio size={14} class="sim-feature-icon" />
              <span>Launch local DERO daemon</span>
            </div>
            <div class="sim-modal-feature">
              <Wallet size={14} class="sim-feature-icon" />
              <span>Create test wallet automatically</span>
            </div>
            <div class="sim-modal-feature">
              <Diamond size={14} class="sim-feature-icon" />
              <span>Generate free test DERO</span>
            </div>
          </div>
          
          <div class="sim-modal-note cyan">
            Takes a moment to initialize. Once ready, you can deploy and test TELA apps with zero cost.
          </div>
          
          <div class="sim-modal-note warn">
            Test DERO has no real value. Perfect for learning and experimentation.
          </div>
        {:else}
          <div class="sim-modal-features">
            <div class="sim-modal-feature">
              <Radio size={14} class="sim-feature-icon" />
              <span>Stop local daemon process</span>
            </div>
            <div class="sim-modal-feature">
              <Wallet size={14} class="sim-feature-icon" />
              <span>Close simulator wallet</span>
            </div>
            <div class="sim-modal-feature">
              <Globe size={14} class="sim-feature-icon" />
              <span>Switch back to Mainnet</span>
            </div>
          </div>
          
          <div class="sim-modal-note cyan">
            Your simulator data will be preserved for next time.
          </div>
        {/if}
      </div>
      
      <!-- Actions -->
      <div class="sim-modal-actions">
        <button class="sim-modal-btn secondary" on:click={cancelSimModal} disabled={simIsLoading}>
          Cancel
        </button>
        <button class="sim-modal-btn" class:primary={simModalAction === 'start'} class:warn={simModalAction === 'stop'} on:click={confirmSimModal} disabled={simIsLoading}>
          {#if simIsLoading}
            <Loader2 size={14} class="spin" /> Working...
          {:else if simModalAction === 'start'}
            Start Simulator
          {:else}
            Stop Simulator
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Deployment Confirmation Modal -->
{#if showConfirmModal}
  <div class="sim-modal-backdrop" on:click={cancelConfirmation}>
    <div class="sim-modal-card" on:click|stopPropagation>
      <!-- Status Bar -->
      <div class="sim-modal-status">
        <div class="sim-modal-status-left">
          <span class="sim-modal-status-dot" class:start={true}></span>
          <span class="sim-modal-status-text">Confirm Deployment</span>
        </div>
        <span class="sim-modal-badge warn">
          {confirmModalData?.network?.toUpperCase() || 'MAINNET'}
        </span>
      </div>
      
      <!-- Icon + Title -->
      <div class="sim-modal-header">
        <div class="sim-modal-icon start">
          {#if confirmModalType === 'doc'}
            <FileText size={28} strokeWidth={1.5} />
          {:else if confirmModalType === 'sc'}
            <FileCode size={28} strokeWidth={1.5} />
          {:else}
            <Layers size={28} strokeWidth={1.5} />
          {/if}
        </div>
        <h2 class="sim-modal-title">
          {#if confirmModalType === 'doc'}
            Deploy {confirmModalData?.files?.length || 0} DOC{(confirmModalData?.files?.length || 0) > 1 ? 's' : ''}
          {:else if confirmModalType === 'sc'}
            Deploy Smart Contract
          {:else}
            Create INDEX
          {/if}
        </h2>
        <p class="sim-modal-desc">
          This action will deploy to {confirmModalData?.network || 'mainnet'} and cost DERO
        </p>
      </div>
      
      <!-- Content -->
      <div class="sim-modal-body">
        <div class="confirm-details">
          {#if confirmModalType === 'doc' && confirmModalData?.files}
            <div class="confirm-row">
              <span class="confirm-label">Files</span>
              <span class="confirm-value">{confirmModalData.files.length} DOC{confirmModalData.files.length > 1 ? 's' : ''}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">Total Size</span>
              <span class="confirm-value">{formatFileSize(confirmModalData.files.reduce((s, f) => s + f.size, 0))}</span>
            </div>
          {:else if confirmModalType === 'index'}
            <div class="confirm-row">
              <span class="confirm-label">Name</span>
              <span class="confirm-value">{confirmModalData?.name || 'Unnamed'}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">dURL</span>
              <span class="confirm-value c-cyan">dero://{confirmModalData?.durl}</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">DOCs</span>
              <span class="confirm-value">{confirmModalData?.docCount || 0} references</span>
            </div>
          {:else if confirmModalType === 'sc'}
            <div class="confirm-row">
              <span class="confirm-label">Code</span>
              <span class="confirm-value">{confirmModalData?.lineCount || 0} lines &middot; {confirmModalData?.charCount || 0} chars</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">Functions</span>
              <span class="confirm-value">{confirmModalData?.functionCount || '?'} exported</span>
            </div>
            <div class="confirm-row">
              <span class="confirm-label">Ring Size</span>
              <span class="confirm-value">{confirmModalData?.anonymous ? 'Ring 16 (Anonymous)' : 'Ring 2 (Standard)'}</span>
            </div>
            {#if confirmModalData?.hasValidation}
              <div class="confirm-row">
                <span class="confirm-label">Validated</span>
                <span class="confirm-value c-emerald">Yes</span>
              </div>
            {/if}
          {/if}
          {#if confirmModalType !== 'sc'}
          <div class="confirm-row">
            <span class="confirm-label">Est. Cost</span>
            <span class="confirm-value c-emerald">~{formatGas(confirmModalData?.gasEstimate || 0)} gas</span>
          </div>
          {/if}
          <div class="confirm-row">
            <span class="confirm-label">Network</span>
            <span class="confirm-value">
              <span class="network-badge {confirmModalData?.network}">{confirmModalData?.network}</span>
            </span>
          </div>
        </div>
        
        <div class="sim-modal-note warn">
          <AlertTriangle size={14} />
          <span>Mainnet transactions are permanent and cost real DERO. Double-check before confirming.</span>
        </div>
        
        <!-- Acknowledgement Checkbox -->
        <label class="deploy-acknowledge">
          <input 
            type="checkbox" 
            bind:checked={deployAcknowledged}
            class="checkbox"
          />
          <span class="acknowledge-text">
            I understand this deployment is <strong>permanent</strong> and will consume <strong>real DERO</strong>
          </span>
        </label>
      </div>
      
      <!-- Actions -->
      <div class="sim-modal-actions">
        <button class="sim-modal-btn secondary" on:click={cancelConfirmation}>
          Cancel
        </button>
        <button 
          class="sim-modal-btn primary" 
          on:click={confirmDeployment}
          disabled={!deployAcknowledged}
        >
          <Lock size={14} />
          Confirm & Deploy
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MOD Picker Modal for Install INDEX -->
<ModPickerModal 
  show={showModPickerModal}
  selectedVsMod={indexSelectedVsMod}
  selectedTxMods={indexSelectedTxMods}
  on:confirm={handleModPickerConfirm}
  on:close={() => showModPickerModal = false}
/>


