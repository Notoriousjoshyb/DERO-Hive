package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/deroproject/derohe/cryptography/bn256"
	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WalletManager handles wallet operations
type WalletManager struct {
	sync.RWMutex
	wallet        *walletapi.Wallet_Disk
	walletPath    string
	isOpen        bool
	recentWallets []string
}

// NewWalletManager creates a new wallet manager
func NewWalletManager() *WalletManager {
	return &WalletManager{
		recentWallets: make([]string, 0),
	}
}

// Global wallet manager instance
var walletManager = NewWalletManager()

// walletapi uses global connectivity; start it once per process.
var walletConnectivityOnce sync.Once

// balanceMu serializes HOLOGRAM's reads of the wallet's per-SCID balance map
// (Get_Balance / Get_Balance_scid) and any on-demand Sync against each other.
// The walletapi background sync_loop writes account.Balance[scid] under the
// wallet's own lock every ~5s, but Get_Balance* read that map lock-free, so
// concurrent HOLOGRAM readers (XSWD handlers, the portfolio render) would
// otherwise race the loop's writes — a fatal "concurrent map read and map
// write". Holding balanceMu around our reads/syncs makes them mutually
// exclusive on our side; the reads are O(1) map lookups, so this never blocks
// on I/O. Callers must hold a stable wallet pointer (captured under
// walletManager's lock) before calling these helpers.
var balanceMu sync.Mutex

// trackedTokensMu serializes the read-modify-write of tracked_tokens.json so a
// manual AddTrackedToken/RemoveTrackedToken can't interleave with the scan's
// add loop (or another add) and clobber the whole-file rewrite — a lost-update
// race, since load() and save() are not individually atomic. Held across the
// load…modify…save span by every mutating path.
var trackedTokensMu sync.Mutex

// readNativeBalance returns the cached native DERO mature balance, serialized
// against the sync_loop via balanceMu.
func readNativeBalance(wallet *walletapi.Wallet_Disk) uint64 {
	balanceMu.Lock()
	defer balanceMu.Unlock()
	mature, _ := wallet.Get_Balance()
	return mature
}

// readTokenBalance returns the cached mature balance for an scid, serialized
// against the sync_loop via balanceMu. It does NOT sync — it reads whatever the
// background loop (or a prior add-time sync) last decrypted.
func readTokenBalance(wallet *walletapi.Wallet_Disk, scid crypto.Hash) uint64 {
	balanceMu.Lock()
	defer balanceMu.Unlock()
	mature, _ := wallet.Get_Balance_scid(scid)
	return mature
}

// syncAndReadTokenBalance fetches+decrypts an scid's balance from the daemon on
// demand (for callers that can't rely on the token being pre-registered, e.g.
// the XSWD bridge serving an arbitrary dApp query) then returns it, all
// serialized against the sync_loop via balanceMu.
func syncAndReadTokenBalance(wallet *walletapi.Wallet_Disk, scid crypto.Hash) (uint64, error) {
	balanceMu.Lock()
	defer balanceMu.Unlock()
	if err := wallet.Sync_Wallet_Memory_With_Daemon_internal(scid); err != nil {
		return 0, err
	}
	mature, _ := wallet.Get_Balance_scid(scid)
	return mature, nil
}

func normalizeDaemonEndpointForWallet(endpoint string) string {
	// walletapi.Wallet_* typically expects host:port (no scheme) here.
	// walletapi.Connect() can handle schemes, but SetDaemonAddress is used elsewhere.
	e := strings.TrimSpace(endpoint)
	switch {
	case strings.HasPrefix(e, "http://"):
		return strings.TrimPrefix(e, "http://")
	case strings.HasPrefix(e, "https://"):
		return strings.TrimPrefix(e, "https://")
	case strings.HasPrefix(e, "ws://"):
		return strings.TrimPrefix(e, "ws://")
	case strings.HasPrefix(e, "wss://"):
		return strings.TrimPrefix(e, "wss://")
	default:
		return e
	}
}

// getDaemonEndpointForWallet returns the daemon endpoint for the current network mode.
// When simulator is active, uses simulator RPC (20000). Otherwise uses mainnet (10102) or settings.
func (a *App) getDaemonEndpointForWallet() string {
	if a.simulatorManager != nil && a.simulatorManager.isInitialized {
		return fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)
	}
	if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		return normalizeDaemonEndpointForWallet(ep)
	}
	return "127.0.0.1:10102"
}

func (a *App) ensureWalletDaemonConnectivity(endpoint string) {
	// Ensure walletapi has an active daemon endpoint and is connected.
	// Keep_Connectivity() will continue to retry and keep the connection alive.
	if endpoint == "" {
		endpoint = a.getDaemonEndpointForWallet()
	}
	if endpoint == "" {
		endpoint = "127.0.0.1:10102"
	}

	if err := walletapi.Connect(endpoint); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Wallet daemon connect failed: %v - will retry in background", err))
		// Emit event to notify frontend of connection issue
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wallet:daemon_connection_warning", map[string]interface{}{
				"error":    err.Error(),
				"endpoint": endpoint,
				"message":  "Wallet daemon connection failed. Retrying in background...",
			})
		}
	}

	walletConnectivityOnce.Do(func() {
		go walletapi.Keep_Connectivity()
		a.logToConsole("[NET] Wallet daemon connectivity loop started")
	})
}

// recoverWalletFromBackup attempts to restore a wallet from the .bak copy
// that the DERO walletapi creates on every save. Returns true if recovery succeeded.
func recoverWalletFromBackup(filePath string, a *App) bool {
	bakPath := filePath + ".bak"
	fi, err := os.Stat(bakPath)
	if err != nil || fi.Size() == 0 {
		return false
	}

	data, err := os.ReadFile(bakPath)
	if err != nil || len(data) == 0 {
		return false
	}

	if err := os.WriteFile(filePath, data, 0600); err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to restore wallet from backup: %v", err))
		return false
	}

	a.logToConsole(fmt.Sprintf("[RECOVERED] Wallet restored from backup (%d bytes): %s", len(data), bakPath))
	return true
}

// OpenWallet opens a DERO wallet file
func (a *App) OpenWallet(filePath, password string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// If just a name is provided (no path separators), construct full path
	// This matches the behavior of CreateWallet for consistency
	if !strings.Contains(filePath, string(filepath.Separator)) && !strings.Contains(filePath, "/") {
		// Clean the name - remove any .db extension if user added it
		name := strings.TrimSuffix(filePath, ".db")
		// Construct path in wallets directory
		filePath = filepath.Join(getDatashardsDir(), "wallets", name+".db")
	}

	// Network comes from nodeManager — the same source the sidebar and
	// IsInSimulatorMode read. Do NOT consult globals.Arguments["--simulator"]:
	// every simulator start path sets that package-global true but it's only
	// cleared on app launch, so after a simulator→mainnet switch it goes stale
	// and would open a mainnet wallet flagged testnet (deto1 address,
	// "unregistered", sync wedged against the dead simulator).
	currentNetwork := "mainnet"
	if a.IsInSimulatorMode() {
		currentNetwork = "simulator"
	}

	a.logToConsole(fmt.Sprintf("[WALLET] Opening wallet: %s (network: %s)", filePath, currentNetwork))

	// Check if file exists and is not empty
	fi, statErr := os.Stat(filePath)
	if os.IsNotExist(statErr) {
		// Primary file missing — try .bak before giving up
		if recovered := recoverWalletFromBackup(filePath, a); recovered {
			fi, statErr = os.Stat(filePath)
		} else {
			a.logToConsole(fmt.Sprintf("[ERR] Wallet file not found: %s", filePath))
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet file not found",
			}
		}
	}
	if statErr == nil && fi.Size() == 0 {
		a.logToConsole(fmt.Sprintf("[WARN] Wallet file is 0 bytes (corrupt): %s — attempting recovery from backup", filePath))
		if recovered := recoverWalletFromBackup(filePath, a); !recovered {
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet file is corrupt (0 bytes) and no backup (.bak) was found. If you have your seed phrase you can restore the wallet.",
			}
		}
	}

	// Check if this wallet was last used on a different network
	var networkWarning string
	existingData := loadRecentWalletsData()
	for _, w := range existingData {
		if w.Path == filePath {
			storedNetwork := w.Network

			// For legacy wallets without stored network, infer from address prefix
			if storedNetwork == "" && w.AddressPrefix != "" {
				if len(w.AddressPrefix) >= 4 {
					prefix := w.AddressPrefix[:4]
					if prefix == "dero" {
						storedNetwork = "mainnet"
					} else if prefix == "deto" {
						storedNetwork = "simulator" // Simulator wallets use deto1-style prefixes
					}
				}
			}

			if storedNetwork != "" && storedNetwork != currentNetwork {
				// Wallet was previously used on a different network
				if currentNetwork == "simulator" && storedNetwork == "mainnet" {
					networkWarning = "This wallet was last used on mainnet. In simulator mode, your mainnet balance will not be shown."
					a.logToConsole(fmt.Sprintf("[WARN] Opening mainnet wallet in simulator mode"))
				} else if storedNetwork == "simulator" && currentNetwork == "mainnet" {
					networkWarning = "This wallet was last used in simulator mode. Now connecting to mainnet."
					a.logToConsole("[WARN] Opening simulator wallet on mainnet")
				} else if storedNetwork != currentNetwork {
					// Generic mismatch warning
					networkWarning = fmt.Sprintf("This wallet was last used on %s. You are now on %s.", storedNetwork, currentNetwork)
					a.logToConsole(fmt.Sprintf("[WARN] Network mismatch: stored=%s, current=%s", storedNetwork, currentNetwork))
				}
			}
			break
		}
	}

	// Close existing wallet if open
	if walletManager.isOpen && walletManager.wallet != nil {
		walletManager.wallet.Close_Encrypted_Wallet()
		walletManager.isOpen = false
	}

	// Open the wallet
	wallet, err := walletapi.Open_Encrypted_Wallet(filePath, password)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to open wallet: %v", err))
		return ErrorResponse(err)
	}

	walletManager.wallet = wallet
	walletManager.walletPath = filePath
	walletManager.isOpen = true

	// Set network mode (mainnet vs simulator) - MUST be called before GetAddress()
	wallet.SetNetwork(currentNetwork == "mainnet")

	// Get wallet info (now with correct network prefix)
	address := wallet.GetAddress().String()

	// Add to recent wallets with address info (updates network to current)
	addToRecentWalletsWithInfo(filePath, address)

	a.logToConsole(fmt.Sprintf("[OK] Wallet opened successfully: %s", address[:16]+"..."))

	// Daemon connectivity and initial sync run in the background so we don't
	// block the UI.  walletapi.Connect() does a WebSocket dial with no timeout
	// and Sync_Wallet_Memory_With_Daemon makes an RPC call with
	// context.Background(), either of which can hang for minutes if the daemon
	// is unreachable.
	go func() {
		endpointRaw := "127.0.0.1:10102"
		if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
			endpointRaw = ep
		}
		endpoint := normalizeDaemonEndpointForWallet(endpointRaw)

		wallet.SetDaemonAddress(endpoint)

		a.logToConsole(fmt.Sprintf("[NET] Connecting wallet to daemon at %s ...", endpoint))

		connectDone := make(chan struct{}, 1)
		go func() {
			a.ensureWalletDaemonConnectivity(endpointRaw)
			connectDone <- struct{}{}
		}()
		select {
		case <-connectDone:
			a.logToConsole("[NET] Wallet daemon connection attempt finished")
		case <-time.After(15 * time.Second):
			a.logToConsole("[WARN] Wallet daemon connection timed out (15s) — will keep retrying in background")
		}

		wallet.SetOnlineMode()

		syncDone := make(chan error, 1)
		go func() {
			syncDone <- wallet.Sync_Wallet_Memory_With_Daemon()
		}()
		select {
		case err := <-syncDone:
			if err != nil {
				// Check if this is an "Account Unregistered" error - expected for brand new wallets
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "unregistered") || strings.Contains(errStr, "-32098") {
					a.logToConsole("[INFO] Wallet address not yet registered on-chain — this is normal for new wallets")
					if a.ctx != nil {
						runtime.EventsEmit(a.ctx, "wallet:unregistered", map[string]interface{}{
							"message": "New wallet — your address will be registered on-chain when you receive your first DERO, or you can register manually.",
						})
					}
				} else {
					a.logToConsole(fmt.Sprintf("[WARN] Initial wallet sync failed: %v — balance may be outdated until sync completes", err))
					if a.ctx != nil {
						runtime.EventsEmit(a.ctx, "wallet:sync_warning", map[string]interface{}{
							"message": "Initial sync failed. Balance may be outdated until sync completes.",
						})
					}
				}
			} else {
				a.logToConsole("[OK] Initial wallet sync completed")
			}
		case <-time.After(10 * time.Second):
			a.logToConsole("[WARN] Initial wallet sync timed out (10s) — will continue syncing in background")
		}

		// Register previously tracked tokens with the wallet engine so their
		// encrypted balances are fetched and kept fresh by the ongoing sync.
		// Without this, non-native token balances would read 0 until the user
		// re-adds them. Errors are benign (e.g. "token already added").
		for _, t := range loadTrackedTokens() {
			if err := wallet.TokenAdd(crypto.HashHexToHash(strings.ToLower(t.SCID))); err != nil {
				continue
			}
		}
	}()

	result := map[string]interface{}{
		"success": true,
		"address": address,
		"message": "Wallet opened successfully",
	}

	if networkWarning != "" {
		result["networkWarning"] = networkWarning
	}

	return result
}

// CloseWallet closes the currently open wallet
func (a *App) CloseWallet() map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	a.logToConsole("[WALLET] Closing wallet...")

	walletManager.wallet.Close_Encrypted_Wallet()
	walletManager.wallet = nil
	walletManager.isOpen = false

	a.logToConsole("[OK] Wallet closed successfully")

	return map[string]interface{}{
		"success": true,
		"message": "Wallet closed successfully",
	}
}

// GetWalletStatus returns the current wallet status
func (a *App) GetWalletStatus() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": true,
			"isOpen":  false,
		}
	}

	wallet := walletManager.wallet
	address := wallet.GetAddress().String()

	return map[string]interface{}{
		"success": true,
		"isOpen":  true,
		"address": address,
		"path":    walletManager.walletPath,
	}
}

// GetBalance returns the wallet balance
func (a *App) GetBalance() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	wallet := walletManager.wallet

	var mature, locked uint64

	// In simulator mode, NEVER open a new WebSocket connection for balance queries.
	// The simulator can only handle ONE WebSocket at a time -- opening one here
	// would conflict with Gnomon or an in-progress SC deploy and crash the daemon.
	// Instead: try GetDecryptedBalanceAtTopoHeight which only works if a WS is
	// already open (it won't create one), then fall back to the in-memory balance
	// which was populated by the most recent Sync_Wallet_Memory_With_Daemon call
	// (done in OpenSimulatorTestWallet).
	if a.simulatorManager != nil && a.simulatorManager.isInitialized {
		var zerohash [32]byte
		addr := wallet.GetAddress().String()
		if bal, _, err := wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, addr); err == nil {
			mature = bal
		} else {
			// No active connection -- use cached in-memory balance.
			mature, locked = wallet.Get_Balance()
		}
	} else {
		mature, locked = wallet.Get_Balance()
	}

	return map[string]interface{}{
		"success":       true,
		"balance":       mature,
		"lockedBalance": locked,
		"balanceHuman":  float64(mature) / 100000.0,
		"lockedHuman":   float64(locked) / 100000.0,
	}
}

