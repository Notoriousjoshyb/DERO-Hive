<script>
  import { fly, fade } from 'svelte/transition';
  import { walletState, settingsState, addressMasked, walletRequests, activeWalletRequest, approveWalletRequest, denyWalletRequest, handleBackendError } from '../stores/appState.js';
  import { OpenWallet, GetBalance, ListRecentWallets, SelectWalletFile, GetRecentWalletsWithInfo, SwitchWallet } from '../../../wailsjs/go/main/App.js';

  // Derived from activeWalletRequest
  $: request = $activeWalletRequest;
  $: isOpen = !!request;

  let password = '';
  let walletPath = '';
  let error = '';
  let isLoading = false;
  let burnConfirmText = ''; // type-to-confirm input for destructive native-DERO burns

  const ZERO_SCID = '0000000000000000000000000000000000000000000000000000000000000000';

  // A request carries a smart contract call when it has a top-level scid (with sc_rpc/args)
  // or parsed sc_args. A burn routed to a contract is a deposit, not destruction.
  $: hasSCCall = !!(request?.payload?.scid) ||
    (Array.isArray(request?.payload?.sc_args) && request.payload.sc_args.length > 0);

  // Total native-DERO (zero-SCID) burn across the request's transfers.
  $: nativeBurnTotal = (request?.payload?.transfers || [])
    .filter(t => !t.scid || t.scid === ZERO_SCID)
    .reduce((sum, t) => sum + (typeof t.burn === 'number' ? t.burn : 0), 0);

  // DESTRUCTIVE: a native-DERO burn with no contract attached. These coins are destroyed
  // permanently and sent to no one. This is the case that requires explicit type-to-confirm.
  $: isDestructiveBurn = nativeBurnTotal > 0 && !hasSCCall;

  // The whole-number DERO amount used in the confirm phrase, e.g. "BURN 15000".
  $: burnConfirmAmount = Math.round(nativeBurnTotal / 100000);
  $: burnConfirmPhrase = `BURN ${burnConfirmAmount}`;
  $: burnConfirmMatched = burnConfirmText.trim().toUpperCase().replace(/\s+/g, ' ') === burnConfirmPhrase;

  // Reset the confirm input whenever the active request changes (tracked by id).
  let _lastBurnReqId = null;
  $: if (request?.id !== _lastBurnReqId) {
    _lastBurnReqId = request?.id ?? null;
    burnConfirmText = '';
  }
  let recentWallets = [];
  let recentWalletsInfo = [];
  let showWalletSwitcher = false;
  let switchPassword = '';
  let selectedSwitchWallet = null;
  
  // Permission management for XSWD connections
  let grantedPermissions = {};
  
  // Initialize permissions when request changes
  $: if (request && request.type === 'connect' && request.requestedPermissions) {
    // Initialize all requested permissions as granted by default
    grantedPermissions = {};
    for (const perm of request.requestedPermissions) {
      // Use existing permission state if available, otherwise default to true
      const existingValue = request.existingPermissions?.[perm.id];
      grantedPermissions[perm.id] = existingValue !== undefined ? existingValue : true;
    }
  }
  
  function togglePermission(permId) {
    grantedPermissions[permId] = !grantedPermissions[permId];
    grantedPermissions = grantedPermissions; // Trigger reactivity
  }
  
  function getGrantedPermissionsList() {
    return Object.entries(grantedPermissions)
      .filter(([_, granted]) => granted)
      .map(([id, _]) => id);
  }

  function getWalletFilename(path) {
    if (!path) return '';
    return path.split(/[\\/]/).pop() || path;
  }

  // Initialize wallet path from settings/state when modal opens
  $: if (isOpen && !walletPath) {
    walletPath = $walletState.walletPath || $settingsState.lastWalletPath || '';
    // Load recent wallets
    loadRecentWallets();
  }

  async function loadRecentWallets() {
    try {
      // Load enhanced wallet info
      const infos = await GetRecentWalletsWithInfo();
      if (infos && infos.length > 0) {
        recentWalletsInfo = infos;
        recentWallets = infos.map(w => w.path);
        // If no wallet path set, use the most recent
        if (!walletPath && infos.length > 0) {
          walletPath = infos[0].path;
        }
      } else {
        // Fallback to simple list
        const recents = await ListRecentWallets();
        if (recents && recents.length > 0) {
          recentWallets = recents;
          recentWalletsInfo = recents.map(p => ({ path: p, filename: getWalletFilename(p), addressPrefix: '', isCurrent: false }));
          if (!walletPath && recents.length > 0) {
            walletPath = recents[0];
          }
        }
      }
    } catch (e) {
      console.error('Failed to load recent wallets:', e);
    }
  }

  async function browseWallet() {
    try {
      const selected = await SelectWalletFile();
      if (selected) {
        walletPath = selected;
      }
    } catch (e) {
      console.error('File dialog failed:', e);
    }
  }

  function selectWalletToSwitch(wallet) {
    selectedSwitchWallet = wallet;
    switchPassword = '';
  }

  async function handleSwitchWallet() {
    if (!selectedSwitchWallet) return;
    
    isLoading = true;
    error = '';
    
    try {
      const result = await SwitchWallet(selectedSwitchWallet.path, switchPassword);
      if (!result.success) {
        error = handleBackendError(result, { showToast: false }) || 'Failed to switch wallet';
        isLoading = false;
        return;
      }
      
      // Update wallet state
      walletState.update(state => ({
        ...state,
        isOpen: true,
        address: result.address,
        balance: result.balance,
        lockedBalance: result.lockedBalance,
        walletPath: selectedSwitchWallet.path,
      }));
      
      // Store wallet path in settings
      settingsState.update(s => ({ ...s, lastWalletPath: selectedSwitchWallet.path }));
      
      // Reset switch state
      selectedSwitchWallet = null;
      switchPassword = '';
      showWalletSwitcher = false;
      
      // Reload recent wallets to update current marker
      await loadRecentWallets();
    } catch (e) {
      error = e.message || 'Unable to switch wallet. Please try again.';
      console.error('[WalletModal] Switch wallet error:', e);
    } finally {
      isLoading = false;
    }
  }

  function cancelSwitch() {
    selectedSwitchWallet = null;
    switchPassword = '';
    showWalletSwitcher = false;
  }

  async function handleApprove() {
    if (!request) return;
    
    // Read-only requests don't need wallet access
    const isReadOnlyRequest = request.type === 'connect' && request.isReadOnly;
    
    // If wallet is not open AND this is not a read-only request, require password AND wallet path
    if (!$walletState.isOpen && !isReadOnlyRequest) {
      if (!walletPath) {
        error = 'Please select a wallet file';
        return;
      }
      if (!password) {
        error = 'Please enter your wallet password';
        return;
      }
      
      // Actually open the wallet
      isLoading = true;
      error = '';
      
      try {
        const result = await OpenWallet(walletPath, password);
        if (!result.success) {
          error = handleBackendError(result, { showToast: false }) || 'Failed to open wallet';
          isLoading = false;
          return;
        }
        
        // Update wallet state
        walletState.update(state => ({
          ...state,
          isOpen: true,
          address: result.address,
          walletPath: walletPath,
        }));
        
        // Store wallet path in settings for next time
        settingsState.update(s => ({ ...s, lastWalletPath: walletPath }));
        
        // Fetch balance
        try {
          const balance = await GetBalance();
          if (balance.success) {
            walletState.update(state => ({
              ...state,
              balance: balance.balance,
              lockedBalance: balance.lockedBalance,
            }));
          }
        } catch (e) {
          console.error('Failed to fetch balance:', e);
        }
      } catch (e) {
        error = e.message || 'Unable to open wallet. Please check the file path and try again.';
        console.error('[WalletModal] Open wallet error:', e);
        isLoading = false;
        return;
      }
    }

    isLoading = true;
    error = '';

    // Defensive backstop: a destructive native-DERO burn can only be approved once the
    // type-to-confirm phrase matches. The backend enforces this too (it requires the
    // confirmDestroy flag), but refuse here as well so the flag is never sent unconfirmed.
    if (isDestructiveBurn && !burnConfirmMatched) {
      error = `Type "${burnConfirmPhrase}" to confirm you want to permanently destroy these coins.`;
      isLoading = false;
      return;
    }

    try {
      // For connect requests, pass the granted permissions
      const permissions = request.type === 'connect' ? getGrantedPermissionsList() : null;
      await approveWalletRequest(request.id, password, null, permissions, isDestructiveBurn && burnConfirmMatched);
      password = ''; // Clear password after use
      walletPath = ''; // Reset for next time
      grantedPermissions = {}; // Reset permissions
      burnConfirmText = ''; // Clear burn confirmation

      // Restore focus to main document to prevent iframe from capturing scroll
      restoreFocus();
    } catch (e) {
      error = e.message || 'Unable to process request. Please try again.';
      console.error('[WalletModal] Approve request error:', e);
    } finally {
      isLoading = false;
    }
  }

  function handleDeny() {
    if (!request) return;
    denyWalletRequest(request.id);
    password = '';
    walletPath = '';
    error = '';
    
    // Restore focus to main document
    restoreFocus();
  }
  
  // Restore interactivity after modal closes
  function restoreFocus() {
    // The iframe should be able to receive scroll events
    // Focus the iframe so scroll events go to its content
    const attempts = [50, 100, 200, 500, 1000];
    attempts.forEach(delay => {
      setTimeout(() => {
        const iframe = document.querySelector('.browser-content-frame');
        if (iframe) {
          // Make sure iframe can receive events
          iframe.style.pointerEvents = 'auto';
          
          // Click inside iframe to give it focus (allows scrolling)
          try {
            iframe.focus();
            // Also try to focus the iframe's document body
            if (iframe.contentWindow && iframe.contentDocument) {
              iframe.contentDocument.body?.focus();
            }
          } catch (e) {
            // Cross-origin restrictions may prevent this
          }
        }
      }, delay);
    });
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div 
    class="modal-panel-overlay"
    transition:fade={{ duration: 200 }}
    on:click={handleDeny}
  ></div>

  <!-- Slide-in Panel -->
  <div 
    class="modal-panel"
    transition:fly={{ x: 300, duration: 300 }}
  >
    <!-- Header -->
    <div class="modal-panel-header">
      <div class="modal-panel-header-row">
        <span class="modal-panel-icon">◈</span>
        <div>
          <h2 class="modal-panel-title">Wallet Request</h2>
          <p class="modal-panel-subtitle">
            {#if request.type === 'connect'}
              Connection Request
            {:else if request.type === 'sign'}
              Transaction Signing
            {:else}
              Permission Request
            {/if}
          </p>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="modal-panel-content">
      <!-- App Info -->
      <div class="modal-app-info-card">
        <h3 class="modal-app-info-label">REQUEST FROM</h3>
        <div class="modal-app-info-row">
          <div class="modal-app-icon">◎</div>
          <div>
            <div class="modal-app-name">{request.appName || 'Unknown App'}</div>
            <div class="modal-app-origin">{request.origin || 'Local App'}</div>
          </div>
        </div>
      </div>

      <!-- Request Details -->
      <div class="wallet-request-details">
        {#if request.type === 'connect'}
          <div>
            {#if request.isReadOnly}
              <!-- Read-only app - simplified UI -->
              <div class="wallet-readonly-badge">
                <span class="wallet-readonly-icon">◎</span>
                <span>Read-Only Access</span>
              </div>
              <p class="wallet-readonly-desc">
                This app only reads public blockchain data. No wallet access is required.
              </p>
              <div class="wallet-readonly-permissions">
                <div class="wallet-readonly-item">
                  <span class="wallet-check-icon">✓</span>
                  <span>Read public blockchain info (blocks, transactions, network stats)</span>
                </div>
                <div class="wallet-readonly-item wallet-readonly-item-denied">
                  <span class="wallet-denied-icon">✗</span>
                  <span>Cannot access wallet address or balance</span>
                </div>
                <div class="wallet-readonly-item wallet-readonly-item-denied">
                  <span class="wallet-denied-icon">✗</span>
                  <span>Cannot request transactions</span>
                </div>
              </div>
            {:else}
              <h3 class="modal-section-title">Permissions Requested</h3>
              {#if request.requestedPermissions && request.requestedPermissions.length > 0}
                <div class="modal-permissions-list">
                  {#each request.requestedPermissions as perm}
                    <label 
                      class="modal-permission-item {grantedPermissions[perm.id] ? 'modal-permission-item-active' : ''}"
                    >
                      <input
                        type="checkbox"
                        checked={grantedPermissions[perm.id]}
                        on:change={() => togglePermission(perm.id)}
                        disabled={perm.alwaysAsk}
                        class="modal-permission-checkbox"
                      />
                      <div class="modal-permission-content">
                        <div class="modal-permission-header">
                          <span class="modal-permission-name">{perm.name}</span>
                          {#if perm.alwaysAsk}
                            <span class="modal-permission-badge">Always asks</span>
                          {/if}
                        </div>
                        <p class="modal-permission-desc">{perm.description}</p>
                      </div>
                    </label>
                  {/each}
                </div>
                
                {#if request.existingPermissions}
                  <p class="wallet-info-note">
                    <span class="wallet-info-icon">i</span>
                    This app has connected before. Your previous permissions are shown.
                  </p>
                {/if}
              {:else}
                <!-- Fallback for old-style requests without permission info -->
                <ul class="wallet-fallback-permissions">
                  <li class="wallet-fallback-item">
                    <span class="wallet-check-icon">✓</span>
                    <span>Read public blockchain data</span>
                  </li>
                </ul>
                <p class="wallet-info-note">
                  <span class="wallet-info-icon">i</span>
                  This app will request additional permissions as needed.
                </p>
              {/if}
            {/if}
          </div>
        {:else if request.type === 'sign'}
          <!-- Transaction Details -->
          <div>
            <h3 class="modal-section-title">Transaction Details</h3>
            
            <div class="modal-tx-details-card">
              <!-- Smart Contract Info (show first if present) -->
              {#if request.payload.scid || request.payload.entrypoint}
                <div class="wallet-tx-sc-header">
                  {#if request.payload.entrypoint}
                    <div class="modal-tx-field">
                      <div class="modal-tx-label">SC FUNCTION</div>
                      <div class="modal-tx-entrypoint">{request.payload.entrypoint}</div>
                    </div>
                  {/if}
                  {#if request.payload.scid}
                    <div class="modal-tx-field">
                      <div class="modal-tx-label">SMART CONTRACT</div>
                      <div class="modal-tx-scid" title={request.payload.scid}>
                        {request.payload.scid.slice(0, 8)}...{request.payload.scid.slice(-8)}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
              
              <!-- Transfers (DERO or token amounts) -->
              {#if request.payload.transfers && request.payload.transfers.length > 0}
                {@const deroTransfers = request.payload.transfers.filter(t => !t.scid || t.scid === ZERO_SCID)}
                <!-- Sum all cost fields: amount, burn (if numeric), fees from transfers AND top-level fees -->
                {@const totalAmount = deroTransfers.reduce((sum, t) => sum + (t.amount || 0), 0)}
                {@const totalBurn = deroTransfers.reduce((sum, t) => sum + (typeof t.burn === 'number' ? t.burn : 0), 0)}
                {@const transferFees = deroTransfers.reduce((sum, t) => sum + (t.fees || 0), 0)}
                {@const topLevelFees = request.payload.fees || 0}
                {@const totalFees = transferFees + topLevelFees}
                {@const totalDero = totalAmount + totalBurn + totalFees}

                <!-- DESTRUCTIVE BURN: native-DERO burn with no contract attached. These coins
                     are destroyed permanently and sent to no one. Lead with the danger. -->
                {#if isDestructiveBurn}
                  <div class="modal-burn-danger">
                    <div class="modal-burn-danger-title">
                      <span class="modal-burn-danger-ic">⚠</span> PERMANENT DESTRUCTION
                    </div>
                    <div class="modal-burn-danger-amount">−{(totalBurn / 100000).toLocaleString()} DERO</div>
                    <div class="modal-burn-danger-copy">
                      This request <strong>destroys {(totalBurn / 100000).toLocaleString()} DERO forever</strong>.
                      The coins are removed from existence — they are <strong>not sent to anyone</strong>
                      and <strong>cannot be recovered</strong>. A burn with no smart contract attached
                      is never a way to transfer funds.
                    </div>
                    {#if request.payload.transfers[0]?.destination}
                      <div class="modal-burn-danger-norecipient">
                        ◇ RECIPIENT: <span class="modal-burn-strike">{request.payload.transfers[0].destination.slice(0,12)}…</span>
                        — no contract attached, funds go to NO ONE
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Show total DERO cost -->
                {#if deroTransfers.length > 0}
                  <div class="modal-tx-field">
                    <div class="modal-tx-label">TOTAL COST</div>
                    <div class="modal-tx-amount modal-tx-amount-total">
                      {(totalDero / 100000).toLocaleString()} DERO
                    </div>
                  </div>
                {/if}

                <!-- Show breakdown of costs if any non-zero values -->
                {#if totalAmount > 0 || totalBurn > 0 || totalFees > 0}
                  <div class="modal-tx-breakdown">
                    <div class="modal-tx-label modal-tx-label-small">BREAKDOWN</div>
                    {#if totalBurn > 0}
                      <div class="modal-tx-breakdown-item">
                        <!-- A burn routed to a contract is a deposit, not destruction. Only an
                             actual destroy-burn (no contract) is labeled "Burn". -->
                        {#if hasSCCall}
                          <span class="modal-tx-breakdown-label">Deposit to contract:</span>
                          <span class="modal-tx-breakdown-value">{(totalBurn / 100000).toLocaleString()} DERO</span>
                        {:else}
                          <span class="modal-tx-breakdown-label modal-tx-breakdown-label-danger">Burn (destroyed):</span>
                          <span class="modal-tx-breakdown-value modal-tx-breakdown-value-danger">{(totalBurn / 100000).toLocaleString()} DERO</span>
                        {/if}
                      </div>
                    {/if}
                    {#if totalFees > 0}
                      <div class="modal-tx-breakdown-item">
                        <span class="modal-tx-breakdown-label">Fees:</span>
                        <span class="modal-tx-breakdown-value">{(totalFees / 100000).toLocaleString()} DERO</span>
                      </div>
                    {/if}
                    {#if totalAmount > 0}
                      <div class="modal-tx-breakdown-item">
                        <span class="modal-tx-breakdown-label">Amount:</span>
                        <span class="modal-tx-breakdown-value">{(totalAmount / 100000).toLocaleString()} DERO</span>
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Show destination only when funds actually go somewhere. For a destructive
                     burn there is no recipient, so the destination is shown (struck through)
                     inside the danger banner above instead. -->
                {#if request.payload.transfers[0]?.destination && !isDestructiveBurn}
                  <div class="modal-tx-field">
                    <div class="modal-tx-label">DESTINATION</div>
                    <div class="modal-tx-destination">
                      {request.payload.transfers[0].destination}
                    </div>
                  </div>
                {/if}
              {:else if request.payload.scid}
                <!-- SC call with no explicit transfers - show 0 DERO burn -->
                <div class="modal-tx-field">
                  <div class="modal-tx-label">BURN AMOUNT</div>
                  <div class="modal-tx-amount">0 DERO</div>
                </div>
              {:else}
                <!-- No transfers and no SC - unusual, show warning -->
                <div class="modal-tx-field">
                  <div class="modal-tx-label">AMOUNT</div>
                  <div class="modal-tx-amount modal-tx-amount-zero">0 DERO (no transfer)</div>
                </div>
              {/if}
              
              <!-- SC Arguments (if any) -->
              {#if request.payload.sc_args && request.payload.sc_args.length > 0}
                <div class="wallet-tx-sc-section">
                  <div class="modal-tx-label">SC ARGUMENTS</div>
                  <div class="wallet-tx-sc-args">
                    {#each request.payload.sc_args as arg}
                      <div class="wallet-tx-sc-arg">
                        <span class="wallet-tx-sc-arg-name">{arg.name}:</span>
                        <span class="wallet-tx-sc-arg-value" title={String(arg.value)}>
                          {#if String(arg.value).length > 40}
                            {String(arg.value).slice(0, 40)}...
                          {:else}
                            {arg.value}
                          {/if}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else if request.payload.sc_data && Array.isArray(request.payload.sc_data) && request.payload.sc_data.length > 0}
                <!-- Fallback: show raw sc_data if sc_args not parsed -->
                <div class="wallet-tx-sc-section">
                  <div class="modal-tx-label">SMART CONTRACT DATA</div>
                  <div class="wallet-tx-sc-data">
                    {JSON.stringify(request.payload.sc_data, null, 2)}
                  </div>
                </div>
              {/if}
              
              <!-- Ring size if specified -->
              {#if request.payload.ringsize}
                <div class="modal-tx-field modal-tx-field-secondary">
                  <div class="modal-tx-label">RING SIZE</div>
                  <div class="modal-tx-ringsize">{request.payload.ringsize}</div>
                </div>
              {/if}
            </div>
            
            <div class="modal-alert modal-alert-warning">
              <span class="modal-alert-icon">!</span>
              {#if request.payload.scid}
                Review the smart contract call details before approving.
              {:else}
                Double check the destination and amount before approving.
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Wallet State Section - only show for non-read-only requests -->
      {#if request.type === 'connect' && request.isReadOnly && !request.walletNotOpen}
        <!-- Read-only apps don't need wallet access -->
        <div class="wallet-readonly-info">
          <span class="wallet-readonly-info-icon">◎</span>
          <span>No wallet needed for this connection</span>
        </div>
      {:else if request.type === 'connect' && request.walletNotOpen}
        <!-- Warning: integrated wallet mode but no wallet open -->
        <div class="modal-alert modal-alert-warning" style="margin-bottom: 1rem;">
          <span class="modal-alert-icon">!</span>
          <div style="flex: 1;">
            <strong>No wallet open</strong><br/>
            <span style="font-size: 0.85rem; opacity: 0.9;">
              This app may require wallet features. Open a wallet first or the app may not work correctly.
            </span>
          </div>
        </div>
      {:else if $walletState.isOpen}
        <!-- Current wallet is open - show wallet switcher option -->
        <div class="modal-wallet-section">
          <div class="modal-wallet-current-row">
            <div>
              <p class="modal-wallet-label">CURRENT WALLET</p>
              <p class="modal-wallet-address">
                {$addressMasked ? '••••••••••••••••' : `${$walletState.address?.slice(0, 16)}...`}
              </p>
            </div>
            <button
              on:click={() => { showWalletSwitcher = !showWalletSwitcher; loadRecentWallets(); }}
              class="modal-link-btn"
            >
              {showWalletSwitcher ? 'Cancel' : 'Switch Wallet'}
            </button>
          </div>
          
          {#if showWalletSwitcher}
            <div class="wallet-switcher">
              <p class="wallet-switcher-label">SELECT WALLET TO USE</p>
              
              {#if selectedSwitchWallet}
                <!-- Password input for selected wallet -->
                <div class="wallet-switcher-form">
                  <div class="wallet-selected-item">
                    <span class="modal-wallet-icon">◇</span>
                    <div class="modal-wallet-info">
                      <p class="modal-wallet-filename">{selectedSwitchWallet.filename}</p>
                      {#if selectedSwitchWallet.addressPrefix}
                        <p class="modal-wallet-prefix">{selectedSwitchWallet.addressPrefix}</p>
                      {/if}
                    </div>
                  </div>
                  
                  <input 
                    type="password" 
                    bind:value={switchPassword}
                    placeholder="Enter password for this wallet..."
                    class="modal-input"
                    on:keydown={(e) => e.key === 'Enter' && handleSwitchWallet()}
                  />
                  
                  <div class="wallet-btn-row">
                    <button on:click={cancelSwitch} class="modal-btn modal-btn-secondary">
                      Back
                    </button>
                    <button
                      on:click={handleSwitchWallet}
                      disabled={!switchPassword || isLoading}
                      class="modal-btn modal-btn-primary"
                    >
                      {isLoading ? 'Switching...' : 'Switch'}
                    </button>
                  </div>
                </div>
              {:else}
                <!-- Wallet list -->
                <div class="modal-wallet-list">
                  {#each recentWalletsInfo.filter(w => !w.isCurrent) as wallet}
                    <button
                      on:click={() => selectWalletToSwitch(wallet)}
                      class="modal-wallet-list-item"
                    >
                      <span class="modal-wallet-icon">◇</span>
                      <div class="modal-wallet-info">
                        <p class="modal-wallet-filename">{wallet.filename}</p>
                        {#if wallet.addressPrefix}
                          <p class="modal-wallet-prefix">{wallet.addressPrefix}</p>
                        {/if}
                      </div>
                      <span class="wallet-arrow-icon">→</span>
                    </button>
                  {/each}
                  
                  {#if recentWalletsInfo.filter(w => !w.isCurrent).length === 0}
                    <p class="wallet-empty-state">No other wallets found</p>
                  {/if}
                </div>
                
                <!-- Browse for different wallet -->
                <button
                  on:click={async () => {
                    const selected = await SelectWalletFile();
                    if (selected) {
                      selectWalletToSwitch({ path: selected, filename: getWalletFilename(selected), addressPrefix: '' });
                    }
                  }}
                  class="modal-browse-btn"
                >
                  <span>+</span>
                  <span>Browse for wallet file</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <!-- Wallet Lock State - no wallet open -->
        <div class="modal-wallet-section">
          <!-- Wallet File Selection -->
          <div class="modal-form-group">
            <label class="modal-form-label">Wallet File</label>
            <div class="modal-input-with-button">
              <input 
                type="text" 
                bind:value={walletPath}
                placeholder="Select wallet file..."
                class="modal-input"
              />
              <button on:click={browseWallet} class="modal-btn modal-btn-secondary">
                Browse
              </button>
            </div>
            
            <!-- Recent Wallets with Info -->
            {#if recentWalletsInfo.length > 0}
              <div class="wallet-recent-wallets">
                <p class="wallet-recent-label">Recent wallets:</p>
                <div class="modal-wallet-list">
                  {#each recentWalletsInfo.slice(0, 5) as wallet}
                    <button
                      on:click={() => walletPath = wallet.path}
                      class="modal-wallet-list-item {walletPath === wallet.path ? 'modal-wallet-list-item-active' : ''}"
                    >
                      <span class="modal-wallet-icon">{walletPath === wallet.path ? '✓' : '◇'}</span>
                      <div class="modal-wallet-info">
                        <p class="modal-wallet-filename">{wallet.filename}</p>
                        {#if wallet.addressPrefix}
                          <p class="modal-wallet-prefix">{wallet.addressPrefix}</p>
                        {/if}
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {:else if recentWallets.length > 0 && !walletPath}
              <div class="wallet-recent-wallets">
                <p class="wallet-recent-label">Recent wallets:</p>
                <div class="wallet-recent-simple-list">
                  {#each recentWallets.slice(0, 3) as recent}
                    <button
                      on:click={() => walletPath = recent}
                      class="wallet-recent-simple-item"
                    >
                      {getWalletFilename(recent)}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
          
          <!-- Password -->
          <div class="modal-form-group">
            <label class="modal-form-label">Wallet Password</label>
            <input 
              type="password" 
              bind:value={password}
              placeholder="Enter wallet password..."
              class="modal-input wallet-password-input"
              on:keydown={(e) => e.key === 'Enter' && !isDestructiveBurn && handleApprove()}
            />
          </div>
        </div>
      {/if}

      <!-- Type-to-confirm gate for a destructive native-DERO burn. Shown regardless of
           wallet-open state. The Destroy button stays disabled until the phrase matches. -->
      {#if isDestructiveBurn}
        <div class="modal-burn-confirm">
          <div class="modal-burn-confirm-prompt">
            To approve this destruction, type
            <code class="modal-burn-confirm-phrase">{burnConfirmPhrase}</code> below:
          </div>
          <input
            type="text"
            bind:value={burnConfirmText}
            placeholder="Type the phrase to enable…"
            autocomplete="off"
            spellcheck="false"
            class="modal-input modal-burn-confirm-input"
            class:matched={burnConfirmMatched}
          />
          <div class="modal-burn-confirm-hint" class:ok={burnConfirmMatched}>
            {#if burnConfirmMatched}
              ✓ Phrase matches — destruction can be approved.
            {:else}
              Approve stays disabled until the phrase matches exactly.
            {/if}
          </div>
        </div>
      {/if}

      {#if error}
        <div class="modal-alert modal-alert-error">
          {error}
        </div>
      {/if}
    </div>

    <!-- Actions -->
    <div class="modal-panel-actions">
      <button
        on:click={handleDeny}
        class="modal-panel-btn modal-panel-btn-deny"
        disabled={isLoading}
      >
        Deny
      </button>
      {#if isDestructiveBurn}
        <button
          on:click={handleApprove}
          class="modal-panel-btn modal-panel-btn-destroy"
          disabled={isLoading || !burnConfirmMatched}
        >
          {#if isLoading}
            Processing...
          {:else}
            Destroy {burnConfirmAmount.toLocaleString()} DERO
          {/if}
        </button>
      {:else}
        <button
          on:click={handleApprove}
          class="modal-panel-btn modal-panel-btn-approve"
          disabled={isLoading}
        >
          {#if isLoading}
            Processing...
          {:else}
            Approve
          {/if}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* WalletModal.svelte - Component-specific styles only
     Modal panel base patterns now in hologram.css (.modal-panel-*) */
  
  /* Request Details Section */
  .wallet-request-details {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  /* Info Note */
  .wallet-info-note {
    margin-top: var(--s-4);
    font-size: 12px;
    color: var(--text-4);
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    line-height: 1.5;
  }
  
  .wallet-info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: var(--r-full);
    background: rgba(34, 211, 238, 0.15);
    color: var(--cyan-400);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    margin-top: 1px;
  }
  
  /* Fallback Permissions */
  .wallet-fallback-permissions {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .wallet-fallback-item {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.5;
  }
  
  .wallet-check-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: var(--r-full);
    background: rgba(52, 211, 153, 0.15);
    color: var(--status-ok);
    font-size: 10px;
    line-height: 1;
  }
  
  .wallet-denied-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: var(--r-full);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-5);
    font-size: 10px;
    line-height: 1;
  }
  
  /* Read-Only Badge */
  .wallet-readonly-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: rgba(34, 211, 238, 0.1);
    border: 1px solid rgba(34, 211, 238, 0.3);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--cyan-400);
    margin-bottom: var(--s-3);
  }
  
  .wallet-readonly-icon {
    font-size: 14px;
  }
  
  .wallet-readonly-desc {
    font-size: 13px;
    color: var(--text-3);
    margin-bottom: var(--s-4);
    line-height: 1.5;
  }
  
  .wallet-readonly-permissions {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .wallet-readonly-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.4;
  }
  
  .wallet-readonly-item-denied {
    color: var(--text-5);
  }
  
  .wallet-readonly-info {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    background: rgba(34, 211, 238, 0.05);
    border: 1px solid rgba(34, 211, 238, 0.2);
    border-radius: var(--r-md);
    font-size: 13px;
    color: var(--cyan-400);
    margin-top: var(--s-2);
  }
  
  .wallet-readonly-info-icon {
    font-size: 16px;
  }
  
  /* Smart Contract Section */
  .wallet-tx-sc-header {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-bottom: var(--s-3);
    margin-bottom: var(--s-3);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .wallet-tx-sc-section {
    padding-top: var(--s-2);
    border-top: 1px solid var(--border-dim);
  }
  
  .wallet-tx-sc-data {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--status-warn);
    white-space: pre-wrap;
  }
  
  .wallet-tx-sc-args {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin-top: var(--s-2);
  }
  
  .wallet-tx-sc-arg {
    display: flex;
    gap: var(--s-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  
  .wallet-tx-sc-arg-name {
    color: var(--cyan-400);
    font-weight: 500;
    flex-shrink: 0;
  }
  
  .wallet-tx-sc-arg-value {
    color: var(--text-3);
    word-break: break-all;
  }
  
  .modal-tx-entrypoint {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--cyan-400);
    padding: var(--s-2) var(--s-3);
    background: rgba(34, 211, 238, 0.1);
    border-radius: var(--r-md);
    border: 1px solid rgba(34, 211, 238, 0.2);
  }
  
  .modal-tx-scid {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
    cursor: help;
  }
  
  .modal-tx-token-scid {
    font-size: 11px;
    color: var(--text-5);
    margin-left: var(--s-1);
  }
  
  .modal-tx-amount-zero {
    color: var(--text-5);
    font-style: italic;
  }
  
  .modal-tx-amount-total {
    font-size: 16px;
    font-weight: 600;
    color: var(--accent);
  }
  
  .modal-tx-breakdown {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-2);
    background: rgba(8, 8, 14, 0.3);
    border-radius: var(--r-sm);
    margin-top: var(--s-1);
  }
  
  .modal-tx-label-small {
    font-size: 9px;
    margin-bottom: var(--s-1);
  }
  
  .modal-tx-breakdown-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  
  .modal-tx-breakdown-label {
    color: var(--text-5);
  }
  
  .modal-tx-breakdown-value {
    color: var(--text-3);
  }
  
  .modal-tx-ringsize {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
  }
  
  .modal-tx-field-secondary {
    opacity: 0.7;
  }
  
  /* Wallet Switcher */
  .wallet-switcher {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3);
    background: rgba(8, 8, 14, 0.5);
    border-radius: var(--r-lg);
    border: 1px solid var(--border-dim);
  }
  
  .wallet-switcher-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-4);
  }
  
  .wallet-switcher-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  
  .wallet-selected-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2);
    background: rgba(6, 182, 212, 0.1);
    border: 1px solid rgba(6, 182, 212, 0.3);
    border-radius: var(--r-md);
  }
  
  .wallet-arrow-icon {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .wallet-empty-state {
    font-size: 12px;
    color: var(--text-4);
    text-align: center;
    padding: var(--s-2);
  }
  
  .wallet-btn-row {
    display: flex;
    gap: var(--s-2);
  }
  
  .wallet-btn-row .modal-btn {
    flex: 1;
  }
  
  /* Recent Wallets */
  .wallet-recent-wallets {
    margin-top: var(--s-3);
  }
  
  .wallet-recent-label {
    font-size: 12px;
    color: var(--text-4);
    margin-bottom: var(--s-2);
  }
  
  .wallet-recent-simple-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  
  .wallet-recent-simple-item {
    width: 100%;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-sm);
    background: transparent;
    border: none;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: all 200ms ease-out;
  }
  
  .wallet-recent-simple-item:hover {
    color: var(--text-2);
    background: var(--void-up);
  }
  
  /* Password Input (larger for main unlock) */
  .wallet-password-input {
    padding: var(--s-3) var(--s-4);
  }
  
  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--void-hover);
    border-radius: var(--r-xs);
  }
</style>