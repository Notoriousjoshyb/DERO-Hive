<script>
  import { walletState, appState, settingsState, addressMasked, balanceMasked, toast, handleBackendError, syncNetworkMode, pendingPayment, clearPendingPayment } from '../lib/stores/appState.js';
  import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime.js';
  import { OpenWallet, CloseWallet, GetBalance, GetWalletStatus, ListRecentWallets, GetRecentWalletsWithInfo, RemoveRecentWallet, ClearRecentWallets, ConnectXSWD, SelectWalletFile, CreateWallet, RestoreWallet, GetTransactionHistory, GetIntegratedAddress, InternalWalletCall, GetAddressBook, DeleteContact, SignMessage, VerifySignature, GetSeedPhrase, GetWalletKeys, GetSimulatorTestWallets, SyncSimulatorTestWallets, OpenSimulatorTestWallet, FundTestWallet, RefreshTestWalletBalance, SaveFileWithDialog, SyncWallet, GetWalletSyncStatus, ChangeWalletPassword, SetTransactionLabel, GetAllTransactionLabels, GetTransactionLabel, DeleteTransactionLabel, CreatePaymentRequest, DecodeIntegratedAddress, GetMiningEarningsSummary, GetWalletMiningEarnings, IsWalletOpen, GetCurrentWalletPath, SubscribeToWalletEvents, UnsubscribeFromEvents, GetRegistrationStatus, RegisterWallet, CancelRegistration } from '../../wailsjs/go/main/App.js';
  import { onMount, onDestroy } from 'svelte';
  import { 
    Copy, ArrowUp, ArrowDown, ArrowLeftRight,
    Wallet, Plus, RotateCcw, AlertTriangle, Check, FolderOpen, Pickaxe,
    LayoutDashboard, QrCode, History, Coins, Users, FileSignature, RefreshCw,
    Loader2, Download, Search, ChevronRight, ExternalLink, Edit, Trash2, Send, Shield,
    Key, Eye, X
  } from 'lucide-svelte';
  
  import TokenPortfolio from '../lib/components/TokenPortfolio.svelte';
  import QRCodeComponent from '../lib/components/QRCode.svelte';
  import AddContactModal from '../lib/components/AddContactModal.svelte';
  import PasswordInput from '../lib/components/PasswordInput.svelte';
  import RevealSecretModal from '../lib/components/RevealSecretModal.svelte';
  
  // ============================================
  // NAVIGATION STATE
  // ============================================
  let activeSection = 'dashboard';
  
  const sidebarSections = {
    overview: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
    transactions: [
      { id: 'send', label: 'Send', icon: ArrowUp },
      { id: 'receive', label: 'Receive', icon: ArrowDown },
      { id: 'request', label: 'Request Payment', icon: QrCode },
      { id: 'history', label: 'History', icon: History },
    ],
    portfolio: [
      { id: 'tokens', label: 'Tokens', icon: Coins },
    ],
    tools: [
      { id: 'addressbook', label: 'Address Book', icon: Users },
      { id: 'sign', label: 'Sign Message', icon: FileSignature },
      { id: 'backup', label: 'Backup & Security', icon: Shield },
    ]
  };
  
  // ============================================
  // LOGIN TAB STATE
  // ============================================
  let activeTab = 'open'; // 'open' | 'create' | 'restore'
  
  // Open wallet form
  let walletPath = '';
  let password = '';
  let loading = false;
  let error = null;
  let recentWallets = [];
  let recentWalletsInfo = [];
  let showClearWalletsConfirm = false;
  let clearingRecentWallets = false;
  
  // Test wallets (Simulator mode)
  let testWallets = [];
  let testWalletsLoading = false;
  let selectedTestWallet = null;
  let testWalletsExpanded = false; // Show all 22 or just first 10
  let fundingWallet = false;
  
  // Create wallet form
  let createPath = '';
  let createPassword = '';
  let createPasswordConfirm = '';
  let createdSeed = null;
  let seedConfirmed = false;
  let createLoading = false;
  let createError = null;
  
  // Restore wallet form
  let restorePath = '';
  let restorePassword = '';
  let restorePasswordConfirm = '';
  let restoreSeed = '';
  let restoreLoading = false;
  let restoreError = null;
  
  // ============================================
  // WALLET DATA STATE
  // ============================================
  let transactionHistory = [];
  let transactionLabels = {};
  let dashboardLoading = true;
  
  // ============================================
  // SEND SECTION STATE (3-step flow)
  // ============================================
  let sendStep = 1; // 1: Enter, 2: Review, 3: Success
  let sendDest = '';
  let sendAmount = '';
  let sendRingsize = 16;
  let sendPassword = '';
  let sendError = null;
  let sendTxid = null;
  let sendLoading = false;
  let showContactPicker = false;
  let showFullSendAddress = false;
  
  // ============================================
  // RECEIVE SECTION STATE
  // ============================================
  let addressType = 'standard'; // 'standard' | 'integrated'
  let receiveIntegratedAddress = '';
  let receiveIntegratedLoading = false;
  let integratedPort = '';
  let integratedComment = '';

  // ============================================
  // REQUEST PAYMENT STATE
  // ============================================
  let requestAmount = '';
  let requestDesc = '';
  let requestComment = '';
  let requestIntegratedAddress = '';
  let requestIntegratedLoading = false;
  let _payReqDebounceTimer = null;
  let _payReqInflight = false;
  let _payReqLastGen = { amt: null, cmt: null };

  // ============================================
  // SEND - INTEGRATED ADDRESS DETECTION
  // ============================================
  let decodedPaymentInfo = null;

  // ============================================
  // SMART-PASTE STATE
  // ============================================
  let paymentParsed = null;
  let paymentState = { state: 'pending', severity: 'info', reason: '' };
  let paymentDecodeAttempted = false;
  let lastParsedAddress = null;
  let uriAckSpoofable = false;
  let uriAckSelfPay = false;
  let editingMalformed = false;
  let paymentMorphFired = false;
  
  // ============================================
  // MINING EARNINGS STATE
  // ============================================
  let miningEarnings = [];
  let miningEarningsSummary = null;
  
  // ============================================
  // WALLET PATH & EVENTS STATE
  // ============================================
  let currentWalletPath = '';
  
  // ============================================
  // HISTORY SECTION STATE
  // ============================================
  let historyFilter = 'all'; // 'all' | 'in' | 'out' | 'mining'
  let historySearch = '';
  let historyLimit = 50;
  let historyHasMore = false;
  let historyLoadingMore = false;
  let expandedTxId = null;
  
  // ============================================
  // SYNC STATUS
  // ============================================
  let syncStatus = null; // { synced, walletHeight, daemonHeight, behindBlocks }
  let isSyncing = false;
  
  // ============================================
  // REGISTRATION STATUS
  // ============================================
  let registrationStatus = null; // { isRegistered, registrationHeight, registrationProgress, hashCount, elapsedSeconds }
  let isRegistering = false;
  let registrationHashCount = 0;
  let registrationElapsed = 0;
  let registrationPending = false; // TX sent, waiting for blockchain confirmation
  let registrationTxid = '';
  
  // ============================================
  // ADDRESS BOOK STATE
  // ============================================
  let contacts = [];
  let contactsLoading = false;
  let showAddContact = false;
  let editingContact = null;
  let contactSearch = '';
  let confirmDeleteContactId = null;
  
  // ============================================
  // SIGN/VERIFY STATE
  // ============================================
  let signTab = 'sign'; // 'sign' | 'verify'
  let messageToSign = '';
  let signedResult = null;
  let signLoading = false;
  let verifyInput = '';
  let verifyResult = null;
  let verifyLoading = false;
  
  // ============================================
  // BACKUP & SECURITY STATE
  // ============================================
  // NOTE: The decrypted seed and keys intentionally do NOT live here. They are
  // owned by <RevealSecretModal/> children below so that unmounting the modal
  // (close, ESC, wallet switch, wallet close, route change) drops the only
  // reference and lets GC reclaim the secret. This matches Engram's invariant
  // that the seed is only read live from the open wallet at render time.
  let showSeedModal = false;
  let showKeysModal = false;

  // Change Password state
  let changePasswordCurrent = '';
  let changePasswordNew = '';
  let changePasswordConfirm = '';
  let changePasswordLoading = false;
  let changePasswordError = null;
  let changePasswordSuccess = false;
  
  // Transaction Labels state
  let editingLabelTxid = null;
  let editingLabelValue = '';
  let savingLabel = false;
  
  // ============================================
  // COMPUTED VALUES
  // ============================================
  $: createPasswordsMatch = createPassword === createPasswordConfirm && createPassword.length > 0;
  $: passwordStrength = getPasswordStrength(createPassword);
  $: restorePasswordsMatch = restorePassword === restorePasswordConfirm && restorePassword.length > 0;
  $: seedWordCount = restoreSeed.trim().split(/\s+/).filter(w => w.length > 0).length;
  $: isValidSeed = seedWordCount === 25;
  $: changePasswordsMatch = changePasswordNew === changePasswordConfirm && changePasswordNew.length > 0;
  $: canChangePassword = changePasswordCurrent.trim() && changePasswordsMatch;
  $: walletDisplayPath = $walletState.walletPath || currentWalletPath;
  
  // Send validation
  $: availableBalance = $walletState.balance / 100000;
  $: sendAmountAtomic = Math.round(parseFloat(sendAmount || '0') * 100000);
  $: isValidSendAmount = !isNaN(sendAmountAtomic) && sendAmountAtomic > 0 && sendAmountAtomic <= $walletState.balance;
  $: isValidSendAddress = sendDest.startsWith('dero1') || sendDest.startsWith('deroi1') || sendDest.startsWith('deto1') || sendDest.startsWith('detoi1');
  $: sendBlockedByUriState = paymentState && (
    paymentState.state === 'malformed' ||
    paymentState.state === 'corrupted' ||
    paymentState.state === 'wrongNetwork' ||
    (paymentState.state === 'spoofable' && !uriAckSpoofable) ||
    (paymentState.state === 'selfPayment' && !uriAckSelfPay) ||
    (paymentState.state === 'pending' && paymentParsed?.kind === 'integrated' && paymentParsed?.needsDecode)
  );
  $: canSend = isValidSendAmount && isValidSendAddress && !sendBlockedByUriState;
  
  // Reactive display address for Receive section
  $: displayAddress = (addressType === 'integrated' && receiveIntegratedAddress) ? receiveIntegratedAddress : $walletState.address;

  // Payment URI sourced from deroi1 integrated address (amount + comment baked into payload).
  // ?desc= is the off-chain note only — the embedded comment lives inside the deroi1 payload.
  $: paymentUri = (() => {
    if (requestIntegratedAddress) {
      const note = (requestDesc && requestDesc.trim()) ? '?desc=' + encodeURIComponent(requestDesc.trim()) : '';
      return `dero://${requestIntegratedAddress}${note}`;
    }
    return '';
  })();

  // Debounced auto-generator scoped to the Request section. The _payReqLastGen guard
  // prevents post-resolution re-fires when no input has actually changed.
  $: {
    if (activeSection !== 'request') {
      clearTimeout(_payReqDebounceTimer);
    } else {
      const amt = parseFloat(requestAmount || '0');
      const hasInput = amt > 0 || (requestComment && requestComment.trim().length > 0);
      const inputChanged = (_payReqLastGen.amt !== requestAmount || _payReqLastGen.cmt !== requestComment);
      if (hasInput && !_payReqInflight && inputChanged) {
        clearTimeout(_payReqDebounceTimer);
        const snapshotAmt = requestAmount;
        const snapshotCmt = requestComment;
        _payReqDebounceTimer = setTimeout(() => {
          if (snapshotAmt !== requestAmount || snapshotCmt !== requestComment) return;
          _payReqLastGen = { amt: snapshotAmt, cmt: snapshotCmt };
          createPaymentRequest();
        }, 400);
      } else if (!hasInput && requestIntegratedAddress && !_payReqInflight) {
        requestIntegratedAddress = '';
        _payReqLastGen = { amt: null, cmt: null };
      }
    }
  }
  
  // Filtered history
  $: filteredHistory = transactionHistory.filter(tx => {
    if (historyFilter === 'in' && !tx.incoming) return false;
    if (historyFilter === 'out' && (tx.incoming || tx.coinbase)) return false;
    if (historyFilter === 'mining' && !tx.coinbase) return false;
    if (historySearch && tx.txid && !tx.txid.toLowerCase().includes(historySearch.toLowerCase())) {
      return false;
    }
    return true;
  });

  // Grouped history by date
  $: groupedHistory = (() => {
    const groups = [];
    let currentGroup = null;
    for (const tx of filteredHistory) {
      const label = getDateGroupLabel(tx.time);
      if (!currentGroup || currentGroup.label !== label) {
        currentGroup = { label, transactions: [] };
        groups.push(currentGroup);
      }
      currentGroup.transactions.push(tx);
    }
    return groups;
  })();
  
  // Seed words display
  $: seedWords = createdSeed ? createdSeed.split(' ') : [];
  
  // Load mining earnings when mining filter is selected
  $: if (historyFilter === 'mining') {
    loadMiningEarnings();
  }
  
  // Smart-paste owns full Recipient pipeline: parse -> normalize sendDest -> classify -> decode.
  $: handlePaymentInput(sendDest);
  
  // Scroll to top when section changes
  let pageContentEl;
  $: if (activeSection && pageContentEl) {
    pageContentEl.scrollTop = 0;
  }

  // Load contacts when entering send section (for contact picker)
  $: if (activeSection === 'send' && contacts.length === 0) {
    loadContacts();
  }
  
  // ============================================
  // POLLING
  // ============================================
  // Heartbeat is intentionally tight (Engram-style "pulse") so the dashboard
  // feels live. Per-tick work is three in-memory walletapi reads -- balance,
  // height, daemon height -- plus a transaction-history reload only when the
  // wallet height has actually advanced. Push channels (wallet:newTransaction,
  // wallet:balanceChanged) supplement this when XSWD is subscribed. A full
  // SyncWallet is reserved for explicit user actions (manual Refresh, wallet
  // open, registration complete) where the user is waiting on freshness.
  const WALLET_REFRESH_INTERVAL_MS = 5000;
  let refreshInterval;
  let activeRefresh = null;
  let lastSyncedWalletHeight = 0;

  function startPolling() {
    stopPolling();
    refreshInterval = setInterval(() => {
      refreshWalletSnapshot({ notifyIncoming: true });
    }, WALLET_REFRESH_INTERVAL_MS);
  }

  function stopPolling() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }
  
  // ============================================
  // LIFECYCLE
  // ============================================
  onMount(async () => {
    try {
      const status = await GetWalletStatus();
      if (status.isOpen) {
        walletState.update(state => ({
          ...state,
          isOpen: true,
          address: status.address,
          walletPath: status.path,
        }));
        walletPath = status.path || '';
        await refreshWalletSnapshot({ forceSync: true });
        dashboardLoading = false;
        startPolling();
        loadWalletPath();
        SubscribeToWalletEvents().catch(() => {});
      } else {
        dashboardLoading = false;
      }
      
      await refreshRecentWallets();
      
      // Load test wallets if in simulator mode
      if ($settingsState.network === 'simulator') {
        await loadTestWallets();
      }
      
      // Listen for simulator mode activation
      EventsOn('simulator:complete', async (data) => {
        await syncNetworkMode();
        await loadTestWallets();
      });
      
      // Listen for background sync warnings (daemon connectivity / initial sync timeout)
      EventsOn('wallet:sync_warning', (data) => {
        if (data?.message) {
          toast.warning(data.message);
        }
      });
      EventsOn('wallet:daemon_connection_warning', (data) => {
        console.warn('[WALLET] Daemon connection warning:', data);
      });

      EventsOn('wallet:newTransaction', () => {
        refreshWalletSnapshot({ forceHistory: true, notifyIncoming: true });
      });

      EventsOn('wallet:balanceChanged', () => {
        refreshWalletSnapshot();
      });
      
      // Listen for wallet unregistered status (new wallets)
      EventsOn('wallet:unregistered', (data) => {
        if (data?.message) {
          toast.info(data.message);
        }
        // Refresh registration status
        checkRegistrationStatus();
      });
      
      // Listen for registration events
      EventsOn('wallet:registration_started', (data) => {
        isRegistering = true;
        registrationHashCount = 0;
        registrationElapsed = 0;
        if (data?.message) {
          toast.info(data.message);
        }
      });
      
      EventsOn('wallet:registration_progress', (data) => {
        if (data) {
          registrationHashCount = data.hashCount || 0;
          registrationElapsed = data.elapsed || 0;
        }
      });
      
      EventsOn('wallet:registration_pending', (data) => {
        // TX sent, waiting for blockchain confirmation
        isRegistering = false; // PoW is done
        registrationPending = true; // Now waiting for confirmation
        registrationHashCount = 0;
        registrationElapsed = 0;
        if (data?.txid) registrationTxid = data.txid;
        if (data?.message) {
          toast.info(data.message);
        }
      });
      
      EventsOn('wallet:registration_complete', async (data) => {
        isRegistering = false;
        registrationPending = false;
        registrationHashCount = 0;
        registrationElapsed = 0;
        registrationTxid = '';
        if (data?.message) {
          toast.success(data.message);
        }
        // Full refresh after registration - status, balance, sync
        await checkRegistrationStatus();
        await refreshBalance(true);
      });
      
      EventsOn('wallet:registration_failed', (data) => {
        isRegistering = false;
        registrationPending = false;
        registrationTxid = '';
        if (data?.error) {
          toast.error(`Registration failed: ${data.error}`);
        }
      });
      
      EventsOn('wallet:registration_cancelled', (data) => {
        isRegistering = false;
        registrationPending = false;
        registrationTxid = '';
        if (data?.message) {
          toast.info(data.message);
        }
      });

      // Listen for network mode changes
      EventsOn('network-mode-changed', async () => {
        await syncNetworkMode();
        if ($settingsState.network === 'simulator') {
          await loadTestWallets();
        } else {
          // Clear test wallets when switching away from simulator
          testWallets = [];
          selectedTestWallet = null;
        }
      });
      
      // Listen for section navigation from Sidebar
      const handleNavigateSection = (e) => {
        const { section } = e.detail;
        if (section && Object.values(sidebarSections).flat().find(s => s.id === section)) {
          activeSection = section;
        }
      };
      window.addEventListener('navigate-section', handleNavigateSection);
      // Store handler for cleanup
      window._walletNavigateHandler = handleNavigateSection;

      // Subscribe to pendingPayment — deep links and Browser redirects land here.
      window._walletPaymentUnsub = pendingPayment.subscribe(p => {
        if (!p || !p.uri) return;
        activeSection = 'send';
        const stripped = p.uri.toLowerCase().startsWith('dero://') ? p.uri.slice(7) : p.uri;
        sendDest = stripped;
        clearPendingPayment();
      });
    } catch (err) {
      console.error('Error checking wallet status:', err);
    }
  });
  
  onDestroy(() => {
    stopPolling();
    EventsOff('simulator:complete');
    EventsOff('network-mode-changed');
    EventsOff('wallet:sync_warning');
    EventsOff('wallet:daemon_connection_warning');
    EventsOff('wallet:newTransaction');
    EventsOff('wallet:balanceChanged');
    EventsOff('wallet:unregistered');
    EventsOff('wallet:registration_started');
    EventsOff('wallet:registration_progress');
    EventsOff('wallet:registration_pending');
    EventsOff('wallet:registration_complete');
    EventsOff('wallet:registration_failed');
    EventsOff('wallet:registration_cancelled');
    UnsubscribeFromEvents();
    // Clean up section navigation listener
    if (window._walletNavigateHandler) {
      window.removeEventListener('navigate-section', window._walletNavigateHandler);
      delete window._walletNavigateHandler;
    }
    if (window._walletPaymentUnsub) {
      window._walletPaymentUnsub();
      delete window._walletPaymentUnsub;
    }
    if (_payReqDebounceTimer) {
      clearTimeout(_payReqDebounceTimer);
      _payReqDebounceTimer = null;
    }
  });
  
  // Reactive: Load test wallets when network mode changes to simulator
  $: if ($settingsState.network === 'simulator' && !$walletState.isOpen && testWallets.length === 0) {
    loadTestWallets();
  }
  
  // ============================================
  // TEST WALLET FUNCTIONS (Simulator Mode)
  // ============================================
  
  // Fund a test wallet by consolidating balance from other wallets
  async function fundWallet(targetIndex, amount = 2000000) {
    if (fundingWallet) return;
    fundingWallet = true;
    try {
      const result = await FundTestWallet(targetIndex, amount);
      if (result.success) {
        toast.success(`Funded wallet with ${(result.totalTransferred / 100000).toFixed(5)} DERO`);
        
        // The backend already syncs the balance, but we need to refresh the UI
        // Use the new direct balance refresh for the target wallet
        const refreshResult = await RefreshTestWalletBalance(targetIndex);
        if (refreshResult.success && refreshResult.wallet) {
          // Update the selected wallet with the new balance
          selectedTestWallet = refreshResult.wallet;
          
          // Update in the list too
          const idx = testWallets.findIndex(w => w.index === targetIndex);
          if (idx >= 0) {
            testWallets[idx] = refreshResult.wallet;
            testWallets = [...testWallets]; // Trigger reactivity
          }
        }
        
        // Also refresh all wallets to update source wallet balances
        await syncTestWallets(false);
        
        // If this wallet is currently connected, refresh the dashboard balance
        if ($walletState.isOpen && selectedTestWallet?.index === targetIndex) {
          await refreshBalance();
        }
      } else {
        toast.error(result.error || 'Failed to fund wallet');
      }
    } catch (err) {
      toast.error('Failed to fund wallet: ' + err.message);
    } finally {
      fundingWallet = false;
    }
  }
  async function loadTestWallets() {
    if (testWalletsLoading) return;
    testWalletsLoading = true;
    try {
      const result = await GetSimulatorTestWallets();
      if (result.success && result.wallets) {
        testWallets = result.wallets;
      } else {
        testWallets = [];
      }
    } catch (err) {
      console.error('Error loading test wallets:', err);
      testWallets = [];
    } finally {
      testWalletsLoading = false;
    }
  }
  
  async function syncTestWallets(showToast = true) {
    testWalletsLoading = true;
    try {
      const result = await SyncSimulatorTestWallets();
      if (result.success && result.wallets) {
        testWallets = result.wallets;
        
        // Update selectedTestWallet if it exists
        if (selectedTestWallet) {
          const updated = result.wallets.find(w => w.index === selectedTestWallet.index);
          if (updated) {
            selectedTestWallet = updated;
          }
        }
        
        // Also refresh the main wallet balance if a test wallet is connected
        if ($walletState.isOpen) {
          await refreshBalance();
        }
        
        if (showToast) {
          toast.success('Test wallets synced');
        }
      }
    } catch (err) {
      console.error('Error syncing test wallets:', err);
      if (showToast) {
        toast.error('Failed to sync test wallets');
      }
    } finally {
      testWalletsLoading = false;
    }
  }
  
  async function openTestWallet(wallet) {
    // Use the dedicated backend function to open test wallets
    loading = true;
    error = null;
    selectedTestWallet = wallet;
    
    try {
      const result = await OpenSimulatorTestWallet(wallet.index);
      
      if (result.success) {
        walletState.update(state => ({
          ...state,
          isOpen: true,
          address: result.address,
          walletPath: result.path,
        }));
        await refreshWalletSnapshot({ forceSync: true });
        startPolling();
        loadWalletPath();
        SubscribeToWalletEvents().catch(() => {});
        toast.success(`Connected to test wallet #${wallet.index}`);
      } else {
        error = result.error || 'Failed to open test wallet';
        toast.error(error);
      }
    } catch (err) {
      error = err.message || 'Failed to open test wallet';
      toast.error(error);
    } finally {
      loading = false;
    }
  }
  
  function selectTestWallet(wallet) {
    selectedTestWallet = wallet;
    walletPath = ''; // Clear regular wallet selection when selecting a test wallet
  }
  
  function copyTestWalletAddress(wallet, e) {
    e?.stopPropagation();
    navigator.clipboard.writeText(wallet.address);
    toast.success('Address copied');
  }
  
  function copyTestWalletSeed(wallet, e) {
    e?.stopPropagation();
    navigator.clipboard.writeText(wallet.seed);
    toast.success('Seed copied');
  }
  
  function formatTestWalletBalance(balance) {
    // Balance is in atomic units (1 DERO = 100000 atomic)
    const dero = balance / 100000;
    return dero.toLocaleString(undefined, { maximumFractionDigits: 5 });
  }
  
  // ============================================
  // DATA LOADING FUNCTIONS
  // ============================================
  async function refreshBalance(forceSync = false) {
    try {
      // If force sync or manual refresh, sync with daemon first
      if (forceSync) {
        isSyncing = true;
        const syncResult = await SyncWallet();
        isSyncing = false;
        
        if (syncResult.success) {
          syncStatus = {
            synced: syncResult.synced,
            walletHeight: syncResult.walletHeight,
            daemonHeight: syncResult.daemonHeight,
            behindBlocks: syncResult.behindBlocks,
            message: syncResult.message
          };
        }
      } else {
        // Just get current sync status without waiting
        const statusResult = await GetWalletSyncStatus();
        if (statusResult.success) {
          syncStatus = {
            synced: statusResult.synced,
            walletHeight: statusResult.walletHeight,
            daemonHeight: statusResult.daemonHeight,
            behindBlocks: statusResult.behindBlocks
          };
        }
      }
      
      // Get balance
      const balance = await GetBalance();
      if (balance.success) {
        walletState.update(state => ({
          ...state,
          balance: balance.balance,
          lockedBalance: balance.lockedBalance,
        }));
      }
    } catch (err) {
      console.error('Error fetching balance:', err);
      isSyncing = false;
    }
  }

  // Coalesces concurrent refreshes. A cheap refresh piggybacks on any
  // in-flight refresh; a forceSync or forceHistory refresh waits for the
  // in-flight one and then runs a fresh pass so manual Refresh and push
  // events always reflect daemon state.
  //
  // History reload is gated on real signals (height advance, push event, or
  // explicit force) instead of firing every tick. This matches Engram's
  // height-bounded Show_Transfers pattern: when no block has been seen, no
  // tx can have arrived, so re-fetching history is wasted work.
  async function refreshWalletSnapshot({
    forceSync = false,
    forceHistory = false,
    notifyIncoming = false,
  } = {}) {
    if (!$walletState.isOpen) return;

    if (activeRefresh) {
      await activeRefresh;
      if (!forceSync && !forceHistory) return;
    }

    const previousLatestTxId = transactionHistory[0]?.txid || null;

    activeRefresh = (async () => {
      try {
        await refreshBalance(forceSync);

        const newHeight = syncStatus?.walletHeight ?? 0;
        const heightAdvanced = newHeight > lastSyncedWalletHeight;

        if (forceSync || forceHistory || heightAdvanced) {
          await loadTransactionHistory();
          if (newHeight > 0) lastSyncedWalletHeight = newHeight;
        }

        const latestTx = transactionHistory[0];
        if (
          notifyIncoming &&
          previousLatestTxId &&
          latestTx &&
          latestTx.txid !== previousLatestTxId &&
          (latestTx.incoming || latestTx.coinbase)
        ) {
          toast.success(`Received ${formatBalance(latestTx.amount)} DERO`);
        }
      } finally {
        activeRefresh = null;
      }
    })();

    await activeRefresh;
  }
  
  async function loadTransactionHistory(limit = historyLimit) {
    try {
      const result = await GetTransactionHistory(limit + 1);
      if (result.success && result.transactions) {
        historyHasMore = result.transactions.length > limit;
        transactionHistory = result.transactions.slice(0, limit);
      }
      await loadTransactionLabels();
    } catch (err) {
      console.error('Error fetching transaction history:', err);
    }
  }

  async function loadMoreHistory() {
    historyLoadingMore = true;
    historyLimit += 50;
    await loadTransactionHistory(historyLimit);
    historyLoadingMore = false;
  }

  async function loadTransactionLabels() {
    try {
      const result = await GetAllTransactionLabels();
      if (result.success && result.labels) {
        transactionLabels = result.labels;
      }
    } catch (e) {
      console.error('Failed to load transaction labels:', e);
    }
  }

  async function deleteTransactionLabel(txid) {
    try {
      const result = await DeleteTransactionLabel(txid);
      if (result.success) {
        delete transactionLabels[txid];
        transactionLabels = transactionLabels; // trigger reactivity
      }
    } catch (e) {
      console.error('Failed to delete label:', e);
    }
  }
  
  
  async function refreshAll() {
    await refreshWalletSnapshot({ forceSync: true });
    await checkRegistrationStatus();

    if (syncStatus && !syncStatus.synced && syncStatus.behindBlocks > 0) {
      toast.info(`Syncing: ${syncStatus.behindBlocks} blocks behind`);
    } else {
      toast.success('Wallet refreshed');
    }
  }
  
  // ============================================
  // REGISTRATION FUNCTIONS
  // ============================================
  async function checkRegistrationStatus() {
    try {
      const result = await GetRegistrationStatus();
      if (result.success) {
        registrationStatus = {
          isRegistered: result.isRegistered,
          registrationHeight: result.registrationHeight,
          registrationProgress: result.registrationProgress,
          registrationPending: result.registrationPending,
          registrationTxid: result.registrationTxid,
          hashCount: result.hashCount,
          elapsedSeconds: result.elapsedSeconds,
          message: result.message
        };
        isRegistering = result.registrationProgress || false;
        registrationPending = result.registrationPending || false;
        registrationTxid = result.registrationTxid || '';
        if (result.isRegistered) {
          registrationPending = false;
          registrationTxid = '';
        }
        if (result.hashCount) registrationHashCount = result.hashCount;
        if (result.elapsedSeconds) registrationElapsed = result.elapsedSeconds;
      }
    } catch (e) {
      console.error('Failed to check registration status:', e);
    }
  }
  
  async function startRegistration() {
    try {
      const result = await RegisterWallet();
      if (result.success) {
        // Don't show toast here - the wallet:registration_started event will show one
        isRegistering = true;
        registrationHashCount = 0;
        registrationElapsed = 0;
      } else {
        toast.error(result.error || 'Failed to start registration');
      }
    } catch (e) {
      console.error('Failed to start registration:', e);
      toast.error('Failed to start registration');
    }
  }
  
  async function cancelRegistration() {
    try {
      const result = await CancelRegistration();
      if (result.success) {
        toast.info(result.message);
        isRegistering = false;
      } else {
        toast.error(result.error || 'Failed to cancel registration');
      }
    } catch (e) {
      console.error('Failed to cancel registration:', e);
    }
  }
  
  // ============================================
  // WALLET MANAGEMENT
  // ============================================
  async function refreshRecentWallets() {
    try {
      const infos = await GetRecentWalletsWithInfo();
      if (infos) {
        recentWalletsInfo = infos;
        recentWallets = infos.map(w => w.path);
        return;
      }
    } catch (e) {
      // Fallback to simple list
    }

    try {
      const recents = await ListRecentWallets();
      recentWallets = recents || [];
      recentWalletsInfo = recentWallets.map(p => ({
        path: p,
        filename: getWalletFilename(p),
        addressPrefix: ''
      }));
    } catch (e) {
      console.error('Failed to refresh recent wallets:', e);
      recentWallets = [];
      recentWalletsInfo = [];
    }
  }

  async function openWallet() {
    // Context-aware validation messages (Bug #33 fix)
    if (!walletPath && !password) {
      error = 'Please provide wallet path and password';
      return;
    }
    if (!walletPath) {
      error = 'Please provide wallet path';
      return;
    }
    if (!password) {
      error = 'Please provide password';
      return;
    }
    
    loading = true;
    error = null;
    
    try {
      const result = await OpenWallet(walletPath, password);
      if (result.success) {
        dashboardLoading = true;
        walletState.update(state => ({
          ...state,
          isOpen: true,
          address: result.address,
          walletPath: walletPath,
        }));
        settingsState.update(s => ({ ...s, lastWalletPath: walletPath }));
        password = '';
        
        // Show network warning if wallet was from different network
        if (result.networkWarning) {
          toast.warning(result.networkWarning);
        }
        
        await refreshWalletSnapshot({ forceSync: true });
        await checkRegistrationStatus();
        dashboardLoading = false;
        startPolling();
        loadWalletPath();
        SubscribeToWalletEvents().catch(() => {});
        
        await refreshRecentWallets();
      } else {
        error = handleBackendError(result, { showToast: false }) || 'Failed to open wallet';
      }
    } catch (err) {
      console.error('[Wallet Open Exception]', err);
      error = err.message || 'Failed to open wallet';
    } finally {
      loading = false;
    }
  }
  
  async function closeWallet() {
    try {
      stopPolling();
      const result = await CloseWallet();
      if (result.success) {
        walletState.update(state => ({
          ...state,
          isOpen: false,
          address: '',
          balance: 0,
          lockedBalance: 0,
          walletPath: '',
        }));
        transactionHistory = [];
        lastSyncedWalletHeight = 0;
        syncStatus = null;
        activeSection = 'dashboard';
        addressType = 'standard';
        receiveIntegratedAddress = '';
        requestIntegratedAddress = '';
        _payReqLastGen = { amt: null, cmt: null };
        _payReqInflight = false;
        clearTimeout(_payReqDebounceTimer);
        integratedPort = '';
        integratedComment = '';
        requestAmount = '';
        requestDesc = '';
        requestComment = '';
        resetSendForm();
        await refreshRecentWallets();
      }
    } catch (err) {
      console.error('Failed to close wallet:', err);
    }
  }
  
  // Remove a single wallet from recent list
  async function handleRemoveRecentWallet(path, event) {
    event.stopPropagation(); // Don't select the wallet
    try {
      const result = await RemoveRecentWallet(path);
      if (result.success) {
        // Update local state
        recentWalletsInfo = recentWalletsInfo.filter(w => w.path !== path);
        recentWallets = recentWallets.filter(p => p !== path);
        // Clear walletPath if it was the removed one
        if (walletPath === path) {
          walletPath = '';
        }
      }
    } catch (err) {
      console.error('Failed to remove recent wallet:', err);
    }
  }
  
  // Clear all recent wallets
  function requestClearRecentWallets() {
    showClearWalletsConfirm = true;
  }

  function cancelClearRecentWallets() {
    if (clearingRecentWallets) return;
    showClearWalletsConfirm = false;
  }

  async function confirmClearRecentWallets() {
    if (clearingRecentWallets) return;
    clearingRecentWallets = true;
    try {
      const result = await ClearRecentWallets();
      if (result.success) {
        recentWalletsInfo = [];
        recentWallets = [];
        walletPath = '';
        showClearWalletsConfirm = false;
        toast.success('Recent wallet list cleared');
      } else {
        toast.error(result.error || 'Failed to clear recent wallets');
      }
    } catch (err) {
      console.error('Failed to clear recent wallets:', err);
      toast.error('Failed to clear recent wallets');
    } finally {
      clearingRecentWallets = false;
    }
  }
  
  async function handleCreateWallet() {
    if (!createPath || !createPasswordsMatch) {
      createError = 'Please fill in all fields correctly';
      return;
    }
    
    createLoading = true;
    createError = null;
    
    try {
      const result = await CreateWallet(createPath, createPassword);
      if (result.success) {
        createdSeed = result.seed;
        toast.success('Wallet created! Please save your seed phrase.');
      } else {
        createError = handleBackendError(result, { showToast: false }) || 'Failed to create wallet';
      }
    } catch (err) {
      console.error('[Wallet Create Exception]', err);
      createError = err.message || 'Failed to create wallet';
    } finally {
      createLoading = false;
    }
  }
  
  async function confirmSeedAndOpen() {
    if (!seedConfirmed) return;
    
    walletPath = createPath;
    password = createPassword;
    
    createdSeed = null;
    seedConfirmed = false;
    createPath = '';
    createPassword = '';
    createPasswordConfirm = '';
    
    activeTab = 'open';
    await openWallet();
  }
  
  async function handleRestoreWallet() {
    if (!restorePath || !restorePasswordsMatch || !isValidSeed) {
      restoreError = 'Please fill in all fields correctly';
      return;
    }
    
    restoreLoading = true;
    restoreError = null;
    
    try {
      const result = await RestoreWallet(restorePath, restorePassword, restoreSeed.trim());
      if (result.success) {
        toast.success('Wallet restored successfully!');
        
        walletPath = restorePath;
        password = restorePassword;
        
        restorePath = '';
        restorePassword = '';
        restorePasswordConfirm = '';
        restoreSeed = '';
        
        activeTab = 'open';
        await openWallet();
      } else {
        restoreError = handleBackendError(result, { showToast: false }) || 'Failed to restore wallet';
      }
    } catch (err) {
      console.error('[Wallet Restore Exception]', err);
      restoreError = err.message || 'Failed to restore wallet';
    } finally {
      restoreLoading = false;
    }
  }
  
  async function connectXSWD() {
    try {
      await ConnectXSWD();
    } catch (err) {
      console.error('XSWD connection failed:', err);
    }
  }
  
  // ============================================
  // SEND FUNCTIONS
  // ============================================
  function setMaxAmount() {
    // Reserve 0.01 DERO (1000 atomic) for network fees — a standard ringsize-16
    // transfer costs ~60-80 atomic but the wallet needs headroom for proof construction.
    const feeReserve = 1000;
    const maxAmount = Math.max(0, ($walletState.balance - feeReserve) / 100000);
    sendAmount = maxAmount.toFixed(5);
  }
  
  function resetSendForm() {
    sendStep = 1;
    sendDest = '';
    sendAmount = '';
    sendRingsize = 16;
    sendPassword = '';
    sendError = null;
    sendTxid = null;
    sendLoading = false;
    showFullSendAddress = false;
    showContactPicker = false;
    clearUriPaste();
  }

  function clearUriPaste() {
    sendDest = '';
    paymentParsed = null;
    paymentState = { state: 'pending', severity: 'info', reason: '' };
    decodedPaymentInfo = null;
    uriAckSpoofable = false;
    uriAckSelfPay = false;
    editingMalformed = false;
    paymentMorphFired = false;
    paymentDecodeAttempted = false;
    lastParsedAddress = '';
  }
  
  async function executeSend() {
    if (!sendPassword) {
      sendError = 'Please enter your wallet password';
      return;
    }
    
    sendLoading = true;
    sendError = null;
    
    try {
      const params = {
        transfers: [{
          destination: sendDest,
          amount: sendAmountAtomic
        }],
        ringsize: sendRingsize
      };
      
      const result = await InternalWalletCall('transfer', params, sendPassword);
      
      if (result.success) {
        sendTxid = result.result?.txid || result.txid;
        sendStep = 3;
        toast.success('Transaction sent successfully!');
        await refreshWalletSnapshot();
      } else {
        sendError = handleBackendError(result, { showToast: false }) || 'Transaction failed';
      }
    } catch (err) {
      console.error('[Send Transaction Exception]', err);
      sendError = err.message || 'Transaction failed';
    } finally {
      sendLoading = false;
    }
  }
  
  // ============================================
  // RECEIVE FUNCTIONS
  // ============================================
  async function generateIntegratedAddress() {
    receiveIntegratedLoading = true;
    receiveIntegratedAddress = '';
    try {
      const port = integratedPort ? parseInt(integratedPort, 10) : 0;
      const comment = integratedComment || '';
      const result = await GetIntegratedAddress(isNaN(port) ? 0 : port, comment, 0);
      if (result.success) {
        receiveIntegratedAddress = result.integratedAddress;
      } else {
        toast.error(result.error || 'Failed to generate integrated address');
      }
    } catch (err) {
      console.error('Failed to generate integrated address:', err);
      toast.error('Failed to generate integrated address');
    } finally {
      receiveIntegratedLoading = false;
    }
  }
  
  // ============================================
  // PAYMENT REQUEST (INTEGRATED ADDRESS)
  // ============================================
  async function createPaymentRequest() {
    if (!requestAmount && !requestComment) return;
    if (_payReqInflight) return;
    _payReqInflight = true;
    requestIntegratedLoading = true;
    const snapshotAmt = requestAmount;
    const snapshotCmt = requestComment;
    try {
      const amountAtomic = Math.round(parseFloat(snapshotAmt || '0') * 100000);
      const result = await CreatePaymentRequest(amountAtomic, snapshotCmt || '');
      // Discard stale responses — user moved on.
      if (snapshotAmt !== requestAmount || snapshotCmt !== requestComment) return;
      if (result.success && result.integrated_address) {
        requestIntegratedAddress = result.integrated_address;
      } else {
        handleBackendError(result) || toast.error('Could not generate integrated address');
      }
    } catch (e) {
      console.error('Failed to create payment request:', e);
      toast.error(e?.message || 'Could not generate integrated address');
    } finally {
      requestIntegratedLoading = false;
      _payReqInflight = false;
    }
  }
  
  // ============================================
  // SMART-PASTE PIPELINE
  // ============================================
  // Normalize the backend decode payload (rpc.Arguments shape) into a flat object.
  // The payload is an array of { name, value } entries: A=amount (uint64), C=comment, D=destination port.
  function normalizeDecoded(decoded) {
    if (!decoded) return null;
    let amount = null, comment = null, port = null;
    if (Array.isArray(decoded.payload)) {
      for (const arg of decoded.payload) {
        if (!arg || typeof arg.name !== 'string') continue;
        if (arg.name === 'A') amount = Number(arg.value);
        else if (arg.name === 'C') comment = String(arg.value);
        else if (arg.name === 'D') port = Number(arg.value);
      }
    }
    const amountFormatted = (amount != null && !isNaN(amount)) ? (amount / 100000).toFixed(5) : null;
    return { baseAddress: decoded.address || null, amount, amountFormatted, comment, port };
  }

  // Pure parser — never throws. Classifies the shape of any pasted/typed/scanned input.
  function parsePaymentURI(input) {
    const out = { kind: 'unknown', raw: input || '', hadScheme: false, address: null, network: null, embeddedAmount: null, embeddedComment: null, embeddedPort: null, queryAmount: null, queryDesc: null, needsDecode: false, parseError: null };
    if (!input || typeof input !== 'string') return out;
    const raw = input.trim();
    out.raw = raw;
    if (!raw) return out;
    out.hadScheme = /^dero:\/\//i.test(raw);
    const body = out.hadScheme ? raw.slice(7) : raw;
    const qIdx = body.indexOf('?');
    const addressPart = qIdx === -1 ? body : body.slice(0, qIdx);
    const queryPart = qIdx === -1 ? '' : body.slice(qIdx + 1);
    // Bech32-style charset: no 0/1/b/i/o (after the leading '1' separator).
    const PREFIX_RE = /^(dero|deto)(i)?1[02-9ac-hj-np-z]+$/i;
    if (addressPart.length < 60) { out.parseError = 'truncated'; return out; }
    if (!PREFIX_RE.test(addressPart)) { out.parseError = 'unrecognized_address'; return out; }
    const lower = addressPart.toLowerCase();
    if (lower.startsWith('deroi1') || lower.startsWith('detoi1')) { out.kind = 'integrated'; out.needsDecode = true; }
    else { out.kind = 'standard'; }
    out.address = addressPart;
    out.network = lower.startsWith('dero') ? 'mainnet' : 'testnet';
    if (queryPart) {
      try {
        const sp = new URLSearchParams(queryPart);
        const a = sp.get('amount');
        if (a) { if (/^\d+$/.test(a)) out.queryAmount = Number(a); else out.parseError = out.parseError || 'bad_amount_param'; }
        const d = sp.get('desc');
        if (d) out.queryDesc = d;
      } catch (_) { out.parseError = out.parseError || 'bad_query'; }
    }
    return out;
  }

  // Pure classifier — first match wins. ctx.decode is null until the async decode resolves.
  function classifyPaymentURI(parsed, ctx) {
    if (!parsed || !parsed.raw) return { state: 'pending', severity: 'info', reason: '' };
    if (parsed.parseError === 'truncated' || parsed.parseError === 'unrecognized_address' || parsed.kind === 'unknown') {
      return { state: 'malformed', severity: 'err', reason: 'Could not parse address' };
    }
    const ctxNet = ctx.currentNetwork === 'simulator' ? 'testnet' : ctx.currentNetwork;
    if (parsed.network && parsed.network !== ctxNet) {
      return { state: 'wrongNetwork', severity: 'warn', reason: parsed.network + ' address on ' + ctx.currentNetwork };
    }
    if (parsed.kind === 'integrated') {
      if (parsed.needsDecode && !ctx.decode) return { state: 'pending', severity: 'info', reason: 'decoding…' };
      if (ctx.decode && !ctx.decode.ok) return { state: 'corrupted', severity: 'err', reason: 'Checksum failed' };
      if (ctx.decode && ctx.decode.ok) {
        if (ctx.decode.baseAddress === ctx.walletAddress) return { state: 'selfPayment', severity: 'info', reason: 'Recipient is this wallet' };
        if ((ctx.decode.amount == null || ctx.decode.amount === 0) && !parsed.queryAmount) return { state: 'halfFilled', severity: 'info', reason: 'Amount not specified' };
        return { state: 'ok', severity: 'ok', reason: 'Tamper-proof payment URI' };
      }
    }
    // Standard path.
    if (parsed.address === ctx.walletAddress) return { state: 'selfPayment', severity: 'info', reason: 'Recipient is this wallet' };
    if (parsed.queryAmount != null && parsed.queryAmount > 0) return { state: 'spoofable', severity: 'warn', reason: 'Amount lives in query string, not address' };
    return { state: 'halfFilled', severity: 'info', reason: 'Type the amount below' };
  }

  // Orchestrator — runs on every sendDest change. Idempotent for raw typing; smart-paste only when input is structured.
  async function handlePaymentInput(value) {
    const v = value || '';
    // Idempotence guard for raw typing: same address, no scheme, no query — bail.
    if (v === lastParsedAddress && !/^dero:\/\//i.test(v) && v.indexOf('?') === -1) return;
    if (!v) {
      paymentParsed = null;
      paymentState = { state: 'pending', severity: 'info', reason: '' };
      decodedPaymentInfo = null;
      paymentDecodeAttempted = false;
      paymentMorphFired = false;
      uriAckSpoofable = false;
      uriAckSelfPay = false;
      editingMalformed = false;
      lastParsedAddress = '';
      return;
    }
    const parsed = parsePaymentURI(v);
    paymentParsed = parsed;
    // New URI surface — reset acks before classifying.
    if (parsed.address !== lastParsedAddress) {
      uriAckSpoofable = false;
      uriAckSelfPay = false;
      editingMalformed = false;
      paymentMorphFired = false;
      paymentDecodeAttempted = false;
    }
    // Raw-address typing path — let existing form-validation drive, no smart-paste UI.
    if (parsed.kind === 'unknown' && !parsed.hadScheme && v.indexOf('?') === -1) {
      paymentState = { state: 'pending', severity: 'info', reason: '' };
      lastParsedAddress = v;
      return;
    }
    // Strip scheme/query from the input so downstream code sees a bare address.
    if (parsed.address && v !== parsed.address) sendDest = parsed.address;
    // Prefill query amount only if the field is empty (don't clobber user input).
    if (parsed.queryAmount != null && parsed.queryAmount > 0 && !sendAmount) sendAmount = (parsed.queryAmount / 100000).toString();
    paymentState = classifyPaymentURI(parsed, { currentNetwork: $appState.network, walletAddress: $walletState.address, decode: null });
    lastParsedAddress = parsed.address || v;
    // Skip the backend decode for wrongNetwork — daemon would reject and the state is already correct.
    if (parsed.kind === 'integrated' && parsed.needsDecode && !paymentDecodeAttempted && paymentState.state !== 'wrongNetwork') {
      paymentDecodeAttempted = true;
      const guardAddress = parsed.address;
      try {
        const result = await DecodeIntegratedAddress(parsed.address);
        // Race guard — user pasted a new URI before this one resolved.
        if (guardAddress !== lastParsedAddress) return;
        if (result && result.success && result.decoded) {
          const normalized = normalizeDecoded(result.decoded);
          decodedPaymentInfo = normalized;
          if (normalized.amount != null && normalized.amount > 0 && !sendAmount) sendAmount = (normalized.amount / 100000).toString();
          paymentState = classifyPaymentURI(parsed, { currentNetwork: $appState.network, walletAddress: $walletState.address, decode: { ok: true, baseAddress: normalized.baseAddress, amount: normalized.amount, comment: normalized.comment, port: normalized.port } });
          if (paymentState.state === 'ok' && !paymentMorphFired) paymentMorphFired = true;
        } else {
          decodedPaymentInfo = null;
          paymentState = classifyPaymentURI(parsed, { currentNetwork: $appState.network, walletAddress: $walletState.address, decode: { ok: false, baseAddress: null, amount: null, comment: null, port: null } });
        }
      } catch (_) {
        if (guardAddress !== lastParsedAddress) return;
        decodedPaymentInfo = null;
        paymentState = classifyPaymentURI(parsed, { currentNetwork: $appState.network, walletAddress: $walletState.address, decode: { ok: false, baseAddress: null, amount: null, comment: null, port: null } });
      }
    }
  }
  
  // ============================================
  // MINING EARNINGS
  // ============================================
  async function loadMiningEarnings() {
    try {
      const [summaryResult, earningsResult] = await Promise.all([
        GetMiningEarningsSummary(),
        GetWalletMiningEarnings(50)
      ]);
      if (summaryResult.success) miningEarningsSummary = summaryResult;
      if (earningsResult.success) miningEarnings = earningsResult.earnings || [];
    } catch (e) {
      console.error('Failed to load mining earnings:', e);
    }
  }
  
  // ============================================
  // WALLET PATH
  // ============================================
  async function loadWalletPath() {
    try {
      currentWalletPath = await GetCurrentWalletPath() || '';
    } catch (e) { currentWalletPath = ''; }
  }
  
  // ============================================
  // HISTORY FUNCTIONS
  // ============================================
  async function exportHistory() {
    const csv = [
      ['TXID', 'Type', 'Amount (DERO)', 'Time'],
      ...filteredHistory.map(tx => [
        tx.txid || '',
        tx.coinbase ? 'Mining' : tx.incoming ? 'Received' : 'Sent',
        formatBalance(tx.amount),
        tx.time ? new Date(tx.time * 1000).toISOString() : ''
      ])
    ].map(row => row.join(',')).join('\n');
    
    // Use native save dialog
    const defaultFilename = `wallet-history-${new Date().toISOString().slice(0, 10)}.csv`;
    const result = await SaveFileWithDialog(defaultFilename, csv, 'CSV Files', '*.csv');
    
    if (result.success) {
      toast.success(`History exported to ${result.path}`);
    } else if (!result.cancelled) {
      toast.error(result.error || 'Failed to export history');
    }
    // If cancelled, do nothing (no toast)
  }
  
  // ============================================
  // ADDRESS BOOK FUNCTIONS
  // ============================================
  async function loadContacts() {
    contactsLoading = true;
    try {
      const result = await GetAddressBook();
      if (result.success) {
        contacts = result.contacts || [];
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      contactsLoading = false;
    }
  }
  
  async function deleteContact(id) {
    if (confirmDeleteContactId !== id) {
      confirmDeleteContactId = id;
      return;
    }
    confirmDeleteContactId = null;
    try {
      const result = await DeleteContact(id);
      if (result.success) {
        toast.success('Contact deleted');
        await loadContacts();
      } else {
        toast.error(result.error || 'Failed to delete contact');
      }
    } catch (err) {
      toast.error('Failed to delete contact');
    }
  }
  
  function editContact(contact) {
    editingContact = contact;
    showAddContact = true;
  }
  
  function sendToContact(address) {
    sendDest = address;
    activeSection = 'send';
  }
  
  // Filtered contacts
  $: filteredContacts = contacts.filter(c => {
    if (!contactSearch) return true;
    const search = contactSearch.toLowerCase();
    return c.label.toLowerCase().includes(search) || 
           c.address.toLowerCase().includes(search) ||
           (c.notes && c.notes.toLowerCase().includes(search));
  });
  
  // ============================================
  // SIGN/VERIFY FUNCTIONS
  // ============================================
  async function signTheMessage() {
    if (!messageToSign.trim()) {
      toast.error('Please enter a message to sign');
      return;
    }
    
    signLoading = true;
    signedResult = null;
    
    try {
      const result = await SignMessage(messageToSign);
      if (result.success) {
        signedResult = {
          signature: result.signature,
          address: result.address,
          message: result.message
        };
        toast.success('Message signed!');
      } else {
        toast.error(result.error || 'Failed to sign message');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to sign message');
    } finally {
      signLoading = false;
    }
  }
  
  async function verifyTheSignature() {
    if (!verifyInput.trim()) {
      toast.error('Please paste signed data to verify');
      return;
    }
    
    verifyLoading = true;
    verifyResult = null;
    
    try {
      const result = await VerifySignature(verifyInput);
      if (result.success) {
        verifyResult = {
          valid: result.valid,
          signer: result.signer || null,
          message: result.message || null,
          error: result.error || null
        };
      } else {
        toast.error(result.error || 'Verification failed');
      }
    } catch (err) {
      toast.error(err.message || 'Verification failed');
    } finally {
      verifyLoading = false;
    }
  }
  
  function copySignature() {
    if (signedResult?.signature) {
      navigator.clipboard.writeText(signedResult.signature);
      toast.success('Signature copied!');
    }
  }
  
  function resetSign() {
    messageToSign = '';
    signedResult = null;
  }
  
  function resetVerify() {
    verifyInput = '';
    verifyResult = null;
  }
  
  // ============================================
  // BACKUP & SECURITY: REVEAL MODAL CONTROL
  // ============================================
  // The decrypted seed/keys live inside <RevealSecretModal/>. This route only
  // toggles which modal is mounted. Whenever the active wallet path changes
  // or the wallet is closed, both modals are dismissed so the child is
  // unmounted and its local secret state is GC'd.
  $: if (!$walletState.isOpen && (showSeedModal || showKeysModal)) {
    showSeedModal = false;
    showKeysModal = false;
  }
  
  // ============================================
  // CHANGE PASSWORD FUNCTIONS
  // ============================================
  async function handleChangePassword() {
    if (!changePasswordCurrent.trim()) {
      changePasswordError = 'Please enter your current password';
      return;
    }
    if (!changePasswordNew.trim()) {
      changePasswordError = 'Please enter a new password';
      return;
    }
    if (changePasswordNew !== changePasswordConfirm) {
      changePasswordError = 'New passwords do not match';
      return;
    }
    
    changePasswordLoading = true;
    changePasswordError = null;
    changePasswordSuccess = false;
    
    try {
      const result = await ChangeWalletPassword(changePasswordCurrent, changePasswordNew);
      if (result.success) {
        changePasswordSuccess = true;
        toast.success('Wallet password changed successfully');
        // Clear form
        changePasswordCurrent = '';
        changePasswordNew = '';
        changePasswordConfirm = '';
      } else {
        changePasswordError = handleBackendError(result, { showToast: false }) || 'Failed to change password';
      }
    } catch (err) {
      console.error('Error changing password:', err);
      changePasswordError = err.message || 'Failed to change password';
    } finally {
      changePasswordLoading = false;
    }
  }
  
  function resetChangePassword() {
    changePasswordCurrent = '';
    changePasswordNew = '';
    changePasswordConfirm = '';
    changePasswordError = null;
    changePasswordSuccess = false;
    showChangePasswordCurrent = false;
    showChangePasswordNew = false;
  }
  
  // ============================================
  // TRANSACTION LABEL FUNCTIONS
  // ============================================
  function startEditLabel(tx) {
    editingLabelTxid = tx.txid;
    editingLabelValue = tx.label || '';
  }
  
  function cancelEditLabel() {
    editingLabelTxid = null;
    editingLabelValue = '';
  }
  
  async function saveTransactionLabel() {
    if (!editingLabelTxid) return;
    
    savingLabel = true;
    try {
      const result = await SetTransactionLabel(editingLabelTxid, editingLabelValue.trim());
      if (result.success) {
        // Update the local transaction history
        transactionHistory = transactionHistory.map(tx => 
          tx.txid === editingLabelTxid 
            ? { ...tx, label: editingLabelValue.trim() || undefined }
            : tx
        );
        toast.success(editingLabelValue.trim() ? 'Label saved' : 'Label removed');
        cancelEditLabel();
      } else {
        toast.error(handleBackendError(result, { showToast: false }) || 'Failed to save label');
      }
    } catch (err) {
      console.error('Error saving transaction label:', err);
      toast.error('Failed to save label');
    } finally {
      savingLabel = false;
    }
  }
  
  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  function getDateGroupLabel(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 604800000);
    const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (txDate.getTime() === today.getTime()) return 'Today';
    if (txDate.getTime() === yesterday.getTime()) return 'Yesterday';
    if (txDate > weekAgo) return 'This Week';
    if (txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear()) return 'This Month';
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function getPasswordStrength(pwd) {
    if (!pwd) return { level: 0, label: '', color: '' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (score <= 1) return { level: 1, label: 'Weak', color: 'var(--status-err)' };
    if (score <= 2) return { level: 2, label: 'Fair', color: 'var(--status-warn)' };
    if (score <= 3) return { level: 3, label: 'Good', color: 'var(--cyan-400)' };
    return { level: 4, label: 'Strong', color: 'var(--status-ok)' };
  }

  function formatBalance(atomic) {
    const value = atomic / 100000;
    return value.toLocaleString(undefined, { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  }
  
  function formatAddress(addr) {
    if (!addr) return '';
    return addr.slice(0, 12) + '...' + addr.slice(-8);
  }

  // Address placeholder matching visible address character count (12 + 3 + 8 = 23)
  const ADDRESS_PLACEHOLDER = '•'.repeat(23);

  function getWalletFilename(path) {
    if (!path) return '';
    return path.split(/[\\/]/).pop() || path;
  }
  
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return date.toLocaleDateString();
  }
  
  function copyToClipboard(text, label = 'Copied!') {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(label, 2000);
  }
  
  function copyAddress() {
    copyToClipboard($walletState.address, 'Address copied!');
  }
  
  function viewInExplorer(txid) {
    if (!txid) return;
    // Navigate to Explorer with the TXID as search query
    window.dispatchEvent(new CustomEvent('search-navigate', {
      detail: { tab: 'explorer', type: 'hash', query: txid, result: null }
    }));
  }
  
  async function selectWalletFile() {
    try {
      const selected = await SelectWalletFile();
      if (selected) walletPath = selected;
    } catch (err) {
      console.error('File dialog error:', err);
    }
  }
  
  async function selectCreatePath() {
    try {
      const selected = await SelectWalletFile();
      if (selected) createPath = selected;
    } catch (err) {
      console.error('File dialog error:', err);
    }
  }
  
  async function selectRestorePath() {
    try {
      const selected = await SelectWalletFile();
      if (selected) restorePath = selected;
    } catch (err) {
      console.error('File dialog error:', err);
    }
  }

  // Keep wallet path display synced when wallet is switched outside this route.
  // Also dismiss any open reveal modal so the previous wallet's decrypted
  // material cannot render under the new wallet (security: cross-wallet leak).
  $: if ($walletState.walletPath && $walletState.walletPath !== currentWalletPath) {
    if (currentWalletPath && (showSeedModal || showKeysModal)) {
      showSeedModal = false;
      showKeysModal = false;
    }
    currentWalletPath = $walletState.walletPath;
  }
</script>

{#if $walletState.isOpen}
  <!-- ============================================
       CONNECTED WALLET VIEW - Sub-Sidebar Layout
       ============================================ -->
  <div class="page-layout">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-inner">
        <div class="page-header-left">
          <h1 class="page-header-title">
            <Wallet size={18} class="page-header-icon" strokeWidth={1.5} />
            Wallet
          </h1>
          <p class="page-header-desc">Manage your DERO assets and transactions</p>
        </div>
        <div class="page-header-actions">
          <span class="badge badge-live">
            <span class="live-dot"></span>
            CONNECTED
          </span>
          <button class="btn btn-ghost btn-sm" on:click={refreshAll}>
            <RefreshCw size={14} />
            Refresh
          </button>
          <button class="btn btn-danger btn-sm" on:click={closeWallet}>
            Disconnect
          </button>
        </div>
      </div>
    </div>

    <!-- Page Body -->
    <div class="page-body">
      <!-- Sidebar -->
      <div class="page-sidebar">
        {#each Object.entries(sidebarSections) as [group, items], groupIdx}
          <div class="page-sidebar-section" style={groupIdx > 0 ? 'margin-top: var(--s-5)' : ''}>
            {group.toUpperCase()}
          </div>
          <nav class="page-sidebar-nav">
            {#each items as item}
              <button
                class="page-sidebar-item"
                class:active={activeSection === item.id}
                class:disabled={item.disabled}
                on:click={() => !item.disabled && (activeSection = item.id)}
                disabled={item.disabled}
              >
                <span class="page-sidebar-item-icon">
                  <svelte:component this={item.icon} size={14} strokeWidth={1.5} />
                </span>
                <span class="page-sidebar-item-label">{item.label}</span>
                {#if item.disabled}
                  <span class="sidebar-coming-soon">Soon</span>
                {/if}
              </button>
            {/each}
          </nav>
        {/each}
      </div>

      <!-- Content Area -->
      <div class="page-content" bind:this={pageContentEl}>
        
        <!-- ============================================
             DASHBOARD SECTION
             ============================================ -->
        {#if activeSection === 'dashboard'}
          <div class="content-section-title">Wallet Dashboard</div>
          <p class="content-section-desc">Your wallet at a glance</p>

          {#if dashboardLoading}
            <!-- Loading Skeletons -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◆</span>
                  BALANCE
                </div>
              </div>
              <div class="wallet-balance-display">
                <div class="skeleton-line skeleton-lg" style="width: 200px; margin: 0 auto;"></div>
                <div class="skeleton-line skeleton-sm" style="width: 160px; margin: var(--s-3) auto 0;"></div>
              </div>
            </div>

            <div class="quick-actions-grid">
              {#each [1,2,3,4] as _}
                <div class="quick-action-btn skeleton-block"></div>
              {/each}
            </div>

            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">◎</span>
                  RECENT ACTIVITY
                </div>
              </div>
              <div class="recent-tx-list">
                {#each [1,2,3] as _}
                  <div class="tx-row">
                    <div class="tx-left">
                      <div class="skeleton-circle"></div>
                      <div class="tx-info">
                        <div class="skeleton-line skeleton-sm" style="width: 80px;"></div>
                        <div class="skeleton-line skeleton-xs" style="width: 50px;"></div>
                      </div>
                    </div>
                    <div class="skeleton-line skeleton-sm" style="width: 100px;"></div>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
          <!-- Registration Status Banner (for new wallets) -->
          {#if (registrationStatus && !registrationStatus.isRegistered) || registrationPending}
            <div class="registration-banner" class:pending={registrationPending}>
              <div class="registration-banner-content">
                {#if registrationPending}
                  <Loader2 size={18} class="registration-icon spin" />
                {:else}
                  <AlertTriangle size={18} class="registration-icon" />
                {/if}
                <div class="registration-text">
                  {#if registrationPending}
                    <strong>Registration Pending</strong>
                    <span>TX broadcast successfully. Waiting for blockchain confirmation...</span>
                  {:else}
                    <strong>New Wallet</strong>
                    <span>Your address isn't on-chain yet. Click Register Now to complete on-chain registration via PoW before receiving DERO.</span>
                  {/if}
                </div>
              </div>
              {#if isRegistering}
                <div class="registration-progress">
                  <div class="registration-stats">
                    <Loader2 size={14} class="spin" />
                    <span>Registering... {registrationHashCount.toLocaleString()} hashes</span>
                    {#if registrationElapsed > 0}
                      <span class="registration-time">({Math.round(registrationElapsed)}s)</span>
                    {/if}
                  </div>
                  <button class="btn btn-sm btn-outline" on:click={cancelRegistration}>
                    Cancel
                  </button>
                </div>
              {:else if registrationPending}
                <div class="registration-progress">
                  <div class="registration-stats">
                    <Loader2 size={14} class="spin" />
                    <span>Confirming on-chain...</span>
                  </div>
                </div>
              {:else}
                <button class="btn btn-sm btn-outline" on:click={startRegistration}>
                  Register Now
                </button>
              {/if}
            </div>
          {/if}
          
          <!-- Balance Panel -->
          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">◆</span>
                BALANCE
              </div>
              <div class="cmd-panel-meta">
                {#if walletDisplayPath}
                  <span class="badge badge-wallet-file" title={walletDisplayPath}>
                    {getWalletFilename(walletDisplayPath)}
                  </span>
                {/if}
                {#if isSyncing}
                  <span class="badge badge-syncing">
                    <Loader2 size={10} class="spin" /> SYNCING
                  </span>
                {:else if syncStatus && !syncStatus.synced && syncStatus.behindBlocks > 0}
                  <span class="badge badge-warning" title="Wallet is {syncStatus.behindBlocks} blocks behind daemon">
                    {syncStatus.behindBlocks} BEHIND
                  </span>
                {:else}
                  <span class="badge badge-live">SYNCED</span>
                {/if}
              </div>
            </div>
            {#if syncStatus && !syncStatus.synced && syncStatus.daemonHeight > 0}
              {@const syncPercent = Math.min(100, Math.round((syncStatus.walletHeight / syncStatus.daemonHeight) * 100))}
              <div class="sync-progress-wrap">
                <div class="sync-progress-bar">
                  <div class="sync-progress-fill" style="width: {syncPercent}%"></div>
                </div>
                <span class="sync-progress-text">{syncPercent}% synced ({syncStatus.walletHeight.toLocaleString()} / {syncStatus.daemonHeight.toLocaleString()})</span>
              </div>
            {/if}
            <div class="wallet-balance-display">
              <div class="balance-main">
                <div class="balance-main-left">
                  <span class="balance-value">
                    {$balanceMasked ? '••••••••' : formatBalance($walletState.balance)}
                  </span>
                  <span class="balance-unit">DERO</span>
                </div>
              </div>
              {#if $walletState.lockedBalance > 0 && !$balanceMasked}
                <div class="balance-locked">
                  + {formatBalance($walletState.lockedBalance)} locked
                </div>
              {/if}
              <div class="wallet-address-row">
                <div class="address-row-content">
                  <span class="address-text">
                    {$addressMasked ? ADDRESS_PLACEHOLDER : formatAddress($walletState.address)}
                  </span>
                  <button
                    class="btn-icon-sm copy-address-btn"
                    class:hidden={$addressMasked}
                    on:click={copyAddress}
                    title="Copy address"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="quick-actions-grid">
            <button class="quick-action-btn" on:click={() => activeSection = 'send'}>
              <ArrowUp size={20} strokeWidth={1.5} />
              <span>Send</span>
            </button>
            <button class="quick-action-btn" on:click={() => activeSection = 'receive'}>
              <ArrowDown size={20} strokeWidth={1.5} />
              <span>Receive</span>
            </button>
            <button class="quick-action-btn" on:click={() => activeSection = 'request'}>
              <QrCode size={20} strokeWidth={1.5} />
              <span>Request</span>
            </button>
            <button class="quick-action-btn" on:click={() => activeSection = 'history'}>
              <History size={20} strokeWidth={1.5} />
              <span>History</span>
            </button>
          </div>


          <!-- Recent Activity -->
          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">◎</span>
                RECENT ACTIVITY
              </div>
              <div class="cmd-panel-meta">
                <button class="btn btn-ghost btn-sm" on:click={() => activeSection = 'history'}>
                  View All
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
            <div class="recent-tx-list">
              {#each transactionHistory.slice(0, 5) as tx}
                <div class="tx-row" on:click={() => { activeSection = 'history'; expandedTxId = tx.txid; }} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && (activeSection = 'history', expandedTxId = tx.txid)}>
                  <div class="tx-left">
                    <span class="tx-icon" class:tx-in={tx.incoming || tx.coinbase} class:tx-out={!tx.incoming && !tx.coinbase}>
                      {#if tx.coinbase}
                        <Pickaxe size={14} />
                      {:else if tx.incoming}
                        <ArrowDown size={14} />
                      {:else}
                        <ArrowUp size={14} />
                      {/if}
                    </span>
                    <div class="tx-info">
                      <span class="tx-type">{tx.coinbase ? 'Mining Reward' : tx.incoming ? 'Received' : 'Sent'}</span>
                      <span class="tx-time">{formatTime(tx.time)}</span>
                    </div>
                  </div>
                  <span class="tx-amt" class:tx-amt-in={tx.incoming || tx.coinbase} class:tx-amt-out={!tx.incoming && !tx.coinbase}>
                    {$balanceMasked ? '••••••' : `${tx.incoming || tx.coinbase ? '+' : '-'}${formatBalance(tx.amount)} DERO`}
                  </span>
                  {#if tx.label}
                    <span class="tx-label">{tx.label}</span>
                  {/if}
                </div>
              {:else}
                <div class="cmd-empty-state">
                  <span class="cmd-empty-icon">◎</span>
                  <span class="cmd-empty-text">No recent transactions</span>
                </div>
              {/each}
            </div>
          </div>
          {/if}
        {/if}

        <!-- ============================================
             SEND SECTION (3-Step Flow)
             ============================================ -->
        {#if activeSection === 'send'}
          <div class="content-section-title">Send DERO</div>
          <p class="content-section-desc">Transfer DERO to any address</p>

          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">⬢</span>
                {#if sendStep === 1}TRANSFER{:else if sendStep === 2}CONFIRM{:else}COMPLETE{/if}
              </div>
              <div class="cmd-panel-meta">
                <span class="step-indicator">Step {sendStep} of 3</span>
              </div>
            </div>
            
            <div class="send-form-content">
              {#if sendStep === 1}
                <!-- STEP 1: Enter Details -->
                <div class="form-group">
                  <label class="form-label">Recipient Address</label>
                  <div class="input-with-action">
                    <input
                      type="text"
                      class="input"
                      class:input-error={(paymentState.state === 'pending' || editingMalformed) && sendDest && !isValidSendAddress}
                      class:uri-locked={paymentState.state === 'ok' || paymentState.state === 'selfPayment'}
                      class:uri-morphed={paymentMorphFired && paymentState.state === 'ok'}
                      class:uri-warn={paymentState.severity === 'warn'}
                      class:uri-err={paymentState.severity === 'err' && paymentState.state !== 'pending'}
                      class:uri-half={paymentState.state === 'halfFilled'}
                      readonly={(paymentParsed?.hadScheme === true || paymentParsed?.kind === 'integrated') && !editingMalformed && (paymentState.state === 'ok' || paymentState.state === 'selfPayment' || paymentState.state === 'wrongNetwork')}
                      bind:value={sendDest}
                      placeholder="dero1..."
                    />
                    <button
                      class="btn btn-ghost btn-sm"
                      on:click={() => { showContactPicker = !showContactPicker; if (contacts.length === 0) loadContacts(); }}
                      title="Select from Address Book"
                    >
                      <Users size={14} />
                    </button>
                  </div>
                  {#if showContactPicker && contacts.length > 0}
                    <div class="contact-picker-dropdown">
                      {#each contacts as contact}
                        <button
                          class="contact-picker-item"
                          on:click={() => { sendDest = contact.address; showContactPicker = false; }}
                        >
                          <span class="contact-picker-label">{contact.label}</span>
                          <span class="contact-picker-addr">{formatAddress(contact.address)}</span>
                        </button>
                      {/each}
                    </div>
                  {:else if showContactPicker}
                    <div class="contact-picker-dropdown">
                      <div class="contact-picker-empty">No saved contacts</div>
                    </div>
                  {/if}
                  {#if (paymentState.state === 'pending' || editingMalformed) && sendDest && !isValidSendAddress}
                    <span class="form-error">Invalid DERO address</span>
                  {/if}
                  {#if paymentState.state !== 'pending'}
                    <div class="uri-hint-row uri-hint-row--{paymentState.severity}">
                      <span class="uri-hint-dot"></span>
                      <span>{paymentState.reason}</span>
                    </div>
                    <div class="uri-reveal uri-reveal--{paymentState.severity}">
                      {#if paymentState.state === 'ok' && decodedPaymentInfo}
                        <span class="uri-reveal-label">Embedded in address</span>
                        {#if decodedPaymentInfo.amountFormatted}<span>Amount: <strong>{decodedPaymentInfo.amountFormatted} DERO</strong></span>{/if}
                        {#if decodedPaymentInfo.comment}<span>Comment: <strong>{decodedPaymentInfo.comment}</strong></span>{/if}
                        {#if paymentParsed?.queryDesc}<span>Note (off-chain): <strong>{paymentParsed.queryDesc}</strong></span>{/if}
                      {:else if paymentState.state === 'spoofable'}
                        <span class="uri-reveal-label">Heads up</span>
                        <span>Amount is in the query string, not the address — verify with the sender before sending.</span>
                        {#if paymentParsed?.queryAmount}<span>Prefilled amount: <strong>{(paymentParsed.queryAmount / 100000).toString()} DERO</strong></span>{/if}
                        <span style="opacity:0.8; margin-top:4px;">Ask the sender for a <strong>deroi1</strong> integrated address for tamper-proof payments.</span>
                      {:else if paymentState.state === 'wrongNetwork'}
                        <span class="uri-reveal-label">Network mismatch</span>
                        <span>This is a <strong>{paymentParsed?.network}</strong> address; you're connected to <strong>{$appState.network}</strong>. The transaction won't reach the recipient.</span>
                      {:else if paymentState.state === 'malformed'}
                        <span class="uri-reveal-label">What's wrong</span>
                        {#if paymentParsed?.parseError === 'truncated'}<span>The address looks cut off mid-string. Recheck the source and paste the full value.</span>{:else}<span>The prefix doesn't match a DERO address. Recheck the source or paste again.</span>{/if}
                      {:else if paymentState.state === 'corrupted'}
                        <span class="uri-reveal-label">What's wrong</span>
                        <span>The shape is right but the checksum doesn't verify. Likely copy-paste corruption or a damaged QR — try re-copying or rescanning.</span>
                      {:else if paymentState.state === 'halfFilled'}
                        <span class="uri-reveal-label">From the URI</span>
                        {#if decodedPaymentInfo?.baseAddress}<span>Recipient: <strong>{formatAddress(decodedPaymentInfo.baseAddress)}</strong>{#if decodedPaymentInfo.comment} (with comment <strong>"{decodedPaymentInfo.comment}"</strong>){/if}</span>{:else if paymentParsed?.address}<span>Recipient: <strong>{formatAddress(paymentParsed.address)}</strong></span>{/if}
                        <span>Amount: <strong>not specified</strong> — enter the amount below.</span>
                      {:else if paymentState.state === 'selfPayment'}
                        <span class="uri-reveal-label">Self-payment detected</span>
                        <span>This is your own wallet. Self-payments still cost a network fee — confirm this is what you mean to do.</span>
                      {/if}
                    </div>
                    {#if paymentState.state === 'spoofable'}
                      <div class="uri-actions">
                        {#if !uriAckSpoofable}<button class="btn btn-warn btn-sm" on:click={() => uriAckSpoofable = true}>Use anyway{#if paymentParsed?.queryAmount} ({(paymentParsed.queryAmount / 100000).toString()} DERO){/if}</button>{/if}
                        <button class="btn btn-ghost btn-sm" on:click={clearUriPaste}>Clear field</button>
                      </div>
                    {:else if paymentState.state === 'selfPayment'}
                      <div class="uri-actions">
                        {#if !uriAckSelfPay}<button class="btn btn-sm" on:click={() => uriAckSelfPay = true}>Yes, self-pay</button>{/if}
                        <button class="btn btn-ghost btn-sm" on:click={clearUriPaste}>Clear field</button>
                      </div>
                    {:else if paymentState.state === 'wrongNetwork'}
                      <div class="uri-actions">
                        <button class="btn btn-sm" on:click={clearUriPaste}>Clear field</button>
                      </div>
                    {:else if paymentState.state === 'corrupted'}
                      <div class="uri-actions">
                        <button class="btn btn-err btn-sm" on:click={clearUriPaste}>Clear field</button>
                      </div>
                    {:else if paymentState.state === 'malformed'}
                      <div class="uri-actions">
                        <button class="btn btn-err btn-sm" on:click={clearUriPaste}>Clear field</button>
                        <button class="btn btn-ghost btn-sm" on:click={() => editingMalformed = true}>Try editing</button>
                      </div>
                    {/if}
                  {/if}
                </div>
                
                <div class="form-group">
                  <div class="form-label-row">
                    <label class="form-label">Amount</label>
                    <span class="form-hint">Available: {availableBalance.toFixed(5)} DERO</span>
                  </div>
                  <div class="input-with-action">
                    <input
                      type="number"
                      class="input"
                      class:input-error={sendAmount && !isValidSendAmount}
                      class:uri-locked={paymentState.state === 'ok'}
                      readonly={paymentState.state === 'ok'}
                      bind:value={sendAmount}
                      placeholder="0.00000"
                      step="0.00001"
                      min="0"
                    />
                    <button class="btn btn-ghost btn-sm" on:click={setMaxAmount} disabled={paymentState.state === 'ok'}>MAX</button>
                  </div>
                  {#if sendAmount && !isValidSendAmount}
                    <span class="form-error">
                      {sendAmountAtomic <= 0 ? 'Amount must be positive' : 'Insufficient balance'}
                    </span>
                  {/if}
                </div>
                
                <div class="form-group">
                  <label class="form-label">Ring Size</label>
                  <select class="select" bind:value={sendRingsize}>
                    <option value={2}>2 (Non-anonymous, SIGNER visible)</option>
                    <option value={16}>16 (Standard)</option>
                    <option value={32}>32</option>
                    <option value={64}>64</option>
                    <option value={128}>128</option>
                  </select>
                  <span class="form-hint">Ring size 2 is required for smart contracts that use SIGNER(). Higher values increase anonymity.</span>
                </div>

                <div class="form-actions">
                  <button class="btn btn-primary" disabled={!canSend} on:click={() => sendStep = 2}>
                    Review Transaction
                    <ChevronRight size={14} />
                  </button>
                </div>
                
              {:else if sendStep === 2}
                <!-- STEP 2: Review & Confirm -->
                <div class="confirm-details">
                  <div class="confirm-row">
                    <span class="confirm-label">Sending</span>
                    <span class="confirm-value confirm-value-amount">{sendAmount} DERO</span>
                  </div>
                  <div class="confirm-row" style="flex-direction: column; align-items: flex-start; gap: var(--s-1);">
                    <span class="confirm-label">To</span>
                    {#if showFullSendAddress}
                      <span class="confirm-address-full">{sendDest}</span>
                    {:else}
                      <span class="confirm-value confirm-value-address">{formatAddress(sendDest)}</span>
                    {/if}
                    <button class="confirm-address-toggle" on:click={() => showFullSendAddress = !showFullSendAddress}>
                      {showFullSendAddress ? 'Hide full address' : 'Show full address'}
                    </button>
                  </div>
                  <div class="confirm-row">
                    <span class="confirm-label">Ring Size</span>
                    <span class="confirm-value">{sendRingsize}{sendRingsize === 2 ? ' (non-anonymous)' : ''}</span>
                  </div>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Wallet Password</label>
                  <PasswordInput bind:value={sendPassword} placeholder="Enter password" />
                </div>
                
                {#if sendError}
                  <div class="alert alert-error">
                    <AlertTriangle size={14} />
                    <span>{sendError}</span>
                  </div>
                {/if}
                
                <div class="form-actions form-actions-split">
                  <button class="btn btn-ghost" on:click={() => { sendStep = 1; sendError = null; }}>
                    ← Back
                  </button>
                  <button class="btn btn-primary" disabled={sendLoading || (!sendPassword && !$appState.isSimulator)} on:click={executeSend}>
                    {#if sendLoading}
                      <Loader2 size={14} class="spin" />
                      Sending...
                    {:else}
                      Confirm & Send
                    {/if}
                  </button>
                </div>
                
              {:else}
                <!-- STEP 3: Success -->
                <div class="success-state">
                  <div class="success-icon">
                    <Check size={48} strokeWidth={1.5} />
                  </div>
                  <h3 class="success-title">Transaction Sent!</h3>
                  <p class="success-text">{sendAmount} DERO sent successfully</p>
                  
                  <div class="txid-display">
                    <span class="txid-label">Transaction ID</span>
                    <div class="txid-row">
                      <code class="txid-value">{sendTxid?.slice(0, 24)}...</code>
                      <button class="btn-icon-sm" on:click={() => copyToClipboard(sendTxid, 'TXID copied!')}>
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div class="form-actions">
                    <button class="btn btn-primary" on:click={resetSendForm}>Done</button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- ============================================
             RECEIVE SECTION
             ============================================ -->
        {#if activeSection === 'receive'}
          <div class="content-section-title">Receive DERO</div>
          <p class="content-section-desc">Share your address to receive payments</p>

          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">⬢</span>
                YOUR ADDRESS
              </div>
            </div>
            
            <div class="receive-content">
              <!-- Address Type Toggle -->
              <div class="address-type-toggle">
                <button 
                  class="toggle-btn" 
                  class:active={addressType === 'standard'}
                  on:click={() => { addressType = 'standard'; receiveIntegratedAddress = ''; }}
                >
                  Standard
                </button>
                <button 
                  class="toggle-btn" 
                  class:active={addressType === 'integrated'}
                  on:click={() => { addressType = 'integrated'; }}
                >
                  Integrated
                </button>
              </div>
              
              {#if addressType === 'integrated'}
                <p class="address-hint">Integrated addresses embed a payment ID and optional memo for tracking incoming payments</p>

                <div class="integrated-form">
                  <div class="form-group">
                    <label class="form-label">Payment ID (Port)</label>
                    <input 
                      type="number" 
                      class="input" 
                      bind:value={integratedPort}
                      placeholder="0 (default)"
                      min="0"
                    />
                    <span class="form-hint">A numeric identifier to distinguish payments. Use 0 for general receiving.</span>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Memo / Comment</label>
                    <input 
                      type="text" 
                      class="input" 
                      bind:value={integratedComment}
                      placeholder="Optional message or reference"
                    />
                    <span class="form-hint">An optional note embedded in the address for the sender to see.</span>
                  </div>
                  <button
                    class="btn btn-secondary"
                    on:click={generateIntegratedAddress}
                    disabled={receiveIntegratedLoading}
                    style="align-self: center;"
                  >
                    {#if receiveIntegratedLoading}
                      <Loader2 size={14} class="spin" />
                    {/if}
                    {receiveIntegratedAddress ? 'Regenerate Address' : 'Generate Integrated Address'}
                  </button>
                </div>
              {/if}
              
              <!-- QR Code + Address (show standard always, or integrated once generated) -->
              {#if addressType === 'standard' || receiveIntegratedAddress}
                <div class="qr-display">
                  <QRCodeComponent 
                    value={displayAddress} 
                    size={200} 
                  />
                </div>
                
                <div class="address-display">
                  <code class="address-full">{displayAddress}</code>
                </div>
                
                <div class="receive-actions">
                  <button class="btn btn-primary" on:click={() => copyToClipboard(displayAddress, 'Address copied!')}>
                    <Copy size={14} />
                    Copy Address
                  </button>
                </div>
              {/if}
              
              <div class="receive-warning">
                <AlertTriangle size={14} />
                <span>Only send DERO to this address. Other cryptocurrencies may be lost permanently.</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- ============================================
             REQUEST PAYMENT SECTION
             ============================================ -->
        {#if activeSection === 'request'}
          <div class="content-section-title">Request Payment</div>
          <p class="content-section-desc">Generate a payment request with amount</p>

          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">⬢</span>
                PAYMENT REQUEST
              </div>
            </div>
            
            <div class="request-content">
              <div class="form-group">
                <label class="form-label">Amount (DERO)</label>
                <input 
                  type="number" 
                  class="input" 
                  bind:value={requestAmount} 
                  placeholder="0.00000" 
                  step="0.00001"
                  min="0"
                />
              </div>
              
              <div class="form-group">
                <label class="form-label">Description (optional)</label>
                <input 
                  type="text" 
                  class="input" 
                  bind:value={requestDesc} 
                  placeholder="Payment for..." 
                />
              </div>
              
              <div class="form-group">
                <label class="form-label">Comment for Integrated Address (optional)</label>
                <input 
                  type="text" 
                  class="input" 
                  bind:value={requestComment} 
                  placeholder="Note to embed in address..." 
                />
              </div>
              
              <div class="request-actions" style="margin-bottom: 12px;">
                <button class="btn btn-secondary" on:click={createPaymentRequest} disabled={(!requestAmount && !requestComment) || requestIntegratedLoading || _payReqInflight}>
                  {#if requestIntegratedLoading}
                    <Loader2 size={14} class="spin" />
                    Generating...
                  {:else}
                    {requestIntegratedAddress ? 'Regenerate' : 'Generate Integrated Address'}
                  {/if}
                </button>
              </div>
              
              {#if paymentUri}
                <!-- QR Code with URI -->
                <div class="qr-display">
                  <QRCodeComponent value={paymentUri} size={200} />
                </div>
                
                <div class="uri-display">
                  <label class="form-label">Payment URI</label>
                  <div class="uri-box">
                    <code class="uri-value">{paymentUri}</code>
                  </div>
                </div>
                
                <div class="request-actions">
                  <button class="btn btn-primary" on:click={() => copyToClipboard(paymentUri, 'Payment URI copied!')}>
                    <Copy size={14} />
                    Copy URI
                  </button>
                </div>
              {:else if requestIntegratedAddress && !requestAmount}
                <!-- Integrated address generated without amount (comment only) -->
                <div class="uri-display">
                  <label class="form-label">Integrated Address</label>
                  <div class="uri-box">
                    <code class="uri-value">{requestIntegratedAddress}</code>
                  </div>
                </div>
                <div class="request-actions">
                  <button class="btn btn-primary" on:click={() => copyToClipboard(requestIntegratedAddress, 'Address copied!')}>
                    <Copy size={14} />
                    Copy Address
                  </button>
                </div>
              {:else}
                <div class="request-placeholder">
                  <QrCode size={48} strokeWidth={1} />
                  <p>Enter an amount for a payment QR code, or a comment for an integrated address</p>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- ============================================
             HISTORY SECTION
             ============================================ -->
        {#if activeSection === 'history'}
          <div class="content-section-title">Transaction History</div>
          <p class="content-section-desc">View and export your transaction records</p>

          <!-- Filters -->
          <div class="history-filters">
            <div class="filter-tabs">
              <button class="filter-tab" class:active={historyFilter === 'all'} on:click={() => historyFilter = 'all'}>
                All
              </button>
              <button class="filter-tab" class:active={historyFilter === 'in'} on:click={() => historyFilter = 'in'}>
                Received
              </button>
              <button class="filter-tab" class:active={historyFilter === 'out'} on:click={() => historyFilter = 'out'}>
                Sent
              </button>
              <button class="filter-tab" class:active={historyFilter === 'mining'} on:click={() => historyFilter = 'mining'}>
                Mining
              </button>
            </div>
            
            <div class="filter-actions">
              <div class="search-input-wrap">
                <Search size={14} />
                <input 
                  type="text" 
                  class="search-input" 
                  bind:value={historySearch} 
                  placeholder="Search TXID..." 
                />
              </div>
              <button class="btn btn-secondary btn-sm" on:click={exportHistory}>
                <Download size={14} />
                Export
              </button>
            </div>
          </div>

          {#if historyFilter === 'mining' && miningEarningsSummary}
            <div class="mining-summary">
              <span class="mining-stat">Total: {miningEarningsSummary.formatted || '0'} DERO</span>
              <span class="mining-stat">Blocks: {miningEarningsSummary.blocks_count || 0}</span>
              <span class="mining-stat">Miniblocks: {miningEarningsSummary.minis_count || 0}</span>
            </div>
          {/if}

          <!-- Transaction List -->
          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">☰</span>
                TRANSACTIONS
              </div>
              <div class="cmd-panel-meta">
                <span class="count-badge">{filteredHistory.length} items</span>
              </div>
            </div>
            
            <!-- tabindex="-1" makes container focusable for scroll events without tab navigation -->
            <div class="tx-list-full" tabindex="-1">
              {#each groupedHistory as group}
                <div class="tx-date-group">
                  <div class="tx-date-label">{group.label}</div>
                </div>
                {#each group.transactions as tx}
                <div class="tx-row-detailed" class:tx-expanded={expandedTxId === tx.txid}>
                  <div class="tx-row-main" on:click={() => expandedTxId = expandedTxId === tx.txid ? null : tx.txid}>
                    <div class="tx-icon-wrap">
                      <span class="tx-icon" class:tx-in={tx.incoming || tx.coinbase} class:tx-out={!tx.incoming && !tx.coinbase}>
                        {#if tx.coinbase}
                          <Pickaxe size={16} />
                        {:else if tx.incoming}
                          <ArrowDown size={16} />
                        {:else}
                          <ArrowUp size={16} />
                        {/if}
                      </span>
                    </div>
                    <div class="tx-details">
                      <div class="tx-type-row">
                        <span class="tx-type">{tx.coinbase ? 'Mining Reward' : tx.incoming ? 'Received' : 'Sent'}</span>
                        {#if tx.destination_port === 1337}
                          <span class="tx-msg-badge">MSG</span>
                        {/if}
                        {#if tx.label && editingLabelTxid !== tx.txid}
                          <span class="tx-label-badge">{tx.label}</span>
                        {/if}
                      </div>
                      {#if editingLabelTxid === tx.txid}
                        <div class="tx-label-edit">
                          <input 
                            type="text" 
                            class="tx-label-input" 
                            bind:value={editingLabelValue}
                            placeholder="Add a note..."
                            maxlength="50"
                            on:keydown={(e) => {
                              if (e.key === 'Enter') saveTransactionLabel();
                              if (e.key === 'Escape') cancelEditLabel();
                            }}
                          />
                          <button class="btn-icon-xs" on:click|stopPropagation={saveTransactionLabel} disabled={savingLabel} title="Save">
                            {#if savingLabel}
                              <Loader2 size={10} class="spin" />
                            {:else}
                              <Check size={10} />
                            {/if}
                          </button>
                          <button class="btn-icon-xs" on:click|stopPropagation={cancelEditLabel} title="Cancel">
                            ✕
                          </button>
                        </div>
                      {:else}
                        <span class="tx-id">{tx.txid?.slice(0, 24)}...</span>
                      {/if}
                    </div>
                    <div class="tx-meta">
                      <span class="tx-amount" class:positive={tx.incoming || tx.coinbase} class:negative={!tx.incoming && !tx.coinbase}>
                        {$balanceMasked ? '••••••' : `${tx.incoming || tx.coinbase ? '+' : '-'}${formatBalance(tx.amount)} DERO`}
                      </span>
                      <span class="tx-timestamp">{formatTime(tx.time)}</span>
                    </div>
                    <div class="tx-actions">
                      <button class="btn-icon-sm" on:click|stopPropagation={() => startEditLabel(tx)} title="Add/edit note">
                        <Edit size={12} />
                      </button>
                      <button class="btn-icon-sm" on:click|stopPropagation={() => copyToClipboard(tx.txid, 'TXID copied!')} title="Copy TXID">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  {#if expandedTxId === tx.txid}
                    <div class="tx-detail-panel">
                      <!-- Transaction ID -->
                      <div class="tx-detail-row">
                        <span class="tx-detail-label">Transaction ID</span>
                        <div class="tx-detail-value-row">
                          <code class="tx-detail-value tx-detail-txid">{tx.txid}</code>
                          <button class="btn-icon-sm" on:click={() => copyToClipboard(tx.txid, 'TXID copied!')} title="Copy TXID">
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>

                      <!-- Direction -->
                      <div class="tx-detail-row">
                        <span class="tx-detail-label">Direction</span>
                        <span class="tx-detail-value tx-detail-direction" class:tx-direction-in={tx.incoming || tx.coinbase} class:tx-direction-out={!tx.incoming && !tx.coinbase}>
                          {tx.coinbase ? 'Mining Reward' : tx.incoming ? 'Received' : 'Sent'}
                        </span>
                      </div>

                      <!-- Amount -->
                      <div class="tx-detail-row">
                        <span class="tx-detail-label">Amount</span>
                        <span class="tx-detail-value tx-detail-amount" class:positive={tx.incoming || tx.coinbase} class:negative={!tx.incoming && !tx.coinbase}>
                          {$balanceMasked ? '••••••' : `${tx.incoming || tx.coinbase ? '+' : '-'}${formatBalance(tx.amount)} DERO`}
                        </span>
                      </div>

                      <!-- Fee -->
                      {#if tx.fees && tx.fees > 0}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Transaction Fee</span>
                          <span class="tx-detail-value">{$balanceMasked ? '••••••' : `${formatBalance(tx.fees)} DERO`}</span>
                        </div>
                      {/if}

                      <!-- Burn -->
                      {#if tx.burn && tx.burn > 0}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Burned</span>
                          <span class="tx-detail-value tx-detail-burn">{$balanceMasked ? '••••••' : `${formatBalance(tx.burn)} DERO`}</span>
                        </div>
                      {/if}

                      <!-- Block Height -->
                      {#if tx.height}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Block Height</span>
                          <span class="tx-detail-value">{tx.height.toLocaleString()}</span>
                        </div>
                      {/if}

                      <!-- Timestamp -->
                      {#if tx.time}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Date & Time</span>
                          <span class="tx-detail-value">{new Date(tx.time * 1000).toLocaleString()} <span class="tx-detail-relative">({formatTime(tx.time)})</span></span>
                        </div>
                      {/if}

                      <!-- Sender (for incoming) -->
                      {#if tx.incoming && tx.sender}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Sender</span>
                          <div class="tx-detail-value-row">
                            <code class="tx-detail-value tx-detail-address">{tx.sender}</code>
                            <button class="btn-icon-sm" on:click={() => copyToClipboard(tx.sender, 'Sender address copied!')} title="Copy address">
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      {/if}

                      <!-- Destination (for outgoing) -->
                      {#if !tx.incoming && tx.destination}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Destination</span>
                          <div class="tx-detail-value-row">
                            <code class="tx-detail-value tx-detail-address">{tx.destination}</code>
                            <button class="btn-icon-sm" on:click={() => copyToClipboard(tx.destination, 'Destination address copied!')} title="Copy address">
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      {/if}

                      <!-- Ports (for service transactions) -->
                      {#if tx.destination_port}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Destination Port</span>
                          <span class="tx-detail-value tx-detail-port">{tx.destination_port}</span>
                        </div>
                      {/if}
                      {#if tx.source_port}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Source Port</span>
                          <span class="tx-detail-value tx-detail-port">{tx.source_port}</span>
                        </div>
                      {/if}

                      <!-- Comment/Payload -->
                      {#if tx.comment}
                        <div class="tx-detail-row">
                          <span class="tx-detail-label">Comment</span>
                          <span class="tx-detail-value tx-detail-comment">{tx.comment}</span>
                        </div>
                      {/if}

                      <!-- Transaction Proof -->
                      {#if tx.proof}
                        <div class="tx-detail-row tx-detail-proof-row">
                          <span class="tx-detail-label">Transaction Proof</span>
                          <div class="tx-detail-value-row">
                            <code class="tx-detail-value tx-detail-proof">{tx.proof}</code>
                            <button class="btn-icon-sm" on:click={() => copyToClipboard(tx.proof, 'Proof copied!')} title="Copy proof">
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      {/if}

                      <!-- View in Explorer Action -->
                      <div class="tx-detail-actions">
                        <button class="btn btn-secondary btn-sm" on:click={() => viewInExplorer(tx.txid)}>
                          <ExternalLink size={14} />
                          View in Explorer
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
                {/each}
              {:else}
                <div class="cmd-empty-state">
                  <span class="cmd-empty-icon">◎</span>
                  <span class="cmd-empty-text">No transactions found</span>
                </div>
              {/each}
              {#if historyHasMore}
                <div class="load-more-row">
                  <button class="btn btn-ghost btn-sm" on:click={loadMoreHistory} disabled={historyLoadingMore}>
                    {#if historyLoadingMore}
                      <Loader2 size={12} class="spin" />
                      Loading...
                    {:else}
                      Load More
                    {/if}
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- ============================================
             TOKENS SECTION
             ============================================ -->
        {#if activeSection === 'tokens'}
          <div class="content-section-title">Token Portfolio</div>
          <p class="content-section-desc">View and manage your token holdings</p>
          
          <TokenPortfolio />
        {/if}

        <!-- ============================================
             ADDRESS BOOK SECTION
             ============================================ -->
        {#if activeSection === 'addressbook'}
          <div class="content-section-title">Address Book</div>
          <p class="content-section-desc">Save addresses for quick access</p>

          <!-- Search and Add -->
          <div class="addressbook-controls">
            <div class="search-input-wrap">
              <Search size={14} />
              <input 
                type="text" 
                class="search-input" 
                bind:value={contactSearch} 
                placeholder="Search contacts..."
              />
            </div>
            <button class="btn btn-primary btn-sm" on:click={() => { editingContact = null; showAddContact = true; loadContacts(); }}>
              <Plus size={14} />
              Add Contact
            </button>
          </div>

          <!-- Contacts List -->
          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">◎</span>
                CONTACTS
              </div>
              <div class="cmd-panel-meta">
                <span class="count-badge">{filteredContacts.length} saved</span>
                <button class="btn btn-ghost btn-sm" on:click={loadContacts} disabled={contactsLoading}>
                  <RefreshCw size={12} class={contactsLoading ? 'spin' : ''} />
                </button>
              </div>
            </div>
            
            <div class="contacts-list">
              {#each filteredContacts as contact}
                <div class="contact-row">
                  <div class="contact-icon">
                    <Users size={16} />
                  </div>
                  <div class="contact-info">
                    <span class="contact-label">{contact.label}</span>
                    <span class="contact-address">{formatAddress(contact.address)}</span>
                    {#if contact.notes}
                      <span class="contact-notes">{contact.notes}</span>
                    {/if}
                  </div>
                  <div class="contact-actions">
                    <button class="action-btn" on:click={() => copyToClipboard(contact.address, 'Address copied!')} title="Copy">
                      <Copy size={12} />
                    </button>
                    <button class="action-btn action-btn-send" on:click={() => sendToContact(contact.address)} title="Send">
                      <Send size={12} />
                    </button>
                    <button class="action-btn" on:click={() => editContact(contact)} title="Edit">
                      <Edit size={12} />
                    </button>
                    {#if confirmDeleteContactId === contact.id}
                      <button class="action-btn action-btn-danger confirm-delete-btn" on:click={() => deleteContact(contact.id)} title="Confirm delete">
                        <Check size={12} />
                      </button>
                      <button class="action-btn" on:click={() => confirmDeleteContactId = null} title="Cancel">
                        ✕
                      </button>
                    {:else}
                      <button class="action-btn action-btn-danger" on:click={() => deleteContact(contact.id)} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    {/if}
                  </div>
                </div>
              {:else}
                <div class="cmd-empty-state">
                  <span class="cmd-empty-icon">◎</span>
                  <span class="cmd-empty-text">
                    {contactSearch ? 'No contacts found' : 'No contacts saved yet'}
                  </span>
                  {#if !contactSearch}
                    <button class="btn btn-primary btn-sm" on:click={() => { editingContact = null; showAddContact = true; }}>
                      <Plus size={14} />
                      Add your first contact
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- ============================================
             SIGN MESSAGE SECTION
             ============================================ -->
        {#if activeSection === 'sign'}
          <div class="content-section-title">Sign & Verify</div>
          <p class="content-section-desc">Cryptographically sign messages and verify signatures</p>

          <!-- Tab Switcher -->
          <div class="sign-tabs">
            <button class="sign-tab" class:active={signTab === 'sign'} on:click={() => signTab = 'sign'}>
              Sign Message
            </button>
            <button class="sign-tab" class:active={signTab === 'verify'} on:click={() => signTab = 'verify'}>
              Verify Signature
            </button>
          </div>

          {#if signTab === 'sign'}
            <!-- SIGN TAB -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">✍</span>
                  SIGN MESSAGE
                </div>
              </div>
              
              <div class="sign-content">
                <div class="form-group">
                  <label class="form-label">Message to Sign</label>
                  <textarea 
                    class="input textarea" 
                    bind:value={messageToSign} 
                    placeholder="Enter your message here..."
                    rows="4"
                  ></textarea>
                </div>
                
                <div class="form-actions">
                  <button class="btn btn-ghost" on:click={resetSign} disabled={!messageToSign && !signedResult}>
                    Clear
                  </button>
                  <button class="btn btn-primary" on:click={signTheMessage} disabled={signLoading || !messageToSign.trim()}>
                    {#if signLoading}
                      <Loader2 size={14} class="spin" />
                      Signing...
                    {:else}
                      Sign Message
                    {/if}
                  </button>
                </div>
                
                {#if signedResult}
                  <div class="signature-result">
                    <div class="result-header">
                      <Check size={16} />
                      <span>Message Signed Successfully</span>
                    </div>
                    
                    <div class="result-field">
                      <label class="form-label">Signed By</label>
                      <div class="result-value mono">{formatAddress(signedResult.address)}</div>
                    </div>
                    
                    <div class="result-field">
                      <label class="form-label">Signature (PEM)</label>
                      <div class="signature-box">
                        <pre class="signature-text">{signedResult.signature}</pre>
                      </div>
                    </div>
                    
                    <button class="btn btn-secondary" on:click={copySignature}>
                      <Copy size={14} />
                      Copy Signature
                    </button>
                  </div>
                {/if}
              </div>
            </div>
            
          {:else}
            <!-- VERIFY TAB -->
            <div class="cmd-stats-panel">
              <div class="cmd-panel-header">
                <div class="cmd-panel-title">
                  <span class="cmd-panel-icon">✓</span>
                  VERIFY SIGNATURE
                </div>
              </div>
              
              <div class="sign-content">
                <div class="form-group">
                  <label class="form-label">Signed Data (PEM)</label>
                  <textarea 
                    class="input textarea mono" 
                    bind:value={verifyInput} 
                    placeholder="Paste the PEM-encoded signature here..."
                    rows="8"
                  ></textarea>
                </div>
                
                <div class="form-actions">
                  <button class="btn btn-ghost" on:click={resetVerify} disabled={!verifyInput && !verifyResult}>
                    Clear
                  </button>
                  <button class="btn btn-primary" on:click={verifyTheSignature} disabled={verifyLoading || !verifyInput.trim()}>
                    {#if verifyLoading}
                      <Loader2 size={14} class="spin" />
                      Verifying...
                    {:else}
                      Verify Signature
                    {/if}
                  </button>
                </div>
                
                {#if verifyResult}
                  <div class="verify-result" class:valid={verifyResult.valid} class:invalid={!verifyResult.valid}>
                    <div class="result-header">
                      {#if verifyResult.valid}
                        <Check size={16} />
                        <span>Valid Signature</span>
                      {:else}
                        <AlertTriangle size={16} />
                        <span>Invalid Signature</span>
                      {/if}
                    </div>
                    
                    {#if verifyResult.valid}
                      <div class="result-field">
                        <label class="form-label">Signed By</label>
                        <div class="result-value mono">{formatAddress(verifyResult.signer)}</div>
                      </div>
                      
                      <div class="result-field">
                        <label class="form-label">Original Message</label>
                        <div class="result-value">{verifyResult.message}</div>
                      </div>
                    {:else if verifyResult.error}
                      <div class="result-error">{verifyResult.error}</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/if}

        <!-- ============================================
             BACKUP & SECURITY SECTION
             ============================================ -->
        {#if activeSection === 'backup'}
          <div class="content-section-title">Backup & Security</div>
          <p class="content-section-desc">View your recovery seed phrase and export keys</p>

          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">■</span>
                RECOVERY SEED
              </div>
            </div>

            <div class="backup-content">
              <div class="backup-warning">
                <AlertTriangle size={16} />
                <span>Your password is required every time the seed is revealed. The seed is held only while open and is auto-hidden after 60 seconds.</span>
              </div>

              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  on:click={() => { showSeedModal = true; }}
                >
                  <Eye size={14} />
                  View Seed Phrase
                </button>
              </div>
            </div>
          </div>

          <!-- Wallet Keys Panel -->
          <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">■</span>
                WALLET KEYS
              </div>
            </div>

            <div class="backup-content">
              <div class="backup-warning">
                <AlertTriangle size={16} />
                <span>Your password is required every time keys are revealed. Keys are held only while open and are auto-hidden after 60 seconds.</span>
              </div>

              <div class="keys-warning-critical">
                <AlertTriangle size={16} />
                <div>
                  <strong>CRITICAL:</strong> Your secret key provides full control over your wallet. Never share it with anyone.
                </div>
              </div>

              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  on:click={() => { showKeysModal = true; }}
                >
                  <Key size={14} />
                  View Keys
                </button>
              </div>
            </div>
          </div>

          <!-- Change Password Panel -->
          <div class="cmd-stats-panel" style="margin-top: var(--s-4);">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                <span class="cmd-panel-icon">■</span>
                CHANGE PASSWORD
              </div>
            </div>
            
            <div class="backup-content">
              {#if changePasswordSuccess}
                <div class="success-message">
                  <Check size={20} />
                  <div>
                    <strong>Password Changed Successfully</strong>
                    <p>Your wallet is now protected with the new password.</p>
                  </div>
                </div>
                <div class="form-actions">
                  <button class="btn btn-ghost" on:click={resetChangePassword}>
                    Done
                  </button>
                </div>
              {:else}
                <p class="change-password-desc">
                  Change your wallet's encryption password. You'll need your current password to make this change.
                </p>
                
                <div class="form-group">
                  <label class="form-label">Current Password</label>
                  <PasswordInput bind:value={changePasswordCurrent} placeholder="Enter current password" />
                </div>
                
                <div class="form-group">
                  <label class="form-label">New Password</label>
                  <PasswordInput bind:value={changePasswordNew} placeholder="Enter new password" />
                </div>
                
                <div class="form-group">
                  <label class="form-label">Confirm New Password</label>
                  <PasswordInput bind:value={changePasswordConfirm} placeholder="Confirm new password" hasError={changePasswordConfirm && !changePasswordsMatch} />
                  {#if changePasswordConfirm && !changePasswordsMatch}
                    <span class="form-hint error">Passwords do not match</span>
                  {/if}
                </div>
                
                {#if changePasswordError}
                  <div class="alert alert-error">
                    <AlertTriangle size={14} />
                    <span>{changePasswordError}</span>
                  </div>
                {/if}
                
                <div class="form-actions">
                  <button 
                    class="btn btn-primary" 
                    on:click={handleChangePassword} 
                    disabled={changePasswordLoading || !canChangePassword}
                  >
                    {#if changePasswordLoading}
                      <Loader2 size={14} class="spin" />
                      Changing...
                    {:else}
                      <Key size={14} />
                      Change Password
                    {/if}
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>

{:else if createdSeed}
  <!-- ============================================
       SEED PHRASE DISPLAY
       ============================================ -->
  <div class="wallet-page">
    <div class="wallet-container">
      <div class="seed-display">
        <div class="seed-header">
          <AlertTriangle size={32} class="seed-warning-icon" />
          <h2 class="seed-title">Your Recovery Seed</h2>
          <p class="seed-subtitle">Write down these 25 words in order. This is the ONLY way to recover your wallet.</p>
        </div>
        
        <div class="seed-grid">
          {#each seedWords as word, i}
            <div class="seed-word">
              <span class="seed-num">{i + 1}</span>
              <span class="seed-text">{word}</span>
            </div>
          {/each}
        </div>
        
        <div class="seed-warnings">
          <div class="warning-item">
            <AlertTriangle size={16} />
            <span>NEVER share your seed with anyone</span>
          </div>
          <div class="warning-item">
            <AlertTriangle size={16} />
            <span>Hologram will NEVER ask for your seed</span>
          </div>
          <div class="warning-item">
            <AlertTriangle size={16} />
            <span>Store this offline in a safe place</span>
          </div>
        </div>
        
        <label class="seed-confirm-label">
          <input type="checkbox" bind:checked={seedConfirmed} />
          <span>I have saved my recovery seed securely</span>
        </label>
        
        <div class="seed-actions">
          <button class="btn btn-secondary" on:click={() => { createdSeed = null; }}>
            Cancel
          </button>
          <button class="btn btn-primary" disabled={!seedConfirmed} on:click={confirmSeedAndOpen}>
            Continue to Wallet
          </button>
        </div>
      </div>
    </div>
  </div>

{:else}
  <!-- ============================================
       LOGIN FORM - New Sidebar Layout
       ============================================ -->
  <div class="page-layout">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-inner">
        <div class="page-header-left">
          <h1 class="page-header-title">
            <Wallet size={18} class="page-header-icon" strokeWidth={1.5} />
            Wallet
          </h1>
          <p class="page-header-desc">Open an existing wallet or create a new one</p>
        </div>
      </div>
    </div>

    <!-- Page Body with Sidebar -->
    <div class="page-body">
      <!-- Sidebar with Wallets -->
      <div class="page-sidebar">
        <!-- Recent Wallets Section -->
        <div class="page-sidebar-section">
          WALLETS
        </div>
        <nav class="page-sidebar-nav">
          {#if recentWalletsInfo.length > 0}
            {#each recentWalletsInfo as wallet}
              <button
                class="page-sidebar-item"
                class:active={walletPath === wallet.path && !selectedTestWallet}
                on:click={() => {
                  walletPath = wallet.path;
                  selectedTestWallet = null; // Clear test wallet selection when selecting a regular wallet
                }}
                title={wallet.path}
              >
                <span class="page-sidebar-item-icon">
                  <Wallet size={14} strokeWidth={1.5} />
                </span>
                <span class="page-sidebar-item-label">{wallet.filename}</span>
                <button 
                  class="sidebar-wallet-remove"
                  on:click={(e) => handleRemoveRecentWallet(wallet.path, e)}
                  title="Remove"
                >
                  ×
                </button>
              </button>
            {/each}
            <button class="sidebar-clear-btn" on:click={requestClearRecentWallets}>
              <Trash2 size={12} />
              Clear All
            </button>
          {:else}
            <div class="sidebar-empty">
              <span class="sidebar-empty-text">No recent wallets</span>
            </div>
          {/if}
        </nav>

        <!-- Test Wallets Section (Simulator Mode Only) -->
        {#if $settingsState.network === 'simulator'}
          <div class="page-sidebar-section" style="margin-top: var(--s-5)">
            TEST WALLETS
            {#if testWallets.length > 0}
              <span class="sidebar-badge">{testWallets.length}</span>
            {/if}
          </div>
          <nav class="page-sidebar-nav">
            {#if testWalletsLoading}
              <div class="sidebar-loading">
                <Loader2 size={14} class="spin" />
                <span>Loading...</span>
              </div>
            {:else if testWallets.length > 0}
              {#each testWalletsExpanded ? testWallets : testWallets.slice(0, 10) as wallet}
                <button
                  class="page-sidebar-item"
                  class:active={selectedTestWallet?.index === wallet.index}
                  on:click={() => selectTestWallet(wallet)}
                >
                  <span class="page-sidebar-item-icon test-wallet-index">
                    #{wallet.index}
                  </span>
                  <span class="page-sidebar-item-label test-wallet-addr">
                    {wallet.address.slice(0, 12)}...
                  </span>
                  <span class="test-wallet-balance-mini">
                    {(wallet.balance / 100000).toFixed(2)}
                  </span>
                </button>
              {/each}
              {#if testWallets.length > 10}
                <button 
                  class="sidebar-expand-btn" 
                  on:click={() => testWalletsExpanded = !testWalletsExpanded}
                >
                  {testWalletsExpanded ? 'Show Less' : `Show All ${testWallets.length}`}
                  <ChevronRight size={12} class={testWalletsExpanded ? 'rotate-down' : ''} />
                </button>
              {/if}
              <button class="sidebar-sync-btn" on:click={syncTestWallets} disabled={testWalletsLoading}>
                <RefreshCw size={12} />
                Sync Balances
              </button>
            {:else}
              <div class="sidebar-empty">
                <span class="sidebar-empty-text">Start simulator to load wallets</span>
              </div>
            {/if}
          </nav>
        {/if}
      </div>

      <!-- Content Area -->
      <div class="page-content">
        <!-- Selected Test Wallet Details (when in simulator mode and wallet selected) -->
        {#if $settingsState.network === 'simulator' && selectedTestWallet}
          <div class="content-section-title">Test Wallet Details</div>
          <p class="content-section-desc">Pre-seeded wallet for testing</p>

          <div class="cmd-stats-panel">
            <div class="cmd-panel-header">
              <div class="cmd-panel-title">
                WALLET #{selectedTestWallet.index}
              </div>
              <div class="cmd-panel-meta">
                <span class="badge badge-cyan">Test Wallet</span>
              </div>
            </div>
            
            <div class="test-wallet-details">
              <div class="test-wallet-field">
                <label class="form-label">Address</label>
                <div class="test-wallet-value-row">
                  <code class="test-wallet-code">{selectedTestWallet.address}</code>
                  <button class="btn-icon-sm" on:click={(e) => copyTestWalletAddress(selectedTestWallet, e)} title="Copy address">
                    <Copy size={12} />
                  </button>
                </div>
              </div>
              
              <div class="test-wallet-field">
                <label class="form-label">Balance</label>
                <div class="test-wallet-balance">
                  <span class="test-wallet-balance-value">{formatTestWalletBalance(selectedTestWallet.balance)}</span>
                  <span class="test-wallet-balance-unit">DERO</span>
                  {#if selectedTestWallet.locked > 0}
                    <span class="test-wallet-balance-locked">+ {formatTestWalletBalance(selectedTestWallet.locked)} locked</span>
                  {/if}
                </div>
              </div>
              
              <div class="test-wallet-field">
                <label class="form-label">RPC Port</label>
                <div class="test-wallet-value">{selectedTestWallet.rpcPort}</div>
              </div>
              
              <div class="test-wallet-field">
                <label class="form-label">Seed (Hex)</label>
                <div class="test-wallet-value-row">
                  <code class="test-wallet-code test-wallet-seed">{selectedTestWallet.seed}</code>
                  <button class="btn-icon-sm" on:click={(e) => copyTestWalletSeed(selectedTestWallet, e)} title="Copy seed">
                    <Key size={12} />
                  </button>
                </div>
              </div>
              
              <div class="test-wallet-actions">
                <button class="btn btn-primary" on:click={() => openTestWallet(selectedTestWallet)} disabled={loading}>
                  {#if loading}
                    <Loader2 size={14} class="spin" />
                    Connecting...
                  {:else}
                    <Wallet size={14} />
                    Use This Wallet
                  {/if}
                </button>
                <button 
                  class="btn btn-ghost" 
                  on:click={() => fundWallet(selectedTestWallet.index, 2000000)} 
                  disabled={fundingWallet}
                  title="Transfer funds from other test wallets to this one"
                >
                  {#if fundingWallet}
                    <Loader2 size={14} class="spin" />
                    Funding...
                  {:else}
                    <Coins size={14} />
                    Fund Wallet
                  {/if}
                </button>
              </div>
              {#if selectedTestWallet.balance < 1200000}
                <div class="test-wallet-hint">
                  <AlertTriangle size={14} />
                  <span>Low balance for batch deployments. Click "Fund Wallet" to transfer from other test wallets.</span>
                </div>
              {/if}
            </div>
          </div>

        {:else}
          <!-- Standard Login Form -->
          <div class="content-section-title">Connect Wallet</div>
          <p class="content-section-desc">Open an existing wallet, create a new one, or restore from seed</p>

          <!-- Tab Navigation -->
          <div class="tab-nav">
            <button class="tab-btn" class:active={activeTab === 'open'} on:click={() => activeTab = 'open'}>
              <FolderOpen size={16} />
              <span>Open</span>
            </button>
            <button class="tab-btn" class:active={activeTab === 'create'} on:click={() => activeTab = 'create'}>
              <Plus size={16} />
              <span>Create</span>
            </button>
            <button class="tab-btn" class:active={activeTab === 'restore'} on:click={() => activeTab = 'restore'}>
              <RotateCcw size={16} />
              <span>Restore</span>
            </button>
          </div>
          
          <div class="cmd-stats-panel">
            <div class="cmd-panel-body">
              {#if activeTab === 'open'}
                <!-- Open Wallet Tab -->
                <div class="form-group">
                  <label class="form-label">Wallet File</label>
                  <div class="input-row">
                    <input type="text" bind:value={walletPath} placeholder="/path/to/wallet.db" class="input" />
                    <button on:click={selectWalletFile} class="btn btn-secondary">Browse</button>
                  </div>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Password</label>
                  <PasswordInput bind:value={password} placeholder="Enter wallet password" onEnter={() => { if (!loading && walletPath) openWallet(); }} />
                </div>
                
                {#if error}
                  <div class="alert alert-error">
                    <span class="alert-text">{error}</span>
                  </div>
                {/if}
                
                <button on:click={openWallet} disabled={loading || !walletPath} class="btn btn-primary btn-block">
                  {loading ? 'Opening...' : 'Open Wallet'}
                </button>
                
              {:else if activeTab === 'create'}
                <!-- Create Wallet Tab -->
                <div class="form-group">
                  <label class="form-label">Wallet Name</label>
                  <input type="text" bind:value={createPath} placeholder="MyWallet" class="input" maxlength="25" />
                  <span class="form-hint">Just enter a name - the wallet file will be created automatically</span>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Password</label>
                  <PasswordInput bind:value={createPassword} placeholder="Create a strong password" />
                  {#if createPassword}
                    <div class="password-strength">
                      <div class="strength-bar">
                        {#each [1,2,3,4] as level}
                          <div class="strength-segment" style="background: {passwordStrength.level >= level ? passwordStrength.color : 'var(--void-deep)'}"></div>
                        {/each}
                      </div>
                      <span class="strength-label" style="color: {passwordStrength.color}">{passwordStrength.label}</span>
                    </div>
                  {/if}
                </div>
                
                <div class="form-group">
                  <label class="form-label">Confirm Password</label>
                  <input 
                    type="password" 
                    bind:value={createPasswordConfirm} 
                    placeholder="Confirm password" 
                    class="input"
                    class:input-error={createPasswordConfirm && !createPasswordsMatch}
                  />
                  {#if createPasswordConfirm && !createPasswordsMatch}
                    <span class="form-error">Passwords do not match</span>
                  {/if}
                </div>
                
                {#if createError}
                  <div class="alert alert-error">
                    <span class="alert-text">{createError}</span>
                  </div>
                {/if}
                
                <button 
                  on:click={handleCreateWallet} 
                  disabled={createLoading || !createPath || !createPasswordsMatch} 
                  class="btn btn-primary btn-block"
                >
                  {createLoading ? 'Creating...' : 'Create Wallet'}
                </button>
                
              {:else if activeTab === 'restore'}
                <!-- Restore Wallet Tab -->
                <div class="form-group">
                  <label class="form-label">Wallet Name</label>
                  <input type="text" bind:value={restorePath} placeholder="MyWallet" class="input" maxlength="25" />
                  <span class="form-hint">Enter a name for the restored wallet</span>
                </div>
                
                <div class="form-group">
                  <label class="form-label">Recovery Seed (25 words)</label>
                  <textarea
                    bind:value={restoreSeed}
                    placeholder="Enter your 25-word recovery seed..."
                    class="input textarea"
                    rows="4"
                  ></textarea>
                  <span class="form-hint">{seedWordCount} / 25 words</span>
                  {#if restoreSeed && !isValidSeed}
                    <span class="form-error">Seed must be exactly 25 words</span>
                  {/if}
                </div>
                
                <div class="form-group">
                  <label class="form-label">New Password</label>
                  <PasswordInput bind:value={restorePassword} placeholder="Create a password" />
                </div>
                
                <div class="form-group">
                  <label class="form-label">Confirm Password</label>
                  <input 
                    type="password" 
                    bind:value={restorePasswordConfirm} 
                    placeholder="Confirm password" 
                    class="input"
                    class:input-error={restorePasswordConfirm && !restorePasswordsMatch}
                  />
                  {#if restorePasswordConfirm && !restorePasswordsMatch}
                    <span class="form-error">Passwords do not match</span>
                  {/if}
                </div>
                
                {#if restoreError}
                  <div class="alert alert-error">
                    <span class="alert-text">{restoreError}</span>
                  </div>
                {/if}
                
                <button 
                  on:click={handleRestoreWallet} 
                  disabled={restoreLoading || !restorePath || !restorePasswordsMatch || !isValidSeed} 
                  class="btn btn-primary btn-block"
                >
                  {restoreLoading ? 'Restoring...' : 'Restore Wallet'}
                </button>
              {/if}
            </div>
          </div>
          
          <!-- XSWD Alternative -->
          <div class="xswd-section">
            <p class="xswd-text">Or connect via XSWD to an external wallet</p>
            <button
              on:click={connectXSWD}
              disabled={$appState.xswdConnected}
              class="btn btn-secondary"
            >
              {$appState.xswdConnected ? 'XSWD Connected' : 'Connect via XSWD'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Modals -->
<AddContactModal 
  bind:show={showAddContact} 
  editContact={editingContact}
  on:saved={loadContacts}
  on:close={() => { editingContact = null; }}
/>

<!-- Reveal modals: own all decrypted seed/key state inside the child so
     unmounting (close, ESC, wallet switch, wallet close) drops the only
     reference and lets GC reclaim the secret. -->
<RevealSecretModal
  bind:show={showSeedModal}
  kind="seed"
/>
<RevealSecretModal
  bind:show={showKeysModal}
  kind="keys"
/>

{#if showClearWalletsConfirm}
  <div class="modal-overlay" on:click={cancelClearRecentWallets}>
    <div class="modal-content clear-wallets-modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <span class="modal-icon error"><Trash2 size={16} /></span>
          <span>Clear Recent Wallets</span>
        </div>
        <button class="modal-close" on:click={cancelClearRecentWallets} disabled={clearingRecentWallets}>
          <X size={18} />
        </button>
      </div>
      <div class="modal-body">
        <p class="clear-wallets-lead">
          Remove saved wallet shortcuts from the sidebar.
        </p>
        <div class="clear-wallets-meta">
          <span class="clear-wallets-count">{recentWalletsInfo.length}</span>
          <span class="clear-wallets-label">recent {recentWalletsInfo.length === 1 ? 'wallet' : 'wallets'}</span>
        </div>
        <div class="clear-wallets-warning">
          <AlertTriangle size={16} />
          <span>Wallet files remain on disk. You can reopen them later with Browse.</span>
        </div>
      </div>
      <div class="modal-footer modal-footer-spread">
        <button class="btn btn-secondary" on:click={cancelClearRecentWallets} disabled={clearingRecentWallets}>
          Cancel
        </button>
        <button class="btn btn-danger" on:click={confirmClearRecentWallets} disabled={clearingRecentWallets}>
          {#if clearingRecentWallets}
            <Loader2 size={14} class="spin" />
            Clearing...
          {:else}
            Clear All
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ============================================
     WALLET PAGE STYLES
     ============================================ */
  
  /* Login Page (unchanged) */
  .wallet-page {
    height: 100%;
    overflow: auto;
    padding: var(--s-6);
  }
  
  .wallet-container {
    max-width: 480px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }
  
  /* Tab Navigation */
  .tab-nav {
    display: flex;
    gap: var(--s-2);
    background: var(--void-deep);
    padding: var(--s-2);
    border-radius: var(--r-md);
    margin-bottom: var(--s-2);
  }
  
  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-3);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--dur-fast);
  }
  
  .tab-btn:hover { color: var(--text-1); background: var(--void-up); }
  .tab-btn.active { background: var(--void-mid); color: var(--cyan-400); }
  
  /* Input Row */
  .input-row { display: flex; gap: var(--s-2); }
  .input-row .input { flex: 1; }
  
  /* Textarea */
  .textarea {
    font-family: var(--font-mono);
    resize: vertical;
    min-height: 100px;
  }
  
  /* ============================================
     REGISTRATION BANNER STYLES
     ============================================ */
  
  .registration-banner {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4);
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }
  
  .registration-banner.pending {
    background: linear-gradient(135deg, rgba(34, 211, 238, 0.1) 0%, rgba(6, 182, 212, 0.05) 100%);
    border-color: rgba(34, 211, 238, 0.3);
  }
  
  .registration-banner.pending :global(.registration-icon) {
    color: var(--cyan-400);
  }
  
  .registration-banner.pending .registration-text strong {
    color: var(--cyan-300);
  }
  
  .registration-banner-content {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
  }
  
  .registration-banner :global(.registration-icon) {
    color: var(--amber-400);
    flex-shrink: 0;
    margin-top: 2px;
  }
  
  .registration-text {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .registration-text strong {
    color: var(--amber-300);
    font-size: 13px;
  }
  
  .registration-text span {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.5;
  }
  
  .registration-progress {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--s-2);
    border-top: 1px solid rgba(251, 191, 36, 0.2);
  }
  
  .registration-stats {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 12px;
    color: var(--text-3);
  }
  
  .registration-stats :global(.spin) {
    color: var(--amber-400);
  }
  
  .registration-time {
    color: var(--text-4);
  }
  
  /* ============================================
     LOGIN SIDEBAR STYLES
     ============================================ */
  
  /* Sidebar wallet item remove button */
  .sidebar-wallet-remove {
    opacity: 0;
    padding: 2px 6px;
    background: transparent;
    border: none;
    color: var(--text-4);
    font-size: 14px;
    cursor: pointer;
    transition: all 150ms ease;
    margin-left: auto;
  }
  .page-sidebar-item:hover .sidebar-wallet-remove { opacity: 1; }
  .sidebar-wallet-remove:hover { color: var(--red-400); }
  
  /* Sidebar clear all button */
  .sidebar-clear-btn {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
    margin: var(--s-2) var(--s-2) 0;
    background: transparent;
    border: 1px dashed var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-4);
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  .sidebar-clear-btn:hover { 
    color: var(--red-400); 
    border-color: rgba(248, 113, 113, 0.3);
  }
  
  /* Sidebar empty state */
  .sidebar-empty {
    padding: var(--s-4) var(--s-3);
    text-align: center;
  }
  .sidebar-empty-text {
    font-size: 11px;
    color: var(--text-4);
  }
  
  /* Sidebar loading state */
  .sidebar-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-4) var(--s-3);
    color: var(--text-3);
    font-size: 12px;
  }
  
  /* Sidebar badge (count) */
  .sidebar-badge {
    margin-left: auto;
    padding: 1px 6px;
    background: rgba(34, 211, 238, 0.15);
    border-radius: var(--r-full);
    color: var(--cyan-400);
    font-size: 10px;
    font-weight: 600;
  }
  
  /* Sidebar expand button */
  .sidebar-expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    width: 100%;
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    color: var(--cyan-400);
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  .sidebar-expand-btn:hover { background: var(--void-up); }
  .sidebar-expand-btn :global(.rotate-down) { transform: rotate(90deg); }
  
  /* Sidebar sync button */
  .sidebar-sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    width: calc(100% - var(--s-4));
    margin: var(--s-2);
    padding: var(--s-2);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  .sidebar-sync-btn:hover:not(:disabled) { 
    background: var(--void-up); 
    color: var(--cyan-400);
    border-color: var(--border-accent);
  }
  .sidebar-sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  :global(.clear-wallets-modal) {
    max-width: 420px;
  }

  .clear-wallets-lead {
    margin: 0 0 var(--s-4);
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.5;
  }

  .clear-wallets-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: var(--s-4);
    margin-bottom: var(--s-4);
    background: linear-gradient(90deg, rgba(248, 113, 113, 0.12) 0%, rgba(248, 113, 113, 0.04) 50%, transparent 100%);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--r-md);
  }

  .clear-wallets-count {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 600;
    line-height: 1;
    color: var(--status-err);
  }

  .clear-wallets-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .clear-wallets-warning {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.18);
    border-radius: var(--r-md);
    color: var(--status-warn);
    font-size: 12px;
    line-height: 1.5;
  }

  .clear-wallets-warning :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }
  
  /* Test wallet mini balance in sidebar */
  .test-wallet-balance-mini {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-5);
    margin-left: auto;
  }
  
  /* Test wallet index in sidebar */
  .test-wallet-index {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--violet-400);
  }
  .test-wallet-addr {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  
  /* ============================================
     TEST WALLET DETAILS PANEL
     ============================================ */
  
  .test-wallet-details {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  .test-wallet-field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .test-wallet-value-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .test-wallet-code {
    flex: 1;
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2);
    word-break: break-all;
  }
  
  .test-wallet-seed {
    font-size: 10px;
    color: var(--violet-400);
  }
  
  .test-wallet-value {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-2);
  }
  
  .test-wallet-balance {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
  }
  
  .test-wallet-balance-value {
    font-family: var(--font-mono);
    font-size: 24px;
    font-weight: 600;
    color: var(--cyan-400);
  }
  
  .test-wallet-balance-unit {
    font-size: 14px;
    color: var(--text-3);
    text-transform: uppercase;
  }
  
  .test-wallet-balance-locked {
    font-size: 12px;
    color: var(--text-4);
  }
  
  .test-wallet-actions {
    margin-top: var(--s-2);
    display: flex;
    gap: var(--s-2);
  }
  .test-wallet-hint {
    margin-top: var(--s-3);
    padding: var(--s-2) var(--s-3);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-md);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 12px;
    color: var(--status-warn);
  }
  
  /* XSWD Section */
  .xswd-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-md);
  }
  .xswd-text { 
    font-size: 12px; 
    color: var(--text-4); 
    margin: 0;
  }
  
  /* Seed Display */
  .seed-display {
    background: var(--void-mid);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-lg);
    padding: var(--s-5);
  }
  .seed-header { 
    text-align: center; 
    margin-bottom: var(--s-5); 
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  :global(.seed-warning-icon) { 
    color: var(--status-warn); 
    margin-bottom: var(--s-3);
    display: block;
  }
  .seed-title {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-1);
    margin: 0 0 var(--s-2) 0;
  }
  .seed-subtitle { font-size: 13px; color: var(--text-3); margin: 0; }
  .seed-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--s-2);
    background: var(--void-deep);
    padding: var(--s-4);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }
  .seed-word {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-2);
    background: var(--void-mid);
    border-radius: var(--r-sm);
  }
  .seed-num { font-size: 9px; color: var(--text-4); margin-bottom: 2px; }
  .seed-text { font-family: var(--font-mono); font-size: 11px; color: var(--text-1); font-weight: 500; }
  .seed-warnings { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-4); }
  .warning-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: rgba(251, 191, 36, 0.1);
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--status-warn);
  }
  .seed-confirm-label {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
    cursor: pointer;
    font-size: 13px;
    color: var(--text-2);
  }
  .seed-confirm-label input { accent-color: var(--cyan-400); }
  .seed-actions { display: flex; gap: var(--s-3); justify-content: flex-end; }
  
  /* ============================================
     CONNECTED WALLET STYLES
     ============================================ */
  
  /* Live Dot */
  .live-dot {
    width: 6px;
    height: 6px;
    background: var(--status-ok);
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  /* Sidebar Coming Soon Badge */
  .sidebar-coming-soon {
    font-size: 9px;
    padding: 2px 6px;
    background: rgba(251, 191, 36, 0.15);
    color: var(--status-warn);
    border-radius: var(--r-xs);
    margin-left: auto;
  }
  
  .page-sidebar-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Balance Display */
  .wallet-balance-display {
    padding: var(--s-6);
    text-align: center;
  }
  
  .balance-main {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    position: relative;
  }
  
  .balance-value {
    font-size: 36px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--cyan-400);
  }
  
  .balance-unit {
    font-size: 16px;
    color: var(--text-3);
  }
  
  .balance-locked {
    font-size: 12px;
    color: var(--text-4);
    margin-top: var(--s-2);
  }

  .balance-main-left {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
  }

  .address-row-content {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  
  .wallet-address-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    margin-top: var(--s-4);
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-sm);
    position: relative;
  }
  
  .address-text {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }

  /* Wallet filename badge — subtle metadata pill in panel header */
  .badge-wallet-file {
    border-color: var(--border-default);
    color: var(--text-3);
    background: var(--void-deep);
    font-family: var(--font-mono);
    text-transform: none;
    letter-spacing: 0.02em;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Preserve layout space for copy button when address is hidden */
  .copy-address-btn.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  
  /* Icon Buttons */
  .btn-icon-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-4);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .btn-icon-sm:hover {
    background: var(--void-hover);
    color: var(--cyan-400);
  }
  
  /* Quick Actions Grid */
  .quick-actions-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-3);
    margin: var(--s-4) 0;
  }
  
  .quick-action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    color: var(--text-2);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .quick-action-btn:hover {
    background: var(--void-up);
    border-color: var(--cyan-400);
    color: var(--cyan-400);
  }
  
  .quick-action-btn span {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  /* Transaction Lists */
  .recent-tx-list {
    display: flex;
    flex-direction: column;
  }
  
  .tx-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border-dim);
    transition: background 150ms ease;
    cursor: pointer;
  }
  
  .tx-row:last-child { border-bottom: none; }
  .tx-row:hover { background: var(--void-up); }
  
  .tx-left { display: flex; align-items: center; gap: var(--s-3); }
  
  .tx-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--void-deep);
    flex-shrink: 0;
  }
  
  .tx-icon.tx-in { color: var(--status-ok); background: rgba(52, 211, 153, 0.15); }
  .tx-icon.tx-out { color: var(--status-err); background: rgba(248, 113, 113, 0.15); }
  
  .tx-info { display: flex; flex-direction: column; gap: 2px; }
  .tx-type { font-size: 13px; color: var(--text-1); font-weight: 500; }
  .tx-time { font-size: 11px; color: var(--text-4); }
  
  .tx-amt {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
  }
  
  .tx-amt-in { color: var(--status-ok); }
  .tx-amt-out { color: var(--text-2); }
  
  /* Send Form */
  .send-form-content { padding: var(--s-4); }
  
  .form-label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .input-with-action {
    display: flex;
    gap: var(--s-2);
  }
  
  .input-with-action .input { flex: 1; }
  
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-3);
    margin-top: var(--s-4);
  }
  
  .form-actions-split { justify-content: space-between; }
  
  .step-indicator {
    font-size: 11px;
    color: var(--text-4);
    padding: 2px 8px;
    background: var(--void-deep);
    border-radius: var(--r-sm);
  }
  
  /* Confirm Details */
  .confirm-details {
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-4);
    margin-bottom: var(--s-4);
  }
  
  .confirm-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .confirm-row:last-child { border-bottom: none; }
  
  .confirm-label { font-size: 12px; color: var(--text-3); }
  .confirm-value { font-size: 13px; color: var(--text-1); font-family: var(--font-mono); }
  .confirm-value-amount { color: var(--cyan-400); font-weight: 600; font-size: 16px; }
  .confirm-value-address { font-size: 11px; }
  
  /* Success State */
  .success-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--s-4);
  }
  
  .success-icon {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(52, 211, 153, 0.1);
    border-radius: 50%;
    color: var(--status-ok);
    margin-bottom: var(--s-4);
  }
  
  .success-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0 0 var(--s-2) 0;
  }
  
  .success-text {
    font-size: 13px;
    color: var(--text-3);
    margin: 0 0 var(--s-4) 0;
  }
  
  .txid-display {
    width: 100%;
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-3);
    margin-bottom: var(--s-4);
  }
  
  .txid-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-4);
    margin-bottom: var(--s-2);
    display: block;
  }
  
  .txid-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
  }
  
  .txid-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  
  /* Receive Content */
  .receive-content { padding: var(--s-4); text-align: center; }
  
  .address-type-toggle {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--void-deep);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }
  
  .toggle-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--text-3);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .toggle-btn:hover { color: var(--text-1); }
  .toggle-btn.active { background: var(--void-mid); color: var(--cyan-400); }
  .toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  
  .address-hint {
    font-size: 11px;
    color: var(--text-4);
    text-align: center;
    margin-bottom: var(--s-3);
  }

  .integrated-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin-bottom: var(--s-4);
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-md);
    border: 1px solid var(--border-dim);
    text-align: left;
  }
  
  .qr-display {
    display: flex;
    justify-content: center;
    margin: var(--s-4) 0;
  }
  
  .address-display {
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-3);
    margin: 0 auto var(--s-4) auto;
    overflow: hidden;
    text-align: center;
    max-width: fit-content;
  }
  
  .address-full {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2);
    word-break: break-all;
    line-height: 1.5;
    display: inline-block;
  }
  
  .receive-actions {
    display: flex;
    justify-content: center;
    margin-bottom: var(--s-4);
  }
  
  .receive-warning {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-3);
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-md);
    font-size: 11px;
    color: var(--status-warn);
    text-align: center;
  }
  
  /* Request Content */
  .request-content { padding: var(--s-4); }
  
  .uri-display { margin-bottom: var(--s-4); }
  
  .uri-box {
    background: var(--void-deep);
    border-radius: var(--r-md);
    padding: var(--s-3);
    margin-top: var(--s-2);
  }
  
  .uri-value {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2);
    word-break: break-all;
    line-height: 1.5;
  }
  
  .request-actions { display: flex; justify-content: center; }
  
  .request-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-8);
    color: var(--text-4);
  }
  
  .request-placeholder p {
    font-size: 13px;
    margin: 0;
  }
  
  /* History Filters */
  .history-filters {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--s-4);
    flex-wrap: wrap;
    gap: var(--s-3);
  }
  
  .filter-tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--void-deep);
    border-radius: var(--r-md);
  }
  
  .filter-tab {
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    font-size: 12px;
    color: var(--text-3);
    cursor: pointer;
    border-radius: var(--r-sm);
    transition: all 150ms ease;
  }
  
  .filter-tab:hover { color: var(--text-1); }
  .filter-tab.active { background: var(--void-mid); color: var(--cyan-400); }
  
  .filter-actions {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  
  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    color: var(--text-4);
  }
  
  .search-input {
    background: transparent;
    border: none;
    font-size: 12px;
    color: var(--text-1);
    width: 120px;
  }
  
  .search-input:focus { outline: none; }
  .search-input::placeholder { color: var(--text-4); }
  
  .count-badge {
    font-size: 11px;
    color: var(--text-4);
    padding: 2px 8px;
    background: var(--void-deep);
    border-radius: var(--r-sm);
  }
  
  /* Full Transaction List */
  .tx-list-full { 
    display: flex; 
    flex-direction: column; 
    max-height: 60vh;
    overflow-y: auto;
    /* Prevent focus ring when container is focused for scroll */
    outline: none;
  }
  
  /* tx-row-detailed styles consolidated in the Transaction Detail Panel section below */
  
  /* Grid column 1: Icon */
  .tx-icon-wrap { 
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  /* Grid column 2: Type + TXID stacked */
  .tx-details {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
  }
  
  .tx-id {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.02em;
  }
  
  .tx-msg-badge {
    font-size: 9px;
    padding: 1px 5px;
    background: rgba(167, 139, 250, 0.12);
    border: 1px solid rgba(167, 139, 250, 0.25);
    border-radius: var(--r-sm);
    color: var(--violet-400);
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  
  /* Grid column 3: Amount + Timestamp stacked */
  .tx-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  
  .tx-amount {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  
  .tx-amount.positive { color: var(--status-ok); }
  .tx-amount.negative { color: var(--text-2); }
  
  .tx-timestamp {
    font-size: 11px;
    color: var(--text-4);
    white-space: nowrap;
  }
  
  /* Transaction Label Styles */
  .tx-type-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .tx-label-badge {
    font-size: 10px;
    padding: 1px 6px;
    background: rgba(34, 211, 238, 0.1);
    border: 1px solid rgba(34, 211, 238, 0.2);
    border-radius: var(--r-sm);
    color: var(--cyan-400);
    white-space: nowrap;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .tx-label-edit {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-top: 2px;
  }
  
  .tx-label-input {
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 2px 6px;
    font-size: 11px;
    color: var(--text-1);
    width: 140px;
  }
  
  .tx-label-input:focus {
    outline: none;
    border-color: var(--cyan-400);
  }
  
  .tx-label-input::placeholder {
    color: var(--text-4);
  }
  
  .btn-icon-xs {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--void-mid);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: pointer;
    font-size: 10px;
    transition: all 150ms ease;
  }
  
  .btn-icon-xs:hover {
    background: var(--void-up);
    color: var(--text-1);
    border-color: var(--border-dim);
  }
  
  .btn-icon-xs:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Grid column 4: Actions */
  .tx-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  
  .tx-row-detailed:hover .tx-actions .btn-icon-sm {
    opacity: 1;
  }
  
  .tx-actions .btn-icon-sm {
    opacity: 0.4;
    transition: opacity 150ms ease;
  }
  
  .tx-actions .btn-icon-sm:hover {
    opacity: 1;
  }
  
  /* Change Password Styles */
  .change-password-desc {
    font-size: 13px;
    color: var(--text-3);
    margin-bottom: var(--s-4);
    line-height: 1.5;
  }
  
  .success-message {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
    background: rgba(52, 211, 153, 0.08);
    border: 1px solid rgba(52, 211, 153, 0.2);
    border-radius: var(--r-md);
    color: var(--status-ok);
  }
  
  .success-message strong {
    display: block;
    margin-bottom: var(--s-1);
  }
  
  .success-message p {
    font-size: 13px;
    color: var(--text-2);
    margin: 0;
  }
  
  .form-hint.error {
    color: var(--status-err);
    font-size: 11px;
    margin-top: var(--s-1);
  }
  
  .input-error {
    border-color: var(--status-err) !important;
  }
  
  /* Spin Animation */
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* ============================================
     ADDRESS BOOK STYLES
     ============================================ */
  
  .addressbook-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }
  
  .contacts-list {
    display: flex;
    flex-direction: column;
  }
  
  .contact-row {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
    border-bottom: 1px solid var(--border-dim);
    transition: background 150ms ease;
  }
  
  .contact-row:last-child {
    border-bottom: none;
  }
  
  .contact-row:hover {
    background: var(--void-up);
  }
  
  .contact-row:hover .contact-actions .action-btn {
    opacity: 1;
  }
  
  .contact-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--void-deep);
    border-radius: 50%;
    color: var(--text-3);
    flex-shrink: 0;
  }
  
  .contact-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .contact-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .contact-address {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
  }
  
  .contact-notes {
    font-size: 11px;
    color: var(--text-4);
    margin-top: 2px;
  }
  
  .contact-actions {
    display: flex;
    gap: var(--s-1);
    flex-shrink: 0;
  }
  
  .contact-actions .action-btn {
    opacity: 0;
    transition: all 150ms ease;
  }
  
  .action-btn-send:hover {
    background: var(--cyan-400);
    border-color: var(--cyan-400);
    color: var(--void-base);
  }
  
  /* ============================================
     SIGN/VERIFY STYLES
     ============================================ */
  
  .sign-tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--void-deep);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
  }
  
  .sign-tab {
    flex: 1;
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-3);
    cursor: pointer;
    border-radius: var(--r-sm);
    transition: all 150ms ease;
  }
  
  .sign-tab:hover {
    color: var(--text-1);
  }
  
  .sign-tab.active {
    background: var(--void-mid);
    color: var(--cyan-400);
  }
  
  .sign-content {
    padding: var(--s-4);
  }
  
  .textarea {
    font-family: var(--font-mono);
    resize: vertical;
    min-height: 80px;
  }
  
  .signature-result,
  .verify-result {
    margin-top: var(--s-4);
    padding: var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-md);
    border: 1px solid var(--border-dim);
  }
  
  .verify-result.valid {
    border-color: rgba(52, 211, 153, 0.3);
    background: rgba(52, 211, 153, 0.05);
  }
  
  .verify-result.invalid {
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(248, 113, 113, 0.05);
  }
  
  .result-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 13px;
    font-weight: 500;
    color: var(--status-ok);
    margin-bottom: var(--s-3);
  }
  
  .verify-result.invalid .result-header {
    color: var(--status-err);
  }
  
  .result-field {
    margin-bottom: var(--s-3);
  }
  
  .result-field:last-child {
    margin-bottom: 0;
  }
  
  .result-value {
    font-size: 13px;
    color: var(--text-1);
    padding: var(--s-2) var(--s-3);
    background: var(--void-mid);
    border-radius: var(--r-sm);
    word-break: break-all;
  }
  
  .result-value.mono {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  
  .result-error {
    font-size: 12px;
    color: var(--status-err);
  }
  
  .signature-box {
    background: var(--void-mid);
    border-radius: var(--r-sm);
    padding: var(--s-3);
    overflow-x: auto;
  }
  
  .signature-text {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  
  /* Backup & Security Styles */
  .backup-content {
    padding: var(--s-4);
  }
  
  .backup-warning {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
    font-size: 12px;
    color: var(--status-warn);
  }

  /* Keys Display Styles */
  .keys-warning-critical {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--r-md);
    margin-bottom: var(--s-4);
    font-size: 12px;
    color: var(--status-err);
  }
  
  .keys-warning-critical strong {
    font-weight: 600;
  }

  .tx-label { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(82, 200, 219, 0.15); border: 1px solid rgba(82, 200, 219, 0.3); border-radius: 4px; font-size: 0.75rem; color: #52c8db; }

  /* Smart-paste URI hint + reveal */
  .uri-hint-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
  .uri-hint-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
  .uri-hint-row--ok   { color: var(--status-ok); }
  .uri-hint-row--ok   .uri-hint-dot { background: var(--status-ok); box-shadow: 0 0 8px rgba(52, 211, 153, 0.6); }
  .uri-hint-row--info { color: var(--cyan-300); }
  .uri-hint-row--info .uri-hint-dot { background: var(--cyan-400); box-shadow: var(--glow-cyan-xs); }
  .uri-hint-row--warn { color: var(--status-warn); }
  .uri-hint-row--warn .uri-hint-dot { background: var(--status-warn); box-shadow: 0 0 8px rgba(251, 191, 36, 0.6); }
  .uri-hint-row--err  { color: var(--status-err); }
  .uri-hint-row--err  .uri-hint-dot { background: var(--status-err); box-shadow: 0 0 8px rgba(248, 113, 113, 0.6); animation: uriPulseErr 1s ease-in-out infinite; }
  @keyframes uriPulseErr { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .uri-reveal { margin-top: 12px; padding: 12px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px; }
  .uri-reveal-label { font-size: 9px; letter-spacing: 2px; font-weight: 700; text-transform: uppercase; opacity: 0.85; margin-bottom: 2px; }
  .uri-reveal--ok   { background: rgba(52, 211, 153, 0.06);  border: 1px solid rgba(52, 211, 153, 0.25);  color: var(--status-ok); }
  .uri-reveal--info { background: rgba(34, 211, 238, 0.06);  border: 1px solid var(--border-accent);     color: var(--cyan-300); }
  .uri-reveal--warn { background: rgba(251, 191, 36, 0.06);  border: 1px solid rgba(251, 191, 36, 0.25); color: var(--status-warn); }
  .uri-reveal--err  { background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.25); color: var(--status-err); }
  .uri-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .btn.btn-warn { background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); color: var(--status-warn); }
  .btn.btn-warn:hover:not(:disabled) { background: rgba(251, 191, 36, 0.18); }
  .btn.btn-err  { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); color: var(--status-err); }
  .btn.btn-err:hover:not(:disabled)  { background: rgba(248, 113, 113, 0.18); }
  .input.uri-locked { background: var(--void-pure) !important; color: var(--cyan-300) !important; border-color: var(--border-accent) !important; box-shadow: var(--glow-cyan-xs); }
  .input.uri-warn   { background: var(--void-pure) !important; color: var(--status-warn) !important; border-color: rgba(251, 191, 36, 0.5) !important; box-shadow: 0 0 12px rgba(251, 191, 36, 0.15); }
  .input.uri-err    { background: var(--void-pure) !important; color: var(--status-err) !important; border-color: rgba(248, 113, 113, 0.5) !important; box-shadow: 0 0 12px rgba(248, 113, 113, 0.15); }
  .input.uri-half   { background: var(--void-pure) !important; color: var(--cyan-300) !important; border-color: var(--border-accent) !important; border-style: dashed !important; }
  @keyframes uriMorphIn {
    0%   { transform: scale(0.98); border-color: var(--border-default); box-shadow: none; }
    60%  { transform: scale(1.01); border-color: var(--border-accent); box-shadow: var(--glow-cyan-md); }
    100% { transform: scale(1);    border-color: var(--border-accent); box-shadow: var(--glow-cyan-xs); }
  }
  .input.uri-locked.uri-morphed { animation: uriMorphIn 600ms cubic-bezier(0.34, 1.56, 0.64, 1) 1; }

  /* Mining Earnings Summary */
  .mining-summary { display: flex; gap: 16px; padding: 10px 16px; background: rgba(82, 200, 219, 0.08); border: 1px solid rgba(82, 200, 219, 0.15); border-radius: 8px; margin-bottom: 12px; font-size: 0.8rem; }
  .mining-stat { color: rgba(255,255,255,0.7); }
  .mining-stat:first-child { color: #52c8db; font-weight: 600; }

  /* Wallet path display moved to .balance-wallet-file in balance header */

  /* Contact Picker Dropdown */
  .contact-picker-dropdown {
    position: relative;
    margin-top: var(--s-1);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-md);
    max-height: 180px;
    overflow-y: auto;
    z-index: 10;
  }
  .contact-picker-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-dim);
    cursor: pointer;
    transition: background 150ms ease;
    text-align: left;
  }
  .contact-picker-item:last-child { border-bottom: none; }
  .contact-picker-item:hover { background: var(--void-up); }
  .contact-picker-label { font-size: 12px; color: var(--text-1); font-weight: 500; }
  .contact-picker-addr { font-size: 11px; color: var(--text-4); font-family: var(--font-mono); }
  .contact-picker-empty { padding: var(--s-3); text-align: center; font-size: 12px; color: var(--text-4); }

  /* Send Confirm Full Address */
  .confirm-address-full {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--pink-400);
    word-break: break-all;
    line-height: 1.5;
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-sm);
    border: 1px solid var(--border-dim);
  }
  .confirm-address-toggle {
    background: none;
    border: none;
    color: var(--cyan-400);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    margin-top: var(--s-1);
  }
  .confirm-address-toggle:hover { text-decoration: underline; }

  /* Inline Confirm Delete */
  .confirm-delete-btn {
    animation: confirmPulse 1s ease-in-out infinite;
  }
  @keyframes confirmPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* Loading Skeletons */
  .skeleton-line {
    height: 14px;
    background: linear-gradient(90deg, var(--void-deep) 25%, var(--void-up) 50%, var(--void-deep) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: var(--r-sm);
  }
  .skeleton-lg { height: 36px; }
  .skeleton-sm { height: 12px; }
  .skeleton-xs { height: 10px; }
  .skeleton-circle {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(90deg, var(--void-deep) 25%, var(--void-up) 50%, var(--void-deep) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }
  .skeleton-block {
    background: linear-gradient(90deg, var(--void-deep) 25%, var(--void-up) 50%, var(--void-deep) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    min-height: 60px;
    border-radius: var(--r-md);
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Load More */
  .load-more-row {
    display: flex;
    justify-content: center;
    padding: var(--s-3);
    border-top: 1px solid var(--border-dim);
  }

  /* Transaction Row - Grid Layout */
  .tx-row-main {
    display: grid;
    grid-template-columns: 44px 1fr 150px 72px;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    cursor: pointer;
    transition: background 150ms ease;
  }
  .tx-row-main:hover { background: var(--void-up); }
  
  /* tx-row-detailed is the outer wrapper; layout handled by tx-row-main grid */
  .tx-row-detailed { 
    border-bottom: 1px solid var(--border-dim);
    border-left: 2px solid transparent;
    transition: border-color 150ms ease, background 150ms ease;
  }
  .tx-row-detailed:last-child { border-bottom: none; }
  .tx-row-detailed:hover { background: var(--void-up); }
  .tx-row-detailed.tx-expanded { 
    background: rgba(34, 211, 238, 0.03);
    border-left-color: var(--cyan-500);
  }
  .tx-detail-panel {
    padding: var(--s-4);
    padding-left: calc(var(--s-4) + 44px + var(--s-3));
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--s-4) var(--s-6);
    border-top: 1px solid var(--border-dim);
    background: var(--void);
    animation: slideDown 150ms ease-out;
  }
  
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .tx-detail-panel .tx-detail-row:first-child,
  .tx-detail-panel .tx-detail-proof-row {
    grid-column: 1 / -1;
  }
  .tx-detail-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tx-detail-label {
    font-size: 10px;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }
  .tx-detail-value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    word-break: break-all;
  }
  .tx-detail-value-row {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
  }
  .tx-detail-value-row .btn-icon-sm {
    flex-shrink: 0;
    opacity: 0.6;
  }
  .tx-detail-value-row .btn-icon-sm:hover {
    opacity: 1;
  }
  .tx-detail-txid {
    font-size: 11px;
    line-height: 1.4;
  }
  .tx-detail-address {
    color: var(--pink-400);
    font-size: 11px;
    line-height: 1.4;
  }
  .tx-detail-direction {
    font-weight: 500;
  }
  .tx-direction-in {
    color: var(--status-ok);
  }
  .tx-direction-out {
    color: var(--text-2);
  }
  .tx-detail-amount {
    font-weight: 600;
    font-size: 13px;
  }
  .tx-detail-amount.positive {
    color: var(--status-ok);
  }
  .tx-detail-amount.negative {
    color: var(--text-2);
  }
  .tx-detail-burn {
    color: var(--status-warn);
  }
  .tx-detail-port {
    font-family: var(--font-mono);
    color: var(--cyan-400);
    font-size: 12px;
  }
  .tx-detail-comment {
    color: var(--text-2);
    font-style: italic;
    background: var(--void-deep);
    padding: 6px 10px;
    border-radius: var(--r-sm);
    border-left: 2px solid var(--cyan-400);
    font-size: 12px;
  }
  .tx-detail-proof-row .tx-detail-value {
    font-size: 10px;
    line-height: 1.4;
    max-height: 60px;
    overflow-y: auto;
    background: var(--void-deep);
    padding: 6px 8px;
    border-radius: var(--r-sm);
  }
  .tx-detail-relative {
    color: var(--text-4);
    font-size: 11px;
  }
  .tx-detail-actions {
    grid-column: 1 / -1;
    padding-top: var(--s-2);
    margin-top: var(--s-2);
    border-top: 1px solid var(--border-dim);
    display: flex;
    gap: var(--s-2);
  }

  /* Sync Progress Bar */
  .sync-progress-wrap {
    padding: 0 var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .sync-progress-bar {
    height: 3px;
    background: var(--void-deep);
    border-radius: 2px;
    overflow: hidden;
  }
  .sync-progress-fill {
    height: 100%;
    background: var(--cyan-400);
    border-radius: 2px;
    transition: width 500ms ease;
  }
  .sync-progress-text {
    font-size: 10px;
    color: var(--text-4);
    text-align: center;
  }

  /* Transaction Date Group */
  .tx-date-group {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .tx-date-label {
    padding: var(--s-2) var(--s-4);
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-dim);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Password Strength Indicator */
  .password-strength {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-1);
  }
  .strength-bar {
    display: flex;
    gap: 3px;
    flex: 1;
  }
  .strength-segment {
    height: 3px;
    flex: 1;
    border-radius: 2px;
    transition: background 200ms ease;
  }
  .strength-label {
    font-size: 11px;
    font-weight: 500;
    min-width: 45px;
    text-align: right;
  }
</style>
