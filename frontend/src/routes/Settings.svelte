<script>
  import { onMount, onDestroy } from 'svelte';
  import { settingsState, appState, consoleLogs, clearConsoleLogs, syncNetworkMode, saveSetting, loadSettings, updateStatus, toast } from '../lib/stores/appState.js';
  import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime.js';
  import { 
    SetSetting, StartGnomon, StopGnomon, ResyncGnomon, ResyncGnomonFromHeight,
    GetSearchExclusions, AddSearchExclusion, RemoveSearchExclusion, ClearSearchExclusions, SetSearchMinLikes,
    DetectRunningNode, CheckDerodStatus,
    StartNode, StopNode, GetNodeStatus, GetSyncProgress, TestAndConnectEndpoint,
    GetConnectedApps, RevokeAppPermissions, RevokeAppPermission, GetPermissionTypes,
    SetPrivacyMode, GetNetworkFilterStatus, AddAllowedHost, RemoveAllowedHost,
    GetConnectionLog, ClearConnectionLog, GetActiveConnections,
    IsEpochEnabled, SetEpochEnabled, GetEpochStats, SetEpochConfig, InitializeEpoch,
    GetDevSupportStatus, GetDevSupportStats, SetDevSupportEnabled, IsDevSupportEnabled,
    SetNodeAdvancedConfig, GetNodeAdvancedConfig,
    StartSimulatorMode, StopSimulatorMode, GetSimulatorStatus, ResetSimulator,
    GetConsoleLogs, SetNetworkMode, GetAppInfo,
    ClearConsoleLogs as ClearBackendLogs,
    SetGnomonAutostart, GetGnomonAutostart,
    // Simple-Gnomon features
    StartGnomonWSServer, StopGnomonWSServer, GetGnomonWSStatus,
    GetTagStats, RebuildTagIndex,
    // Time Machine Watch List
    GetWatchedSmartContracts, UnwatchSmartContract, RefreshWatchedSCs,
    // Ring Members (sender-visibility decoy curation)
    GetRingMemberSets, AddRingMemberSet, AddRingMember, RemoveRingMember, DeleteRingMemberSet, IsAddressRegistered
  } from '../../wailsjs/go/main/App.js';
  import OfflineCacheManager from '../lib/components/OfflineCacheManager.svelte';
  import SyncManager from '../lib/components/SyncManager.svelte';
  import SafeBrowsingSettings from '../lib/components/SafeBrowsingSettings.svelte';