// SyncWallet syncs the wallet with the daemon and waits for new blocks to be scanned
func (a *App) SyncWallet() map[string]interface{} {
	walletManager.RLock()
	if !walletManager.isOpen || walletManager.wallet == nil {
		walletManager.RUnlock()
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}
	wallet := walletManager.wallet
	walletManager.RUnlock()

	// Ensure wallet is online and connected to daemon (manual refresh should force this)
	endpointRaw := "127.0.0.1:10102"
	if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpointRaw = ep
	}
	endpoint := normalizeDaemonEndpointForWallet(endpointRaw)
	wallet.SetDaemonAddress(endpoint)
	a.ensureWalletDaemonConnectivity(endpointRaw)
	wallet.SetOnlineMode()

	// Force an immediate sync pass (otherwise height may never advance)
	if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Unable to sync wallet. Check your connection to the daemon.",
			"technicalError": err.Error(),
		}
	}

	// Get current heights
	walletHeight := wallet.Get_Height()
	daemonHeight := wallet.Get_Daemon_Height()

	a.logToConsole(fmt.Sprintf("[SYNC] Wallet height: %d, Daemon height: %d", walletHeight, daemonHeight))

	// If wallet is already synced, return immediately
	if daemonHeight == 0 {
		return map[string]interface{}{
			"success":      true,
			"synced":       false,
			"walletHeight": walletHeight,
			"daemonHeight": daemonHeight,
			"behindBlocks": int64(0),
			"message":      "Daemon not connected",
		}
	}

	if walletHeight >= daemonHeight {
		return map[string]interface{}{
			"success":      true,
			"synced":       true,
			"walletHeight": walletHeight,
			"daemonHeight": daemonHeight,
			"behindBlocks": int64(0),
			"message":      "Wallet is up to date",
		}
	}

	// Wallet is behind - wait for it to sync (up to 10 seconds)
	a.logToConsole("[SYNC] Wallet is behind daemon, waiting for sync...")

	maxWait := 10 * time.Second
	pollInterval := 500 * time.Millisecond
	startTime := time.Now()

	for time.Since(startTime) < maxWait {
		time.Sleep(pollInterval)

		walletManager.RLock()
		if walletManager.wallet == nil {
			walletManager.RUnlock()
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet closed during sync",
			}
		}
		newHeight := walletManager.wallet.Get_Height()
		walletManager.RUnlock()

		if newHeight >= daemonHeight {
			a.logToConsole(fmt.Sprintf("[SYNC] Wallet synced to height %d", newHeight))
			return map[string]interface{}{
				"success":      true,
				"synced":       true,
				"walletHeight": newHeight,
				"daemonHeight": daemonHeight,
				"behindBlocks": int64(0),
				"message":      "Wallet synced successfully",
			}
		}

		// Log progress
		if newHeight > walletHeight {
			a.logToConsole(fmt.Sprintf("[SYNC] Progress: %d / %d", newHeight, daemonHeight))
			walletHeight = newHeight
		}
	}

	// Timeout - still syncing
	walletManager.RLock()
	finalHeight := wallet.Get_Height()
	walletManager.RUnlock()

	a.logToConsole(fmt.Sprintf("[SYNC] Sync timeout, wallet at %d / %d", finalHeight, daemonHeight))

	return map[string]interface{}{
		"success":      true,
		"synced":       false,
		"walletHeight": finalHeight,
		"daemonHeight": daemonHeight,
		"behindBlocks": int64(daemonHeight) - int64(finalHeight),
		"message":      fmt.Sprintf("Still syncing: %d / %d blocks", finalHeight, daemonHeight),
	}
}

// GetWalletSyncStatus returns the current sync status without waiting
func (a *App) GetWalletSyncStatus() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	wallet := walletManager.wallet
	walletHeight := wallet.Get_Height()
	daemonHeight := wallet.Get_Daemon_Height()

	synced := daemonHeight > 0 && walletHeight >= daemonHeight

	return map[string]interface{}{
		"success":      true,
		"synced":       synced,
		"walletHeight": walletHeight,
		"daemonHeight": daemonHeight,
		"behindBlocks": int64(daemonHeight) - int64(walletHeight),
	}
}

// GetAddress returns the wallet address
func (a *App) GetAddress() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	address := walletManager.wallet.GetAddress().String()

	return map[string]interface{}{
		"success": true,
		"address": address,
	}
}

// GetSeedPhrase returns the wallet's recovery seed phrase (password-protected)
func (a *App) GetSeedPhrase(password string) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	if !walletManager.wallet.Check_Password(password) {
		a.logToConsole("[ERR] Failed to verify password for seed phrase")
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid password",
		}
	}

	seed := walletManager.wallet.GetSeed()

	a.logToConsole("[OK] Seed phrase retrieved (password verified)")

	return map[string]interface{}{
		"success": true,
		"seed":    seed,
		"message": "Seed phrase retrieved successfully",
	}
}

// GetWalletKeys returns the wallet's secret and public keys (password-protected)
func (a *App) GetWalletKeys(password string) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	if !walletManager.wallet.Check_Password(password) {
		a.logToConsole("[ERR] Failed to verify password for wallet keys")
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid password",
		}
	}

	keys := walletManager.wallet.Get_Keys()

	// Format secret key (64 hex characters, matching Engram/dero-wallet-cli format)
	// Pad with zeros on the left, then take last 64 characters
	secretHex := keys.Secret.Text(16)
	paddedSecret := "0000000000000000000000000000000000000000000000" + secretHex
	secretKey := paddedSecret[len(paddedSecret)-64:]

	// Get public key
	publicKey := keys.Public.StringHex()

	a.logToConsole("[OK] Wallet keys retrieved (password verified)")

	return map[string]interface{}{
		"success":   true,
		"secretKey": secretKey,
		"publicKey": publicKey,
		"message":   "Wallet keys retrieved successfully",
	}
}

// ClipboardClearIf atomically clears the native OS clipboard if it still
// contains the value the caller previously placed there.
//
// Why this exists: navigator.clipboard.writeText("") in the embedded WebKit
// is rejected with NotAllowedError when invoked outside a user-gesture
// context (e.g. from a setTimeout 30s after a copy). The native pasteboard
// has no such restriction, so we route the auto-clear through Go.
//
// Returns:
//
//	{ success: bool, cleared: bool, error?: string }
//
// `cleared` is true only when the clipboard contained `expected` and was
// successfully overwritten with empty. If the user copied something else
// in the meantime, `cleared` is false and we leave their data alone.
func (a *App) ClipboardClearIf(expected string) map[string]interface{} {
	current, err := runtime.ClipboardGetText(a.ctx)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"cleared": false,
			"error":   "clipboard read failed: " + err.Error(),
		}
	}
	if current != expected {
		return map[string]interface{}{
			"success": true,
			"cleared": false,
		}
	}
	if err := runtime.ClipboardSetText(a.ctx, ""); err != nil {
		return map[string]interface{}{
			"success": false,
			"cleared": false,
			"error":   "clipboard write failed: " + err.Error(),
		}
	}
	return map[string]interface{}{
		"success": true,
		"cleared": true,
	}
}

// GetIntegratedAddress generates an integrated address with optional destination port (payment ID)
// In DERO, "payment ID" is implemented as a destination port (uint64) embedded in the address.
// The resulting address changes from dero.../deto... to deroi.../detoi... format.
// Optional parameters: comment (string), amount (uint64 in atomic units)
func (a *App) GetIntegratedAddress(destinationPort uint64, comment string, amount uint64) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	// Get the base address
	baseAddr := walletManager.wallet.GetAddress()

	// Build arguments for the integrated address
	var arguments rpc.Arguments

	// Add destination port (this is DERO's equivalent of payment ID)
	// Port 0 is valid and commonly used for simple transfers
	arguments = append(arguments, rpc.Argument{
		Name:     rpc.RPC_DESTINATION_PORT,
		DataType: rpc.DataUint64,
		Value:    destinationPort,
	})

	// Add optional comment/message
	if comment != "" {
		arguments = append(arguments, rpc.Argument{
			Name:     rpc.RPC_COMMENT,
			DataType: rpc.DataString,
			Value:    comment,
		})
	}

	// Add optional requested amount
	if amount > 0 {
		arguments = append(arguments, rpc.Argument{
			Name:     rpc.RPC_VALUE_TRANSFER,
			DataType: rpc.DataUint64,
			Value:    amount,
		})
	}

	// Clone the address and add arguments to create integrated address
	integratedAddr := baseAddr.Clone()
	integratedAddr.Arguments = arguments

	// Validate the integrated address can be encoded
	_, err := integratedAddr.MarshalText()
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERROR] Failed to create integrated address: %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to create integrated address: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Generated integrated address with port %d", destinationPort))

	return map[string]interface{}{
		"success":           true,
		"integratedAddress": integratedAddr.String(),
		"baseAddress":       baseAddr.String(),
		"destinationPort":   destinationPort,
		"comment":           comment,
		"amount":            amount,
	}
}

// SplitIntegratedAddress decodes an integrated address and returns its components
// This is useful for understanding what data is embedded in an integrated address
func (a *App) SplitIntegratedAddress(integratedAddress string) map[string]interface{} {
	// Parse the address
	addr, err := rpc.NewAddress(integratedAddress)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Invalid address format: %v", err),
		}
	}

	result := map[string]interface{}{
		"success":      true,
		"baseAddress":  addr.BaseAddress().String(),
		"isIntegrated": addr.IsIntegratedAddress(),
		"isMainnet":    addr.IsMainnet(),
	}

	// If it's an integrated address, extract the embedded data
	if addr.IsIntegratedAddress() {
		// Extract destination port (payment ID)
		if addr.Arguments.Has(rpc.RPC_DESTINATION_PORT, rpc.DataUint64) {
			result["destinationPort"] = addr.Arguments.Value(rpc.RPC_DESTINATION_PORT, rpc.DataUint64).(uint64)
		}

		// Extract comment if present
		if addr.Arguments.Has(rpc.RPC_COMMENT, rpc.DataString) {
			result["comment"] = addr.Arguments.Value(rpc.RPC_COMMENT, rpc.DataString).(string)
		}

		// Extract requested amount if present
		if addr.Arguments.Has(rpc.RPC_VALUE_TRANSFER, rpc.DataUint64) {
			result["amount"] = addr.Arguments.Value(rpc.RPC_VALUE_TRANSFER, rpc.DataUint64).(uint64)
		}

		// Extract expiry if present
		if addr.Arguments.Has(rpc.RPC_EXPIRY, rpc.DataTime) {
			result["expiry"] = addr.Arguments.Value(rpc.RPC_EXPIRY, rpc.DataTime)
		}

		// Extract needs replyback flag if present
		if addr.Arguments.Has(rpc.RPC_NEEDS_REPLYBACK_ADDRESS, rpc.DataUint64) {
			result["needsReplyback"] = true
		}

		// Include raw arguments count
		result["argumentCount"] = len(addr.Arguments)
	}

	return result
}

// ListRecentWallets returns the list of recently opened wallets
func (a *App) ListRecentWallets() []string {
	walletManager.RLock()
	defer walletManager.RUnlock()
	return walletManager.recentWallets
}

// Transfer sends DERO to another address
func (a *App) Transfer(destination string, amount uint64, paymentID string, ringsize uint64) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	wallet := walletManager.wallet

	// Validate destination address
	if destination == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Destination address is required",
		}
	}

	// Validate amount
	if amount == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Amount must be greater than 0",
		}
	}

	destPreview := destination
	if len(destination) > 16 {
		destPreview = destination[:16] + "..."
	}
	a.logToConsole(fmt.Sprintf("[Transfer] Initiating transfer: %d atomic units to %s", amount, destPreview))

	// Build the transfer
	transfers := []rpc.Transfer{
		{
			Destination: destination,
			Amount:      amount,
		},
	}

	// Handle payment ID if provided (integrated address or separate)
	if paymentID != "" {
		// Payment IDs are typically embedded in integrated addresses
		// For now, log it - full implementation would handle this
		a.logToConsole(fmt.Sprintf("[Transfer] Payment ID provided: %s", paymentID))
	}

	// Pre-flight: verify daemon connectivity before attempting transfer
	if errResp := checkDaemonConnectivity(wallet); errResp != nil {
		a.logToConsole("[Transfer] Failed: wallet not connected to daemon")
		return errResp
	}

	// Sync wallet with daemon to get fresh nonce and ring members
	if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Pre-transfer wallet sync failed: %v", syncErr))
	}

	// Pre-flight: check balance covers the transfer amount
	mature, _ := wallet.Get_Balance()
	if mature == 0 || mature < amount {
		a.logToConsole(fmt.Sprintf("[Transfer] Failed: insufficient balance (%s DERO available, %s DERO required)", formatDEROAmount(mature), formatDEROAmount(amount)))
		return map[string]interface{}{
			"success":        false,
			"error":          fmt.Sprintf("Insufficient balance. You have %s DERO but this transfer requires %s DERO plus gas fees.", formatDEROAmount(mature), formatDEROAmount(amount)),
			"technicalError": fmt.Sprintf("mature balance %d < required %d", mature, amount),
		}
	}

	if ringsize < 2 {
		ringsize = 16
	}
	tx, err := wallet.TransferPayload0(transfers, ringsize, false, rpc.Arguments{}, 0, false)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Transfer build failed, retrying after resync: %v", err))
		if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Retry sync failed: %v", syncErr))
		}
		tx, err = wallet.TransferPayload0(transfers, ringsize, false, rpc.Arguments{}, 0, false)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[Transfer] Failed: %s", err.Error()))
			return map[string]interface{}{
				"success":        false,
				"error":          FriendlyError(err),
				"technicalError": err.Error(),
			}
		}
	}

	if err := wallet.SendTransaction(tx); err != nil {
		a.logToConsole(fmt.Sprintf("[Transfer] Broadcast failed: %s", err.Error()))
		return map[string]interface{}{
			"success":        false,
			"error":          fmt.Sprintf("Transaction built but failed to broadcast: %s", FriendlyError(err)),
			"technicalError": err.Error(),
		}
	}

	txid := tx.GetHash().String()
	a.logToConsole(fmt.Sprintf("[Transfer] Success! TXID: %s", txid))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"hex":     fmt.Sprintf("%x", tx.Serialize()),
	}
}

// GetTransactionHistory returns recent transactions with optional labels
func (a *App) GetTransactionHistory(limit int) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	if limit <= 0 {
		limit = 50
	}

	// Get DERO transactions (zero SCID = native DERO)
	var scid crypto.Hash
	// Show_Transfers(scid, coinbase, incoming, outgoing, min_height, max_height, sender, receiver, dstport, srcport)
	rpcEntries := walletManager.wallet.Show_Transfers(scid, true, true, true, 0, 0, "", "", 0, 0)

	// Load transaction labels for quick lookup
	labelMap := getTransactionLabelsMap()

	// Convert to frontend-friendly format with full transaction details
	entries := make([]map[string]interface{}, 0, len(rpcEntries))
	for _, e := range rpcEntries {
		entry := map[string]interface{}{
			"txid":        e.TXID,
			"height":      e.Height,
			"topoheight":  e.TopoHeight,
			"amount":      e.Amount,
			"fees":        e.Fees,
			"burn":        e.Burn,
			"incoming":    e.Incoming,
			"coinbase":    e.Coinbase,
			"destination": e.Destination,
			"sender":      e.Sender,
			"proof":       e.Proof,
			"status":      e.Status,
			"time":        e.Time.Unix(),
		}

		// Extract payload comment if available
		if e.Payload_RPC.HasValue(rpc.RPC_COMMENT, rpc.DataString) {
			if comment, ok := e.Payload_RPC.Value(rpc.RPC_COMMENT, rpc.DataString).(string); ok {
				entry["comment"] = comment
			}
		}

		// Extract destination port if available
		if e.Payload_RPC.HasValue(rpc.RPC_DESTINATION_PORT, rpc.DataUint64) {
			if port, ok := e.Payload_RPC.Value(rpc.RPC_DESTINATION_PORT, rpc.DataUint64).(uint64); ok {
				entry["destination_port"] = port
			}
		}

		// Extract source port if available
		if e.Payload_RPC.HasValue(rpc.RPC_SOURCE_PORT, rpc.DataUint64) {
			if port, ok := e.Payload_RPC.Value(rpc.RPC_SOURCE_PORT, rpc.DataUint64).(uint64); ok {
				entry["source_port"] = port
			}
		}

		// Include label if one exists for this transaction
		if label, ok := labelMap[e.TXID]; ok && label != "" {
			entry["label"] = label
		}
		entries = append(entries, entry)
	}

	// Limit results and reverse so newest are first
	if limit > 0 && len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	// Reverse: Show_Transfers returns oldest-first; UI expects newest-first
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}

	return map[string]interface{}{
		"success":      true,
		"transactions": entries,
		"count":        len(entries),
	}
}

