<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { appState } from '../lib/stores/appState.js';
  import { recentSearchesKey, migrateLegacyExplorerSearchStorage } from '../lib/recentSearchStorage.js';
  import { CallXSWD, DaemonGetBlockHeaderByHeight, DaemonGetTxPool, ValidateProofFull, FormatBlockAge, GetTransactionWithRings, GetTransactionExtended, DaemonGetSC, StartBlockMonitoring, StopBlockMonitoring, OmniSearch, SetVar, DeleteVar, GetSCVariables, GetSCInteractionHistory, SubscribeToBlockEvents, GetXSWDStatus, ResolveDeroName, GetRandomSmartContracts, GetMempoolExtended, ParseSCFunctions, InvokeSCFunction, CaptureSCState, GetSCStateHistory, GetSCStateAtHeight, CompareSCStateAtHeights, WatchSmartContract, UnwatchSmartContract, GetWatchedSmartContracts, RefreshWatchedSCs, GetSCChangeTimeline, GetBlockByHash, GetCoinbaseMiner, GetAddressSCIDReferences, IsInSimulatorMode } from '../../wailsjs/go/main/App.js';
  import { walletState } from '../lib/stores/appState.js';
  import { toast, navigateTo } from '../lib/stores/appState.js';
  import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime.js';
  import LiveStats from '../lib/components/LiveStats.svelte';
  import NetworkHealth from '../lib/components/NetworkHealth.svelte';
  import RingVisualization from '../lib/components/RingVisualization.svelte';
  import OmniSearchComponent from '../lib/components/OmniSearch.svelte';
  import { HoloCard, HoloBadge, DotIndicator } from '../lib/components/holo';
  import SCQuickActions from '../lib/components/SCQuickActions.svelte';
  import AddressDisplay from '../lib/components/AddressDisplay.svelte';
  import Wordmark from '../lib/components/Wordmark.svelte';
  import SearchHistory from '../lib/components/SearchHistory.svelte';
  import VersionHistory from '../lib/components/VersionHistory.svelte';
  import SCFunctionInteractor from '../lib/components/SCFunctionInteractor.svelte';
  import { formatSCDisplayKey, formatSCDisplayValue } from '../lib/utils/scValueDisplay.js';
  import { 
    Package, FileText, Coins, Clock, Copy, ArrowLeft, Home, X, ChevronLeft, ChevronRight,
    FileCode, User, Globe, Lock, Info, AlertTriangle, Check, Loader2, Shield, Pickaxe,
    ChevronDown, Search, Layers, Activity, CheckCircle, BarChart3, Palette, Wallet, Zap, Link,
    GitBranch, History, Key, Database, Code, Eye, EyeOff
  } from 'lucide-svelte';
  
  // v6.2 Sidebar navigation state - Simplified (landing view + tools only)
  let activeSection = 'home'; // Default to landing view
  let showLanding = true; // Show landing view by default
  const sidebarSections = {
    tools: [
      { id: 'proof', label: 'Proof Validator', icon: Shield },
      { id: 'mempool', label: 'Mempool Browser', icon: Activity },
    ]
  };
  
  // Mempool browser state
  let mempoolData = null;
  let mempoolLoading = false;
  
  let searchQuery = '';
  let searchResult = null;
  let loading = false;
  let recentBlocks = [];
  let mempoolTxs = [];
  
  // Navigation history for back button
  let navHistory = [];
  let currentNavIndex = -1;
  
  // Proof validation state
  let proofInput = '';
  let txidInput = '';
  let proofResult = null;
  let proofLoading = false;
  let proofError = '';
  
  // Pagination state
  let currentPage = 0;
  let blocksPerPage = 10;
  let totalPages = 0;
  let paginationLoading = false;
  
  // Ring members toggle
  let showRingMembers = false;
  
  // New block notification
  let newBlockData = null;
  let showNewBlockBanner = false;
  
  // XSWD Live Block Stream (Phase 3)
  let xswdConnected = false;
  let liveBlockHeight = 0;
  let liveBlockUpdating = false;
  
  // Name resolution state
  let resolvedName = null;
  let nameResolving = false;
  
  // SC Variable Editor state
  let showVarEditor = false;
  let varKey = '';
  let varValue = '';
  let varType = 'string';  // 'string' or 'uint64'
  let varLoading = false;
  
  // Hex toggle: tracks which string var keys are currently showing raw hex instead of decoded text
  let hexViewKeys = {};
  function toggleHexView(key) { hexViewKeys[key] = !hexViewKeys[key]; hexViewKeys = hexViewKeys; }
  function getSCDisplayName(data, fallback = 'Smart Contract') {
    const stringkeys = data?.stringkeys || {};
    const rawName = stringkeys.nameHdr ?? stringkeys.var_header_name ?? stringkeys.dURL;
    if (rawName == null || rawName === '') return fallback;

    return formatSCDisplayValue(rawName).display || fallback;
  }
  
  // SC Discovery state
  let showSCDiscoveryModal = false;
  let discoveredSCs = [];
  let discoveringSCs = false;
  let scVariables = { stringkeys: {}, uint64keys: {} };
  
  // SC Interaction History state
  let scInteractions = [];
  let scInteractionsLoading = false;
  let scInteractionsCount = 0;
  let showInteractions = false;
  
  // Version History state (for TELA INDEXes)
  let showVersionHistory = false;
  let versionHistoryScid = '';
  
  // Time Machine state
  let showTimeMachine = false;
  let timeMachineSnapshots = [];
  let timeMachineLoading = false;
  let timeMachineCapturing = false;
  let selectedSnapshotIndex = 0;
  let selectedSnapshot = null;
  let compareMode = false;
  let compareFromIndex = 0;
  let compareToIndex = 0;
  let comparisonResult = null;
  let comparingSnapshots = false;
  
  // Watch List state
  let watchedSCs = [];
  let watchedSCsLoading = false;
  let isCurrentSCWatched = false;
  let watchingInProgress = false;
  
  // Change Timeline state
  let changeTimeline = [];
  let changeTimelineLoading = false;
  let showChangeTimeline = false;
  
  // Block miner attribution state (2B)
  let blockMinerAddress = '';
  
  // Address SCID cross-references state (2C)
  let addressSCIDRefs = [];
  
  // Landing view state (merged from Search.svelte)
  let recentSearches = [];
  let showHistoryModal = false;
  let omniSearchComponent;
  
  // Simulator detection
  let isSimulator = false;
  let simulatorChainHeight = 0;
  let simulatorLowChainBannerVisible = true;
  
  // DVM BASIC syntax highlighting
  function highlightDVMBasic(code) {
    if (!code) return '';
    
    // Escape HTML entities first
    let html = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Keywords (case insensitive for DVM BASIC)
    const keywords = [
      'Function', 'End Function', 'IF', 'THEN', 'ELSE', 'GOTO', 'RETURN',
      'DIM', 'LET', 'AS', 'Uint64', 'String', 'Blob'
    ];
    
    // Built-in functions
    const builtins = [
      'STORE', 'EXISTS', 'LOAD', 'DELETE', 'MAPEXISTS', 'MAPGET', 'MAPSTORE', 'MAPDELETE',
      'RANDOM', 'SCID', 'BLID', 'TXID', 'BLOCK_HEIGHT', 'BLOCK_TOPOHEIGHT',
      'SIGNER', 'IS_ADDRESS_VALID', 'ADDRESS_RAW', 'ADDRESS_STRING',
      'SEND_DERO_TO_ADDRESS', 'SEND_ASSET_TO_ADDRESS', 'DEROVALUE', 'ASSETVALUE',
      'UPDATE_SC_CODE', 'HEX', 'HEXDECODE', 'SHA256', 'SHA3256', 'KECCAK256',
      'STRLEN', 'SUBSTR', 'ATOI', 'ITOA', 'PANIC'
    ];
    
    // Highlight line numbers (10, 20, 30...)
    html = html.replace(/^(\s*)(\d+)(\s)/gm, '$1<span class="text-dim">$2</span>$3');
    
    // Highlight keywords
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
      html = html.replace(regex, '<span class="code-keyword">$1</span>');
    });
    
    // Highlight built-in functions  
    builtins.forEach(fn => {
      const regex = new RegExp(`\\b(${fn})\\s*\\(`, 'gi');
      html = html.replace(regex, '<span class="text-cyan-400">$1</span>(');
    });
    
    // Highlight strings
    html = html.replace(/"([^"\\]|\\.)*"/g, '<span class="code-string">$&</span>');
    
    // Highlight numbers (not already part of line numbers)
    html = html.replace(/(?<!<span class="text-dim">)\b(\d+)\b(?!<\/span>)/g, '<span class="text-amber-400">$1</span>');
    
    // Highlight comments (lines starting with // or REM)
    html = html.replace(/(\/\/.*$)/gm, '<span class="text-dim italic">$1</span>');
    html = html.replace(/^(\s*)(REM\s.*)$/gim, '$1<span class="text-dim italic">$2</span>');
    
    return html;
  }
  
  // Landing view functions (merged from Search.svelte)
  function handleFocusSearch() {
    omniSearchComponent?.focus();
  }
  
  function explorerNetwork() {
    return get(appState)?.network || 'mainnet';
  }
  
  function loadRecentSearches() {
    migrateLegacyExplorerSearchStorage();
    try {
      const key = recentSearchesKey(explorerNetwork());
      const stored = localStorage.getItem(key);
      if (stored) {
        recentSearches = JSON.parse(stored).slice(0, 5);
      } else {
        recentSearches = [];
      }
    } catch (e) {
      recentSearches = [];
    }
  }
  
  function saveRecentSearch(query, type) {
    const entry = { query, type, timestamp: Date.now() };
    recentSearches = [entry, ...recentSearches.filter(s => s.query !== query)].slice(0, 5);
    try {
      localStorage.setItem(recentSearchesKey(explorerNetwork()), JSON.stringify(recentSearches));
    } catch (e) {}
  }
  
  async function handleRecentClick(search) {
    searchQuery = search.query;
    showLanding = false;
    await performSearch(search.query, search.type, true);
  }
  
  function clearRecentSearches() {
    recentSearches = [];
    try {
      localStorage.removeItem(recentSearchesKey(explorerNetwork()));
    } catch (e) {}
  }
  
  // Reload recent searches when switching mainnet ↔ simulator (separate history per network)
  $: $appState.network, loadRecentSearches();
  
  async function handleHistorySelect(event) {
    const search = event.detail;
    searchQuery = search.query;
    showLanding = false;
    await performSearch(search.query, search.type, true);
  }
  
  function switchToTab(tab) {
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: tab }));
  }
  
  onMount(async () => {
    // Load recent searches for landing view
    loadRecentSearches();
    
    // Detect simulator mode
    try {
      const simResult = await IsInSimulatorMode();
      isSimulator = simResult === true;
    } catch (e) {
      isSimulator = false;
    }
    
    await loadRecentData(0);
    
    // Start block monitoring
    try {
      await StartBlockMonitoring();
    } catch (e) {
      console.warn('Could not start block monitoring:', e);
    }
    
    // Listen for new block events (from block monitoring)
    EventsOn('explorer:newBlock', (data) => {
      newBlockData = data;
      showNewBlockBanner = true;
      
      // Auto-refresh recent blocks when on first page
      if (currentPage === 0 && !searchResult) {
        loadRecentData(0);
      }
      
      // Hide banner after 5 seconds
      setTimeout(() => {
        showNewBlockBanner = false;
      }, 5000);
    });
    
    // XSWD Live Block Stream (Phase 3)
    // Subscribe to real-time block events via XSWD
    try {
      const xswdStatus = await GetXSWDStatus();
      xswdConnected = xswdStatus.connected;
      
      if (xswdConnected) {
        await SubscribeToBlockEvents();
        
        // Listen for XSWD topoheight events
        EventsOn('explorer:newTopoheight', (topoheight) => {
          liveBlockUpdating = true;
          liveBlockHeight = typeof topoheight === 'number' ? topoheight : parseInt(topoheight) || 0;
          
          // Flash the indicator
          setTimeout(() => {
            liveBlockUpdating = false;
          }, 500);
          
          // Auto-refresh on first page
          if (currentPage === 0 && !searchResult && activeSection === 'blocks') {
            loadRecentData(0);
          }
        });
      }
    } catch (e) {
      console.log('XSWD block subscription not available:', e);
    }
    
    // Listen for search results from Search landing page or cross-tab navigation
    const handleSearchResult = (e) => {
      const { type, query, result } = e.detail;
      if (result && result.success) {
        console.log('[Explorer] Received search result:', { type, query });
        searchQuery = query;
        searchResult = result;
        
        // Add to nav history
        navHistory = [...navHistory.slice(0, currentNavIndex + 1), { type, query }];
        currentNavIndex = navHistory.length - 1;
      } else if (query) {
        // No pre-fetched result (e.g. block/address search from Browser) - run the search
        searchQuery = query;
        showLanding = false;
        performSearch(query, type, true);
      }
    };
    window.addEventListener('search-result', handleSearchResult);
    
    // Listen for focus-search events (from ⌘K shortcut)
    window.addEventListener('focus-search', handleFocusSearch);
    
    return () => {
      window.removeEventListener('search-result', handleSearchResult);
      window.removeEventListener('focus-search', handleFocusSearch);
    };
  });
  
  onDestroy(() => {
    // Clean up event listeners
    EventsOff('explorer:newBlock');
    EventsOff('explorer:newTopoheight');
    
    // Stop monitoring when leaving
    StopBlockMonitoring().catch(() => {});
  });
  
  async function loadRecentData(page = 0) {
    paginationLoading = true;
    try {
      // Get current chain height
      const height = $appState.chainHeight || 0;
      if (height > 0) {
        // Calculate pagination
        totalPages = Math.ceil(height / blocksPerPage);
        currentPage = Math.max(0, Math.min(page, totalPages - 1));
        
        // Calculate start height for this page (descending order)
        const startHeight = height - (currentPage * blocksPerPage);
        
        const blocks = [];
        for (let i = 0; i < blocksPerPage && (startHeight - i) > 0; i++) {
          const h = startHeight - i;
          const res = await DaemonGetBlockHeaderByHeight(h);
          const header = res?.result?.block?.block_header || res?.result?.block_header;
          if (header) {
            // Get formatted age
            let age = '';
            if (header.timestamp) {
              try {
                const ageResult = await FormatBlockAge(header.timestamp);
                age = ageResult || '';
              } catch (e) {
                // Fallback to simple format
                const ms = header.timestamp > 1e12 ? header.timestamp : header.timestamp * 1000;
                const diff = Date.now() - ms;
                const mins = Math.floor(diff / 60000);
                age = mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
              }
            }
            
            blocks.push({
              height: h,
              hash: header.hash || header.block_hash || '',
              txCount: header.tx_count || 0,
              timestamp: header.timestamp || 0,
              age: age,
            });
          }
        }
        recentBlocks = blocks;
      }
      
      // Load mempool (only on first page)
      if (page === 0) {
        const poolRes = await DaemonGetTxPool();
        if (poolRes?.result?.txs) {
          mempoolTxs = poolRes.result.txs.slice(0, 20);
        }
      }
    } catch (error) {
      console.error('Failed to load explorer data:', error);
    } finally {
      paginationLoading = false;
    }
  }
  
  function goToPage(page) {
    if (page >= 0 && page < totalPages && !paginationLoading) {
      loadRecentData(page);
    }
  }
  
  function nextPage() {
    goToPage(currentPage + 1);
  }
  
  function prevPage() {
    goToPage(currentPage - 1);
  }
  
  // Mempool browser functions
  async function loadMempoolData() {
    mempoolLoading = true;
    try {
      const result = await GetMempoolExtended(100);
      if (result.success) {
        mempoolData = result;
      } else {
        console.error('Failed to load mempool:', result.error);
        mempoolData = null;
      }
    } catch (error) {
      console.error('Mempool load error:', error);
      mempoolData = null;
    } finally {
      mempoolLoading = false;
    }
  }
  
  // Navigation functions
  function goToHome() {
    searchResult = null;
    searchQuery = '';
    showLanding = true;
    activeSection = 'home';
  }
  
  function goToBlock(height) {
    searchQuery = String(height);
    search(true); // add to history
  }
  
  function goToPrevBlock() {
    if (searchResult?.type === 'block' && searchResult.data?.block_header?.height > 1) {
      goToBlock(searchResult.data.block_header.height - 1);
    }
  }
  
  function goToNextBlock() {
    if (searchResult?.type === 'block') {
      const currentHeight = searchResult.data?.block_header?.height || parseInt(searchQuery);
      if (currentHeight < $appState.chainHeight) {
        goToBlock(currentHeight + 1);
      }
    }
  }
  
  function goToTx(hash) {
    searchQuery = hash;
    search(true);
  }
  
  function goToSC(scid) {
    searchQuery = scid;
    search(true);
  }
  
  function goBack() {
    if (currentNavIndex > 0) {
      currentNavIndex--;
      const item = navHistory[currentNavIndex];
      searchQuery = item.query;
      search(false); // don't add to history
    } else {
      goToHome();
    }
  }

  /**
   * Handle OmniSearch search event
   */
  async function handleOmniSearch(event) {
    const { query, type } = event.detail;
    searchQuery = query;
    showLanding = false;
    await performSearch(query, type, true);
    // Save to recent searches
    if (searchResult) {
      saveRecentSearch(query, searchResult.type || type);
    }
  }
  
  /**
   * Discover random smart contracts
   */
  async function discoverActiveSCs() {
    discoveringSCs = true;
    try {
      const result = await GetRandomSmartContracts(10);
      if (result.success && result.contracts) {
        discoveredSCs = result.contracts;
        showSCDiscoveryModal = true;
      } else {
        toast.warning(result.error || 'Failed to discover contracts');
      }
    } catch (error) {
      toast.error('Failed to discover contracts: ' + error.message);
    } finally {
      discoveringSCs = false;
    }
  }
  
  /**
   * Fetch coinbase miner address for a given txid (2B)
   */
  async function fetchCoinbaseMiner(txid) {
    try {
      const result = await GetCoinbaseMiner(txid);
      if (result.success && result.isCoinbase && result.minerAddress) {
        return result.minerAddress;
      }
    } catch (e) { /* not coinbase */ }
    return null;
  }
  
  /**
   * Load SCID cross-references for an address (2C)
   */
  async function loadAddressSCIDRefs(address) {
    try {
      const result = await GetAddressSCIDReferences(address);
      if (result.success && result.references) {
        addressSCIDRefs = result.references;
      }
    } catch (e) { addressSCIDRefs = []; }
  }
  
  /**
   * Perform search using OmniSearch backend
   */
  async function performSearch(query, detectedType, addToHistory = true) {
    if (!query?.trim()) return;
    
    loading = true;
    searchResult = null;
    
    try {
      // Use the Go OmniSearch function
      const result = await OmniSearch(query);
      
      if (!result.success) {
        // 2A: If hash didn't resolve via OmniSearch, try as block hash
        const isHex64 = /^[a-fA-F0-9]{64}$/.test(query);
        if (isHex64) {
          try {
            const blockResult = await GetBlockByHash(query);
            if (blockResult.success && blockResult.block) {
              const bd = blockResult.block;
              searchResult = {
                type: 'block',
                data: bd,
                height: bd.height,
                topoheight: bd.topoheight,
                hash: bd.hash || query,
                tips: bd.tips || [],
                nonce: bd.nonce,
                depth: bd.depth,
                difficulty: bd.difficulty,
                miners: bd.miners || [],
                minerAddress: bd.miner_address,
                reward: bd.reward,
                totalFees: bd.total_fees,
                sizeKb: bd.size_kb,
                sizeBytes: bd.size_bytes,
                txCount: bd.tx_count,
                txHashes: bd.tx_hashes || [],
                txs: bd.txs || [],
                orphanStatus: bd.orphan_status,
                syncBlock: bd.sync_block,
                sideBlock: bd.side_block,
                timestamp: bd.timestamp,
                age: bd.age,
                blockTime: bd.block_time,
              };
              toast.info('Found block by hash', 2000);
              // Fetch miner for the block's coinbase TX
              if (searchResult.txHashes?.length > 0 && !searchResult.minerAddress) {
                fetchCoinbaseMiner(searchResult.txHashes[0]).then(addr => {
                  if (addr) { blockMinerAddress = addr; searchResult.minerAddress = addr; searchResult = searchResult; }
                });
              }
              if (addToHistory) {
                navHistory = navHistory.slice(0, currentNavIndex + 1);
                navHistory.push({ type: 'block', query });
                currentNavIndex = navHistory.length - 1;
              }
              loading = false;
              return;
            }
          } catch (e) { /* not a block hash either */ }
        }
        console.error('Search failed:', result.error);
        toast.error(result.error || 'Search failed. Please try again.');
        loading = false;
        searchResult = null; // Ensure no stale data is shown
        return;
      }
      
      // Show helpful message if provided (e.g., "This hash is a block hash")
      if (result.message) {
        toast.info(result.message, 3000);
      }
      
      // Validate that we have actual data before processing
      if (!result.data || Object.keys(result.data).length === 0) {
        console.error('Search returned empty data:', result);
        toast.error('Search returned no data. Please try again.');
        loading = false;
        searchResult = null;
        return;
      }
      
      // Process result based on type
      switch (result.type) {
        case 'block':
          // Enhanced block data from GetBlockExtended
          // Validate block data exists
          if (!result.data.height && !result.data.hash) {
            toast.error('Invalid block data received.');
            loading = false;
            searchResult = null;
            return;
          }
          searchResult = {
            type: 'block',
            data: result.data,
            height: result.data.height || parseInt(query),
            // New enhanced fields
            topoheight: result.data.topoheight,
            hash: result.data.hash,
            tips: result.data.tips || [],
            nonce: result.data.nonce,
            depth: result.data.depth,
            difficulty: result.data.difficulty,
            miners: result.data.miners || [],
            minerAddress: result.data.miner_address,
            reward: result.data.reward,
            totalFees: result.data.total_fees,
            sizeKb: result.data.size_kb,
            sizeBytes: result.data.size_bytes,
            txCount: result.data.tx_count,
            txHashes: result.data.tx_hashes || [],
            txs: result.data.txs || [],
            orphanStatus: result.data.orphan_status,
            syncBlock: result.data.sync_block,
            sideBlock: result.data.side_block,
            timestamp: result.data.timestamp,
            age: result.data.age,
            blockTime: result.data.block_time,
          };
          // 2B: Fetch miner attribution from coinbase TX if not already present
          blockMinerAddress = '';
          if (searchResult.txHashes?.length > 0 && !searchResult.minerAddress) {
            fetchCoinbaseMiner(searchResult.txHashes[0]).then(addr => {
              if (addr) { blockMinerAddress = addr; searchResult.minerAddress = addr; searchResult = searchResult; }
            });
          }
          break;
          
        case 'tx':
          const txData = result.data;
          // Validate transaction data exists - prevent showing empty TX data
          if (!txData.tx && !txData.txid && !txData.hex) {
            toast.error('Transaction not found or invalid transaction data.');
            loading = false;
            searchResult = null;
            return;
          }
          // Auto-pivot: SC deployment TXs share TXID == SCID — load as smart contract directly
          if (txData.tx_type === 'SC' || txData.txType === 'SC') {
            loading = false;
            toast.info('This is a smart contract deployment — loading contract…', 2000);
            await searchSCDirectly(query);
            return;
          }
          searchResult = {
            type: 'tx',
            data: txData.tx || txData,
            // Enhanced TX fields
            ringMembers: txData.rings || txData.ringMembers || [],
            assets: txData.assets || [],
            isCoinbase: txData.is_coinbase || txData.isCoinbase || false,
            minerAddress: txData.miner_address || txData.minerAddress || null,
            txType: txData.tx_type || txData.txType || null,
            signer: txData.signer,
            validBlock: txData.valid_block,
            invalidBlocks: txData.invalid_blocks || [],
            sizeKb: txData.size_kb,
            sizeBytes: txData.size_bytes,
            hex: txData.hex,
            age: txData.age,
            blockTime: txData.block_time,
            heightBuilt: txData.height_built,
            blid: txData.blid,
            rootHash: txData.root_hash,
            burnValue: txData.burn_value,
            scArgs: txData.sc_args,
            scCode: txData.sc_code,
          };
          break;
          
        case 'sc':    // Backend returns 'sc' for smart contracts
        case 'scid':  // Also handle 'scid' for backwards compatibility
          searchResult = {
            type: 'sc',
            data: result.data,
          };
          // Load interaction history in background
          loadSCInteractions(query);
          break;
          
        case 'address':
          searchResult = {
            type: 'address',
            data: result.data,
            address: query,
          };
          // 2C: Load SCID cross-references for this address
          addressSCIDRefs = [];
          loadAddressSCIDRefs(query);
          break;
          
        case 'durl':
          // Navigate to Browser tab with the dURL
          const durl = result.data?.durl || (query.toLowerCase().startsWith('dero://') ? query : `dero://${query}`);
          const appName = result.data?.name || query.replace(/^dero:\/\//i, '');
          const wasValidated = result.data?.validated === true;
          
          saveRecentSearch(query, 'durl');
          
          // Show appropriate toast feedback
          if (wasValidated) {
            toast.success(`Opening ${appName}`, 2000);
          } else {
            toast.info(`Navigating to ${appName}...`, 2000);
          }
          
          // Use pendingNavigation store (Browser subscribes to this)
          // This avoids race condition where event fires before Browser mounts
          navigateTo(durl);
          
          // Switch to Browser tab
          window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'browser' }));
          
          // Reset Explorer state since we're navigating away
          loading = false;
          goToHome();
          return; // Exit early - don't set searchResult
          
        case 'key':
          // Search by key - returns SCIDs containing this key
          searchResult = {
            type: 'key',
            data: result.data,
            searchKey: result.data?.key || query.replace(/^key:/i, '').trim(),
            results: result.data?.results || [],
            count: result.data?.count || 0,
          };
          break;
          
        case 'value':
          // Search by value - returns SCIDs containing this value
          searchResult = {
            type: 'value',
            data: result.data,
            searchValue: result.data?.value || query.replace(/^value:/i, '').trim(),
            results: result.data?.results || [],
            count: result.data?.count || 0,
          };
          break;
          
        case 'code':
          // Search by code line - returns SCIDs with matching code
          searchResult = {
            type: 'code',
            data: result.data,
            searchLine: result.data?.line || query.replace(/^(code:|line:)/i, '').trim(),
            results: result.data?.results || [],
            count: result.data?.count || 0,
          };
          break;
          
        default:
          console.warn('Unknown search result type:', result.type);
      }
      
      // Add to navigation history
      if (addToHistory && searchResult) {
        navHistory = navHistory.slice(0, currentNavIndex + 1);
        navHistory.push({ type: result.type, query });
        currentNavIndex = navHistory.length - 1;
      }
      
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      loading = false;
    }
  }
  
  /**
   * Legacy search function for internal navigation (goToBlock, goToTx, etc.)
   */
  async function search(addToHistory = true) {
    // Detect type from query and perform search
    const query = searchQuery.trim();
    if (!query) return;
    
    // Simple type detection for internal calls
    let type = 'unknown';
    if (/^\d+$/.test(query)) type = 'block';
    else if (/^[a-fA-F0-9]{64}$/.test(query)) type = 'hash';
    else if (query.toLowerCase().startsWith('dero1')) type = 'address';
    else if (query.toLowerCase().startsWith('dero://')) type = 'durl';
    
    await performSearch(query, type, addToHistory);
  }
  
  /**
   * Direct SC search - bypasses TX-first lookup to ensure SC code is fetched
   * Use this from the Smart Contracts section for guaranteed SC results
   */
  async function searchSCDirectly(scid) {
    if (!scid?.trim()) return;
    
    const query = scid.trim();
    if (!/^[a-fA-F0-9]{64}$/.test(query)) {
      toast.error('Invalid SCID format - must be 64 hex characters');
      return;
    }
    
    loading = true;
    searchResult = null;
    searchQuery = query;
    
    try {
      const response = await DaemonGetSC(query);
      
      if (!response.success) {
        toast.error(response.error || 'Smart contract not found');
        loading = false;
        return;
      }
      
      // DaemonGetSC returns { success: true, result: { code, balance, stringkeys, uint64keys } }
      const scData = response.result || {};
      
      // Set result as SC type directly
      searchResult = {
        type: 'sc',
        data: {
          code: scData.code || '',
          balance: scData.balance || 0,
          stringkeys: scData.stringkeys || {},
          uint64keys: scData.uint64keys || {},
        },
      };
      
      // Log for debugging
      console.log('SC loaded:', { 
        hasCode: !!scData.code, 
        codeLength: scData.code?.length || 0,
        stringKeysCount: Object.keys(scData.stringkeys || {}).length,
        uint64KeysCount: Object.keys(scData.uint64keys || {}).length
      });
      
      // Load interaction history in background
      loadSCInteractions(query);
      
      // Add to navigation history
      navHistory = navHistory.slice(0, currentNavIndex + 1);
      navHistory.push({ type: 'sc', query });
      currentNavIndex = navHistory.length - 1;
      
    } catch (error) {
      console.error('SC search error:', error);
      toast.error('Failed to load smart contract');
    } finally {
      loading = false;
    }
  }
  
  /**
   * View a hash as a Transaction (bypasses SC-first lookup)
   * Used when viewing an SC that is also a deployment TX
   */
  async function viewAsTransaction(txid) {
    if (!txid?.trim()) return;
    
    loading = true;
    searchResult = null;
    
    try {
      const response = await GetTransactionExtended(txid.trim());
      
      if (!response || response.error) {
        toast.error(response?.error || 'Transaction not found');
        loading = false;
        return;
      }
      
      // Map all fields the template expects from the backend response
      searchResult = {
        type: 'tx',
        data: response,
        hex: response.hex || '',
        // Extract fields used by the template
        txType: response.tx_type || 'NORMAL',
        isCoinbase: response.is_coinbase || false,
        ringMembers: response.rings || [],
        sizeKb: response.size_kb || '0',
        assets: response.assets || [],
        burnValue: response.burn_value || 0,
        minerAddress: response.miner_address || null,
      };
      
      // Add to navigation history
      navHistory = navHistory.slice(0, currentNavIndex + 1);
      navHistory.push({ type: 'tx', query: txid.trim() });
      currentNavIndex = navHistory.length - 1;
      
    } catch (error) {
      console.error('TX search error:', error);
      toast.error('Failed to load transaction');
    } finally {
      loading = false;
    }
  }
  
  function formatHash(hash) {
    if (!hash) return '—';
    return hash.slice(0, 8) + '...' + hash.slice(-6);
  }
  
  function formatTimestamp(ts) {
    if (!ts) return '—';
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleString();
  }
  
  function handleKeydown(event) {
    if (event.key === 'Enter') {
      search();
    }
  }
  
  // Proof validation
  async function validateProof() {
    if (!proofInput.trim()) {
      proofError = 'Please enter a proof string (deroproof1q...)';
      return;
    }
    if (!txidInput.trim()) {
      proofError = 'Please enter the transaction ID to validate against';
      return;
    }
    
    proofLoading = true;
    proofError = '';
    proofResult = null;
    
    try {
      const result = await ValidateProofFull(proofInput.trim(), txidInput.trim());
      
      if (result.success) {
        if (result.valid) {
          proofResult = {
            valid: true,
            addresses: result.addresses || [],
            amounts: result.amountsFormatted || [],
            payloads: result.payloadDecoded || [],
            txid: result.txid,
            warnings: result.warnings || [],
            supplyContexts: result.supplyContexts || [],
            percentOfSupply: result.percentOfSupply || [],
          };
        } else {
          proofResult = {
            valid: false,
            error: result.error || 'Proof validation failed',
            securityNote: result.securityNote || null,
          };
        }
      } else {
        proofError = result.error || 'Failed to validate proof';
      }
    } catch (error) {
      console.error('Proof validation error:', error);
      proofError = error.message || 'An error occurred during validation';
    } finally {
      proofLoading = false;
    }
  }
  
  function clearProofResult() {
    proofResult = null;
    proofError = '';
  }
  
  // SC Variable Editor functions
  async function loadSCVariables(scid) {
    try {
      const result = await GetSCVariables(scid);
      if (result.success) {
        scVariables = {
          stringkeys: result.stringkeys || {},
          uint64keys: result.uint64keys || {}
        };
      }
    } catch (e) {
      console.error('Failed to load SC variables:', e);
    }
  }
  
  async function handleSetVar() {
    if (!searchQuery || !varKey.trim()) {
      toast.warning('Please enter a variable key');
      return;
    }
    
    if (!$walletState.isOpen) {
      toast.warning('Please connect a wallet first');
      return;
    }
    
    varLoading = true;
    try {
      // Value is always passed as string - backend handles conversion
      const result = await SetVar(searchQuery, varKey.trim(), varValue);
      
      if (result.success) {
        toast.success(`Variable "${varKey}" set successfully`);
        varKey = '';
        varValue = '';
        // Refresh variables
        await loadSCVariables(searchQuery);
      } else {
        toast.error(result.error || 'Failed to set variable');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to set variable');
    } finally {
      varLoading = false;
    }
  }
  
  async function handleDeleteVar(key) {
    if (!searchQuery || !key) return;
    
    if (!$walletState.isOpen) {
      toast.warning('Please connect a wallet first');
      return;
    }
    
    varLoading = true;
    try {
      const result = await DeleteVar(searchQuery, key);
      
      if (result.success) {
        toast.success(`Variable "${key}" deleted`);
        // Refresh variables
        await loadSCVariables(searchQuery);
      } else {
        toast.error(result.error || 'Failed to delete variable');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to delete variable');
    } finally {
      varLoading = false;
    }
  }
  
  // Load SC interaction history
  async function loadSCInteractions(scid) {
    scInteractionsLoading = true;
    scInteractions = [];
    scInteractionsCount = 0;
    
    try {
      const result = await GetSCInteractionHistory(scid);
      if (result.success) {
        scInteractions = result.interactions || [];
        scInteractionsCount = result.count || 0;
      }
    } catch (e) {
      console.error('Failed to load SC interactions:', e);
    } finally {
      scInteractionsLoading = false;
    }
  }
  
  // Version History functions
  function openVersionHistory(scid) {
    versionHistoryScid = scid;
    showVersionHistory = true;
  }
  
  function closeVersionHistory() {
    showVersionHistory = false;
  }
  
  function handleVersionRevert(event) {
    // Navigate to Studio Actions with the SCID
    navigateTo(versionHistoryScid);
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'studio' }));
    showVersionHistory = false;
  }
  
  function handleVersionClone(event) {
    const commit = event.detail;
    // Navigate to Studio Clone with the version
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'studio' }));
    showVersionHistory = false;
  }
  
  // Time Machine functions
  async function loadTimeMachineHistory(scid) {
    timeMachineLoading = true;
    timeMachineSnapshots = [];
    selectedSnapshot = null;
    selectedSnapshotIndex = 0;
    comparisonResult = null;
    
    try {
      const result = await GetSCStateHistory(scid);
      if (result.success && result.history) {
        timeMachineSnapshots = result.history;
        if (timeMachineSnapshots.length > 0) {
          selectedSnapshotIndex = timeMachineSnapshots.length - 1;
          selectedSnapshot = timeMachineSnapshots[selectedSnapshotIndex];
        }
      }
    } catch (e) {
      console.error('Failed to load Time Machine history:', e);
    } finally {
      timeMachineLoading = false;
    }
  }
  
  async function captureSnapshot(scid) {
    timeMachineCapturing = true;
    try {
      const result = await CaptureSCState(scid);
      if (result.success) {
        toast.success(`Snapshot captured at height ${result.snapshot?.height || 'current'}`);
        // Reload history to include new snapshot
        await loadTimeMachineHistory(scid);
      } else {
        toast.error(result.error || 'Failed to capture snapshot');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to capture snapshot');
    } finally {
      timeMachineCapturing = false;
    }
  }
  
  function handleSliderChange(index) {
    selectedSnapshotIndex = index;
    selectedSnapshot = timeMachineSnapshots[index];
    comparisonResult = null;
  }
  
  async function compareSnapshots() {
    if (timeMachineSnapshots.length < 2) {
      toast.warning('Need at least 2 snapshots to compare');
      return;
    }
    
    comparingSnapshots = true;
    comparisonResult = null;
    
    try {
      const fromHeight = timeMachineSnapshots[compareFromIndex].height;
      const toHeight = timeMachineSnapshots[compareToIndex].height;
      
      const result = await CompareSCStateAtHeights(searchQuery, fromHeight, toHeight);
      if (result.success) {
        comparisonResult = result.diff;
      } else {
        toast.error(result.error || 'Failed to compare snapshots');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to compare snapshots');
    } finally {
      comparingSnapshots = false;
    }
  }
  
  function formatSnapshotTime(snapshot) {
    if (!snapshot?.captured_at) return 'Unknown';
    const date = new Date(snapshot.captured_at);
    return date.toLocaleString();
  }
  
  // Watch List functions
  async function loadWatchedSCs() {
    watchedSCsLoading = true;
    try {
      const result = await GetWatchedSmartContracts();
      if (result.success) {
        watchedSCs = result.watched || [];
        // Check if current SC is watched
        if (searchQuery) {
          isCurrentSCWatched = watchedSCs.some(w => w.scid === searchQuery);
        }
      }
    } catch (e) {
      console.error('Failed to load watched SCs:', e);
    } finally {
      watchedSCsLoading = false;
    }
  }
  
  async function watchCurrentSC() {
    if (!searchQuery || watchingInProgress) return;
    
    watchingInProgress = true;
    try {
      const scName = getSCDisplayName(searchResult?.data, searchQuery.substring(0, 16));
      const result = await WatchSmartContract(searchQuery, scName);
      if (result.success) {
        toast.success('Now watching this smart contract');
        isCurrentSCWatched = true;
        await loadWatchedSCs();
        // Reload history since watching captures initial state
        await loadTimeMachineHistory(searchQuery);
      } else {
        toast.error(result.error || 'Failed to watch SC');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to watch SC');
    } finally {
      watchingInProgress = false;
    }
  }
  
  async function unwatchCurrentSC() {
    if (!searchQuery || watchingInProgress) return;
    
    watchingInProgress = true;
    try {
      const result = await UnwatchSmartContract(searchQuery);
      if (result.success) {
        toast.success('Stopped watching this smart contract');
        isCurrentSCWatched = false;
        await loadWatchedSCs();
      } else {
        toast.error(result.error || 'Failed to unwatch SC');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to unwatch SC');
    } finally {
      watchingInProgress = false;
    }
  }
  
  async function unwatchSC(scid) {
    try {
      const result = await UnwatchSmartContract(scid);
      if (result.success) {
        toast.success('Stopped watching');
        await loadWatchedSCs();
      }
    } catch (e) {
      toast.error('Failed to unwatch');
    }
  }
  
  async function refreshWatched() {
    try {
      const result = await RefreshWatchedSCs();
      if (result.success) {
        if (result.changes_detected > 0) {
          toast.success(`${result.changes_detected} SC(s) have changed`);
        } else {
          toast.info('No changes detected');
        }
        await loadWatchedSCs();
        // Reload current SC history if it's being watched
        if (isCurrentSCWatched && searchQuery) {
          await loadTimeMachineHistory(searchQuery);
        }
      }
    } catch (e) {
      toast.error('Failed to refresh watched SCs');
    }
  }
  
  // Change Timeline functions
  async function loadChangeTimeline(scid) {
    changeTimelineLoading = true;
    changeTimeline = [];
    try {
      const result = await GetSCChangeTimeline(scid);
      if (result.success) {
        changeTimeline = result.timeline || [];
      }
    } catch (e) {
      console.error('Failed to load change timeline:', e);
    } finally {
      changeTimelineLoading = false;
    }
  }
  
  function formatChangeTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
  
  // Check if SC is a TELA INDEX (has DOC1 variable)
  function isTELAIndex(data) {
    if (!data?.stringkeys) return false;
    return Object.keys(data.stringkeys).some(key => key.startsWith('DOC') || key === 'dURL');
  }
  
  // Format timestamp for interactions
  function formatInteractionTime(ts) {
    if (!ts) return '';
    const ms = ts > 1e12 ? ts : ts * 1000;
    const date = new Date(ms);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }
  
  // Calculate activity chart data (simple bar chart)
  $: activityBars = (() => {
    if (scInteractions.length === 0) return [];
    
    // Group interactions by relative time periods
    const now = Date.now();
    const periods = [
      { label: '24h', max: 86400000 },
      { label: '7d', max: 604800000 },
      { label: '30d', max: 2592000000 },
      { label: 'older', max: Infinity }
    ];
    
    const counts = periods.map(p => ({ label: p.label, count: 0 }));
    
    for (const interaction of scInteractions) {
      if (!interaction.timestamp) continue;
      const ts = interaction.timestamp > 1e12 ? interaction.timestamp : interaction.timestamp * 1000;
      const age = now - ts;
      
      for (let i = 0; i < periods.length; i++) {
        if (age < periods[i].max) {
          counts[i].count++;
          break;
        }
      }
    }
    
    const maxCount = Math.max(...counts.map(c => c.count), 1);
    return counts.map(c => ({
      ...c,
      height: (c.count / maxCount) * 100
    }));
  })();
  
  // Auto-check watch status when viewing an SC
  $: if (searchResult?.type === 'sc' && searchQuery) {
    loadWatchedSCs();
  }
</script>

<!-- v6.2 Unified Explorer - Landing View + Search Results + Validator -->
{#if showLanding && !searchResult && activeSection === 'home'}
  <!-- Landing View (merged from Search.svelte) -->
  <div class="explorer-landing">
    <!-- v6.1 Background gradient -->
    <div class="bg-gradient"></div>
    
    <!-- Main content -->
    <div class="landing-content">
      <!-- v6.1 Logo & Branding -->
      <div class="landing-branding">
        <Wordmark size="lg" glow={true} />
        <p class="landing-tagline">Explore the DERO Decentralized Web</p>
      </div>
      
      <!-- v6.1 Search Section -->
      <div class="landing-search-section">
        <OmniSearchComponent
          bind:this={omniSearchComponent}
          bind:value={searchQuery}
          {loading}
          placeholder="Search blocks, transactions, smart contracts, addresses..."
          autofocus={true}
          on:search={handleOmniSearch}
        />
      </div>
      
      <!-- v6.1 Recent Searches -->
      {#if recentSearches.length > 0}
        <div class="landing-recent-section">
          <div class="landing-recent-header">
            <span class="landing-recent-title">RECENT SEARCHES</span>
            <div class="landing-recent-actions">
              <button class="landing-link-btn" on:click={() => showHistoryModal = true}>
                View All
              </button>
              <button class="landing-text-btn" on:click={clearRecentSearches}>Clear</button>
            </div>
          </div>
          <div class="landing-recent-list">
            {#each recentSearches as search}
              <button class="landing-recent-item" on:click={() => handleRecentClick(search)}>
                <span class="landing-recent-icon">
                  {#if search.type === 'block'}<Package size={12} strokeWidth={1.5} />
                  {:else if search.type === 'tx'}<Zap size={12} strokeWidth={1.5} />
                  {:else if search.type === 'scid' || search.type === 'hash'}<FileText size={12} strokeWidth={1.5} />
                  {:else if search.type === 'durl'}<Globe size={12} strokeWidth={1.5} />
                  {:else if search.type === 'address'}<User size={12} strokeWidth={1.5} />
                  {:else}<Link size={12} strokeWidth={1.5} />{/if}
                </span>
                <span class="landing-recent-query">{search.query.length > 20 ? search.query.slice(0, 10) + '...' + search.query.slice(-10) : search.query}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      
      <!-- Search History Modal -->
      <SearchHistory 
        bind:isOpen={showHistoryModal}
        on:select={handleHistorySelect}
      />
      
      <!-- v6.2 Footer Section -->
      <div class="landing-footer">
        <div class="landing-shortcut-hint">
          <kbd>⌘K</kbd> to search from anywhere
        </div>
        
        <div class="landing-network-status">
          <div class="landing-status-item">
            <DotIndicator status={$appState.nodeConnected ? 'ok' : 'err'} />
            <span class="landing-status-label">Node {$appState.nodeConnected ? 'Online' : 'Offline'}</span>
          </div>
          {#if $appState.chainHeight}
            <div class="landing-status-item">
              <Package size={12} strokeWidth={1.5} class="landing-status-icon" />
              <span class="landing-status-label">
                {#if isSimulator && $appState.chainHeight < 20}
                  Simulator Block #{$appState.chainHeight.toLocaleString()} (fresh chain)
                {:else}
                  Block #{$appState.chainHeight.toLocaleString()}
                {/if}
              </span>
            </div>
          {/if}
          {#if isSimulator}
            <div class="landing-status-item landing-status-simulator">
              <AlertTriangle size={12} strokeWidth={1.5} class="landing-status-icon" />
              <span class="landing-status-label">Simulator Mode</span>
            </div>
          {/if}
        </div>
      </div>
      
    </div>
  </div>
{:else}
  <!-- Standard Explorer Layout (Search Results + Validator) -->
<div class="page-layout">
  <!-- v5.6 Page Header with Search -->
  <div class="page-header">
    <div class="page-header-inner">
      <div class="page-header-left">
        <h1 class="page-header-title">
          <Search size={18} class="page-header-icon" />
          Explorer
        </h1>
        <p class="page-header-desc">Browse blocks, transactions, and smart contracts</p>
      </div>
      <div class="page-header-actions">
        <div class="explorer-search-wrapper">
      <OmniSearchComponent
              bind:this={omniSearchComponent}
        bind:value={searchQuery}
        {loading}
        compact={true}
        on:search={handleOmniSearch}
              on:clear={goToHome}
      />
        </div>
      </div>
    </div>
  </div>
  
  <!-- Simulator Mode Banner -->
  {#if isSimulator}
  <div class="simulator-banner">
    <div class="simulator-banner-inner">
      <AlertTriangle size={14} strokeWidth={1.5} class="simulator-banner-icon" />
      <div class="simulator-banner-text">
        <strong>Simulator Mode</strong> — Blockchain is ephemeral and resets on restart.
        {#if $appState.chainHeight > 0}
          Current height: <strong>#{$appState.chainHeight.toLocaleString()}</strong>.
        {/if}
        {#if $appState.chainHeight < 20}
          Chain is still initializing — this is normal.
        {/if}
      </div>
    </div>
  </div>
  
  <!-- Fresh Simulator Chain Banner (shown when chain height is very low) -->
  {#if $appState.chainHeight > 0 && $appState.chainHeight < 20 && simulatorLowChainBannerVisible}
  <div class="simulator-fresh-chain-banner">
    <div class="simulator-fresh-chain-inner">
      <div class="simulator-fresh-chain-icon">
        <Loader2 size={14} strokeWidth={1.5} class="simulator-fresh-chain-spinner" />
      </div>
      <div class="simulator-fresh-chain-text">
        <strong>Fresh Simulator Chain</strong> — Block #{$appState.chainHeight.toLocaleString()} of a new ephemeral chain.
        Gnomon is indexing — the explorer will populate as blocks are mined.
      </div>
      <button class="simulator-fresh-chain-dismiss" on:click={() => simulatorLowChainBannerVisible = false}>
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  </div>
  {/if}
  {/if}
  
    <!-- v6.2 Unified Page Body (Simplified Sidebar) -->
  <div class="page-body">
    <!-- Sidebar -->
    <div class="page-sidebar">
        <div class="page-sidebar-section">TOOLS</div>
      <nav class="page-sidebar-nav">
        {#each sidebarSections.tools as item}
          <button
              on:click={() => { activeSection = item.id; searchResult = null; showLanding = false; }}
            class="page-sidebar-item"
            class:active={activeSection === item.id && !searchResult}
          >
            <span class="page-sidebar-item-icon">
              <svelte:component this={item.icon} size={14} />
            </span>
            <span class="page-sidebar-item-label">{item.label}</span>
          </button>
        {/each}
      </nav>
      
      <!-- Search Result Indicator -->
      {#if searchResult}
        <div class="page-sidebar-section" style="margin-top: var(--s-5);">RESULT</div>
        <nav class="page-sidebar-nav">
          <button class="page-sidebar-item active">
            <span class="page-sidebar-item-icon">
              {#if searchResult.type === 'block'}<Package size={14} />
              {:else if searchResult.type === 'tx'}<FileText size={14} />
              {:else if searchResult.type === 'address'}<User size={14} />
              {:else if searchResult.type === 'key'}<Key size={14} />
              {:else if searchResult.type === 'value'}<Database size={14} />
              {:else if searchResult.type === 'code'}<Code size={14} />
              {:else}<FileCode size={14} />{/if}
            </span>
            <span class="page-sidebar-item-label">
              {#if searchResult.type === 'block'}Block
              {:else if searchResult.type === 'tx'}Transaction
              {:else if searchResult.type === 'address'}Address
              {:else if searchResult.type === 'key'}Key Search
              {:else if searchResult.type === 'value'}Value Search
              {:else if searchResult.type === 'code'}Code Search
              {:else}Smart Contract{/if}
            </span>
          </button>
        </nav>
      {/if}
    </div>
    
    <!-- Content Area -->
    <div class="page-content">
    {#if searchResult}
      <!-- Search Result -->
      <div class="explorer-content-inner">
        <!-- v6.2 Navigation Bar - Design System Compliant -->
        <div class="nav-bar">
          <!-- Back/Home Group -->
          <div class="nav-group">
            <button
              on:click={goBack}
              disabled={currentNavIndex <= 0}
              class="nav-group-btn"
              title="Go Back"
            >
              <ArrowLeft size={14} strokeWidth={1.5} />
              <span>Back</span>
            </button>
            <button
              on:click={goToHome}
              class="nav-group-btn"
              title="Go to Home"
            >
              <Home size={14} strokeWidth={1.5} />
              <span>Home</span>
            </button>
          </div>
          
          {#if searchResult.type === 'block'}
            <!-- Block Navigation Group -->
            <div class="nav-group block-nav">
              <button
                on:click={goToPrevBlock}
                disabled={searchResult.data?.block_header?.height <= 1}
                class="nav-group-btn"
              >
                <ChevronLeft size={14} strokeWidth={1.5} />
                Prev
              </button>
              <span class="block-nav-current">
                #{(searchResult.data?.block_header?.height || searchQuery).toLocaleString()}
              </span>
              <button
                on:click={goToNextBlock}
                disabled={(searchResult.data?.block_header?.height || 0) >= $appState.chainHeight}
                class="nav-group-btn"
              >
                Next
                <ChevronRight size={14} strokeWidth={1.5} />
              </button>
            </div>
          {/if}
          
          <div class="nav-spacer"></div>
          
          <!-- Result Type Badge -->
          <span class="nav-type-badge" class:nav-type-block={searchResult.type === 'block'} class:nav-type-tx={searchResult.type === 'tx'} class:nav-type-sc={searchResult.type === 'sc' || searchResult.type === 'scid'} class:nav-type-address={searchResult.type === 'address'} class:nav-type-key={searchResult.type === 'key'} class:nav-type-value={searchResult.type === 'value'} class:nav-type-code={searchResult.type === 'code'}>
            {#if searchResult.type === 'block'}
              BLOCK
            {:else if searchResult.type === 'tx'}
              TX
            {:else if searchResult.type === 'sc' || searchResult.type === 'scid'}
              SC
            {:else if searchResult.type === 'address'}
              ADDRESS
            {:else if searchResult.type === 'key'}
              KEY
            {:else if searchResult.type === 'value'}
              VALUE
            {:else if searchResult.type === 'code'}
              CODE
            {:else}
              RESULT
            {/if}
          </span>
          
          <button
            on:click={goToHome}
            class="nav-close"
            title="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        
        <!-- v6.1 Search Result Container -->
        <div class="cmd-result-container">
          {#if searchResult.type === 'block'}
            <!-- Enhanced Block Details Module -->
            <div class="cmd-stats-panel">
              <!-- Module Header -->
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  BLOCK DETAILS
                </div>
                <div class="cmd-panel-meta">
                  {#if searchResult.orphanStatus}
                    <span class="cmd-badge cmd-badge-warn">ORPHAN</span>
                  {/if}
                  {#if searchResult.syncBlock}
                    <span class="cmd-badge cmd-badge-info">SYNC</span>
                  {/if}
                  {#if searchResult.sideBlock}
                    <span class="cmd-badge cmd-badge-dim">SIDE</span>
                  {/if}
                  <span class="cmd-timestamp">{searchResult.blockTime || formatTimestamp(searchResult.timestamp)}</span>
                </div>
              </div>
              
              <!-- Block Stats Grid - Enhanced 6-column -->
              <div class="cmd-stats-unified cmd-stats-6col">
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◎</div>
                  <div class="cmd-stat-value">#{(searchResult.height || searchQuery).toLocaleString()}</div>
                  <div class="cmd-stat-label">BLOCK HEIGHT</div>
                </div>
                
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">▲</div>
                  <div class="cmd-stat-value">#{(searchResult.topoheight || 0).toLocaleString()}</div>
                  <div class="cmd-stat-label">TOPO HEIGHT</div>
                </div>
                
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">☰</div>
                  <div class="cmd-stat-value">{searchResult.txCount || 0}</div>
                  <div class="cmd-stat-label">TRANSACTIONS</div>
                </div>
                
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◆</div>
                  <div class="cmd-stat-value">{searchResult.reward ? (searchResult.reward / 100000).toFixed(5) : '0'}</div>
                  <div class="cmd-stat-label">BLOCK REWARD</div>
                </div>
                
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon"><Zap size={14} strokeWidth={1.5} /></div>
                  <div class="cmd-stat-value">{searchResult.totalFees ? (searchResult.totalFees / 100000).toFixed(5) : '0'}</div>
                  <div class="cmd-stat-label">TOTAL FEES</div>
                </div>
                
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">■</div>
                  <div class="cmd-stat-value">{searchResult.sizeKb || '0'} KB</div>
                  <div class="cmd-stat-label">BLOCK SIZE</div>
                </div>
              </div>
            </div>
            
            <!-- Block Hash Module -->
            <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">⬢</span>
                  BLOCK HASH
                </div>
                <button 
                  on:click={() => navigator.clipboard.writeText(searchResult.hash)}
                  class="cmd-copy-btn"
                >
                  <Copy size={12} strokeWidth={1.5} />
                  Copy
                </button>
              </div>
              <div class="cmd-hash-content">
                <span class="cmd-hash-value">{searchResult.hash || '—'}</span>
              </div>
            </div>
            
            <!-- Block Metadata Module (NEW) -->
            <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">⬢</span>
                  BLOCK METADATA
                </div>
              </div>
              <div class="cmd-metadata-grid">
                <!-- Miner Address -->
                {#if searchResult.minerAddress}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><Pickaxe size={12} strokeWidth={1.5} /> Miner</span>
                    <button 
                      class="cmd-metadata-value cmd-clickable"
                      on:click={() => { searchQuery = searchResult.minerAddress; search(true); }}
                      title="Search this address"
                    >
                      {formatHash(searchResult.minerAddress)}
                    </button>
                    <button 
                      class="cmd-copy-btn-mini"
                      on:click={() => navigator.clipboard.writeText(searchResult.minerAddress)}
                      title="Copy address"
                    >
                      <Copy size={10} strokeWidth={1.5} />
                    </button>
                  </div>
                {/if}
                
                <!-- Tips (Parent Blocks) -->
                {#if searchResult.tips?.length > 0}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><Layers size={12} strokeWidth={1.5} /> Tips ({searchResult.tips.length})</span>
                    <div class="cmd-tips-list">
                      {#each searchResult.tips as tip, i}
                        <button 
                          class="cmd-tip-hash"
                          on:click={() => { searchQuery = tip; search(true); }}
                          title="View parent block"
                        >
                          {formatHash(tip)}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                
                <!-- Nonce -->
                <div class="cmd-metadata-row">
                  <span class="cmd-metadata-label">Nonce</span>
                  <span class="cmd-metadata-value mono">{searchResult.nonce || 0}</span>
                </div>
                
                <!-- Difficulty -->
                <div class="cmd-metadata-row">
                  <span class="cmd-metadata-label">Difficulty</span>
                  <span class="cmd-metadata-value mono">{searchResult.difficulty || '—'}</span>
                </div>
                
                <!-- Confirmations (Depth) -->
                <div class="cmd-metadata-row">
                  <span class="cmd-metadata-label"><CheckCircle size={12} strokeWidth={1.5} /> Confirmations</span>
                  <span class="cmd-metadata-value">{searchResult.depth || 0} blocks</span>
                </div>
                
                <!-- Age -->
                {#if searchResult.age}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><Clock size={12} strokeWidth={1.5} /> Age</span>
                    <span class="cmd-metadata-value">{searchResult.age}</span>
                  </div>
                {/if}
              </div>
            </div>
            
            <!-- Block Transactions Module -->
            {#if searchResult.txHashes?.length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">☰</span>
                    BLOCK TRANSACTIONS
                  </div>
                  <span class="cmd-badge">{searchResult.txHashes.length} total</span>
                </div>
                <div class="cmd-list-content">
                  {#each searchResult.txHashes as txHash, i}
                    <button
                      on:click={() => goToTx(txHash)}
                      class="cmd-list-item"
                    >
                      <span class="cmd-list-index">#{i + 1}</span>
                      <span class="cmd-list-hash">{formatHash(txHash)}</span>
                      {#if searchResult.txs?.[i]?.type}
                        <span class="cmd-list-type">{searchResult.txs[i].type}</span>
                      {/if}
                      {#if searchResult.txs?.[i]?.fee}
                        <span class="cmd-list-fee">{(searchResult.txs[i].fee / 100000).toFixed(5)}</span>
                      {/if}
                      <ChevronRight size={12} strokeWidth={1.5} class="cmd-list-arrow" />
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-empty-state">
                  <Package size={20} strokeWidth={1.5} class="cmd-empty-icon" />
                  <span class="cmd-empty-text">No regular transactions in this block (coinbase only)</span>
                </div>
              </div>
            {/if}
            
          {:else if searchResult.type === 'tx'}
            <!-- Enhanced Transaction Details Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  TRANSACTION DETAILS
                </div>
                <div class="cmd-panel-meta">
                  <span class="cmd-badge">
                    {searchResult.isCoinbase ? 'COINBASE' : (searchResult.txType || searchResult.data?.tx_type || 'NORMAL')}
                  </span>
                  {#if searchResult.data?.in_pool}
                    <span class="cmd-badge cmd-badge-warn">PENDING</span>
                  {/if}
                </div>
              </div>
              <div class="cmd-stats-unified cmd-stats-6col">
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">⬢</div>
                  {#if searchResult.data?.block_height != null}
                    <button 
                      on:click={() => goToBlock(searchResult.data.block_height)}
                      class="cmd-stat-value cmd-clickable"
                    >
                      #{searchResult.data.block_height?.toLocaleString()}
                    </button>
                  {:else}
                    <div class="cmd-stat-value cmd-pending">Pending</div>
                  {/if}
                  <div class="cmd-stat-label">BLOCK HEIGHT</div>
                </div>
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◆</div>
                  <div class="cmd-stat-value">{((searchResult.data?.fee || 0) / 100000).toFixed(5)}</div>
                  <div class="cmd-stat-label">FEE (DERO)</div>
                </div>
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">●</div>
                  <div class="cmd-stat-value">{searchResult.ringMembers?.[0]?.count || searchResult.ringMembers?.length || 0}</div>
                  <div class="cmd-stat-label">RING SIZE</div>
                </div>
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">■</div>
                  <div class="cmd-stat-value">{searchResult.sizeKb || '0'} KB</div>
                  <div class="cmd-stat-label">TX SIZE</div>
                </div>
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon"><Zap size={14} strokeWidth={1.5} /></div>
                  <div class="cmd-stat-value">{searchResult.assets?.length || searchResult.ringMembers?.length || 1}</div>
                  <div class="cmd-stat-label">PAYLOADS</div>
                </div>
                {#if searchResult.burnValue}
                  <div class="cmd-stat-cell">
                    <div class="cmd-stat-icon">▼</div>
                    <div class="cmd-stat-value">{(searchResult.burnValue / 100000).toFixed(5)}</div>
                    <div class="cmd-stat-label">BURNED</div>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Transaction Hash Module -->
            <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">⬢</span>
                  TRANSACTION HASH
                </div>
                <button
                  on:click={() => navigator.clipboard.writeText(searchQuery)}
                  class="cmd-copy-btn"
                >
                  <Copy size={12} strokeWidth={1.5} />
                  Copy
                </button>
              </div>
              <div class="cmd-hash-content">
                <span class="cmd-hash-value">{searchQuery}</span>
              </div>
            </div>
            
            <!-- Transaction Metadata Module (NEW) -->
            <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">⬢</span>
                  TRANSACTION METADATA
                </div>
              </div>
              <div class="cmd-metadata-grid">
                <!-- Miner/Signer Address -->
                {#if searchResult.minerAddress}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><Pickaxe size={12} strokeWidth={1.5} /> Miner</span>
                    <button 
                      class="cmd-metadata-value cmd-clickable"
                      on:click={() => { searchQuery = searchResult.minerAddress; search(true); }}
                    >
                      {formatHash(searchResult.minerAddress)}
                    </button>
                    <button 
                      class="cmd-copy-btn-mini"
                      on:click={() => navigator.clipboard.writeText(searchResult.minerAddress)}
                    >
                      <Copy size={10} strokeWidth={1.5} />
                    </button>
                  </div>
                {/if}
                
                {#if searchResult.signer}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><User size={12} strokeWidth={1.5} /> Signer</span>
                    <button 
                      class="cmd-metadata-value cmd-clickable"
                      on:click={() => { searchQuery = searchResult.signer; search(true); }}
                    >
                      {formatHash(searchResult.signer)}
                    </button>
                    <button 
                      class="cmd-copy-btn-mini"
                      on:click={() => navigator.clipboard.writeText(searchResult.signer)}
                    >
                      <Copy size={10} strokeWidth={1.5} />
                    </button>
                  </div>
                {/if}
                
                <!-- Valid Block -->
                {#if searchResult.validBlock}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><CheckCircle size={12} strokeWidth={1.5} /> Valid In</span>
                    <button 
                      class="cmd-metadata-value cmd-clickable"
                      on:click={() => { searchQuery = searchResult.validBlock; search(true); }}
                    >
                      {formatHash(searchResult.validBlock)}
                    </button>
                  </div>
                {/if}
                
                <!-- Invalid Blocks -->
                {#if searchResult.invalidBlocks?.length > 0}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><AlertTriangle size={12} strokeWidth={1.5} /> Invalid In ({searchResult.invalidBlocks.length})</span>
                    <div class="cmd-tips-list">
                      {#each searchResult.invalidBlocks as block}
                        <button 
                          class="cmd-tip-hash cmd-tip-invalid"
                          on:click={() => { searchQuery = block; search(true); }}
                        >
                          {formatHash(block)}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                
                <!-- Age -->
                {#if searchResult.age}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label"><Clock size={12} strokeWidth={1.5} /> Age</span>
                    <span class="cmd-metadata-value">{searchResult.age}</span>
                  </div>
                {/if}
                
                <!-- Height Built -->
                {#if searchResult.heightBuilt}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label">Height Built</span>
                    <span class="cmd-metadata-value mono">{searchResult.heightBuilt}</span>
                  </div>
                {/if}
                
                <!-- BLID -->
                {#if searchResult.blid && searchResult.blid !== '0000000000000000000000000000000000000000000000000000000000000000'}
                  <div class="cmd-metadata-row">
                    <span class="cmd-metadata-label">BLID Reference</span>
                    <span class="cmd-metadata-value mono">{formatHash(searchResult.blid)}</span>
                  </div>
                {/if}
                
                <!-- SC TX: Quick link to view as Smart Contract (TXID == SCID for deployments) -->
                {#if searchResult.txType === 'SC' || searchResult.data?.tx_type === 'SC'}
                  <div class="cmd-metadata-row sc-tx-redirect-row">
                    <span class="cmd-metadata-label"><FileCode size={12} strokeWidth={1.5} /> Smart Contract</span>
                    <button 
                      class="cmd-metadata-value cmd-clickable sc-tx-redirect-btn"
                      on:click={() => searchSCDirectly(searchQuery)}
                    >
                      View Smart Contract →
                    </button>
                  </div>
                {/if}
              </div>
            </div>
            
            <!-- Assets Breakdown Module (NEW) -->
            {#if searchResult.assets?.length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">◎</span>
                    ASSETS / PAYLOADS
                  </div>
                  <span class="cmd-badge">{searchResult.assets.length} payload(s)</span>
                </div>
                <div class="cmd-assets-list">
                  {#each searchResult.assets as asset, i}
                    <div class="cmd-asset-item">
                      <div class="cmd-asset-header">
                        <span class="cmd-asset-index">Payload #{i + 1}</span>
                        {#if asset.scid && asset.scid !== '0000000000000000000000000000000000000000000000000000000000000000'}
                          <button 
                            class="cmd-asset-scid"
                            on:click={() => goToSC(asset.scid)}
                            title="View SCID"
                          >
                            SCID: {formatHash(asset.scid)}
                          </button>
                        {:else}
                          <span class="cmd-badge">DERO</span>
                        {/if}
                      </div>
                      <div class="cmd-asset-stats">
                        <span class="cmd-asset-stat">
                          <span class="cmd-asset-label">Ring:</span>
                          <span class="cmd-asset-value">{asset.ring_size || 0}</span>
                        </span>
                        <span class="cmd-asset-stat">
                          <span class="cmd-asset-label">Fees:</span>
                          <span class="cmd-asset-value">{((asset.fees || 0) / 100000).toFixed(5)}</span>
                        </span>
                        {#if asset.burn > 0}
                          <span class="cmd-asset-stat">
                            <span class="cmd-asset-label">Burn:</span>
                            <span class="cmd-asset-value cmd-burn">{((asset.burn || 0) / 100000).toFixed(5)}</span>
                          </span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            
            <!-- Ring Members Module (Enhanced per-payload) -->
            {#if searchResult.ringMembers?.length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">●</span>
                    RING MEMBERS
                  </div>
                  <span class="cmd-badge">{searchResult.ringMembers.length} payload(s)</span>
                </div>
                <div class="cmd-ring-payloads">
                  {#each searchResult.ringMembers as payload, pIdx}
                    <div class="cmd-ring-payload">
                      <div class="cmd-ring-header">
                        <span class="cmd-ring-label">Payload #{pIdx + 1}</span>
                        <span class="cmd-ring-size">{payload.count || payload.members?.length || 0} addresses</span>
                      </div>
                      {#if payload.members?.length > 0}
                        <div class="cmd-ring-members">
                          {#each payload.members as addr, i}
                            <div
                              class="cmd-ring-member"
                              role="button"
                              tabindex="0"
                              on:click={() => { searchQuery = addr; search(true); }}
                              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); searchQuery = addr; search(true); } }}
                              title="Search this address"
                            >
                              <span class="cmd-ring-index">#{i + 1}</span>
                              <span class="cmd-ring-addr">{formatHash(addr)}</span>
                              <button
                                class="cmd-copy-btn-mini"
                                on:click|stopPropagation={() => navigator.clipboard.writeText(addr)}
                                title="Copy address"
                              >
                                <Copy size={10} strokeWidth={1.5} />
                              </button>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <div class="cmd-ring-empty">Ring members not available</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <!-- Fallback to old RingVisualization if no enhanced data -->
              <div style="margin-top: var(--s-4);">
                <RingVisualization 
                  ringMembers={searchResult.ringMembers || []}
                  ringSize={searchResult.ringMembers?.length || 0}
                  txType={searchResult.isCoinbase ? 'COINBASE' : (searchResult.txType || searchResult.data?.tx_type || 'NORMAL')}
                  isCoinbase={searchResult.isCoinbase}
                  minerAddress={searchResult.minerAddress}
                  on:copy={(e) => {
                    console.log('Copied address:', e.detail.address);
                  }}
                />
              </div>
            {/if}
            
            <!-- Raw TX Hex (collapsible) -->
            {#if searchResult.hex}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">⬢</span>
                    RAW TRANSACTION HEX
                  </div>
                  <button
                    on:click={() => navigator.clipboard.writeText(searchResult.hex)}
                    class="cmd-copy-btn"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Copy Hex
                  </button>
                </div>
                <div class="cmd-raw-hex">
                  <code>{searchResult.hex.length > 500 ? searchResult.hex.slice(0, 500) + '...' : searchResult.hex}</code>
                  {#if searchResult.hex.length > 500}
                    <span class="cmd-hex-truncated">({searchResult.hex.length} chars total)</span>
                  {/if}
                </div>
              </div>
            {/if}
            
          {:else if searchResult.type === 'sc'}
            <!-- v6.1 Smart Contract Details Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  SMART CONTRACT
                </div>
                <div class="cmd-panel-meta">
                  <span class="cmd-badge">{((searchResult.data.balance || 0) / 100000).toFixed(5)} DERO</span>
                  {#if searchResult.data.hasDeploymentTx}
                    <button 
                      class="cmd-link-btn"
                      on:click={() => viewAsTransaction(searchQuery)}
                      title="This SCID is also a deployment transaction"
                    >
                      View as TX
                    </button>
                  {/if}
                  <button 
                    class="cmd-link-btn watch-btn"
                    class:watching={isCurrentSCWatched}
                    on:click={() => isCurrentSCWatched ? unwatchCurrentSC() : watchCurrentSC()}
                    disabled={watchingInProgress}
                    title={isCurrentSCWatched ? 'Stop watching this SC' : 'Watch for state changes'}
                  >
                    {#if watchingInProgress}
                      <Loader2 size={12} class="spin" />
                    {:else if isCurrentSCWatched}
                      <EyeOff size={12} />
                    {:else}
                      <Eye size={12} />
                    {/if}
                    {isCurrentSCWatched ? 'Watching' : 'Watch'}
                  </button>
                </div>
              </div>
              <div class="cmd-stats-unified" style="grid-template-columns: 1fr;">
                <div class="cmd-stat-cell" style="flex-direction: row; justify-content: space-between; padding: var(--s-3) var(--s-4);">
                  <div style="display: flex; flex-direction: column; gap: var(--s-1); flex: 1; min-width: 0;">
                    <div class="cmd-stat-label" style="margin: 0;">SCID</div>
                    <span class="cmd-hash-value" style="font-size: 12px;">{searchQuery}</span>
                  </div>
                  <button
                    on:click={() => navigator.clipboard.writeText(searchQuery)}
                    class="cmd-copy-btn"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Copy
                  </button>
                </div>
              </div>
            </div>
            
            <!-- SC Code Module - v6.1 Pattern -->
            {#if searchResult.data.code}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">⬢</span>
                    SMART CONTRACT CODE
                  </div>
                  <button
                    on:click={() => navigator.clipboard.writeText(searchResult.data.code)}
                    class="cmd-copy-btn"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Copy Code
                  </button>
                </div>
                <pre class="cmd-code-preview">{searchResult.data.code}</pre>
              </div>
            {/if}
            
            <!-- String Variables Module - v6.1 Pattern -->
            {#if searchResult.data.stringkeys && Object.keys(searchResult.data.stringkeys).length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">☰</span>
                    STRING VARIABLES
                  </div>
                  <span class="cmd-badge">{Object.keys(searchResult.data.stringkeys).length}</span>
                </div>
                <div class="cmd-vars-list">
                  {#each Object.entries(searchResult.data.stringkeys) as [key, value]}
                    {@const displayKey = formatSCDisplayKey(key)}
                    {@const displayVal = formatSCDisplayValue(value)}
                    {@const showingRaw = hexViewKeys[key]}
                    <div class="cmd-var-row">
                      <span class="cmd-var-key string">{showingRaw ? displayKey.raw : displayKey.display}</span>
                      <div class="cmd-var-value-row">
                        <span class="cmd-var-value" class:cmd-var-hex={showingRaw} title={showingRaw ? displayVal.raw : displayVal.display}>
                          {showingRaw ? displayVal.raw : displayVal.display}
                        </span>
                        {#if displayKey.wasDecoded || displayVal.wasDecoded}
                          <button
                            class="cmd-hex-toggle"
                            class:active={showingRaw}
                            on:click={() => toggleHexView(key)}
                            title={showingRaw ? 'Show decoded value' : 'Show raw hex (on-chain storage)'}
                          >hex</button>
                        {/if}
                        {#if showVarEditor}
                          <button
                            on:click={() => handleDeleteVar(key)}
                            disabled={varLoading}
                            class="cmd-var-delete"
                            title="Delete variable"
                          >
                            ✕
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
            
            <!-- Uint64 Variables Module - v6.1 Pattern -->
            {#if searchResult.data.uint64keys && Object.keys(searchResult.data.uint64keys).length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">☰</span>
                    UINT64 VARIABLES
                  </div>
                  <span class="cmd-badge">{Object.keys(searchResult.data.uint64keys).length}</span>
                </div>
                <div class="cmd-vars-list">
                  {#each Object.entries(searchResult.data.uint64keys) as [key, value]}
                    <div class="cmd-var-row">
                      <span class="cmd-var-key uint">{key}</span>
                      <div class="cmd-var-value-row">
                        <span class="cmd-var-value">{value}</span>
                        {#if showVarEditor}
                          <button
                            on:click={() => handleDeleteVar(key)}
                            disabled={varLoading}
                            class="cmd-var-delete"
                            title="Delete variable"
                          >
                            ✕
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
              
              <!-- SC Quick Actions (Phase 4) -->
              <SCQuickActions 
                scid={searchQuery} 
                scName={getSCDisplayName(searchResult.data)}
              />
              
              <!-- Version History (for TELA INDEXes) -->
              {#if isTELAIndex(searchResult.data)}
                <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                  <div class="cmd-panel-header">
                    <div class="cmd-panel-title">
                      <span class="cmd-panel-icon">◎</span>
                      VERSION CONTROL
                    </div>
                    <span class="cmd-badge tela">TELA INDEX</span>
                  </div>
                  <div class="version-control-actions">
                    <button 
                      class="version-btn primary"
                      on:click={() => openVersionHistory(searchQuery)}
                    >
                      <History size={16} />
                      View Version History
                    </button>
                    <button 
                      class="version-btn secondary"
                      on:click={() => {
                        navigateTo(searchQuery);
                        window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'studio' }));
                      }}
                    >
                      <GitBranch size={16} />
                      Open in Studio
                    </button>
                  </div>
                  <p class="version-hint">
                    This TELA INDEX can be updated. View commit history, compare versions, or revert to previous states.
                  </p>
                </div>
              {/if}
              
              <!-- SC Interaction History -->
              <div class="interaction-section">
                <button
                  on:click={() => showInteractions = !showInteractions}
                  class="interaction-toggle"
                >
                  <span class="toggle-icon">{showInteractions ? '▼' : '▶'}</span>
                  <span>Interaction History</span>
                  {#if scInteractionsCount > 0}
                    <span class="interaction-badge">{scInteractionsCount} total</span>
                  {/if}
                </button>
                
                {#if showInteractions}
                  <div class="interaction-panel">
                    {#if scInteractionsLoading}
                      <div class="interaction-loading">
                        <div class="spinner-sm"></div>
                        <span>Loading interactions...</span>
                      </div>
                    {:else if scInteractions.length === 0}
                      <div class="interaction-empty">
                        <span>No interaction history available</span>
                        <p>Enable Gnomon indexer to track SC interactions</p>
                      </div>
                    {:else}
                      <!-- Activity Chart -->
                      <div class="activity-chart-section">
                        <span class="chart-label">Activity Overview</span>
                        <div class="activity-bars">
                          {#each activityBars as bar}
                            <div class="activity-bar-col">
                              <div 
                                class="activity-bar"
                                style="height: {bar.height}%"
                                title="{bar.count} interactions"
                              ></div>
                              <span class="bar-label">{bar.label}</span>
                            </div>
                          {/each}
                        </div>
                      </div>
                      
                      <!-- Interaction List -->
                      <div class="interaction-list">
                        {#each scInteractions.slice(0, 20) as interaction}
                          <button
                            on:click={() => goToBlock(interaction.height)}
                            class="interaction-item"
                          >
                            <div class="interaction-left">
                              <span class="interaction-index">#{interaction.index}</span>
                              <span class="interaction-block">Block {interaction.height?.toLocaleString()}</span>
                            </div>
                            {#if interaction.timestamp}
                              <span class="interaction-time">{formatInteractionTime(interaction.timestamp)}</span>
                            {/if}
                          </button>
                        {/each}
                        {#if scInteractions.length > 20}
                          <p class="interaction-more">
                            Showing 20 of {scInteractionsCount} interactions
                          </p>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
              
              <!-- SC Variable Editor -->
              <div class="var-editor-section">
                <button
                  on:click={() => showVarEditor = !showVarEditor}
                  class="var-editor-toggle"
                >
                  <span class="toggle-icon">{showVarEditor ? '▼' : '▶'}</span>
                  <span>SC Variable Editor</span>
                  {#if !$walletState.isOpen}
                    <span class="wallet-required">(Wallet required)</span>
                  {/if}
                </button>
                
                {#if showVarEditor}
                  <div class="var-editor-panel">
                    {#if !$walletState.isOpen}
                      <div class="alert-warn-box">
                        <span class="alert-icon">!</span> Connect a wallet to modify SC variables. Only the SC owner can modify variables.
                      </div>
                    {/if}
                    
                    <div class="var-form">
                      <div class="var-form-grid">
                        <div class="var-form-field">
                          <label class="var-form-label">Key</label>
                          <input
                            type="text"
                            bind:value={varKey}
                            placeholder="variable_name"
                            class="var-form-input mono"
                          />
                        </div>
                        <div class="var-form-field">
                          <label class="var-form-label">Value</label>
                          <input
                            type="text"
                            bind:value={varValue}
                            placeholder={varType === 'uint64' ? '0' : 'value'}
                            class="var-form-input mono"
                          />
                        </div>
                        <div class="var-form-field">
                          <label class="var-form-label">Type</label>
                          <select
                            bind:value={varType}
                            class="var-form-select"
                          >
                            <option value="string">String</option>
                            <option value="uint64">Uint64</option>
                          </select>
                        </div>
                      </div>
                      
                      <div class="var-form-actions">
                        <button
                          on:click={handleSetVar}
                          disabled={varLoading || !$walletState.isOpen || !varKey.trim()}
                          class="btn-set-var"
                        >
                          {varLoading ? 'Processing...' : 'Set Variable'}
                        </button>
                        <button
                          on:click={() => { varKey = ''; varValue = ''; }}
                          class="btn-clear-var"
                        >
                          Clear
                        </button>
                      </div>
                      
                      <p class="var-form-hint">
                        Only the smart contract owner can set or delete variables. This sends a transaction to update the SC state.
                      </p>
                    </div>
                  </div>
                {/if}
              </div>
              
              <!-- SC Function Interactor (Simple-Wallet feature) -->
              <SCFunctionInteractor 
                scid={searchQuery}
                on:invoked={(e) => {
                  toast.success(`Function called! TX: ${e.detail.txid?.slice(0, 16)}...`);
                }}
              />
              
              <!-- Time Machine Section -->
              <div class="time-machine-section">
                <button
                  on:click={async () => {
                    showTimeMachine = !showTimeMachine;
                    if (showTimeMachine) {
                      if (timeMachineSnapshots.length === 0) {
                        loadTimeMachineHistory(searchQuery);
                      }
                      // Check if current SC is watched
                      await loadWatchedSCs();
                    }
                  }}
                  class="time-machine-toggle"
                >
                  <span class="toggle-icon">{showTimeMachine ? '▼' : '▶'}</span>
                  <Clock size={14} strokeWidth={1.5} />
                  <span>Time Machine</span>
                  {#if timeMachineSnapshots.length > 0}
                    <span class="snapshot-badge">{timeMachineSnapshots.length} snapshots</span>
                  {/if}
                </button>
                
                {#if showTimeMachine}
                  <div class="cmd-stats-panel time-machine-panel">
                    <div class="cmd-panel-header">
                      <div class="cmd-panel-title">
                        <span class="cmd-panel-icon">◎</span>
                        TIME MACHINE
                      </div>
                      <div class="cmd-panel-actions">
                        <button
                          class="cmd-link-btn"
                          on:click={() => isCurrentSCWatched ? unwatchCurrentSC() : watchCurrentSC()}
                          disabled={watchingInProgress}
                          title={isCurrentSCWatched ? 'Stop watching this SC' : 'Watch this SC for changes'}
                        >
                          {#if watchingInProgress}
                            <Loader2 size={12} class="spin" />
                          {:else if isCurrentSCWatched}
                            <span>Unwatch</span>
                          {:else}
                            <span>Watch</span>
                          {/if}
                        </button>
                        <button
                          class="cmd-link-btn"
                          on:click={() => captureSnapshot(searchQuery)}
                          disabled={timeMachineCapturing}
                        >
                          {#if timeMachineCapturing}
                            <Loader2 size={12} class="spin" />
                          {:else}
                            <span>+ Capture</span>
                          {/if}
                        </button>
                      </div>
                    </div>
                    
                    <div class="cmd-panel-body">
                      {#if timeMachineLoading}
                        <div class="time-machine-loading">
                          <Loader2 size={16} class="spin" />
                          <span>Loading snapshots...</span>
                        </div>
                      {:else if timeMachineSnapshots.length === 0}
                        <div class="time-machine-empty">
                          <Clock size={24} strokeWidth={1} />
                          <p>No snapshots captured yet</p>
                          <p class="hint">Capture a snapshot to start tracking SC state over time</p>
                        </div>
                      {:else}
                        <!-- Snapshot Slider -->
                        <div class="snapshot-slider-container">
                          <div class="slider-labels">
                            <span class="slider-label-left">Height {timeMachineSnapshots[0]?.height || 0}</span>
                            <span class="slider-label-right">Height {timeMachineSnapshots[timeMachineSnapshots.length - 1]?.height || 0}</span>
                          </div>
                          <input
                            type="range"
                            class="snapshot-slider"
                            min="0"
                            max={timeMachineSnapshots.length - 1}
                            bind:value={selectedSnapshotIndex}
                            on:input={() => handleSliderChange(selectedSnapshotIndex)}
                          />
                          <div class="slider-ticks">
                            {#each timeMachineSnapshots as _, i}
                              <div 
                                class="slider-tick"
                                class:active={i === selectedSnapshotIndex}
                                on:click={() => handleSliderChange(i)}
                                title="Height {timeMachineSnapshots[i]?.height}"
                              ></div>
                            {/each}
                          </div>
                        </div>
                        
                        <!-- Selected Snapshot Info -->
                        {#if selectedSnapshot}
                          <div class="selected-snapshot-info">
                            <div class="snapshot-header">
                              <span class="snapshot-height">Block #{selectedSnapshot.height}</span>
                              <span class="snapshot-time">{formatSnapshotTime(selectedSnapshot)}</span>
                            </div>
                            <div class="snapshot-stats">
                              <div class="snapshot-stat">
                                <span class="stat-label">Variables</span>
                                <span class="stat-value">{Object.keys(selectedSnapshot.variables || {}).length}</span>
                              </div>
                              <div class="snapshot-stat">
                                <span class="stat-label">Balance</span>
                                <span class="stat-value">{(selectedSnapshot.balance / 100000).toFixed(5)} DERO</span>
                              </div>
                            </div>
                            
                            <!-- Variables at this height -->
                            {#if selectedSnapshot.variables && Object.keys(selectedSnapshot.variables).length > 0}
                              <div class="snapshot-variables">
                                <div class="vars-header">Variables at Height {selectedSnapshot.height}</div>
                                <div class="vars-list">
                                  {#each Object.entries(selectedSnapshot.variables).slice(0, 10) as [key, value]}
                                    <div class="var-row">
                                      <span class="var-key">{key}</span>
                                      <span class="var-value">{typeof value === 'object' ? JSON.stringify(value) : value}</span>
                                    </div>
                                  {/each}
                                  {#if Object.keys(selectedSnapshot.variables).length > 10}
                                    <div class="vars-more">
                                      +{Object.keys(selectedSnapshot.variables).length - 10} more variables
                                    </div>
                                  {/if}
                                </div>
                              </div>
                            {/if}
                          </div>
                        {/if}
                        
                        <!-- Compare Mode -->
                        {#if timeMachineSnapshots.length >= 2}
                          <div class="compare-section">
                            <button
                              class="compare-toggle"
                              on:click={() => compareMode = !compareMode}
                            >
                              <span class="toggle-icon">{compareMode ? '▼' : '▶'}</span>
                              Compare Snapshots
                            </button>
                            
                            {#if compareMode}
                              <div class="compare-controls">
                                <div class="compare-select">
                                  <label>From:</label>
                                  <select bind:value={compareFromIndex}>
                                    {#each timeMachineSnapshots as snap, i}
                                      <option value={i}>Height {snap.height}</option>
                                    {/each}
                                  </select>
                                </div>
                                <div class="compare-select">
                                  <label>To:</label>
                                  <select bind:value={compareToIndex}>
                                    {#each timeMachineSnapshots as snap, i}
                                      <option value={i}>Height {snap.height}</option>
                                    {/each}
                                  </select>
                                </div>
                                <button
                                  class="cmd-link-btn"
                                  on:click={compareSnapshots}
                                  disabled={comparingSnapshots || compareFromIndex === compareToIndex}
                                >
                                  {#if comparingSnapshots}
                                    <Loader2 size={12} class="spin" />
                                  {:else}
                                    Compare
                                  {/if}
                                </button>
                              </div>
                              
                              {#if comparisonResult}
                                <div class="comparison-result">
                                  <div class="comparison-header">
                                    Changes from Height {comparisonResult.from_height} to {comparisonResult.to_height}
                                  </div>
                                  <div class="comparison-summary">
                                    <span class="change-added">+{comparisonResult.total_added} added</span>
                                    <span class="change-modified">~{comparisonResult.total_modified} modified</span>
                                    <span class="change-removed">-{comparisonResult.total_removed} removed</span>
                                    {#if comparisonResult.balance_diff !== 0}
                                      <span class="balance-diff">
                                        Balance: {comparisonResult.balance_diff > 0 ? '+' : ''}{(comparisonResult.balance_diff / 100000).toFixed(5)}
                                      </span>
                                    {/if}
                                  </div>
                                  {#if comparisonResult.changes?.length > 0}
                                    <div class="changes-list">
                                      {#each comparisonResult.changes.slice(0, 10) as change}
                                        <div class="change-row change-{change.change_type}">
                                          <span class="change-type">{change.change_type}</span>
                                          <span class="change-key">{change.key}</span>
                                          {#if change.change_type === 'modified'}
                                            <span class="change-values">
                                              {change.old_value} → {change.new_value}
                                            </span>
                                          {:else if change.change_type === 'added'}
                                            <span class="change-values">{change.new_value}</span>
                                          {:else}
                                            <span class="change-values">{change.old_value}</span>
                                          {/if}
                                        </div>
                                      {/each}
                                      {#if comparisonResult.changes.length > 10}
                                        <div class="changes-more">
                                          +{comparisonResult.changes.length - 10} more changes
                                        </div>
                                      {/if}
                                    </div>
                                  {/if}
                                </div>
                              {/if}
                            {/if}
                          </div>
                        {/if}
                        
                        <!-- Change Timeline Section -->
                        <div class="change-timeline-section">
                          <button
                            class="compare-toggle"
                            on:click={() => {
                              showChangeTimeline = !showChangeTimeline;
                              if (showChangeTimeline && changeTimeline.length === 0) {
                                loadChangeTimeline(searchQuery);
                              }
                            }}
                          >
                            <span class="toggle-icon">{showChangeTimeline ? '▼' : '▶'}</span>
                            Change Timeline
                            {#if changeTimeline.length > 0}
                              <span class="timeline-badge">{changeTimeline.length} events</span>
                            {/if}
                          </button>
                          
                          {#if showChangeTimeline}
                            <div class="change-timeline-content">
                              {#if changeTimelineLoading}
                                <div class="timeline-loading">
                                  <Loader2 size={14} class="spin" />
                                  <span>Loading timeline...</span>
                                </div>
                              {:else if changeTimeline.length === 0}
                                <div class="timeline-empty">
                                  <p>No changes recorded between snapshots</p>
                                  <p class="hint">Capture more snapshots to see changes over time</p>
                                </div>
                              {:else}
                                <div class="timeline-list">
                                  {#each changeTimeline as event, i}
                                    <div class="timeline-event">
                                      <div class="timeline-dot"></div>
                                      <div class="timeline-line"></div>
                                      <div class="timeline-content">
                                        <div class="timeline-header">
                                          <span class="timeline-heights">
                                            Block {event.from_height} → {event.to_height}
                                          </span>
                                        </div>
                                        <div class="timeline-changes">
                                          {#if event.total_added > 0}
                                            <span class="change-added">+{event.total_added}</span>
                                          {/if}
                                          {#if event.total_modified > 0}
                                            <span class="change-modified">~{event.total_modified}</span>
                                          {/if}
                                          {#if event.total_removed > 0}
                                            <span class="change-removed">-{event.total_removed}</span>
                                          {/if}
                                          {#if event.code_changed}
                                            <span class="code-changed">Code changed</span>
                                          {/if}
                                        </div>
                                      </div>
                                    </div>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
          
          {:else if searchResult.type === 'address'}
            <!-- v6.1 Address Details Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  DERO ADDRESS
                </div>
                <div class="cmd-panel-meta">
                  <span class="cmd-badge {searchResult.data.valid ? 'valid' : 'invalid'}">
                    {searchResult.data.valid ? '✓ Valid' : '✗ Invalid'}
                  </span>
                  <span class="cmd-badge">{searchResult.data.network || 'mainnet'}</span>
                </div>
              </div>
              <div class="cmd-stats-unified" style="grid-template-columns: 1fr; padding: var(--s-4);">
                <div style="display: flex; align-items: center; gap: var(--s-4);">
                  <div class="cmd-address-icon">
                    <User size={24} strokeWidth={1.5} />
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <AddressDisplay 
                      address={searchResult.address} 
                      truncate={false} 
                      size="md"
                      showCopy={true}
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Owned TELA Apps Module - v6.1 Pattern -->
            {#if searchResult.data.owned_apps && searchResult.data.owned_apps.length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">☰</span>
                    OWNED TELA APPS
                  </div>
                  <span class="cmd-badge">{searchResult.data.owned_count} apps</span>
                </div>
                <div class="cmd-list-content">
                  {#each searchResult.data.owned_apps as app}
                    <button
                      on:click={() => goToSC(app.scid)}
                      class="cmd-list-item"
                    >
                      <div class="cmd-sc-info">
                        <span class="cmd-sc-name">{app.name || app.durl || 'Unnamed App'}</span>
                        <span class="cmd-sc-hash">{app.scid.slice(0, 8)}...{app.scid.slice(-6)}</span>
                        {#if app.description}
                          <span class="cmd-sc-desc">{app.description.slice(0, 60)}{app.description.length > 60 ? '...' : ''}</span>
                        {/if}
                      </div>
                      <ChevronRight size={12} strokeWidth={1.5} class="cmd-list-arrow" />
                    </button>
                  {/each}
                </div>
              </div>
            {:else if searchResult.data.owned_count === 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-empty-state">
                  <Package size={20} strokeWidth={1.5} class="cmd-empty-icon" />
                  <span class="cmd-empty-text">No TELA apps owned by this address</span>
                </div>
              </div>
            {/if}
            
            <!-- 2C: Address SCID Cross-References -->
            {#if addressSCIDRefs.length > 0}
              <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                <div class="cmd-panel-header">
                  <div class="cmd-panel-title">
                    <span class="cmd-panel-icon">⬡</span>
                    REFERENCED IN SMART CONTRACTS
                  </div>
                  <span class="cmd-badge">{addressSCIDRefs.length} refs</span>
                </div>
                <div class="cmd-list-content">
                  {#each addressSCIDRefs as ref}
                    <button
                      on:click={() => goToSC(ref.scid || ref)}
                      class="cmd-list-item"
                    >
                      <span class="cmd-list-hash">{(ref.scid || ref).slice(0, 16)}...{(ref.scid || ref).slice(-8)}</span>
                      {#if ref.name}<span class="cmd-list-type">{ref.name}</span>{/if}
                      <ChevronRight size={12} strokeWidth={1.5} class="cmd-list-arrow" />
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            
            <!-- Gnomon Notice - v6.1 Pattern -->
            {#if searchResult.data.gnomonData === 'unavailable' || !searchResult.data.owned_apps}
              <div class="cmd-stats-panel cmd-notice" style="margin-top: var(--s-4);">
                <div class="cmd-notice-content">
                  <Info size={16} strokeWidth={1.5} class="cmd-notice-icon" />
                  <div class="cmd-notice-text">
                    <strong>Limited Data Available</strong>
                    <span>Enable Gnomon in Settings to view owned smart contracts and more details.</span>
                  </div>
                </div>
              </div>
            {/if}
            
            <!-- Privacy Notice - v6.1 Pattern -->
            <div class="cmd-stats-panel cmd-privacy" style="margin-top: var(--s-4);">
              <div class="cmd-notice-content">
                <Lock size={14} strokeWidth={1.5} class="cmd-notice-icon" />
                <span class="cmd-privacy-text">Due to DERO's privacy features, full transaction history is only available for your own wallets.</span>
              </div>
            </div>
          
          {:else if searchResult.type === 'durl'}
            <!-- v6.1 dURL/TELA dApp Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  TELA DAPP
                </div>
                <div class="cmd-panel-meta">
                  {#if searchResult.data.success}
                    <span class="cmd-badge valid">✓ Found</span>
                  {:else}
                    <span class="cmd-badge invalid">✗ Not Found</span>
                  {/if}
                </div>
              </div>
              
              {#if searchResult.data.success}
                <div class="cmd-stats-unified" style="grid-template-columns: 1fr 1fr;">
                  <div class="cmd-stat-cell">
                    <div class="cmd-stat-icon">◆</div>
                    <div class="cmd-stat-value" style="font-size: 16px;">{searchResult.data.name || searchQuery.replace('dero://', '')}</div>
                    <div class="cmd-stat-label">NAME</div>
                  </div>
                  <div class="cmd-stat-cell">
                    <div class="cmd-stat-icon">⬢</div>
                    <div class="cmd-stat-value" style="font-size: 14px;">{searchQuery}</div>
                    <div class="cmd-stat-label">DURL</div>
                  </div>
                </div>
                
                {#if searchResult.data.scid}
                  <!-- SCID Module -->
                  <div class="cmd-panel-header" style="border-top: 1px solid var(--border-subtle);">
                    <div class="cmd-panel-title">
                      <span class="cmd-panel-icon">⬢</span>
                      SMART CONTRACT
                    </div>
                    <button 
                      on:click={() => { searchQuery = searchResult.data.scid; search(); }}
                      class="cmd-copy-btn"
                    >
                      View SC
                      <ChevronRight size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                  <div class="cmd-hash-content">
                    <span class="cmd-hash-value">{searchResult.data.scid}</span>
                  </div>
                {/if}
              {:else}
                <div class="cmd-empty-state" style="flex-direction: row;">
                  <AlertTriangle size={18} strokeWidth={1.5} class="cmd-empty-icon" style="color: var(--status-warn);" />
                  <span class="cmd-empty-text">dApp not found: {searchResult.data.error || 'Unknown error'}</span>
                </div>
              {/if}
            </div>
          
          {:else if searchResult.type === 'key'}
            <!-- v6.1 Key Search Results Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◆</span>
                  KEY SEARCH
                </div>
                <span class="cmd-badge">{searchResult.data.count || 0} results</span>
              </div>
              
              <div class="cmd-stats-unified" style="grid-template-columns: 1fr;">
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◆</div>
                  <div class="cmd-stat-value" style="font-size: 16px; font-family: var(--font-mono);">{searchResult.data.key}</div>
                  <div class="cmd-stat-label">SEARCHED KEY</div>
                </div>
              </div>
              
              {#if searchResult.data.results && searchResult.data.results.length > 0}
                <div class="cmd-list-content" style="max-height: 400px; overflow-y: auto;">
                  {#each searchResult.data.results as item}
                    <button
                      on:click={() => { searchQuery = item.scid; search(); }}
                      class="cmd-list-item"
                    >
                      <div class="cmd-list-item-main">
                        <span class="cmd-list-item-primary">{item.name || item.durl || 'SC'}</span>
                        <span class="cmd-list-item-secondary" style="font-family: var(--font-mono);">{item.scid?.slice(0, 16)}...{item.scid?.slice(-8)}</span>
                      </div>
                      <div class="cmd-list-item-meta">
                        <span class="cmd-badge" style="font-size: 10px;">{item.type || 'SC'}</span>
                        <ChevronRight size={12} strokeWidth={1.5} />
                      </div>
                    </button>
                  {/each}
                </div>
              {:else}
                <div class="cmd-empty-state" style="flex-direction: row;">
                  <Search size={18} strokeWidth={1.5} class="cmd-empty-icon" />
                  <span class="cmd-empty-text">No SCIDs found with key "{searchResult.data.key}"</span>
                </div>
              {/if}
            </div>
          
          {:else if searchResult.type === 'value'}
            <!-- v6.1 Value Search Results Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◉</span>
                  VALUE SEARCH
                </div>
                <span class="cmd-badge">{searchResult.data.count || 0} results</span>
              </div>
              
              <div class="cmd-stats-unified" style="grid-template-columns: 1fr;">
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◆</div>
                  <div class="cmd-stat-value" style="font-size: 16px; font-family: var(--font-mono);">{searchResult.data.value}</div>
                  <div class="cmd-stat-label">SEARCHED VALUE</div>
                </div>
              </div>
              
              {#if searchResult.data.results && searchResult.data.results.length > 0}
                <div class="cmd-list-content" style="max-height: 400px; overflow-y: auto;">
                  {#each searchResult.data.results as item}
                    <button
                      on:click={() => { searchQuery = item.scid; search(); }}
                      class="cmd-list-item"
                    >
                      <div class="cmd-list-item-main">
                        <span class="cmd-list-item-primary">{item.name || item.durl || 'SC'}</span>
                        <span class="cmd-list-item-secondary" style="font-family: var(--font-mono);">{item.scid?.slice(0, 16)}...{item.scid?.slice(-8)}</span>
                      </div>
                      <div class="cmd-list-item-meta">
                        <span class="cmd-badge" style="font-size: 10px;">{item.type || 'SC'}</span>
                        <ChevronRight size={12} strokeWidth={1.5} />
                      </div>
                    </button>
                  {/each}
                </div>
              {:else}
                <div class="cmd-empty-state" style="flex-direction: row;">
                  <Search size={18} strokeWidth={1.5} class="cmd-empty-icon" />
                  <span class="cmd-empty-text">No SCIDs found with value "{searchResult.data.value}"</span>
                </div>
              {/if}
            </div>
          
          {:else if searchResult.type === 'code'}
            <!-- v6.1 Code Search Results Module -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">⧉</span>
                  CODE SEARCH
                </div>
                <span class="cmd-badge">{searchResult.data.count || 0} contracts</span>
              </div>
              
              <div class="cmd-stats-unified" style="grid-template-columns: 1fr;">
                <div class="cmd-stat-cell">
                  <div class="cmd-stat-icon">◆</div>
                  <div class="cmd-stat-value" style="font-size: 14px; font-family: var(--font-mono);">{searchResult.data.line}</div>
                  <div class="cmd-stat-label">SEARCHED CODE</div>
                </div>
              </div>
              
              {#if searchResult.data.results && searchResult.data.results.length > 0}
                <div class="cmd-list-content" style="max-height: 500px; overflow-y: auto;">
                  {#each searchResult.data.results as item}
                    <div class="cmd-code-result">
                      <button
                        on:click={() => { searchQuery = item.scid; search(); }}
                        class="cmd-list-item"
                        style="border-bottom: none;"
                      >
                        <div class="cmd-list-item-main">
                          <span class="cmd-list-item-primary">{item.name || item.durl || 'Smart Contract'}</span>
                          <span class="cmd-list-item-secondary" style="font-family: var(--font-mono);">{item.scid?.slice(0, 16)}...{item.scid?.slice(-8)}</span>
                        </div>
                        <div class="cmd-list-item-meta">
                          <span class="cmd-badge" style="font-size: 10px;">{item.matchCount || 0} matches</span>
                          <ChevronRight size={12} strokeWidth={1.5} />
                        </div>
                      </button>
                      {#if item.matches && item.matches.length > 0}
                        <div class="code-matches" style="padding: 0 var(--s-3) var(--s-3); background: var(--void-base); border-radius: 0 0 var(--radius-sm) var(--radius-sm);">
                          {#each item.matches.slice(0, 3) as match}
                            <div class="code-match-line" style="font-family: var(--font-mono); font-size: 12px; padding: var(--s-1) 0; color: var(--text-muted); display: flex; gap: var(--s-2);">
                              <span style="color: var(--cyan-400); min-width: 40px;">L{match.lineNum}</span>
                              <span style="color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{match.content}</span>
                            </div>
                          {/each}
                          {#if item.matches.length > 3}
                            <div style="font-size: 11px; color: var(--text-muted); padding-top: var(--s-1);">+{item.matches.length - 3} more matches</div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="cmd-empty-state" style="flex-direction: row;">
                  <FileCode size={18} strokeWidth={1.5} class="cmd-empty-icon" />
                  <span class="cmd-empty-text">No contracts found containing "{searchResult.data.line}"</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- v6.2 Section-based Content (Proof Validator Only) -->
      <div class="page-content-inner" style="max-width: 1200px;">
        {#if activeSection === 'proof'}
          <!-- PROOF: Proof Validator -->
          <div class="content-section-title">Proof Validator</div>
          <p class="content-section-desc">Validate transaction proofs using the DeroProof system</p>
          
          <div class="explorer-section">
            <div class="explorer-section-body">
              <div class="explorer-form-group">
                <label class="explorer-form-label">Proof String</label>
              <input
                type="text"
                bind:value={proofInput}
                placeholder="deroproof1q..."
                  class="explorer-input"
              />
            </div>
            
              <div class="explorer-form-group">
                <label class="explorer-form-label">Transaction ID</label>
              <input
                type="text"
                bind:value={txidInput}
                placeholder="Enter the transaction hash..."
                  class="explorer-input"
              />
            </div>
            
            {#if proofError}
                <div class="explorer-alert error">{proofError}</div>
            {/if}
            
              <div class="explorer-form-actions">
              <button 
                on:click={validateProof}
                disabled={proofLoading}
                class="btn btn-primary"
              >
                {proofLoading ? 'Validating...' : 'Validate Proof'}
              </button>
              
              {#if proofResult}
                <button on:click={clearProofResult} class="btn btn-ghost">Clear</button>
              {/if}
            </div>
            
            {#if proofResult}
              <div class="proof-result {proofResult.valid ? 'valid' : 'invalid'}">
                {#if proofResult.valid}
                  <div class="proof-result-head valid">
                    <Check size={20} strokeWidth={2} />
                    <span>Proof Valid</span>
                  </div>
                  
                  <div class="proof-receivers">
                    {#each proofResult.addresses as address, i}
                      <div class="proof-receiver">
                        <div class="proof-receiver-head">
                          <span class="proof-receiver-label">Receiver {i + 1}</span>
                          <span class="proof-amount">{proofResult.amounts[i] || '?'} DERO</span>
                        </div>
                        {#if proofResult.supplyContexts[i]}
                          <div class="proof-supply-context">
                            <BarChart3 size={12} strokeWidth={2} />
                            <span>{proofResult.supplyContexts[i]}</span>
                          </div>
                        {/if}
                        <div class="proof-address">
                          <AddressDisplay 
                            {address} 
                            truncate={false} 
                            size="sm"
                            showCopy={true}
                          />
                        </div>
                        {#if proofResult.payloads[i]}
                          <div class="proof-payload">
                            <span class="proof-payload-label">Payload:</span>
                            <div class="proof-payload-value">{proofResult.payloads[i]}</div>
                          </div>
                        {/if}
                      </div>
                    {/each}
                    
                    {#if proofResult.warnings && proofResult.warnings.length > 0}
                      <div class="proof-warnings">
                        <div class="proof-warnings-head">
                          <AlertTriangle size={14} strokeWidth={2} />
                          <span>Warnings</span>
                        </div>
                        {#each proofResult.warnings as warning}
                          <div class="proof-warning-item">{warning}</div>
                        {/each}
                      </div>
                    {/if}
                    
                    <div class="proof-txid">
                      Transaction: <span class="proof-txid-value">{proofResult.txid}</span>
                    </div>
                  </div>
                {:else}
                  <div class="proof-result-head invalid">
                    <Shield size={20} strokeWidth={2} />
                    <span>Proof Rejected</span>
                  </div>
                  <p class="proof-error">{proofResult.error}</p>
                  {#if proofResult.securityNote}
                    <div class="proof-security-note">
                      <AlertTriangle size={14} strokeWidth={2} />
                      <span>{proofResult.securityNote}</span>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
            </div>
          </div>
        {:else if activeSection === 'mempool'}
          <!-- MEMPOOL: Transaction Pool Browser -->
          <div class="content-section-title">Mempool Browser</div>
          <p class="content-section-desc">View pending transactions in the memory pool</p>
          
          <div class="explorer-section">
            <div class="explorer-section-body">
              <!-- Refresh Button -->
              <div class="mempool-actions">
                <button 
                  on:click={loadMempoolData}
                  disabled={mempoolLoading}
                  class="btn btn-primary"
                >
                  {#if mempoolLoading}
                    <Loader2 size={14} class="spin" />
                    Loading...
                  {:else}
                    <Activity size={14} />
                    Refresh Mempool
                  {/if}
                </button>
                {#if mempoolData}
                  <span class="mempool-count">{mempoolData.count} of {mempoolData.total_count} transactions</span>
                {/if}
              </div>
              
              {#if mempoolLoading && !mempoolData}
                <div class="mempool-loading">
                  <Loader2 size={24} class="spin" />
                  <span>Loading mempool transactions...</span>
                </div>
              {:else if mempoolData}
                <!-- Mempool Stats -->
                <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                  <div class="cmd-panel-header">
                    <div class="cmd-panel-title">
                      <span class="cmd-panel-icon">◎</span>
                      MEMPOOL STATS
                    </div>
                    {#if mempoolData.truncated}
                      <span class="cmd-badge cmd-badge-warn">TRUNCATED</span>
                    {/if}
                  </div>
                  <div class="cmd-stats-unified cmd-stats-6col">
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon">☰</div>
                      <div class="cmd-stat-value">{mempoolData.count}</div>
                      <div class="cmd-stat-label">TRANSACTIONS</div>
                    </div>
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon">◆</div>
                      <div class="cmd-stat-value">{mempoolData.total_fees_dero || '0'}</div>
                      <div class="cmd-stat-label">TOTAL FEES</div>
                    </div>
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon">■</div>
                      <div class="cmd-stat-value">{mempoolData.total_size_kb || '0'} KB</div>
                      <div class="cmd-stat-label">TOTAL SIZE</div>
                    </div>
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon"><Zap size={14} strokeWidth={1.5} /></div>
                      <div class="cmd-stat-value">{mempoolData.type_stats?.NORMAL || 0}</div>
                      <div class="cmd-stat-label">NORMAL</div>
                    </div>
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon">◎</div>
                      <div class="cmd-stat-value">{mempoolData.type_stats?.SC || 0}</div>
                      <div class="cmd-stat-label">SC TXs</div>
                    </div>
                    <div class="cmd-stat-cell">
                      <div class="cmd-stat-icon">▼</div>
                      <div class="cmd-stat-value">{mempoolData.type_stats?.BURN || 0}</div>
                      <div class="cmd-stat-label">BURN TXs</div>
                    </div>
                  </div>
                </div>
                
                <!-- Transaction List -->
                {#if mempoolData.txs?.length > 0}
                  <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                    <div class="cmd-panel-header">
                      <div class="cmd-panel-title">
                        <span class="cmd-panel-icon">☰</span>
                        PENDING TRANSACTIONS
                      </div>
                      <span class="cmd-badge">{mempoolData.txs.length} shown</span>
                    </div>
                    <div class="cmd-list-content mempool-list">
                      {#each mempoolData.txs as tx, i}
                        <button
                          on:click={() => goToTx(tx.hash)}
                          class="cmd-list-item mempool-item"
                        >
                          <span class="cmd-list-index">#{i + 1}</span>
                          <span class="cmd-list-hash">{formatHash(tx.hash)}</span>
                          <span class="mempool-type-badge mempool-type-{tx.type?.toLowerCase()}">{tx.type}</span>
                          <span class="mempool-fee">{tx.fee_dero || '0'}</span>
                          <span class="mempool-size">{tx.size_kb} KB</span>
                          <span class="mempool-ring">Ring: {tx.ring_size}</span>
                          <ChevronRight size={12} strokeWidth={1.5} class="cmd-list-arrow" />
                        </button>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
                    <div class="cmd-empty-state">
                      <Activity size={20} strokeWidth={1.5} class="cmd-empty-icon" />
                      <span class="cmd-empty-text">Mempool is empty - no pending transactions</span>
                    </div>
                  </div>
                {/if}
              {:else}
                <div class="mempool-empty">
                  <Activity size={24} />
                  <span>Click "Refresh Mempool" to load pending transactions</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
    </div>
  </div>
</div>
{/if}

<!-- SC Discovery Modal -->
{#if showSCDiscoveryModal}
  <div class="modal-overlay" on:click={() => showSCDiscoveryModal = false}>
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Discover Smart Contracts</h2>
        <button class="modal-close" on:click={() => showSCDiscoveryModal = false}>
          <X size={20} />
        </button>
      </div>
      <div class="modal-body">
        <p class="text-muted" style="margin-bottom: var(--s-4);">Found {discoveredSCs.length} random smart contracts</p>
        <div class="cmd-list-content">
          {#each discoveredSCs as sc}
            <div 
              class="cmd-list-item" 
              on:click={() => { 
                searchSCDirectly(sc.scid); 
                showSCDiscoveryModal = false; 
              }}
            >
              <div class="cmd-list-hash">{sc.scid.slice(0, 16)}...</div>
              {#if sc.owner}
                <div class="text-muted" style="font-size: 11px; margin-top: 2px;">Owner: {sc.owner.slice(0, 12)}...</div>
              {/if}
              <div class="cmd-list-arrow">→</div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Version History Modal -->
<VersionHistory 
  scid={versionHistoryScid} 
  bind:show={showVersionHistory}
  on:close={closeVersionHistory}
  on:revert={handleVersionRevert}
  on:clone={handleVersionClone}
/>

<style>
  /* === HOLOGRAM v6.2 Explorer Page Styles === */
  /* Base layout uses .page-layout, .page-body, .page-sidebar, .page-content from hologram.css */
  
  /* === v6.2 Landing View Styles (merged from Search.svelte) === */
  .explorer-landing {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible; /* Allow glow effects to extend */
    background: var(--void-base, #0c0c14);
  }
  
  .bg-gradient {
    position: absolute;
    inset: 0;
    background: 
      radial-gradient(ellipse 150% 80% at 50% -20%, rgba(34, 211, 238, 0.06) 0%, transparent 70%),
      radial-gradient(ellipse 100% 60% at 100% 100%, rgba(167, 139, 250, 0.03) 0%, transparent 60%),
      radial-gradient(ellipse 100% 60% at 0% 100%, rgba(52, 211, 153, 0.02) 0%, transparent 60%);
    pointer-events: none;
  }
  
  .landing-content {
    position: relative;
    width: 100%;
    max-width: 700px;
    padding: var(--s-8, 32px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-8, 32px);
  }
  
  .landing-branding {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: var(--s-4, 16px);
    overflow: visible; /* Allow glow to extend */
  }
  
  .landing-tagline {
    font-size: 14px;
    font-style: italic;
    color: #707088;
    letter-spacing: 0.1em;
    margin: 0;
    padding: 0;
    text-align: center;
    opacity: 0.7;
  }
  
  .landing-search-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3, 12px);
  }
  
  .landing-recent-section {
    width: 100%;
    max-width: 560px;
    margin-top: var(--s-6, 24px);
    padding-top: var(--s-5, 20px);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.04));
  }
  
  .landing-recent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-3, 12px);
  }
  
  .landing-recent-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-5, #404058);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  
  .landing-recent-actions {
    display: flex;
    gap: var(--s-3, 12px);
  }
  
  .landing-link-btn {
    font-size: 11px;
    color: var(--text-4, #505068);
    background: none;
    border: none;
    cursor: pointer;
    transition: opacity var(--dur-fast, 100ms);
    opacity: 0.7;
  }
  
  .landing-link-btn:hover {
    opacity: 1;
    color: var(--text-2, #e0e0e8);
  }
  
  .landing-text-btn {
    font-size: 11px;
    color: var(--text-5, #404058);
    background: none;
    border: none;
    cursor: pointer;
    transition: color var(--dur-fast, 100ms);
  }
  
  .landing-text-btn:hover {
    color: var(--text-2, #e0e0e8);
  }
  
  .landing-recent-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2, 8px);
    justify-content: center;
  }
  
  .landing-recent-item {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-full, 9999px);
    cursor: pointer;
    transition: all var(--dur-fast, 100ms);
  }
  
  .landing-recent-item:hover {
    background: var(--void-mid, #12121c);
    border-color: rgba(34, 211, 238, 0.3);
  }
  
  .landing-recent-icon {
    color: var(--text-4, #505068);
    display: flex;
    align-items: center;
  }
  
  .landing-recent-query {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2, #e0e0e8);
  }
  
  .landing-footer {
    margin-top: auto;
    padding-top: var(--s-6, 24px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-4, 16px);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.04));
    width: 100%;
    max-width: 560px;
  }
  
  .landing-network-status {
    display: flex;
    align-items: center;
    gap: var(--s-6, 24px);
  }
  
  .landing-status-item {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  :global(.landing-status-icon) {
    color: var(--text-5, #404058);
  }
  
  .landing-status-label {
    font-size: 11px;
    color: var(--text-5, #404058);
  }
  
  .landing-shortcut-hint {
    font-size: 11px;
    color: var(--text-5, #404058);
    opacity: 0.6;
    transition: opacity var(--dur-fast, 100ms);
  }
  
  .landing-shortcut-hint:hover {
    opacity: 1;
  }
  
  .landing-shortcut-hint kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    background: var(--void-up, #181824);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-xs, 3px);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-3, #b3b3c3);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    margin-right: var(--s-1, 4px);
  }
  
  /* === End Landing View Styles === */
  
  /* Ensure Explorer page is properly contained */
  :global(.app-content) > .page-layout {
    contain: layout style paint;
  }
  
  /* Explorer Search in Header */
  .explorer-search-wrapper {
    min-width: 360px;
    display: flex;
    align-items: center;
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    padding: var(--s-1) var(--s-2);
  }
  
  /* Page header wrapper removed - now using flat .content-section-title / .content-section-desc pattern */

  /* Live indicator removed from section headers - LIVE badges exist inside panels */

  @keyframes pulse-glow {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  /* === v6.1 Explorer Section === */
  .explorer-section {
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    overflow: hidden;
    margin-bottom: var(--s-4);
  }
  
  .explorer-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .explorer-section-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  
  .explorer-section-icon {
    color: var(--cyan);
    font-size: 14px;
  }
  
  .explorer-section-badge {
    padding: 2px var(--s-2);
    font-size: 11px;
    font-weight: 500;
    border-radius: var(--r-xs);
  }
  
  .explorer-section-badge.warn {
    background: rgba(251, 191, 36, 0.15);
    color: var(--status-warn);
  }
  
  .explorer-section-body {
    padding: var(--s-4);
  }

  .explorer-section-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    border-top: 1px solid var(--border-dim);
  }

  /* === v6.1 Pagination === */
  .pagination-controls {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .pagination-btn {
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .pagination-btn:hover:not(:disabled) {
    background: var(--void-up);
    border-color: var(--border-default);
    color: var(--text-1);
  }
  
  .pagination-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  .pagination-info {
    padding: var(--s-2) var(--s-3);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  
  /* === v6.1 Explorer Empty State === */
  .explorer-empty {
    padding: var(--s-8);
    text-align: center;
    font-size: 13px;
    color: var(--text-4);
    margin: 0;
  }
  
  /* === v6.1 Explorer Loading === */
  .explorer-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-8);
    color: var(--cyan);
  }

  /* === v6.1 Explorer List === */
  .explorer-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .explorer-list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-sm);
    border: none;
    cursor: pointer;
    transition: background 150ms ease;
    text-align: left;
    width: 100%;
  }

  .explorer-list-item:hover:not(:disabled) {
    background: var(--void-up);
  }

  .explorer-list-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* === v6.1 Explorer Form Elements === */
  .explorer-form-group {
    margin-bottom: var(--s-4);
  }

  .explorer-form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
    margin-bottom: var(--s-2);
  }

  .explorer-input {
    width: 100%;
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-1);
    transition: border-color 150ms ease;
  }

  .explorer-input::placeholder {
    color: var(--text-5);
  }

  .explorer-input:focus {
    outline: none;
    border-color: var(--cyan);
  }

  .explorer-form-actions {
    display: flex;
    gap: var(--s-3);
    margin-top: var(--s-5);
  }

  .explorer-alert {
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    font-size: 13px;
    margin-bottom: var(--s-4);
  }

  .explorer-alert.error {
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.2);
    color: var(--status-err);
  }
  
  /* === v6.1 Explorer Hint & Guide === */
  .explorer-hint {
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.6;
    margin: 0;
  }

  .explorer-highlight {
    color: var(--cyan);
    font-weight: 500;
  }

  .explorer-button-group {
    display: flex;
    gap: var(--s-2);
  }

  .explorer-action-btn {
    padding: var(--s-2) var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .explorer-action-btn:hover {
    background: var(--void-up);
    border-color: var(--cyan);
    color: var(--cyan);
  }

  .explorer-bullet {
    color: var(--cyan);
    font-weight: 600;
  }

  .explorer-example {
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-sm);
  }
  
  .explorer-example-label {
    display: block;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-5);
    margin-bottom: var(--s-2);
  }

  .explorer-example-value {
    display: block;
    width: 100%;
    padding: 0;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--cyan);
    cursor: pointer;
    text-align: left;
    word-break: break-all;
    transition: opacity 150ms ease;
  }

  .explorer-example-value:hover {
    opacity: 0.8;
  }
  
  /* === v6.1 Proof Result === */
  .proof-result {
    margin-top: var(--s-5);
    padding: var(--s-4);
    border-radius: var(--r-md);
  }

  .proof-result.valid {
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.2);
  }

  .proof-result.invalid {
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.2);
  }

  .proof-result-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 14px;
    font-weight: 600;
    margin-bottom: var(--s-4);
  }

  .proof-result-head.valid {
    color: var(--status-ok);
  }

  .proof-result-head.invalid {
    color: var(--status-err);
  }

  .proof-receivers {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  
  .proof-receiver {
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-sm);
  }

  .proof-receiver-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-2);
  }

  .proof-receiver-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-4);
  }

  .proof-amount {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--cyan);
  }

  .proof-address {
    margin-bottom: var(--s-2);
  }

  .proof-payload {
    margin-top: var(--s-2);
    padding-top: var(--s-2);
    border-top: 1px solid var(--border-dim);
  }

  .proof-payload-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-5);
  }
  
  .proof-payload-value {
    margin-top: var(--s-1);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
    word-break: break-all;
  }
  
  .proof-txid {
    padding-top: var(--s-3);
    border-top: 1px solid var(--border-dim);
    font-size: 12px;
    color: var(--text-3);
  }
  
  .proof-txid-value {
    font-family: var(--font-mono);
    color: var(--text-2);
  }

  .proof-error {
    font-size: 13px;
    color: var(--status-err);
    margin: 0;
  }

  /* Supply Context */
  .proof-supply-context {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    font-size: 11px;
    color: var(--text-4);
    margin-bottom: var(--s-2);
  }

  .proof-supply-context :global(svg) {
    color: var(--text-5);
  }

  /* Proof Warnings */
  .proof-warnings {
    margin-top: var(--s-3);
    padding: var(--s-3);
    background: rgba(251, 191, 36, 0.06);
    border: 1px solid rgba(251, 191, 36, 0.15);
    border-radius: var(--r-sm);
  }

  .proof-warnings-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--status-warn, #fbbf24);
    margin-bottom: var(--s-2);
  }

  .proof-warning-item {
    font-size: 12px;
    color: var(--text-3);
    padding: var(--s-1) 0;
    padding-left: var(--s-4);
    border-left: 2px solid rgba(251, 191, 36, 0.3);
    margin-left: var(--s-1);
  }

  .proof-warning-item:not(:last-child) {
    margin-bottom: var(--s-1);
  }

  /* Security Note (for rejected proofs) */
  .proof-security-note {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin-top: var(--s-3);
    padding: var(--s-3);
    background: rgba(248, 113, 113, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.15);
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--text-3);
  }

  .proof-security-note :global(svg) {
    flex-shrink: 0;
    color: var(--status-err);
    margin-top: 1px;
  }
  
  /* === v6.1 Explorer Cards === */
  .explorer-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--s-6);
  }
  
  .explorer-card {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    padding: var(--s-5);
  }
  
  .explorer-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-4);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .list-item-left {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  .block-height {
    color: var(--cyan-400);
    font-weight: 500;
  }
  
  .block-meta {
    color: var(--text-4);
    font-size: 12px;
  }
  
  .block-age {
    color: var(--text-5);
    font-size: 11px;
  }
  
  .block-hash {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-4);
  }
  
  .tx-hash-mini {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  
  .tx-size {
    font-size: 11px;
    color: var(--text-4);
  }
  
  .mempool-count {
    font-size: 12px;
    color: var(--status-warn);
  }
  
  /* Block Rows - v6.1 Flat Style */
  .block-rows {
    display: flex;
    flex-direction: column;
  }
  
  .block-row {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-3) var(--s-5);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-dim);
    cursor: pointer;
    transition: background 120ms ease;
    text-align: left;
    width: 100%;
  }
  
  .block-row:last-child {
    border-bottom: none;
  }
  
  .block-row:hover {
    background: var(--void-up);
  }
  
  /* Explorer Loading */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  .explorer-loading-legacy {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-8);
  }
  
  .form-actions {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-4);
  }
  
  /* Keep nav-spacer for result navigation */
  .nav-spacer {
    flex: 1;
  }
  
  /* v6.1 Section Header Pattern */
  .result-section-header {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    margin-bottom: var(--s-6);
  }
  
  .result-type-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--cyan-400);
    padding: 3px var(--s-3);
    background: rgba(6, 182, 212, 0.08);
    border: 1px solid rgba(6, 182, 212, 0.25);
    border-radius: var(--r-xs);
  }
  
  .result-type-title {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.25em;
  }
  
  .result-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, var(--border-subtle) 0%, transparent 100%);
  }
  
  /* v6.1 Result Card */
  .result-card {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    padding: var(--s-6);
    position: relative;
    overflow: hidden;
  }
  
  .result-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--grad-primary);
  }
  
  /* v6.2 Navigation Bar - Design System Compliant */
  .nav-bar {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-bottom: var(--s-4);
    padding: var(--s-3);
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
  }
  
  /* Navigation Button Group (Back/Home, Prev/Next) */
  .nav-group {
    display: flex;
    align-items: center;
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  
  .nav-group-btn {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    font-size: 12px;
    color: var(--text-3);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .nav-group-btn:hover {
    color: var(--text-1);
    background: var(--void-hover);
  }
  
  .nav-group-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  .nav-group-btn:disabled:hover {
    background: transparent;
    color: var(--text-3);
  }
  
  /* Subtle divider between grouped buttons */
  .nav-group-btn:not(:last-child) {
    border-right: 1px solid var(--border-dim);
  }
  
  /* Block navigation specific styling */
  .nav-group.block-nav {
    background: var(--void-up);
  }
  
  .block-nav-current {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--cyan-400);
    padding: 0 var(--s-3);
    border-left: 1px solid var(--border-dim);
    border-right: 1px solid var(--border-dim);
  }
  
  /* Result Type Badge */
  .nav-type-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--s-1) var(--s-3);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: var(--r-sm);
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-3);
  }
  
  .nav-type-badge.nav-type-block {
    color: var(--cyan-400);
    border-color: rgba(34, 211, 238, 0.3);
  }
  
  .nav-type-badge.nav-type-tx {
    color: var(--violet-400);
    border-color: rgba(167, 139, 250, 0.3);
  }
  
  .nav-type-badge.nav-type-sc {
    color: var(--emerald-400);
    border-color: rgba(52, 211, 153, 0.3);
  }
  
  .nav-type-badge.nav-type-address {
    color: var(--pink-400);
    border-color: rgba(236, 72, 153, 0.3);
  }
  
  .nav-type-badge.nav-type-key,
  .nav-type-badge.nav-type-value,
  .nav-type-badge.nav-type-code {
    color: var(--amber-400);
    border-color: rgba(251, 191, 36, 0.3);
  }
  
  /* Close Button */
  .nav-close {
    padding: var(--s-2);
    color: var(--text-4);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .nav-close:hover {
    color: var(--text-1);
    background: var(--void-hover);
  }
  
  /* Spacer */
  .nav-spacer {
    flex: 1;
  }
  
  /* Legacy styles removed - using nav-group pattern now */
  .nav-btn {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    font-size: 12px;
    color: var(--text-3);
    background: transparent;
    border: none;
    border-radius: var(--r-md);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .nav-btn:hover {
    color: var(--text-1);
    background: var(--void-hover);
  }
  
  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  .block-nav {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .block-nav-btn {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: 6px var(--s-3);
    font-size: 11px;
    color: var(--text-2);
    background: var(--void-up);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .block-nav-btn:hover {
    color: var(--text-1);
    border-color: var(--border-default);
  }
  
  .block-nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  /* .block-nav-current moved to nav-group section above */
  
  /* Copy buttons */
  .copy-btn-sm {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-2);
    font-size: 10px;
    color: var(--cyan-400);
    background: var(--void-up);
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .copy-btn-sm:hover {
    background: rgba(6, 182, 212, 0.1);
  }
  
  .view-sc-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    color: var(--cyan-400);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 150ms ease;
  }
  
  .view-sc-btn:hover {
    color: var(--cyan-300);
  }
  
  /* Status icon wrapper */
  .status-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-full);
  }
  
  .status-icon-wrap.valid {
    background: rgba(52, 211, 153, 0.15);
    color: var(--status-ok);
  }
  
  .status-icon-wrap.invalid {
    background: rgba(248, 113, 113, 0.15);
    color: var(--status-err);
  }
  
  /* Proof Section (duplicate - consolidated) */
  .proof-section {
    margin-top: var(--s-6);
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-xl);
    padding: var(--s-6);
  }

  /* New Block Banner */

  @keyframes pulse-legacy {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.9); }
  }
  
  /* v6.1 New Block Notification - Utilitarian inline badge style */
  .new-block-notification {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: rgba(34, 211, 238, 0.08);
    border: 1px solid rgba(34, 211, 238, 0.25);
    border-radius: var(--r-sm);
    margin-bottom: var(--s-4);
    cursor: pointer;
    transition: all 150ms ease;
    font-family: var(--font-mono);
    color: var(--cyan-400);
    animation: notification-fade-in 0.25s ease;
  }
  
  .new-block-notification:hover {
    background: rgba(34, 211, 238, 0.12);
    border-color: rgba(34, 211, 238, 0.4);
    box-shadow: 0 0 12px rgba(34, 211, 238, 0.15);
  }
  
  @keyframes notification-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .new-block-notification-text {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-1);
  }
  
  .new-block-notification-action {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--cyan-400);
    margin-left: var(--s-1);
  }
  
  /* 
   * v6.1 Block Details - Global cmd-* styles are in hologram.css
   * Component-specific overrides only below
   */
  
  /* Explorer-specific: List hash color override (violet for tx hashes) */
  .cmd-list-hash {
    color: var(--violet-400);
  }
  
  /* Explorer-specific: Arrow animation */
  :global(.cmd-list-arrow) {
    transition: transform 100ms ease;
  }
  
  .cmd-list-item:hover :global(.cmd-list-arrow) {
    transform: translateX(2px);
    color: var(--cyan-400);
  }
  
  /* v6.1 Result Container */
  .cmd-result-container {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  
  /* v6.1 Clickable stat values */
  .cmd-clickable {
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    transition: color 100ms ease;
  }
  
  .cmd-clickable:hover {
    color: var(--violet-400);
  }
  
  /* v6.1 Pending status */
  .cmd-pending {
    color: var(--status-warn);
    font-style: italic;
  }
  
  /* v6.1 SC Code Preview */
  .cmd-code-preview {
    margin: 0;
    padding: var(--s-4);
    background: var(--void-deep);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-2);
    overflow-x: auto;
    max-height: 400px;
    border-top: 1px solid var(--border-subtle);
  }
  
  /* v6.1 Variable List */
  .cmd-vars-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border-subtle);
  }
  
  .cmd-var-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    gap: var(--s-4);
  }
  
  .cmd-var-key {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    min-width: 120px;
    flex-shrink: 0;
  }
  
  .cmd-var-key.string { color: var(--cyan-400); }
  .cmd-var-key.uint { color: var(--violet-400); }
  
  .cmd-var-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex: 1;
    min-width: 0;
  }
  
  .cmd-var-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .cmd-var-delete {
    padding: var(--s-1) var(--s-2);
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--r-xs);
    color: var(--status-err);
    font-size: 10px;
    cursor: pointer;
    transition: all 100ms ease;
  }
  
  .cmd-var-delete:hover {
    background: rgba(248, 113, 113, 0.2);
    border-color: rgba(248, 113, 113, 0.5);
  }
  
  .cmd-hex-toggle {
    padding: 1px 5px;
    background: rgba(34, 211, 238, 0.08);
    border: 1px solid rgba(34, 211, 238, 0.2);
    border-radius: var(--r-xs);
    color: var(--text-4);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 100ms ease;
    flex-shrink: 0;
  }
  
  .cmd-hex-toggle:hover {
    background: rgba(34, 211, 238, 0.15);
    border-color: rgba(34, 211, 238, 0.4);
    color: var(--cyan-400);
  }
  
  .cmd-hex-toggle.active {
    background: rgba(34, 211, 238, 0.2);
    border-color: rgba(34, 211, 238, 0.5);
    color: var(--cyan-400);
  }
  
  .cmd-var-hex {
    color: var(--text-4);
    font-size: 11px;
  }
  
  /* v6.1 Address icon */
  .cmd-address-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--void-deep);
    border-radius: var(--r-md);
    color: var(--cyan-400);
    flex-shrink: 0;
  }
  
  /* v6.1 SC List Item Info */
  .cmd-sc-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  
  .cmd-sc-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .cmd-sc-hash {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--cyan-400);
  }
  
  .cmd-sc-desc {
    font-size: 11px;
    color: var(--text-4);
    margin-top: 2px;
  }
  
  /* v6.1 Notice Panel */
  .cmd-notice {
    background: rgba(251, 191, 36, 0.05);
    border-color: rgba(251, 191, 36, 0.2);
  }
  
  .cmd-notice-content {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
  }
  
  :global(.cmd-notice-icon) {
    color: var(--status-warn);
    flex-shrink: 0;
    margin-top: 2px;
  }
  
  .cmd-notice-text {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: 13px;
    color: var(--text-3);
  }
  
  .cmd-notice-text strong {
    color: var(--status-warn);
    font-weight: 500;
  }
  
  /* v6.1 Privacy Panel */
  .cmd-privacy {
    background: var(--void-deep);
    border-color: var(--border-subtle);
  }
  
  .cmd-privacy-text {
    font-size: 12px;
    color: var(--text-4);
  }
  
  :global(.cmd-privacy .cmd-notice-icon) {
    color: var(--text-4);
  }
  
  /* v6.1 Badge variants */
  .cmd-badge.valid {
    background: rgba(52, 211, 153, 0.1);
    border-color: rgba(52, 211, 153, 0.3);
    color: var(--status-ok);
  }
  
  .cmd-badge.invalid {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.3);
    color: var(--status-err);
  }
  
  /* Block Details Styles - Data Card Pattern */
  .block-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--s-3);
    margin-bottom: var(--s-6);
  }
  
  .copy-hash-btn {
    padding: var(--s-2) var(--s-3);
    background: rgba(6, 182, 212, 0.1);
    border: 1px solid rgba(6, 182, 212, 0.3);
    border-radius: var(--r-sm);
    color: var(--cyan-400);
    font-size: 12px;
    cursor: pointer;
    transition: all 150ms ease;
    white-space: nowrap;
  }
  
  .copy-hash-btn:hover {
    background: rgba(6, 182, 212, 0.2);
    border-color: rgba(6, 182, 212, 0.4);
  }
  
  .block-txs-section {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    padding: var(--s-4);
  }
  
  .txs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--s-4);
  }
  
  .txs-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0;
  }
  
  :global(.title-icon) {
    color: var(--cyan-400);
    flex-shrink: 0;
  }
  
  .txs-count {
    font-size: 11px;
    color: var(--text-3);
    padding: var(--s-1) var(--s-2);
    background: rgba(6, 182, 212, 0.1);
    border-radius: var(--r-full);
  }
  
  .txs-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 250px;
    overflow-y: auto;
  }
  
  .tx-item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    background: var(--void-mid);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-md);
    cursor: pointer;
    transition: all 150ms ease;
    text-align: left;
  }
  
  .tx-item:hover {
    background: var(--void-up);
    border-color: rgba(6, 182, 212, 0.2);
  }
  
  .tx-index {
    font-size: 11px;
    color: var(--text-5);
    min-width: 30px;
  }
  
  .tx-hash {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  
  .tx-view {
    font-size: 11px;
    color: var(--cyan-400);
    font-weight: 500;
  }
  
  .no-txs-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-3);
    padding: var(--s-6);
    color: var(--text-5);
  }
  
  :global(.no-txs-icon) {
    color: var(--text-4);
  }
  
  .no-txs-text {
    font-size: 13px;
  }
  
  /* Scrollbar for tx list */
  .txs-list::-webkit-scrollbar {
    width: 4px;
  }
  
  .txs-list::-webkit-scrollbar-track {
    background: var(--void-deep);
    border-radius: 2px;
  }
  
  .txs-list::-webkit-scrollbar-thumb {
    background: rgba(6, 182, 212, 0.3);
    border-radius: 2px;
  }
  
  /* Address Search Result Styles */
  .address-header {
    display: flex;
    align-items: flex-start;
    gap: var(--s-4);
    padding: var(--s-4);
    background: rgba(236, 72, 153, 0.08);
    border: 1px solid rgba(236, 72, 153, 0.2);
    border-radius: var(--r-lg);
  }
  
  .address-icon-container {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(236, 72, 153, 0.15);
    border-radius: var(--r-lg);
    flex-shrink: 0;
  }
  
  .address-info {
    flex: 1;
    min-width: 0;
  }
  
  .address-label {
    display: block;
    font-size: 11px;
    color: var(--pink-400);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: var(--s-2);
  }
  
  .address-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  
  .address-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-1);
    word-break: break-all;
  }
  
  .address-status {
    display: flex;
    gap: var(--s-4);
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-lg);
  }
  
  .status-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .status-text {
    font-size: 13px;
    color: var(--text-3);
  }
  
  .gnomon-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-lg);
  }
  
  :global(.notice-icon) {
    color: var(--status-warn);
    flex-shrink: 0;
  }
  
  .notice-content {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .notice-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--status-warn);
  }
  
  .notice-text {
    font-size: 12px;
    color: var(--text-3);
  }
  
  /* dURL Search Result Styles */
  .durl-header {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4);
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.2);
    border-radius: var(--r-lg);
  }
  
  .durl-icon-container {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(52, 211, 153, 0.15);
    border-radius: var(--r-lg);
    flex-shrink: 0;
  }
  
  .durl-info {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .durl-label {
    font-size: 11px;
    color: var(--status-ok);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  
  .durl-value {
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text-1);
  }
  
  .durl-details {
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-lg);
  }
  
  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .detail-row:last-child {
    border-bottom: none;
  }
  
  .detail-label {
    font-size: 12px;
    color: var(--text-4);
  }
  
  .detail-value {
    color: var(--text-1);
  }
  
  .detail-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  .durl-not-found {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4);
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--r-lg);
  }
  
  .not-found-text {
    font-size: 13px;
    color: var(--status-err);
  }
  
  /* Owned SCIDs Section */
  .owned-scids-section {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    padding: var(--s-4);
  }
  
  .section-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  
  :global(.section-icon) {
    color: var(--text-3);
  }
  
  /* Unused .section-title removed - use global .content-section-title instead */
  
  .section-count {
    font-size: 11px;
    padding: 2px var(--s-2);
    background: rgba(167, 139, 250, 0.15);
    color: var(--violet-400);
    border-radius: var(--r-full);
    margin-left: auto;
  }
  
  .scid-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-height: 300px;
    overflow-y: auto;
  }
  
  .empty-scids {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-3);
    padding: var(--s-5);
    background: var(--void-mid);
    border-radius: var(--r-lg);
  }
  
  :global(.empty-icon) {
    color: var(--text-4);
    opacity: 0.7;
  }
  
  .empty-text {
    font-size: 13px;
    color: var(--text-5);
  }
  
  .privacy-note {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(6, 182, 212, 0.08);
    border: 1px solid rgba(6, 182, 212, 0.15);
    border-radius: var(--r-md);
  }
  
  :global(.privacy-icon) {
    color: var(--cyan-400);
    flex-shrink: 0;
  }
  
  .privacy-text {
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.4;
  }
  
  /* Scrollbar for scid list */
  .scid-list::-webkit-scrollbar {
    width: 4px;
  }
  
  .scid-list::-webkit-scrollbar-track {
    background: var(--void-deep);
    border-radius: 2px;
  }
  
  .scid-list::-webkit-scrollbar-thumb {
    background: rgba(167, 139, 250, 0.3);
    border-radius: 2px;
  }
  
  /* === v6.1 Global Data Card Styles === */
  :global(.data-card) {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    padding: var(--s-4);
    position: relative;
    overflow: hidden;
  }
  
  :global(.data-card::before) {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--grad-primary);
    z-index: 1;
  }
  
  :global(.data-label) {
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-5);
    margin-bottom: var(--s-2);
  }
  
  :global(.data-value) {
    font-size: 20px;
    font-weight: 500;
    font-family: var(--font-mono);
    color: var(--text-1);
  }
  
  /* === v6.1 Color Utility Classes === */
  
  /* Code syntax highlighting */
  .code-keyword {
    color: var(--violet-400);
    font-weight: 600;
  }
  
  .code-string {
    color: var(--status-ok);
  }
  
  /* Status indicators */
  .status-pending {
    color: var(--status-warn);
  }
  
  /* Balance display */
  .balance-value {
    color: var(--status-ok);
    font-weight: 500;
  }
  
  /* Variable keys */
  .var-key-string {
    color: var(--violet-400);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  
  .var-key-uint {
    color: var(--status-warn);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  
  /* Delete variable button */
  .btn-delete-var {
    color: var(--status-err);
    font-size: 12px;
    padding: 2px 6px;
    border-radius: var(--r-xs);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-delete-var:hover {
    color: rgba(248, 113, 113, 0.8);
    background: rgba(248, 113, 113, 0.2);
  }
  
  .btn-delete-var:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Wallet required indicator */
  .wallet-required {
    font-size: 12px;
    color: var(--status-warn);
  }
  
  /* Warning alert box */
  .alert-warn-box {
    padding: var(--s-3);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--r-lg);
    color: var(--status-warn);
    font-size: 13px;
    margin-bottom: var(--s-4);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .alert-icon {
    font-weight: 700;
  }
  
  /* === v6.1 Spacing Utility Classes === */
  
  /* Search Result Fields */
  .search-result-fields {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  
  .search-result-fields.lg {
    gap: var(--s-4);
  }
  
  .result-field {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  
  .result-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex: 1;
    justify-content: flex-end;
  }
  
  .result-hash {
    font-family: var(--font-mono);
    color: var(--text-1);
    font-size: 13px;
    word-break: break-all;
    text-align: right;
  }
  
  .btn-copy {
    font-size: 12px;
    color: var(--cyan-400);
    background: transparent;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 200ms ease-out;
  }
  
  .btn-copy:hover {
    color: var(--cyan-300);
  }
  
  .result-link {
    color: var(--cyan-400);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .result-link:hover {
    color: var(--cyan-300);
  }
  
  .result-amount {
    color: var(--cyan-400);
    font-weight: 500;
  }
  
  /* Code Section */
  .code-section {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .btn-copy-code {
    font-size: 12px;
    color: var(--text-5);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .btn-copy-code:hover {
    color: var(--cyan-400);
  }
  
  .code-preview {
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-lg);
    overflow-x: auto;
    font-size: 13px;
    max-height: 384px;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    line-height: 1.6;
  }
  
  /* Variables Section */
  .vars-section {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .vars-title {
    font-size: 13px;
    color: var(--text-4);
  }
  
  .vars-list {
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-lg);
    max-height: 192px;
    overflow-y: auto;
  }
  
  .var-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .var-row:last-child {
    border-bottom: none;
  }
  
  .var-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .var-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-3);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* Version Control Section - HOLOGRAM Design System */
  .version-control-actions {
    display: flex;
    gap: var(--s-3, 12px);
    padding: var(--s-4, 16px);
    flex-wrap: wrap;
  }
  
  .version-btn {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: 10px 16px;
    border-radius: var(--radius-md, 8px);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  
  .version-btn.primary {
    background: var(--cyan, #00d4aa);
    color: var(--void-pure, #0a0a0f);
  }
  
  .version-btn.primary:hover {
    background: var(--cyan-400, #00f5c4);
  }
  
  .version-btn.secondary {
    background: var(--void-up, #1a1a24);
    color: var(--text-secondary, #a8a8b8);
    border-color: var(--border-dim, rgba(255,255,255,0.06));
  }
  
  .version-btn.secondary:hover {
    background: var(--void-surface, #1e1e2a);
    border-color: var(--border-default, rgba(255,255,255,0.1));
    color: var(--text-primary, #e8e8f0);
  }
  
  .version-hint {
    padding: 0 var(--s-4, 16px) var(--s-4, 16px);
    font-size: 12px;
    color: var(--text-muted, #505068);
    margin: 0;
    line-height: 1.5;
  }
  
  .cmd-badge.tela {
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
    border: 1px solid rgba(167, 139, 250, 0.3);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    letter-spacing: 0.05em;
  }
  
  /* Interaction Section */
  .interaction-section {
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-dim);
  }
  
  .interaction-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 100%;
    font-size: 13px;
    color: var(--text-4);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: color 200ms ease-out;
  }
  
  .interaction-toggle:hover {
    color: var(--cyan-400);
  }
  
  .toggle-icon {
    font-size: 16px;
  }
  
  .interaction-badge {
    font-size: 11px;
    padding: 2px var(--s-2);
    background: rgba(6, 182, 212, 0.15);
    color: var(--cyan-400);
    border-radius: var(--r-full);
  }
  
  .interaction-panel {
    margin-top: var(--s-3);
    padding: var(--s-4);
    background: rgba(8, 8, 14, 0.8);
    border-radius: var(--r-lg);
    border: 1px solid var(--border-dim);
  }
  
  .interaction-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-4);
    gap: var(--s-2);
    color: var(--text-4);
    font-size: 13px;
  }
  
  .spinner-sm {
    width: 20px;
    height: 20px;
    border: 2px solid var(--cyan-500);
    border-top-color: transparent;
    border-radius: var(--r-full);
    animation: spin 0.6s linear infinite;
  }
  
  .interaction-empty {
    text-align: center;
    padding: var(--s-4);
    color: var(--text-5);
    font-size: 13px;
  }
  
  .interaction-empty p {
    font-size: 12px;
    margin-top: var(--s-1);
  }
  
  /* Activity Chart */
  .activity-chart-section {
    margin-bottom: var(--s-4);
  }
  
  .chart-label {
    font-size: 12px;
    color: var(--text-5);
    display: block;
    margin-bottom: var(--s-2);
  }
  
  .activity-bars {
    display: flex;
    align-items: flex-end;
    gap: var(--s-2);
    height: 64px;
    padding: 0 var(--s-2);
  }
  
  .activity-bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
  }
  
  .activity-bar {
    width: 100%;
    background: rgba(6, 182, 212, 0.5);
    border-radius: var(--r-xs) var(--r-xs) 0 0;
    transition: height 300ms ease-out;
  }
  
  .bar-label {
    font-size: 11px;
    color: var(--text-5);
  }
  
  /* Interaction List */
  .interaction-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 192px;
    overflow-y: auto;
  }
  
  .interaction-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-2);
    background: var(--void-mid);
    border-radius: var(--r-lg);
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 200ms ease-out;
  }
  
  .interaction-item:hover {
    background: var(--void-up);
  }
  
  .interaction-left {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .interaction-index {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .interaction-block {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--cyan-400);
  }
  
  .interaction-time {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .interaction-more {
    text-align: center;
    font-size: 12px;
    color: var(--text-5);
    padding: var(--s-2);
  }
  
  /* Variable Editor Section */
  .var-editor-section {
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-dim);
  }
  
  .var-editor-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 13px;
    color: var(--text-4);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .var-editor-toggle:hover {
    color: var(--cyan-400);
  }
  
  .var-editor-panel {
    margin-top: var(--s-3);
    padding: var(--s-4);
    background: rgba(8, 8, 14, 0.8);
    border-radius: var(--r-lg);
    border: 1px solid var(--border-dim);
  }
  
  .var-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  
  .var-form-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-3);
  }
  
  .var-form-field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .var-form-label {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .var-form-input {
    width: 100%;
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    color: var(--text-1);
    font-size: 13px;
    outline: none;
    transition: all var(--dur-fast);
  }
  
  .var-form-input::placeholder {
    color: var(--text-5);
  }
  
  .var-form-input:focus {
    border-color: var(--cyan-500);
    box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15);
  }
  
  /* Select dropdown - follows hologram.css .select pattern */
  .var-form-select {
    width: 100%;
    padding: var(--s-2) var(--s-3);
    padding-right: 36px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-1);
    background: var(--void-deep);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23707088' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    outline: none;
    cursor: pointer;
    transition: all var(--dur-fast);
  }
  
  .var-form-select:hover {
    border-color: var(--border-strong);
  }
  
  .var-form-select:focus {
    border-color: var(--cyan-500);
    box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15);
  }
  
  .var-form-select option {
    background: var(--void-deep);
    color: var(--text-1);
    padding: var(--s-2);
  }
  
  .var-form-input.mono {
    font-family: var(--font-mono);
  }
  
  .var-form-actions {
    display: flex;
    gap: var(--s-2);
  }
  
  .btn-set-var {
    padding: var(--s-2) var(--s-4);
    background: var(--emerald-400);
    color: var(--void-pure);
    border-radius: var(--r-lg);
    font-size: 13px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background 200ms ease-out;
  }
  
  .btn-set-var:hover {
    background: var(--emerald-300);
  }
  
  .btn-set-var:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-clear-var {
    padding: var(--s-2) var(--s-4);
    background: var(--void-up);
    color: var(--text-3);
    border-radius: var(--r-lg);
    font-size: 13px;
    border: none;
    cursor: pointer;
    transition: background 200ms ease-out;
  }
  
  .btn-clear-var:hover {
    background: var(--void-surface);
  }
  
  .var-form-hint {
    font-size: 12px;
    color: var(--text-5);
  }
  
  /* Address Result */
  .address-result {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  /* SCID Value */
  .scid-value {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  
  
  .btn-sm {
    padding: var(--s-1) var(--s-2);
    font-size: 11px;
  }
  
  /* Watch Button in SC Header */
  .watch-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .watch-btn.watching {
    color: var(--cyan, #00d4aa);
    border-color: rgba(0, 212, 170, 0.3);
  }
  
  .watch-btn.watching:hover {
    color: var(--text-secondary);
    border-color: var(--border-dim);
  }
  
  /* Time Machine Section */
  .time-machine-section {
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-dim);
  }
  
  .time-machine-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--text-2);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color var(--dur-fast);
  }
  
  .time-machine-toggle:hover {
    color: var(--text-1);
  }
  
  .snapshot-badge {
    font-size: 11px;
    color: var(--cyan-400);
    background: rgba(34, 211, 238, 0.1);
    padding: 2px 6px;
    border-radius: var(--r-sm);
    margin-left: var(--s-2);
  }
  
  .time-machine-panel {
    margin-top: var(--s-3);
  }
  
  .time-machine-loading,
  .time-machine-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-6);
    color: var(--text-4);
    font-size: 13px;
  }
  
  .time-machine-empty .hint {
    font-size: 12px;
    color: var(--text-5);
  }
  
  /* Snapshot Slider */
  .snapshot-slider-container {
    padding: var(--s-4) var(--s-2);
  }
  
  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-5);
    font-family: var(--font-mono);
    margin-bottom: var(--s-2);
  }
  
  .snapshot-slider {
    width: 100%;
    height: 4px;
    background: var(--void-up);
    border-radius: 2px;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  
  .snapshot-slider::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    background: var(--cyan-400);
    border-radius: 50%;
    cursor: grab;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: transform var(--dur-fast);
  }
  
  .snapshot-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }
  
  .snapshot-slider::-webkit-slider-thumb:active {
    cursor: grabbing;
  }
  
  .slider-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: var(--s-2);
    padding: 0 6px;
  }
  
  .slider-tick {
    width: 6px;
    height: 6px;
    background: var(--void-surface);
    border-radius: 50%;
    cursor: pointer;
    transition: all var(--dur-fast);
  }
  
  .slider-tick:hover {
    background: var(--text-4);
  }
  
  .slider-tick.active {
    background: var(--cyan-400);
    box-shadow: 0 0 6px var(--cyan-400);
  }
  
  /* Selected Snapshot Info */
  .selected-snapshot-info {
    background: var(--void-up);
    border-radius: var(--r-md);
    padding: var(--s-3);
    margin-top: var(--s-3);
  }
  
  .snapshot-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--s-3);
  }
  
  .snapshot-height {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }
  
  .snapshot-time {
    font-size: 12px;
    color: var(--text-4);
  }
  
  .snapshot-stats {
    display: flex;
    gap: var(--s-4);
    margin-bottom: var(--s-3);
  }
  
  .snapshot-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .snapshot-stat .stat-label {
    font-size: 11px;
    color: var(--text-5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .snapshot-stat .stat-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-2);
  }
  
  .snapshot-variables {
    border-top: 1px solid var(--border-dim);
    padding-top: var(--s-3);
  }
  
  .vars-header {
    font-size: 11px;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--s-2);
  }
  
  .vars-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .var-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-family: var(--font-mono);
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .var-row:last-child {
    border-bottom: none;
  }
  
  .var-key {
    color: var(--text-3);
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .var-value {
    color: var(--cyan-400);
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
  
  .vars-more {
    font-size: 11px;
    color: var(--text-5);
    text-align: center;
    padding: var(--s-2);
  }
  
  /* Compare Section */
  .compare-section {
    margin-top: var(--s-4);
    padding-top: var(--s-3);
    border-top: 1px solid var(--border-dim);
  }
  
  .compare-toggle {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-3);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  
  .compare-toggle:hover {
    color: var(--text-2);
  }
  
  .compare-controls {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-3);
    flex-wrap: wrap;
  }
  
  .compare-select {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .compare-select label {
    font-size: 12px;
    color: var(--text-4);
  }
  
  .compare-select select {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    background: var(--void-up);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    padding: var(--s-1) var(--s-2);
    cursor: pointer;
  }
  
  .compare-select select:focus {
    outline: none;
    border-color: var(--cyan-400);
  }
  
  /* Comparison Result */
  .comparison-result {
    background: var(--void-up);
    border-radius: var(--r-md);
    padding: var(--s-3);
    margin-top: var(--s-3);
  }
  
  .comparison-header {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    margin-bottom: var(--s-2);
  }
  
  .comparison-summary {
    display: flex;
    gap: var(--s-3);
    flex-wrap: wrap;
    font-size: 12px;
    font-family: var(--font-mono);
    margin-bottom: var(--s-3);
  }
  
  .change-added {
    color: var(--emerald-400);
  }
  
  .change-modified {
    color: var(--amber-400);
  }
  
  .change-removed {
    color: var(--rose-400);
  }
  
  .balance-diff {
    color: var(--cyan-400);
  }
  
  .changes-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .change-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 11px;
    font-family: var(--font-mono);
    padding: var(--s-1);
    border-radius: var(--r-sm);
  }
  
  .change-row.change-added {
    background: rgba(52, 211, 153, 0.1);
  }
  
  .change-row.change-modified {
    background: rgba(251, 191, 36, 0.1);
  }
  
  .change-row.change-removed {
    background: rgba(251, 113, 133, 0.1);
  }
  
  .change-type {
    font-size: 10px;
    text-transform: uppercase;
    padding: 2px 4px;
    border-radius: 2px;
    min-width: 50px;
    text-align: center;
  }
  
  .change-added .change-type {
    background: var(--emerald-400);
    color: var(--void-pure);
  }
  
  .change-modified .change-type {
    background: var(--amber-400);
    color: var(--void-pure);
  }
  
  .change-removed .change-type {
    background: var(--rose-400);
    color: var(--void-pure);
  }
  
  .change-key {
    color: var(--text-2);
    flex-shrink: 0;
  }
  
  .change-values {
    color: var(--text-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .changes-more {
    font-size: 11px;
    color: var(--text-5);
    text-align: center;
    padding: var(--s-2);
  }
  
  /* Panel Actions (multiple buttons in header) */
  .cmd-panel-actions {
    display: flex;
    gap: var(--s-2);
  }
  
  /* Change Timeline Section */
  .change-timeline-section {
    margin-top: var(--s-4);
    padding-top: var(--s-3);
    border-top: 1px solid var(--border-dim);
  }
  
  .timeline-badge {
    font-size: 10px;
    color: var(--cyan-400);
    background: rgba(34, 211, 238, 0.1);
    padding: 2px var(--s-2);
    border-radius: var(--r-sm);
    margin-left: var(--s-2);
  }
  
  .change-timeline-content {
    margin-top: var(--s-3);
  }
  
  .timeline-loading,
  .timeline-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    color: var(--text-4);
    font-size: 12px;
  }
  
  .timeline-empty .hint {
    font-size: 11px;
    color: var(--text-5);
  }
  
  .timeline-list {
    position: relative;
    padding-left: var(--s-4);
  }
  
  .timeline-event {
    position: relative;
    padding-bottom: var(--s-3);
  }
  
  .timeline-event:last-child {
    padding-bottom: 0;
  }
  
  .timeline-event:last-child .timeline-line {
    display: none;
  }
  
  .timeline-dot {
    position: absolute;
    left: -16px;
    top: var(--s-1);
    width: 8px;
    height: 8px;
    background: var(--cyan-400);
    border-radius: 50%;
    z-index: 1;
  }
  
  .timeline-line {
    position: absolute;
    left: -13px;
    top: 12px;
    bottom: -4px;
    width: 2px;
    background: var(--border-dim);
  }
  
  .timeline-content {
    background: var(--void-up);
    border-radius: var(--r-sm);
    padding: var(--s-2) var(--s-3);
  }
  
  .timeline-header {
    margin-bottom: var(--s-1);
  }
  
  .timeline-heights {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-2);
  }
  
  .timeline-changes {
    display: flex;
    gap: var(--s-2);
    font-size: 11px;
    font-family: var(--font-mono);
  }
  
  .code-changed {
    color: var(--purple-400);
  }
  
  /* Spin animation for loaders */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  /* === Simulator Banner === */
  .simulator-banner {
    width: 100%;
    padding: 0 var(--s-4, 16px);
    margin-bottom: var(--s-3, 12px);
  }
  
  .simulator-banner-inner {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-sm, 6px);
    font-size: 12px;
    color: var(--text-3);
  }
  
  .simulator-banner-icon {
    color: var(--status-warn, #fbbf24);
    flex-shrink: 0;
  }
  
  .simulator-banner-text {
    line-height: 1.4;
  }
  
  .simulator-banner-text strong {
    color: var(--text-1);
    font-weight: 500;
  }

  /* === Fresh Simulator Chain Banner === */
  .simulator-fresh-chain-banner {
    width: 100%;
    padding: 0 var(--s-4, 16px);
    margin-bottom: var(--s-3, 12px);
  }

  .simulator-fresh-chain-inner {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: rgba(99, 102, 241, 0.08);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: var(--r-sm, 6px);
    font-size: 12px;
    color: var(--text-3);
  }

  .simulator-fresh-chain-icon {
    color: var(--status-info, #6366f1);
    flex-shrink: 0;
  }

  .simulator-fresh-chain-spinner {
    animation: spin 1s linear infinite;
  }

  .simulator-fresh-chain-text {
    line-height: 1.4;
    flex: 1;
  }

  .simulator-fresh-chain-text strong {
    color: var(--text-1);
    font-weight: 500;
  }

  .simulator-fresh-chain-dismiss {
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--r-sm, 4px);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .simulator-fresh-chain-dismiss:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-1);
  }

  /* === SC TX Redirect === */
  .sc-tx-redirect-row {
    background: rgba(99, 102, 241, 0.06);
    border-radius: var(--r-sm, 6px);
    padding: var(--s-2, 8px) var(--s-3, 12px);
    border: 1px solid rgba(99, 102, 241, 0.15);
  }

  .sc-tx-redirect-btn {
    color: var(--status-info, #6366f1) !important;
    font-weight: 500;
  }

  /* === Simulator Status in Landing Footer === */
  .landing-status-simulator {
    color: var(--status-warn, #fbbf24);
  }
</style>