import { HoloCard, DotIndicator, HoloBadge, Icons } from '../lib/components/holo';
  import ServerManager from '../lib/components/ServerManager.svelte';
  import StorageManager from '../lib/components/StorageManager.svelte';
  import { Settings as SettingsIcon } from 'lucide-svelte';

  export let initialSection = '';
  let activeSection = initialSection || 'general';
  
  const sections = [
    { id: 'general', label: 'General', iconName: 'settings' },
    { id: 'privacy', label: 'Advanced Privacy', iconName: 'shield' },
    { id: 'data-storage', label: 'Data & Storage', iconName: 'hard-drive' },
    { id: 'node', label: 'Node', iconName: 'server' },
    { id: 'simulator', label: 'Simulator', iconName: 'gamepad' },
    { id: 'servers', label: 'TELA Servers', iconName: 'globe' },
    { id: 'offline-cache', label: 'Offline Cache', iconName: 'download' },
    { id: 'sync-manager', label: 'Sync Manager', iconName: 'refresh-cw' },
    { id: 'safe-browsing', label: 'Safe Browsing', iconName: 'shield' },
    { id: 'network', label: 'Network', iconName: 'globe' },
    { id: 'gnomon', label: 'Gnomon', iconName: 'database' },
    { id: 'connected-apps', label: 'Connected Apps', iconName: 'link' },
    { id: 'console', label: 'Console', iconName: 'terminal' },
    { id: 'developer-support', label: 'Developer Support', iconName: 'heart' },
    { id: 'about', label: 'About', iconName: 'info' },
  ];
  
  // App info state
  let appInfo = {
    name: 'Hologram',
    version: '',
    buildDate: '',
    gitCommit: '',
    description: ''
  };
  
  // Connected Apps state
  let connectedApps = [];
  let permissionTypes = [];
  let isLoadingApps = false;
  let selectedApp = null;
  
  // Node state
  let nodeStatus = { isRunning: false };
  let derodStatus = { installed: false };
  let downloadProgress = null;
  let nodeDataDir = '';
  let syncProgress = { progress: 0, isSynced: false };
  let statusInterval;
  let nodeActionLoading = false;
  let nodeActionError = '';
  let advancedOptionsCard;
  let showExternalNodeHelp = false;
  
  // Privacy Mode state
  let privacyModeEnabled = false;
  let allowedHosts = [];
  let connectionLog = [];
  let activeConnections = [];
  let newAllowedHost = '';
  let privacyLoading = false;

  // Ring Members state (sender-visibility decoy curation)
  let ringMemberSets = [];
  let newRingSetName = '';
  let selectedRingSetId = '';      // which set's members are open in the editor
  let newRingMemberAddr = '';
  let ringMemberError = '';
  let ringSetDeleteArmed = '';     // confirm-tap: id armed for delete
  // address -> 'checking' | 'ok' | 'unregistered' ; advisory registration probe
  let ringMemberStatus = {};
  $: selectedRingSet = ringMemberSets.find(s => s.id === selectedRingSetId) || null;
  
  // Node detection state
  let detecting = false;
  let detectionMessage = '';

  function isLocalEndpoint(endpoint) {
    if (!endpoint) return true;
    const value = endpoint.trim().toLowerCase();
    return (
      value.includes('127.0.0.1') ||
      value.includes('localhost')
    );
  }

  $: isExternalNode = !isLocalEndpoint($settingsState.daemonEndpoint);
  $: embeddedNodeRunning = nodeStatus.isEmbedded ?? false;
  $: externalNodeActive = nodeStatus.isExternal ?? isExternalNode;
  $: nodeModeLabel = embeddedNodeRunning
    ? 'Embedded node running'
    : externalNodeActive
      ? 'External node active'
      : 'No node running';
  $: nodeModeBadgeClass = embeddedNodeRunning
    ? 'badge-ok'
    : externalNodeActive
      ? 'badge-cyan'
      : 'badge-warn';
  
  // Gnomon resync state
  let resyncingGnomon = false;
  let gnomonAutostart = false;
  let resyncFromHeight = '';
  let resyncingFromHeight = false;
  
  // Simple-Gnomon WebSocket API state
  let gnomonWSStatus = { running: false, address: '', port: 0, clients: 0 };
  let gnomonWSLoading = false;
  let tagStats = { total_scids: 0, class_counts: {}, tag_counts: {} };
  let rebuildingTags = false;
  
  // Time Machine Watch List state
  let watchedSCs = [];
  let watchedSCsLoading = false;
  let refreshingWatched = false;
  
  // Search exclusions state
  let searchExclusions = [];
  let searchMinLikes = 0;
  let showExclusionModal = false;
  let showFullResyncModal = false;
  let fullResyncConfirmed = false;
  let newExclusionFilter = '';
  
  // Developer Support (EPOCH + Passive Hashing) state
  let epochStats = { 
    enabled: true, 
    active: false, 
    paused: false,
    pause_reason: '',
    worker_running: false,
    hashes: 0, 
    miniblocks: 0,
    total_hashes: 0,
    total_hashes_str: '0',
    total_miniblocks: 0,
    uptime_seconds: 0
  };
  let epochEnabled = true;
  let epochMaxHashes = 100;
  let epochMaxThreads = 2;
  
  // Simulator state
  let simulatorStatus = {
    isInitialized: false,
    isStarting: false,
    daemonRunning: false,
    walletOpen: false,
    walletAddress: '',
    balance: 0,
    balanceDERO: 0,
    blockHeight: 0
  };
  let simulatorLoading = false;
  let simulatorError = '';
  let simulatorSuccess = '';
  let simulatorStatusInterval;
  let epochStatsInterval;
  let consoleLogsInterval;
  let epochError = '';
  let devSupportStats = null;
  
  // Console viewport for auto-scroll
  let consoleViewport;
  let consoleUserScrolled = false; // Track if user has scrolled up
  let previousLogCount = 0; // Track log count to detect new logs
  
  // Advanced Node Options state
  let fastSyncEnabled = false;
  let pruneHistory = 0;
  let syncNodeEndpoint = '';
  let advancedNodeLoading = false;
  
  onMount(async () => {
    // Register event listener immediately so it's ready before any async work
    const handleNavigateSection = (e) => {
      const { section } = e.detail;
      if (section && sections.find(s => s.id === section)) {
        activeSection = section;
      }
    };
    window.addEventListener('navigate-section', handleNavigateSection);
    window._settingsNavigateHandler = handleNavigateSection;
    
    // Sync network mode from backend first
    await syncNetworkMode();
    await refreshNodeStatus();
    nodeDataDir = $settingsState.nodeDataDir || '';
    
    // Pre-fill the endpoint input with the stored value so users can see
    // and verify what HOLOGRAM is currently configured to connect to.
    // Only initialize if the user hasn't typed anything yet.
    if (!customEndpoint && $settingsState.daemonEndpoint) {
      customEndpoint = $settingsState.daemonEndpoint;
    }
    
    // Subscribe to network mode changes
    EventsOn('network-mode-changed', async () => {
      await syncNetworkMode();
      customEndpoint = $appState.currentEndpoint || $settingsState.daemonEndpoint || customEndpoint;
    });
    
    // Listen for simulator crash events
    EventsOn('simulator:crashed', async (data) => {
      console.error('[Settings] Simulator crashed!', data);
      simulatorError = 'Simulator daemon crashed unexpectedly. Check console for details.';
      simulatorStatus = { ...simulatorStatus, status: 'crashed', running: false };
      await refreshSimulatorStatus();
    });
    
    // Listen for node stopped events
    EventsOn('node:stopped', async (data) => {
      console.log('[Settings] Node stopped event:', data);
      if (data.network === 'simulator' && data.unexpected) {
        simulatorError = 'Simulator daemon stopped unexpectedly';
        await refreshSimulatorStatus();
      }
    });
    
    await loadPermissionTypes();
    await initEpochPanel();
    await loadAdvancedNodeConfig();
    await loadAppInfo();
  });
  
  // Load app version info
  async function loadAppInfo() {
    try {
      const info = await GetAppInfo();
      appInfo = { ...appInfo, ...info };
    } catch (e) {
      console.error('Failed to load app info:', e);
    }
  }
  
  // EPOCH (Developer Support) functions
  async function initEpochPanel() {
    try {
      epochEnabled = await IsDevSupportEnabled();
      await refreshEpochStats();
      await refreshDevSupportStats();
    } catch (e) {
      console.error('Failed to init Developer Support panel:', e);
    }
  }
  
  async function refreshEpochStats() {
    try {
      const stats = await GetEpochStats();
      epochStats = { ...epochStats, ...stats };
      epochEnabled = stats.enabled;
      epochMaxHashes = stats.max_hashes || 100;
      epochMaxThreads = stats.max_threads || 2;
    } catch (e) {
      console.error('Failed to get EPOCH stats:', e);
    }
  }
  
  async function refreshDevSupportStats() {
    try {
      const stats = await GetDevSupportStats();
      if (stats.success) {
        devSupportStats = stats;
      }
    } catch (e) {
      console.error('Failed to get Developer Support stats:', e);
    }
  }
  
  async function handleToggleEpoch() {
    epochError = '';
    try {
      // Note: epochEnabled is already updated by bind:checked before this handler runs
      // So we use the current value, not !epochEnabled
      const result = await SetDevSupportEnabled(epochEnabled);
      if (!result.success && result.error && !result.error.includes('No wallet')) {
        epochError = result.error;
        // Revert the toggle on error
        epochEnabled = !epochEnabled;
      }
      await refreshEpochStats();
      await refreshDevSupportStats();
      
      if (epochEnabled) {
        startEpochStatsPolling();
      } else {
        stopEpochStatsPolling();
      }
    } catch (e) {
      epochError = e.message || 'Failed to toggle developer support';
      // Revert the toggle on error
      epochEnabled = !epochEnabled;
    }
  }
  
  async function handleUpdateEpochConfig() {
    epochError = '';
    try {
      const result = await SetEpochConfig(epochMaxHashes, epochMaxThreads);
      if (!result.success) {
        epochError = result.error || 'Failed to update configuration';
        return;
      }
      await refreshEpochStats();
    } catch (e) {
      epochError = e.message || 'Failed to update configuration';
    }
  }
  
  async function handleRetryEpoch() {
    epochError = '';
    try {
      const result = await InitializeEpoch();
      if (!result.success) {
        epochError = result.error || 'Failed to connect';
        return;
      }
      await refreshEpochStats();
      startEpochStatsPolling();
    } catch (e) {
      epochError = e.message || 'Failed to connect';
    }
  }
  
  function startEpochStatsPolling() {
    if (epochStatsInterval) return;
    epochStatsInterval = setInterval(async () => {
      await refreshEpochStats();
      await refreshDevSupportStats();
    }, 5000);
  }
  
  function stopEpochStatsPolling() {
    if (epochStatsInterval) {
      clearInterval(epochStatsInterval);
      epochStatsInterval = null;
    }
  }
  
  // Format uptime seconds to human readable
  function formatUptime(seconds) {
    if (!seconds || seconds < 60) {
      return `${seconds || 0}s`;
    } else if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}m ${s}s`;
    } else {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}h ${m}m`;
    }
  }
  
  // Advanced Node Options functions
  async function loadAdvancedNodeConfig() {
    try {
      const config = await GetNodeAdvancedConfig();
      if (config.success !== false) {
        fastSyncEnabled = config.fastSync || false;
        pruneHistory = config.pruneHistory || 0;
        syncNodeEndpoint = config.syncNodeEndpoint || '';
      }
    } catch (e) {
      console.error('Failed to load advanced node config:', e);
    }
  }
  
  async function saveAdvancedNodeConfig() {
    advancedNodeLoading = true;
    try {
      const result = await SetNodeAdvancedConfig(fastSyncEnabled, pruneHistory, syncNodeEndpoint);
      if (!result.success) {
        console.error('Failed to save:', result.error);
      }
    } catch (e) {
      console.error('Failed to save advanced node config:', e);
    } finally {
      advancedNodeLoading = false;
    }
  }
  
  // Simulator functions
  async function refreshSimulatorStatus() {
    try {
      const result = await GetSimulatorStatus();
      if (result.success) {
        simulatorStatus = { ...simulatorStatus, ...result };
      }
    } catch (e) {
      console.error('Failed to get simulator status:', e);
    }
  }
  
  async function startSimulator() {
    simulatorLoading = true;
    simulatorError = '';
    simulatorSuccess = '';
    
    try {
      const result = await StartSimulatorMode();
      if (result.success) {
        simulatorSuccess = 'Simulator started successfully';
        await refreshSimulatorStatus();
      } else {
        simulatorError = result.error || 'Failed to start simulator';
      }
    } catch (e) {
      simulatorError = e.message || 'Failed to start simulator';
    } finally {
      simulatorLoading = false;
    }
  }
  
  async function stopSimulator() {
    simulatorLoading = true;
    simulatorError = '';
    
    try {
      const result = await StopSimulatorMode();
      if (result.success) {
        simulatorSuccess = 'Simulator stopped';
        await refreshSimulatorStatus();
      } else {
        simulatorError = result.error || 'Failed to stop simulator';
      }
    } catch (e) {
      simulatorError = e.message || 'Failed to stop simulator';
    } finally {
      simulatorLoading = false;
    }
  }
  
  // Track if we're showing the reset confirmation
  let showResetConfirm = false;
  
  async function resetSimulator() {
    console.log('[Settings] Reset button clicked, showing confirmation');
    showResetConfirm = true;
  }
  
  async function confirmReset() {
    console.log('[Settings] Reset confirmed, proceeding...');
    showResetConfirm = false;
    simulatorLoading = true;
    simulatorError = '';
    simulatorSuccess = '';
    
    try {
      console.log('[Settings] Calling ResetSimulator...');
      const result = await ResetSimulator();
      console.log('[Settings] ResetSimulator result:', result);
      
      if (result.success) {
        simulatorSuccess = 'Simulator reset complete';
        await refreshSimulatorStatus();
      } else {
        simulatorError = result.error || 'Reset failed';
      }
    } catch (e) {
      console.error('[Settings] ResetSimulator error:', e);
      simulatorError = e.message || 'Reset failed';
    } finally {
      simulatorLoading = false;
    }
  }
  
  function cancelReset() {
    console.log('[Settings] Reset cancelled');
    showResetConfirm = false;
  }
  
  function formatSimulatorAddress(addr) {
    if (!addr) return '—';
    return addr.substring(0, 12) + '...' + addr.substring(addr.length - 8);
  }
  
  function clearSimulatorMessages() {
    simulatorError = '';
    simulatorSuccess = '';
  }
  
  function startSimulatorPolling() {
    if (simulatorStatusInterval) return;
    simulatorStatusInterval = setInterval(refreshSimulatorStatus, 3000);
  }
  
  function stopSimulatorPolling() {
    if (simulatorStatusInterval) {
      clearInterval(simulatorStatusInterval);
      simulatorStatusInterval = null;
    }
  }
  
  // Start polling when EPOCH section becomes active
  $: if (activeSection === 'developer-support') {
    refreshEpochStats();
    if (epochEnabled) {
      startEpochStatsPolling();
    }
  }
  
  // Start polling when Simulator section becomes active
  $: if (activeSection === 'simulator') {
    refreshSimulatorStatus();
    startSimulatorPolling();
  } else {
    stopSimulatorPolling();
  }
  
  // Console log functions
  async function loadConsoleLogs() {
    try {
      const logs = await GetConsoleLogs();
      consoleLogs.set(logs.map(log => ({
        timestamp: log.timestamp || log.Timestamp || new Date().toLocaleTimeString(),
        message: log.message || log.Message || '',
        level: log.level || log.Level || 'info'
      })));
    } catch (e) {
      console.error('Failed to load console logs:', e);
    }
  }
  
  function startConsoleLogsPolling() {
    if (consoleLogsInterval) return;
    loadConsoleLogs(); // Load immediately
    consoleLogsInterval = setInterval(loadConsoleLogs, 1000); // Poll every second
  }
  
  function stopConsoleLogsPolling() {
    if (consoleLogsInterval) {
      clearInterval(consoleLogsInterval);
      consoleLogsInterval = null;
    }
  }
  
  // Copy recent console logs to clipboard
  async function copyRecentLogs(lineCount) {
    const logs = $consoleLogs.slice(-lineCount);
    const text = logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error('Failed to copy logs:', e);
    }
  }
  
  // Clear console logs (both frontend and backend)
  async function handleClearLogs() {
    try {
      await ClearBackendLogs();
      clearConsoleLogs(); // Also clear frontend store
      previousLogCount = 0; // Reset count so auto-scroll works again
      consoleUserScrolled = false; // Reset scroll state
    } catch (e) {
      console.error('Failed to clear logs:', e);
    }
  }
  
  // Check if user is at bottom of console
  function handleConsoleScroll() {
    if (!consoleViewport) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleViewport;
    // Consider "at bottom" if within 100px of the bottom (more generous threshold)
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    consoleUserScrolled = distanceFromBottom > 100;
  }
  
  // Auto-scroll console to bottom ONLY when new logs are added AND user is at bottom
  // This prevents the "fighting" behavior where scroll keeps jumping back
  $: if ($consoleLogs && consoleViewport) {
    const currentLogCount = $consoleLogs.length;
    // Only scroll if new logs were added (not just on any reactive trigger)
    if (currentLogCount > previousLogCount && !consoleUserScrolled) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        if (consoleViewport && !consoleUserScrolled) {
          consoleViewport.scrollTop = consoleViewport.scrollHeight;
        }
      });
    }
    previousLogCount = currentLogCount;
  }
  
  // Start polling when Console section becomes active
  $: if (activeSection === 'console') {
    startConsoleLogsPolling();
  } else {
    stopConsoleLogsPolling();
  }
  
  async function loadPermissionTypes() {
    try {
      permissionTypes = await GetPermissionTypes();
    } catch (e) {
      console.error('Failed to load permission types:', e);
    }
  }
  
  async function loadConnectedApps() {
    isLoadingApps = true;
    try {
      connectedApps = await GetConnectedApps();
    } catch (e) {
      console.error('Failed to load connected apps:', e);
      connectedApps = [];
    } finally {
      isLoadingApps = false;
    }
  }
  
  async function revokeAllPermissions(origin) {
    try {
      await RevokeAppPermissions(origin);
      await loadConnectedApps();
      selectedApp = null;
    } catch (e) {
      console.error('Failed to revoke permissions:', e);
    }
  }
  
  async function revokePermission(origin, permission) {
    try {
      await RevokeAppPermission(origin, permission);
      await loadConnectedApps();
    } catch (e) {
      console.error('Failed to revoke permission:', e);
    }
  }
  
  function formatTimestamp(ts) {
    if (!ts) return 'Unknown';
    const date = new Date(ts * 1000);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
  
  function getPermissionLabel(permId) {
    const perm = permissionTypes.find(p => p.id === permId);
    return perm?.name || permId;
  }

  function formatAddress(addr) {
    if (!addr) return '';
    return addr.slice(0, 12) + '...' + addr.slice(-8);
  }
  
  // Load apps when section becomes active
  $: if (activeSection === 'connected-apps') {
    loadConnectedApps();
  }
  
  // Load privacy mode data when section becomes active
  $: if (activeSection === 'privacy') {
    loadPrivacyModeData();
    loadRingMemberSets();
  }
  
  async function loadPrivacyModeData() {
    privacyLoading = true;
    try {
      const status = await GetNetworkFilterStatus();
      if (status.success) {
        privacyModeEnabled = status.enabled;
        allowedHosts = status.allowedHosts || [];
      }
      
      const log = await GetConnectionLog(50);
      if (log.success) {
        connectionLog = log.log || [];
      }
      
      const connections = await GetActiveConnections();
      if (connections.success) {
        activeConnections = connections.connections || [];
      }
    } catch (e) {
      console.error('Failed to load privacy mode data:', e);
    } finally {
      privacyLoading = false;
    }
  }
  
  async function togglePrivacyMode() {
    try {
      const result = await SetPrivacyMode(!privacyModeEnabled);
      if (result.success) {
        privacyModeEnabled = result.enabled;
        // Sync the store so the sidebar anchor reflects the seal immediately
        // (loadSettings only maps privacy_mode on startup).
        settingsState.update(s => ({ ...s, privacyMode: result.enabled }));
      }
    } catch (e) {
      console.error('Failed to toggle privacy mode:', e);
    }
  }
  
  async function addHost() {
    if (!newAllowedHost.trim()) return;
    try {
      const result = await AddAllowedHost(newAllowedHost.trim());
      if (result.success) {
        await loadPrivacyModeData();
        newAllowedHost = '';
      }
    } catch (e) {
      console.error('Failed to add host:', e);
    }
  }
  
  async function removeHost(host) {
    try {
      const result = await RemoveAllowedHost(host);
      if (result.success) {
        await loadPrivacyModeData();
      }
    } catch (e) {
      console.error('Failed to remove host:', e);
    }
  }

  // ── Ring Members (decoy curation) ───────────────────────────────────
  async function loadRingMemberSets() {
    try {
      const result = await GetRingMemberSets();
      if (result.success) {
        ringMemberSets = result.sets || [];
        // keep the editor open on a still-existing set; otherwise close it
        if (selectedRingSetId && !ringMemberSets.some(s => s.id === selectedRingSetId)) {
          selectedRingSetId = '';
        }
        if (selectedRingSet) probeRingMembers(selectedRingSet.members || []);
      }
    } catch (e) {
      console.error('Failed to load ring member sets:', e);
    }
  }

  async function addRingSet() {
    ringMemberError = '';
    const name = newRingSetName.trim();
    if (!name) return;
    try {
      const result = await AddRingMemberSet(name);
      if (result.success) {
        newRingSetName = '';
        await loadRingMemberSets();
        if (result.set?.id) selectedRingSetId = result.set.id; // open the new set
      } else {
        ringMemberError = result.error || 'Could not create set';
      }
    } catch (e) {
      console.error('Failed to add ring set:', e);
    }
  }

  function openRingSet(id) {
    selectedRingSetId = (selectedRingSetId === id) ? '' : id;
    ringMemberError = '';
    const set = ringMemberSets.find(s => s.id === id);
    if (set) probeRingMembers(set.members || []);
  }

  async function deleteRingSet(id) {
    if (ringSetDeleteArmed !== id) { ringSetDeleteArmed = id; return; } // confirm-tap
    ringSetDeleteArmed = '';
    try {
      const result = await DeleteRingMemberSet(id);
      if (result.success) {
        if (selectedRingSetId === id) selectedRingSetId = '';
        await loadRingMemberSets();
      }
    } catch (e) {
      console.error('Failed to delete ring set:', e);
    }
  }

  async function addRingMember() {
    ringMemberError = '';
    const addr = newRingMemberAddr.trim();
    if (!addr || !selectedRingSetId) return;
    try {
      const result = await AddRingMember(selectedRingSetId, addr);
      if (result.success) {
        newRingMemberAddr = '';
        await loadRingMemberSets();
        probeOne(addr);
      } else {
        ringMemberError = result.error || 'Could not add address';
      }
    } catch (e) {
      console.error('Failed to add ring member:', e);
    }
  }

  async function removeRingMember(addr) {
    if (!selectedRingSetId) return;
    try {
      const result = await RemoveRingMember(selectedRingSetId, addr);
      if (result.success) await loadRingMemberSets();
    } catch (e) {
      console.error('Failed to remove ring member:', e);
    }
  }

  // Advisory registration probe — mirrors the send-time check. A non-registered
  // (or unreachable) result reads as ⚠, never a hard claim, since the send path
  // gracefully skips such members anyway.
  async function probeOne(addr) {
    ringMemberStatus = { ...ringMemberStatus, [addr]: 'checking' };
    try {
      const result = await IsAddressRegistered(addr);
      ringMemberStatus = {
        ...ringMemberStatus,
        [addr]: (result.success && result.registered) ? 'ok' : 'unregistered',
      };
    } catch (e) {
      ringMemberStatus = { ...ringMemberStatus, [addr]: 'unregistered' };
    }
  }

  function probeRingMembers(members) {
    for (const m of members) {
      if (!ringMemberStatus[m]) probeOne(m);
    }
  }
  
  async function clearLog() {
    try {
      await ClearConnectionLog();
      connectionLog = [];
    } catch (e) {
      console.error('Failed to clear log:', e);
    }
  }
  
  onDestroy(() => {
    if (statusInterval) clearInterval(statusInterval);
    if (simulatorStatusInterval) clearInterval(simulatorStatusInterval);
    if (epochStatsInterval) clearInterval(epochStatsInterval);
    if (consoleLogsInterval) clearInterval(consoleLogsInterval);
    EventsOff('network-mode-changed');
    EventsOff('simulator:crashed');
    EventsOff('node:stopped');
    if (window._settingsNavigateHandler) {
      window.removeEventListener('navigate-section', window._settingsNavigateHandler);
      window._settingsNavigateHandler = null;
    }
  });
  
  async function refreshNodeStatus() {
    try {
      // Check derod installation status
      derodStatus = await CheckDerodStatus();
      
      // Check for running node
      const nodeCheck = await GetNodeStatus();
      nodeStatus = nodeCheck;
      
      // If node is running, start polling for sync status
      if (nodeStatus.isRunning) {
        startSyncPolling();
      }
    } catch (error) {
      console.error('Failed to refresh node status:', error);
    }
  }
  
  function startSyncPolling() {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(async () => {
      if (nodeStatus.isRunning) {
        syncProgress = await GetSyncProgress();
      }
    }, 5000);
  }
  
  // Node start/stop controls moved to Network page
  function focusAdvancedOptions() {
    if (advancedOptionsCard?.scrollIntoView) {
      advancedOptionsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  
  async function handleNodeModeToggle(useEmbedded) {
    if (useEmbedded) {
      await switchToEmbeddedNode();
    } else {
      await updateSetting('useEmbeddedNode', false);
    }
  }
  
  async function startEmbeddedNode() {
    if (nodeActionLoading) return;
    nodeActionLoading = true;
    nodeActionError = '';
    try {
      focusAdvancedOptions();
      await updateSetting('useEmbeddedNode', true);
      if (nodeDataDir !== $settingsState.nodeDataDir) {
        await updateSetting('nodeDataDir', nodeDataDir);
      }
      const result = await StartNode(nodeDataDir);
      if (result.isExternal) {
        nodeActionError = result.message || 'External node detected on the default port. Stop it to start the embedded node.';
        await updateSetting('useEmbeddedNode', false);
      } else if (!result.success) {
        nodeActionError = result.error || 'Failed to start node';
      }
      await refreshNodeStatus();
    } catch (error) {
      nodeActionError = error.message || 'Failed to start node';
    } finally {
      nodeActionLoading = false;
    }
  }
  
  async function stopEmbeddedNode() {
    if (nodeActionLoading) return;
    nodeActionLoading = true;
    nodeActionError = '';
    try {
      const result = await StopNode();
      if (!result.success) {
        nodeActionError = result.error || 'Failed to stop node';
      }
      await refreshNodeStatus();
    } catch (error) {
      nodeActionError = error.message || 'Failed to stop node';
    } finally {
      nodeActionLoading = false;
    }
  }
  
  async function switchToEmbeddedNode() {
    if (nodeActionLoading) return;
    nodeActionLoading = true;
    nodeActionError = '';
    try {
      await updateSetting('useEmbeddedNode', true);
      if (isExternalNode) {
        await updateSetting('daemonEndpoint', 'http://127.0.0.1:10102');
      }
      await refreshNodeStatus();
    } catch (error) {
      nodeActionError = error.message || 'Failed to switch to embedded node';
    } finally {
      nodeActionLoading = false;
    }
  }
  
  async function detectExternalNode() {
    detecting = true;
    detectionMessage = '';
    try {
      const result = await DetectRunningNode();
      if (result.found) {
        // Update settings with detected endpoint
        await updateSetting('daemonEndpoint', result.endpoint);
        detectionMessage = `Found node at ${result.endpoint}`;
      } else {
        detectionMessage = 'No running node detected';
      }
    } catch (error) {
      detectionMessage = `Error: ${error.message || 'Failed to detect node'}`;
    } finally {
      detecting = false;
      // Clear message after 5 seconds
      setTimeout(() => detectionMessage = '', 5000);
    }
  }
  
  // Test & Connect to custom endpoint (for LAN/power users)
  let testingEndpoint = false;
  let endpointTestResult = null;
  let customEndpoint = '';
  
  async function testAndConnect() {
    const endpoint = customEndpoint || $settingsState.daemonEndpoint;
    if (!endpoint) {
      endpointTestResult = { success: false, error: 'Please enter an endpoint' };
      return;
    }
    
    testingEndpoint = true;
    endpointTestResult = null;
    
    try {
      const result = await TestAndConnectEndpoint(endpoint);
      endpointTestResult = result;
      
      if (result.success) {
        // Update the settings state with the new endpoint
        await updateSetting('daemonEndpoint', result.endpoint);
        customEndpoint = result.endpoint;
      }
    } catch (error) {
      endpointTestResult = { 
        success: false, 
        error: error.message || 'Connection test failed' 
      };
    } finally {
      testingEndpoint = false;
      // Clear success message after 10 seconds
      if (endpointTestResult?.success) {
        setTimeout(() => endpointTestResult = null, 10000);
      }
    }
  }
  
  async function updateSetting(key, value) {
    // Use the centralized saveSetting which handles key mapping
    await saveSetting(key, value);
  }
  
  // Handle network mode change - syncs with backend
  async function handleNetworkChange(newNetwork) {
    try {
      if (newNetwork === $appState.network) {
        return;
      }
      if (newNetwork === 'simulator') {
        const simulatorResult = await StartSimulatorMode();
        if (simulatorResult.success) {
          await refreshSimulatorStatus();
          await syncNetworkMode();
          customEndpoint = $appState.currentEndpoint || $settingsState.daemonEndpoint || customEndpoint;
          toast.success(simulatorResult.message || 'Simulator mode activated');
        } else {
          toast.warning(simulatorResult.error || 'Failed to start simulator mode');
        }
        return;
      }
      if (newNetwork === 'mainnet' && $appState.network === 'simulator') {
        const stopResult = await StopSimulatorMode();
        if (!stopResult.success) {
          toast.warning(stopResult.error || 'Failed to stop simulator mode');
          return;
        }
        await refreshSimulatorStatus();
        await syncNetworkMode();
        customEndpoint = $appState.currentEndpoint || $settingsState.daemonEndpoint || customEndpoint;
        return;
      }
      // Update backend network mode
      const result = await SetNetworkMode(newNetwork);
      if (result.success) {
        // Sync network mode from backend (this updates appState and settingsState)
        await syncNetworkMode();
      } else {
        toast.warning(result.error || 'Failed to set network mode');
        console.error('Failed to set network mode:', result.error);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to change network mode');
      console.error('Failed to change network mode:', error);
    }
  }
  
  async function handleGnomonToggle() {
    try {
      if ($appState.gnomonRunning) {
        await StopGnomon();
      } else {
        await StartGnomon();
      }
    } finally {
      await updateStatus();
    }
  }
  
  async function handleResyncGnomon() {
    if ($appState.gnomonRunning) {
      console.warn('[Gnomon] Cannot resync while running');
      return;
    }
    
    resyncingGnomon = true;
    try {
      const result = await ResyncGnomon();
      if (result.success) {
        console.log('[Gnomon] Resync started:', result.message);
      } else {
        console.error('[Gnomon] Resync failed:', result.error);
      }
    } catch (e) {
      console.error('[Gnomon] Resync error:', e);
    } finally {
      resyncingGnomon = false;
      await updateStatus();
    }
  }
  
  async function handleResyncFromHeight() {
    const height = parseInt(resyncFromHeight, 10);
    if (isNaN(height) || height < 0) {
      console.error('[Gnomon] Invalid height:', resyncFromHeight);
      return;
    }
    
    if ($appState.gnomonRunning) {
      console.warn('[Gnomon] Cannot resync while running');
      return;
    }
    
    resyncingFromHeight = true;
    try {
      const result = await ResyncGnomonFromHeight(height);
      if (result.success) {
        console.log('[Gnomon] Resync from height started:', result.message);
        resyncFromHeight = ''; // Clear input on success
      } else {
        console.error('[Gnomon] Resync from height failed:', result.error);
      }
    } catch (e) {
      console.error('[Gnomon] Resync from height error:', e);
    } finally {
      resyncingFromHeight = false;
      await updateStatus();
    }
  }
  
  function handleResyncRecent() {
    // Get current block height and go back 1000 blocks
    const currentHeight = $appState.gnomonHeight || 0;
    const targetHeight = Math.max(0, currentHeight - 1000);
    resyncFromHeight = targetHeight.toString();
    handleResyncFromHeight();
  }
  
  async function handleFastsync() {
    if ($appState.gnomonRunning) {
      console.warn('[Gnomon] Cannot resync while running');
      return;
    }
    
    resyncingGnomon = true;
    try {
      // Fastsync uses the default ResyncGnomon which enables fastsync
      const result = await ResyncGnomon();
      if (result.success) {
        console.log('[Gnomon] Fastsync started:', result.message);
      } else {
        console.error('[Gnomon] Fastsync failed:', result.error);
      }
    } catch (e) {
      console.error('[Gnomon] Fastsync error:', e);
    } finally {
      resyncingGnomon = false;
      await updateStatus();
    }
  }
  
  async function handleFullResync() {
    if ($appState.gnomonRunning) {
      console.warn('[Gnomon] Cannot resync while running');
      return;
    }
    
    // Show modal instead of confirm() (confirm doesn't work reliably in Wails)
    fullResyncConfirmed = false;
    showFullResyncModal = true;
  }
  
  async function confirmFullResync() {
    showFullResyncModal = false;
    fullResyncConfirmed = false;
    resyncingGnomon = true;
    try {
      // Full resync from block 0
      const result = await ResyncGnomonFromHeight(0);
      if (result.success) {
        console.log('[Gnomon] Full resync started:', result.message);
      } else {
        console.error('[Gnomon] Full resync failed:', result.error);
      }
    } catch (e) {
      console.error('[Gnomon] Full resync error:', e);
    } finally {
      resyncingGnomon = false;
      await updateStatus();
    }
  }
  
  async function handleFastsyncInstead() {
    showFullResyncModal = false;
    fullResyncConfirmed = false;
    await handleFastsync();
  }
  
  function cancelFullResync() {
    showFullResyncModal = false;
    fullResyncConfirmed = false;
  }
  
  // Search exclusions functions
  async function loadSearchExclusions() {
    try {
      const result = await GetSearchExclusions();
      if (result.success) {
        searchExclusions = result.exclusions || [];
        searchMinLikes = result.minLikes || 0;
      }
    } catch (e) {
      console.error('[Exclusions] Load failed:', e);
    }
  }
  
  async function addExclusion() {
    const filter = newExclusionFilter.trim();
    if (!filter) return;
    
    try {
      const result = await AddSearchExclusion(filter);
      if (result.success) {
        searchExclusions = result.exclusions || [];
        newExclusionFilter = '';
      }
    } catch (e) {
      console.error('[Exclusions] Add failed:', e);
    }
  }
  
  async function removeExclusion(filter) {
    try {
      const result = await RemoveSearchExclusion(filter);
      if (result.success) {
        searchExclusions = result.exclusions || [];
      }
    } catch (e) {
      console.error('[Exclusions] Remove failed:', e);
    }
  }
  
  async function clearAllExclusions() {
    if (!confirm('Clear all search exclusion filters?')) return;
    
    try {
      const result = await ClearSearchExclusions();
      if (result.success) {
        searchExclusions = [];
      }
    } catch (e) {
      console.error('[Exclusions] Clear failed:', e);
    }
  }
  
  async function updateMinLikes() {
    try {
      await SetSearchMinLikes(searchMinLikes);
    } catch (e) {
      console.error('[Exclusions] Set min likes failed:', e);
    }
  }
  
  // Handle Gnomon auto-start toggle
  async function handleGnomonAutostartToggle() {
    gnomonAutostart = !gnomonAutostart;
    try {
      await SetGnomonAutostart(gnomonAutostart);
    } catch (e) {
      console.error('[Gnomon] Failed to save auto-start setting:', e);
      gnomonAutostart = !gnomonAutostart; // Revert on error
    }
  }
  
  // Load autostart setting
  async function loadGnomonAutostart() {
    try {
      gnomonAutostart = await GetGnomonAutostart();
    } catch (e) {
      console.error('[Gnomon] Failed to load auto-start setting:', e);
    }
  }
  
  // === Simple-Gnomon Feature Handlers ===
  
  // Toggle WebSocket API server
  async function handleGnomonWSToggle() {
    gnomonWSLoading = true;
    try {
      if (gnomonWSStatus.running) {
        const result = await StopGnomonWSServer();
        if (result.success) {
          gnomonWSStatus = { running: false, address: '', port: 0, clients: 0 };
        }
      } else {
        const result = await StartGnomonWSServer('');
        if (result.success) {
          gnomonWSStatus = {
            running: true,
            address: result.address || '127.0.0.1:9190',
            port: result.port || 9190,
            clients: 0
          };
        }
      }
    } catch (e) {
      console.error('[Gnomon-WS] Toggle failed:', e);
    } finally {
      gnomonWSLoading = false;
    }
  }
  
  // Load WebSocket API status
  async function loadGnomonWSStatus() {
    try {
      const status = await GetGnomonWSStatus();
      gnomonWSStatus = {
        running: status.running || false,
        address: status.address || '',
        port: status.port || 0,
        clients: status.clients || 0
      };
    } catch (e) {
      console.error('[Gnomon-WS] Failed to load status:', e);
    }
  }
  
  // Load tag statistics
  async function loadTagStats() {
    try {
      const stats = await GetTagStats();
      if (stats.success) {
        tagStats = {
          total_scids: stats.total_scids || 0,
          class_counts: stats.class_counts || {},
          tag_counts: stats.tag_counts || {}
        };
      }
    } catch (e) {
      console.error('[Tags] Failed to load stats:', e);
    }
  }
  
  // Rebuild tag index
  async function handleRebuildTagIndex() {
    rebuildingTags = true;
    try {
      const result = await RebuildTagIndex();
      if (result.success) {
        console.log('[Tags] Rebuild complete:', result.count, 'SCIDs classified');
        await loadTagStats(); // Refresh stats
      } else {
        console.error('[Tags] Rebuild failed:', result.error);
      }
    } catch (e) {
      console.error('[Tags] Rebuild error:', e);
    } finally {
      rebuildingTags = false;
    }
  }
  
  // Time Machine Watch List functions
  async function loadWatchedSCs() {
    watchedSCsLoading = true;
    try {
      const result = await GetWatchedSmartContracts();
      if (result.success) {
        watchedSCs = result.watched || [];
      }
    } catch (e) {
      console.error('[Watch] Failed to load watched SCs:', e);
    } finally {
      watchedSCsLoading = false;
    }
  }
  
  async function unwatchSC(scid) {
    try {
      const result = await UnwatchSmartContract(scid);
      if (result.success) {
        watchedSCs = watchedSCs.filter(w => w.scid !== scid);
      }
    } catch (e) {
      console.error('[Watch] Failed to unwatch:', e);
    }
  }
  
  async function refreshWatchedSCs() {
    refreshingWatched = true;
    try {
      const result = await RefreshWatchedSCs();
      if (result.success) {
        console.log('[Watch] Refresh complete:', result.changes_detected, 'changes');
        await loadWatchedSCs();
      }
    } catch (e) {
      console.error('[Watch] Refresh failed:', e);
    } finally {
      refreshingWatched = false;
    }
  }
  
  function formatWatchTime(timestamp) {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString();
    } catch (e) {
      return '';
    }
  }
  
  // Load settings on gnomon section activation
  $: if (activeSection === 'gnomon') {
    loadSearchExclusions();
    loadGnomonAutostart();
    loadGnomonWSStatus();
    loadTagStats();
    loadWatchedSCs();
  }
  
</script>

<div class="page-layout">
  <!-- v5.6 Page Header -->
  <div class="page-header">
    <div class="page-header-inner">
      <div class="page-header-left">
        <h1 class="page-header-title">
          <SettingsIcon size={18} class="page-header-icon" strokeWidth={1.5} />
          Settings
        </h1>
        <p class="page-header-desc">Configure application preferences</p>
      </div>
    </div>
  </div>
  
  <!-- v5.6 Unified Page Body -->
  <div class="page-body">
    <!-- Sidebar -->
    <div class="page-sidebar">
      <div class="page-sidebar-section">SECTIONS</div>
      <nav class="page-sidebar-nav">
      {#each sections as section}
        <button
          on:click={() => activeSection = section.id}
            class="page-sidebar-item"
          class:active={activeSection === section.id}
        >
            <span class="page-sidebar-item-icon">
              <Icons name={section.iconName} size={14} />
          </span>
            <span class="page-sidebar-item-label">{section.label}</span>
        </button>
      {/each}
    </nav>
  </div>
  
    <!-- Content Area -->
    <div class="page-content">
      {#if activeSection === 'general'}
        <!-- Content Filtering -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">CONTENT FILTERING</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row settings-row-stack">
              <div class="form-group settings-form-group">
              <div class="slider-header">
                <span class="form-label">Minimum Content Rating</span>
                <span class="slider-value c-cyan">{$settingsState.minRating}</span>
              </div>
              <input
                type="range"
                min="0"
                max="99"
                bind:value={$settingsState.minRating}
                on:change={(e) => updateSetting('minRating', parseInt(e.target.value))}
                class="slider"
              />
              </div>
            </div>
            
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Block Malware</div>
                <div class="settings-row-desc">Block content rated 0-9 (potentially harmful)</div>
              </div>
                <input
                  type="checkbox"
                  bind:checked={$settingsState.blockMalware}
                  on:change={(e) => updateSetting('blockMalware', e.target.checked)}
                class="toggle"
                />
            </div>
            
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Show NSFW Content</div>
                <div class="settings-row-desc">Display adult content when available</div>
              </div>
                <input
                  type="checkbox"
                  bind:checked={$settingsState.showNSFW}
                  on:change={(e) => updateSetting('showNSFW', e.target.checked)}
                class="toggle"
                />
            </div>
          </div>
        </div>
        
        <!-- Connection -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">CONNECTION</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Auto-connect XSWD</div>
                <div class="settings-row-desc">Automatically connect to XSWD wallet service on startup</div>
              </div>
                <input
                  type="checkbox"
                  bind:checked={$settingsState.autoConnectXSWD}
                  on:change={(e) => updateSetting('autoConnectXSWD', e.target.checked)}
                class="toggle"
                />
            </div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Integrated Wallet Modal</div>
                <div class="settings-row-desc">Handle dApp connections and signing directly in Hologram</div>
              </div>
                <input
                  type="checkbox"
                  bind:checked={$settingsState.integratedWallet}
                  on:change={(e) => updateSetting('integratedWallet', e.target.checked)}
                class="toggle"
                />
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'node'}
        <!-- Node Status -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">NODE STATUS</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Status</div>
                <div class="settings-row-desc">
                {#if nodeStatus.isRunning}
                  Running - {syncProgress.isSynced ? 'Synced' : `Syncing ${syncProgress.progress?.toFixed(1) || 0}%`}
                {:else}
                  Not running
                {/if}
            </div>
              </div>
              <span class="settings-hint-label">
                <Icons name="server" size={12} />
                {#if externalNodeActive}
                  External node connected — local controls disabled
                {:else}
                  Node controls below
                {/if}
              </span>
          </div>
          
            {#if nodeStatus.isRunning}
              <div class="settings-row settings-row-stack">
                <div class="sync-header">
                  <span class="settings-row-label">Sync Progress</span>
                  <span class="sync-progress-value">{syncProgress.progress?.toFixed(2) || 0}%</span>
              </div>
                <div class="progress mb-4">
                  <div class="progress-bar" style="width: {syncProgress.progress || 0}%"></div>
              </div>
                <div class="stat-grid">
                  <div class="stat-block">
                    <span class="stat-label">Height</span>
                    <span class="stat-value">{(syncProgress.topoHeight || 0).toLocaleString()}</span>
                </div>
                  <div class="stat-block">
                    <span class="stat-label">Peers</span>
                    <span class="stat-value">{syncProgress.peers || 0}</span>
                </div>
              </div>
            </div>
          {/if}
          </div>
        </div>
        
        <!-- Advanced Options -->
        <div class="card-wrapper" bind:this={advancedOptionsCard}>
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">⬢</span>
              <span class="explorer-header-title">ADVANCED OPTIONS</span>
            </div>
          </div>
          <div class="card-content">
            <p class="form-hint mb-4">These settings apply on the next node start</p>
          
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Fast Sync</div>
                <div class="settings-row-desc">Skip full block validation during initial sync (faster but less secure)</div>
              </div>
              <input 
                type="checkbox" 
                bind:checked={fastSyncEnabled}
                on:change={saveAdvancedNodeConfig}
                disabled={embeddedNodeRunning}
                class="toggle"
              />
              </div>
            
            <div class="settings-row settings-row-stack" class:opacity-50={embeddedNodeRunning}>
              <div class="form-group settings-form-group-tight">
                <label class="form-label">Prune History (blocks)</label>
              <div class="prune-input-row">
                <input
                  type="number"
                  bind:value={pruneHistory}
                  on:change={saveAdvancedNodeConfig}
                  min="0"
                  max="100000"
                  step="1000"
                  disabled={embeddedNodeRunning}
                  class="input input-narrow"
                />
                  <span class="form-hint">0 = keep all blocks</span>
              </div>
                <p class="form-hint">Remove blocks older than N to save disk space (minimum 1000 if enabled)</p>
              </div>
            </div>
            
            <div class="settings-row settings-row-stack" class:opacity-50={embeddedNodeRunning}>
              <div class="form-group settings-form-group-tight">
                <label class="form-label">Sync Node</label>
                <input
                  type="text"
                  bind:value={syncNodeEndpoint}
                  on:change={saveAdvancedNodeConfig}
                  placeholder="e.g., http://node.example.com:10102"
                  disabled={embeddedNodeRunning}
                  class="input input-mono-sm"
                />
                <p class="form-hint">Sync blockchain state from a trusted remote node instead of P2P (faster initial sync)</p>
              </div>
            </div>
            
            {#if embeddedNodeRunning}
              <p class="form-hint c-warn mt-2">Stop the node to change these settings</p>
            {/if}
          </div>
        </div>
        
        <!-- Node Controls -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">▣</span>
              <span class="explorer-header-title">CONTROLS</span>
            </div>
            <div class="explorer-header-right">
              <span class="badge {nodeModeBadgeClass}">{nodeModeLabel}</span>
            </div>
          </div>
          <div class="card-content">
            {#if nodeActionError}
              <div class="alert alert-error mb-3">
                <Icons name="x" size={14} />
                {nodeActionError}
              </div>
            {/if}
            
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Node Mode</div>
                <div class="settings-row-desc">Switch between embedded and external node modes</div>
              </div>
              <div class="btn-group node-mode-group">
                <button
                  class="btn {$settingsState.useEmbeddedNode ? 'btn-primary' : 'btn-secondary'}"
                  on:click={() => handleNodeModeToggle(true)}
                  disabled={nodeActionLoading}
                >
                  Embedded
                </button>
                <button
                  class="btn {!$settingsState.useEmbeddedNode ? 'btn-primary' : 'btn-secondary'}"
                  on:click={() => handleNodeModeToggle(false)}
                  disabled={nodeActionLoading}
                >
                  External
                </button>
              </div>
            </div>
            
            {#if !$settingsState.useEmbeddedNode}
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">External Node Active</div>
                  <div class="settings-row-desc">Local node controls are disabled while using an external endpoint.</div>
                </div>
                <span class="badge badge-cyan">External</span>
              </div>
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Stop External Node</div>
                  <div class="settings-row-desc">See how to stop the external daemon on the default port.</div>
                </div>
                <button class="btn btn-ghost btn-sm" on:click={() => showExternalNodeHelp = !showExternalNodeHelp}>
                  {showExternalNodeHelp ? 'Hide Help' : 'Show Help'}
                </button>
              </div>
              {#if showExternalNodeHelp}
                <div class="alert alert-info settings-alert-top">
                  <Icons name="info" size={14} />
                  Stop `derod` in the terminal where it is running, or free port 10102, then switch to Embedded.
                </div>
              {/if}
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Detect Running Node</div>
                  <div class="settings-row-desc">Re-check for any external node on the default port.</div>
                </div>
                <button on:click={detectExternalNode} class="btn btn-secondary btn-sm" disabled={detecting}>
                  {detecting ? 'Detecting...' : 'Detect Running Node'}
                </button>
              </div>
              {#if detectionMessage}
                <div class="alert alert-info settings-alert-top">
                  <Icons name="info" size={14} />
                  {detectionMessage}
                </div>
              {/if}
            {:else}
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Embedded Node</div>
                  <div class="settings-row-desc">Start or stop the local DERO node</div>
                </div>
                {#if embeddedNodeRunning}
                  <button class="btn btn-danger" on:click={stopEmbeddedNode} disabled={nodeActionLoading}>
                    {nodeActionLoading ? 'Stopping...' : 'Stop Node'}
                  </button>
                {:else}
                  <button class="btn btn-primary" on:click={startEmbeddedNode} disabled={nodeActionLoading || !derodStatus.installed}>
                    {nodeActionLoading ? 'Starting...' : 'Start Node'}
                  </button>
                {/if}
              </div>
              <div class="settings-row settings-row-top-sm">
                <div class="settings-row-info">
                  <div class="settings-row-label">Sync Node</div>
                  <div class="settings-row-desc">
                    {syncNodeEndpoint ? `Sync: ${syncNodeEndpoint}` : 'Sync: not set'}
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" on:click={focusAdvancedOptions}>
                  Configure
                </button>
              </div>
              {#if externalNodeActive && !embeddedNodeRunning}
                <p class="form-hint c-warn mt-2">External node detected on the default port. Stop it to start the embedded node.</p>
              {/if}
              {#if !derodStatus.installed}
                <p class="form-hint c-warn mt-2">Install the DERO node binary to start a local node.</p>
              {/if}
            {/if}
            
          </div>
        </div>
        
        <!-- Node Binary -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">▣</span>
              <span class="explorer-header-title">NODE BINARY</span>
            </div>
          </div>
          <div class="card-content">
          {#if derodStatus.installed}
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">DERO Node (derod)</div>
                  <div class="settings-row-desc settings-row-desc-inline">
                    <span class="badge badge-ok">Installed</span>
                    <span class="form-hint">{derodStatus.path || ''}</span>
                  </div>
                </div>
                <button on:click={refreshNodeStatus} class="btn btn-secondary btn-sm">Refresh</button>
            </div>
          {:else}
              <div class="settings-row settings-row-stack">
                <div class="settings-row-info settings-row-info-spaced">
                  <div class="settings-row-label">DERO Node Binary</div>
                  <div class="settings-row-desc">The DERO node binary (derod) is required to run a local node. Build from source with <code>make all</code> in the HOLOGRAM directory.</div>
                </div>
                <button on:click={refreshNodeStatus} class="btn btn-secondary btn-sm">Re-check</button>
              </div>
          {/if}
          </div>
        </div>
        
        <!-- Data Directory -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">DATA DIRECTORY</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row settings-row-stack">
              <div class="form-group settings-form-group-tight">
                <label class="form-label">Blockchain Data Location</label>
            <input
              type="text"
              bind:value={nodeDataDir}
              placeholder="~/.dero/mainnet (default)"
              disabled={embeddedNodeRunning}
                  class="input"
              on:change={() => updateSetting('nodeDataDir', nodeDataDir)}
            />
                <p class="form-hint">Leave empty to use default location based on network</p>
              </div>
            </div>
          </div>
        </div>
        
      {:else if activeSection === 'simulator'}
        <!-- Simulator Status -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">SIMULATOR STATUS</span>
            </div>
            <div class="explorer-header-right">
              <DotIndicator status={simulatorStatus.isInitialized ? 'ok' : (simulatorStatus.isStarting ? 'warn' : 'err')} />
              <span class="explorer-header-meta">{simulatorStatus.isInitialized ? 'Running' : (simulatorStatus.isStarting ? 'Starting' : 'Stopped')}</span>
            </div>
          </div>
          <div class="card-content">
            {#if simulatorError}
              <div class="alert alert-danger" on:click={clearSimulatorMessages}>{simulatorError}</div>
            {/if}
            {#if simulatorSuccess}
              <div class="alert alert-success" on:click={clearSimulatorMessages}>{simulatorSuccess}</div>
            {/if}
            
            {#if !simulatorStatus.isInitialized}
              <div class="settings-row settings-row-stack">
                <div class="settings-row-info settings-row-info-spaced">
                  <div class="settings-row-label">Local Test Environment</div>
                  <div class="settings-row-desc">Perfect for testing smart contracts and dApps. No real value.</div>
                </div>
                <button 
                  class="btn btn-primary"
                  on:click={startSimulator}
                  disabled={simulatorLoading || simulatorStatus.isStarting}
                >
                  {simulatorLoading || simulatorStatus.isStarting ? 'Starting Simulator...' : 'Start Simulator'}
                </button>
              </div>
            {:else}
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Status</div>
                  <div class="settings-row-desc c-emerald">Running</div>
                </div>
              </div>
              <div class="stat-grid">
                <div class="stat-block">
                  <span class="stat-label">BLOCK HEIGHT</span>
                  <span class="stat-value">{simulatorStatus.blockHeight?.toLocaleString() || '0'}</span>
                </div>
              </div>
              {#if simulatorStatus.walletAddress}
              <div class="settings-row settings-row-stack settings-row-stack-gap">
                  <div class="settings-row-info">
                    <div class="settings-row-label">Wallet</div>
                    <div class="settings-row-desc mono">{formatSimulatorAddress(simulatorStatus.walletAddress)}</div>
                  </div>
                  <div class="sim-wallet-balance-row">
                    <span class="sim-wallet-balance-label">Balance:</span>
                    <span class="sim-wallet-balance-value">{simulatorStatus.balanceDERO?.toFixed(5) || '0'} DERO</span>
                    <span class="sim-wallet-balance-hint">(receives mining rewards)</span>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
        
        {#if simulatorStatus.isInitialized}
          <!-- Controls -->
          <div class="card-wrapper">
            <div class="explorer-header">
              <div class="explorer-header-left">
                <span class="explorer-header-icon">▣</span>
                <span class="explorer-header-title">CONTROLS</span>
              </div>
            </div>
            <div class="card-content">
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Stop Simulator</div>
                  <div class="settings-row-desc">Shut down the local test environment</div>
                </div>
                <button class="btn btn-danger btn-sm" on:click={stopSimulator} disabled={simulatorLoading}>Stop</button>
              </div>
              <div class="settings-row">
                <div class="settings-row-info">
                  <div class="settings-row-label">Reset All Data</div>
                  <div class="settings-row-desc">Delete all simulator data and start fresh</div>
                </div>
                {#if showResetConfirm}
                  <div class="confirm-buttons">
                    <button class="btn btn-danger btn-sm" on:click={confirmReset} disabled={simulatorLoading}>Confirm</button>
                    <button class="btn btn-ghost btn-sm" on:click={cancelReset} disabled={simulatorLoading}>Cancel</button>
                  </div>
                {:else}
                  <button class="btn btn-ghost btn-sm" on:click={resetSimulator} disabled={simulatorLoading}>Reset</button>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <!-- About Simulator -->
          <div class="card-wrapper">
            <div class="explorer-header">
              <div class="explorer-header-left">
                <span class="explorer-header-icon">?</span>
                <span class="explorer-header-title">ABOUT SIMULATOR</span>
              </div>
            </div>
            <div class="card-content">
              <div class="info-list">
                <p class="info-item">
                  <strong class="c-cyan">Local Daemon</strong> - Launches a private DERO blockchain for testing.
                </p>
                <p class="info-item">
                  <strong class="c-cyan">Test Wallet</strong> - Creates a wallet automatically with test funds.
                </p>
                <p class="info-item">
                  <strong class="c-cyan">No Real Value</strong> - Perfect for development without risking real DERO.
                </p>
              </div>
            </div>
          </div>
        {/if}
      
      {:else if activeSection === 'servers'}
        <!-- TELA Servers Management -->
        <ServerManager />
      
      {:else if activeSection === 'offline-cache'}
        <!-- Offline Cache Manager -->
        <OfflineCacheManager />
      
      {:else if activeSection === 'sync-manager'}
        <!-- Sync Manager - Batch prefetch & updates -->
        <SyncManager />
      
      {:else if activeSection === 'safe-browsing'}
        <!-- Safe Browsing Settings -->
        <SafeBrowsingSettings />
      
      {:else if activeSection === 'developer-support'}
        <!-- Developer Support (Unified EPOCH + Passive Hashing) Section -->
        
        <!-- Status Card (with enable toggle in header) -->
        <div class="card-wrapper card-wrapper-spaced">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">DEVELOPER SUPPORT</span>
            </div>
            <div class="explorer-header-right">
              <label class="toggle-label">
                <span class="toggle-text">{epochEnabled ? 'Enabled' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  bind:checked={epochEnabled}
                  on:change={handleToggleEpoch}
                  class="toggle"
                />
              </label>
            </div>
          </div>
          <div class="card-content">
            <div class="dev-support-status">
              <div class="status-indicator" class:active={epochEnabled && epochStats.worker_running && !epochStats.paused} class:paused={epochStats.paused} class:disabled={!epochEnabled}>
                <span class="status-dot"></span>
                <span class="status-text">
                  {#if !epochEnabled}
                    Disabled
                  {:else if epochStats.paused}
                    Paused
                  {:else if epochStats.worker_running}
                    Actively Supporting
                  {:else if epochStats.active}
                    Ready
                  {:else}
                    Connecting...
                  {/if}
                </span>
              </div>
              
              {#if epochStats.paused && epochStats.pause_reason}
                <div class="pause-reason-box">
                  <p class="pause-reason">
                    <Icons name="info" size={14} />
                    {epochStats.pause_reason}
                  </p>
                  {#if epochStats.pause_reason.includes('node')}
                    <button class="btn btn-sm btn-outline" on:click={() => activeSection = 'node'}>
                      <Icons name="server" size={14} />
                      Go to Node Settings
                    </button>
                  {/if}
                </div>
              {:else if epochEnabled && epochStats.worker_running}
                <p class="active-info">
                  <Icons name="zap" size={14} />
                  50 hashes every 5 seconds • 1-2 threads
                </p>
              {/if}
            </div>
            
            {#if epochError}
              <div class="alert alert-warn settings-alert-top-lg">
                {epochError}
                <button on:click={handleRetryEpoch} class="btn btn-sm btn-outline mt-2">
                  Retry Connection
                </button>
              </div>
            {/if}
          </div>
        </div>
        
        <!-- Your Contributions Card -->
        <div class="card-wrapper card-wrapper-spaced">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">YOUR CONTRIBUTIONS</span>
            </div>
          </div>
          <div class="card-content">
            <div class="contributions-grid">
              <div class="contribution-stat">
                <span class="contribution-value c-cyan">
                  {epochStats.total_hashes_str || devSupportStats?.total_hashes_str || '0'}
                </span>
                <span class="contribution-label">Total Hashes</span>
              </div>
              <div class="contribution-stat">
                <span class="contribution-value c-emerald">
                  {epochStats.total_miniblocks || devSupportStats?.miniblocks_found || 0}
                </span>
                <span class="contribution-label">Miniblocks Found</span>
              </div>
              <div class="contribution-stat">
                <span class="contribution-value">
                  {devSupportStats?.uptime_formatted || formatUptime(epochStats.uptime_seconds || 0)}
                </span>
                <span class="contribution-label">Support Time</span>
              </div>
            </div>
            
            {#if devSupportStats?.total_sessions}
              <p class="sessions-info">
                Across {devSupportStats.total_sessions} session{devSupportStats.total_sessions !== 1 ? 's' : ''}
              </p>
            {/if}
          </div>
        </div>
        
        <!-- How It Works Card -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">?</span>
              <span class="explorer-header-title">HOW IT WORKS</span>
            </div>
          </div>
          <div class="card-content">
            <div class="info-grid">
              <div class="info-item">
                <div class="info-icon"><Icons name="zap" size={18} /></div>
                <div class="info-content">
                  <strong>Passive Support</strong>
                  <p>Light background hashing runs continuously while Hologram is open, contributing to development.</p>
                </div>
              </div>
              <div class="info-item">
                <div class="info-icon"><Icons name="cpu" size={18} /></div>
                <div class="info-content">
                  <strong>Minimal Impact</strong>
                  <p>Only 50 hashes every 5 seconds using 1-2 threads. Automatically pauses when you're mining or on battery.</p>
                </div>
              </div>
              <div class="info-item">
                <div class="info-icon"><Icons name="globe" size={18} /></div>
                <div class="info-content">
                  <strong>TELA App Support</strong>
                  <p>When you use TELA dApps, they can also request small contributions to support their developers.</p>
                </div>
              </div>
              <div class="info-item">
                <div class="info-icon"><Icons name="shield" size={18} /></div>
                <div class="info-content">
                  <strong>Privacy First</strong>
                  <p>No personal data collected. Only anonymous proof-of-work. Disable anytime.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'network'}
        <!-- Network Settings Section -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">NETWORK SETTINGS</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Network Mode</div>
                <div class="settings-row-desc">Choose the chain the app connects to.</div>
              </div>
              <div class="btn-group">
                <button
                  class="btn {$appState.network === 'mainnet' ? 'btn-primary' : 'btn-secondary'}"
                  on:click={() => handleNetworkChange('mainnet')}
                >
                  Mainnet
                </button>
                <button
                  class="btn {$appState.network === 'simulator' ? 'btn-primary' : 'btn-secondary'}"
                  on:click={() => handleNetworkChange('simulator')}
                >
                  Simulator
                </button>
              </div>
            </div>
            
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Mainnet</div>
                <div class="settings-row-desc">Live blockchain with real DERO.</div>
              </div>
              <span class="badge badge-warn">Permanent • Costs DERO</span>
            </div>
            
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Simulator</div>
                <div class="settings-row-desc">Local simulation for testing.</div>
              </div>
              <span class="badge badge-ok">Safe • No Cost</span>
            </div>
          </div>
        </div>
        
        <!-- Daemon Connection Section -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">DAEMON CONNECTION</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <span class="settings-row-label">Daemon Endpoint</span>
                <span class="settings-row-desc">Default ports: Mainnet (10102), Simulator (20000)</span>
              </div>
            </div>
            
            <!-- Endpoint input with Test & Connect button -->
            <div class="endpoint-input-row">
              <input
                type="text"
                bind:value={customEndpoint}
                placeholder="http://127.0.0.1:10102"
                class="input endpoint-input"
                on:keydown={(e) => e.key === 'Enter' && testAndConnect()}
              />
              <button 
                on:click={testAndConnect} 
                disabled={testingEndpoint}
                class="btn btn-primary"
              >
                {#if testingEndpoint}
                  <Icons name="loader" size={14} />
                  Testing...
                {:else}
                  <Icons name="zap" size={14} />
                  Test & Connect
                {/if}
              </button>
            </div>
            
            <p class="form-hint settings-hint-top-sm">
              Enter your node address and click <strong>Test &amp; Connect</strong>. Works for local (127.0.0.1), LAN (192.168.x.x), or remote nodes. Your endpoint is saved automatically on successful connection.
            </p>
            
            <!-- Connection test result -->
            {#if endpointTestResult}
              {#if endpointTestResult.success}
                <div class="alert alert-success settings-alert-top">
                  <div class="endpoint-success">
                    <Icons name="check" size={16} />
                    <div class="endpoint-success-info">
                      <strong>Connected to {endpointTestResult.network} node</strong>
                      <span class="endpoint-details">
                        Version {endpointTestResult.version} • Height {endpointTestResult.height?.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              {:else}
                <div class="alert alert-error settings-alert-top">
                  <Icons name="x" size={14} />
                  {endpointTestResult.error}
                </div>
              {/if}
            {/if}
            
            <div class="settings-row settings-row-top-lg">
              <div class="settings-row-info">
                <span class="settings-row-label">Connection Status</span>
              </div>
              <div class="connection-badge {$appState.nodeConnected ? 'connected' : 'disconnected'}">
                <span class="connection-dot"></span>
                {$appState.nodeConnected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'gnomon'}
        <!-- Gnomon Indexer Section -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">GNOMON INDEXER</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Indexer Status</div>
                <div class="settings-row-desc">
                  {#if $appState.gnomonRunning}
                    <span class="c-cyan">{$appState.gnomonIndexedHeight.toLocaleString()}</span>
                    <span class="settings-text-muted"> / </span>
                    <span>{$appState.gnomonChainHeight.toLocaleString()} blocks</span>
                  {:else}
                    <span class="settings-text-muted">Not running</span>
                  {/if}
                </div>
              </div>
              <button
                on:click={handleGnomonToggle}
                class="btn {$appState.gnomonRunning ? 'btn-danger' : 'btn-primary'}"
              >
                <Icons name={$appState.gnomonRunning ? 'x' : 'play'} size={14} />
                {$appState.gnomonRunning ? 'Stop' : 'Start'}
              </button>
            </div>
            
            <!-- Auto-start Setting -->
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Auto-start on Launch</div>
                <div class="settings-row-desc">
                  Automatically start Gnomon when HOLOGRAM opens
                </div>
              </div>
              <button
                class="toggle-switch"
                class:active={gnomonAutostart}
                on:click={handleGnomonAutostartToggle}
                aria-pressed={gnomonAutostart}
              >
                <span class="toggle-slider"></span>
              </button>
            </div>
            
            {#if $appState.gnomonRunning}
              <div class="progress-section">
                <div class="progress-header">
                  <span class="form-label">Progress</span>
                  <span class="progress-value c-cyan">{Math.min($appState.gnomonProgress, 100).toFixed(2)}%</span>
                </div>
                <div class="progress">
                  <div 
                    class="progress-bar"
                    style="width: {Math.min($appState.gnomonProgress, 100)}%"
                  ></div>
                </div>
              </div>
            {/if}
            
            <!-- Database Management -->
            <div class="settings-row settings-row-divider">
              <div class="settings-row-info">
                <div class="settings-row-label">Database Management</div>
                <div class="settings-row-desc">
                  Reset and re-index the blockchain. Choose your sync method:
                </div>
              </div>
              <div class="settings-row-actions">
              <button
                  on:click={handleFastsync}
                disabled={$appState.gnomonRunning || resyncingGnomon}
                  class="btn btn-primary"
                  title="Quick sync from near current block height (recommended)"
                >
                  <Icons name={resyncingGnomon ? 'loader' : 'zap'} size={14} />
                  Fastsync
                </button>
                <button
                  on:click={handleFullResync}
                  disabled={$appState.gnomonRunning || resyncingGnomon}
                  class="btn btn-danger-outline"
                  title="Full resync from block 0 - takes hours/days!"
                >
                  <Icons name="refresh" size={14} />
                  Full Resync
                </button>
              </div>
            </div>
            
            <!-- Time Machine -->
            <div class="time-machine-card time-machine-card-top">
              <div class="time-machine-header">
                <Icons name="clock" size={16} />
                <span>Time Machine</span>
                <span class="time-machine-current">Block {$appState.gnomonHeight?.toLocaleString() || '0'}</span>
              </div>
              <div class="time-machine-desc">
                Resync from a specific block height. Useful for finding recently deployed contracts.
              </div>
              <div class="time-machine-controls">
                <input
                  type="number"
                  bind:value={resyncFromHeight}
                  placeholder="Enter block height..."
                  class="form-input input-flex-mono"
                  min="0"
                  disabled={$appState.gnomonRunning || resyncingFromHeight}
                />
                <button
                  on:click={handleResyncFromHeight}
                  disabled={$appState.gnomonRunning || resyncingFromHeight || !resyncFromHeight}
                class="btn btn-secondary"
                  title="Resync from specified block height"
              >
                  <Icons name={resyncingFromHeight ? 'loader' : 'play'} size={14} />
                  Go
                </button>
                <button
                  on:click={handleResyncRecent}
                  disabled={$appState.gnomonRunning || resyncingFromHeight}
                  class="btn btn-outline"
                  title="Resync last 1000 blocks"
                >
                  <Icons name="rewind" size={14} />
                  Last 1K
              </button>
              </div>
            </div>
            
            <!-- Search Tips -->
            <div class="settings-row settings-row-top-md">
              <div class="settings-row-info">
                <div class="settings-row-label">Search Tips</div>
                <div class="settings-row-desc settings-row-desc-mono">
                  <strong>key:</strong>owner - Search by SC key<br>
                  <strong>value:</strong>TELA - Search by SC value<br>
                  <strong>code:</strong>STORE - Search SC code
                </div>
              </div>
            </div>
            
            <!-- Search Exclusions Filter -->
            <div class="settings-row settings-row-divider">
              <div class="settings-row-info">
                <div class="settings-row-label">Search Exclusions</div>
                <div class="settings-row-desc">
                  Filter out content containing specific text in dURL.
                  <span class="settings-text-muted">({searchExclusions.length} active filters)</span>
                </div>
              </div>
              <div class="settings-row-actions">
                <button
                  on:click={() => showExclusionModal = true}
                  class="btn btn-secondary"
                >
                  <Icons name="filter" size={14} />
                  Manage
                </button>
              </div>
            </div>
            
            <!-- Minimum Likes Filter -->
            <div class="settings-row settings-row-top-md">
              <div class="settings-row-info">
                <div class="settings-row-label">Minimum Likes %</div>
                <div class="settings-row-desc">
                  Filter search results by minimum like ratio. 0 = show all.
                </div>
              </div>
              <div class="settings-row-actions">
                <input
                  type="number"
                  min="0"
                  max="100"
                  bind:value={searchMinLikes}
                  on:change={updateMinLikes}
                  class="form-input input-compact-center"
                />
                <span class="input-suffix">%</span>
              </div>
            </div>
            
            <!-- Active Exclusions List -->
            {#if searchExclusions.length > 0}
              <div class="exclusions-list exclusions-list-top">
                <div class="exclusions-header">Active Filters:</div>
                <div class="exclusions-tags">
                  {#each searchExclusions as filter}
                    <span class="exclusion-tag">
                      {filter}
                      <button
                        class="exclusion-remove"
                        on:click={() => removeExclusion(filter)}
                        title="Remove filter"
                      >×</button>
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
        
        <!-- Search Exclusions Modal -->
        {#if showExclusionModal}
          <div class="modal-overlay" on:click={() => showExclusionModal = false}>
            <div class="modal-content" on:click|stopPropagation>
              <div class="modal-header">
                <h3 class="modal-title">Search Exclusions</h3>
                <button class="modal-close" on:click={() => showExclusionModal = false}>
                  <Icons name="x" size={20} />
                </button>
              </div>
              <div class="modal-body">
                <p class="settings-modal-desc">
                  Add text filters to exclude SCIDs containing these patterns in their dURL.
                  Useful for filtering out unwanted or low-quality content.
                </p>
                
                <div class="exclusion-input-row">
                  <input
                    type="text"
                    bind:value={newExclusionFilter}
                    placeholder="Enter filter text..."
                    class="form-input"
                    on:keydown={(e) => e.key === 'Enter' && addExclusion()}
                  />
                  <button
                    class="btn btn-primary"
                    on:click={addExclusion}
                    disabled={!newExclusionFilter.trim()}
                  >
                    <Icons name="plus" size={14} />
                    Add
                  </button>
                </div>
                
                {#if searchExclusions.length > 0}
                  <div class="exclusions-modal-list">
                    {#each searchExclusions as filter}
                      <div class="exclusion-item">
                        <span class="exclusion-text">{filter}</span>
                        <button
                          class="btn btn-sm btn-danger-outline"
                          on:click={() => removeExclusion(filter)}
                        >
                          <Icons name="trash-2" size={12} />
                        </button>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="empty-exclusions">
                    <Icons name="filter" size={32} />
                    <p>No exclusion filters set</p>
                  </div>
                {/if}
              </div>
              <div class="modal-footer">
                <button class="btn btn-secondary" on:click={() => showExclusionModal = false}>
                  Close
                </button>
              </div>
            </div>
          </div>
        {/if}
        
        <!-- Full Resync Confirmation Modal -->
        {#if showFullResyncModal}
          <div class="modal-overlay" on:click={cancelFullResync}>
            <div class="modal-content modal-content-wide" on:click|stopPropagation>
              <div class="modal-header">
                <div class="modal-title">
                  <Icons name="warning" size={18} className="modal-title-icon resync-title-icon" />
                  <span>Full Resync</span>
                </div>
                <button class="modal-close" on:click={cancelFullResync}>
                  <Icons name="x" size={20} />
                </button>
              </div>
              <div class="modal-body">
                <p class="settings-modal-lead">Rebuilds the Gnomon index from block 0.</p>
                <p class="settings-modal-desc">
                  Use this only when your index is corrupted or missing content. It is the slowest rebuild path.
                </p>

                <div class="resync-metrics">
                  <div class="resync-metric">
                    <div class="resync-metric-label">Scope</div>
                    <div class="resync-metric-value">Block 0 → latest</div>
                    <div class="resync-metric-meta">Mainnet: 6M+ blocks</div>
                  </div>
                  <div class="resync-metric">
                    <div class="resync-metric-label">Duration</div>
                    <div class="resync-metric-value">Hours to days</div>
                    <div class="resync-metric-meta">Depends on hardware</div>
                  </div>
                </div>

                <div class="resync-choice">
                  <div>
                    <div class="resync-choice-title">Try Fastsync first</div>
                    <div class="resync-choice-desc">Faster rebuild for most recovery cases.</div>
                  </div>
                  <button class="btn btn-secondary btn-sm" on:click={handleFastsyncInstead} disabled={resyncingGnomon}>
                    Use Fastsync
                  </button>
                </div>

                <label class="checkbox-wrap resync-confirm">
                  <input type="checkbox" class="checkbox" bind:checked={fullResyncConfirmed} />
                  <span class="checkbox-label">
                    I understand this rebuilds from block 0 and can take hours or days.
                  </span>
                </label>
              </div>
              <div class="modal-footer modal-footer-spread">
                <button class="btn btn-secondary" on:click={cancelFullResync} disabled={resyncingGnomon}>
                  Cancel
                </button>
                <button
                  class="btn btn-danger"
                  on:click={confirmFullResync}
                  disabled={resyncingGnomon || !fullResyncConfirmed}
                  title={!fullResyncConfirmed ? 'Confirm the acknowledgement to continue' : ''}
                >
                  {#if resyncingGnomon}
                    <Icons name="loader" size={14} />
                    Starting...
                  {:else}
                    Start Full Resync
                  {/if}
                </button>
              </div>
            </div>
          </div>
        {/if}
        
        <!-- Simple-Gnomon Features Card -->
        <div class="card-wrapper card-wrapper-top">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◈</span>
              <span class="explorer-header-title">ADVANCED FEATURES</span>
            </div>
            <HoloBadge variant="cyan">Simple-Gnomon</HoloBadge>
          </div>
          <div class="card-content">
            <!-- WebSocket API Toggle -->
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">WebSocket Query API</div>
                <div class="settings-row-desc">
                  {#if gnomonWSStatus.running}
                    <span class="c-cyan">Running on ws://{gnomonWSStatus.address}/ws</span>
                    <span class="settings-text-muted"> • {gnomonWSStatus.clients} client{gnomonWSStatus.clients !== 1 ? 's' : ''}</span>
                  {:else}
                    Enable external apps to query Gnomon data via WebSocket
                  {/if}
                </div>
              </div>
              <button
                on:click={handleGnomonWSToggle}
                disabled={gnomonWSLoading || !$appState.gnomonRunning}
                class="btn {gnomonWSStatus.running ? 'btn-danger' : 'btn-primary'}"
                title={!$appState.gnomonRunning ? 'Start Gnomon first' : ''}
              >
                {#if gnomonWSLoading}
                  <Icons name="loader" size={14} class="animate-spin" />
                {:else}
                  <Icons name={gnomonWSStatus.running ? 'x' : 'play'} size={14} />
                {/if}
                {gnomonWSStatus.running ? 'Stop API' : 'Start API'}
              </button>
            </div>
            
            <!-- Tag System Stats -->
            <div class="settings-row settings-row-top-md">
              <div class="settings-row-info">
                <div class="settings-row-label">Tag Classification System</div>
                <div class="settings-row-desc">
                  {#if tagStats.total_scids > 0}
                    <span class="c-cyan">{tagStats.total_scids}</span> SCIDs classified •
                    {Object.keys(tagStats.class_counts || {}).length} classes •
                    {Object.keys(tagStats.tag_counts || {}).length} tags
                  {:else}
                    Classify SCIDs by type (TELA, G45, NFA, etc.) for better discovery
                  {/if}
                </div>
              </div>
              <button
                on:click={handleRebuildTagIndex}
                disabled={rebuildingTags || !$appState.gnomonRunning}
                class="btn btn-secondary"
                title={!$appState.gnomonRunning ? 'Start Gnomon first' : 'Rebuild tag index from Gnomon data'}
              >
                {#if rebuildingTags}
                  <Icons name="loader" size={14} class="animate-spin" />
                  Rebuilding...
                {:else}
                  <Icons name="refresh" size={14} />
                  Rebuild Index
                {/if}
              </button>
            </div>
            
          </div>
        </div>
        
        <!-- Time Machine Watch List Card -->
        <div class="card-wrapper card-wrapper-top">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">WATCHED SMART CONTRACTS</span>
            </div>
            <div class="explorer-header-right">
              <button
                on:click={refreshWatchedSCs}
                disabled={refreshingWatched || watchedSCs.length === 0}
                class="btn btn-secondary btn-sm"
                title="Check all watched SCs for changes"
              >
                {#if refreshingWatched}
                  <Icons name="loader" size={12} class="animate-spin" />
                {:else}
                  <Icons name="refresh" size={12} />
                {/if}
                Refresh All
              </button>
            </div>
          </div>
          <div class="card-content">
            {#if watchedSCsLoading}
              <div class="watched-loading">
                <Icons name="loader" size={16} class="animate-spin" />
                <span>Loading watched SCs...</span>
              </div>
            {:else if watchedSCs.length === 0}
              <div class="watched-empty">
                <Icons name="eye" size={24} />
                <p>No smart contracts being watched</p>
                <p class="hint">Watch SCs from the Explorer to track their state changes over time</p>
              </div>
            {:else}
              <div class="watched-list">
                {#each watchedSCs as sc}
                  <div class="watched-item">
                    <div class="watched-info">
                      <div class="watched-name">{sc.name || sc.scid?.substring(0, 16) + '...'}</div>
                      <div class="watched-meta">
                        <span class="watched-scid">{sc.scid?.substring(0, 24)}...</span>
                        <span class="watched-since">Since {formatWatchTime(sc.watched_since)}</span>
                        {#if sc.change_count > 0}
                          <span class="watched-changes">{sc.change_count} changes</span>
                        {/if}
                      </div>
                    </div>
                    <div class="watched-actions">
                      <button
                        class="btn btn-secondary btn-sm"
                        on:click={() => unwatchSC(sc.scid)}
                        title="Stop watching"
                      >
                        <Icons name="eye-off" size={12} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
              <div class="watched-footer">
                <span class="watched-count">{watchedSCs.length} SC{watchedSCs.length !== 1 ? 's' : ''} being watched</span>
              </div>
            {/if}
          </div>
        </div>
      
      {:else if activeSection === 'connected-apps'}
        <!-- Connected Apps -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">CONNECTED APPS</span>
            </div>
          </div>
          <div class="card-content">
            <p class="section-desc">
          Manage dApps that have connected to your wallet via XSWD. You can view and revoke permissions for each app.
        </p>
        
        {#if isLoadingApps}
              <div class="loading-container">
                <div class="loading-spinner"></div>
          </div>
        {:else if connectedApps.length === 0}
              <div class="empty-state-card">
                <div class="empty-state-icon">
                  <Icons name="lock" size={48} />
                </div>
                <h3 class="empty-state-title">No Connected Apps</h3>
                <p class="empty-state-desc">
              Apps that connect to your wallet via XSWD will appear here.
                  You'll be able to manage their permissions.
            </p>
          </div>
        {:else}
              <div class="apps-list">
            {#each connectedApps as app}
                  <div class="app-card">
                <!-- App Header -->
                <button
                  on:click={() => selectedApp = selectedApp === app.origin ? null : app.origin}
                      class="app-card-header"
                >
                      <div class="app-card-info">
                        <div class="app-card-icon">
                          <Icons name="link" size={24} />
                    </div>
                        <div class="app-card-details">
                          <div class="app-card-name-row">
                            <span class="app-card-name">{app.name || 'Unknown App'}</span>
                        {#if app.isActive}
                              <span class="app-status-badge connected">Connected</span>
                        {/if}
                      </div>
                          <p class="app-card-origin">{app.origin}</p>
                    </div>
                  </div>
                      <div class="app-card-meta">
                        <span class="app-perm-count">
                        {app.permissions?.length || 0} permission{app.permissions?.length !== 1 ? 's' : ''}
                      </span>
                        <Icons name={selectedApp === app.origin ? 'chevron-up' : 'chevron-down'} size={20} />
                  </div>
                </button>
                
                <!-- Expanded Details -->
                {#if selectedApp === app.origin}
                      <div class="app-card-expanded">
                    <!-- Timestamps -->
                        <div class="app-timestamps">
                          <div class="app-timestamp">
                            <span class="timestamp-label">First Connected</span>
                            <span class="timestamp-value">{formatTimestamp(app.grantedAt)}</span>
                      </div>
                          <div class="app-timestamp">
                            <span class="timestamp-label">Last Activity</span>
                            <span class="timestamp-value">{formatTimestamp(app.lastAccessed)}</span>
                      </div>
                    </div>
                    
                    <!-- Permissions -->
                        <div class="app-permissions">
                          <span class="permissions-label">Granted Permissions</span>
                      {#if app.permissions && app.permissions.length > 0}
                            <div class="permissions-list">
                          {#each app.permissions as perm}
                                <span class="permission-tag">
                                  <span class="permission-name">{getPermissionLabel(perm)}</span>
                              <button
                                on:click|stopPropagation={() => revokePermission(app.origin, perm)}
                                    class="permission-revoke"
                                title="Revoke this permission"
                              >
                                    <Icons name="x" size={14} />
                              </button>
                            </span>
                          {/each}
                        </div>
                      {:else}
                            <p class="no-permissions">No permissions granted</p>
                      {/if}
                    </div>
                    
                    <!-- Actions -->
                        <div class="app-actions">
                      <button
                        on:click|stopPropagation={() => revokeAllPermissions(app.origin)}
                            class="btn btn-danger"
                      >
                        Revoke All & Disconnect
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          
          <!-- Bulk revoke moved to Data & Storage section -->
          {#if connectedApps.length > 1}
            <div class="revoke-all-section">
              <button
                on:click={() => activeSection = 'data-storage'}
                class="btn btn-ghost btn-sm"
                title="Revoke all permissions from Data & Storage"
              >
                Bulk revoke in Data &amp; Storage →
              </button>
            </div>
          {/if}
        {/if}
          </div>
        </div>
        
        <!-- Permission Reference -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">▣</span>
              <span class="explorer-header-title">PERMISSION REFERENCE</span>
            </div>
          </div>
          <div class="card-content">
            <div class="permission-ref-list">
            {#each permissionTypes as perm}
                <div class="permission-ref-item">
                  <div class="permission-ref-icon">
                    {#if perm.id === 'view_address'}
                      <Icons name="eye" size={16} />
                    {:else if perm.id === 'view_balance'}
                      <Icons name="wallet" size={16} />
                    {:else if perm.id === 'sign_transaction'}
                      <Icons name="send" size={16} />
                    {:else}
                      <Icons name="lock" size={16} />
                    {/if}
                </div>
                  <div class="permission-ref-content">
                    <div class="permission-ref-header">
                      <span class="permission-ref-name">{perm.name}</span>
                    {#if perm.alwaysAsk}
                        <span class="permission-ref-badge">Always Asks</span>
                    {/if}
                  </div>
                    <p class="permission-ref-desc">{perm.description}</p>
                </div>
              </div>
            {/each}
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'privacy'}
        <!-- Privacy & Security -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">PRIVACY & SECURITY</span>
            </div>
          </div>
          <div class="card-content">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Privacy Mode</div>
                <div class="settings-row-desc">Seal HOLOGRAM's own egress to DERO + localhost</div>
            </div>
                <input
                  type="checkbox"
                  class="toggle"
                  checked={privacyModeEnabled}
                  on:change={togglePrivacyMode}
                />
          </div>
          
          {#if privacyModeEnabled}
              <div class="alert alert-success">App-level egress sealed — only DERO and allowlisted hosts. TELA dApps in the WebView and the embedded derod node keep their own network access.</div>
          {:else}
              <div class="alert alert-info">All network connections are allowed</div>
          {/if}
          
          <!-- GitHub Checks Toggle -->
          <div class="settings-row settings-row-top-lg">
            <div class="settings-row-info">
              <div class="settings-row-label">Allow GitHub Checks</div>
              <div class="settings-row-desc">Enable auto-download of derod from GitHub. Disable for full privacy (manual install required).</div>
            </div>
            <input
              type="checkbox"
              class="toggle"
              checked={$settingsState.allow_github_check !== false}
              on:change={(e) => saveSetting('allow_github_check', e.target.checked)}
            />
          </div>
          
          {#if $settingsState.allow_github_check === false}
            <div class="alert alert-warn settings-alert-top-sm">
              <p><strong>GitHub checks disabled</strong></p>
              <p class="form-hint">Auto-download of derod is unavailable. Go to Node settings for manual installation instructions.</p>
            </div>
          {/if}
          </div>
        </div>
        
        <!-- Ring Members (sender-visibility decoy curation) — #2 under Privacy & Security -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">RING MEMBERS</span>
            </div>
          </div>
          <div class="card-content">
            <div class="ring-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:1px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              <span>Ring member sets are a <strong>HOLOGRAM convenience</strong>, stored locally on this device — not a network feature. When you Anonymize a transfer, a set's members fill the front of the ring and random registered members fill the rest. A set never raises anonymity above the ring size, and is never sourced from your Address Book.</span>
            </div>

            <!-- name a new set -->
            <div class="add-host-form">
              <input
                type="text"
                bind:value={newRingSetName}
                placeholder="Name a new set…"
                class="input host-input"
                on:keydown={(e) => e.key === 'Enter' && addRingSet()}
              />
              <button on:click={addRingSet} disabled={!newRingSetName.trim()} class="btn btn-primary">
                Add Set
              </button>
            </div>

            <!-- list of sets -->
            <div class="host-list">
              {#each ringMemberSets as set}
                <div class="host-item" class:host-item-active={selectedRingSetId === set.id}>
                  <span class="host-dot"></span>
                  <span class="host-name">{set.name}</span>
                  <span class="connection-protocol">{(set.members || []).length} {(set.members || []).length === 1 ? 'member' : 'members'}</span>
                  <button class="btn btn-ghost btn-sm settings-ml-auto" on:click={() => openRingSet(set.id)}>
                    {selectedRingSetId === set.id ? 'Close' : 'Edit'}
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    class:ring-delete-armed={ringSetDeleteArmed === set.id}
                    on:click={() => deleteRingSet(set.id)}
                    on:blur={() => { if (ringSetDeleteArmed === set.id) ringSetDeleteArmed = ''; }}
                    title={ringSetDeleteArmed === set.id ? 'Tap again to delete' : 'Delete set'}
                  >
                    {ringSetDeleteArmed === set.id ? 'Confirm' : '✕'}
                  </button>
                </div>
              {/each}
              {#if ringMemberSets.length === 0}
                <div class="host-item host-item-empty">
                  No ring member sets yet
                </div>
              {/if}
            </div>

            <!-- member editor for the selected set -->
            {#if selectedRingSet}
              <div class="settings-divider">
                <span class="form-hint" style="display:block;margin-bottom:var(--s-3);">
                  Members of <strong style="color:var(--text-2);">{selectedRingSet.name}</strong>. Each must be a registered DERO base address — not your own.
                </span>
                <div class="decoy-add-row">
                  <input
                    type="text"
                    bind:value={newRingMemberAddr}
                    placeholder="dero1…"
                    class="input"
                    on:keydown={(e) => e.key === 'Enter' && addRingMember()}
                  />
                  <button class="btn btn-primary btn-sm" on:click={addRingMember} disabled={!newRingMemberAddr.trim()}>Add</button>
                </div>
                {#if ringMemberError}
                  <span class="form-error" style="display:block;margin-top:var(--s-2);">{ringMemberError}</span>
                {/if}
                <div class="decoy-chips">
                  {#each (selectedRingSet.members || []) as addr}
                    <span class="decoy-chip">
                      {#if ringMemberStatus[addr] === 'ok'}
                        <span class="ok" title="Registered on-chain"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                      {:else if ringMemberStatus[addr] === 'checking'}
                        <span class="checking" title="Checking registration…"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity="0.4"/></svg></span>
                      {:else}
                        <span class="unreg" title="Not registered on-chain (or daemon unreachable) — it will be skipped at send"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
                      {/if}
                      {formatAddress(addr)}
                      <span class="x" on:click={() => removeRingMember(addr)} on:keydown={(e) => e.key === 'Enter' && removeRingMember(addr)} role="button" tabindex="0" title="Remove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></span>
                    </span>
                  {/each}
                  {#if (selectedRingSet.members || []).length === 0}
                    <span class="form-hint">No members yet — add registered addresses above.</span>
                  {/if}
                </div>
                <div class="decoy-warn">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                  <span>Quality, not count. Members you control collapse your anonymity set — anyone who knows these addresses are yours can rule them out. Never add your own addresses. A good set is other people's real, active addresses.</span>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Allowed Hosts -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">▣</span>
              <span class="explorer-header-title">ALLOWED HOSTS</span>
            </div>
          </div>
          <div class="card-content">
            <p class="form-hint settings-hint-bottom-md">
            These hosts are always allowed, even when Privacy Mode is enabled.
          </p>
          
          <!-- Add Host Form -->
          <div class="add-host-form">
            <input
              type="text"
              bind:value={newAllowedHost}
              placeholder="Enter hostname or IP..."
                class="input host-input"
              on:keydown={(e) => e.key === 'Enter' && addHost()}
            />
            <button
              on:click={addHost}
              disabled={!newAllowedHost.trim()}
                class="btn btn-primary"
            >
              Add
            </button>
          </div>
          
          <!-- Hosts List -->
          <div class="host-list">
            {#each allowedHosts as host}
              <div class="host-item">
                <span class="host-dot"></span>
                <span class="host-name">{host}</span>
                {#if !['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host)}
                  <button
                    on:click={() => removeHost(host)}
                    class="btn btn-ghost btn-sm settings-ml-auto"
                    title="Remove host"
                  >
                    ✕
                  </button>
                {:else}
                  <span class="connection-protocol settings-ml-auto">Required</span>
                {/if}
              </div>
            {/each}
            {#if allowedHosts.length === 0}
              <div class="host-item host-item-empty">
                No hosts configured
              </div>
            {/if}
          </div>
          </div>
        </div>
        
        <!-- Active Connections -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◆</span>
              <span class="explorer-header-title">ACTIVE CONNECTIONS</span>
            </div>
          </div>
          <div class="card-content">
            <p class="form-hint settings-hint-bottom-md">Current network connections used by Hologram</p>
          
          <div class="connection-list">
            {#each activeConnections as conn}
              <div class="connection-item">
                <span class="connection-dot" class:connection-dot-off={!conn.connected}></span>
                <span class="connection-name">{conn.name}</span>
                <span class="connection-protocol">{conn.type}</span>
                <span class="connection-url">{conn.endpoint}</span>
              </div>
            {/each}
            {#if activeConnections.length === 0}
              <div class="connection-item">
                <span class="connection-dot" class:connection-dot-off={!$appState.xswdConnected}></span>
                <span class="connection-name">XSWD (Wallet)</span>
                <span class="connection-protocol">WebSocket</span>
                <span class="connection-url">ws://127.0.0.1:44326</span>
                </div>
              <div class="connection-item">
                <span class="connection-dot" class:connection-dot-off={!$appState.nodeConnected}></span>
                <span class="connection-name">Daemon RPC</span>
                <span class="connection-protocol">HTTP</span>
                <span class="connection-url">{$appState.currentEndpoint || $settingsState.daemonEndpoint}</span>
              </div>
            {/if}
          </div>
          </div>
        </div>
        
        <!-- Connection Log -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">⬢</span>
              <span class="explorer-header-title">CONNECTION LOG</span>
            </div>
          </div>
          <div class="card-content">
            <div class="section-header">
              <p class="form-hint">Recent connection attempts</p>
              <button
                on:click={() => activeSection = 'data-storage'}
                class="btn btn-ghost btn-sm"
                title="Manage logs in Data & Storage"
              >
                Manage in Data &amp; Storage →
              </button>
          </div>
          
          <div class="connection-log">
            {#if connectionLog.length === 0}
              <p class="connection-log-empty">No connection attempts logged</p>
            {:else}
              {#each [...connectionLog].reverse().slice(0, 20) as entry}
                <div class="connection-log-entry">
                  <span class="log-dot {entry.allowed ? 'log-dot-ok' : 'log-dot-err'}"></span>
                  <div class="log-entry-info">
                    <span class="log-entry-host">{entry.host || entry.url}</span>
                    <span class="log-entry-reason">{entry.reason}</span>
                  </div>
                  <span class="log-entry-status {entry.allowed ? 'c-emerald' : 'c-err'}">
                    {entry.allowed ? 'Allowed' : 'Blocked'}
                  </span>
                </div>
              {/each}
            {/if}
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'console'}
        <!-- Application Logs -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">APPLICATION LOGS</span>
            </div>
            <div class="explorer-header-right">
              <div class="console-actions">
                <button on:click={() => copyRecentLogs(25)} class="btn btn-ghost btn-sm" title="Copy last 25 lines">
                  Copy 25
                </button>
                <button on:click={() => copyRecentLogs(50)} class="btn btn-ghost btn-sm" title="Copy last 50 lines">
                  Copy 50
                </button>
                <button on:click={() => activeSection = 'data-storage'} class="btn btn-ghost btn-sm" title="Manage logs in Data & Storage">
                  Manage in Data &amp; Storage →
                </button>
              </div>
            </div>
          </div>
          <div class="card-content console-content">
            <div class="console-viewport" bind:this={consoleViewport} on:scroll={handleConsoleScroll}>
              {#if $consoleLogs.length === 0}
                <p class="console-empty">No logs yet. Application output will appear here.</p>
              {:else}
                {#each $consoleLogs as log}
                  <div class="console-line {log.level === 'error' ? 'level-error' : log.level === 'warn' ? 'level-warn' : ''}">
                    <span class="console-timestamp">[{log.timestamp}]</span>
                    <span class="console-message">{log.message}</span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      
      {:else if activeSection === 'data-storage'}
        <!-- Data & Storage — unified clear/reset surface -->
        <StorageManager />

      {:else if activeSection === 'about'}
        <!-- About Hologram -->
        <div class="card-wrapper">
          <div class="explorer-header">
            <div class="explorer-header-left">
              <span class="explorer-header-icon">◎</span>
              <span class="explorer-header-title">ABOUT HOLOGRAM</span>
            </div>
          </div>
          <div class="card-content">
            <div class="about-details">
              <div class="about-row">
                <span class="about-label">Version</span>
                <span class="about-value mono">{appInfo.version}</span>
              </div>
              <div class="about-row">
                <span class="about-label">Build Date</span>
                <span class="about-value mono">{appInfo.buildDate === 'dev' ? 'Development Build' : appInfo.buildDate}</span>
              </div>
              {#if appInfo.gitCommit && appInfo.gitCommit !== 'unknown'}
              <div class="about-row">
                <span class="about-label">Commit</span>
                <span class="about-value mono">{appInfo.gitCommit}</span>
              </div>
              {/if}
              <div class="about-row">
                <span class="about-label">DERO Node</span>
                <span class="about-value mono">{$appState.nodeVersion || 'Not connected'}</span>
              </div>
              <div class="about-row">
                <span class="about-label">Network</span>
                <span class="about-value">
                  <span class="about-network-badge {$settingsState.network}">
                    {$settingsState.network || 'mainnet'}
                  </span>
                </span>
              </div>
            </div>
            
            <div class="about-footer">
              <p class="about-copyright">© 2026 {appInfo.author || 'Hologram Contributors'}</p>
              <p class="about-tagline">Explore the DERO Decentralized Web</p>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* === Ring Members (sender-visibility decoy curation) === */
  /* Ported from the decided sender-visibility exploration (2C2 settings surface). */
  /* The honesty banner is scoped to the design's 11px/r-md sizing — the global
     .alert is 13px/r-lg/s-4 padding, which renders oversized against the 11px
     form-hint text the sibling cards use. */
  .ring-info {
    display: flex; align-items: flex-start; gap: var(--s-3);
    padding: var(--s-3);
    border-radius: var(--r-md);
    font-size: 11px; line-height: 1.55;
    margin-bottom: var(--s-4);
    background: rgba(34, 211, 238, 0.08);
    border: 1px solid rgba(34, 211, 238, 0.2);
    color: var(--cyan-400);
  }
  .ring-info svg { flex: none; }

  .host-item-active { background: var(--void-up); }
  .host-item-active .host-name { color: var(--cyan-400); }
  .ring-delete-armed { color: var(--status-err) !important; }

  .settings-divider {
    margin-top: var(--s-4); padding-top: var(--s-4);
    border-top: 1px solid var(--border-subtle);
  }
  .decoy-add-row { display: flex; gap: var(--s-2); }
  .decoy-add-row .input { flex: 1; min-width: 0; font-size: 11px; padding: var(--s-2) var(--s-3); }

  .decoy-chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-2); }
  .decoy-chip {
    display: inline-flex; align-items: center; gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    font-size: 11px; color: var(--text-2);
    font-family: var(--font-mono);
  }
  .decoy-chip .ok { color: var(--status-ok); display: inline-flex; }
  .decoy-chip .checking { color: var(--text-4); display: inline-flex; }
  .decoy-chip .unreg { color: var(--status-warn); display: inline-flex; }
  .decoy-chip .x { color: var(--text-4); cursor: pointer; display: inline-flex; }
  .decoy-chip .x:hover { color: var(--status-err); }

  /* the footgun warning — status-warn is sanctioned here: this IS a genuine
     warning (self-owned members collapse the set), not decorative. */
  .decoy-warn {
    display: flex; align-items: flex-start; gap: var(--s-2);
    margin-top: var(--s-3);
    padding: var(--s-2) var(--s-3);
    font-size: 10px; line-height: 1.5;
    color: var(--status-warn);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-sm);
  }
  .decoy-warn svg { flex: none; margin-top: 1px; }

  /* === HOLOGRAM v7.0 Settings Page Styles === */
  /* Strict compliance with HOLOGRAM-DESIGN-SYSTEM.md */
  /* Utilitarian Card Headers (Explorer Style) */
  
  /* === Time Machine Card === */
  .time-machine-card {
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
  }
  
  .time-machine-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-1);
  }
  
  .time-machine-header :global(svg) {
    color: var(--cyan-400);
  }
  
  .time-machine-current {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
    color: var(--text-4);
    background: var(--void-mid);
    padding: 2px 8px;
    border-radius: var(--r-sm);
  }
  
  .time-machine-desc {
    font-size: 12px;
    color: var(--text-3);
    margin-bottom: var(--s-3);
    line-height: 1.5;
  }
  
  .time-machine-controls {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  
  .time-machine-controls .form-input {
    min-width: 0;
  }
  
  /* === Card Wrapper === */
  .card-wrapper {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    margin-bottom: var(--s-6);
  }
  
  .card-wrapper-spaced {
    margin-bottom: var(--s-6);
  }

  .node-mode-group :global(.btn-primary),
  .node-mode-group :global(.btn-primary:hover),
  .node-mode-group :global(.btn-secondary:hover) {
    transform: none;
    box-shadow: none;
  }
  
  /* === Explorer-style Headers === */
  .explorer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .explorer-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .explorer-header-icon {
    font-size: 16px;
    color: var(--cyan-400);
    line-height: 1;
  }
  
  .explorer-header-title {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-1);
  }
  
  .explorer-header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .explorer-header-meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-4);
  }
  
  /* === Card Content === */
  .card-content {
    padding: 24px;
  }
  
  /* === Settings Row (Individual Setting) === */
  .settings-row {
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    margin-bottom: var(--s-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
  }
  
  .settings-row:last-child {
    margin-bottom: 0;
  }
  
  .settings-row-info {
    flex: 1;
  }
  
  .settings-row-actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-shrink: 0;
  }
  
  .settings-row-stack {
    flex-direction: column;
    align-items: stretch;
  }
  
  .settings-row-stack-gap {
    gap: var(--s-2);
  }
  
  .settings-row-top-sm {
    margin-top: var(--s-2);
  }
  
  .settings-row-top-md {
    margin-top: var(--s-3);
  }
  
  .settings-row-top-lg {
    margin-top: var(--s-4);
  }
  
  .settings-row-divider {
    margin-top: var(--s-4);
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--s-4);
  }
  
  .settings-row-info-spaced {
    margin-bottom: var(--s-4);
  }
  
  .settings-row-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
    margin-bottom: 2px;
  }
  
  .settings-row-desc {
    font-size: 11px;
    color: var(--text-4);
    line-height: 1.5;
  }
  
  .settings-row-desc-inline {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  .settings-row-desc-mono {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }
  
  .settings-form-group {
    margin-bottom: var(--s-4);
  }
  
  .settings-form-group-tight {
    margin-bottom: 0;
  }
  
  .settings-alert-top {
    margin-top: var(--s-3);
  }
  
  .settings-alert-top-sm {
    margin-top: var(--s-2);
  }
  
  .settings-alert-top-lg {
    margin-top: var(--s-4);
  }
  
  .settings-hint-top-sm {
    margin-top: var(--s-2);
  }
  
  .settings-hint-bottom-md {
    margin-bottom: var(--s-4);
  }
  
  .settings-text-muted {
    color: var(--text-4);
  }
  
  .settings-ml-auto {
    margin-left: auto;
  }
  
  .input-narrow {
    width: 150px;
  }
  
  .input-mono-sm {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  
  .input-flex-mono {
    flex: 1;
    font-family: var(--font-mono);
  }
  
  .input-compact-center {
    width: 70px;
    text-align: center;
  }
  
  .time-machine-card-top {
    margin-top: var(--s-3);
  }
  
  .exclusions-list-top {
    margin-top: var(--s-3);
  }
  
  .card-wrapper-top {
    margin-top: var(--s-4);
  }
  
  .host-item-empty {
    justify-content: center;
    color: var(--text-4);
  }
  
  .settings-row-control {
    flex-shrink: 0;
  }
  
  .settings-hint-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-5);
    font-style: italic;
  }
  
  /* === Settings Stats Grid === */
  .settings-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--s-3);
  }
  
  .settings-stat {
    padding: var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    text-align: center;
  }
  
  .settings-stat-value {
    display: block;
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--text-1);
    margin-bottom: var(--s-1);
  }
  
  .settings-stat-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-4);
  }
  
  
  /* Form styles (.form-group, .form-label, .form-hint) come from hologram.css */
  
  /* Connection Badge - v6.1 compliant */
  .connection-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 500;
  }

  .connection-badge.connected {
    background: rgba(52, 211, 153, 0.15);
    color: var(--status-ok);
  }
  
  .connection-badge.disconnected {
    background: rgba(248, 113, 113, 0.15);
    color: var(--status-err);
  }

  .connection-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  /* === Connected Apps v6.1 Styles === */
  .section-desc {
    font-size: 13px;
    color: var(--text-4);
    margin-bottom: 20px;
  }

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-dim);
    border-top-color: var(--cyan);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 32px;
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    text-align: center;
  }

  .empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-4);
    margin-bottom: 16px;
  }

  .empty-state-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0 0 8px 0;
  }

  .empty-state-desc {
    font-size: 13px;
    color: var(--text-4);
    margin: 0;
    line-height: 1.5;
  }

  .apps-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .app-card {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .app-card-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
    text-align: left;
  }

  .app-card-header:hover {
    background: var(--void-up);
  }

  .app-card-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .app-card-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: rgba(0, 212, 170, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cyan);
  }

  .app-card-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .app-card-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .app-card-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }

  .app-status-badge {
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 500;
    border-radius: var(--r-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .app-status-badge.connected {
    background: rgba(52, 211, 153, 0.15);
    color: var(--status-ok);
  }

  .app-card-origin {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-4);
    margin: 0;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-card-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-4);
  }

  .app-perm-count {
    font-size: 12px;
  }

  .app-card-expanded {
    padding: 16px;
    border-top: 1px solid var(--border-dim);
    background: var(--void-pure);
  }

  .app-timestamps {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 16px;
  }

  .app-timestamp {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .timestamp-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-4);
  }

  .timestamp-value {
    font-size: 13px;
    color: var(--text-2);
  }

  .app-permissions {
    margin-bottom: 16px;
  }

  .permissions-label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-4);
    margin-bottom: 8px;
  }

  .permissions-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .permission-tag {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--void-mid);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-sm);
  }

  .permission-name {
    font-size: 12px;
    color: var(--text-2);
  }

  .permission-revoke {
    background: transparent;
    border: none;
    color: var(--text-4);
    cursor: pointer;
    padding: 0;
    display: flex;
    transition: color 0.2s;
  }

  .permission-revoke:hover {
    color: var(--status-err);
  }

  .no-permissions {
    font-size: 12px;
    color: var(--text-4);
    margin: 0;
  }

  .app-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 12px;
    border-top: 1px solid var(--border-dim);
  }

  .revoke-all-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border-dim);
  }

  .btn-danger {
    padding: 8px 16px;
    background: rgba(248, 113, 113, 0.15);
    color: var(--status-err);
    border: none;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-danger:hover {
    background: rgba(248, 113, 113, 0.25);
  }
  
  .confirm-buttons {
    display: flex;
    gap: 8px;
  }

  /* Permission Reference v6.1 */
  .permission-ref-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .permission-ref-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .permission-ref-icon {
    width: 32px;
    height: 32px;
    border-radius: 5px;
    background: var(--void-up);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cyan);
    flex-shrink: 0;
  }

  .permission-ref-content {
    flex: 1;
  }

  .permission-ref-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .permission-ref-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
  }

  .permission-ref-badge {
    padding: 4px 8px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: rgba(251, 191, 36, 0.15);
    color: var(--status-warn);
    border-radius: var(--r-xs);
  }

  .permission-ref-desc {
    font-size: 11px;
    color: var(--text-4);
    margin: 0;
    line-height: 1.4;
  }
  
  /* === v6.1 Status Row Styles === */
  .status-row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .status-info-group {
    display: flex;
    flex-direction: column;
  }
  
  .status-detail-text {
    font-size: 13px;
    color: var(--text-3);
  }
  
  .progress-section {
    margin-top: var(--s-5);
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-dim);
  }
  
  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2);
  }
  
  .progress-value {
    font-size: 12px;
    font-weight: 500;
  }
  
  /* btn-danger styles come from hologram.css */
  
  .c-text-4 {
    color: var(--text-4);
  }
  
  /* Slider styles - supplement hologram.css */
  .slider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2);
  }
  
  .slider-value {
    font-size: 13px;
    font-weight: 500;
  }
  
  /* Checkbox styles - supplement hologram.css with local layout helpers */
  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  .checkbox-item {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    cursor: pointer;
  }
  
  .checkbox-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .checkbox-text {
    font-size: 13px;
    color: var(--text-2);
  }
  
  .checkbox-hint {
    font-size: 10px;
    color: var(--text-4);
  }
  
  /* Card and section styles now come from hologram.css via .section-card classes */
  /* Only keeping Tailwind utility overrides for backwards compatibility */
  
  /* === Mining Section Styles === */
  .mining-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-4);
  }
  
  .mining-stat {
    background: var(--void-deep);
    border-radius: 8px;
    padding: var(--s-4);
    text-align: center;
  }
  
  .mining-stat-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-4);
    margin-bottom: 4px;
  }
  
  .mining-stat-value {
    display: block;
    font-size: 18px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-1);
  }
  
  .mining-difficulty {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  @media (max-width: 640px) {
    .mining-stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  /* === Phase 2 v6.1 Spacing Classes === */
  
  /* Info List */
  .info-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    font-size: 13px;
    color: var(--text-3);
  }
  
  .info-item {
    line-height: 1.5;
  }
  
  /* Benchmark Form */
  .benchmark-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  .benchmark-field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .benchmark-label {
    display: block;
    font-size: 13px;
    color: var(--text-4);
  }
  
  .benchmark-slider {
    width: 100%;
    accent-color: var(--cyan-500);
  }
  
  .benchmark-slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-5);
  }
  
  .benchmark-running {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
  }
  
  .benchmark-result {
    margin-top: var(--s-4);
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-lg);
    border: 1px solid rgba(6, 182, 212, 0.3);
  }
  
  .benchmark-result-header {
    text-align: center;
    margin-bottom: var(--s-4);
  }
  
  .benchmark-hashrate {
    font-size: 28px;
    font-weight: 700;
    color: var(--cyan-400);
  }
  
  .benchmark-threads-used {
    font-size: 12px;
    color: var(--text-5);
    margin-top: var(--s-1);
  }
  
  .benchmark-per-thread {
    margin-top: var(--s-3);
  }
  
  .per-thread-label {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .per-thread-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    margin-top: var(--s-1);
  }
  
  .per-thread-item {
    padding: 4px var(--s-2);
    background: var(--void-mid);
    border-radius: var(--r-sm);
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-3);
  }
  
  /* Toggle label + switch for page headers */
  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-3);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .toggle-text {
    color: var(--text-3);
  }

  .toggle {
    width: 44px;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background: var(--void-up);
    border-width: 1px !important;
    border-style: solid !important;
    border-color: #1e1e2a !important;
    outline: none !important;
    box-shadow: none !important;
    border-radius: 11px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .toggle:checked {
    background: var(--cyan);
    border-color: var(--cyan) !important;
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: #ffffff;
    border-width: 0 !important;
    border-style: none !important;
    border-color: transparent !important;
    box-shadow: none !important;
    border-radius: 50%;
    transition: transform 0.2s ease;
  }

  .toggle:checked::after {
    transform: translateX(22px);
  }
  
  .dev-support-status {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--void-deep);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }
  
  .status-indicator .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-4);
  }
  
  .status-indicator.active .status-dot {
    background: var(--emerald);
    box-shadow: 0 0 8px var(--emerald);
    animation: pulse-dot 2s infinite;
  }
  
  .status-indicator.paused .status-dot {
    background: var(--status-warn);
  }
  
  .status-indicator.disabled .status-dot {
    background: var(--status-err);
  }
  
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .status-indicator .status-text {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .pause-reason-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border-radius: 8px;
    border: 1px solid rgba(251, 191, 36, 0.2);
  }
  
  .pause-reason-box .btn {
    align-self: flex-start;
  }
  
  .pause-reason {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--status-warn);
    margin: 0;
  }
  
  .active-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--emerald);
    padding: 8px 16px;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 6px;
    margin: 0;
  }
  
  .contributions-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  
  .contribution-stat {
    text-align: center;
    padding: 20px;
    background: var(--void-deep);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }
  
  .contribution-value {
    display: block;
    font-size: 24px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-1);
    margin-bottom: 4px;
  }
  
  .contribution-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-4);
  }
  
  .sessions-info {
    text-align: center;
    font-size: 12px;
    color: var(--text-4);
    margin-top: 12px;
  }
  
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  
  .info-item {
    display: flex;
    gap: 12px;
    padding: 16px;
    background: var(--void-deep);
    border-radius: 8px;
  }
  
  .info-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(34, 211, 238, 0.1);
    border-radius: 8px;
    color: var(--cyan-400);
  }
  
  .info-content strong {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
    margin-bottom: 4px;
  }
  
  .info-content p {
    font-size: 12px;
    color: var(--text-4);
    line-height: 1.4;
    margin: 0;
  }
  
  /* Legacy epoch-info-card styles (kept for compatibility) */
  .epoch-info-card {
    background: var(--void-mid);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-xl);
    padding: var(--s-5);
  }
  
  .epoch-info-title {
    font-weight: 500;
    color: var(--text-2);
    margin-bottom: var(--s-4);
  }
  
  .epoch-status-label {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  /* Stat Grid */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }
  
  /* Simulator wallet balance row */
  .sim-wallet-balance-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: rgba(52, 211, 153, 0.08);
    border-radius: var(--r-md);
    border: 1px solid rgba(52, 211, 153, 0.15);
  }
  .sim-wallet-balance-label {
    font-size: 12px;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .sim-wallet-balance-value {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--emerald-400);
  }
  .sim-wallet-balance-hint {
    font-size: 11px;
    color: var(--text-5);
    margin-left: auto;
  }
  
  /* Action Input Group for Simulator Quick Actions */
  .action-input-group {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  /* Installed Info Row */
  .installed-info {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .version-text {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
  }
  
  /* Prune Input Row */
  .prune-input-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  /* Add Host Form */
  .add-host-form {
    display: flex;
    gap: var(--s-2);
    margin-bottom: var(--s-4);
  }
  
  .host-input {
    flex: 1;
  }
  
  /* Connection Log */
  .connection-log {
    max-height: 192px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .connection-log-empty {
    font-size: 13px;
    color: var(--text-5);
    text-align: center;
    padding: var(--s-4);
  }
  
  .connection-log-entry {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-2);
    background: var(--void-deep);
    border-radius: var(--r-md);
    font-size: 12px;
  }
  
  .log-dot {
    width: 8px;
    height: 8px;
    margin-top: 4px;
    border-radius: var(--r-full);
    flex-shrink: 0;
  }
  
  .log-dot-ok {
    background: var(--status-ok);
  }
  
  .log-dot-err {
    background: var(--status-err);
  }
  
  .log-entry-info {
    flex: 1;
    min-width: 0;
  }
  
  .log-entry-host {
    display: block;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .log-entry-reason {
    color: var(--text-5);
  }
  
  /* === Console Terminal Styles === */
  .console-content {
    padding: 0;
  }
  
  .console-viewport {
    height: 400px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--s-4);
    background: var(--void-pure);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }
  
  .console-empty {
    color: var(--text-5);
    font-style: italic;
    padding: var(--s-4);
  }
  
  .console-line {
    display: flex;
    gap: var(--s-2);
    padding: 2px 0;
    color: var(--text-2);
  }
  
  .console-timestamp {
    color: var(--text-5);
    flex-shrink: 0;
  }
  
  .console-message {
    word-break: break-word;
  }
  
  .console-line.level-error {
    color: var(--status-err);
  }
  
  .console-line.level-warn {
    color: var(--status-warn);
  }
  
  .console-actions {
    display: flex;
    gap: var(--s-2);
  }
  
  .explorer-header-right {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  /* === Phase 3 v6.1 Typography Classes === */
  
  /* Sync Progress */
  .sync-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2);
  }
  
  .sync-progress-value {
    font-size: 13px;
    color: var(--cyan-400);
    font-family: var(--font-mono);
  }
  
  /* Update Notice */
  .update-notice {
    font-size: 13px;
  }
  
  /* Difficulty Value */
  .difficulty-value {
    color: var(--cyan-400);
    font-family: var(--font-mono);
  }
  
  /* EPOCH Hint */
  .epoch-hint {
    font-size: 12px;
    margin-top: var(--s-2);
    color: var(--text-4);
  }
  
  /* === Phase 4 v6.1 Layout Classes === */
  
  /* Section Header */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-4);
  }
  
  /* === About Section Styles === */
  .about-details {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    overflow: hidden;
    margin-bottom: var(--s-6);
  }
  
  .about-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-3) var(--s-4);
  }
  
  .about-row:not(:last-child) {
    border-bottom: 1px solid var(--border-dim);
  }
  
  .about-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  
  .about-value {
    font-size: 13px;
    color: var(--text-2);
  }
  
  .about-value.mono {
    font-family: var(--font-mono);
  }
  
  .about-network-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .about-network-badge.mainnet {
    background: rgba(34, 211, 238, 0.1);
    color: var(--cyan-400);
    border: 1px solid rgba(34, 211, 238, 0.25);
  }
  
  .about-network-badge.simulator {
    background: rgba(248, 113, 113, 0.1);
    color: var(--status-err);
    border: 1px solid rgba(248, 113, 113, 0.25);
  }
  
  .about-footer {
    text-align: center;
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-subtle);
  }
  
  .about-copyright {
    font-size: 12px;
    color: var(--text-5);
    margin: 0 0 var(--s-1) 0;
  }
  
  .about-tagline {
    font-size: 13px;
    font-style: italic;
    color: var(--text-4);
    margin: 0;
  }
  
  /* Search Exclusions Styles */
  .exclusions-list {
    padding: var(--s-2);
    background: var(--void-base);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }
  
  .exclusions-header {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--s-2);
  }
  
  .exclusions-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  
  .exclusion-tag {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding: 2px 8px;
    background: var(--surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }
  
  .exclusion-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 2px;
    font-size: 14px;
    line-height: 1;
  }
  
  .exclusion-remove:hover {
    background: var(--status-error);
    color: white;
  }
  
  .exclusion-input-row {
    display: flex;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  
  .exclusion-input-row .form-input {
    flex: 1;
  }
  
  .exclusions-modal-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-height: 300px;
    overflow-y: auto;
  }
  
  .exclusion-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-2);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }
  
  .exclusion-text {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-primary);
  }
  
  .empty-exclusions {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-6);
    color: var(--text-muted);
  }
  
  .empty-exclusions p {
    margin: 0;
    font-size: 13px;
  }
  
  .input-group {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .form-input {
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    color: var(--text-1);
    font-family: var(--font-mono);
    font-size: 13px;
    outline: none;
    transition: border-color 200ms ease-out, box-shadow 200ms ease-out;
    -moz-appearance: textfield;
  }
  
  .form-input::-webkit-outer-spin-button,
  .form-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  .form-input:focus {
    border-color: var(--cyan-500);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.15);
  }
  
  .form-input::placeholder {
    color: var(--text-5);
  }
  
  .input-suffix {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-4);
  }
  
  .btn-group {
    display: flex;
    gap: var(--s-1);
  }
  
  .btn-danger-outline {
    background: transparent;
    border: 1px solid var(--status-error);
    color: var(--status-error);
  }
  
  .btn-danger-outline:hover {
    background: var(--status-error);
    color: white;
  }
  
  .settings-modal-lead {
    margin: 0 0 var(--s-2);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }
  
  .settings-modal-desc {
    margin: 0 0 var(--s-4);
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.6;
  }
  
  .resync-title-icon {
    color: var(--status-warn);
  }
  
  .resync-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }
  
  .resync-metric {
    border-radius: var(--r-lg);
    border: 1px solid var(--border-subtle);
    background: var(--void-deep);
    padding: var(--s-4);
  }
  
  .resync-metric-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-4);
  }
  
  .resync-metric-value {
    margin-top: var(--s-2);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }
  
  .resync-metric-meta {
    margin-top: var(--s-1);
    font-size: 12px;
    color: var(--text-3);
  }
  
  .resync-choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    padding: var(--s-4);
    border-radius: var(--r-lg);
    border: 1px solid var(--border-subtle);
    background: var(--void-up);
    margin-bottom: var(--s-4);
  }
  
  .resync-choice-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-1);
  }
  
  .resync-choice-desc {
    margin-top: var(--s-1);
    font-size: 12px;
    color: var(--text-3);
  }
  
  .resync-confirm {
    margin-top: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-md);
    border: 1px dashed var(--border-subtle);
    background: var(--void-deep);
  }
  
  @media (max-width: 560px) {
    .resync-metrics {
      grid-template-columns: 1fr;
    }
    
    .resync-choice {
      flex-direction: column;
      align-items: stretch;
    }
  }
  
  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
  }
  
  .toggle-switch:hover {
    border-color: var(--border-default);
  }
  
  .toggle-switch.active {
    background: rgba(52, 211, 153, 0.2);
    border-color: var(--status-ok);
  }
  
  .toggle-slider {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    background: var(--text-4);
    border-radius: 50%;
    transition: all 0.2s ease;
  }
  
  .toggle-switch.active .toggle-slider {
    background: var(--status-ok);
    transform: translateX(20px);
  }
  
  /* Simple-Gnomon features styles */
  .stats-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  
  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  /* Watched SCs styles */
  .watched-loading,
  .watched-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-6);
    color: var(--text-4);
    font-size: 13px;
  }
  
  .watched-empty .hint {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .watched-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .watched-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
  }
  
  .watched-info {
    flex: 1;
    min-width: 0;
  }
  
  .watched-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
    margin-bottom: var(--s-1);
  }
  
  .watched-meta {
    display: flex;
    gap: var(--s-3);
    font-size: 11px;
    color: var(--text-4);
    font-family: var(--font-mono);
  }
  
  .watched-scid {
    color: var(--text-5);
  }
  
  .watched-changes {
    color: var(--cyan-400);
  }
  
  .watched-actions {
    flex-shrink: 0;
  }
  
  .watched-footer {
    margin-top: var(--s-3);
    padding-top: var(--s-3);
    border-top: 1px solid var(--border-dim);
    text-align: center;
    font-size: 11px;
    color: var(--text-5);
  }
  
  .explorer-header-right {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  /* Manual Installation Instructions */
  .manual-instructions {
    background: var(--bg-card);
    border: 1px solid var(--border-dim);
    border-radius: var(--s-2);
  }
  
  .manual-instructions-text {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    background: var(--bg-card-hover);
    padding: var(--s-3);
    border-radius: var(--s-1);
    color: var(--text-2);
    margin: 0;
  }
  
  .manual-links {
    display: flex;
    gap: var(--s-2);
  }
  
  .alert-success {
    background: color-mix(in srgb, var(--status-ok) 15%, transparent);
    border: 1px solid var(--status-ok);
    color: var(--status-ok);
    padding: var(--s-3);
    border-radius: var(--s-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .alert-error {
    background: color-mix(in srgb, var(--status-error) 15%, transparent);
    border: 1px solid var(--status-error);
    color: var(--status-error);
    padding: var(--s-3);
    border-radius: var(--s-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  /* Endpoint Input Row */
  .endpoint-input-row {
    display: flex;
    gap: var(--s-2);
    margin-top: 8px;
  }
  
  .endpoint-input {
    flex: 1;
  }
  
  .endpoint-success {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
  }
  
  .endpoint-success-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .endpoint-success-info strong {
    color: var(--status-ok);
  }
  
  .endpoint-details {
    font-size: 12px;
    color: var(--text-3);
  }
</style>