// GetWalletMiningEarnings returns coinbase (mining reward) transactions from wallet
// This filters the transaction history to show only mining rewards
func (a *App) GetWalletMiningEarnings(limit int) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success":  false,
			"error":    "No wallet is currently open",
			"earnings": []map[string]interface{}{},
		}
	}

	if limit <= 0 {
		limit = 100
	}

	// Get DERO transactions with coinbase filter
	var scid crypto.Hash
	// Show_Transfers(scid, coinbase, incoming, outgoing, min_height, max_height, sender, receiver, dstport, srcport)
	// Only get coinbase transactions (coinbase=true, incoming=true, outgoing=false)
	rpcEntries := walletManager.wallet.Show_Transfers(scid, true, true, false, 0, 0, "", "", 0, 0)

	// Filter for coinbase only and convert to frontend-friendly format
	earnings := make([]map[string]interface{}, 0)
	var totalAmount uint64 = 0
	var blocksCount int = 0
	var minisCount int = 0

	for _, e := range rpcEntries {
		if !e.Coinbase {
			continue // Skip non-mining transactions
		}

		entry := map[string]interface{}{
			"txid":      e.TXID,
			"height":    e.Height,
			"amount":    e.Amount,
			"timestamp": e.Time.Unix(),
		}

		// Try to determine if block or miniblock based on amount
		// Full blocks have higher rewards than miniblocks
		// This is a heuristic - full blocks typically have 2+ DERO, minis less
		rewardType := "miniblock"
		if e.Amount >= 200000 { // 2 DERO = 200000 atomic units (DERO has 5 decimal places)
			rewardType = "block"
			blocksCount++
		} else {
			minisCount++
		}
		entry["type"] = rewardType
		totalAmount += e.Amount

		earnings = append(earnings, entry)
	}

	// Limit results (return most recent)
	if limit > 0 && len(earnings) > limit {
		earnings = earnings[len(earnings)-limit:]
	}

	return map[string]interface{}{
		"success":      true,
		"earnings":     earnings,
		"count":        len(earnings),
		"total_amount": totalAmount,
		"formatted":    formatDEROAmount(totalAmount),
		"blocks_count": blocksCount,
		"minis_count":  minisCount,
	}
}

// GetMiningEarningsSummary returns a summary of mining earnings without full list
func (a *App) GetMiningEarningsSummary() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success":      false,
			"error":        "No wallet is currently open",
			"total_amount": uint64(0),
		}
	}

	// Get all coinbase transactions
	var scid crypto.Hash
	rpcEntries := walletManager.wallet.Show_Transfers(scid, true, true, false, 0, 0, "", "", 0, 0)

	var totalAmount uint64 = 0
	var blocksCount int = 0
	var minisCount int = 0
	var latestHeight uint64 = 0
	var earliestHeight uint64 = 0

	for _, e := range rpcEntries {
		if !e.Coinbase {
			continue
		}

		totalAmount += e.Amount

		// Determine type
		if e.Amount >= 200000 {
			blocksCount++
		} else {
			minisCount++
		}

		// Track height range
		if earliestHeight == 0 || e.Height < earliestHeight {
			earliestHeight = e.Height
		}
		if e.Height > latestHeight {
			latestHeight = e.Height
		}
	}

	return map[string]interface{}{
		"success":         true,
		"total_amount":    totalAmount,
		"formatted":       formatDEROAmount(totalAmount),
		"blocks_count":    blocksCount,
		"minis_count":     minisCount,
		"total_count":     blocksCount + minisCount,
		"earliest_height": earliestHeight,
		"latest_height":   latestHeight,
	}
}

// CreateWallet creates a new wallet file
// If filePath is just a name (no path separators), it will be created in datashards/wallets/
func (a *App) CreateWallet(filePath, password string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// If just a name is provided (no path separators), construct full path
	if !strings.Contains(filePath, string(filepath.Separator)) && !strings.Contains(filePath, "/") {
		// Clean the name - remove any .db extension if user added it
		name := strings.TrimSuffix(filePath, ".db")
		// Construct path in wallets directory
		filePath = filepath.Join(getDatashardsDir(), "wallets", name+".db")
	}

	a.logToConsole(fmt.Sprintf("[WALLET] Creating new wallet: %s", filePath))

	// Check if file already exists
	if _, err := os.Stat(filePath); err == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "A wallet with this name already exists",
		}
	}

	// Create parent directory if it doesn't exist
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to create wallet directory",
			"technicalError": err.Error(),
		}
	}

	// Create new wallet
	wallet, err := walletapi.Create_Encrypted_Wallet_Random(filePath, password)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to create wallet: %v", err))
		return ErrorResponse(err)
	}

	// Get the seed phrase for backup
	seed := wallet.GetSeed()

	// Close the wallet (user should open it explicitly)
	wallet.Close_Encrypted_Wallet()

	a.logToConsole("[OK] Wallet created successfully")

	return map[string]interface{}{
		"success": true,
		"seed":    seed,
		"message": "Wallet created successfully. SAVE YOUR SEED PHRASE!",
	}
}

// RestoreWallet restores a wallet from seed phrase
// If filePath is just a name (no path separators), it will be created in datashards/wallets/
func (a *App) RestoreWallet(filePath, password, seed string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// If just a name is provided (no path separators), construct full path
	if !strings.Contains(filePath, string(filepath.Separator)) && !strings.Contains(filePath, "/") {
		// Clean the name - remove any .db extension if user added it
		name := strings.TrimSuffix(filePath, ".db")
		// Construct path in wallets directory
		filePath = filepath.Join(getDatashardsDir(), "wallets", name+".db")
	}

	a.logToConsole("[WALLET] Restoring wallet from seed...")

	// Check if file already exists
	if _, err := os.Stat(filePath); err == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "A wallet with this name already exists",
		}
	}

	// Create parent directory if it doesn't exist
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to create wallet directory",
			"technicalError": err.Error(),
		}
	}

	// Restore wallet from seed
	wallet, err := walletapi.Create_Encrypted_Wallet_From_Recovery_Words(filePath, password, seed)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to restore wallet: %v", err))
		return ErrorResponse(err)
	}

	// Set network before GetAddress() so the address prefix is correct
	// (dero1 for mainnet, deto1 for testnet/simulator). Derived from
	// nodeManager, not the globals --simulator flag, which goes stale after a
	// simulator→mainnet switch (see OpenWallet).
	wallet.SetNetwork(!a.IsInSimulatorMode())

	address := wallet.GetAddress().String()
	wallet.Close_Encrypted_Wallet()

	a.logToConsole(fmt.Sprintf("[OK] Wallet restored successfully: %s", address[:16]+"..."))

	return map[string]interface{}{
		"success": true,
		"address": address,
		"message": "Wallet restored successfully",
	}
}

// IsWalletOpen returns whether a wallet is currently open
func (a *App) IsWalletOpen() bool {
	walletManager.RLock()
	defer walletManager.RUnlock()
	return walletManager.isOpen
}

// GetWallet returns the current wallet instance (for internal use)
func GetWallet() *walletapi.Wallet_Disk {
	walletManager.RLock()
	defer walletManager.RUnlock()
	if walletManager.isOpen {
		return walletManager.wallet
	}
	return nil
}

func loadRecentWallets() []string {
	configFile := filepath.Join(getDatashardsDir(), "settings", "recent_wallets.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return []string{}
	}

	var wallets []string
	if err := json.Unmarshal(data, &wallets); err != nil {
		return []string{}
	}

	return wallets
}

// Initialize recent wallets on startup
func init() {
	walletManager.recentWallets = loadRecentWallets()
}

// ApproveWalletConnection signals that the user has approved a dApp connection
func (a *App) ApproveWalletConnection() map[string]interface{} {
	a.logToConsole("[OK] Wallet connection approved by user")
	return map[string]interface{}{"success": true}
}

// checkDaemonConnectivity verifies the wallet can reach the daemon before attempting a transaction.
// Returns nil if connected, or an error response map if not.
func checkDaemonConnectivity(wallet *walletapi.Wallet_Disk) map[string]interface{} {
	if wallet.Get_Daemon_Height() == 0 {
		return map[string]interface{}{
			"success":        false,
			"error":          "Wallet is not connected to the daemon. Please check your connection and try again.",
			"technicalError": "daemon height is 0 — no active daemon connection",
		}
	}
	return nil
}

// withSimulatorTransactionConnectivity runs a wallet transaction with the simulator-safe
// connect/disconnect pattern. Test wallets are intentionally left disconnected after opening
// so the simulator's single WebSocket slot stays free for Gnomon and other services.
func (a *App) withSimulatorTransactionConnectivity(wallet *walletapi.Wallet_Disk, action string, fn func() map[string]interface{}) map[string]interface{} {
	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)

	// Close any stale walletapi socket first, then pause Gnomon so the simulator has one free slot.
	walletapi.Daemon_Endpoint_Active = ""
	a.disconnectWalletAPI()
	gnomonWasRunning := a.pauseGnomonForSimulator()
	time.Sleep(300 * time.Millisecond)

	cleanup := func() {
		walletapi.Daemon_Endpoint_Active = ""
		a.disconnectWalletAPI()
		if gnomonWasRunning {
			time.Sleep(300 * time.Millisecond)
			a.resumeGnomonForSimulator()
		}
	}

	if err := walletapi.Connect(endpoint); err != nil {
		walletapi.Daemon_Endpoint_Active = ""
		cleanup()
		return map[string]interface{}{
			"success":        false,
			"error":          fmt.Sprintf("Failed to connect wallet to simulator for %s.", action),
			"technicalError": err.Error(),
		}
	}

	wallet.SetDaemonAddress(endpoint)
	wallet.SetOnlineMode()
	if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Pre-%s simulator wallet sync failed: %v", action, err))
	}

	result := fn()
	cleanup()
	return result
}

// sanitizeSCID strips trailing null bytes, whitespace, and quotes from an SCID string.
// DERO SC storage and some dApp frontends occasionally pad values with \x00.
func sanitizeSCID(s string) string {
	return strings.TrimRight(s, "\x00 \t\n\r\"")
}

// parseXSWDScArgs builds an rpc.Arguments slice from a dApp's XSWD params,
// prepending SCACTION + SCID and hoisting the entrypoint.
// Supported datatypes: U (uint64), S (string), H (hash/SCID), I (int64).
func parseXSWDScArgs(params map[string]interface{}, scid string) rpc.Arguments {
	scArgs := rpc.Arguments{}
	hasEntrypointInScRpc := false
	entrypointFromScRpc := ""

	appendScArg := func(argMap map[string]interface{}) {
		name, _ := argMap["name"].(string)
		dtype, _ := argMap["datatype"].(string)
		val := argMap["value"]
		if name == "" {
			return
		}
		if name == "entrypoint" {
			hasEntrypointInScRpc = true
			if ep, ok := val.(string); ok {
				entrypointFromScRpc = ep
			}
		}
		switch dtype {
		case "U":
			switch v := val.(type) {
			case float64:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "U", Value: uint64(v)})
			case uint64:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "U", Value: v})
			case int:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "U", Value: uint64(v)})
			}
		case "I":
			switch v := val.(type) {
			case float64:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "I", Value: int64(v)})
			case int64:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "I", Value: v})
			case int:
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "I", Value: int64(v)})
			}
		case "S":
			if v, ok := val.(string); ok {
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "S", Value: v})
			}
		case "H":
			if v, ok := val.(string); ok {
				scArgs = append(scArgs, rpc.Argument{Name: name, DataType: "H", Value: crypto.HashHexToHash(v)})
			}
		}
	}

	if args, ok := params["sc_rpc"].([]interface{}); ok {
		for _, arg := range args {
			argMap, ok := arg.(map[string]interface{})
			if !ok {
				continue
			}
			appendScArg(argMap)
		}
	} else if args, ok := params["sc_rpc"].([]map[string]interface{}); ok {
		for _, argMap := range args {
			appendScArg(argMap)
		}
	}

	entrypoint := entrypointFromScRpc
	if entrypoint == "" {
		if ep, ok := params["entrypoint"].(string); ok {
			entrypoint = ep
		}
	}

	if entrypoint == "" && !hasEntrypointInScRpc {
		return scArgs
	}

	hasSCACTION := false
	hasSCID := false
	for _, arg := range scArgs {
		if arg.Name == rpc.SCACTION {
			hasSCACTION = true
		}
		if arg.Name == rpc.SCID {
			hasSCID = true
		}
	}

	prefix := rpc.Arguments{}
	if !hasSCACTION {
		prefix = append(prefix, rpc.Argument{Name: rpc.SCACTION, DataType: "U", Value: uint64(rpc.SC_CALL)})
	}
	if !hasSCID {
		prefix = append(prefix, rpc.Argument{Name: rpc.SCID, DataType: "H", Value: crypto.HashHexToHash(scid)})
	}
	if entrypoint != "" && !hasEntrypointInScRpc {
		prefix = append(prefix, rpc.Argument{Name: "entrypoint", DataType: "S", Value: entrypoint})
	}
	return append(prefix, scArgs...)
}

