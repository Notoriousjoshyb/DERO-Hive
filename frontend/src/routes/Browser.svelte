<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { appState, settingsState, walletState, addToHistory, addConsoleLog, pendingNavigation, clearPendingNavigation, requestWalletApproval, walletRequests, consoleLogs as consoleLogsStore, clearConsoleLogs as clearConsoleLogsStore, navigateTo, updateStatus, toast, setAppDiscoveryState } from '../lib/stores/appState.js';
  import { favorites } from '../lib/stores/favorites.js';
  import { Navigate, FetchSCID, FetchByDURL, GetAppRating, GetNameSuggestions, CallXSWD, ConnectXSWD, ApproveWalletConnection, InternalWalletCall, GetDiscoveredApps, StartGnomon, EnsureGnomonRunning, GetLocalDevServerStatus, StartLocalDevServer, ServeTELAContent, ShutdownServer, ListActiveServers, ClearConsoleLogs as ClearBackendLogs, SetGnomonAutostart, GetGnomonAutostart, GetAllTags, GetTELAAppsWithTags, GetSCIDMetadata, CheckAppFilter, GetContentFilterConfig, ManuallyAllowApp, ManuallyBlockApp, ClearAppFilterOverride, GetLiveStats, GetBalance, GetTransactionHistory, SaveBinaryFileWithDialog, SelectFileWithContent, OpenURLInBrowserIfAllowed, ClearAppCache, IsAppCachedOffline } from '../../wailsjs/go/main/App.js';
  import ReloadSplitButton from '../lib/components/browser/ReloadSplitButton.svelte';
  import { EventsOn, EventsOff, ClipboardSetText } from '../../wailsjs/runtime/runtime.js';
import { HoloBadge, DotIndicator, Icons } from '../lib/components/holo';
import RatingModal from '../lib/components/RatingModal.svelte';
import RatingsBreakdown from '../lib/components/RatingsBreakdown.svelte';
import VersionHistory from '../lib/components/VersionHistory.svelte';
import { Star, History, GitBranch, Heart, Link2, X } from 'lucide-svelte';
import deroIconFallback from '../assets/dero-icon-fallback.svg';
import OmniSearch from '../lib/components/OmniSearch.svelte';

// Permission helpers for XSWD connection requests
function isAllowedExternalWebUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getPermissionName(permId) {
  const names = {
    'read_public_data': 'Read Public Blockchain Data',
    'view_address': 'View Wallet Address',
    'view_balance': 'View Balance',
    'sign_transaction': 'Sign Transactions',
    'sc_invoke': 'Smart Contract Calls'
  };
  return names[permId] || permId;
}

function getPermissionDescription(permId) {
  const descriptions = {
    'read_public_data': 'Can read public blockchain info (blocks, transactions, network stats)',
    'view_address': 'Can see your public wallet address',
    'view_balance': 'Can see your wallet balance',
    'sign_transaction': 'Can request to send DERO (requires approval each time)',
    'sc_invoke': 'Can request smart contract interactions (requires approval each time)'
  };
  return descriptions[permId] || 'Unknown permission';
}