// InternalWalletCall executes a wallet method directly using the embedded wallet
func (a *App) InternalWalletCall(method string, params map[string]interface{}, password string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// If wallet not open, try to open it if we have path and password
	if !walletManager.isOpen || walletManager.wallet == nil {
		if walletManager.walletPath != "" && password != "" {
			a.logToConsole("[WALLET] Unlocking wallet for transaction...")
			var err error
			// Re-open wallet
			walletManager.wallet, err = walletapi.Open_Encrypted_Wallet(walletManager.walletPath, password)
			if err != nil {
				return map[string]interface{}{"success": false, "error": FriendlyError(err), "technicalError": err.Error()}
			}

			walletManager.isOpen = true
			walletManager.wallet.SetNetwork(!a.IsInSimulatorMode())

			// Set daemon endpoint
			endpointRaw := "127.0.0.1:10102"
			if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
				endpointRaw = ep
			}
			endpoint := normalizeDaemonEndpointForWallet(endpointRaw)
			walletManager.wallet.SetDaemonAddress(endpoint)
			a.ensureWalletDaemonConnectivity(endpointRaw)
			walletManager.wallet.SetOnlineMode()
		} else {
			return map[string]interface{}{"success": false, "error": "Wallet not open"}
		}
	}

	wallet := walletManager.wallet
	a.logToConsole(fmt.Sprintf("[FAST] Internal wallet call: %s", method))

	// Handle methods
	switch method {
	case "GetAddress", "DERO.GetAddress", "getaddress":
		address := wallet.GetAddress().String()
		return map[string]interface{}{
			"success": true,
			"result":  map[string]string{"address": address},
		}

	case "GetBalance", "DERO.GetBalance", "getbalance":
		// Honor the optional "scid" param so a dApp can query a token balance.
		// A DERO token balance is an encrypted per-account leaf, fetched by
		// syncing that SCID from the daemon then reading Get_Balance_scid —
		// mirroring the canonical wallet RPC. Without an scid (or the zero hash)
		// return native DERO. This is the bridge path the embedded TELA app uses
		// (the XSWD WebSocket handler has the equivalent fix).
		scidStr := ""
		if raw, ok := params["scid"].(string); ok {
			scidStr = strings.ToLower(sanitizeSCID(raw))
		}

		if scidStr != "" && scidStr != deroSCID {
			scid := crypto.HashHexToHash(scidStr)
			// HashHexToHash silently yields the ZERO hash on malformed input,
			// which would otherwise alias the native DERO balance. Reject
			// anything that doesn't round-trip to the lowercased hex we received.
			if scid.String() != scidStr {
				return map[string]interface{}{"success": false, "error": "Invalid scid: must be 64 hexadecimal characters"}
			}
			mature, err := syncAndReadTokenBalance(wallet, scid)
			if err != nil {
				return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to fetch token balance: %v", err)}
			}
			// Match canonical GetBalance_Result: {balance, unlocked_balance} only.
			return map[string]interface{}{
				"success": true,
				"result":  map[string]uint64{"balance": mature, "unlocked_balance": mature},
			}
		}

		mature := readNativeBalance(wallet)
		return map[string]interface{}{
			"success": true,
			"result":  map[string]uint64{"balance": mature, "unlocked_balance": mature},
		}

	case "GetHeight", "DERO.GetHeight", "getheight":
		height := wallet.Get_Height()
		result := map[string]interface{}{
			"height": height,
		}
		// Many dApps (e.g. vault.tela) use stableheight as a trigger to fetch SC data.
		// The raw wallet only knows the current height; stableheight and topoheight come
		// from the daemon's DERO.GetHeight response, so we augment the result here.
		if a.daemonClient != nil {
			if raw, err := a.daemonClient.Call("DERO.GetHeight", nil); err == nil {
				if daemonResult, ok := raw.(map[string]interface{}); ok {
					if sh, ok := daemonResult["stableheight"]; ok {
						result["stableheight"] = sh
					}
					if th, ok := daemonResult["topoheight"]; ok {
						result["topoheight"] = th
					}
				}
			}
		}
		return map[string]interface{}{
			"success": true,
			"result":  result,
		}

	case "transfer", "Transfer", "DERO.Transfer", "transfer_split":
		// Check for SC deployment: dApps can send "sc" param to deploy a new contract.
		// This matches Engram/TELA CLI behavior where transfer with "sc" deploys a contract.
		if scCode, ok := params["sc"].(string); ok && scCode != "" {
			a.logToConsole("[XSWD] SC deployment via transfer detected")
			ringsize := uint64(2)
			if rs, ok := params["ringsize"].(float64); ok && rs >= 2 {
				ringsize = uint64(rs)
			}
			deployResult := a.InstallSmartContract(scCode, ringsize >= 16)
			if success, ok := deployResult["success"].(bool); ok && success {
				return map[string]interface{}{
					"success": true,
					"result":  map[string]interface{}{"txid": deployResult["txid"]},
				}
			}
			return map[string]interface{}{"success": false, "error": deployResult["error"]}
		}

		// Parse transfers array -- each entry may carry a token SCID for non-DERO assets.
		var transfers []rpc.Transfer
		if t, ok := params["transfers"].([]interface{}); ok {
			for _, item := range t {
				if tf, ok := item.(map[string]interface{}); ok {
					amount := uint64(0)
					if a, ok := tf["amount"].(float64); ok {
						amount = uint64(a)
					}
					burn := uint64(0)
					if b, ok := tf["burn"].(float64); ok {
						burn = uint64(b)
					}
					dest := ""
					if d, ok := tf["destination"].(string); ok {
						dest = d
					}
					var tokenSCID crypto.Hash
					if s, ok := tf["scid"].(string); ok && s != "" {
						tokenSCID = crypto.HashHexToHash(sanitizeSCID(s))
					}
					if dest != "" || amount > 0 || burn > 0 {
						transfers = append(transfers, rpc.Transfer{
							Destination: dest,
							Amount:      amount,
							Burn:        burn,
							SCID:        tokenSCID,
						})
					}
				}
			}
		} else {
			amount := uint64(0)
			if a, ok := params["amount"].(float64); ok {
				amount = uint64(a)
			}
			dest := ""
			if d, ok := params["destination"].(string); ok {
				dest = d
			}
			if dest != "" {
				transfers = append(transfers, rpc.Transfer{Destination: dest, Amount: amount})
			}
		}

		// Check if this transfer also carries an SC call (scid + sc_rpc).
		// Some dApps (e.g. Villager) send SC invocations via the transfer method.
		scArgs := rpc.Arguments{}
		scid := ""
		if s, ok := params["scid"].(string); ok {
			scid = sanitizeSCID(s)
		}
		if scid != "" {
			scArgs = parseXSWDScArgs(params, scid)
			if len(scArgs) > 0 {
				scidPreview := scid
				if len(scid) > 16 {
					scidPreview = scid[:16] + "..."
				}
				a.logToConsole(fmt.Sprintf("[XSWD] Transfer with SC call: scid=%s", scidPreview))
			}
		}

		if len(transfers) == 0 && len(scArgs) == 0 {
			return map[string]interface{}{"success": false, "error": "Please specify a transfer amount and destination, or a smart contract call."}
		}

		runTransfer := func() map[string]interface{} {
			if !a.IsInSimulatorMode() {
				if errResp := checkDaemonConnectivity(wallet); errResp != nil {
					return errResp
				}
			}
			if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-transfer wallet sync failed: %v", syncErr))
			}

			mature, _ := wallet.Get_Balance()
			var totalTransferAmount uint64
			for _, t := range transfers {
				totalTransferAmount += t.Amount + t.Burn
			}
			if mature == 0 || (totalTransferAmount > 0 && mature < totalTransferAmount) {
				return map[string]interface{}{
					"success":        false,
					"error":          fmt.Sprintf("Insufficient balance. You have %s DERO but this transaction requires at least %s DERO plus gas fees.", formatDEROAmount(mature), formatDEROAmount(totalTransferAmount)),
					"technicalError": fmt.Sprintf("mature balance %d < required %d", mature, totalTransferAmount),
				}
			}

			ringsize := uint64(2)
			if rs, ok := params["ringsize"].(float64); ok && rs >= 2 {
				ringsize = uint64(rs)
			}
			// dApp-requested fee (0 = let daemon pick)
			fees := uint64(0)
			if f, ok := params["fees"].(float64); ok && f > 0 {
				fees = uint64(f)
			}
			a.logToConsole(fmt.Sprintf("[XSWD] Building transfer TX with ringsize=%d fees=%d", ringsize, fees))

			tx, err := wallet.TransferPayload0(transfers, ringsize, false, scArgs, fees, false)
			if err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Transfer build failed, retrying after resync: %v", err))
				if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Retry sync failed: %v", syncErr))
				}
				tx, err = wallet.TransferPayload0(transfers, ringsize, false, scArgs, fees, false)
				if err != nil {
					return map[string]interface{}{"success": false, "error": FriendlyError(err), "technicalError": err.Error()}
				}
			}

			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] Transfer broadcast failed: %s", err.Error()))
				return map[string]interface{}{"success": false, "error": fmt.Sprintf("Transaction built but failed to broadcast: %s", FriendlyError(err)), "technicalError": err.Error()}
			}

			txid := tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] Transfer TX sent: %s (ringsize=%d)", txid, ringsize))
			return map[string]interface{}{
				"success": true,
				"result":  map[string]interface{}{"txid": txid},
			}
		}

		if a.IsInSimulatorMode() {
			return a.withSimulatorTransactionConnectivity(wallet, "transfer", runTransfer)
		}
		return runTransfer()

	case "scinvoke", "SC_Invoke", "DERO.SC_Invoke":
		scid := ""
		if s, ok := params["scid"].(string); ok {
			scid = sanitizeSCID(s)
		}
		if scid == "" {
			return map[string]interface{}{"success": false, "error": "Smart Contract ID (SCID) is required for this operation."}
		}

		// Parse SC arguments (shared helper handles all datatypes including I, U, S, H)
		scArgs := parseXSWDScArgs(params, scid)
		if len(scArgs) == 0 {
			return map[string]interface{}{
				"success": false,
				"error":   "Invalid smart contract call. Missing or malformed 'entrypoint'/'sc_rpc' parameters.",
			}
		}

		// sc_dero_deposit / sc_token_deposit -- value attached to (deposited into)
		// the SC call. A DVM contract reads this via DEROVALUE()/ASSETVALUE(),
		// which the chain sources from the transfer's BURN value
		// (blockchain/transaction_execute.go: incoming_value[scid] = BurnValue) --
		// NOT Amount, which is an ordinary transfer to a destination the contract
		// never sees. So deposits MUST use Burn, mirroring canonical ScInvoke
		// (walletapi/rpcserver/rpc_scinvoke.go). The native-DERO deposit also needs
		// a destination (a random ring member), since a non-zero zero-SCID transfer
		// with an empty destination is rejected by the wallet library.
		var scDeposit []rpc.Transfer
		if deroDeposit, ok := params["sc_dero_deposit"].(float64); ok && deroDeposit > 0 {
			dest := ""
			if a.IsInSimulatorMode() {
				dest = a.getSimulatorTransferDestination(wallet.GetAddress().String())
			} else {
				randos := wallet.Random_ring_members(crypto.ZEROHASH)
				if len(randos) == 0 {
					return map[string]interface{}{"success": false, "error": "Could not get ring members for SC DERO deposit. Check daemon connection and retry."}
				}
				dest = randos[0]
				if dest == wallet.GetAddress().String() && len(randos) > 1 {
					dest = randos[1]
				}
			}
			scDeposit = append(scDeposit, rpc.Transfer{Destination: dest, Amount: 0, Burn: uint64(deroDeposit)})
		}
		if tokenDeposit, ok := params["sc_token_deposit"].(float64); ok && tokenDeposit > 0 {
			tokenSCIDStr, _ := params["sc_token_deposit_scid"].(string)
			var tokenSCID crypto.Hash
			if tokenSCIDStr != "" {
				tokenSCID = crypto.HashHexToHash(sanitizeSCID(tokenSCIDStr))
			}
			scDeposit = append(scDeposit, rpc.Transfer{SCID: tokenSCID, Amount: 0, Burn: uint64(tokenDeposit)})
		}

		// Transfers attached to the SC call (burns for dev donations, etc.)
		// Each entry may carry a per-transfer token SCID.
		var transfers []rpc.Transfer
		if t, ok := params["transfers"].([]interface{}); ok {
			for _, item := range t {
				if tf, ok := item.(map[string]interface{}); ok {
					amt := uint64(0)
					if a, ok := tf["amount"].(float64); ok {
						amt = uint64(a)
					}
					burn := uint64(0)
					if b, ok := tf["burn"].(float64); ok {
						burn = uint64(b)
					}
					dest := ""
					if d, ok := tf["destination"].(string); ok {
						dest = d
					}
					var tokenSCID crypto.Hash
					if s, ok := tf["scid"].(string); ok && s != "" {
						tokenSCID = crypto.HashHexToHash(sanitizeSCID(s))
					}
					if amt > 0 || burn > 0 {
						transfers = append(transfers, rpc.Transfer{
							Destination: dest,
							Amount:      amt,
							Burn:        burn,
							SCID:        tokenSCID,
						})
					}
				}
			}
		}
		// Merge deposit entries in front of any explicit transfers
		transfers = append(scDeposit, transfers...)

		runSCInvoke := func() map[string]interface{} {
			if !a.IsInSimulatorMode() {
				if errResp := checkDaemonConnectivity(wallet); errResp != nil {
					return errResp
				}
			}
			if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-scinvoke wallet sync failed: %v", syncErr))
			}

			mature, _ := wallet.Get_Balance()
			if mature == 0 {
				return map[string]interface{}{
					"success":        false,
					"error":          "Insufficient balance. Even a smart contract call requires gas fees — please fund your wallet first.",
					"technicalError": "wallet mature balance is 0",
				}
			}

			ringsize := uint64(2)
			if rs, ok := params["ringsize"].(float64); ok && rs >= 2 {
				ringsize = uint64(rs)
			}
			fees := uint64(0)
			if f, ok := params["fees"].(float64); ok && f > 0 {
				fees = uint64(f)
			}

			// Guard against wallet library panic path: scinvoke with no transfers at all.
			if len(transfers) == 0 {
				destination := ""
				if a.IsInSimulatorMode() {
					destination = a.getSimulatorTransferDestination(wallet.GetAddress().String())
				} else {
					randos := wallet.Random_ring_members(crypto.ZEROHASH)
					if len(randos) == 0 {
						return map[string]interface{}{
							"success": false,
							"error":   "Could not get ring members for SC call. Please check daemon connection and retry.",
						}
					}
					destination = randos[0]
					if destination == wallet.GetAddress().String() && len(randos) > 1 {
						destination = randos[1]
					}
				}
				transfers = append(transfers, rpc.Transfer{
					Destination: destination,
					Amount:      0,
				})
			}
			a.logToConsole(fmt.Sprintf("[XSWD] Building scinvoke TX with ringsize=%d fees=%d", ringsize, fees))

			tx, err := wallet.TransferPayload0(transfers, ringsize, false, scArgs, fees, false)
			if err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] scinvoke build failed, retrying after resync: %v", err))
				if syncErr := wallet.Sync_Wallet_Memory_With_Daemon(); syncErr != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Retry sync failed: %v", syncErr))
				}
				tx, err = wallet.TransferPayload0(transfers, ringsize, false, scArgs, fees, false)
				if err != nil {
					return map[string]interface{}{"success": false, "error": FriendlyError(err), "technicalError": err.Error()}
				}
			}

			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] scinvoke broadcast failed: %s", err.Error()))
				return map[string]interface{}{"success": false, "error": fmt.Sprintf("SC call built but failed to broadcast: %s", FriendlyError(err)), "technicalError": err.Error()}
			}

			txid := tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] scinvoke TX sent: %s (ringsize=%d)", txid, ringsize))
			return map[string]interface{}{
				"success": true,
				"result": map[string]interface{}{
					"txid": txid,
				},
			}
		}

		if a.IsInSimulatorMode() {
			return a.withSimulatorTransactionConnectivity(wallet, "scinvoke", runSCInvoke)
		}
		return runSCInvoke()

	case "GetTransfers", "get_transfers":
		coinbase, in, out := true, true, true
		if v, ok := params["coinbase"].(bool); ok {
			coinbase = v
		}
		if v, ok := params["in"].(bool); ok {
			in = v
		}
		if v, ok := params["out"].(bool); ok {
			out = v
		}
		minH := uint64(0)
		maxH := uint64(0)
		if v, ok := params["min_height"].(float64); ok {
			minH = uint64(v)
		}
		if v, ok := params["max_height"].(float64); ok {
			maxH = uint64(v)
		}
		var scid crypto.Hash
		entries := wallet.Show_Transfers(scid, coinbase, in, out, minH, maxH, "", "", 0, 0)
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"entries": entries},
		}

	case "GetTransferbyTXID", "get_transfer_by_txid":
		txid, _ := params["txid"].(string)
		if len(txid) != 64 {
			return map[string]interface{}{"success": false, "error": "txid must be 64 hex characters"}
		}
		var scid crypto.Hash
		foundSCID, entry := wallet.Get_Payments_TXID(scid, txid)
		if entry.Height == 0 {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("Transaction not found: %s", txid)}
		}
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"entry": entry, "scid": foundSCID.String()},
		}

	case "MakeIntegratedAddress", "make_integrated_address":
		addr := wallet.GetAddress()
		addrCopy := addr.Clone()
		var payload rpc.Arguments
		if payloadRaw, ok := params["payload_rpc"].([]interface{}); ok {
			for _, item := range payloadRaw {
				if a, ok := item.(map[string]interface{}); ok {
					name, _ := a["name"].(string)
					dtype, _ := a["datatype"].(string)
					val := a["value"]
					if name == "" {
						continue
					}
					switch dtype {
					case "S":
						if v, ok := val.(string); ok {
							payload = append(payload, rpc.Argument{Name: name, DataType: "S", Value: v})
						}
					case "U":
						if v, ok := val.(float64); ok {
							payload = append(payload, rpc.Argument{Name: name, DataType: "U", Value: uint64(v)})
						}
					case "H":
						if v, ok := val.(string); ok {
							payload = append(payload, rpc.Argument{Name: name, DataType: "H", Value: crypto.HashHexToHash(v)})
						}
					}
				}
			}
		}
		addrCopy.Arguments = payload
		if _, err := addrCopy.MarshalText(); err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to create integrated address: %v", err)}
		}
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"integrated_address": addrCopy.String(), "payload_rpc": payload},
		}

	case "SplitIntegratedAddress", "split_integrated_address":
		intAddr, _ := params["integrated_address"].(string)
		if intAddr == "" {
			return map[string]interface{}{"success": false, "error": "integrated_address parameter required"}
		}
		addr, err := rpc.NewAddress(intAddr)
		if err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("Invalid address: %v", err)}
		}
		if !addr.IsIntegratedAddress() {
			return map[string]interface{}{"success": false, "error": "Address is not an integrated address"}
		}
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"address": addr.BaseAddress().String(), "payload_rpc": addr.Arguments},
		}

	// GetPublicKey returns the wallet's bn256 G1 public key as a 66-char compressed hex
	// string. This is pure public data — the cryptographic counterpart to GetAddress.
	// It is needed by any service that wants to encrypt data to this wallet using ECDH
	// (e.g. Dead Drop document delivery) without requiring the user to hold a session.
	case "GetPublicKey":
		keys := wallet.Get_Keys()
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"public_key": keys.Public.StringHex()},
		}

	case "SignData":
		data, _ := params["data"].(string)
		if data == "" {
			return map[string]interface{}{"success": false, "error": "data parameter required"}
		}
		signature := wallet.SignData([]byte(data))
		if len(signature) == 0 {
			return map[string]interface{}{"success": false, "error": "Failed to sign data"}
		}
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"signature": string(signature)},
		}

	case "CheckSignature":
		signedData, _ := params["signed_data"].(string)
		if signedData == "" {
			return map[string]interface{}{"success": false, "error": "signed_data parameter required"}
		}
		signer, message, err := wallet.CheckSignature([]byte(signedData))
		if err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("Verification failed: %v", err)}
		}
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"signer": signer.String(), "message": strings.TrimSpace(string(message))},
		}

	// DecryptPayload decrypts a Dead Drop document ciphertext encrypted to this
	// wallet's public key via ECDH + XChaCha20.
	//
	// Encryption scheme (server-side, matching this decryption):
	//   1. Parse recipient's wallet address → extract bn256 G1 public key
	//   2. Generate ephemeral keypair: ephemeral_secret (random scalar), ephemeral_pub = ephemeral_secret × G
	//   3. Shared secret = GenerateSharedSecret(ephemeral_secret, recipient_pubkey)
	//      → shared_key = Keccak256(EncodeCompressed(ephemeral_secret × recipient_pubkey))
	//   4. Encrypt plaintext with EncryptDecryptUserData(shared_key, plaintext)
	//   5. Wire format: hex(EncodeCompressed(ephemeral_pub)) + ":" + hex(ciphertext)
	//
	// Decryption (here):
	//   1. Split ciphertext on ":" → ephemeral_pub_hex, ciphertext_hex
	//   2. Decode ephemeral_pub_hex → bn256.G1 point
	//   3. Shared secret = GenerateSharedSecret(wallet.Secret, ephemeral_pub)
	//      → mathematically identical: secret × ephemeral_secret × G = ephemeral_secret × secret × G
	//   4. XOR-decrypt ciphertext with shared_key
	//   5. Return base64-encoded plaintext (caller decodes as needed)
	case "DecryptPayload":
		ciphertext, _ := params["ciphertext"].(string)
		if ciphertext == "" {
			return map[string]interface{}{"success": false, "error": "ciphertext parameter required"}
		}

		// Split wire format: "<ephemeral_pub_hex>:<ciphertext_hex>"
		parts := strings.SplitN(ciphertext, ":", 2)
		if len(parts) != 2 {
			return map[string]interface{}{"success": false, "error": "invalid ciphertext format: expected '<ephemeral_pub_hex>:<ciphertext_hex>'"}
		}

		ephemeralPubBytes, err := hex.DecodeString(parts[0])
		if err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("invalid ephemeral public key hex: %v", err)}
		}
		ciphertextBytes, err := hex.DecodeString(parts[1])
		if err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("invalid ciphertext hex: %v", err)}
		}

		// Decode the ephemeral public key (33-byte compressed bn256 G1 point)
		ephemeralPub := new(bn256.G1)
		if err := ephemeralPub.DecodeCompressed(ephemeralPubBytes); err != nil {
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("failed to decode ephemeral public key: %v", err)}
		}

		// Derive the shared secret using this wallet's private scalar
		keys := wallet.Get_Keys()
		sharedKey := crypto.GenerateSharedSecret(keys.Secret.BigInt(), ephemeralPub)

		// Decrypt in-place (XChaCha20 XOR — symmetric operation)
		plaintext := make([]byte, len(ciphertextBytes))
		copy(plaintext, ciphertextBytes)
		crypto.EncryptDecryptUserData(sharedKey, plaintext)

		a.logToConsole("[DecryptPayload] Document decrypted successfully")
		return map[string]interface{}{
			"success": true,
			"result":  map[string]interface{}{"plaintext": base64.StdEncoding.EncodeToString(plaintext)},
		}

	case "GetTrackedAssets", "gettrackedassets":
		// Return tracked asset balances
		// For the internal wallet, we return DERO balance at minimum
		// The wallet's Balance map is private, so we access what we can
		balance, lockedBalance := wallet.Get_Balance()

		// SCID "0000...0000" (zero SCID) represents native DERO
		zeroScid := deroSCID

		balances := map[string]uint64{
			zeroScid: balance,
		}

		// Check for only_positive_balances param
		onlyPositive := true // default
		if opb, ok := params["only_positive_balances"].(bool); ok {
			onlyPositive = opb
		}

		// Filter zero balances if only_positive_balances is true
		if onlyPositive && balance == 0 {
			balances = map[string]uint64{}
		}

		return map[string]interface{}{
			"success": true,
			"result": map[string]interface{}{
				"balances":       balances,
				"locked_balance": lockedBalance,
			},
		}

	default:
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Method '%s' is not available. Use XSWD for this operation.", method)}
	}
}

// SelectWalletFile opens a file dialog to select a wallet file
func (a *App) SelectWalletFile() string {
	walletsDir := filepath.Join(getDatashardsDir(), "wallets")
	os.MkdirAll(walletsDir, 0700)

	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		DefaultDirectory: walletsDir,
		Title:            "Select Wallet File",
		ShowHiddenFiles:  true,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "DERO Wallet (*.db)",
				Pattern:     "*.db",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		log.Printf("Error opening file dialog: %v", err)
		return ""
	}
	return selection
}

// WalletInfo represents information about a wallet for the frontend
type WalletInfo struct {
	Path          string `json:"path"`
	Filename      string `json:"filename"`
	AddressPrefix string `json:"addressPrefix"`
	LastUsed      int64  `json:"lastUsed"`
	IsCurrent     bool   `json:"isCurrent"`
	Network       string `json:"network"` // "mainnet" or "simulator"
}

// SwitchWallet closes the current wallet and opens a different one
func (a *App) SwitchWallet(filePath, password string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	a.logToConsole(fmt.Sprintf("[SYNC] Switching wallet to: %s", filepath.Base(filePath)))

	// Check if file exists and is not empty; try .bak recovery if needed
	fi, statErr := os.Stat(filePath)
	if os.IsNotExist(statErr) {
		if recovered := recoverWalletFromBackup(filePath, a); !recovered {
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet file not found",
			}
		}
		fi, _ = os.Stat(filePath)
	}
	if fi != nil && fi.Size() == 0 {
		a.logToConsole(fmt.Sprintf("[WARN] Wallet file is 0 bytes (corrupt): %s — attempting recovery", filePath))
		if recovered := recoverWalletFromBackup(filePath, a); !recovered {
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet file is corrupt (0 bytes) and no backup (.bak) was found.",
			}
		}
	}

	// Close existing wallet if open
	if walletManager.isOpen && walletManager.wallet != nil {
		a.logToConsole("[WALLET] Closing current wallet...")
		walletManager.wallet.Close_Encrypted_Wallet()
		walletManager.isOpen = false
		walletManager.wallet = nil
	}

	// Open the new wallet
	wallet, err := walletapi.Open_Encrypted_Wallet(filePath, password)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to switch wallet: %v", err))
		return ErrorResponse(err)
	}

	walletManager.wallet = wallet
	walletManager.walletPath = filePath
	walletManager.isOpen = true

	// Set network mode (mainnet vs simulator) - MUST be called before GetAddress()
	wallet.SetNetwork(!a.IsInSimulatorMode())

	// Add to recent wallets with updated timestamp (now with correct network prefix)
	addToRecentWalletsWithInfo(filePath, wallet.GetAddress().String())

	address := wallet.GetAddress().String()
	mature, locked := wallet.Get_Balance()

	a.logToConsole(fmt.Sprintf("[OK] Switched to wallet: %s", address[:16]+"..."))

	// Background daemon connectivity and sync (same pattern as OpenWallet)
	go func() {
		endpointRaw := "127.0.0.1:10102"
		if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
			endpointRaw = ep
		}
		endpoint := normalizeDaemonEndpointForWallet(endpointRaw)

		wallet.SetDaemonAddress(endpoint)

		connectDone := make(chan struct{}, 1)
		go func() {
			a.ensureWalletDaemonConnectivity(endpointRaw)
			connectDone <- struct{}{}
		}()
		select {
		case <-connectDone:
		case <-time.After(15 * time.Second):
			a.logToConsole("[WARN] Wallet daemon connection timed out (15s) during switch")
		}

		wallet.SetOnlineMode()

		syncDone := make(chan error, 1)
		go func() {
			syncDone <- wallet.Sync_Wallet_Memory_With_Daemon()
		}()
		select {
		case err := <-syncDone:
			if err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Initial wallet sync failed after switch: %v", err))
			}
		case <-time.After(10 * time.Second):
			a.logToConsole("[WARN] Initial wallet sync timed out (10s) after switch")
		}
	}()

	return map[string]interface{}{
		"success":       true,
		"address":       address,
		"balance":       mature,
		"lockedBalance": locked,
		"balanceHuman":  float64(mature) / 100000.0,
		"message":       "Wallet switched successfully",
	}
}

// GetRecentWalletsWithInfo returns recent wallets with additional metadata
func (a *App) GetRecentWalletsWithInfo() []WalletInfo {
	walletManager.RLock()
	defer walletManager.RUnlock()

	// Load the extended wallet info
	infos := loadRecentWalletsWithInfo()

	// Mark current wallet
	for i := range infos {
		if walletManager.isOpen && infos[i].Path == walletManager.walletPath {
			infos[i].IsCurrent = true
		}
	}

	return infos
}

// Extended wallet info storage
type recentWalletData struct {
	Path          string `json:"path"`
	AddressPrefix string `json:"addressPrefix"`
	LastUsed      int64  `json:"lastUsed"`
	Network       string `json:"network"` // "mainnet" or "simulator"
}

func addToRecentWalletsWithInfo(path, address string) {
	// Load existing data
	existing := loadRecentWalletsData()

	// Stamp the network from nodeManager, not the globals --simulator flag —
	// the flag goes stale after a simulator→mainnet switch and would record a
	// mainnet session as "simulator", poisoning the last-used-network warnings.
	network := "mainnet"
	if nodeManager.networkMode == NetworkSimulator {
		network = "simulator"
	}

	// Create new entry
	newEntry := recentWalletData{
		Path:          path,
		AddressPrefix: "",
		LastUsed:      nowUnix(),
		Network:       network,
	}
	if len(address) >= 16 {
		newEntry.AddressPrefix = address[:16] + "..."
	}

	// Remove existing entry for same path and add new one at front
	newData := []recentWalletData{newEntry}
	for _, e := range existing {
		if e.Path != path {
			newData = append(newData, e)
		}
	}

	// Keep only last 10
	if len(newData) > 10 {
		newData = newData[:10]
	}

	// Save
	saveRecentWalletsData(newData)

	// Also update the simple list for backward compatibility
	simplePaths := make([]string, len(newData))
	for i, d := range newData {
		simplePaths[i] = d.Path
	}
	walletManager.recentWallets = simplePaths
}

func loadRecentWalletsData() []recentWalletData {
	configFile := filepath.Join(getDatashardsDir(), "settings", "recent_wallets_info.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		// Try to migrate from old format
		oldWallets := loadRecentWallets()
		if len(oldWallets) > 0 {
			result := make([]recentWalletData, len(oldWallets))
			for i, p := range oldWallets {
				result[i] = recentWalletData{
					Path:          p,
					AddressPrefix: "",
					LastUsed:      0,
				}
			}
			return result
		}
		return []recentWalletData{}
	}

	var wallets []recentWalletData
	if err := json.Unmarshal(data, &wallets); err != nil {
		return []recentWalletData{}
	}

	return wallets
}

func saveRecentWalletsData(wallets []recentWalletData) {
	configDir := filepath.Join(getDatashardsDir(), "settings")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		log.Printf("Failed to create settings directory: %v", err)
		return
	}

	data, err := json.Marshal(wallets)
	if err != nil {
		log.Printf("Failed to marshal recent wallets data: %v", err)
		return
	}

	if err := os.WriteFile(filepath.Join(configDir, "recent_wallets_info.json"), data, 0600); err != nil {
		log.Printf("Failed to save recent wallets data: %v", err)
	}
}

func loadRecentWalletsWithInfo() []WalletInfo {
	data := loadRecentWalletsData()
	result := make([]WalletInfo, len(data))
	for i, d := range data {
		// Default to mainnet if not set (for backward compatibility)
		network := d.Network
		if network == "" {
			// Infer from address prefix if possible
			if len(d.AddressPrefix) > 4 {
				if d.AddressPrefix[:4] == "deto" {
					network = "simulator"
				} else {
					network = "mainnet"
				}
			} else {
				network = "mainnet"
			}
		}
		result[i] = WalletInfo{
			Path:          d.Path,
			Filename:      filepath.Base(d.Path),
			AddressPrefix: d.AddressPrefix,
			LastUsed:      d.LastUsed,
			IsCurrent:     false,
			Network:       network,
		}
	}
	return result
}

// RemoveRecentWallet removes a wallet from the recent wallets list by path
func (a *App) RemoveRecentWallet(path string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// Load existing data
	existing := loadRecentWalletsData()

	// Filter out the wallet to remove
	var filtered []recentWalletData
	found := false
	for _, w := range existing {
		if w.Path != path {
			filtered = append(filtered, w)
		} else {
			found = true
		}
	}

	if !found {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not found in recent list",
		}
	}

	// Save filtered list
	saveRecentWalletsData(filtered)

	// Update in-memory list
	simplePaths := make([]string, len(filtered))
	for i, w := range filtered {
		simplePaths[i] = w.Path
	}
	walletManager.recentWallets = simplePaths

	return map[string]interface{}{
		"success": true,
	}
}

// ClearRecentWallets removes all wallets from the recent list
func (a *App) ClearRecentWallets() map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	// Clear the data file
	saveRecentWalletsData([]recentWalletData{})

	// Clear in-memory list
	walletManager.recentWallets = []string{}

	return map[string]interface{}{
		"success": true,
	}
}

func nowUnix() int64 {
	return time.Now().Unix()
}

// GetCurrentWalletPath returns the path of the currently open wallet
func (a *App) GetCurrentWalletPath() string {
	walletManager.RLock()
	defer walletManager.RUnlock()
	if walletManager.isOpen {
		return walletManager.walletPath
	}
	return ""
}

// TrackedToken represents a user-tracked token
type TrackedToken struct {
	SCID        string `json:"scid"`
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	Icon        string `json:"icon,omitempty"`
	Description string `json:"description,omitempty"`
	AddedAt     int64  `json:"addedAt"`
}

// GetTrackedTokens returns the list of user-tracked tokens with balances
func (a *App) GetTrackedTokens() map[string]interface{} {
	// Load tracked tokens from settings
	tokens := loadTrackedTokens()

	// If we have a local wallet open, get balances
	walletManager.RLock()
	localWalletOpen := walletManager.isOpen && walletManager.wallet != nil
	wallet := walletManager.wallet
	walletManager.RUnlock()

	result := make([]map[string]interface{}, 0)

	// Always include native DERO first if wallet is open
	if localWalletOpen {
		result = append(result, map[string]interface{}{
			"scid":    deroSCID,
			"name":    "DERO",
			"symbol":  "DERO",
			"balance": readNativeBalance(wallet),
			"native":  true,
		})
	}

	// For each tracked token, read the cached encrypted balance the wallet
	// engine already maintains. A DERO token balance is an encrypted per-account
	// leaf in the chain balance tree — NOT a plaintext Gnomon SC variable. We do
	// NOT sync the daemon here: OpenWallet registers every tracked token
	// (TokenAdd), and the walletapi background sync_loop refreshes each
	// registered SCID every ~5s, so the cached value is current. Syncing per
	// render would add N blocking daemon round-trips to a UI path (and break the
	// simulator's single-WebSocket constraint). Gnomon is used only to backfill
	// missing name/symbol metadata.
	for _, token := range tokens {
		tokenData := map[string]interface{}{
			"scid":           token.SCID,
			"name":           token.Name,
			"symbol":         token.Symbol,
			"icon":           token.Icon,
			"balance":        uint64(0),
			"native":         false,
			"balanceUnknown": false,
		}

		if localWalletOpen && wallet != nil {
			scidHash := crypto.HashHexToHash(token.SCID)
			// Ensure the wallet tracks this SCID so the background sync_loop
			// keeps it fresh ("already added" is benign).
			_ = wallet.TokenAdd(scidHash)
			tokenData["balance"] = readTokenBalance(wallet, scidHash)
		} else {
			// No open wallet — we genuinely can't know the balance; show "—"
			// rather than a misleading 0.
			tokenData["balanceUnknown"] = true
		}

		// Backfill missing metadata from Gnomon (never balance) for display only.
		// Reuse fetchTokenHeader so this render path gets the same canonical
		// var_header_* keys and sanitizing as the add path. allowIndex is false: the
		// render path must stay cheap and non-blocking, and it deliberately does NOT
		// write back to disk — persistence happens only on the explicit add path
		// (AddTrackedToken / addTrackedTokensBatch), so an attacker who controls a
		// tracked SCID can't poison a still-empty field into permanent storage just
		// by being rendered. A token whose metadata only resolves at render time
		// re-resolves cheaply each render until it's re-added.
		if token.Name == "" || token.Symbol == "" || token.Icon == "" {
			n, s, ic, _ := a.fetchTokenHeader(token.SCID, token.Name, token.Symbol, false)
			tokenData["name"] = n
			tokenData["symbol"] = s
			if token.Icon == "" && ic != "" {
				tokenData["icon"] = ic
			}
		}

		result = append(result, tokenData)
	}

	return map[string]interface{}{
		"success": true,
		"tokens":  result,
		"count":   len(result),
	}
}

// sanitizeIconURL gates the on-chain icon header before it can be persisted or
// rendered. The icon URL is fully attacker-controlled (anyone can deploy an NFA
// with a crafted iconURLHdr) and the portfolio renders it as <img src=…>, so a
// remote URL would fire a silent outbound GET on render — leaking the user's IP
// and online-timing the instant a dust airdrop auto-lands. For a privacy wallet
// that defeats the whole point. We allow ONLY inline data:image/ icons (no
// network fetch — this is also how HOLOGRAM's own base64 icons are encoded) and
// drop every remote scheme; a dropped icon degrades to the ⬡ glyph in the UI.
func sanitizeIconURL(icon string) string {
	if strings.HasPrefix(strings.ToLower(icon), "data:image/") {
		return icon
	}
	return ""
}