// Parse SC payload from raw DERO RPC format for display in wallet modal
// Extracts entrypoint and sc_args from sc_rpc array
function parseScPayload(params) {
  if (!params) return params;
  
  const scRpc = params.sc_rpc || params.sc_data || [];
  
  // Extract entrypoint from sc_rpc if present
  let entrypoint = params.entrypoint;
  if (!entrypoint && Array.isArray(scRpc)) {
    const entrypointArg = scRpc.find(arg => arg.name === 'entrypoint');
    if (entrypointArg) {
      entrypoint = entrypointArg.value;
    }
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
  
  return {
    ...params,
    entrypoint,
    sc_args: scArgs,
    sc_data: scRpc
  };
}

function closeExternalLinkModal() {
  showExternalLinkModal = false;
  externalLinkUrl = '';
}

async function copyExternalLinkToClipboard() {
  if (!externalLinkUrl) return;
  try {
    await ClipboardSetText(externalLinkUrl);
    toast.success('Link copied');
  } catch {
    toast.error('Could not copy link');
  }
}

async function openExternalLinkInSystemBrowser() {
  if (!externalLinkUrl || !isAllowedExternalWebUrl(externalLinkUrl)) return;
  try {
    const res = await OpenURLInBrowserIfAllowed(externalLinkUrl);
    if (!res || res.success === false) {
      return;
    }
    closeExternalLinkModal();
  } catch {
    toast.error('Could not open link');
  }
}

function resetXSWDSubscriptions() {
  xswdSubscriptions = { new_topoheight: false, new_balance: false, new_entry: false };
  lastTopoheight = null;
  lastBalance = null;
  seenEntryTxids = new Set();
  stopXSWDSubscriptionPolling();
}

function stopXSWDSubscriptionPolling() {
  if (xswdPollTimer) {
    clearInterval(xswdPollTimer);
    xswdPollTimer = null;
  }
  xswdPollingActive = false;
}

function sendXSWDEvent(method, params) {
  try {
    if (!contentFrame || !contentFrame.contentWindow) return;
    contentFrame.contentWindow.postMessage({
      type: 'xswd-event',
      method,
      params
    }, '*');
  } catch (e) {
    // Silently ignore cross-origin errors - expected when iframe has different origin
  }
}

async function pollXSWDSubscriptions() {
  // Guard against overlapping polls - if a previous poll is still running (e.g., slow API),
  // skip this cycle. This is intentional to prevent request pile-up.
  if (xswdPollingActive) return;
  xswdPollingActive = true;
  try {
    if (xswdSubscriptions.new_topoheight) {
      const stats = await GetLiveStats();
      const topo = stats?.topoheight;
      if (typeof topo === 'number' && topo !== lastTopoheight) {
        lastTopoheight = topo;
        sendXSWDEvent('new_topoheight', { topoheight: topo });
      }
    }

    if (xswdSubscriptions.new_balance) {
      const balanceResult = await GetBalance();
      if (balanceResult?.success) {
        const currentBalance = balanceResult?.balance ?? balanceResult?.result?.balance;
        if (typeof currentBalance === 'number' && currentBalance !== lastBalance) {
          lastBalance = currentBalance;
          sendXSWDEvent('new_balance', { balance: currentBalance });
        }
      }
    }

    if (xswdSubscriptions.new_entry) {
      const history = await GetTransactionHistory(10);
      if (history?.success && Array.isArray(history.transactions) && history.transactions.length > 0) {
        // Iterate through all transactions (oldest to newest) and emit events for new ones
        for (const tx of history.transactions) {
          if (tx?.txid && !seenEntryTxids.has(tx.txid)) {
            seenEntryTxids.add(tx.txid);
            sendXSWDEvent('new_entry', tx);
          }
        }
        // Limit the Set size to prevent memory growth (keep last 100 txids)
        if (seenEntryTxids.size > 100) {
          const txidsArray = Array.from(seenEntryTxids);
          seenEntryTxids = new Set(txidsArray.slice(-100));
        }
      }
    }
  } catch (e) {
    addConsoleLog(`[Warn] Subscription polling error: ${e.message || e}`, 'warn');
  } finally {
    xswdPollingActive = false;
  }
}

function startXSWDSubscriptionPolling() {
  if (xswdPollTimer) return;
  xswdPollTimer = setInterval(pollXSWDSubscriptions, 2000);
}

let addressInput = '';
  let addressInputEl;
  let loading = false;
  let showWelcome = true;
  let currentMeta = {};
  let suggestions = [];
  let showSuggestions = false;
  let contentFrame;
  let telaServerFallback = null;
  let selectedIndex = -1;
  let debounceTimer;
  let unsubscribePending;
  let unsubscribeWalletRequests;
  let hasNavigated = false;
  let previousWalletRequestCount = 0;
  let addressBarFocused = false;
  let xswdPollTimer = null;
  let xswdPollingActive = false;
  let xswdSubscriptions = { new_topoheight: false, new_balance: false, new_entry: false };
  let lastTopoheight = null;
  let lastBalance = null;
  let seenEntryTxids = new Set();
  
  // Browser tabs state - each tab has its own history
  let tabs = [
    { id: 'discover', title: 'Discover Apps', icon: 'home', isHome: true, history: [], historyIndex: -1 }
  ];
  let activeTabId = 'discover';
  let tabIdCounter = 1;
  let saveSessionTimer;
  
  function saveBrowserSession() {
    appState.update(state => ({
      ...state,
      browserSession: {
        tabs,
        activeTabId,
        tabIdCounter,
        addressInput,
        showWelcome,
        selectedCategory,
        selectedTag,
        sortBy,
        minRating,
        showBlockedApps,
        updatedAt: Date.now()
      }
    }));
  }
  
  function scheduleBrowserSessionSave() {
    clearTimeout(saveSessionTimer);
    saveSessionTimer = setTimeout(() => {
      saveBrowserSession();
    }, 200);
  }
  
  function restoreBrowserSession() {
    const session = get(appState).browserSession;
    if (!session || !session.tabs || session.tabs.length === 0) {
      return false;
    }
    
    tabs = session.tabs;
    activeTabId = session.activeTabId || session.tabs[0].id;
    tabIdCounter = session.tabIdCounter || session.tabs.length;
    addressInput = session.addressInput || '';
    showWelcome = typeof session.showWelcome === 'boolean' ? session.showWelcome : true;
    selectedCategory = session.selectedCategory || 'top';
    selectedTag = session.selectedTag || '';
    sortBy = session.sortBy || 'rating';
    minRating = typeof session.minRating === 'number' ? session.minRating : 0;
    showBlockedApps = typeof session.showBlockedApps === 'boolean' ? session.showBlockedApps : false;
    
    return true;
  }
  
  // Helper to get current tab
  function getCurrentTab() {
    return tabs.find(t => t.id === activeTabId);
  }
  
  // Helper to update current tab's history
  function pushToTabHistory(url) {
    tabs = tabs.map(t => {
      if (t.id === activeTabId) {
        // Truncate forward history if navigating from middle
        let newHistory = t.history;
        if (t.historyIndex < t.history.length - 1) {
          newHistory = t.history.slice(0, t.historyIndex + 1);
        }
        // Add new entry
        newHistory = [...newHistory, url];
        // Limit history size (keep last 50 per tab)
        if (newHistory.length > 50) {
          newHistory.shift();
        }
        return { ...t, history: newHistory, historyIndex: newHistory.length - 1 };
      }
      return t;
    });
  }
  
  // Console panel state
  let showConsole = false;
  let consoleLogs = [];
  let unsubscribeConsole;
  let consoleViewport;
  let consoleUserScrolled = false;
  let previousLogCount = 0;
  let expandedLogIndices = new Set(); // Track which log entries have expanded details
  let consoleFilterErrorsOnly = false; // Level filter: show only errors/warnings
  let consoleFilterSource = 'all'; // Source filter: 'all' | 'dapp' | 'hologram' | 'bridge'
  
  // Reactive: filtered logs based on level and source filters
  $: filteredConsoleLogs = consoleLogs.filter(log => {
    // Level filter
    if (consoleFilterErrorsOnly && log.level !== 'error' && log.level !== 'warn') {
      return false;
    }
    // Source filter
    if (consoleFilterSource !== 'all') {
      const logSource = log.source || 'unknown';
      if (consoleFilterSource === 'dapp') {
        // Include dapp, dapp-uncaught, dapp-rejection
        if (!logSource.startsWith('dapp')) return false;
      } else if (consoleFilterSource === 'hologram') {
        if (logSource !== 'hologram') return false;
      } else if (consoleFilterSource === 'bridge') {
        if (logSource !== 'bridge') return false;
      }
    }
    return true;
  });
  
  // Reactive: error and warning counts (from full log, not filtered)
  $: consoleErrorCount = consoleLogs.filter(log => log.level === 'error').length;
  $: consoleWarnCount = consoleLogs.filter(log => log.level === 'warn').length;
  
  function toggleLogExpanded(index) {
    if (expandedLogIndices.has(index)) {
      expandedLogIndices.delete(index);
    } else {
      expandedLogIndices.add(index);
    }
    expandedLogIndices = expandedLogIndices; // Trigger reactivity
  }
  
  function hasExpandableContent(log) {
    return log.stack || (log.args && log.args.length > 0) || log.app || log.location;
  }
  
  function toggleErrorsOnlyFilter() {
    consoleFilterErrorsOnly = !consoleFilterErrorsOnly;
    expandedLogIndices = new Set(); // Reset expanded state when filter changes
  }
  
  function setSourceFilter(source) {
    consoleFilterSource = source;
    expandedLogIndices = new Set(); // Reset expanded state when filter changes
  }
  
  // App discovery state
  let apps = [];
  let filteredApps = [];
  let appsLoading = false;
  let appsLoaded = false; // Track if we've attempted to load apps (prevents infinite loop when 0 apps found)
  let waitingForInitialApps = false;
  let appDiscoveryRetryCount = 0;
  let appDiscoveryRetryTimer = null;
  const APP_DISCOVERY_RETRY_DELAY_MS = 5000;
  const APP_DISCOVERY_MAX_RETRIES = 12;
  let selectedCategory = 'top';
  let sortBy = 'rating';
  
  // Track failed icon URLs to show fallback
  let failedIcons = new Set();
  
  // Handle icon load error - mark as failed and trigger re-render
  function handleIconError(iconUrl) {
    failedIcons.add(iconUrl);
    failedIcons = failedIcons; // Trigger Svelte reactivity
  }
  
  // Check if icon should be shown (exists and hasn't failed)
  function shouldShowIcon(iconUrl) {
    return iconUrl && !failedIcons.has(iconUrl);
  }

  function clearAppDiscoveryRetryTimer() {
    if (appDiscoveryRetryTimer) {
      clearTimeout(appDiscoveryRetryTimer);
      appDiscoveryRetryTimer = null;
    }
  }
  
  // Gnomon auto-start preference
  let enableAutostart = false;
  
  // True while Browser.svelte is attempting to auto-start Gnomon on mount
  let gnomonStarting = false;
  
  // Local Dev Mode state
  let isLocalDevMode = false;
  let localDevUrl = '';
  let hotReloadInProgress = false; // Flag to auto-approve XSWD during hot reload
  
  // Session approval tracking - prevents double-modal when stale content reloads via HTTP
  let sessionApprovedScid = null;
  let sessionApprovedAppName = null;
  let sessionApprovalTime = 0;
  
  // Favorites
  let showAllFavorites = false;
  
  // Rating modal state
  let showRatingModal = false;
  let ratingAppScid = '';
  let ratingAppName = '';
  
  // Version History state
  let showVersionHistory = false;
  let versionHistoryScid = '';
  
  // Ratings breakdown state
  let showRatingsBreakdown = false;
  let breakdownScid = '';

  let showExternalLinkModal = false;
  let externalLinkUrl = '';
  
  function openRatingModal(app, event) {
    event.stopPropagation();
    ratingAppScid = app.scid;
    ratingAppName = app.display_name || app.name || 'TELA App';
    showRatingModal = true;
  }
  
  function openRatingsBreakdown(app, event) {
    event.stopPropagation();
    breakdownScid = app.scid;
    showRatingsBreakdown = true;
  }
  
  function handleRated(event) {
    // Refresh the app list to show updated rating
    loadApps();
  }
  
  // Version History functions
  function openVersionHistory() {
    // Get current SCID from address bar or current meta
    const scid = currentMeta?.scid || addressInput;
    if (scid && scid.length === 64) {
      versionHistoryScid = scid;
      showVersionHistory = true;
    } else {
      toast.warn('No TELA app loaded. Navigate to a TELA app first.');
    }
  }
  
  function closeVersionHistory() {
    showVersionHistory = false;
  }
  
  function handleVersionRevert(event) {
    // Navigate to Studio Actions with the SCID
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'studio' }));
    showVersionHistory = false;
  }
  
  function handleVersionClone(event) {
    // Navigate to Studio Clone
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'studio' }));
    showVersionHistory = false;
  }
  
  const categories = [
    { id: 'top', label: 'Top Rated (7+)', iconName: 'star' },
    { id: 'good', label: 'Good (5+)', iconName: 'trending' },
    { id: 'unrated', label: 'Unrated', iconName: 'circle' },
    { id: 'all', label: 'All Apps', iconName: 'grid' },
  ];
  
  // Tag-based categories (Simple-Gnomon feature)
  let availableTags = [];
  let selectedTag = '';
  
  let minRating = 0;
  
  // Content filtering state
  let contentFilterConfig = null;
  let contentFilterEnabled = false;
  let blockedApps = new Set();
  let warnedApps = new Map(); // scid -> reason
  let showBlockedApps = false; // Toggle to show blocked apps
  
  // Check if current address is favorited
  $: currentIsFavorited = addressInput && $favorites && favorites.isFavorite(addressInput);
  
  async function loadApps() {
    if (appsLoading) {
      return;
    }

    // Only load apps if Gnomon is already running - don't auto-start
    if (!$appState.gnomonRunning) {
      clearAppDiscoveryRetryTimer();
      appsLoading = false;
      waitingForInitialApps = false;
      appDiscoveryRetryCount = 0;
      setAppDiscoveryState({ loading: false });
      return;
    }
    
    appsLoading = true;
    waitingForInitialApps = false;
    clearAppDiscoveryRetryTimer();
    setAppDiscoveryState({ loading: true });
    try {
      // Load content filter config first
      try {
        const filterConfigRes = await GetContentFilterConfig();
        if (filterConfigRes.success && filterConfigRes.config) {
          contentFilterConfig = filterConfigRes.config;
          contentFilterEnabled = contentFilterConfig.Enabled;
        }
      } catch (filterErr) {
        console.log('Content filter config not available:', filterErr);
      }
      
      // Load apps with ratings and tag metadata (includes Simple-Gnomon features)
      const result = await GetDiscoveredApps();
      if (result.success && result.apps) {
        // Apply content filtering to each app
        if (contentFilterEnabled) {
          await applyContentFiltering(result.apps);
        } else {
          blockedApps = new Set();
          warnedApps = new Map();
        }
        apps = result.apps;
        applyFilters();
      }
      
      // Load available tags for filtering (Simple-Gnomon feature)
      try {
        const tagsResult = await GetAllTags();
        if (tagsResult && tagsResult.success && tagsResult.tags) {
          availableTags = tagsResult.tags.filter(t => t && t !== 'all');
        }
      } catch (tagErr) {
        console.log('Tags not available yet:', tagErr);
        availableTags = [];
      }
      
      if (apps.length > 0) {
        appsLoaded = true;
        waitingForInitialApps = false;
        appDiscoveryRetryCount = 0;
      } else if (get(appState).gnomonRunning) {
        appsLoaded = false;
        if (appDiscoveryRetryCount < APP_DISCOVERY_MAX_RETRIES) {
          appDiscoveryRetryCount += 1;
          waitingForInitialApps = true;
          const retryAttempt = appDiscoveryRetryCount;
          console.log(`[Browser] No apps found yet, retrying discovery in 5 seconds (${retryAttempt}/${APP_DISCOVERY_MAX_RETRIES})`);
          appDiscoveryRetryTimer = setTimeout(() => {
            appDiscoveryRetryTimer = null;
            if (get(appState).gnomonRunning && apps.length === 0) {
              console.log('[Browser] Retrying app discovery...');
              loadApps();
            } else {
              waitingForInitialApps = false;
            }
          }, APP_DISCOVERY_RETRY_DELAY_MS);
        } else {
          waitingForInitialApps = false;
          appsLoaded = true;
          console.log('[Browser] App discovery retry budget exhausted; showing empty state');
        }
      } else {
        waitingForInitialApps = false;
        appsLoaded = true;
      }
    } catch (error) {
      console.error('Failed to load apps:', error);
      waitingForInitialApps = false;
      appDiscoveryRetryCount = 0;
      clearAppDiscoveryRetryTimer();
      appsLoaded = true; // Mark as loaded to prevent retry loop
    } finally {
      appsLoading = false;
      setAppDiscoveryState({ loading: appsLoading || waitingForInitialApps, loaded: appsLoaded });
      if (appsLoaded && apps.length > 0) {
        const currentIndexedHeight = get(appState).gnomonIndexedHeight || 0;
        appState.update(state => ({
          ...state,
          appDiscoveryCache: {
            apps,
            availableTags,
            blockedApps: Array.from(blockedApps),
            warnedApps: Array.from(warnedApps.entries()),
            contentFilterEnabled,
            lastLoadedAt: Date.now(),
            lastIndexedHeight: currentIndexedHeight
          }
        }));
      }
    }
  }
  
  // Track last indexed height for reactive reload
  let lastIndexedHeight = 0;
  
  function restoreDiscoveryCache() {
    const cache = get(appState).appDiscoveryCache;
    if (!cache || !cache.apps || cache.apps.length === 0) {
      return false;
    }
    
    apps = cache.apps;
    availableTags = cache.availableTags || [];
    blockedApps = new Set(cache.blockedApps || []);
    warnedApps = new Map(cache.warnedApps || []);
    contentFilterEnabled = !!cache.contentFilterEnabled;
    appsLoaded = true;
    appsLoading = false;
    lastIndexedHeight = cache.lastIndexedHeight || get(appState).gnomonIndexedHeight || 0;
    applyFilters();
    setAppDiscoveryState({ loading: false, loaded: true });
    return true;
  }
  
  // Reset appsLoaded when Gnomon stops (so it can reload when restarted)
  $: if (!$appState.gnomonRunning && (appsLoaded || appsLoading || waitingForInitialApps)) {
    clearAppDiscoveryRetryTimer();
    waitingForInitialApps = false;
    appDiscoveryRetryCount = 0;
    appsLoaded = false;
    appsLoading = false;
    apps = [];
    filteredApps = [];
    setAppDiscoveryState({ loading: false, loaded: false });
  }
  
  // Reactive: reload apps when Gnomon starts running (if not yet loaded)
  // Uses appsLoaded flag to prevent infinite loop when 0 apps are found
  $: if ($appState.gnomonRunning && !appsLoaded && !appsLoading && !waitingForInitialApps) {
    loadApps();
  }
  
  // Reactive: reload apps when Gnomon syncs more blocks (finds new apps)
  // Reload when indexed height increases by at least 1000 blocks
  $: if ($appState.gnomonRunning && $appState.gnomonIndexedHeight > lastIndexedHeight + 1000 && !appsLoading) {
    lastIndexedHeight = $appState.gnomonIndexedHeight;
    loadApps();
  }
  
  // Safety: reset category if it's 'epoch' (removed filter)
  $: if (selectedCategory === 'epoch') {
    selectedCategory = 'top';
    applyFilters();
  }
  
  // Apply content filtering to apps (calls backend CheckAppFilter)
  async function applyContentFiltering(appList) {
    const newBlocked = new Set();
    const newWarned = new Map();
    
    // Process apps in parallel batches for performance
    const batchSize = 20;
    for (let i = 0; i < appList.length; i += batchSize) {
      const batch = appList.slice(i, i + batchSize);
      await Promise.all(batch.map(async (app) => {
        try {
          const result = await CheckAppFilter(
            app.scid,
            app.display_name || app.name || 'Unknown',
            app.author || '',
            app.category || '',
            Math.round((app.rating?.average || 0) * 10), // Convert to 0-99 scale
            app.rating?.count || 0,
            app.supports_epoch || false
          );
          
          if (result.success) {
            if (result.decision === 'block' && !result.user_override) {
              newBlocked.add(app.scid);
            } else if (result.decision === 'warn' && !result.user_override) {
              newWarned.set(app.scid, result.reason);
            }
          }
        } catch (e) {
          // If filter check fails, allow the app
          console.log('Filter check failed for', app.scid, e);
        }
      }));
    }
    
    blockedApps = newBlocked;
    warnedApps = newWarned;
  }
  
  // Manually allow a blocked/warned app
  async function allowApp(scid) {
    try {
      const result = await ManuallyAllowApp(scid);
      if (result.success) {
        blockedApps.delete(scid);
        warnedApps.delete(scid);
        blockedApps = blockedApps; // Trigger reactivity
        warnedApps = warnedApps;
        toast.success('App allowed');
      }
    } catch (e) {
      toast.error('Failed to allow app');
    }
  }
  
  // Manually block an app
  async function blockApp(scid) {
    try {
      const result = await ManuallyBlockApp(scid);
      if (result.success) {
        blockedApps.add(scid);
        warnedApps.delete(scid);
        blockedApps = blockedApps;
        warnedApps = warnedApps;
        applyFilters(); // Re-filter to hide the app
        toast.success('App blocked');
      }
    } catch (e) {
      toast.error('Failed to block app');
    }
  }
  
  function applyFilters() {
    let result = [...apps];
    
    // Apply content filter (hide blocked apps unless showBlockedApps is true)
    if (contentFilterEnabled && !showBlockedApps) {
      result = result.filter(app => !blockedApps.has(app.scid));
    }
    
    // Apply rating category filter
    switch (selectedCategory) {
      case 'top':
        result = result.filter(app => app.rating && app.rating.average >= 7);
        break;
      case 'good':
        result = result.filter(app => app.rating && app.rating.average >= 5);
        break;
      case 'unrated':
        result = result.filter(app => !app.rating || app.rating.count === 0);
        break;
    }
    
    // Apply tag filter (Simple-Gnomon feature)
    if (selectedTag) {
      result = result.filter(app => {
        const appTags = app.tags || [];
        const appClass = app.class || '';
        return appTags.includes(selectedTag) || appClass === selectedTag;
      });
    }
    
    if (minRating > 0) {
      result = result.filter(app => {
        if (!app.rating || app.rating.count === 0) return minRating === 0;
        return app.rating.average >= minRating;
      });
    }
    
    if (sortBy === 'rating') {
      result.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
    } else if (sortBy === 'name') {
      result.sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));
    }
    
    filteredApps = result;
  }
  
  function handleCategoryChange(categoryId) {
    selectedCategory = categoryId;
    applyFilters();
    scheduleBrowserSessionSave();
  }
  
  function handleTagChange(tag) {
    selectedTag = tag === selectedTag ? '' : tag; // Toggle tag
    applyFilters();
    scheduleBrowserSessionSave();
  }
  
  function handleSortChange(event) {
    sortBy = event.target.value;
    applyFilters();
    scheduleBrowserSessionSave();
  }
  
  function getRatingBadge(avg) {
    if (!avg || avg === 0) return 'cyan';
    if (avg >= 8) return 'emerald';
    if (avg >= 7) return 'ok';
    if (avg >= 5) return 'warn';
    return 'err';
  }
  
  function navigateToApp(app) {
    // Store clean URL (badge provides dero:// prefix visually)
    const url = app.durl || app.scid;
    const title = app.display_name || app.name || 'App';
    
    // Always open apps in a new tab from Discover
    openNewTab(title, url, 'box');
  }
  
  function navigateToFavorite(fav) {
    // Display just the dURL name or SCID (badge provides dero:// prefix)
    addressInput = fav.durl || fav.scid;
    navigate();
  }
  
  async function startIndexer() {
    try {
      // Save auto-start preference if checkbox is checked
      if (enableAutostart) {
        await SetGnomonAutostart(true);
      }
      
      await StartGnomon();
      // Update status immediately so $appState.gnomonRunning becomes true
      await updateStatus();
      // Give Gnomon a moment to initialize
      setTimeout(() => loadApps(), 500);
    } catch (err) {
      console.error('Failed to start Gnomon:', err);
    }
  }
  
  function toggleCurrentFavorite() {
    if (!addressInput) return;
    
    // addressInput is now clean (without dero:// prefix)
    const cleanInput = addressInput.startsWith('dero://') ? addressInput.slice(7) : addressInput;
    const isHexSCID = /^[a-fA-F0-9]{64}$/.test(cleanInput);
    
    const app = apps.find(a => 
      a.scid === cleanInput || 
      a.durl === cleanInput
    ) || {
      scid: isHexSCID ? cleanInput : null,
      durl: isHexSCID ? null : cleanInput,
      name: currentMeta.name || cleanInput
    };
    
    favorites.toggle(app);
  }
  
  // Toggle favorite from app card (used in Discover grid)
  function toggleAppFavorite(app, event) {
    event.stopPropagation(); // Don't navigate to app
    favorites.toggle(app);
  }
  
  // Check if an app is favorited (pass $favorites to make it reactive)
  function isAppFavorited(app, favList) {
    return favList.some(f => (app.scid && f.scid === app.scid) || (app.durl && f.durl === app.durl));
  }
  
  onMount(async () => {
    restoreBrowserSession();
    restoreDiscoveryCache();
    
    // Auto-start Gnomon when the Browser page opens — no reason to make the user
    // stare at a blank page and manually click "Start". EnsureGnomonRunning is
    // idempotent: it returns immediately if already running.
    if (!get(appState).gnomonRunning) {
      gnomonStarting = true;
      try {
        await EnsureGnomonRunning();
        await updateStatus();
      } catch (err) {
        console.error('[Browser] Auto-start Gnomon failed:', err);
      } finally {
        gnomonStarting = false;
      }
    }
    
    // Auto-focus address bar when entering Browser section
    await tick();
    if (addressInputEl) {
      addressInputEl.focus();
    }

    unsubscribePending = pendingNavigation.subscribe((nav) => {
      if (nav?.url && !hasNavigated) {
        hasNavigated = true;
        addressInput = nav.url;
        clearPendingNavigation();
        setTimeout(() => navigate(), 50);
      }
    });
    
    unsubscribeConsole = consoleLogsStore.subscribe(logs => {
      consoleLogs = logs;
    });
    
    // Watch for wallet request completions to restore iframe focus
    unsubscribeWalletRequests = walletRequests.subscribe(requests => {
      const currentCount = requests.length;
      // When a request completes (count decreases), restore focus to iframe
      if (previousWalletRequestCount > currentCount && contentFrame) {
        addConsoleLog('[Browser] Wallet request completed, restoring iframe focus');
        // Multiple attempts to ensure focus is restored
        [100, 300, 500, 1000].forEach(delay => {
          setTimeout(() => {
            try {
              if (contentFrame) {
                contentFrame.focus();
                // Also try clicking the iframe content
                try {
                  contentFrame.contentDocument?.body?.click();
                  contentFrame.contentDocument?.body?.focus();
                } catch (e) {
                  // Cross-origin may prevent this
                }
              }
            } catch (e) {
              // Silently ignore cross-origin errors
            }
          }, delay);
        });
      }
      previousWalletRequestCount = currentCount;
    });
    
    const handleSearchResult = (e) => {
      const { type, query, result } = e.detail;
      if (result && result.success && (type === 'sc' || type === 'durl')) {
        if (type === 'sc') {
          addressInput = query;
          setTimeout(() => navigate(), 50);
        } else if (type === 'durl') {
          addressInput = query;
          setTimeout(() => navigate(), 50);
        }
      }
    };
    window.addEventListener('search-result', handleSearchResult);
    
    // Handle direct browser navigation from Explorer (when user searches for a .tela domain)
    const handleBrowserNavigate = (e) => {
      const { durl } = e.detail;
      if (durl) {
        // Strip dero:// prefix if present (the navigate function handles it)
        addressInput = durl.replace(/^dero:\/\//i, '');
        setTimeout(() => navigate(), 50);
      }
    };
    window.addEventListener('browser-navigate', handleBrowserNavigate);
    
    // PostMessage handler for XSWD bridge communication from iframe
    const handleXSWDMessage = async (event) => {
      try {
        if (contentFrame && event.source === contentFrame.contentWindow && event.data?.type === 'xswd-request') {
          addConsoleLog(`[Browser] Received: action=${event.data.action}, id=${event.data.id}`);
        }
      } catch (e) {
        // Cross-origin comparison may fail - ignore
      }
      
      // Only handle messages from our iframe
      let isFromOurIframe = false;
      try {
        isFromOurIframe = contentFrame && event.source === contentFrame.contentWindow;
      } catch (e) {
        // Cross-origin comparison may fail - treat as not from our iframe
      }
      
      if (!isFromOurIframe) {
        if (event.data && event.data.type === 'xswd-request') {
          // Identify the source for debugging
          let sourceInfo = 'unknown';
          if (event.source === window) {
            sourceInfo = 'main window (self)';
          } else if (event.source === window.parent) {
            sourceInfo = 'parent window';
          } else if (event.source === window.top) {
            sourceInfo = 'top window';
          } else if (!contentFrame) {
            sourceInfo = 'no iframe loaded yet';
          } else {
            sourceInfo = `other window (origin: ${event.origin || 'null'})`;
          }
          addConsoleLog(`[Warn] Message from unexpected source: ${sourceInfo}`);
        }
        return;
      }

      if (event.data && event.data.type === 'hologram-external-link') {
        const url = typeof event.data.url === 'string' ? event.data.url.trim() : '';
        if (url && isAllowedExternalWebUrl(url)) {
          externalLinkUrl = url;
          showExternalLinkModal = true;
        }
        return;
      }

      // TELA / in-app HTML: open HOLOGRAM Block Explorer (OmniSearch) with a 64-hex SCID or other query
      if (event.data && event.data.type === 'hologram-explorer-search') {
        const query = typeof event.data.query === 'string' ? event.data.query.trim() : '';
        if (!query) return;
        window.dispatchEvent(new CustomEvent('search-navigate', {
          detail: { tab: 'explorer', type: 'hash', query, result: null }
        }));
        return;
      }

      if (!event.data || event.data.type !== 'xswd-request') {
        return;
      }
      
      const { id, action, payload } = event.data;
      addConsoleLog(`[Browser] Processing: ${action} (id=${id})`);
      
      try {
        let result;
        
        switch (action) {
          case 'log':
            // Add to console log, enriching dApp logs with app context
            if (typeof payload === 'object' && payload !== null && payload.source?.startsWith('dapp')) {
              // Enrich with current app context
              payload.app = {
                name: currentMeta?.name || null,
                scid: currentMeta?.scid || null,
                durl: currentMeta?.durl || addressInput || null
              };
            }
            addConsoleLog(payload);
            result = true;
            break;
            
          case 'connect':
            addConsoleLog(`[Browser] Connect request from: ${payload.appInfo?.name || 'Unknown App'}`);
            // Request wallet connection approval
            const settings = get(settingsState);
            const currentWalletState = get(walletState);
            addConsoleLog(`[Browser] integratedWallet setting: ${settings.integratedWallet}`);
            addConsoleLog(`[Browser] wallet isOpen: ${currentWalletState.isOpen}`);
            if (settings.integratedWallet) {
              // Check if wallet is open - most dApps need wallet methods after connect
              if (!currentWalletState.isOpen) {
                addConsoleLog('[Browser] Integrated wallet mode but no wallet open - warning user');
              }
              try {
                // Auto-approve during hot reload to avoid modal interruption
                if (hotReloadInProgress) {
                  addConsoleLog('[Browser] Hot reload in progress - auto-approving XSWD reconnection');
                  const approveResult = await ApproveWalletConnection();
                  addConsoleLog(`[Browser] Auto-approve result: ${JSON.stringify(approveResult)}`);
                  result = true;
                } else {
                  // Check if this app was already approved in this session (prevents double-modal
                  // when stale cached content loads in srcdoc then switches to HTTP server)
                  const connectingAppName = payload.appInfo?.name || '';
                  const timeSinceApproval = Date.now() - sessionApprovalTime;
                  const sameScid = sessionApprovedScid != null && currentMeta?.scid && sessionApprovedScid === currentMeta.scid;
                  const sameName = sessionApprovedAppName != null && connectingAppName && sessionApprovedAppName === connectingAppName;
                  
                  if ((sameScid || sameName) && timeSinceApproval < 30000) {
                    addConsoleLog(`[Browser] Auto-approving reconnect for: ${connectingAppName} (already approved in this session)`);
                    const approveResult = await ApproveWalletConnection();
                    result = approveResult?.success === true;
                  } else {
                    addConsoleLog('[Browser] Requesting wallet approval via modal...');
                    // Check if app requests specific permissions in handshake
                    const requestedPerms = payload.appInfo?.permissions || [];
                    const hasWalletPerms = requestedPerms.some(p => 
                      ['view_address', 'view_balance', 'sign_transaction', 'sc_invoke'].includes(p)
                    );
                    // Default to read-only unless app explicitly requests wallet permissions
                    const isReadOnly = !hasWalletPerms;
                    // Flag if wallet is not open but app likely needs it
                    const walletNotOpen = !currentWalletState.isOpen;
                    
                    const approval = await requestWalletApproval({
                      type: 'connect',
                      appName: payload.appInfo?.name || currentMeta.name || 'App',
                      origin: addressInput,
                      description: payload.appInfo?.description || '',
                      isReadOnly: isReadOnly,
                      walletNotOpen: walletNotOpen,
                      requestedPermissions: requestedPerms.length > 0 ? requestedPerms.map(p => ({
                        id: p,
                        name: getPermissionName(p),
                        description: getPermissionDescription(p),
                        alwaysAsk: ['sign_transaction', 'sc_invoke'].includes(p)
                      })) : [{ 
                        id: 'read_public_data', 
                        name: 'Read Public Blockchain Data',
                        description: 'Can read public blockchain info (blocks, transactions, network stats)',
                        alwaysAsk: false
                      }]
                    });
                    addConsoleLog(`[Browser] Approval result: approved=${approval?.approved}`);
                    if (approval && approval.approved) {
                      addConsoleLog('[Browser] Calling ApproveWalletConnection...');
                      const approveResult = await ApproveWalletConnection();
                      addConsoleLog(`[Browser] ApproveWalletConnection result: ${JSON.stringify(approveResult)}`);
                      // Record this approval for reconnect deduplication
                      sessionApprovedScid = currentMeta?.scid || null;
                      sessionApprovedAppName = connectingAppName;
                      sessionApprovalTime = Date.now();
                      result = true;
                    } else {
                      addConsoleLog('[Browser] User denied connection');
                      result = false;
                    }
                  }
                }
              } catch (e) {
                addConsoleLog(`[Error] Approval error: ${e.message}`);
                result = false;
              }
            } else {
              addConsoleLog('[Browser] Using external XSWD (integratedWallet=false)');
              result = await ConnectXSWD();
            }
            break;
            
          case 'call':
            // Handle XSWD method call
            const { method, params, authState } = payload;
            const normalizedMethod = method.replace('DERO.', '');
          const methodLower = normalizedMethod.toLowerCase();
          const callSettings = get(settingsState);
          
          // Handle Subscribe/Unsubscribe for integrated wallet by polling
          if (callSettings.integratedWallet && (methodLower === 'subscribe' || methodLower === 'unsubscribe')) {
            const eventType = params?.event;
            if (!eventType || !Object.prototype.hasOwnProperty.call(xswdSubscriptions, eventType)) {
              throw new Error(`Unknown event type: ${eventType || 'undefined'}`);
            }
            
            if (methodLower === 'subscribe') {
              xswdSubscriptions[eventType] = true;
              addConsoleLog(`[Browser] Subscribed (internal): ${eventType}`);
              startXSWDSubscriptionPolling();
              result = { event: eventType, subscribed: true };
            } else {
              xswdSubscriptions[eventType] = false;
              addConsoleLog(`[Browser] Unsubscribed (internal): ${eventType}`);
              if (!xswdSubscriptions.new_topoheight && !xswdSubscriptions.new_balance && !xswdSubscriptions.new_entry) {
                stopXSWDSubscriptionPolling();
              }
              result = { event: eventType, subscribed: false };
            }
            break;
          }
            
            // Wallet methods that require authorization
            const walletMethods = ['GetAddress', 'GetBalance', 'GetHeight', 'GetTransferbyTXID', 
                                   'GetTransfers', 'GetTrackedAssets', 'MakeIntegratedAddress',
                                   'SplitIntegratedAddress', 'QueryKey', 'SignData', 'CheckSignature',
                                   'transfer', 'Transfer', 'transfer_split',
                                   'scinvoke', 'SC_Invoke', 'Login'];
            
            const walletMethodsLower = walletMethods.map(m => m.toLowerCase());

            // Check authorization for wallet methods
            // Accept both 'accepted' and 'ok' for backward compatibility
            if (walletMethodsLower.includes(methodLower) && authState !== 'accepted' && authState !== 'ok') {
              throw new Error('Wallet not authorized');
            }
            
            // Handle special methods
            if (methodLower === 'ping') {
              result = 'Pong';
            } else if (methodLower === 'echo') {
              result = params;
            } else if (methodLower === 'login') {
              result = 'Logged in';
            } else if (methodLower === 'hasmethod') {
              const knownMethods = [...walletMethods, 'Ping', 'Echo', 'GetDaemon', 'Subscribe', 'Unsubscribe', 'HasMethod',
                                    'AttemptEPOCH', 'AttemptEPOCHWithAddr', 'GetMaxHashesEPOCH', 'GetSessionEPOCH', 'GetAddressEPOCH'];
              result = knownMethods.map(m => m.toLowerCase()).includes((params?.name || '').toLowerCase());
            } else if (methodLower === 'getdaemon') {
              // GetDaemon - returns daemon endpoint for direct node communication
              // Always route through CallXSWD since it's handled specially in app.go
              addConsoleLog(`[Browser] GetDaemon requested - routing to backend`);
              const xswdResult = await CallXSWD(JSON.stringify({ method: 'GetDaemon', params: params || {} }));
              addConsoleLog(`[Browser] GetDaemon result: ${JSON.stringify(xswdResult)}`);
              if (xswdResult && xswdResult.success) {
                result = xswdResult.result;
                addConsoleLog(`[OK] GetDaemon succeeded: endpoint=${result?.endpoint}`);
              } else {
                const errorMsg = xswdResult?.error || 'GetDaemon call failed';
                addConsoleLog(`[Error] GetDaemon failed: ${errorMsg}`);
                throw new Error(errorMsg);
              }
            } else {
              // Route through XSWD/wallet
              const signingMethods = ['transfer', 'scinvoke', 'sign', 'Transfer', 'SC_Invoke', 'transfer_split', 'SignData'];
              const readMethods = ['GetAddress', 'GetBalance', 'GetHeight', 'GetTransferbyTXID', 
                                   'GetTransfers', 'GetTrackedAssets', 'MakeIntegratedAddress',
                                   'SplitIntegratedAddress', 'QueryKey', 'CheckSignature'];
              
              const isWalletMethod = walletMethodsLower.includes(methodLower);
              const isSigningMethod = signingMethods.map(m => m.toLowerCase()).includes(methodLower);
              
              if (callSettings.integratedWallet && isWalletMethod) {
                // Use internal wallet for all wallet methods when integrated wallet is enabled
                addConsoleLog(`[Browser] Using integrated wallet for: ${method}`);
                
                if (isSigningMethod) {
                  // Signing methods need user approval each time
                  // Parse SC payload for proper display in wallet modal
                  const parsedPayload = parseScPayload(params);
                  const approval = await requestWalletApproval({
                    type: 'sign',
                    appName: currentMeta.name || 'App',
                    origin: addressInput,
                    payload: parsedPayload
                  });
                  
                  if (approval.approved) {
                    const walletResult = await InternalWalletCall(method, params, approval.password);
                    if (walletResult && walletResult.success) {
                      result = walletResult.result;
                      addConsoleLog(`[OK] ${method} succeeded`);
                    } else {
                      throw new Error(walletResult?.error || 'Internal wallet call failed');
                    }
                  } else {
                    throw new Error('User denied transaction');
                  }
                } else {
                  // Read methods (GetAddress, GetBalance, etc.) don't need password
                  // They just read from the already-open wallet
                  const walletResult = await InternalWalletCall(method, params || {}, '');
                  addConsoleLog(`[Browser] InternalWalletCall result: success=${walletResult?.success}`);
                  if (walletResult && walletResult.success) {
                    result = walletResult.result;
                    addConsoleLog(`[OK] ${method} succeeded: ${JSON.stringify(result).substring(0, 100)}`);
                  } else {
                    const errorMsg = walletResult?.error || 'Internal wallet call failed';
                    addConsoleLog(`[Error] ${method} failed: ${errorMsg}`);
                    throw new Error(errorMsg);
                  }
                }
              } else {
                // Use external XSWD for non-wallet methods or when integrated wallet is disabled
                addConsoleLog(`[Browser] Calling external XSWD: ${method}`);
                const xswdResult = await CallXSWD(JSON.stringify({ method, params }));
                addConsoleLog(`[Browser] XSWD result: success=${xswdResult?.success}, error=${xswdResult?.error || 'none'}`);
                if (xswdResult && xswdResult.success) {
                  result = xswdResult.result;
                  addConsoleLog(`[OK] ${method} succeeded`);
                } else {
                  const errorMsg = xswdResult?.error || xswdResult?.technicalError || 'XSWD call failed';
                  addConsoleLog(`[Error] ${method} failed: ${errorMsg}`);
                  throw new Error(errorMsg);
                }
              }
            }
            break;
            
          case 'selectFile': {
            // File picker request from bridge script (allows dApps to select files)
            const { title, accept } = payload || {};
            addConsoleLog(`[Browser] Opening file picker: title="${title || 'Select File'}", accept="${accept || '*'}"`);
            result = await SelectFileWithContent(title || '', accept || '');
            if (result && result.success) {
              addConsoleLog(`[OK] File selected: ${result.filename} (${result.size} bytes)`);
            } else if (result && result.cancelled) {
              addConsoleLog(`[Browser] File picker cancelled by user`);
            } else {
              addConsoleLog(`[ERR] File picker failed: ${result?.error || 'unknown error'}`);
            }
            break;
          }

          case 'saveFile': {
            // Download request from bridge script (works for cross-origin HTTP-served apps)
            const { filename, base64, mimeType } = payload;
            const ext = (filename || '').split('.').pop().toLowerCase();
            const filterMap = {
              png: ['PNG Image', '*.png'],
              jpg: ['JPEG Image', '*.jpg'],
              jpeg: ['JPEG Image', '*.jpeg'],
              gif: ['GIF Image', '*.gif'],
              svg: ['SVG Image', '*.svg'],
              json: ['JSON File', '*.json'],
              txt: ['Text File', '*.txt'],
            };
            const [filterName, filterPattern] = filterMap[ext] || ['All Files', '*.*'];
            result = await SaveBinaryFileWithDialog(filename || 'download', base64, filterName, filterPattern);
            break;
          }

          default:
            throw new Error('Unknown action: ' + action);
        }
        
        // Send response back to iframe
        addConsoleLog(`[OK] Sending response for ${action}: ${typeof result === 'object' ? JSON.stringify(result).substring(0, 100) : result}`);
        event.source.postMessage({
          type: 'xswd-response',
          id: id,
          result: result
        }, '*');
        
      } catch (error) {
        // Send error response back to iframe
        addConsoleLog(`[Error] Error in ${action}: ${error.message || String(error)}`);
        event.source.postMessage({
          type: 'xswd-response',
          id: id,
          error: error.message || String(error)
        }, '*');
      }
    };
    window.addEventListener('message', handleXSWDMessage);
    
    // Hot reload listener for local dev mode
    EventsOn('localdev:reload', handleLocalDevReload);

    // Try to restore last loaded TELA session for fast back-navigation
    await restoreTelaSession();

    if ($appState.gnomonRunning && !appsLoaded && !appsLoading && !waitingForInitialApps) {
      loadApps();
    }
    
    // Keyboard shortcut: Cmd/Ctrl+Shift+J to toggle JS Console
    const handleKeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleConsole();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('search-result', handleSearchResult);
      window.removeEventListener('browser-navigate', handleBrowserNavigate);
      window.removeEventListener('message', handleXSWDMessage);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
  
  onDestroy(async () => {
    if (unsubscribePending) unsubscribePending();
    if (unsubscribeConsole) unsubscribeConsole();
    if (unsubscribeWalletRequests) unsubscribeWalletRequests();
    clearAppDiscoveryRetryTimer();
    EventsOff('localdev:reload');
    stopXSWDSubscriptionPolling();
    saveBrowserSession();
  });
  
  // ========== LOCAL DEV MODE HELPERS ==========
  
  // Inline CSS files to avoid cross-origin issues with doc.write()
  async function inlineLocalDevCSS(html, baseUrl) {
    const base = baseUrl.replace(/\/$/, '');
    const matches = [];
    
    // Find all <link> tags with stylesheet
    const linkTagRegex = /<link\s+[^>]*>/gi;
    let linkMatch;
    
    while ((linkMatch = linkTagRegex.exec(html)) !== null) {
      const linkTag = linkMatch[0];
      
      // Check if it's a stylesheet
      if (!/rel\s*=\s*["']stylesheet["']/i.test(linkTag)) continue;
      
      // Extract href value
      const hrefMatch = linkTag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      
      const href = hrefMatch[1];
      addConsoleLog(`[CSS] Found CSS link: href="${href}"`);
      
      // Skip if already absolute
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
        addConsoleLog(`⏭️ Skipping absolute URL: ${href}`);
        continue;
      }
      
      matches.push({ full: linkTag, href });
    }
    
    addConsoleLog(`[CSS] Found ${matches.length} CSS file(s) to inline`);
    
    // Fetch and inline each CSS file
    for (const { full, href } of matches) {
      try {
        // Build absolute URL - handle leading slash
        const cleanHref = href.replace(/^\//, '');
        const cssUrl = `${base}/${cleanHref}`;
        
        // Add cache-busting for CSS too
        const cssFetchUrl = cssUrl + (cssUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
        addConsoleLog(`[CSS] Fetching: ${cssFetchUrl}`);
        const cssResponse = await fetch(cssFetchUrl);
        
        if (cssResponse.ok) {
          let fetchedCSS = await cssResponse.text();
          addConsoleLog(`[CSS] Fetched: ${fetchedCSS.length} bytes`);
          
          // Rewrite url() references in CSS to be absolute
          fetchedCSS = fetchedCSS.replace(/url\(['"]?(?!http|https|data:|\/\/)([^'")]+)['"]?\)/gi, 
            `url('${base}/$1')`);
          
          // Replace the <link> with inline style (use array join to avoid confusing PostCSS)
          const styleOpen = ['<', 'style data-inlined-from="', href, '">'].join('');
          const styleClose = ['</', 'style>'].join('');
          const styleTag = styleOpen + '\n' + fetchedCSS + '\n' + styleClose;
          html = html.replace(full, styleTag);
          addConsoleLog(`[OK] Inlined CSS: ${href} (${fetchedCSS.length} bytes)`);
        } else {
          addConsoleLog(`[Warn] Failed to fetch CSS: ${cssUrl} (${cssResponse.status})`, 'warn');
        }
      } catch (cssError) {
        addConsoleLog(`[Error] Error inlining CSS ${href}: ${cssError}`, 'error');
      }
    }
    
    return html;
  }
  
  // Rewrite relative URLs in HTML to point to local dev server
  function rewriteLocalDevUrls(html, baseUrl) {
    // Ensure baseUrl ends with trailing slash for base tag
    const baseWithSlash = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const base = baseUrl.replace(/\/$/, '');
    
    // Inject <base> tag right after <head> to handle any URLs we might miss
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n<base href="${baseWithSlash}">`);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>\n<base href="${baseWithSlash}">`);
    }
    
    // Rewrite href="..." for CSS and links (not starting with http/https/data/mailto/#)
    html = html.replace(/href="(?!http|https|data:|mailto:|#|\/\/)([^"]*)"/gi, `href="${base}/$1"`);
    
    // Rewrite src="..." for scripts and images (not starting with http/https/data)
    html = html.replace(/src="(?!http|https|data:|\/\/)([^"]*)"/gi, `src="${base}/$1"`);
    
    // Rewrite url() in inline styles (for background images, etc.)
    html = html.replace(/url\(['"]?(?!http|https|data:|\/\/)([^'")]+)['"]?\)/gi, `url('${base}/$1')`);
    
    // Handle single-quoted attributes too
    html = html.replace(/href='(?!http|https|data:|mailto:|#|\/\/)([^']*)'/gi, `href='${base}/$1'`);
    html = html.replace(/src='(?!http|https|data:|\/\/)([^']*)'/gi, `src='${base}/$1'`);
    
    return html;
  }
  
  // Handle hot reload events from local dev server
  async function handleLocalDevReload(data) {
    if (isLocalDevMode && localDevUrl) {
      addConsoleLog(`[Reload] Hot reload: ${data.file || 'file changed'}`);
      
      try {
        // Set flag to auto-approve XSWD reconnection during hot reload
        hotReloadInProgress = true;
        
        // Refetch the HTML from local server with cache-busting (same as initial load)
        const cacheBuster = `?_t=${Date.now()}`;
        const fetchUrl = localDevUrl + cacheBuster;
        addConsoleLog(`[Reload] Fetching: ${fetchUrl}`);
        
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        let html = await response.text();
        
        // Inline CSS and rewrite URLs (same as initial load)
        html = await inlineLocalDevCSS(html, localDevUrl);
        html = rewriteLocalDevUrls(html, localDevUrl);
        
        // Re-render with XSWD bridge injection
        renderContent(html);
        addConsoleLog('[OK] Hot reload complete');
        
        // Clear flag after a delay to allow XSWD to reconnect
        setTimeout(() => {
          hotReloadInProgress = false;
        }, 3000);
      } catch (err) {
        addConsoleLog(`[Error] Hot reload failed: ${err}`, 'error');
        hotReloadInProgress = false;
      }
    }
  }
  
  function toggleConsole() {
    showConsole = !showConsole;
  }
  
  // Clear console logs (both frontend and backend)
  async function clearConsoleLogs() {
    try {
      await ClearBackendLogs();
      clearConsoleLogsStore(); // Clear the store (which updates local consoleLogs via subscription)
      previousLogCount = 0;
      consoleUserScrolled = false;
      expandedLogIndices = new Set(); // Clear expanded state
    } catch (e) {
      console.error('Failed to clear logs:', e);
    }
  }
  
  // Copy recent console logs to clipboard
  async function copyRecentLogs(lineCount) {
    const logs = consoleLogs.slice(-lineCount);
    const text = logs.map(log => `[${log.timestamp || new Date().toLocaleTimeString()}] ${log.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${logs.length} log lines`);
    } catch (e) {
      console.error('Failed to copy logs:', e);
    }
  }
  
  // Copy all console logs to clipboard
  async function copyAllLogs() {
    const text = consoleLogs.map(log => `[${log.timestamp || new Date().toLocaleTimeString()}] ${log.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${consoleLogs.length} log lines`);
    } catch (e) {
      console.error('Failed to copy logs:', e);
    }
  }
  
  // Copy diagnostics bundle to clipboard (for bug reports)
  async function copyDiagnostics() {
    const now = new Date();
    const network = $appState.network || $settingsState.network || 'unknown';
    const os = navigator.platform || 'unknown';
    
    // Build filter description
    const filters = [];
    if (consoleFilterSource !== 'all') filters.push(`source=${consoleFilterSource}`);
    if (consoleFilterErrorsOnly) filters.push('level=errors');
    const filterDesc = filters.length > 0 ? filters.join(', ') : 'none';
    
    // Format logs with more detail
    const logsText = filteredConsoleLogs.map(log => {
      let line = `[${log.timestamp}] ${log.level?.toUpperCase() || 'INFO'}`;
      if (log.source) line += ` [${log.source}]`;
      line += ` ${log.message}`;
      if (log.location) {
        line += `\n  at ${log.location.file || log.location.href}:${log.location.line || '?'}:${log.location.column || '?'}`;
      }
      if (log.stack) {
        line += `\n${log.stack.split('\n').map(l => '  ' + l).join('\n')}`;
      }
      return line;
    }).join('\n');
    
    const bundle = `=== HOLOGRAM Diagnostics ===
Version: 1.0.1
OS: ${os}
Network: ${network}
Generated: ${now.toISOString()}

App:
  dURL: ${currentMeta?.durl || addressInput || 'none'}
  SCID: ${currentMeta?.scid || 'none'}
  Name: ${currentMeta?.name || 'none'}

Filters applied: ${filterDesc}
Log lines: ${filteredConsoleLogs.length} (of ${consoleLogs.length} total)

--- LOGS ---
${logsText || '(no logs)'}
`;
    
    try {
      await navigator.clipboard.writeText(bundle);
      toast.success('Diagnostics copied to clipboard');
    } catch (e) {
      console.error('Failed to copy diagnostics:', e);
    }
  }
  
  // Check if user is at bottom of console
  function handleConsoleScroll() {
    if (!consoleViewport) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleViewport;
    // Consider "at bottom" if within 100px of the bottom
    consoleUserScrolled = scrollHeight - scrollTop - clientHeight > 100;
  }

  // Auto-scroll console to bottom ONLY when new logs arrive AND user is at bottom
  $: if (consoleLogs && consoleViewport) {
    const currentLogCount = consoleLogs.length;
    if (currentLogCount > previousLogCount && !consoleUserScrolled) {
      requestAnimationFrame(() => {
        if (consoleViewport && !consoleUserScrolled) {
          consoleViewport.scrollTop = consoleViewport.scrollHeight;
        }
      });
    }
    previousLogCount = currentLogCount;
  }
  
  async function navigate(fromHistory = false) {
    if (!addressInput.trim()) return;
    
    loading = true;
    showWelcome = false;
    hasNavigated = false;
    resetXSWDSubscriptions();
    // Reset session approval so new app navigations always show the approval modal
    sessionApprovedScid = null;
    sessionApprovedAppName = null;
    sessionApprovalTime = 0;
    
    // Strip any existing dero:// prefix from input (badge provides it visually)
    let cleanInput = addressInput.trim();
    if (cleanInput.toLowerCase().startsWith('dero://')) {
      cleanInput = cleanInput.slice(7);
      addressInput = cleanInput; // Update display to not show redundant prefix
    }
    
    addConsoleLog(`Navigating to: ${cleanInput}`);
    
    // Handle local:// URLs for local dev mode
    if (cleanInput.toLowerCase().startsWith('local://')) {
      await navigateToLocalDev(cleanInput);
      return;
    }
    
    // Handle local file paths (auto-start dev server for telaHost support)
    // Detect: /path/to/dir, /path/to/file.html, ~/path, C:\path (Windows)
    const isLocalFilePath = cleanInput.startsWith('/') || 
                            cleanInput.startsWith('~') ||
                            cleanInput.startsWith('file://') ||
                            /^[A-Za-z]:[\\\/]/.test(cleanInput);  // Windows paths
    
    if (isLocalFilePath) {
      await navigateToLocalFile(cleanInput, fromHistory);
      return;
    }
    
    // Reset local dev mode for non-local URLs
    isLocalDevMode = false;
    localDevUrl = '';
    
    // Determine if input is a dURL (name) or SCID (64-char hex)
    const isHexSCID = /^[a-fA-F0-9]{64}$/.test(cleanInput);
    const isDURL = !isHexSCID && cleanInput.length > 0;
    
    // For backend: prepend dero:// for dURL resolution
    const backendInput = isDURL ? `dero://${cleanInput}` : cleanInput;
    
    // Update active tab with display name
    const displayName = isDURL ? cleanInput : cleanInput.substring(0, 16) + '...';
    updateActiveTab(displayName, cleanInput, 'box');
    scheduleBrowserSessionSave();
    
    try {
      const navResult = await Navigate(backendInput);
      
      if (navResult.success) {
        const scid = navResult.scid || cleanInput;
        addToHistory(scid);
        addConsoleLog(`Resolved SCID: ${scid}`);
        
        // Add to per-tab history (not global)
        if (!fromHistory) {
          pushToTabHistory(cleanInput);
        }
        
        let result;
        if (isDURL) {
          result = await FetchByDURL(cleanInput);
        } else {
          result = await FetchSCID(scid);
        }
        
        handleFetchResult(result, scid);
      } else {
        addConsoleLog(`Navigation failed: ${navResult.error}`, 'error');
        showWelcome = true;
      }
    } catch (error) {
      addConsoleLog(`Navigation error: ${error}`, 'error');
      showWelcome = true;
    } finally {
      loading = false;
    }
  }
  
  // Navigate to a local file path (auto-starts Local Dev Server for telaHost support)
  // This enables developers to test dApps locally with full telaHost API access
  async function navigateToLocalFile(filePath, fromHistory = false) {
    resetXSWDSubscriptions();
    sessionApprovedScid = null;
    sessionApprovedAppName = null;
    sessionApprovalTime = 0;
    
    // Clean up the file path
    let cleanPath = filePath.trim();
    
    // Remove file:// prefix if present
    if (cleanPath.startsWith('file://')) {
      cleanPath = cleanPath.slice(7);
    }
    
    // Expand ~ to home directory (frontend can't do this, backend handles it)
    // For now, just pass it through - the backend will handle validation
    
    // Extract directory from file path
    // If it ends with .html or another file extension, get the parent directory
    let directory = cleanPath;
    const lastSlash = cleanPath.lastIndexOf('/');
    const lastBackslash = cleanPath.lastIndexOf('\\');
    const lastSep = Math.max(lastSlash, lastBackslash);
    
    if (lastSep > 0) {
      const afterSep = cleanPath.substring(lastSep + 1);
      // Check if this looks like a file (has extension)
      if (afterSep.includes('.')) {
        directory = cleanPath.substring(0, lastSep);
      }
    }
    
    addConsoleLog(`[Local File] Detected local path: ${cleanPath}`);
    addConsoleLog(`[Local File] Directory: ${directory}`);
    
    try {
      // Check if Local Dev Server is already running for this directory
      const status = await GetLocalDevServerStatus();
      
      if (status.running && status.directory === directory) {
        // Server already running for this directory, just load it
        addConsoleLog(`[Local File] Dev server already running for this directory`);
        await loadFromLocalDevServer(status, directory, filePath, fromHistory);
        return;
      }
      
      // Start Local Dev Server for this directory
      addConsoleLog(`[Local File] Starting dev server for: ${directory}`);
      const serverResult = await StartLocalDevServer(directory);
      
      if (serverResult.success) {
        addConsoleLog(`[OK] Local dev server started at ${serverResult.url}`);
        toast.success(`Dev server started for local testing`);
        await loadFromLocalDevServer(serverResult, directory, filePath, fromHistory);
      } else {
        addConsoleLog(`[Error] Failed to start dev server: ${serverResult.error}`, 'error');
        toast.error(serverResult.error || 'Failed to start local dev server');
        showWelcome = true;
        loading = false;
      }
    } catch (error) {
      addConsoleLog(`[Error] Local file navigation error: ${error}`, 'error');
      toast.error(`Could not load local file: ${error.message || error}`);
      showWelcome = true;
      loading = false;
    }
  }
  
  // Helper function to load content from Local Dev Server
  async function loadFromLocalDevServer(serverInfo, directory, originalPath, fromHistory) {
    isLocalDevMode = true;
    localDevUrl = serverInfo.url;
    
    // Update tab with directory name
    const dirName = directory.split('/').pop() || directory.split('\\').pop() || 'Local Dev';
    updateActiveTab(`${dirName}`, originalPath, 'server');
    scheduleBrowserSessionSave();
    
    // Add to per-tab history
    if (!fromHistory) {
      pushToTabHistory(originalPath);
    }
    
    addConsoleLog(`[Server] Loading from local dev server: ${serverInfo.url}`);
    addConsoleLog(`[Dir] Directory: ${directory}`);
    
    try {
      // Add cache-busting to ensure fresh content
      const cacheBuster = `?_t=${Date.now()}`;
      const fetchUrl = serverInfo.url + cacheBuster;
      
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      let html = await response.text();
      addConsoleLog(`[HTML] Fetched HTML (${html.length} bytes)`);
      
      // Inline CSS to avoid cross-origin issues
      html = await inlineLocalDevCSS(html, serverInfo.url);
      
      // CRITICAL: Inject telaHost placeholder script FIRST, before any other modifications
      // This ensures telaHost exists (even if null) when scripts check for it
      // The actual API will be injected by parent window immediately after iframe loads
      // Note: We split the closing script tag to avoid Svelte parser confusion
      const telaHostPlaceholder = 
        '<scr' + 'ipt>' +
        '(function(){' +
        'if(typeof window.telaHost==="undefined"){' +
        'window.telaHost=null;' +
        'window.__waitingForTelaHost=true;' +
        '}' +
        '})();' +
        '</scr' + 'ipt>';
      
      // Inject into the document without moving <!DOCTYPE html> from byte 0.
      html = injectIntoHtmlDocument(html, telaHostPlaceholder);
      
      // Rewrite remaining URLs (scripts, images, etc.) to absolute URLs
      // This allows us to use srcdoc while maintaining asset loading
      // Note: base tag will be added AFTER telaHost placeholder
      html = rewriteLocalDevUrls(html, serverInfo.url);
      
      // CRITICAL: Inject the XSWD bridge script for WebSocket interception
      // This enables dApps to connect via XSWD (ws://localhost:44326/xswd)
      // The bridge proxies WebSocket calls through postMessage to the parent Browser.svelte
      const bridgeScript = getXSWDBridgeScript();
      html = injectIntoHtmlDocument(html, bridgeScript);
      html = injectIntoHtmlDocument(html, getExternalLinkGuardScript());
      
      addConsoleLog('[OK] Injected XSWD bridge, external-link guard, and telaHost placeholder into HTML');
      
      currentMeta = {
        name: dirName,
        isLocal: true,
        directory: directory
      };
      
      // Use srcdoc with modified HTML (includes XSWD bridge + telaHost placeholder)
      // Assets use absolute URLs so they still load from server
      if (contentFrame) {
        contentFrame.removeAttribute('src');
        contentFrame.srcdoc = html;
        showWelcome = false;
        
        // Inject actual telaHost API immediately after iframe loads
        // The placeholder prevents errors, but we need the real API
        contentFrame.onload = () => {
          setTimeout(() => {
            try {
              injectTelaHostAPI();
              // Verify injection worked - but don't error if cross-origin prevents access
              try {
                const iframeWindow = contentFrame?.contentWindow;
                if (iframeWindow?.telaHost) {
                  addConsoleLog('[OK] telaHost API injected successfully (placeholder was set early)');
                }
                // Don't warn - cross-origin is expected for local dev server
              } catch (e) {
                // Cross-origin access denied - XSWD bridge will handle communication instead
              }
            } catch (e) {
              // Silently ignore cross-origin errors - XSWD bridge handles communication
            }
          }, 10);
        };
      }
      addConsoleLog(`[OK] Local file loaded via HTTP (telaHost available)`);
      
    } catch (fetchError) {
      addConsoleLog(`[Error] Failed to fetch from local server: ${fetchError}`, 'error');
      toast.error(`Failed to load local content: ${fetchError.message}`);
      showWelcome = true;
    } finally {
      loading = false;
    }
  }
  
  // Navigate to local dev server (legacy local:// URL handler)
  async function navigateToLocalDev(url, fromHistory = false) {
    const directory = url.slice(8); // Remove 'local://'
    resetXSWDSubscriptions();
    sessionApprovedScid = null;
    sessionApprovedAppName = null;
    sessionApprovalTime = 0;
    
    try {
      // Check if Local Dev Server is running
      const status = await GetLocalDevServerStatus();
      
      // Auto-start server if not running (NEW: enables seamless local:// navigation)
      if (!status.running) {
        if (directory) {
          addConsoleLog(`[Local] Auto-starting dev server for: ${directory}`);
          const serverResult = await StartLocalDevServer(directory);
          if (!serverResult.success) {
            addConsoleLog(`[Error] Failed to start dev server: ${serverResult.error}`, 'error');
            toast.error(serverResult.error || 'Failed to start local dev server');
            showWelcome = true;
            loading = false;
            return;
          }
          addConsoleLog(`[OK] Local dev server started at ${serverResult.url}`);
          // Use the newly started server
          await loadFromLocalDevServer(serverResult, directory, url, fromHistory);
          return;
        } else {
          addConsoleLog('[Error] Local dev server is not running. Provide a directory path.', 'error');
          toast.error('No directory specified. Use local:///path/to/dir or start server from Studio.');
          showWelcome = true;
          loading = false;
          return;
        }
      }
      
      // Check if the directory matches (only warn if directories differ)
      if (directory && status.directory !== directory) {
        addConsoleLog(`[Warn] Local server serving different directory: ${status.directory}`, 'warn');
      }
      
      isLocalDevMode = true;
      localDevUrl = status.url;
      
      // Update tab
      const dirName = status.directory.split('/').pop() || 'Local Dev';
      updateActiveTab(`${dirName}`, url, 'server');
      
      // Add to per-tab history
      if (!fromHistory) {
        pushToTabHistory(url);
      }
      
      // Fetch HTML from local server and inject XSWD bridge
      addConsoleLog(`[Server] Loading local dev server: ${status.url}`);
      addConsoleLog(`[Dir] Server directory: ${status.directory}`);
      
      try {
        // Add cache-busting to ensure fresh content
        const cacheBuster = `?_t=${Date.now()}`;
        const fetchUrl = status.url + cacheBuster;
        addConsoleLog(`[Fetch] Fetching: ${fetchUrl}`);
        
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        let html = await response.text();
        addConsoleLog(`[HTML] Fetched HTML (${html.length} bytes)`);
        
        // Inline CSS to avoid cross-origin issues with doc.write()
        html = await inlineLocalDevCSS(html, status.url);
        
        // Rewrite remaining URLs (scripts, images, etc.)
        html = rewriteLocalDevUrls(html, status.url);
        
        currentMeta = {
          name: dirName,
          isLocal: true,
          directory: status.directory
        };
        
        // For local dev, use iframe.src directly instead of srcdoc
        // This gives proper HTTP context so external scripts can load
        // (srcdoc uses about: protocol which blocks script loading)
        if (contentFrame) {
          contentFrame.removeAttribute('srcdoc');
          const cacheBustedUrl = `${status.url}?_t=${Date.now()}`;
          contentFrame.src = cacheBustedUrl;
          showWelcome = false;
          
          // Inject telaHost API after iframe loads
          contentFrame.onload = () => {
            setTimeout(() => injectTelaHostAPI(), 50);
          };
        }
        addConsoleLog(`[OK] Local dev loaded via HTTP: ${status.url}`);
        
      } catch (fetchError) {
        addConsoleLog(`[Error] Failed to fetch from local server: ${fetchError}`, 'error');
        toast.error(`Failed to load local content: ${fetchError.message}`);
        showWelcome = true;
      }
      
    } catch (error) {
      addConsoleLog(`Local dev error: ${error}`, 'error');
      showWelcome = true;
    } finally {
      loading = false;
    }
  }
  
  // Track active TELA server for reuse between route switches
  let activeTelaServer = null;
  let activeTelaScid = null;
  let activeTelaUrl = null;

  async function restoreTelaSession() {
    const session = get(appState).telaSession;
    if (!session || !session.serverName || !session.serverUrl || !session.scid) {
      return false;
    }

    try {
      const servers = await ListActiveServers();
      const active = servers?.servers?.find((s) => s.name === session.serverName);
      if (!active) {
        return false;
      }

      activeTelaServer = session.serverName;
      activeTelaScid = session.scid;
      activeTelaUrl = session.serverUrl;
      addressInput = session.durl || session.scid;

      updateActiveTab(session.title || 'App', addressInput, 'box');
      addConsoleLog(`[Server] Reusing active TELA server: ${session.serverUrl}`);

      if (contentFrame) {
        contentFrame.removeAttribute('srcdoc');
        contentFrame.src = `${session.serverUrl}?_t=${Date.now()}`;
        showWelcome = false;
        loading = false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }
  
  async function startTelaServer(scid, background = false) {
    try {
      // Shutdown previous server if any (only if switching to a different SCID)
      if (activeTelaServer && activeTelaScid && activeTelaScid !== scid) {
        await ShutdownServer(activeTelaServer);
        activeTelaServer = null;
        activeTelaScid = null;
        activeTelaUrl = null;
      }
      
      // Ensure XSWD server is running for wallet connections
      try {
        const xswdResult = await ConnectXSWD();
        if (xswdResult.success) {
          addConsoleLog('[XSWD] Server ready');
        }
      } catch (e) {
        addConsoleLog(`[Warn] XSWD: ${e.message}`);
      }
      
      // Start real HTTP server for this TELA content
      const serverResult = await ServeTELAContent(scid);
      
      if (serverResult.success && serverResult.srcdocOnly) {
        addConsoleLog('[OK] DocShards content — srcdoc mode (no HTTP server needed)');
        telaServerFallback = null;
        return false;
      }

      if (serverResult.success && serverResult.url) {
        addConsoleLog(`[Server] TELA server started: ${serverResult.url}`);
        activeTelaServer = serverResult.name;
        activeTelaScid = scid;
        activeTelaUrl = serverResult.url;
        telaServerFallback = null;

        appState.update(state => ({
          ...state,
          telaSession: {
            scid,
            serverName: serverResult.name,
            serverUrl: serverResult.url,
            durl: currentMeta?.durl || '',
            title: currentMeta?.name || currentMeta?.title || scid.slice(0, 12),
            updatedAt: Date.now()
          }
        }));
        
        // Load iframe from real HTTP URL
        if (contentFrame) {
          // Remove srcdoc attribute entirely (it takes precedence over src when present)
          // Setting srcdoc='' still keeps the attribute and shows blank page
          contentFrame.removeAttribute('srcdoc');
          // Add cache-busting to force reload even if URL is the same port
          // This is needed because proxy servers reuse ports (50000+) and
          // the browser won't reload if src URL appears unchanged
          const cacheBustedUrl = `${serverResult.url}?_t=${Date.now()}`;
          contentFrame.src = cacheBustedUrl;
          showWelcome = false;
        }
        return true;
      }

      if (!background) {
        const errorMsg = serverResult.error || 'Unknown';
        telaServerFallback = { scid, error: errorMsg };
        addConsoleLog(`[Warn] HTTP server failed, falling back to srcdoc: ${errorMsg}`);
        appState.update(state => ({ ...state, telaSession: null }));
      }
      return false;
    } catch (e) {
      if (!background) {
        telaServerFallback = { scid, error: e.message };
        addConsoleLog(`[Warn] HTTP server error, falling back to srcdoc: ${e.message}`);
        appState.update(state => ({ ...state, telaSession: null }));
      }
      return false;
    }
  }

  async function handleFetchResult(result, scid) {
    if (result.success && result.content) {
      telaServerFallback = null;
      currentMeta = result.meta || {};
      currentMeta.scid = scid;
      addConsoleLog(`Content loaded (${result.content.length} bytes)`);

      if (currentMeta?.stale) {
        addConsoleLog('[FAST] Rendering cached content while refreshing...');
        renderContent(result.content);
        showWelcome = false;
        startTelaServer(scid, true);
        return;
      }
      
      const started = await startTelaServer(scid, false);
      if (started) {
        return;
      }
      
      // Fallback to srcdoc (with bridge injection)
      renderContent(result.content);
    } else {
      addConsoleLog(`Fetch failed: ${result.error || 'Unknown error'}`, 'error');
      showWelcome = true;
    }
  }
  
  // Minimal XSWD bridge script - intercepts WebSocket connections to localhost:44326
  function getXSWDBridgeScript() {
    return `<script>
(function() {
  'use strict';
  
  // Safe stringify helper - handles circular refs and caps size
  function safeStringify(obj, maxLen) {
    maxLen = maxLen || 4096;
    var seen = [];
    try {
      var str = JSON.stringify(obj, function(key, val) {
        if (val && typeof val === 'object') {
          if (seen.indexOf(val) !== -1) return '[Circular]';
          seen.push(val);
        }
        return val;
      });
      return str.length > maxLen ? str.substring(0, maxLen) + '...[truncated]' : str;
    } catch(e) {
      return String(obj);
    }
  }
  
  // Send structured log to parent
  function sendLog(payload) {
    try { window.parent.postMessage({ type: 'xswd-request', id: 0, action: 'log', payload: payload }, '*'); } catch(e) {}
  }
  
  // Intercept console methods to capture dApp logs with structured data
  (function() {
    var methods = ['log', 'warn', 'error', 'info', 'debug'];
    var isForwarding = false;
    methods.forEach(function(method) {
      var original = console[method];
      console[method] = function() {
        if (original) original.apply(console, arguments);
        if (isForwarding) return;
        try {
          var args = Array.prototype.slice.call(arguments);
          var firstArg = args[0];
          if (typeof firstArg === 'string' && firstArg.indexOf('xswd-response') !== -1) return;
          if (typeof firstArg === 'string' && firstArg.indexOf('received message') !== -1) return;
          
          // Build human-readable message
          var msg = args.map(function(a) {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch(e) { return String(a); }
            }
            return String(a);
          }).join(' ');
          
          // Safe-stringify args for structured payload (cap each at 4KB)
          var safeArgs = args.map(function(a) {
            if (a === null || a === undefined) return a;
            if (typeof a === 'object') return safeStringify(a, 4096);
            return String(a).substring(0, 4096);
          });
          
          isForwarding = true;
          sendLog({
            source: 'dapp',
            level: method,
            message: msg,
            args: safeArgs,
            ts: Date.now()
          });
          isForwarding = false;
        } catch(e) { isForwarding = false; }
      };
    });
  })();
  
  // Capture uncaught errors with full context
  window.addEventListener('error', function(e) {
    try {
      var stack = e.error && e.error.stack ? e.error.stack : null;
      var msg = (e.message || 'Unknown error');
      if (e.filename) msg += ' at ' + e.filename + ':' + (e.lineno || '?') + ':' + (e.colno || '?');
      sendLog({
        source: 'dapp-uncaught',
        level: 'error',
        message: msg,
        location: {
          href: location.href,
          file: e.filename || null,
          line: e.lineno || null,
          column: e.colno || null
        },
        stack: stack,
        ts: Date.now()
      });
    } catch(ex) {}
  });
  
  // Capture unhandled promise rejections with stack when available
  window.addEventListener('unhandledrejection', function(e) {
    try {
      var reason = e.reason;
      var msg = reason instanceof Error ? reason.message : String(reason);
      var stack = reason instanceof Error && reason.stack ? reason.stack : null;
      sendLog({
        source: 'dapp-rejection',
        level: 'error',
        message: msg,
        stack: stack,
        ts: Date.now()
      });
    } catch(ex) {}
  });
  
  log('[Bridge] Initializing...');
  
  // Spoof location to look like a normal HTTP page (Engram serves at localhost:8082)
  // Many apps check protocol and refuse to run on about: or blob:
  try {
    var fakeLocation = {
      href: 'http://localhost:8082/',
      protocol: 'http:',
      host: 'localhost:8082',
      hostname: 'localhost',
      port: '8082',
      pathname: '/',
      search: '',
      hash: '',
      origin: 'http://localhost:8082',
      toString: function() { return this.href; }
    };
    
    // Try to override location (may not work in all browsers)
    try {
      Object.defineProperty(window, 'location', { value: fakeLocation, writable: false });
      log('[Env] location spoofed to http://localhost:8082');
    } catch(e) {
      log('[Env] Could not spoof location: ' + e.message);
    }
    
    log('[Env] location.protocol: ' + window.location.protocol);
    log('[Env] in iframe: ' + (window.parent !== window));
  } catch(e) {
    log('[Env] Error: ' + e.message);
  }
  
  // Store original WebSocket
  var OriginalWebSocket = window.WebSocket;
  
  // Request ID for parent communication
  var reqId = 0;
  var pending = {};
  var proxies = [];
  
  // Listen for parent responses
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'xswd-response' && pending[e.data.id]) {
      var p = pending[e.data.id];
      delete pending[e.data.id];
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    }
  });
  
  // Listen for subscription events from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'xswd-event' && proxies.length) {
      proxies.forEach(function(p) {
        if (p && typeof p._notify === 'function') {
          p._notify(e.data.method, e.data.params);
        }
      });
    }
  });
  
  // Send to parent and wait
  function request(action, payload) {
    return new Promise(function(resolve, reject) {
      var id = ++reqId;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ type: 'xswd-request', id: id, action: action, payload: payload }, '*');
      setTimeout(function() { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, 60000);
    });
  }
  
  // XSWD WebSocket Proxy
  function XSWDProxy(url) {
    var self = this;
    self.url = url;
    self.readyState = 0;
    self.onopen = null;
    self.onmessage = null;
    self.onerror = null;
    self.onclose = null;
    self._auth = 'pending';
    self._queue = [];
    proxies.push(self);
    
    log('[XSWD] Connection intercepted: ' + url);
    
    // Simulate connection open (like Engram does)
    setTimeout(function() {
      self.readyState = 1;
      log('[XSWD] WebSocket opened');
      if (self.onopen) self.onopen({ type: 'open', target: self });
      // Process queued
      while (self._queue.length) self._handle(self._queue.shift());
    }, 5);
  }
  
  XSWDProxy.prototype.send = function(data) {
    if (this.readyState === 0) { 
      this._queue.push(data); 
      return; 
    }
    if (this.readyState !== 1) {
      throw new Error('WebSocket closed');
    }
    this._handle(data);
  };
  
  XSWDProxy.prototype._handle = function(data) {
    var self = this;
    try {
      var msg = typeof data === 'string' ? JSON.parse(data) : data;
      log('[XSWD] ' + (msg.method || 'handshake') + ' (id=' + msg.id + ')');
      
      // Handshake (has name/description, no method)
      if (!msg.method && (msg.name || msg.description)) {
        request('connect', { appInfo: msg }).then(function(ok) {
          self._auth = ok ? 'ok' : 'denied';
          log(ok ? '[OK] Connection approved' : '[Denied] Connection denied');
          self._respond({ accepted: !!ok });
        }).catch(function(e) {
          self._auth = 'denied';
          self._respond({ accepted: false, message: e.message });
        });
        return;
      }
      
      // RPC call
      request('call', { method: msg.method, params: msg.params, authState: self._auth }).then(function(r) {
        self._respond({ jsonrpc: '2.0', id: msg.id, result: r });
      }).catch(function(e) {
        self._respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
      });
    } catch(e) {
      log('[Error] XSWD error: ' + e.message);
    }
  };
  
  XSWDProxy.prototype._respond = function(r) {
    var self = this;
    if (self.onmessage) setTimeout(function() { self.onmessage({ type: 'message', data: JSON.stringify(r), target: self }); }, 0);
  };
  
  XSWDProxy.prototype._notify = function(method, params) {
    var self = this;
    if (self.onmessage) {
      var notification = { jsonrpc: '2.0', method: method, params: params };
      setTimeout(function() { self.onmessage({ type: 'message', data: JSON.stringify(notification), target: self }); }, 0);
    }
  };
  
  XSWDProxy.prototype.close = function() {
    this.readyState = 3;
    // Remove from proxies array to prevent memory leaks
    var idx = proxies.indexOf(this);
    if (idx > -1) proxies.splice(idx, 1);
    if (this.onclose) this.onclose({ type: 'close', code: 1000 });
  };
  
  XSWDProxy.CONNECTING = 0;
  XSWDProxy.OPEN = 1;
  XSWDProxy.CLOSING = 2;
  XSWDProxy.CLOSED = 3;
  
  // Override WebSocket
  window.WebSocket = function(url, protocols) {
    // XSWD port: 44326 (mainnet)
    if (url && (url.indexOf('44326') !== -1 || url.indexOf('44325') !== -1 || url.indexOf('xswd') !== -1)) {
      return new XSWDProxy(url);
    }
    return protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
  };
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  
  log('[Bridge] Ready - WebSocket interception active');
  
  // Create telaHost API that works via postMessage (cross-origin safe)
  // This ensures dApps can use telaHost.getDaemon() even in production builds
  // where direct iframe DOM injection may fail due to cross-origin restrictions
  window.telaHost = {
    getDaemon: function() {
      log('[telaHost] getDaemon called');
      return request('call', { method: 'GetDaemon', params: {}, authState: 'ok' }).then(function(r) {
        log('[telaHost] getDaemon result: ' + JSON.stringify(r));
        return r && r.endpoint ? r.endpoint : r;
      });
    },
    call: function(method, params) {
      log('[telaHost] call: ' + method);
      return request('call', { method: method, params: params || {}, authState: 'ok' });
    },
    getAddress: function() {
      return request('call', { method: 'GetAddress', params: {}, authState: 'ok' }).then(function(r) {
        return r && r.address ? r.address : r;
      });
    },
    getBalance: function() {
      return request('call', { method: 'GetBalance', params: {}, authState: 'ok' }).then(function(r) {
        return { balance: r && r.balance || 0, unlocked: r && r.unlocked_balance || 0 };
      });
    },
    connect: function() {
      return request('connect', { name: 'dApp', description: 'dApp via telaHost' });
    },
    isConnected: function() {
      return proxies.length > 0 && proxies[0] && proxies[0]._auth === 'ok';
    }
  };
  log('[telaHost] API ready via postMessage bridge');
  
  // Monitor what happens after page loads
  window.addEventListener('DOMContentLoaded', function() {
    log('[DOM] DOMContentLoaded');
    setTimeout(function() {
      var root = document.getElementById('root');
      log('[DOM] #root innerHTML length: ' + (root ? root.innerHTML.length : 'no root'));
      log('[DOM] #root children: ' + (root ? root.children.length : 0));
    }, 1000);
  });

  // ── Blob download interceptor ─────────────────────────────────────────────
  // Apps (e.g. Villager) call URL.revokeObjectURL() synchronously immediately
  // after a.click(), so we must cache the Blob at createObjectURL() time rather
  // than fetching it asynchronously later.
  (function() {
    var _blobCache = {};

    var _origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
      var url = _origCreate(obj);
      if (obj && typeof obj === 'object') _blobCache[url] = obj;
      return url;
    };

    var _origRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function(url) {
      delete _blobCache[url];
      return _origRevoke(url);
    };

    function _saveBlobDownload(href, filename, cachedBlob) {
      var blob = cachedBlob || _blobCache[href];
      if (!blob) {
        fetch(href).then(function(r) { return r.blob(); }).then(function(b) {
          _saveBlobDownload(href, filename, b);
        }).catch(function(e) {
          log('[Download] Blob unavailable: ' + e.message);
        });
        return;
      }
      var reader = new FileReader();
      reader.onloadend = function() {
        request('saveFile', {
          filename: filename,
          base64: reader.result,
          mimeType: blob.type || 'application/octet-stream'
        }).then(function(result) {
          if (result && result.success) {
            log('[OK] File saved: ' + (result.path || filename));
          } else if (result && result.cancelled) {
            log('[Info] Download cancelled');
          } else {
            log('[Download] Save failed: ' + (result && result.error));
          }
        }).catch(function(e) {
          log('[Download] Save request error: ' + e.message);
        });
      };
      reader.readAsDataURL(blob);
    }

    var _origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.hasAttribute('download') && this.href && this.href.indexOf('blob:') === 0) {
        var href = this.href;
        var filename = this.download || 'download';
        var cached = _blobCache[href];
        log('[Download] Intercepting: ' + filename);
        _saveBlobDownload(href, filename, cached);
        return;
      }
      return _origAnchorClick.call(this);
    };

    document.addEventListener('click', function(e) {
      var el = e.target;
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (!el || !el.hasAttribute('download')) return;
      var href = el.href;
      if (!href || href.indexOf('blob:') !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var filename = el.download || 'download';
      var cached = _blobCache[href];
      log('[Download] Intercepting click: ' + filename);
      _saveBlobDownload(href, filename, cached);
    }, true);

    log('[Bridge] Download interceptor installed');
  })();
})();
<\/script>`;
  }

  /** Intercepts http(s) anchor navigation inside srcdoc/injected HTML and defers to the host modal. */
  function getExternalLinkGuardScript() {
    return `<script>
(function() {
  'use strict';
  document.addEventListener('click', function(e) {
    if (e.defaultPrevented) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var a = t.closest('a[href]');
    if (!a || a.hasAttribute('download')) return;
    var raw = a.getAttribute('href');
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) return;
    if (/^(mailto:|tel:|sms:|data:)/i.test(trimmed)) return;
    try {
      var u = new URL(trimmed, document.baseURI);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      window.parent.postMessage({ type: 'hologram-external-link', url: u.href }, '*');
    } catch (err) {}
  }, true);
})();
<\/script>`;
  }

  function injectIntoHtmlDocument(html, snippet) {
    if (!snippet) return html;

    const injectIntoDocument = (doc) => {
      if (/<head[\s>]/i.test(doc)) {
        return doc.replace(/<head([^>]*)>/i, `<head$1>${snippet}`);
      }
      if (/<body[\s>]/i.test(doc)) {
        return doc.replace(/<body([^>]*)>/i, `<head>${snippet}</head><body$1>`);
      }
      return snippet + doc;
    };

    const doctypeMatch = html.match(/^\s*<!doctype[^>]*>/i);
    if (!doctypeMatch) {
      return injectIntoDocument(html);
    }

    const doctype = doctypeMatch[0];
    const rest = html.slice(doctype.length);
    return doctype + injectIntoDocument(rest);
  }
  
  function renderContent(html) {
    if (!contentFrame) return;
    
    try {
      // Bridge is required for XSWD-dependent apps like Ghost Trading
      const ENABLE_BRIDGE = true;
      
      let injectedHtml = html;
      if (ENABLE_BRIDGE) {
        // Preserve <!DOCTYPE html> so srcdoc stays in standards mode.
        const bridgeScript = getXSWDBridgeScript();
        injectedHtml = injectIntoHtmlDocument(html, bridgeScript);
        injectedHtml = injectIntoHtmlDocument(injectedHtml, getExternalLinkGuardScript());
      }
      
      // Remove src attribute - we're using srcdoc for inline content
      // This ensures clean state when switching between HTTP and inline modes
      contentFrame.removeAttribute('src');
      
      // Use srcdoc for inline content (fallback when HTTP server fails)
      // blob: URLs cause protocol issues (location.protocol = 'blob:')
      contentFrame.srcdoc = injectedHtml;
      showWelcome = false;
      
      // Wait for iframe to load, then inject telaHost API
      contentFrame.onload = () => {
        setTimeout(() => injectTelaHostAPI(), 50);
      };
    } catch (e) {
      console.error('Error rendering content:', e);
    }
  }
  
  // Inject telaHost API for direct access (apps can use this instead of XSWD WebSocket)
  // WebSocket interception is now handled by the script injected into the HTML
  function injectTelaHostAPI(retryCount = 0) {
    if (!contentFrame) {
      if (retryCount < 10) {
        setTimeout(() => injectTelaHostAPI(retryCount + 1), 100);
      }
      return;
    }
    
    try {
      const iframeWindow = contentFrame.contentWindow;
      if (!iframeWindow) {
        if (retryCount < 10) {
          setTimeout(() => injectTelaHostAPI(retryCount + 1), 100);
        }
        return;
      }
      
      // Only inject if not already present
      if (iframeWindow.telaHost) return;
      
      // Create telaHost API
      iframeWindow.telaHost = {
        call: async (method, params = {}) => {
          try {
            const settings = get(settingsState);
            const signingMethods = ['transfer', 'scinvoke', 'sign', 'transfer_split', 'signdata'];
            const methodLower = method.toLowerCase().replace('dero.', '');
            
            if (settings.integratedWallet && signingMethods.includes(methodLower)) {
              // Parse SC payload for proper display in wallet modal
              const parsedPayload = parseScPayload(params);
              const approval = await requestWalletApproval({
                type: 'sign',
                appName: currentMeta.name || 'App',
                origin: addressInput,
                payload: parsedPayload
              });
              
              if (approval.approved) {
                const result = await InternalWalletCall(method, params, approval.password);
                if (result && result.success) return result.result;
                throw new Error(result?.error || 'Internal wallet call failed');
              } else {
                throw new Error('User denied transaction');
              }
            }
          
            const result = await CallXSWD(JSON.stringify({ method, params }));
            if (result && result.success) return result.result;
            throw new Error(result?.error || 'XSWD call failed');
          } catch (error) {
            throw error;
          }
        },
        getNetworkInfo: async () => iframeWindow.telaHost.call('DERO.GetInfo'),
        getBlock: async (height) => iframeWindow.telaHost.call('DERO.GetBlock', { height: parseInt(height) }),
        getTransaction: async (txHash) => iframeWindow.telaHost.call('DERO.GetTransaction', { txs_hashes: [txHash] }),
        getSmartContract: async (scid, code = true, variables = true) => {
          const params = { scid };
          if (code) params.code = true;
          if (variables) params.variables = true;
          return iframeWindow.telaHost.call('DERO.GetSC', params);
        },
        isConnected: () => $appState.xswdConnected,
        connect: async () => {
          const settings = get(settingsState);
          if (settings.integratedWallet) {
            try {
              // Default to read-only for initial connect
              const approval = await requestWalletApproval({
                type: 'connect',
                appName: currentMeta.name || 'App',
                origin: addressInput,
                isReadOnly: true,
                requestedPermissions: [{ 
                  id: 'read_public_data', 
                  name: 'Read Public Blockchain Data',
                  description: 'Can read public blockchain info (blocks, transactions, network stats)',
                  alwaysAsk: false
                }]
              });
              if (approval.approved) {
                await ApproveWalletConnection();
                return true;
              }
              return false;
            } catch (e) {
              return false;
            }
          }
          return await ConnectXSWD();
        },
        // Wallet shortcut methods (require connection)
        getAddress: async () => {
          const result = await iframeWindow.telaHost.call('GetAddress');
          return result?.address || result;
        },
        getBalance: async () => {
          const result = await iframeWindow.telaHost.call('GetBalance');
          return { balance: result?.balance || 0, unlocked: result?.unlocked_balance || 0 };
        },
        transfer: async (params) => {
          return iframeWindow.telaHost.call('transfer', params);
        },
        scInvoke: async (params) => {
          return iframeWindow.telaHost.call('scinvoke', params);
        },
        // File operations for TELA apps
        // saveFile allows dApps to save files to the user's filesystem via native dialog
        // Supports both text content and binary data (base64 encoded)
        saveFile: async (options = {}) => {
          const { filename = 'download', content, base64, mimeType = 'application/octet-stream' } = options;
          
          // Determine filter based on file extension or mimeType
          let filterName = 'All Files';
          let filterPattern = '*.*';
          const ext = filename.split('.').pop()?.toLowerCase();
          
          if (ext === 'png' || mimeType.includes('png')) {
            filterName = 'PNG Images';
            filterPattern = '*.png';
          } else if (ext === 'jpg' || ext === 'jpeg' || mimeType.includes('jpeg')) {
            filterName = 'JPEG Images';
            filterPattern = '*.jpg;*.jpeg';
          } else if (ext === 'json' || mimeType.includes('json')) {
            filterName = 'JSON Files';
            filterPattern = '*.json';
          } else if (ext === 'txt' || mimeType.includes('text')) {
            filterName = 'Text Files';
            filterPattern = '*.txt';
          }
          
          try {
            // Use binary save for base64 content (images, etc.)
            if (base64) {
              const result = await SaveBinaryFileWithDialog(filename, base64, filterName, filterPattern);
              if (result.cancelled) {
                return { success: false, cancelled: true };
              }
              if (!result.success) {
                throw new Error(result.error || 'Save failed');
              }
              return { success: true, path: result.path, size: result.size };
            }
            
            // For text content, we could use SaveFileWithDialog but let's use binary for consistency
            // Convert text to base64
            if (content) {
              const base64Content = btoa(unescape(encodeURIComponent(content)));
              const result = await SaveBinaryFileWithDialog(filename, base64Content, filterName, filterPattern);
              if (result.cancelled) {
                return { success: false, cancelled: true };
              }
              if (!result.success) {
                throw new Error(result.error || 'Save failed');
              }
              return { success: true, path: result.path, size: result.size };
            }
            
            throw new Error('No content provided - use content (string) or base64 (binary)');
          } catch (error) {
            addConsoleLog(`[ERR] telaHost.saveFile failed: ${error.message}`);
            throw error;
          }
        },
        // Check if running in HOLOGRAM (for feature detection)
        isHologram: () => true,
        version: '1.0.0'
      };
      
      // Inject download interceptor to handle <a download> clicks natively
      // This makes standard browser downloads work transparently in HOLOGRAM
      injectDownloadInterceptor(iframeWindow);
      
      // Notify explorer that telaHost is now available (in case it initialized before injection)
      try {
        // If xswd-core exists and is not connected, trigger re-initialization
        if (iframeWindow.xswd && iframeWindow.xswd.initialize && !iframeWindow.xswd.isConnected) {
          setTimeout(() => {
            try {
              iframeWindow.xswd.initialize();
            } catch (e) {
              // Ignore errors - explorer might handle this differently
            }
          }, 100);
        }
        // Also try the global initializeTELA function
        if (iframeWindow.initializeTELA && typeof iframeWindow.initializeTELA === 'function') {
          setTimeout(() => {
            try {
              iframeWindow.initializeTELA(true); // Pass true to force reconnection
            } catch (e) {
              // Ignore errors
            }
          }, 100);
        }
      } catch (e) {
        // Ignore notification errors
      }
      
      addConsoleLog('[OK] telaHost API injected');
    } catch (error) {
      // Silently fail for cross-origin - this is expected when iframe content
      // is served from a different origin (e.g., local dev server at localhost:50080)
      // The XSWD bridge handles communication via postMessage instead
    }
  }
  
  // Inject download interceptor to make standard <a download> work in HOLOGRAM
  // This intercepts clicks on anchor tags with download attribute and handles them natively
  function injectDownloadInterceptor(iframeWindow) {
    if (!iframeWindow || !iframeWindow.document) return;
    
    try {
      if (iframeWindow.__hologramDownloadInterceptor) return;
      iframeWindow.__hologramDownloadInterceptor = true;

      // ── Blob cache ──────────────────────────────────────────────────────────
      // Many dApps (e.g. Villager) call URL.revokeObjectURL() immediately after
      // a.click(), before any async handler can fetch the blob. By caching the
      // Blob object at createObjectURL() time we have it in hand regardless of
      // when revokeObjectURL() fires.
      const blobCache = new Map();

      const origCreateObjectURL = iframeWindow.URL.createObjectURL.bind(iframeWindow.URL);
      iframeWindow.URL.createObjectURL = function(obj) {
        const url = origCreateObjectURL(obj);
        if (obj instanceof iframeWindow.Blob) blobCache.set(url, obj);
        return url;
      };

      const origRevokeObjectURL = iframeWindow.URL.revokeObjectURL.bind(iframeWindow.URL);
      iframeWindow.URL.revokeObjectURL = function(url) {
        blobCache.delete(url);
        return origRevokeObjectURL(url);
      };

      // ── Shared save helper ───────────────────────────────────────────────────
      async function saveBlob(href, filename, cachedBlob) {
        // Prefer the synchronously-captured blob; fall back to fetch for URLs
        // that were created before our interceptor was injected.
        let blob = cachedBlob || blobCache.get(href);
        if (!blob) {
          try {
            const resp = await iframeWindow.fetch(href);
            blob = await resp.blob();
          } catch (fetchErr) {
            addConsoleLog(`[ERR] Download: could not read blob — ${fetchErr.message}`);
            return;
          }
        }

        const base64 = await new Promise((resolve, reject) => {
          const reader = new iframeWindow.FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        if (!iframeWindow.telaHost || !iframeWindow.telaHost.saveFile) {
          addConsoleLog('[ERR] Download: telaHost.saveFile not available');
          return;
        }

        const result = await iframeWindow.telaHost.saveFile({
          filename,
          base64,
          mimeType: blob.type || 'application/octet-stream'
        });

        if (result.success) {
          addConsoleLog(`[OK] File saved to: ${result.path}`);
        } else if (result.cancelled) {
          addConsoleLog('[Info] Download cancelled by user');
        } else {
          addConsoleLog(`[ERR] Save failed: ${result.error}`);
        }
      }

      // ── Programmatic .click() override ──────────────────────────────────────
      // Intercept anchor.click() calls (Villager pattern).
      // Must NOT be async itself — we grab the cached blob synchronously before
      // the caller can call revokeObjectURL(), then fire async work in the bg.
      const origAnchorClick = iframeWindow.HTMLAnchorElement.prototype.click;
      iframeWindow.HTMLAnchorElement.prototype.click = function() {
        if (this.hasAttribute('download') && this.href && this.href.startsWith('blob:')) {
          const href = this.href;
          const filename = this.download || 'download';
          // Capture blob NOW (synchronously) before the caller revokes the URL
          const cachedBlob = blobCache.get(href);
          addConsoleLog(`[Download] Intercepting: ${filename}`);
          saveBlob(href, filename, cachedBlob).catch(err =>
            addConsoleLog(`[ERR] Download failed: ${err.message}`)
          );
          return; // do not call original — native WebView can't download anyway
        }
        return origAnchorClick.call(this);
      };

      // ── Declarative click events (<a download> in markup) ───────────────────
      iframeWindow.document.addEventListener('click', (e) => {
        let anchor = e.target;
        while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
        if (!anchor || !anchor.hasAttribute('download')) return;
        const href = anchor.href;
        if (!href || !href.startsWith('blob:')) return;

        e.preventDefault();
        e.stopPropagation();

        const filename = anchor.download || 'download';
        const cachedBlob = blobCache.get(href);
        addConsoleLog(`[Download] Intercepting click: ${filename}`);
        saveBlob(href, filename, cachedBlob).catch(err =>
          addConsoleLog(`[ERR] Download failed: ${err.message}`)
        );
      }, true);

      addConsoleLog('[OK] Download interceptor installed (with blob cache)');
    } catch (error) {
      // Silently fail — cross-origin iframes will throw here
    }
  }
  
  function handleAddressInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchSuggestions, 150);
    selectedIndex = -1;
  }
  
  async function fetchSuggestions() {
    const value = addressInput.trim();
    
    // Strip dero:// prefix if user typed it (badge provides it visually)
    const cleanValue = value.toLowerCase().startsWith('dero://') ? value.slice(7) : value;
    
    // Show suggestions for empty input or non-SCID text (dURL names)
    const isHexSCID = /^[a-fA-F0-9]{64}$/.test(cleanValue);
    
    if (!isHexSCID) {
      if (!cleanValue || cleanValue.length < 2) {
        suggestions = [];
        showSuggestions = false;
        return;
      }
      try {
        const result = await GetNameSuggestions(cleanValue);
        if (result.success && result.suggestions) {
          suggestions = result.suggestions;
          showSuggestions = suggestions.length > 0;
        } else {
          suggestions = [];
          showSuggestions = false;
        }
      } catch (error) {
        suggestions = [];
        showSuggestions = false;
      }
    } else {
      suggestions = [];
      showSuggestions = false;
    }
  }
  
  function selectSuggestion(suggestion) {
    // Display just the name (badge provides dero:// prefix)
    addressInput = suggestion.name;
    showSuggestions = false;
    navigate();
  }
  
  async function goBack() {
    const tab = getCurrentTab();
    if (!tab) return;
    
    // If we have history in this tab, go back within the tab
    if (tab.historyIndex > 0) {
      const newIndex = tab.historyIndex - 1;
      tabs = tabs.map(t => t.id === activeTabId ? { ...t, historyIndex: newIndex } : t);
      addressInput = tab.history[newIndex];
      await navigate(true);
    } else if (!tab.isHome) {
      // No history but not on home - go to Discover (home)
      goHome();
    }
    // If already at home with no history, do nothing (button should be disabled)
  }
  
  async function goForward() {
    const tab = getCurrentTab();
    if (!tab) return;
    
    if (tab.historyIndex < tab.history.length - 1) {
      const newIndex = tab.historyIndex + 1;
      tabs = tabs.map(t => t.id === activeTabId ? { ...t, historyIndex: newIndex } : t);
      addressInput = tab.history[newIndex];
      await navigate(true);
    }
  }
  
  function goHome() {
    showWelcome = true;
    addressInput = '';
    // Update current tab to show it's at home
    updateActiveTab('Discover Apps', '', 'home');
    scheduleBrowserSessionSave();
    if (contentFrame) {
      try {
        contentFrame.removeAttribute('src');
        contentFrame.removeAttribute('srcdoc');
      } catch (e) {}
    }
  }
  
  function reload() {
    if (addressInput) navigate(true);
  }

  // Tracks whether the currently-loaded app is saved via offline prefetch.
  // Used by ReloadSplitButton to decide whether "Empty Cache & Reload"
  // needs a confirmation dialog (offline copy would also be removed).
  let isCurrentAppOfflineCached = false;

  async function refreshOfflineCacheFlag() {
    try {
      const scid = currentMeta?.scid;
      if (!scid) {
        isCurrentAppOfflineCached = false;
        return;
      }
      const res = await IsAppCachedOffline(scid);
      isCurrentAppOfflineCached = !!(res && res.cached);
    } catch {
      isCurrentAppOfflineCached = false;
    }
  }

  // Recompute whenever the active tab's SCID changes.
  $: if (currentMeta?.scid) {
    refreshOfflineCacheFlag();
  } else {
    isCurrentAppOfflineCached = false;
  }

  // Shared helper: call backend ClearAppCache, then re-navigate the tab.
  // `mode` is "hard" or "empty"; "empty" also removes the on-disk clone
  // and (optionally) the offline prefetch entry.
  async function clearAndReload(mode, { clearOffline = false } = {}) {
    if (!addressInput) return;
    const scid = currentMeta?.scid || '';
    const durl = currentMeta?.durl || '';
    if (!scid && !durl) {
      // No resolved metadata yet — fall back to a normal reload.
      reload();
      return;
    }
    try {
      const res = await ClearAppCache(scid, durl, mode, clearOffline);
      if (res && res.cleared && res.cleared.length) {
        addConsoleLog({
          type: 'info',
          message: `[Cache] Cleared for this app: ${res.cleared.join(', ')}`,
        });
      }
    } catch (e) {
      addConsoleLog({
        type: 'warn',
        message: `[Cache] Clear failed: ${e?.message || e}`,
      });
    }
    navigate(true);
  }

  function hardReload() {
    clearAndReload('hard');
  }

  function emptyCacheAndReload() {
    // Only pass clearOffline=true when the current app is actually
    // prefetched; otherwise the backend no-ops that branch anyway.
    clearAndReload('empty', { clearOffline: isCurrentAppOfflineCached });
  }

  // Browser-wide keyboard shortcuts for reload variants. Only fires when
  // the Browser route is active and focus is not in a text input/textarea
  // (so users typing in the address bar or console can still use ⌘R
  // without triggering unintentionally).
  function handleBrowserKeydown(event) {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key !== 'r' && event.key !== 'R') return;

    // Skip when user is typing in an input/textarea/contenteditable.
    const target = event.target;
    if (target && target.tagName) {
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (target.isContentEditable) return;
    }

    if (!addressInput || showWelcome) return;

    event.preventDefault();
    if (event.shiftKey) {
      hardReload();
    } else {
      reload();
    }
  }
  
  // Per-tab navigation state - reactive based on current tab's history
  $: currentTab = tabs.find(t => t.id === activeTabId);
  $: canGoBack = currentTab ? (currentTab.historyIndex > 0 || !currentTab.isHome) : false;
  $: canGoForward = currentTab ? currentTab.historyIndex < currentTab.history.length - 1 : false;
  
  // Tab management functions
  // Design Decision: New tab behavior uses "Option A: Focus URL bar + Show Discover (Chrome-like)"
  // See UI_IMPLEMENTATION_PLAN.md for alternative options considered
  function openNewTab(title = '', url = '', icon = 'box') {
    tabIdCounter++;
    const newTab = {
      id: `tab-${tabIdCounter}`,
      title: title || 'New Tab',
      url: url,
      icon: icon,
      isHome: false,
      history: [],      // Per-tab history
      historyIndex: -1  // Per-tab history index
    };
    tabs = [...tabs, newTab];
    activeTabId = newTab.id;
    scheduleBrowserSessionSave();
    
    if (url) {
      addressInput = url;
      navigate();
    } else {
      // Option A: Show Discover Apps and focus URL bar
      showWelcome = true;
      addressInput = '';
      // Focus URL bar after DOM updates
      setTimeout(() => {
        const urlInput = document.querySelector('.browser-url-input');
        if (urlInput) urlInput.focus();
      }, 50);
    }
  }
  
  function closeTab(tabId) {
    if (tabs.length <= 1) return; // Don't close last tab
    
    const index = tabs.findIndex(t => t.id === tabId);
    tabs = tabs.filter(t => t.id !== tabId);
    
    // Switch to adjacent tab if closing active
    if (activeTabId === tabId) {
      const newIndex = Math.min(index, tabs.length - 1);
      activeTabId = tabs[newIndex].id;
      const tab = tabs[newIndex];
      if (tab.isHome) {
        showWelcome = true;
        addressInput = '';
      } else if (tab.url) {
        addressInput = tab.url;
        navigate(true);
      }
    }
    scheduleBrowserSessionSave();
  }
  
  function switchTab(tabId) {
    if (activeTabId === tabId) return;
    
    activeTabId = tabId;
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      if (tab.isHome) {
        showWelcome = true;
        addressInput = '';
      } else if (tab.url) {
        addressInput = tab.url;
        navigate(true);
      }
    }
    scheduleBrowserSessionSave();
  }
  
  function updateActiveTab(title, url, icon) {
    tabs = tabs.map(t => 
      t.id === activeTabId 
        ? { ...t, title: title || t.title, url: url || t.url, icon: icon || t.icon }
        : t
    );
    scheduleBrowserSessionSave();
  }
  
  function handleOmniSearch(event) {
    const { query, type, results } = event.detail;
    
    // For navigable types, use existing Browser navigation
    if (type === 'durl' || type === 'name') {
      navigate();
    } else if (type === 'hash' || type === 'scid') {
      // 64-char hex could be SCID - try to navigate as TELA app
      navigate();
    } else if (type === 'block' || type === 'address' || type === 'key' || type === 'value' || type === 'code' || type === 'class' || type === 'tag') {
      // These are Explorer queries - switch to Explorer tab with search pre-loaded
      window.dispatchEvent(new CustomEvent('search-navigate', {
        detail: { tab: 'explorer', type, query, result: results }
      }));
    } else {
      // Default: try to navigate (might be a dURL)
      navigate();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter') {
      if (showSuggestions && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        selectSuggestion(suggestions[selectedIndex]);
      } else {
        navigate();
      }
    } else if (event.key === 'Escape') {
      showSuggestions = false;
      selectedIndex = -1;
    } else if (event.key === 'ArrowDown') {
      if (showSuggestions && suggestions.length > 0) {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % suggestions.length;
      }
    } else if (event.key === 'ArrowUp') {
      if (showSuggestions && suggestions.length > 0) {
        event.preventDefault();
        selectedIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
      }
    } else if (event.key === 'Tab' && showSuggestions && suggestions.length > 0) {
      event.preventDefault();
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      // Display just the name (badge provides dero:// prefix)
      addressInput = suggestions[idx].name;
      showSuggestions = false;
    }
  }