// Token text headers are fully attacker-controlled and unbounded on-chain; a
// multi-megabyte value would bloat tracked_tokens.json and every render's parse.
// Names/symbols are short by nature; descriptions get more room.
const (
	tokenNameLimit = 256
	tokenDescLimit = 1024
)

// sanitizeTokenText gates an on-chain text header (name/symbol/description) the way
// sanitizeIconURL gates the icon: the value is attacker-controlled and the portfolio
// renders it directly, so we distrust it. Svelte escapes HTML (no XSS), but raw
// control, bidi-override (U+202E etc.), and zero-width characters still let a crafted
// NFA spoof a well-known token's visible identity or hide characters — so we strip
// them, collapse whitespace, and length-cap to limit runes. Returns "" for an
// all-junk value, which degrades to the existing "Unknown Token"/⬡ fallbacks.
func sanitizeTokenText(s string, limit int) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == utf8.RuneError:
			continue
		case r == '\t' || r == ' ':
			b.WriteRune(' ') // normalize whitespace to a plain space
		case unicode.IsControl(r):
			continue // strips \n \r and other C0/C1 controls
		case unicode.Is(unicode.Bidi_Control, r) || unicode.Is(unicode.Join_Control, r):
			continue // RLO/LRO/PDF and ZWJ/ZWNJ — bidi/zero-width spoofing
		case (r >= '\u200b' && r <= '\u200f') || r == '\u2060' || r == '\ufeff':
			continue // ZW space, LRM/RLM, word joiner, BOM — zero-width spoofing
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) > limit {
		// Cap on a rune boundary, not a byte boundary, so we never split a rune.
		out = string([]rune(out)[:limit])
	}
	return out
}

// fetchTokenHeader pulls an NFA's display metadata from Gnomon's indexed SC
// variables. It reads the canonical Artificer V2 keys (var_header_name/_symbol/
// _icon/_description) first and falls back to the legacy V1 keys (nameHdr/
// symbolHdr/iconURLHdr/descrHdr) — matching Engram's getContractHeader precedence
// — so a contract that publishes only the canonical keys still resolves instead of
// rendering as "Unknown Token". Any passed-in name/symbol (e.g. a manual add) wins
// over the on-chain value. Returned text is passed through sanitizeTokenText
// (length-capped, control/bidi/zero-width stripped) and the icon through
// sanitizeIconURL (data:image only), since every header value is attacker-controlled.
//
// allowIndex controls the on-demand AddSCIDToIndex fallback for an unindexed SCID:
// pass true on the one-time add path (worth a network round-trip to resolve an
// older NFA), false on the per-render read path (must stay cheap and non-blocking —
// the add-time index, plus a one-shot render-time retry that persists, cover it).
func (a *App) fetchTokenHeader(scid, name, symbol string, allowIndex bool) (string, string, string, string) {
	var icon, description string
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return name, symbol, icon, description
	}
	// A caller-supplied name/symbol is authoritative and never overwritten.
	// Otherwise the canonical V2 key (var_header_*) wins over the legacy V1 key
	// (*Hdr) regardless of Gnomon's iteration order: canonical keys assign
	// unconditionally, legacy keys only fill a still-empty field. This mirrors
	// Engram's getContractHeader precedence.
	nameLocked := name != ""
	symbolLocked := symbol != ""
	vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)
	// If the SCID isn't in the local index, Gnomon's fastsync never saw it (e.g. a
	// contract deployed before this node's fastsync start height — common for older
	// NFAs), so it has no variables to read and the token would render "Unknown
	// Token". Pull just this SCID into the index on demand, then re-read — mirroring
	// Engram's getContractHeader, which does the same AddSCIDToIndex-then-read.
	//
	// varstoreonly=true is load-bearing: the indexer early-returns for a SCID already
	// in its validated set, which skips the variable-store refresh. An older NFA can
	// be validated yet have no stored vars (deployed pre-fastsync), so without
	// varstoreonly the re-read below still comes back empty. true forces the var
	// refresh past that early return — matching the value Engram passes.
	if len(vars) == 0 && allowIndex {
		if err := a.gnomonClient.AddSCIDToIndex(scid, true, false); err != nil {
			a.logToConsole(fmt.Sprintf("[Wallet] On-demand index of %s... failed: %v", scid[:16], err))
		} else {
			vars = a.gnomonClient.GetAllSCIDVariableDetails(scid)
		}
	}
	for _, v := range vars {
		key := fmt.Sprintf("%v", v.Key)
		val := fmt.Sprintf("%v", v.Value)
		switch key {
		case "var_header_name":
			if !nameLocked {
				name = sanitizeTokenText(decodeHexString(val), tokenNameLimit)
			}
		case "nameHdr":
			if !nameLocked && name == "" {
				name = sanitizeTokenText(decodeHexString(val), tokenNameLimit)
			}
		case "var_header_symbol":
			if !symbolLocked {
				symbol = sanitizeTokenText(decodeHexString(val), tokenNameLimit)
			}
		case "symbolHdr":
			if !symbolLocked && symbol == "" {
				symbol = sanitizeTokenText(decodeHexString(val), tokenNameLimit)
			}
		case "var_header_icon":
			icon = sanitizeIconURL(decodeHexString(val))
		case "iconURLHdr", "fileURL":
			if icon == "" {
				icon = sanitizeIconURL(decodeHexString(val))
			}
		case "var_header_description":
			description = sanitizeTokenText(decodeHexString(val), tokenDescLimit)
		case "descrHdr":
			if description == "" {
				description = sanitizeTokenText(decodeHexString(val), tokenDescLimit)
			}
		}
	}
	return name, symbol, icon, description
}

// AddTrackedToken adds a token SCID to the tracked list
func (a *App) AddTrackedToken(scid, name, symbol string) map[string]interface{} {
	// Validate SCID format (64 hex chars)
	if len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID format - must be 64 hexadecimal characters",
		}
	}

	// Normalize to lowercase hex so dedupe, storage, and HashHexToHash are
	// consistent regardless of how the user typed the SCID.
	scid = strings.ToLower(scid)

	// Fetch token metadata from Gnomon up front (no shared state, may do I/O) so
	// the tracked-list critical section below stays short. Mirrors Engram's
	// Artificer NFA header fetch: name/symbol plus icon/description when present.
	name, symbol, icon, description := a.fetchTokenHeader(scid, name, symbol, true)

	newToken := TrackedToken{
		SCID:        scid,
		Name:        name,
		Symbol:      symbol,
		Icon:        icon,
		Description: description,
		AddedAt:     time.Now().Unix(),
	}

	// Serialize the dedup-check…append…save so concurrent adds (e.g. the scan's
	// add loop running while the user manually adds one) can't clobber each
	// other's whole-file rewrite.
	trackedTokensMu.Lock()
	tokens := loadTrackedTokens()
	for _, t := range tokens {
		if t.SCID == scid {
			trackedTokensMu.Unlock()
			return map[string]interface{}{
				"success": false,
				"error":   "Token already tracked",
			}
		}
	}
	tokens = append(tokens, newToken)
	saveTrackedTokens(tokens)
	trackedTokensMu.Unlock()

	a.logToConsole(fmt.Sprintf("[Wallet] Added tracked token: %s (%s)", name, scid[:16]+"..."))

	// Register the SCID with the wallet engine and pull its encrypted balance
	// once, so the portfolio shows the real amount immediately rather than
	// waiting for the background sync_loop's next tick. A DERO token balance
	// lives in the encrypted per-account balance tree, fetched via the daemon —
	// not from Gnomon SC variables. TokenAdd also enrolls the SCID in the
	// sync_loop so it stays fresh thereafter. Failure here is non-fatal: the
	// token is still tracked and will resolve on the next loop tick.
	walletManager.RLock()
	wallet := walletManager.wallet
	walletOpen := walletManager.isOpen && wallet != nil
	walletManager.RUnlock()

	if walletOpen {
		scidHash := crypto.HashHexToHash(scid)
		if err := wallet.TokenAdd(scidHash); err != nil {
			// "token already added" is benign; anything else is just logged.
			a.logToConsole(fmt.Sprintf("[Wallet] TokenAdd(%s): %v", scid[:16]+"...", err))
		}
		if _, err := syncAndReadTokenBalance(wallet, scidHash); err != nil {
			a.logToConsole(fmt.Sprintf("[Wallet] Initial balance sync for %s failed: %v", scid[:16]+"...", err))
		}
	}

	return map[string]interface{}{
		"success": true,
		"token":   newToken,
		"message": "Token added to portfolio",
		// Lets the frontend distinguish "named and ready" from "added blind":
		// metadata resolution silently no-ops when Gnomon is off, and the token
		// then renders as "Unknown Token" with no hint as to why.
		"metadataResolved": name != "",
		"gnomonRunning":    a.gnomonClient != nil && a.gnomonClient.IsRunning(),
	}
}

// RefreshTokenMetadata re-resolves a tracked token's on-chain metadata and,
// only when apply is true, persists it to tracked_tokens.json. This is the
// user-triggered escape hatch for a token added while Gnomon was off (or before
// its SCID was indexed): the render path deliberately never writes resolved
// metadata to disk, so without this the entry heals on screen but stays empty
// in storage. apply=false is a pure preview — fetch fresh values (indexing the
// SCID on demand if needed), report what would change, write nothing.
//
// overwriteNames=false keeps the existing Name/Symbol authoritative (fill-empty
// only, same lock rule as fetchTokenHeader); true lets the chain values replace
// them — the explicit opt-in for "I typed the wrong name". In both modes an
// empty fresh value never blanks an existing one.
func (a *App) RefreshTokenMetadata(scid string, apply bool, overwriteNames bool) map[string]interface{} {
	scid = strings.ToLower(scid)
	if len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID format - must be 64 hexadecimal characters",
		}
	}

	trackedTokensMu.Lock()
	tokens := loadTrackedTokens()
	var current *TrackedToken
	for i := range tokens {
		if tokens[i].SCID == scid {
			t := tokens[i]
			current = &t
			break
		}
	}
	trackedTokensMu.Unlock()

	if current == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Token not found in tracked list",
		}
	}

	// Resolve outside the lock — this may do an on-demand AddSCIDToIndex
	// (network round-trip). The wrapper preserves the Gnomon owner row, so
	// re-indexing here is safe for already-indexed SCIDs.
	lockName, lockSymbol := current.Name, current.Symbol
	if overwriteNames {
		lockName, lockSymbol = "", ""
	}
	freshName, freshSymbol, freshIcon, freshDesc := a.fetchTokenHeader(scid, lockName, lockSymbol, true)

	merged := *current
	if freshName != "" {
		merged.Name = freshName
	}
	if freshSymbol != "" {
		merged.Symbol = freshSymbol
	}
	if freshIcon != "" {
		merged.Icon = freshIcon
	}
	if freshDesc != "" {
		merged.Description = freshDesc
	}
	changed := merged.Name != current.Name || merged.Symbol != current.Symbol ||
		merged.Icon != current.Icon || merged.Description != current.Description

	result := map[string]interface{}{
		"success": true,
		"scid":    scid,
		"current": map[string]string{
			"name": current.Name, "symbol": current.Symbol,
			"icon": current.Icon, "description": current.Description,
		},
		"fresh": map[string]string{
			"name": merged.Name, "symbol": merged.Symbol,
			"icon": merged.Icon, "description": merged.Description,
		},
		"changed":       changed,
		"gnomonRunning": a.gnomonClient != nil && a.gnomonClient.IsRunning(),
	}

	if !apply || !changed {
		return result
	}

	// Commit: re-read under the lock so a concurrent add/remove isn't clobbered
	// by our earlier snapshot.
	trackedTokensMu.Lock()
	tokens = loadTrackedTokens()
	updated := false
	for i := range tokens {
		if tokens[i].SCID != scid {
			continue
		}
		if freshName != "" {
			tokens[i].Name = freshName
		}
		if freshSymbol != "" {
			tokens[i].Symbol = freshSymbol
		}
		if freshIcon != "" {
			tokens[i].Icon = freshIcon
		}
		if freshDesc != "" {
			tokens[i].Description = freshDesc
		}
		updated = true
		break
	}
	if updated {
		saveTrackedTokens(tokens)
	}
	trackedTokensMu.Unlock()

	if updated {
		a.logToConsole(fmt.Sprintf("[Wallet] Refreshed token metadata: %s (%s)", merged.Name, scid[:16]+"..."))
	}
	result["updated"] = updated
	return result
}

// addTrackedTokensBatch adds many discovered SCIDs in one pass and returns how
// many were newly tracked. It exists because the scan's auto-add-all-non-zero
// policy can yield a large hit list, and calling AddTrackedToken per hit does an
// O(n) full-file load+rewrite of tracked_tokens.json under the lock for every
// single token — O(n^2) disk churn with the lock held the whole time. Here the
// tracked-list read-modify-write happens ONCE under trackedTokensMu; the
// per-token Gnomon metadata fetch and wallet-engine registration (both I/O,
// neither touches the tracked list) run OUTSIDE the lock. Single-add callers
// keep using AddTrackedToken.
func (a *App) addTrackedTokensBatch(scids []string) int {
	if len(scids) == 0 {
		return 0
	}

	// Pre-resolve metadata for each SCID without holding the tracked-list lock.
	type pending struct {
		token TrackedToken
	}
	candidates := make([]pending, 0, len(scids))
	for _, scid := range scids {
		scid = strings.ToLower(scid)
		if len(scid) != 64 {
			continue
		}
		name, symbol, icon, description := a.fetchTokenHeader(scid, "", "", true)
		candidates = append(candidates, pending{token: TrackedToken{
			SCID:        scid,
			Name:        name,
			Symbol:      symbol,
			Icon:        icon,
			Description: description,
			AddedAt:     time.Now().Unix(),
		}})
	}

	// Single critical section: load once, append all genuinely-new tokens, save
	// once. Collect the SCIDs we actually added so the wallet-engine registration
	// below only runs for new entries.
	trackedTokensMu.Lock()
	tokens := loadTrackedTokens()
	existing := make(map[string]struct{}, len(tokens))
	for _, t := range tokens {
		existing[t.SCID] = struct{}{}
	}
	addedHashes := make([]crypto.Hash, 0, len(candidates))
	addedNames := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if _, dup := existing[c.token.SCID]; dup {
			continue
		}
		existing[c.token.SCID] = struct{}{} // guard against duplicate SCIDs within the batch
		tokens = append(tokens, c.token)
		addedHashes = append(addedHashes, crypto.HashHexToHash(c.token.SCID))
		addedNames = append(addedNames, c.token.Name)
	}
	if len(addedHashes) > 0 {
		saveTrackedTokens(tokens)
	}
	trackedTokensMu.Unlock()

	if len(addedHashes) == 0 {
		return 0
	}

	// Register the new SCIDs with the wallet engine and pull their balances once,
	// outside the tracked-list lock. Failures are non-fatal — the token is tracked
	// and the background sync_loop will resolve it on the next tick.
	walletManager.RLock()
	wallet := walletManager.wallet
	walletOpen := walletManager.isOpen && wallet != nil
	walletManager.RUnlock()

	for i, scidHash := range addedHashes {
		a.logToConsole(fmt.Sprintf("[Wallet] Added tracked token: %s (%s)", addedNames[i], scidHash.String()[:16]+"..."))
		if !walletOpen {
			continue
		}
		if err := wallet.TokenAdd(scidHash); err != nil {
			a.logToConsole(fmt.Sprintf("[Wallet] TokenAdd(%s): %v", scidHash.String()[:16]+"...", err))
		}
		if _, err := syncAndReadTokenBalance(wallet, scidHash); err != nil {
			a.logToConsole(fmt.Sprintf("[Wallet] Initial balance sync for %s failed: %v", scidHash.String()[:16]+"...", err))
		}
	}

	return len(addedHashes)
}

// scanWorkers bounds the concurrency of the token-discovery sweep. Each worker
// does an independent daemon read; a single daemon serves them, so this trades
// off daemon load against wall-clock. Engram uses 50; we stay conservative.
const scanWorkers = 16

// scanBalanceTimeout caps a single per-SCID balance read so a hung daemon call
// can't stall a worker (and thus the whole scan) indefinitely.
const scanBalanceTimeout = 15 * time.Second

// ScanWalletForTokens auto-discovers tokens the open wallet holds and adds the
// non-zero ones to the tracked list, mirroring (and outpacing) Engram's scan.
//
// DERO has no chain-side "list my assets" — encrypted balances are keyed by
// (address, SCID), so discovery is always "resolve a candidate SCID set, then
// check my balance in each." We use Gnomon's full index as that candidate set,
// exactly as Engram does. Tokens already tracked are skipped up front.
//
// Parallelism without a lock — the subtle part. GetDecryptedBalanceAtTopoHeight
// with topoheight == -1 WRITES shared wallet state (account.TopoHeight, the
// encrypted-balance cache, package-global event trackers — daemon_communication.go
// lines 455-477), so concurrent -1 calls race; that write path is exactly what
// balanceMu guards. But every one of those writes is gated on topoheight == -1.
// By pinning a single real topoheight (fetched once below) and passing it to
// every worker, we skip the entire mutating block: the call reduces to an RPC +
// decrypt-with-immutable-key + return, which is genuinely read-only and safe to
// fan out across a worker pool with no balanceMu. Pinning also gives a consistent
// chain snapshot across the whole sweep. Results stream via "wallet:scanProgress"
// / "wallet:scanComplete"; the method returns once the candidate set is known.
func (a *App) ScanWalletForTokens() map[string]interface{} {
	// Re-entrancy guard: only one scan at a time. If we can't flip 0->1 a scan is
	// already running. Ownership of the flag transfers to the worker goroutine
	// once it launches (released in its defer); every early-return path below
	// hands it back via scanLaunched=false.
	if !atomic.CompareAndSwapInt32(&a.scanInFlight, 0, 1) {
		return map[string]interface{}{"success": false, "error": "A token scan is already in progress."}
	}
	scanLaunched := false
	defer func() {
		if !scanLaunched {
			atomic.StoreInt32(&a.scanInFlight, 0)
		}
	}()

	walletManager.RLock()
	wallet := walletManager.wallet
	walletOpen := walletManager.isOpen && wallet != nil
	walletManager.RUnlock()

	if !walletOpen {
		return map[string]interface{}{"success": false, "error": "Open a wallet before scanning for tokens."}
	}

	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{"success": false, "error": "Gnomon is not running. Start it in Settings to scan for tokens."}
	}

	address := wallet.GetAddress().String()

	// Pin the daemon topoheight so every worker reads at one consistent snapshot
	// AND skips the topoheight==-1 shared-state writes (the reason we can run
	// lock-free). A non-positive height means the daemon isn't ready to serve a
	// fixed-height read.
	pinnedTopo := wallet.Get_Daemon_TopoHeight()
	if pinnedTopo <= 0 {
		return map[string]interface{}{"success": false, "error": "Daemon not synced yet — try again once the node is caught up."}
	}

	// Detect partial index coverage. Gnomon only knows about SCIDs up to its last
	// indexed height; if it's still catching up, GetAllOwnersAndSCIDs returns a
	// truncated candidate set and the scan can silently miss tokens the wallet
	// actually holds — a false-negative on the user's own funds. We can't fix the
	// gap mid-scan, but we MUST let the user distinguish "scanned everything, found
	// nothing" from "scanned a partial index." The coverage flag rides the
	// scanComplete event so the frontend can caveat the result.
	coveragePct := 100.0
	partialCoverage := false
	if status := a.gnomonClient.GetStatus(); status != nil {
		indexedH, _ := status["indexed_height"].(int64)
		chainH, _ := status["chain_height"].(int64)
		// Allow a small lag tolerance: a few blocks behind the tip is normal and
		// not worth alarming the user over.
		if chainH > 0 {
			coveragePct = (float64(indexedH) / float64(chainH)) * 100.0
			if chainH-indexedH > 5 {
				partialCoverage = true
			}
		}
	}

	// Build the candidate set from every SCID Gnomon has indexed, minus the ones
	// we already track (no point re-checking known tokens).
	indexed := a.gnomonClient.GetAllOwnersAndSCIDs()
	tracked := make(map[string]struct{})
	for _, t := range loadTrackedTokens() {
		tracked[t.SCID] = struct{}{}
	}

	candidates := make([]string, 0, len(indexed))
	for scid := range indexed {
		scid = strings.ToLower(scid)
		if scid == deroSCID {
			continue // native DERO is always shown, never a "token" to add
		}
		if _, known := tracked[scid]; known {
			continue
		}
		candidates = append(candidates, scid)
	}

	total := len(candidates)
	a.logToConsole(fmt.Sprintf("[Wallet] Token scan started: %d candidate SCIDs (%d indexed, %d already tracked)", total, len(indexed), len(tracked)))

	if total == 0 {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "wallet:scanComplete", map[string]interface{}{
				"found": 0, "added": 0, "scanned": 0, "errors": 0,
				"partial": partialCoverage, "coverage": coveragePct,
			})
		}
		return map[string]interface{}{"success": true, "message": "No new contracts to scan.", "total": 0}
	}

	scanLaunched = true // the goroutine now owns the re-entrancy flag (released in its defer)
	go func() {
		startUnix := time.Now().Unix()

		var (
			mu       sync.Mutex
			hits     = make([]string, 0)
			scanned  int
			errCount int
			added    int
		)

		// Always emit scanComplete, no matter how this goroutine exits — a panic in
		// AddTrackedToken or an app teardown mid-scan must still flip the frontend's
		// `scanning` flag off so the progress bar can't pin forever. Guard on a.ctx
		// (cancelled on shutdown) like every other emit in this file.
		defer func() {
			// Release the re-entrancy guard last, so the next scan can't start until
			// this one's scanComplete has been emitted.
			defer atomic.StoreInt32(&a.scanInFlight, 0)
			if r := recover(); r != nil {
				a.logToConsole(fmt.Sprintf("[Wallet] Token scan goroutine recovered from panic: %v", r))
			}
			if a.ctx != nil {
				runtime.EventsEmit(a.ctx, "wallet:scanComplete", map[string]interface{}{
					"found":      len(hits),
					"added":      added,
					"scanned":    total,
					"errors":     errCount,
					"partial":    partialCoverage,
					"coverage":   coveragePct,
					"durationMs": (time.Now().Unix() - startUnix) * 1000,
				})
			}
		}()

		work := make(chan string)
		var wg sync.WaitGroup

		for w := 0; w < scanWorkers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for scid := range work {
					bal, err := readScanBalance(wallet, crypto.HashHexToHash(scid), address, pinnedTopo)

					mu.Lock()
					scanned++
					if err != nil {
						errCount++
					} else if bal > 0 {
						hits = append(hits, scid)
					}
					// Throttle progress to ~every 25 checks (and the final one) so a
					// large index doesn't flood the event bus. Snapshot the values
					// under the lock, emit AFTER releasing it (EventsEmit may block).
					emit := scanned%25 == 0 || scanned == total
					sScanned, sFound := scanned, len(hits)
					mu.Unlock()

					if emit && a.ctx != nil {
						runtime.EventsEmit(a.ctx, "wallet:scanProgress", map[string]interface{}{
							"scanned": sScanned,
							"total":   total,
							"found":   sFound,
						})
					}
				}
			}()
		}

		for _, scid := range candidates {
			work <- scid
		}
		close(work)
		wg.Wait()

		// Add all hits in one batched pass after the sweep — a single
		// load-modify-save of tracked_tokens.json under the lock, with per-token
		// Gnomon metadata backfill and wallet-engine registration done outside it.
		added = a.addTrackedTokensBatch(hits)

		if errCount > 0 {
			a.logToConsole(fmt.Sprintf("[Wallet] Token scan: %d SCIDs errored during balance check (transient daemon issue?) — re-scan to retry", errCount))
		}
		a.logToConsole(fmt.Sprintf("[Wallet] Token scan complete: %d held, %d added, %d errored (%d scanned)", len(hits), added, errCount, total))
		// scanComplete is emitted by the deferred handler above.
	}()

	return map[string]interface{}{"success": true, "message": "Scan started", "total": total}
}

// readScanBalance reads a single SCID's decrypted balance straight from the
// daemon at a PINNED topoheight (never -1), with a timeout so a hung call can't
// pin a worker. The pinned height skips GetDecryptedBalanceAtTopoHeight's
// topoheight==-1 shared-state writes, so this touches no shared wallet state and
// is safe to call concurrently without balanceMu (see ScanWalletForTokens). On
// timeout the inner goroutine is orphaned but harmless: the channel is buffered,
// the send never blocks, and with a pinned height the late call mutates nothing.
func readScanBalance(wallet *walletapi.Wallet_Disk, scid crypto.Hash, address string, topo int64) (uint64, error) {
	type res struct {
		bal uint64
		err error
	}
	ch := make(chan res, 1)
	go func() {
		bal, _, err := wallet.GetDecryptedBalanceAtTopoHeight(scid, topo, address)
		ch <- res{bal, err}
	}()
	select {
	case r := <-ch:
		return r.bal, r.err
	case <-time.After(scanBalanceTimeout):
		return 0, fmt.Errorf("balance read timed out for %s", scid.String()[:16])
	}
}

// RemoveTrackedToken removes a token from the tracked list
func (a *App) RemoveTrackedToken(scid string) map[string]interface{} {
	// loadTrackedTokens normalizes stored SCIDs to lowercase, so match on the
	// same casing.
	scid = strings.ToLower(scid)

	trackedTokensMu.Lock()
	tokens := loadTrackedTokens()
	newTokens := make([]TrackedToken, 0)
	found := false

	for _, t := range tokens {
		if t.SCID != scid {
			newTokens = append(newTokens, t)
		} else {
			found = true
		}
	}

	if !found {
		trackedTokensMu.Unlock()
		return map[string]interface{}{
			"success": false,
			"error":   "Token not found in tracked list",
		}
	}

	saveTrackedTokens(newTokens)
	trackedTokensMu.Unlock()

	return map[string]interface{}{
		"success": true,
		"message": "Token removed from portfolio",
	}
}

// TransferToken sends a token (non-native asset) to another address
func (a *App) TransferToken(scid, destination string, amount uint64, password string, ringsize uint64) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		// Try to reopen with password
		if walletManager.walletPath != "" && password != "" {
			var err error
			walletManager.wallet, err = walletapi.Open_Encrypted_Wallet(walletManager.walletPath, password)
			if err != nil {
				return map[string]interface{}{"success": false, "error": FriendlyError(err), "technicalError": err.Error()}
			}
			walletManager.isOpen = true
			walletManager.wallet.SetNetwork(!a.IsInSimulatorMode())
			endpointRaw := "127.0.0.1:10102"
			if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
				endpointRaw = ep
			}
			walletManager.wallet.SetDaemonAddress(normalizeDaemonEndpointForWallet(endpointRaw))
			a.ensureWalletDaemonConnectivity(endpointRaw)
			walletManager.wallet.SetOnlineMode()
		} else {
			return map[string]interface{}{"success": false, "error": "Please open a wallet first."}
		}
	}

	wallet := walletManager.wallet

	a.logToConsole(fmt.Sprintf("[Transfer] Transferring %d units of token %s to %s", amount, scid[:16]+"...", destination[:16]+"..."))

	// Build transfer with asset (token). For a plain wallet-to-wallet token send,
	// the recipient is credited from Amount on the named SCID — Burn must be 0.
	// Burn is value attached to a smart-contract call (the SC then credits it);
	// with no SC on the other end, Amount:0/Burn:amount would debit the sender and
	// credit no one, destroying the tokens. Engram's transferAsset uses Amount too.
	transfers := []rpc.Transfer{
		{
			Destination: destination,
			Amount:      amount, // token amount the recipient receives (on this SCID)
			Burn:        0,
			SCID:        crypto.HashHexToHash(scid),
		},
	}

	if ringsize < 2 {
		ringsize = 16
	}
	tx, err := wallet.TransferPayload0(transfers, ringsize, false, rpc.Arguments{}, 0, false)
	if err != nil {
		return ErrorResponse(err)
	}

	if err := wallet.SendTransaction(tx); err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Token transfer broadcast failed: %s", err.Error()))
		return map[string]interface{}{
			"success":        false,
			"error":          fmt.Sprintf("Token transfer built but failed to broadcast: %s", FriendlyError(err)),
			"technicalError": err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Token transfer successful! TXID: %s (ringsize=%d)", tx.GetHash().String(), ringsize))

	return map[string]interface{}{
		"success": true,
		"txid":    tx.GetHash().String(),
		"message": "Token transfer sent successfully",
	}
}

// Helper functions for tracked tokens storage
func loadTrackedTokens() []TrackedToken {
	configFile := filepath.Join(getDatashardsDir(), "settings", "tracked_tokens.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return []TrackedToken{}
	}

	var tokens []TrackedToken
	if err := json.Unmarshal(data, &tokens); err != nil {
		return []TrackedToken{}
	}

	// Normalize stored SCIDs to lowercase so dedupe and lookups are consistent
	// regardless of how a legacy entry was cased when first saved.
	for i := range tokens {
		tokens[i].SCID = strings.ToLower(tokens[i].SCID)
	}

	return tokens
}

func saveTrackedTokens(tokens []TrackedToken) {
	configDir := filepath.Join(getDatashardsDir(), "settings")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		log.Printf("Failed to create settings directory: %v", err)
		return
	}

	data, err := json.Marshal(tokens)
	if err != nil {
		log.Printf("Failed to marshal tracked tokens: %v", err)
		return
	}

	if err := os.WriteFile(filepath.Join(configDir, "tracked_tokens.json"), data, 0600); err != nil {
		log.Printf("Failed to save tracked tokens: %v", err)
	}
}

// ============================================
// ADDRESS BOOK FUNCTIONS
// ============================================

// AddressBookEntry represents a saved contact
type AddressBookEntry struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Address   string `json:"address"`
	Notes     string `json:"notes"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// GetAddressBook returns all saved contacts
func (a *App) GetAddressBook() map[string]interface{} {
	contacts := loadAddressBook()
	return map[string]interface{}{
		"success":  true,
		"contacts": contacts,
		"count":    len(contacts),
	}
}

// AddContact adds a new contact to the address book
func (a *App) AddContact(label, address, notes string) map[string]interface{} {
	// Validate address format
	if !strings.HasPrefix(address, "dero1") && !strings.HasPrefix(address, "deto1") {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid DERO address format",
		}
	}

	if label == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Label is required",
		}
	}

	contacts := loadAddressBook()

	// Check for duplicate address
	for _, c := range contacts {
		if c.Address == address {
			return map[string]interface{}{
				"success": false,
				"error":   "Address already exists in address book",
			}
		}
	}

	// Generate unique ID
	id := fmt.Sprintf("contact_%d", time.Now().UnixNano())

	newContact := AddressBookEntry{
		ID:        id,
		Label:     label,
		Address:   address,
		Notes:     notes,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}

	contacts = append(contacts, newContact)
	saveAddressBook(contacts)

	a.logToConsole(fmt.Sprintf("[AddressBook] Added contact: %s", label))

	return map[string]interface{}{
		"success": true,
		"contact": newContact,
		"message": "Contact added successfully",
	}
}

// UpdateContact updates an existing contact
func (a *App) UpdateContact(id, label, address, notes string) map[string]interface{} {
	contacts := loadAddressBook()
	found := false

	for i, c := range contacts {
		if c.ID == id {
			contacts[i].Label = label
			contacts[i].Address = address
			contacts[i].Notes = notes
			contacts[i].UpdatedAt = time.Now().Unix()
			found = true
			break
		}
	}

	if !found {
		return map[string]interface{}{
			"success": false,
			"error":   "Contact not found",
		}
	}

	saveAddressBook(contacts)

	return map[string]interface{}{
		"success": true,
		"message": "Contact updated successfully",
	}
}

// DeleteContact removes a contact from the address book
func (a *App) DeleteContact(id string) map[string]interface{} {
	contacts := loadAddressBook()
	newContacts := make([]AddressBookEntry, 0)
	found := false

	for _, c := range contacts {
		if c.ID != id {
			newContacts = append(newContacts, c)
		} else {
			found = true
		}
	}

	if !found {
		return map[string]interface{}{
			"success": false,
			"error":   "Contact not found",
		}
	}

	saveAddressBook(newContacts)

	return map[string]interface{}{
		"success": true,
		"message": "Contact deleted successfully",
	}
}

// Helper functions for address book storage
func loadAddressBook() []AddressBookEntry {
	configFile := filepath.Join(getDatashardsDir(), "settings", "address_book.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return []AddressBookEntry{}
	}

	var contacts []AddressBookEntry
	if err := json.Unmarshal(data, &contacts); err != nil {
		return []AddressBookEntry{}
	}

	return contacts
}

func saveAddressBook(contacts []AddressBookEntry) {
	configDir := filepath.Join(getDatashardsDir(), "settings")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		log.Printf("Failed to create settings directory: %v", err)
		return
	}

	data, err := json.Marshal(contacts)
	if err != nil {
		log.Printf("Failed to marshal address book: %v", err)
		return
	}

	if err := os.WriteFile(filepath.Join(configDir, "address_book.json"), data, 0600); err != nil {
		log.Printf("Failed to save address book: %v", err)
	}
}

// ============================================
// CHANGE WALLET PASSWORD
// ============================================

// ChangeWalletPassword changes the password for the currently open wallet
// Requires current password for verification before changing
func (a *App) ChangeWalletPassword(currentPassword, newPassword string) map[string]interface{} {
	walletManager.Lock()
	defer walletManager.Unlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	if currentPassword == "" || newPassword == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Current and new passwords are required",
		}
	}

	if len(newPassword) < 1 {
		return map[string]interface{}{
			"success": false,
			"error":   "New password cannot be empty",
		}
	}

	if !walletManager.wallet.Check_Password(currentPassword) {
		a.logToConsole("[ERR] Password verification failed")
		return map[string]interface{}{
			"success": false,
			"error":   "Current password is incorrect",
		}
	}

	err := walletManager.wallet.Set_Encrypted_Wallet_Password(newPassword)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Failed to change password: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole("[OK] Wallet password changed successfully")

	return map[string]interface{}{
		"success": true,
		"message": "Wallet password changed successfully",
	}
}

// ============================================
// TRANSACTION LABELS
// ============================================

// TransactionLabel represents a user-defined label for a transaction
type TransactionLabel struct {
	TXID      string `json:"txid"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// SetTransactionLabel adds or updates a label for a transaction