</script>

<svelte:window on:keydown={handleBrowserKeydown} />

<div class="browser-layout">
  <!-- v6.1 Browser Tabs -->
  <div class="browser-tabs">
    {#each tabs as tab}
      <div
        class="browser-tab"
        class:active={activeTabId === tab.id}
        on:click={() => switchTab(tab.id)}
        on:keydown={(e) => e.key === 'Enter' && switchTab(tab.id)}
        role="tab"
        tabindex="0"
      >
        <span class="browser-tab-icon">{tab.isHome ? '⌂' : '◇'}</span>
        <span class="browser-tab-title">{tab.title}</span>
        <span 
          class="browser-tab-close" 
          on:click|stopPropagation={() => closeTab(tab.id)}
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && closeTab(tab.id)}
          role="button"
          tabindex="0"
        >×</span>
      </div>
    {/each}
    <div 
      class="browser-tab-new" 
      on:click={() => openNewTab()} 
      on:keydown={(e) => e.key === 'Enter' && openNewTab()}
      role="button"
      tabindex="0"
      title="New Tab"
    >+</div>
  </div>
  
  <!-- v6.1 Browser Navigation Bar -->
  <div class="browser-nav">
      <!-- Navigation Controls -->
    <div class="browser-nav-controls">
        <button
          on:click={goBack}
          disabled={!canGoBack}
          class="nav-btn"
          title="Back"
        >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <button
          on:click={goForward}
          disabled={!canGoForward}
          class="nav-btn"
          title="Forward"
        >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </button>
        <ReloadSplitButton
          disabled={!addressInput || showWelcome}
          isOfflineCached={isCurrentAppOfflineCached}
          isTelaTab={!!currentMeta?.scid}
          on:reload={reload}
          on:hardReload={hardReload}
          on:emptyCacheReload={emptyCacheAndReload}
        />
        <button
          on:click={goHome}
          class="nav-btn"
          title="Home"
        >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
          </svg>
        </button>
      </div>
      
    <!-- v6.1 URL Bar -->
    <div class="browser-url-container" class:focused={addressBarFocused}>
      <span class="browser-url-protocol">dero://</span>
          <OmniSearch
            bind:this={addressInputEl}
            bind:value={addressInput}
            placeholder="Enter dURL, SCID, or search..."
            compact={true}
            on:search={handleOmniSearch}
            loading={loading}
          />
      
      <!-- Favorite Button (in address bar) -->
      <button
        on:click={toggleCurrentFavorite}
        class="browser-url-fav-btn"
        class:favorited={currentIsFavorited}
        disabled={!addressInput || showWelcome}
        title={currentIsFavorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={14} fill={currentIsFavorited ? 'currentColor' : 'none'} />
      </button>
        </div>
      
      <!-- Version History Toggle -->
      <button
        on:click={openVersionHistory}
        class="nav-btn"
        class:active={showVersionHistory}
        title="Version History"
        disabled={showWelcome}
      >
        <History size={14} />
      </button>
      
      <!-- JS Console Toggle -->
      <button
        on:click={toggleConsole}
        class="nav-btn"
        class:active={showConsole}
        title="Toggle JS Console (Cmd/Ctrl+Shift+J)"
      >
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      </button>
  </div>
  
  {#if telaServerFallback}
    <div class="alert alert-warning" style="margin: var(--s-4) var(--s-5) 0;">
      <div class="alert-icon">
        <Icons name="alert-triangle" size={16} />
      </div>
      <div class="alert-content">
        <div class="alert-title">TELA server fallback active</div>
        <div class="alert-text">
          Running in srcdoc mode. Wallet connections and app scripts may be limited.
          {#if telaServerFallback.error}
            Error: {telaServerFallback.error}
          {/if}
        </div>
      </div>
    </div>
  {/if}
  
  <!-- Content Area -->
  <div class="browser-content-area" tabindex="-1">
    <!-- Welcome Screen / Discover View -->
    <div class="browser-welcome-screen" style:display={showWelcome ? 'block' : 'none'}>
      <!-- Favorites Section -->
      {#if $favorites.length > 0}
        <div class="browser-favorites-section">
          <div class="browser-favorites-inner">
            <div class="browser-favorites-header">
              <h2 class="browser-favorites-title">
                <Icons name="star" size={16} />
                Favorites
              </h2>
              {#if $favorites.length > 6}
                <button 
                  class="browser-view-all-btn"
                  on:click={() => showAllFavorites = !showAllFavorites}
                >
                  {showAllFavorites ? 'Show Less' : `View All (${$favorites.length})`}
                </button>
              {/if}
            </div>
            <div class="browser-favorites-grid">
              {#each (showAllFavorites ? $favorites : $favorites.slice(0, 6)) as fav}
                <button
                  on:click={() => navigateToFavorite(fav)}
                  class="browser-favorite-card"
                >
                  <div class="browser-favorite-icon">
                    {#if shouldShowIcon(fav.icon)}
                      <img 
                        src={fav.icon} 
                        alt="" 
                        class="browser-favorite-icon-img" 
                        on:error={() => handleIconError(fav.icon)}
                      />
                    {:else}
                      <img src={deroIconFallback} alt="" class="browser-favorite-icon-img" />
                    {/if}
                  </div>
                  <div class="browser-favorite-name">{fav.name}</div>
                  <button
                    on:click|stopPropagation={() => favorites.remove(fav.scid || fav.durl)}
                    class="browser-favorite-remove"
                    title="Remove from favorites"
                  >
                    ×
                  </button>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
      
      <!-- v6.1 Discover Header (Matches page-header pattern exactly) -->
      <div class="browser-discover-header">
        <div class="browser-discover-header-inner">
          <div class="browser-discover-header-left">
            <h1 class="browser-discover-header-title">
              <Icons name="grid" size={18} class="browser-discover-header-icon" />
              DISCOVER APPS
            </h1>
            <p class="browser-discover-header-desc">Browse decentralized applications on the DERO blockchain</p>
          </div>
        </div>
      </div>
      
      <!-- v6.1 Filter Bar -->
      <div class="browser-filter-bar">
        <div class="browser-filter-bar-inner">
          <!-- Category Filters (Left) -->
          <div class="browser-filter-categories">
            {#each categories as cat}
              <button
                on:click={() => handleCategoryChange(cat.id)}
                class="browser-filter-category-btn"
                class:active={selectedCategory === cat.id}
                title={cat.label}
              >
                <Icons name={cat.iconName} size={14} />
                <span>{cat.label}</span>
              </button>
            {/each}
          </div>
          
          <!-- Tag Filters (Middle) - Simple-Gnomon Feature -->
          {#if availableTags.length > 0}
            <div class="browser-filter-tags">
              <span class="browser-filter-tags-label">Tags:</span>
              {#each availableTags.slice(0, 5) as tag}
                <button
                  on:click={() => handleTagChange(tag)}
                  class="browser-filter-tag-btn"
                  class:active={selectedTag === tag}
                  title={`Filter by ${tag}`}
                >
                  {tag}
                </button>
              {/each}
              {#if selectedTag}
                <button
                  on:click={() => handleTagChange('')}
                  class="browser-filter-tag-clear"
                  title="Clear tag filter"
                >
                  ×
                </button>
              {/if}
            </div>
          {/if}
          
          <!-- Sort Dropdown (Right) -->
          <div class="browser-filter-sort">
            <label for="sort-select" class="browser-filter-sort-label">Sort by:</label>
            <select
              id="sort-select"
              bind:value={sortBy}
              on:change={handleSortChange}
              class="browser-filter-sort-select"
            >
              <option value="rating">Highest Rated</option>
              <option value="name">Alphabetical</option>
            </select>
          </div>
        </div>
      </div>
      
      <!-- Content -->
      <div class="browser-discover-content">
        <div class="browser-discover-content-inner">
          {#if gnomonStarting}
            <div class="browser-empty-state">
              <div class="browser-loading-spinner"></div>
              <h2 class="browser-empty-title">Starting Gnomon Indexer...</h2>
              <p class="browser-empty-text">Connecting to blockchain index to discover applications</p>
            </div>
          {:else if !$appState.gnomonRunning}
            <div class="browser-empty-state">
              <div class="browser-empty-icon">
                <Icons name="wifi" size={48} />
              </div>
              <h2 class="browser-empty-title">Could Not Connect to Gnomon</h2>
              <p class="browser-empty-text">The Gnomon indexer failed to start. Make sure the DERO daemon is running and try again.</p>
              <button on:click={startIndexer} class="btn btn-primary">
                Retry
              </button>
              <label class="gnomon-autostart-option checkbox-wrap">
                <input type="checkbox" class="checkbox" bind:checked={enableAutostart} />
                <span class="checkbox-label">Start at app launch (before opening Browser)</span>
              </label>
            </div>
          {:else if $appState.gnomonProgress < 95 && apps.length === 0}
            <!-- Gnomon is syncing - show progress instead of "No Apps Found" -->
            <div class="browser-empty-state">
              <div class="browser-loading-spinner"></div>
              <h2 class="browser-empty-title">Syncing Blockchain Index</h2>
              <p class="browser-empty-text">
                Indexing block {$appState.gnomonIndexedHeight.toLocaleString()} of {$appState.chainHeight.toLocaleString()}
              </p>
              <div class="gnomon-sync-progress">
                <div class="gnomon-sync-bar">
                  <div class="gnomon-sync-fill" style="width: {$appState.gnomonProgress}%"></div>
                </div>
                <span class="gnomon-sync-percent">{$appState.gnomonProgress.toFixed(1)}%</span>
              </div>
              <p class="browser-empty-hint">Apps will appear as they are discovered...</p>
            </div>
          {:else if appsLoading || waitingForInitialApps}
            <div class="browser-empty-state">
              <div class="browser-loading-spinner"></div>
              <p class="browser-empty-text">
                {waitingForInitialApps
                  ? 'Building app index in background... apps will appear shortly.'
                  : 'Loading apps from blockchain index...'}
              </p>
              {#if waitingForInitialApps}
                <p class="browser-empty-hint">Discovery pass {appDiscoveryRetryCount}/{APP_DISCOVERY_MAX_RETRIES}</p>
              {/if}
            </div>
          {:else if filteredApps.length === 0}
            <div class="browser-empty-state">
              <div class="browser-empty-icon">
                <Icons name="search" size={48} />
              </div>
              <h2 class="browser-empty-title">No Apps Found</h2>
              <p class="browser-empty-text">
                {selectedCategory === 'top' ? 'No top-rated apps found. Try viewing all apps.' : 'No apps indexed yet'}
              </p>
              {#if selectedCategory !== 'all'}
                <button
                  on:click={() => handleCategoryChange('all')}
                  class="btn btn-secondary"
                >
                  View All Apps
                </button>
              {/if}
            </div>
          {:else}
            <div class="browser-apps-grid">
              {#each filteredApps as app}
                <button 
                  class="browser-app-card" 
                  class:warned={warnedApps.has(app.scid)}
                  class:blocked={blockedApps.has(app.scid)}
                  on:click={() => navigateToApp(app)}
                >
                  <!-- Warning/Blocked overlay -->
                  {#if warnedApps.has(app.scid)}
                    <div class="browser-app-warning-overlay">
                      <Icons name="alert-triangle" size={16} />
                      <span class="warning-text">{warnedApps.get(app.scid)}</span>
                      <button 
                        class="warning-allow-btn"
                        on:click|stopPropagation={() => allowApp(app.scid)}
                      >Allow Anyway</button>
                    </div>
                  {/if}
                  {#if blockedApps.has(app.scid)}
                    <div class="browser-app-blocked-overlay">
                      <Icons name="shield-off" size={16} />
                      <span class="blocked-text">Blocked by content filter</span>
                      <button 
                        class="blocked-allow-btn"
                        on:click|stopPropagation={() => allowApp(app.scid)}
                      >Unblock</button>
                    </div>
                  {/if}
                  
                  <!-- Icon on left -->
                      <div class="browser-app-icon">
                        {#if shouldShowIcon(app.icon)}
                          <img 
                            src={app.icon} 
                            alt="" 
                            class="browser-app-icon-img" 
                            on:error={() => handleIconError(app.icon)}
                          />
                        {:else}
                          <img src={deroIconFallback} alt="" class="browser-app-icon-img browser-app-icon-fallback" />
                        {/if}
                      </div>
                  
                  <!-- Content on right -->
                      <div class="browser-app-meta">
                        <h3 class="browser-app-name">{app.display_name || app.name || 'Unnamed App'}</h3>
                        {#if app.durl}
                          <p class="browser-app-durl">dero://{app.durl}</p>
                        {:else}
                          <p class="browser-app-scid">{app.scid?.substring(0, 16)}...</p>
                        {/if}
                    
                    <p class="browser-app-desc">{app.description || 'No description available'}</p>
                    
                    <div class="browser-app-footer">
                      {#if app.supports_epoch}
                        <span class="browser-epoch-badge" title="Supports EPOCH Developer Ecosystem">EPOCH</span>
                      {/if}
                      {#if app.rating && app.rating.count > 0}
                        <HoloBadge variant={getRatingBadge(app.rating.average)}>
                          ★ {app.rating.average.toFixed(1)}
                        </HoloBadge>
                        <button 
                          class="browser-app-rating-count"
                          on:click={(e) => openRatingsBreakdown(app, e)}
                          title="View ratings breakdown"
                        >{app.rating.count} rating{app.rating.count > 1 ? 's' : ''}</button>
                      {:else}
                        <span class="browser-app-no-rating">No ratings yet</span>
                      {/if}
                      <button 
                        class="browser-rate-btn"
                        on:click={(e) => openRatingModal(app, e)}
                        title="Rate this app"
                      >
                        <Star size={12} />
                        Rate
                      </button>
                      <button 
                        class="browser-fav-btn"
                        class:favorited={isAppFavorited(app, $favorites)}
                        on:click={(e) => toggleAppFavorite(app, e)}
                        title={isAppFavorited(app, $favorites) ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Heart size={12} fill={isAppFavorited(app, $favorites) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
            
            <div class="browser-apps-count">
              Showing {filteredApps.length} of {apps.length} apps
              {#if contentFilterEnabled && blockedApps.size > 0}
                <span class="filter-blocked-count">
                  ({blockedApps.size} blocked by filter)
                  <button 
                    class="show-blocked-btn"
                    on:click={() => { showBlockedApps = !showBlockedApps; applyFilters(); }}
                  >
                    {showBlockedApps ? 'Hide' : 'Show'}
                  </button>
                </span>
              {/if}
              {#if contentFilterEnabled && warnedApps.size > 0}
                <span class="filter-warned-count">
                  ({warnedApps.size} with warnings)
                </span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
    
    <!-- Loading Indicator -->
    <div class="browser-loading-state" style:display={loading ? 'flex' : 'none'}>
      <div class="browser-loading-spinner"></div>
      <p class="browser-loading-text">Loading from blockchain...</p>
    </div>
    
    <!-- Content Frame
         Clipboard: TELA apps (e.g. Villager "Paste" using navigator.clipboard.readText)
         need sandbox allow-clipboard-* + allow= delegation; otherwise readText fails
         silently or with NotAllowedError inside the iframe (differs by OS/webview). -->
    <iframe
      bind:this={contentFrame}
      class="browser-content-frame"
      style:display={!showWelcome && !loading ? 'block' : 'none'}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-clipboard-read allow-clipboard-write"
      allow="clipboard-read; clipboard-write"
      title="App Content"
    ></iframe>
    
    <!-- v6.1 Console Panel (matches Settings console) -->
    {#if showConsole}
      <div class="browser-console-panel">
        <div class="browser-console-header">
          <span class="browser-console-title">
            <Icons name="terminal" size={12} />
            JS CONSOLE
            {#if consoleErrorCount > 0 || consoleWarnCount > 0}
              <span class="browser-console-counters">
                {#if consoleErrorCount > 0}
                  <span class="browser-console-counter counter-error">{consoleErrorCount} error{consoleErrorCount !== 1 ? 's' : ''}</span>
                {/if}
                {#if consoleWarnCount > 0}
                  <span class="browser-console-counter counter-warn">{consoleWarnCount} warn{consoleWarnCount !== 1 ? 's' : ''}</span>
                {/if}
              </span>
            {/if}
          </span>
          <div class="browser-console-filters">
            <button 
              on:click={() => setSourceFilter('all')} 
              class="browser-console-chip"
              class:active={consoleFilterSource === 'all'}
            >All</button>
            <button 
              on:click={() => setSourceFilter('dapp')} 
              class="browser-console-chip"
              class:active={consoleFilterSource === 'dapp'}
            >dApp</button>
            <button 
              on:click={() => setSourceFilter('hologram')} 
              class="browser-console-chip"
              class:active={consoleFilterSource === 'hologram'}
            >System</button>
            <button 
              on:click={() => setSourceFilter('bridge')} 
              class="browser-console-chip"
              class:active={consoleFilterSource === 'bridge'}
            >Bridge</button>
            <span class="browser-console-filter-divider"></span>
            <button 
              on:click={toggleErrorsOnlyFilter} 
              class="browser-console-chip"
              class:active={consoleFilterErrorsOnly}
            >
              {consoleFilterErrorsOnly ? '⚠ Errors' : 'Errors only'}
            </button>
          </div>
          <div class="browser-console-actions">
            <button on:click={copyDiagnostics} class="browser-console-btn" title="Copy diagnostic bundle for bug reports">
              Diagnostics
            </button>
            <button on:click={() => copyAllLogs()} class="browser-console-btn" title="Copy all logs">
              Copy All
            </button>
            <button on:click={clearConsoleLogs} class="browser-console-btn" title="Clear all logs">
              Clear
            </button>
            <button on:click={toggleConsole} class="browser-console-btn" title="Close console">
              <Icons name="x" size={12} />
            </button>
          </div>
        </div>
        <div class="browser-console-viewport" bind:this={consoleViewport} on:scroll={handleConsoleScroll}>
          {#if consoleLogs.length === 0}
            <div class="browser-console-empty">JS console ready. Navigate to a dApp to see its console.log output, warnings, errors, and uncaught exceptions.</div>
          {:else if filteredConsoleLogs.length === 0}
            <div class="browser-console-empty">No errors or warnings. <button class="browser-console-link-btn" on:click={toggleErrorsOnlyFilter}>Show all logs</button></div>
          {:else}
            {#each filteredConsoleLogs as log, index}
              <div class="browser-console-line {log.level === 'error' ? 'level-error' : log.level === 'warn' ? 'level-warn' : ''}">
                <span class="browser-console-timestamp">[{log.timestamp || new Date().toLocaleTimeString()}]</span>
                {#if log.source}
                  <span class="browser-console-source browser-console-source-{log.source}">{log.source}</span>
                {/if}
                <span class="browser-console-message">{log.message}</span>
                {#if hasExpandableContent(log)}
                  <button 
                    class="browser-console-expand-btn" 
                    on:click={() => toggleLogExpanded(index)}
                    title={expandedLogIndices.has(index) ? 'Collapse details' : 'Expand details'}
                  >
                    {expandedLogIndices.has(index) ? '▼' : '▶'}
                  </button>
                {/if}
              </div>
              {#if expandedLogIndices.has(index) && hasExpandableContent(log)}
                <div class="browser-console-expanded">
                  {#if log.app}
                    <div class="browser-console-app">
                      📦 {log.app.name || 'App'}{#if log.app.durl} · <span class="browser-console-app-durl">{log.app.durl}</span>{/if}{#if log.app.scid} · <span class="browser-console-app-scid" title={log.app.scid}>{log.app.scid.substring(0, 12)}...</span>{/if}
                    </div>
                  {/if}
                  {#if log.location}
                    <div class="browser-console-location">
                      📍 {log.location.file || log.location.href}:{log.location.line || '?'}:{log.location.column || '?'}
                    </div>
                  {/if}
                  {#if log.stack}
                    <pre class="browser-console-stack">{log.stack}</pre>
                  {/if}
                  {#if log.args && log.args.length > 0}
                    <div class="browser-console-args">
                      <span class="browser-console-args-label">Args:</span>
                      {#each log.args as arg, i}
                        <code class="browser-console-arg">{typeof arg === 'string' ? arg : JSON.stringify(arg)}</code>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if showExternalLinkModal}
  <div class="modal-overlay" on:click={closeExternalLinkModal} role="presentation">
    <div class="modal-content modal-content-wide" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="external-link-title">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon warning">
            <Link2 size={16} />
          </div>
          <div>
            <h2 id="external-link-title" class="modal-title">Leaving the in-app browser</h2>
            <p class="modal-subtitle">This app linked to a classic web (HTTPS) address. HOLOGRAM does not open it automatically. Copy the URL and paste it into a browser you trust, or open it in your system browser if you choose.</p>
          </div>
        </div>
        <button type="button" class="modal-close" on:click={closeExternalLinkModal} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div class="modal-body">
        <label class="modal-form-label" for="external-link-url">URL</label>
        <textarea
          id="external-link-url"
          class="modal-input"
          readonly
          rows="3"
          bind:value={externalLinkUrl}
          style="resize: vertical; min-height: 4.5rem;"
        ></textarea>
      </div>
      <div class="modal-footer modal-footer-spread">
        <button type="button" class="modal-btn modal-btn-secondary" on:click={closeExternalLinkModal}>Close</button>
        <div style="display: flex; gap: var(--s-3);">
          <button type="button" class="modal-btn modal-btn-secondary" on:click={openExternalLinkInSystemBrowser}>Open in default browser</button>
          <button type="button" class="modal-btn modal-btn-primary" on:click={copyExternalLinkToClipboard}>Copy link</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Rating Modal -->
<RatingModal 
  bind:show={showRatingModal}
  scid={ratingAppScid}
  appName={ratingAppName}
  on:rated={handleRated}
  on:close={() => showRatingModal = false}
/>

<RatingsBreakdown
  bind:visible={showRatingsBreakdown}
  scid={breakdownScid}
  on:close={() => showRatingsBreakdown = false}
/>

<!-- Version History Modal -->
<VersionHistory 
  scid={versionHistoryScid} 
  bind:show={showVersionHistory}
  on:close={closeVersionHistory}
  on:revert={handleVersionRevert}
  on:clone={handleVersionClone}
/>

<style>
  /* === v6.1 Browser Layout ===
     ALL browser patterns now come from hologram.css with browser-* prefixes:
     - Layout: .browser-layout, .browser-content-area, .browser-tabs, .browser-nav
     - URL: .browser-url-container, .browser-url-input, .browser-go-btn
     - Favorites: .browser-favorites-*, .browser-favorite-*
     - Discover: .browser-discover-*, .browser-search-*, .browser-sort-btn
     - Apps: .browser-apps-grid, .browser-app-*, .browser-empty-*, .browser-loading-*
     - Suggestions: .browser-suggestions-*, .browser-suggestion-*
     - Console: .browser-console-*
  */
  
  /* Search icon global style */
  :global(.browser-search-icon) {
    color: var(--text-4, #505068);
    flex-shrink: 0;
  }
  
  
  /* Source badge in console lines */
  .browser-console-source {
    display: inline-block;
    padding: 1px 5px;
    margin-right: 6px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .browser-console-source-dapp {
    background: rgba(34, 197, 94, 0.2);
    color: var(--green-400, #4ade80);
  }
  
  .browser-console-source-dapp-uncaught,
  .browser-console-source-dapp-rejection {
    background: rgba(239, 68, 68, 0.2);
    color: var(--status-err, #ef4444);
  }
  
  .browser-console-source-hologram {
    background: rgba(6, 182, 212, 0.2);
    color: var(--cyan-400, #22d3ee);
  }
  
  .browser-console-source-bridge {
    background: rgba(168, 85, 247, 0.2);
    color: var(--purple-400, #a855f7);
  }
  
  .browser-console-source-backend {
    background: rgba(251, 191, 36, 0.2);
    color: var(--amber-400, #fbbf24);
  }
  
  .browser-console-source-unknown {
    background: rgba(100, 116, 139, 0.2);
    color: var(--text-muted, #94a3b8);
  }
  
  /* Expand/collapse button for log details */
  .browser-console-expand-btn {
    margin-left: auto;
    padding: 0 4px;
    background: transparent;
    border: none;
    color: var(--text-muted, #64748b);
    font-size: 10px;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }
  
  .browser-console-expand-btn:hover {
    opacity: 1;
  }
  
  /* Make console lines flex for expand button alignment */
  .browser-console-line {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  
  .browser-console-message {
    flex: 1;
    word-break: break-word;
  }
  
  /* Expanded details section */
  .browser-console-expanded {
    margin-left: 20px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.2);
    border-left: 2px solid var(--border-subtle, #334155);
    font-size: 11px;
  }
  
  .browser-console-app {
    color: var(--text-muted, #94a3b8);
    margin-bottom: 4px;
  }
  
  .browser-console-app-durl {
    color: var(--cyan-400, #22d3ee);
  }
  
  .browser-console-app-scid {
    color: var(--purple-400, #a855f7);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 10px;
  }
  
  .browser-console-location {
    color: var(--text-muted, #94a3b8);
    margin-bottom: 4px;
  }
  
  .browser-console-stack {
    margin: 4px 0;
    padding: 6px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 10px;
    color: var(--status-err, #ef4444);
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
    max-height: 200px;
  }
  
  .browser-console-args {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
  }
  
  .browser-console-args-label {
    color: var(--text-muted, #94a3b8);
    font-weight: 500;
  }
  
  .browser-console-arg {
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 3px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 10px;
    color: var(--cyan-300, #67e8f9);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* Error/warning counters in console header */
  .browser-console-counters {
    display: inline-flex;
    gap: 8px;
    margin-left: 10px;
  }
  
  .browser-console-counter {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 3px;
  }
  
  .browser-console-counter.counter-error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--status-err, #ef4444);
  }
  
  .browser-console-counter.counter-warn {
    background: rgba(251, 191, 36, 0.2);
    color: var(--amber-400, #fbbf24);
  }
  
  /* Source filter chips row */
  .browser-console-filters {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    margin-right: 8px;
  }
  
  .browser-console-chip {
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--border-subtle, #334155);
    border-radius: 4px;
    color: var(--text-muted, #94a3b8);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .browser-console-chip:hover {
    background: var(--void-up, #1e1e2e);
    border-color: var(--cyan-500, #06b6d4);
    color: var(--cyan-400, #22d3ee);
  }
  
  .browser-console-chip.active {
    background: rgba(6, 182, 212, 0.15);
    border-color: var(--cyan-500, #06b6d4);
    color: var(--cyan-400, #22d3ee);
  }
  
  .browser-console-filter-divider {
    width: 1px;
    height: 16px;
    background: var(--border-subtle, #334155);
    margin: 0 4px;
  }
  
  /* Active state for filter button */
  .browser-console-btn.active {
    background: rgba(239, 68, 68, 0.2);
    border-color: var(--status-err, #ef4444);
    color: var(--status-err, #ef4444);
  }
  
  /* Link button in empty state */
  .browser-console-link-btn {
    background: transparent;
    border: none;
    color: var(--cyan-400, #22d3ee);
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
    padding: 0;
  }
  
  .browser-console-link-btn:hover {
    color: var(--cyan-300, #67e8f9);
  }
  
  /* Rate button in app cards */
  .browser-rate-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    margin-left: auto;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .browser-rate-btn:hover {
    background: var(--cyan-500);
    border-color: var(--cyan-500);
    color: var(--void-base);
  }
  
  /* Favorite button in app cards */
  .browser-fav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 6px;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .browser-fav-btn:hover {
    background: var(--void-surface);
    border-color: var(--pink-400);
    color: var(--pink-400);
  }
  
  .browser-fav-btn.favorited {
    background: rgba(236, 72, 153, 0.15);
    border-color: var(--pink-400);
    color: var(--pink-400);
  }
  
  .browser-fav-btn.favorited:hover {
    background: rgba(236, 72, 153, 0.25);
  }
  
  /* Favorite button in address bar */
  .browser-url-fav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-left: 4px;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .browser-url-fav-btn:hover:not(:disabled) {
    background: var(--void-up);
    border-color: var(--pink-400);
    color: var(--pink-400);
  }
  
  .browser-url-fav-btn.favorited {
    background: rgba(236, 72, 153, 0.15);
    border-color: var(--pink-400);
    color: var(--pink-400);
  }
  
  .browser-url-fav-btn.favorited:hover {
    background: rgba(236, 72, 153, 0.25);
  }
  
  .browser-url-fav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  /* Gnomon auto-start checkbox - uses design system .checkbox-wrap, .checkbox, .checkbox-label */
  .gnomon-autostart-option {
    margin-top: 16px;
  }
  
  /* Gnomon sync progress */
  .gnomon-sync-progress {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    width: 280px;
  }
  
  .gnomon-sync-bar {
    flex: 1;
    height: 6px;
    background: var(--void-mid);
    border-radius: 3px;
    overflow: hidden;
  }
  
  .gnomon-sync-fill {
    height: 100%;
    background: var(--cyan-400);
    border-radius: 3px;
    transition: width 0.3s ease;
  }
  
  .gnomon-sync-percent {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--cyan-400);
    min-width: 50px;
    text-align: right;
  }
  
  .browser-empty-hint {
    margin-top: 12px;
    font-size: 12px;
    color: var(--text-5);
    font-style: italic;
  }
  
  /* Tag filter styles (Simple-Gnomon feature) */
  .browser-filter-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 16px;
    padding-left: 16px;
    border-left: 1px solid var(--border-subtle);
  }
  
  .browser-filter-tags-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
  }
  
  .browser-filter-tag-btn {
    padding: 4px 10px;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .browser-filter-tag-btn:hover {
    background: var(--void-surface);
    border-color: var(--cyan-500);
    color: var(--cyan-400);
  }
  
  .browser-filter-tag-btn.active {
    background: rgba(6, 182, 212, 0.15);
    border-color: var(--cyan-500);
    color: var(--cyan-400);
  }
  
  .browser-filter-tag-clear {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .browser-filter-tag-clear:hover {
    background: var(--status-err);
    border-color: var(--status-err);
    color: white;
  }
  
  /* Content Filter Styles */
  .browser-app-card.warned {
    position: relative;
  }
  
  .browser-app-card.blocked {
    position: relative;
    opacity: 0.6;
  }
  
  .browser-app-warning-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.9));
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 10;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    color: var(--void-pure);
    font-size: 11px;
  }
  
  .browser-app-warning-overlay .warning-text {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .warning-allow-btn {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  
  .warning-allow-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  
  .browser-app-blocked-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(239, 68, 68, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    z-index: 10;
    border-radius: var(--r-lg);
    color: white;
    font-size: 12px;
  }
  
  .browser-app-blocked-overlay .blocked-text {
    font-weight: 500;
  }
  
  .blocked-allow-btn {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  
  .blocked-allow-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  
  /* Filter count styles */
  .filter-blocked-count {
    color: var(--rose-400);
    font-size: 11px;
    margin-left: 8px;
  }
  
  .filter-warned-count {
    color: var(--amber-400);
    font-size: 11px;
    margin-left: 8px;
  }
  
  .show-blocked-btn {
    background: none;
    border: none;
    color: var(--cyan-400);
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    margin-left: 4px;
  }
  
  .show-blocked-btn:hover {
    color: var(--cyan-300);
  }
</style>