func (a *App) SetTransactionLabel(txid, label string) map[string]interface{} {
	if txid == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction ID is required",
		}
	}

	// Load existing labels
	labels := loadTransactionLabels()

	now := time.Now().Unix()

	// Check if label exists for this TXID
	found := false
	for i, l := range labels {
		if l.TXID == txid {
			if label == "" {
				// Remove label if empty
				labels = append(labels[:i], labels[i+1:]...)
			} else {
				// Update existing label
				labels[i].Label = label
				labels[i].UpdatedAt = now
			}
			found = true
			break
		}
	}

	// Add new label if not found and label is not empty
	if !found && label != "" {
		labels = append(labels, TransactionLabel{
			TXID:      txid,
			Label:     label,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	// Save labels
	saveTransactionLabels(labels)

	if label == "" {
		a.logToConsole(fmt.Sprintf("[TX] Removed label for transaction %s", txid[:16]+"..."))
	} else {
		a.logToConsole(fmt.Sprintf("[TX] Set label for transaction %s: %s", txid[:16]+"...", label))
	}

	return map[string]interface{}{
		"success": true,
		"message": "Transaction label saved",
	}
}

// GetTransactionLabel retrieves the label for a specific transaction
func (a *App) GetTransactionLabel(txid string) map[string]interface{} {
	if txid == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction ID is required",
		}
	}

	labels := loadTransactionLabels()

	for _, l := range labels {
		if l.TXID == txid {
			return map[string]interface{}{
				"success": true,
				"label":   l.Label,
				"txid":    l.TXID,
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"label":   "",
		"txid":    txid,
	}
}

// GetAllTransactionLabels returns all transaction labels
func (a *App) GetAllTransactionLabels() map[string]interface{} {
	labels := loadTransactionLabels()

	// Convert to map for easy lookup
	labelMap := make(map[string]string)
	for _, l := range labels {
		labelMap[l.TXID] = l.Label
	}

	return map[string]interface{}{
		"success": true,
		"labels":  labelMap,
		"count":   len(labels),
	}
}

// DeleteTransactionLabel removes a label for a transaction
func (a *App) DeleteTransactionLabel(txid string) map[string]interface{} {
	return a.SetTransactionLabel(txid, "") // Setting empty label removes it
}

// Helper functions for transaction labels storage
func loadTransactionLabels() []TransactionLabel {
	configFile := filepath.Join(getDatashardsDir(), "settings", "transaction_labels.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return []TransactionLabel{}
	}

	var labels []TransactionLabel
	if err := json.Unmarshal(data, &labels); err != nil {
		return []TransactionLabel{}
	}

	return labels
}

func saveTransactionLabels(labels []TransactionLabel) {
	configDir := filepath.Join(getDatashardsDir(), "settings")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		log.Printf("Failed to create settings directory: %v", err)
		return
	}

	data, err := json.Marshal(labels)
	if err != nil {
		log.Printf("Failed to marshal transaction labels: %v", err)
		return
	}

	if err := os.WriteFile(filepath.Join(configDir, "transaction_labels.json"), data, 0600); err != nil {
		log.Printf("Failed to save transaction labels: %v", err)
	}
}

// getTransactionLabelsMap returns a map of txid -> label for quick lookup
func getTransactionLabelsMap() map[string]string {
	labels := loadTransactionLabels()
	labelMap := make(map[string]string)
	for _, l := range labels {
		labelMap[l.TXID] = l.Label
	}
	return labelMap
}

// ============================================
// MESSAGE SIGNING FUNCTIONS
// ============================================

// SignMessage signs a message with the wallet's private key
// Returns a PEM-encoded signature that can be verified
func (a *App) SignMessage(message string) map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	if message == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Message cannot be empty",
		}
	}

	wallet := walletManager.wallet

	// Sign the message - returns PEM encoded signature
	signature := wallet.SignData([]byte(message))
	if signature == nil || len(signature) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to sign message",
		}
	}

	address := wallet.GetAddress().String()

	a.logToConsole("[Wallet] Message signed successfully")

	return map[string]interface{}{
		"success":   true,
		"signature": string(signature), // PEM encoded string
		"address":   address,
		"message":   message,
	}
}

// VerifySignature verifies a PEM-encoded signed message
// The signature parameter should be the full PEM block from SignMessage
func (a *App) VerifySignature(signedData string) map[string]interface{} {
	if signedData == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Signed data cannot be empty",
		}
	}

	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	wallet := walletManager.wallet

	// CheckSignature takes the PEM data and returns signer, message, error
	signer, message, err := wallet.CheckSignature([]byte(signedData))
	if err != nil {
		return map[string]interface{}{
			"success": true,
			"valid":   false,
			"error":   fmt.Sprintf("Verification failed: %v", err),
		}
	}

	a.logToConsole("OK Signature verified successfully")

	return map[string]interface{}{
		"success": true,
		"valid":   true,
		"signer":  signer.String(),
		"message": string(message),
	}
}

// ============================================
// WALLET REGISTRATION FUNCTIONS
// ============================================

// registrationState tracks the PoW registration process
type registrationState struct {
	sync.RWMutex
	inProgress bool
	pending    bool
	pendingTx  string
	pendingAt  time.Time
	hashCount  uint64
	startTime  time.Time
	cancelCh   chan struct{}
}

var regState = &registrationState{}

// GetRegistrationStatus returns whether the wallet is registered on-chain
// In DERO, a wallet address doesn't exist on the blockchain until it either:
// 1. Receives its first transaction (automatic registration)
// 2. Submits a PoW registration transaction (manual registration)
func (a *App) GetRegistrationStatus() map[string]interface{} {
	walletManager.RLock()
	defer walletManager.RUnlock()

	if !walletManager.isOpen || walletManager.wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	wallet := walletManager.wallet

	// Get registration topoheight - negative means not registered
	regHeight := wallet.Get_Registration_TopoHeight()
	isRegistered := regHeight >= 0

	// Check if registration is in progress or awaiting confirmation.
	regState.Lock()
	if isRegistered && regState.pending {
		regState.pending = false
		regState.pendingTx = ""
		regState.pendingAt = time.Time{}
	}
	inProgress := regState.inProgress
	pending := regState.pending && !isRegistered
	pendingTx := regState.pendingTx
	hashCount := regState.hashCount
	var elapsedSeconds float64
	if inProgress {
		elapsedSeconds = time.Since(regState.startTime).Seconds()
	}
	var pendingSeconds float64
	if pending && !regState.pendingAt.IsZero() {
		pendingSeconds = time.Since(regState.pendingAt).Seconds()
	}
	regState.Unlock()

	result := map[string]interface{}{
		"success":              true,
		"isRegistered":         isRegistered,
		"registrationHeight":   regHeight,
		"registrationProgress": inProgress,
		"registrationPending":  pending,
	}

	if inProgress {
		result["hashCount"] = hashCount
		result["elapsedSeconds"] = elapsedSeconds
		if elapsedSeconds > 0 {
			result["hashRate"] = float64(hashCount) / elapsedSeconds
		}
	}

	if pending {
		result["registrationTxid"] = pendingTx
		result["pendingSeconds"] = pendingSeconds
		result["message"] = "Registration TX broadcast. Waiting for blockchain confirmation."
	} else if !isRegistered {
		result["message"] = "Wallet address not yet on-chain. Run PoW registration first, then receive DERO."
	} else {
		result["message"] = "Wallet is registered on-chain"
	}

	return result
}

// RegisterWallet starts the PoW registration process for an unregistered wallet
// This is a CPU-intensive process that can take up to 120 minutes.
// The wallet must find a registration TX hash that starts with 3 zero bytes.
func (a *App) RegisterWallet() map[string]interface{} {
	walletManager.RLock()
	if !walletManager.isOpen || walletManager.wallet == nil {
		walletManager.RUnlock()
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}
	wallet := walletManager.wallet
	walletManager.RUnlock()

	// Check if already registered
	if wallet.Get_Registration_TopoHeight() >= 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet is already registered on-chain",
		}
	}

	// Check if registration is already in progress
	regState.Lock()
	if regState.inProgress {
		regState.Unlock()
		return map[string]interface{}{
			"success": false,
			"error":   "Registration is already in progress",
		}
	}

	// Start registration
	regState.inProgress = true
	regState.pending = false
	regState.pendingTx = ""
	regState.pendingAt = time.Time{}
	regState.hashCount = 0
	regState.startTime = time.Now()
	regState.cancelCh = make(chan struct{})
	cancelCh := regState.cancelCh
	regState.Unlock()

	a.logToConsole("[REGISTER] Starting PoW registration process...")
	a.logToConsole("[REGISTER] This can take up to 120 minutes. Please be patient.")

	// Emit event to frontend
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "wallet:registration_started", map[string]interface{}{
			"message": "Registration started. This can take up to 120 minutes...",
		})
	}

	// Run registration in background using multiple CPU threads
	go func() {
		defer func() {
			regState.Lock()
			regState.inProgress = false
			regState.Unlock()
		}()

		numThreads := goruntime.GOMAXPROCS(0) - 1 // Use all available cores minus one, like Engram
		if numThreads < 2 {
			numThreads = 2 // Minimum 2 threads
		}
		a.logToConsole(fmt.Sprintf("[REGISTER] Starting PoW with %d threads (CPU cores: %d)", numThreads, goruntime.NumCPU()))
		doneCh := make(chan struct{}) // Signals that registration is complete
		var doneOnce sync.Once        // Ensure we only complete once
		var wg sync.WaitGroup

		for i := 0; i < numThreads; i++ {
			wg.Add(1)
			go func(threadID int) {
				defer wg.Done()
				for {
					select {
					case <-cancelCh:
						return
					case <-doneCh:
						return
					default:
						// Check if wallet is still open
						walletManager.RLock()
						w := walletManager.wallet
						walletManager.RUnlock()
						if w == nil {
							return
						}

						// Generate a registration TX and check if hash meets difficulty
						regTx := w.GetRegistrationTX()
						hash := regTx.GetHash()

						regState.Lock()
						regState.hashCount++
						count := regState.hashCount
						regState.Unlock()

						// Log progress every 10000 hashes
						if count%10000 == 0 {
							a.logToConsole(fmt.Sprintf("[REGISTER] PoW progress: %d hashes computed...", count))
							if a.ctx != nil {
								runtime.EventsEmit(a.ctx, "wallet:registration_progress", map[string]interface{}{
									"hashCount": count,
									"elapsed":   time.Since(regState.startTime).Seconds(),
								})
							}
						}

						// Check if hash meets the difficulty requirement (3 leading zero bytes)
						if hash[0] == 0 && hash[1] == 0 && hash[2] == 0 {
							// Found a valid hash! Send the transaction immediately before returning
							doneOnce.Do(func() {
								close(doneCh) // Signal other threads to stop

								a.logToConsole(fmt.Sprintf("[REGISTER] PoW solved! Hash: %x", hash))

								// Send the transaction RIGHT NOW while we have the valid TX
								err := w.SendTransaction(regTx)
								if err != nil {
									regState.Lock()
									regState.pending = false
									regState.pendingTx = ""
									regState.pendingAt = time.Time{}
									regState.Unlock()
									a.logToConsole(fmt.Sprintf("[REGISTER] Failed to broadcast registration TX: %v", err))
									if a.ctx != nil {
										runtime.EventsEmit(a.ctx, "wallet:registration_failed", map[string]interface{}{
											"error": err.Error(),
										})
									}
									return
								}

								txid := regTx.GetHash().String()
								regState.Lock()
								regState.pending = true
								regState.pendingTx = txid
								regState.pendingAt = time.Now()
								regState.Unlock()

								a.logToConsole(fmt.Sprintf("[REGISTER] Registration TX sent! TXID: %s", txid))
								a.logToConsole("[REGISTER] Waiting for blockchain confirmation...")

								// Emit pending state to frontend
								if a.ctx != nil {
									runtime.EventsEmit(a.ctx, "wallet:registration_pending", map[string]interface{}{
										"txid":    txid,
										"message": "Registration TX broadcast. Waiting for confirmation...",
									})
								}

								// Poll for confirmation - the TX needs to be included in a block
								go func() {
									maxAttempts := 30 // Try for ~90 seconds (30 * 3s)
									for attempt := 1; attempt <= maxAttempts; attempt++ {
										time.Sleep(3 * time.Second)

										// Check if wallet is still open
										walletManager.RLock()
										wallet := walletManager.wallet
										walletManager.RUnlock()
										if wallet == nil {
											a.logToConsole("[REGISTER] Wallet closed during confirmation wait")
											return
										}

										// Sync and check registration height
										_ = wallet.Sync_Wallet_Memory_With_Daemon()
										regHeight := wallet.Get_Registration_TopoHeight()

										if regHeight >= 0 {
											regState.Lock()
											regState.pending = false
											regState.pendingTx = ""
											regState.pendingAt = time.Time{}
											regState.Unlock()
											a.logToConsole(fmt.Sprintf("[REGISTER] Registration confirmed at height %d!", regHeight))
											if a.ctx != nil {
												runtime.EventsEmit(a.ctx, "wallet:registration_complete", map[string]interface{}{
													"txid":    txid,
													"message": "Registration confirmed! Your wallet is now on-chain.",
												})
											}
											return
										}

										if attempt%5 == 0 {
											a.logToConsole(fmt.Sprintf("[REGISTER] Still waiting for confirmation... (attempt %d/%d)", attempt, maxAttempts))
										}
									}

									// If we get here, confirmation didn't happen in time
									// The TX might still be pending in the mempool
									a.logToConsole("[REGISTER] Confirmation taking longer than expected. TX is in mempool, will be confirmed soon.")
									if a.ctx != nil {
										runtime.EventsEmit(a.ctx, "wallet:registration_pending", map[string]interface{}{
											"txid":    txid,
											"message": "Registration TX sent! It may take a few more blocks to confirm.",
										})
									}
								}()
							})
							return
						}
					}
				}
			}(i)
		}

		// Wait for either completion or cancellation
		select {
		case <-doneCh:
			// Registration completed successfully
			wg.Wait()
		case <-cancelCh:
			wg.Wait()
			a.logToConsole("[REGISTER] Registration cancelled")
			if a.ctx != nil {
				runtime.EventsEmit(a.ctx, "wallet:registration_cancelled", map[string]interface{}{
					"message": "Registration was cancelled",
				})
			}
		}
	}()

	return map[string]interface{}{
		"success": true,
		"message": "Registration started in background. This can take up to 120 minutes.",
	}
}

// CancelRegistration stops the PoW registration process if it's running
func (a *App) CancelRegistration() map[string]interface{} {
	regState.Lock()
	defer regState.Unlock()

	if !regState.inProgress {
		return map[string]interface{}{
			"success": false,
			"error":   "No registration in progress",
		}
	}

	close(regState.cancelCh)
	regState.inProgress = false
	regState.pending = false
	regState.pendingTx = ""
	regState.pendingAt = time.Time{}

	a.logToConsole("[REGISTER] Registration cancelled by user")

	return map[string]interface{}{
		"success": true,
		"message": "Registration cancelled",
	}
}
