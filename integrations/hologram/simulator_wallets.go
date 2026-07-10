package main

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
)

// ================== Constants ==================

const (
	// SimulatorWalletDir is the subdirectory for simulator data
	SimulatorWalletDir = "simulator"
	// TestWalletPassword is empty like original DERO simulator
	TestWalletPassword = ""
	// TestWalletRPCPortBase is the base port for test wallet RPC
	TestWalletRPCPortBase = 30000
)

// ================== Pre-seeded Wallet Seeds ==================

// SimulatorWalletSeeds are the pre-defined seeds from the original DERO simulator
// These are the same seeds everyone gets when running the simulator
// This ensures consistency across all simulator instances
var SimulatorWalletSeeds = []string{
	"171eeaa899e360bf1a8ada7627aaea9fdad7992463581d935a8838f16b1ff51a",
	"193faf64d79e9feca5fce8b992b4bb59b86c50f491e2dc475522764ca6666b6b",
	"2e49383ac5c938c268921666bccfcb5f0c4d43cd3ed125c6c9e72fc5620bc79b",
	"1c8ee58431e21d1ef022ccf1f53fec36f5e5851d662a3dd96ced3fc155445120",
	"19182604625563f3ff913bb8fb53b0ade2e0271ca71926edb98c8e39f057d557",
	"2a3beb8a57baa096512e85902bb5f1833f1f37e79f75227bbf57c4687bfbb002",
	"055e43ebff20efff612ba6f8128caf990f2bf89aeea91584e63179b9d43cd3ab",
	"2ccb7fc12e867796dd96e246aceff3fea1fdf78a28253c583017350034c31c81",
	"279533d87cc4c637bf853e630480da4ee9d4390a282270d340eac52a391fd83d",
	"03bae8b71519fe8ac3137a3c77d2b6a164672c8691f67bd97548cb6c6f868c67",
	"2b9022d0c5ee922439b0d67864faeced65ebce5f35d26e0ee0746554d395eb88",
	"1a63d5cf9955e8f3d6cecde4c9ecbd538089e608741019397824dc6a2e0bfcc1",
	"10900d25e7dc0cec35fcca9161831a02cb7ed513800368529ba8944eeca6e949",
	"2af6630905d73ee40864bd48339f297908a0731a6c4c6fa0a27ea574ac4e4733",
	"2ac9a8984c988fcb54b261d15bc90b5961d673bffa5ff41c8250c7e262cbd606",
	"040572cec23e6df4f686192b776c197a50591836a3dd02ba2e4a7b7474382ccd",
	"2b2b029cfbc5d08b5d661e6fa444102d387780bec088f4dd41a4a537bf9762af",
	"1812298da90ded6457b2a20fd52d09f639584fb470c715617db13959927be7f8",
	"1eee334e1f533aa1ac018124cf3d5efa20e52f54b05e475f6f2cff3476b4a92f",
	"2c34e7978ce249aebed33e14cdd5177921ecd78fbe58d33bbec21f22b80af7a5",
	"083e7fe96e8415ea119ec6c4d0ebe233e86b53bd4e2f7598505317efc23ae34b",
	"0fd7f8db0ed6cbe3bf300258619d8d4a2ff8132ef3c896f6e3fa65a6c92bdf9a",
}

// ================== TestWallet Struct ==================

// TestWallet represents a pre-seeded test wallet
type TestWallet struct {
	Index      int                    `json:"index"`
	Seed       string                 `json:"seed"`
	Address    string                 `json:"address"`
	Balance    uint64                 `json:"balance"`
	Locked     uint64                 `json:"locked"`
	Registered bool                   `json:"registered"`
	RPCPort    int                    `json:"rpcPort"`
	wallet     *walletapi.Wallet_Disk // internal, not exposed to JSON
}

// ================== SimulatorWalletManager ==================

// SimulatorWalletManager manages all pre-seeded test wallets for simulator mode
// This replaces the old separate TestWalletManager and SimulatorWalletManager
type SimulatorWalletManager struct {
	sync.RWMutex
	wallets    []*TestWallet
	walletsDir string
	isSetup    bool
	logFunc    func(string)
}

// NewSimulatorWalletManager creates a new simulator wallet manager
func NewSimulatorWalletManager(logFunc func(string)) *SimulatorWalletManager {
	return &SimulatorWalletManager{
		wallets: make([]*TestWallet, 0, len(SimulatorWalletSeeds)),
		logFunc: logFunc,
	}
}

// log helper
func (swm *SimulatorWalletManager) log(msg string) {
	if swm.logFunc != nil {
		swm.logFunc(msg)
	}
}

// disconnectWalletAPI properly closes the walletapi websocket connection
// CRITICAL: The simulator daemon can only handle ONE websocket at a time.
// Just setting walletapi.Connected = false doesn't close the actual websocket!
// This causes "websocket: close 1006 (abnormal closure)" errors when tela library
// tries to create its own connection.
func disconnectWalletAPI() {
	// Get the RPC client which holds the websocket connection
	rpcClient := walletapi.GetRPCClient()
	if rpcClient != nil && rpcClient.WS != nil {
		// Close the actual websocket connection
		rpcClient.WS.Close()
	}
	// Mark as disconnected
	walletapi.Connected = false
	// Give the daemon time to release the connection
	time.Sleep(100 * time.Millisecond)
}

// ================== Directory Management ==================

// GetWalletsDir returns the directory for test wallets
func (swm *SimulatorWalletManager) GetWalletsDir(baseDir string) string {
	return filepath.Join(baseDir, SimulatorWalletDir, "test_wallets")
}

// ================== Wallet Setup ==================

// SetupWallets creates all 22 pre-seeded test wallets
// This matches the original DERO simulator behavior
func (swm *SimulatorWalletManager) SetupWallets(baseDir string) error {
	swm.Lock()
	defer swm.Unlock()

	if swm.isSetup {
		swm.log("[INFO] Test wallets already set up")
		return nil
	}

	// CRITICAL: Set globals for simulator mode BEFORE creating wallets
	// The wallet creation uses globals to determine address prefixes
	// InitNetwork() sets Config based on --testnet flag
	globals.Arguments["--simulator"] = true
	globals.Arguments["--testnet"] = true
	globals.InitNetwork()

	swm.walletsDir = swm.GetWalletsDir(baseDir)

	// Create wallets directory
	if err := os.MkdirAll(swm.walletsDir, 0755); err != nil {
		return fmt.Errorf("failed to create test wallets directory: %v", err)
	}

	swm.log(fmt.Sprintf("[WALLET] Setting up %d pre-seeded test wallets...", len(SimulatorWalletSeeds)))

	// Create each wallet from its seed
	for i, seed := range SimulatorWalletSeeds {
		wallet, err := swm.createWalletFromSeed(i, seed)
		if err != nil {
			swm.log(fmt.Sprintf("[ERR] Failed to create test wallet %d: %v", i, err))
			continue
		}
		swm.wallets = append(swm.wallets, wallet)
		swm.log(fmt.Sprintf("[OK] Test wallet %d: %s", i, wallet.Address[:20]+"..."))
	}

	swm.isSetup = true
	swm.log(fmt.Sprintf("[OK] Created %d test wallets", len(swm.wallets)))
	return nil
}

// createWalletFromSeed creates a single wallet from a hex seed
func (swm *SimulatorWalletManager) createWalletFromSeed(index int, seedHex string) (*TestWallet, error) {
	// Decode seed from hex
	seedRaw, err := hex.DecodeString(seedHex)
	if err != nil || len(seedHex) >= 65 {
		return nil, fmt.Errorf("invalid seed: %v", err)
	}

	// Wallet filename
	filename := filepath.Join(swm.walletsDir, fmt.Sprintf("wallet_%d.db", index))

	// Delete existing wallet file to ensure fresh state
	os.Remove(filename)

	// Create wallet from seed
	wallet, err := walletapi.Create_Encrypted_Wallet(filename, TestWalletPassword, new(crypto.BNRed).SetBytes(seedRaw))
	if err != nil {
		return nil, fmt.Errorf("failed to create wallet: %v", err)
	}

	// Set network mode (not mainnet for simulator)
	wallet.SetNetwork(false)

	// Save wallet
	wallet.Save_Wallet()

	address := wallet.GetAddress().String()

	testWallet := &TestWallet{
		Index:      index,
		Seed:       seedHex,
		Address:    address,
		Balance:    0,
		Locked:     0,
		Registered: false,
		RPCPort:    TestWalletRPCPortBase + index,
		wallet:     wallet,
	}

	return testWallet, nil
}

// ================== Wallet Registration ==================

// RegisterAllWallets registers all test wallets on the blockchain
func (swm *SimulatorWalletManager) RegisterAllWallets(daemonEndpoint string) error {
	swm.Lock()
	defer swm.Unlock()

	if len(swm.wallets) == 0 {
		return fmt.Errorf("no test wallets to register")
	}

	swm.log(fmt.Sprintf("[WALLET] Registering %d test wallets on blockchain...", len(swm.wallets)))

	// CRITICAL: Initialize globals for simulator mode
	// InitNetwork() sets Config based on --testnet flag
	globals.Arguments["--simulator"] = true
	globals.Arguments["--testnet"] = true
	globals.InitNetwork()

	// Connect walletapi for registration
	if err := walletapi.Connect(daemonEndpoint); err != nil {
		swm.log(fmt.Sprintf("[WARN] walletapi.Connect returned error: %v (continuing anyway)", err))
	}

	registeredCount := 0
	for i, tw := range swm.wallets {
		if tw.wallet == nil {
			continue
		}

		// Set daemon address and online mode
		tw.wallet.SetDaemonAddress(daemonEndpoint)
		tw.wallet.SetOnlineMode()

		// Get registration TX
		regTX := tw.wallet.GetRegistrationTX()
		if regTX == nil {
			swm.log(fmt.Sprintf("[INFO] Wallet %d: GetRegistrationTX returned nil (may already be registered)", i))
			tw.Registered = true
			registeredCount++
			continue
		}

		// Send registration TX
		if err := tw.wallet.SendTransaction(regTX); err != nil {
			errStr := err.Error()
			if strings.Contains(errStr, "already") || strings.Contains(errStr, "registered") {
				swm.log(fmt.Sprintf("[OK] Wallet %d: Already registered", i))
				tw.Registered = true
				registeredCount++
			} else {
				swm.log(fmt.Sprintf("[WARN] Wallet %d: Registration error: %v", i, err))
			}
		} else {
			swm.log(fmt.Sprintf("[OK] Wallet %d: Registration TX sent", i))
			tw.Registered = true
			registeredCount++
		}

		// Small delay between registrations
		time.Sleep(50 * time.Millisecond)
	}

	// Wait for registrations to be confirmed
	swm.log("[WAIT] Waiting for registrations to be confirmed...")
	time.Sleep(2 * time.Second)

	// Sync balances
	swm.syncBalancesUnlocked()

	// Disconnect walletapi - MUST close websocket properly!
	disconnectWalletAPI()

	swm.log(fmt.Sprintf("[OK] Registered %d/%d test wallets", registeredCount, len(swm.wallets)))
	return nil
}

// ================== Balance Sync Functions ==================

// syncBalancesUnlocked syncs balances for all wallets (must hold lock)
// Uses direct daemon query via GetDecryptedBalanceAtTopoHeight for accurate balances
func (swm *SimulatorWalletManager) syncBalancesUnlocked() {
	for i, tw := range swm.wallets {
		if tw.wallet == nil {
			swm.log(fmt.Sprintf("[WARN] Wallet %d: wallet object is nil", i))
			continue
		}

		// Ensure wallet is in online mode
		tw.wallet.SetOnlineMode()

		// Use direct daemon query instead of wallet's internal state
		// The wallet's Sync_Wallet_Memory_With_Daemon() and Get_Balance() can return
		// stale data in simulator mode, especially for incoming transactions
		var zerohash [32]byte // zero SCID for native DERO
		balance, _, err := tw.wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, tw.Address)
		if err != nil {
			// Fallback to wallet's internal state if direct query fails
			tw.wallet.Sync_Wallet_Memory_With_Daemon()
			balance, _ = tw.wallet.Get_Balance()
		}

		oldBalance := tw.Balance
		tw.Balance = balance
		tw.Registered = tw.wallet.IsRegistered()

		// Log if balance changed
		if oldBalance != balance {
			swm.log(fmt.Sprintf("[SYNC] Wallet %d: Balance changed %d -> %d", i, oldBalance, balance))
		}
	}
}

// syncSingleWalletUnlocked syncs a single wallet and returns the new balance
func (swm *SimulatorWalletManager) syncSingleWalletUnlocked(index int) (uint64, error) {
	if index < 0 || index >= len(swm.wallets) {
		return 0, fmt.Errorf("wallet index %d out of range", index)
	}

	tw := swm.wallets[index]
	if tw.wallet == nil {
		return 0, fmt.Errorf("wallet %d object is nil", index)
	}

	// Ensure wallet is in online mode
	tw.wallet.SetOnlineMode()

	// Get balance BEFORE sync for comparison
	preMature, preLocked := tw.wallet.Get_Balance()

	// Sync with daemon
	if err := tw.wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		return 0, fmt.Errorf("sync failed: %v", err)
	}

	// Get balance AFTER sync
	mature, locked := tw.wallet.Get_Balance()
	oldBalance := tw.Balance
	tw.Balance = mature
	tw.Locked = locked
	tw.Registered = tw.wallet.IsRegistered()

	// Log detailed sync info
	if preMature != mature || preLocked != locked {
		swm.log(fmt.Sprintf("[SYNC] Wallet %d: Balance changed during sync: %d/%d -> %d/%d (mature/locked)", index, preMature, preLocked, mature, locked))
	}

	// Log if stored balance changed
	if oldBalance != mature {
		swm.log(fmt.Sprintf("[SYNC] Wallet %d: Stored balance updated %d -> %d", index, oldBalance, mature))
	}

	return mature, nil
}

// GetDirectBalance queries the balance directly from the daemon, bypassing wallet cache
// NOTE: Caller must ensure walletapi.Connect() has been called before this
func (swm *SimulatorWalletManager) GetDirectBalance(index int) (uint64, error) {
	swm.RLock()
	defer swm.RUnlock()

	if index < 0 || index >= len(swm.wallets) {
		return 0, fmt.Errorf("wallet index %d out of range", index)
	}

	tw := swm.wallets[index]
	if tw.wallet == nil {
		return 0, fmt.Errorf("wallet %d object is nil", index)
	}

	// Ensure wallet is in online mode for the query
	tw.wallet.SetOnlineMode()

	// Use GetDecryptedBalanceAtTopoHeight which directly queries and decodes
	// the balance from the daemon without relying on cached data
	var zerohash [32]byte // zero SCID for native DERO
	balance, _, err := tw.wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, tw.Address)
	if err != nil {
		return 0, fmt.Errorf("failed to get direct balance: %v", err)
	}

	return balance, nil
}

// UpdateBalanceFromDirect updates the stored balance by querying directly from daemon
func (swm *SimulatorWalletManager) UpdateBalanceFromDirect(index int) (uint64, error) {
	if index < 0 || index >= len(swm.wallets) {
		return 0, fmt.Errorf("wallet index %d out of range", index)
	}

	// Get direct balance (this acquires read lock internally)
	balance, err := swm.GetDirectBalance(index)
	if err != nil {
		return 0, err
	}

	// Now update the stored balance
	swm.Lock()
	defer swm.Unlock()

	if index < len(swm.wallets) {
		oldBalance := swm.wallets[index].Balance
		swm.wallets[index].Balance = balance
		if oldBalance != balance {
			swm.log(fmt.Sprintf("[SYNC] Wallet %d: Direct balance query: %d -> %d", index, oldBalance, balance))
		}
	}

	return balance, nil
}

// SyncSingleWallet syncs a single wallet by index
func (swm *SimulatorWalletManager) SyncSingleWallet(daemonEndpoint string, index int) (uint64, error) {
	swm.Lock()
	defer swm.Unlock()

	// Connect walletapi for sync
	if err := walletapi.Connect(daemonEndpoint); err != nil {
		swm.log(fmt.Sprintf("[WARN] walletapi.Connect returned error: %v", err))
	}

	balance, err := swm.syncSingleWalletUnlocked(index)

	// Disconnect - MUST close websocket properly!
	disconnectWalletAPI()

	return balance, err
}

// SyncBalances syncs balances for all wallets
func (swm *SimulatorWalletManager) SyncBalances(daemonEndpoint string) error {
	swm.Lock()
	defer swm.Unlock()

	// Connect walletapi for sync
	if err := walletapi.Connect(daemonEndpoint); err != nil {
		swm.log(fmt.Sprintf("[WARN] walletapi.Connect returned error: %v", err))
	}

	swm.syncBalancesUnlocked()

	// Disconnect - MUST close websocket properly!
	disconnectWalletAPI()

	return nil
}

// ================== Wallet Getters ==================

// GetWallets returns all test wallets (safe copy)
func (swm *SimulatorWalletManager) GetWallets() []TestWallet {
	swm.RLock()
	defer swm.RUnlock()

	result := make([]TestWallet, len(swm.wallets))
	for i, tw := range swm.wallets {
		result[i] = TestWallet{
			Index:      tw.Index,
			Seed:       tw.Seed,
			Address:    tw.Address,
			Balance:    tw.Balance,
			Locked:     tw.Locked,
			Registered: tw.Registered,
			RPCPort:    tw.RPCPort,
		}
	}
	return result
}

// GetWallet returns a specific test wallet by index
func (swm *SimulatorWalletManager) GetWallet(index int) *TestWallet {
	swm.RLock()
	defer swm.RUnlock()

	if index < 0 || index >= len(swm.wallets) {
		return nil
	}
	tw := swm.wallets[index]
	return &TestWallet{
		Index:      tw.Index,
		Seed:       tw.Seed,
		Address:    tw.Address,
		Balance:    tw.Balance,
		Locked:     tw.Locked,
		Registered: tw.Registered,
		RPCPort:    tw.RPCPort,
	}
}

// GetWalletByAddress returns a test wallet by address
func (swm *SimulatorWalletManager) GetWalletByAddress(address string) *TestWallet {
	swm.RLock()
	defer swm.RUnlock()

	for _, tw := range swm.wallets {
		if tw.Address == address {
			return &TestWallet{
				Index:      tw.Index,
				Seed:       tw.Seed,
				Address:    tw.Address,
				Balance:    tw.Balance,
				Locked:     tw.Locked,
				Registered: tw.Registered,
				RPCPort:    tw.RPCPort,
			}
		}
	}
	return nil
}

// GetInternalWallet returns the internal wallet object for a test wallet
// Use with caution - this is for advanced operations like transactions
func (swm *SimulatorWalletManager) GetInternalWallet(index int) *walletapi.Wallet_Disk {
	swm.RLock()
	defer swm.RUnlock()

	if index < 0 || index >= len(swm.wallets) {
		return nil
	}
	return swm.wallets[index].wallet
}

// ================== Primary Wallet Functions ==================
// These functions operate on wallet #0 as the "primary" simulator wallet

// GetPrimaryWallet returns the primary wallet (wallet #0) for use as the main simulator wallet
func (swm *SimulatorWalletManager) GetPrimaryWallet() *walletapi.Wallet_Disk {
	return swm.GetInternalWallet(0)
}

// GetPrimaryAddress returns the address of the primary wallet
func (swm *SimulatorWalletManager) GetPrimaryAddress() string {
	swm.RLock()
	defer swm.RUnlock()

	if len(swm.wallets) == 0 {
		return ""
	}
	return swm.wallets[0].Address
}

// GetPrimaryBalance returns the balance of the primary wallet
func (swm *SimulatorWalletManager) GetPrimaryBalance() (uint64, uint64, error) {
	swm.RLock()
	defer swm.RUnlock()

	if len(swm.wallets) == 0 || swm.wallets[0].wallet == nil {
		return 0, 0, fmt.Errorf("primary wallet not available")
	}

	mature, locked := swm.wallets[0].wallet.Get_Balance()
	return mature, locked, nil
}

// IsPrimaryRegistered checks if the primary wallet is registered
func (swm *SimulatorWalletManager) IsPrimaryRegistered() bool {
	swm.RLock()
	defer swm.RUnlock()

	if len(swm.wallets) == 0 || swm.wallets[0].wallet == nil {
		return false
	}
	return swm.wallets[0].wallet.IsRegistered()
}

// ================== Status Functions ==================

// IsSetup returns whether test wallets are set up
func (swm *SimulatorWalletManager) IsSetup() bool {
	swm.RLock()
	defer swm.RUnlock()
	return swm.isSetup
}

// Count returns the number of test wallets
func (swm *SimulatorWalletManager) Count() int {
	swm.RLock()
	defer swm.RUnlock()
	return len(swm.wallets)
}

// GetStatus returns the current status of the simulator wallets
func (swm *SimulatorWalletManager) GetStatus() map[string]interface{} {
	swm.RLock()
	defer swm.RUnlock()

	status := map[string]interface{}{
		"isSetup":      swm.isSetup,
		"walletCount":  len(swm.wallets),
		"walletsDir":   swm.walletsDir,
	}

	if len(swm.wallets) > 0 && swm.wallets[0].wallet != nil {
		status["primaryAddress"] = swm.wallets[0].Address
		mature, locked := swm.wallets[0].wallet.Get_Balance()
		status["primaryBalance"] = mature
		status["primaryLocked"] = locked
		status["primaryRegistered"] = swm.wallets[0].wallet.IsRegistered()
	}

	return status
}

// ================== Cleanup ==================

// CloseAll closes all test wallets
func (swm *SimulatorWalletManager) CloseAll() {
	swm.Lock()
	defer swm.Unlock()

	for _, tw := range swm.wallets {
		if tw.wallet != nil {
			tw.wallet.Close_Encrypted_Wallet()
			tw.wallet = nil
		}
	}

	swm.wallets = make([]*TestWallet, 0)
	swm.isSetup = false
	swm.log("[OK] All test wallets closed")
}

// ================== App API Functions ==================

// GetSimulatorTestWallets returns all pre-seeded test wallets.
// If the app restarted with network=simulator but the SimulatorManager was
// never re-initialized (daemon still running from previous session), this
// will transparently reconnect before returning wallets.
func (a *App) GetSimulatorTestWallets() map[string]interface{} {
	a.ensureSimulatorReconnectedIfNeeded()

	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
			"wallets": []TestWallet{},
		}
	}

	wallets := a.simulatorManager.walletManager.GetWallets()
	return map[string]interface{}{
		"success": true,
		"count":   len(wallets),
		"wallets": wallets,
	}
}

// GetSimulatorTestWallet returns a specific test wallet by index
func (a *App) GetSimulatorTestWallet(index int) map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
		}
	}

	wallet := a.simulatorManager.walletManager.GetWallet(index)
	if wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Wallet %d not found", index),
		}
	}

	return map[string]interface{}{
		"success": true,
		"wallet":  wallet,
	}
}

// SyncSimulatorTestWallets syncs balances for all test wallets
func (a *App) SyncSimulatorTestWallets() map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
		}
	}

	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)
	if err := a.simulatorManager.walletManager.SyncBalances(endpoint); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	wallets := a.simulatorManager.walletManager.GetWallets()
	return map[string]interface{}{
		"success": true,
		"count":   len(wallets),
		"wallets": wallets,
	}
}

// RefreshTestWalletBalance refreshes a single test wallet's balance using direct daemon query
func (a *App) RefreshTestWalletBalance(index int) map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
		}
	}

	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)

	// Connect to daemon
	if err := walletapi.Connect(endpoint); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to connect to daemon: %v", err),
		}
	}
	defer disconnectWalletAPI()

	// Get direct balance from daemon
	balance, err := a.simulatorManager.walletManager.UpdateBalanceFromDirect(index)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	// Get updated wallet info
	wallet := a.simulatorManager.walletManager.GetWallet(index)

	a.logToConsole(fmt.Sprintf("[OK] Refreshed wallet #%d balance: %d atomic units (%.5f DERO)", index, balance, float64(balance)/100000))

	return map[string]interface{}{
		"success": true,
		"balance": balance,
		"wallet":  wallet,
	}
}

// OpenSimulatorTestWallet opens a test wallet by index and sets it as the active wallet
func (a *App) OpenSimulatorTestWallet(index int) map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
		}
	}

	// Get the internal wallet object
	internalWallet := a.simulatorManager.walletManager.GetInternalWallet(index)
	if internalWallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Test wallet %d not found", index),
		}
	}

	// Get wallet info
	walletInfo := a.simulatorManager.walletManager.GetWallet(index)
	if walletInfo == nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Test wallet %d info not found", index),
		}
	}

	// Use the global wallet manager (same as OpenWallet)
	walletManager.Lock()
	defer walletManager.Unlock()

	// Close existing wallet if open
	if walletManager.isOpen && walletManager.wallet != nil {
		walletManager.wallet.Close_Encrypted_Wallet()
		walletManager.isOpen = false
	}

	// Set the test wallet as the active wallet
	walletManager.wallet = internalWallet
	walletManager.walletPath = fmt.Sprintf("TestWallet_%d (Simulator)", index)
	walletManager.isOpen = true

	// Connect to daemon temporarily for sync and balance query.
	// CRITICAL: In simulator mode, the daemon can only handle ONE WebSocket at a time.
	// Gnomon holds a persistent WebSocket, so we must pause it, do our work, then resume.
	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)

	gnomonWasRunning := a.pauseGnomonForSimulator()

	if err := walletapi.Connect(endpoint); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] walletapi.Connect failed: %v", err))
	}
	internalWallet.SetDaemonAddress(endpoint)
	internalWallet.SetOnlineMode()

	// Sync wallet
	if err := internalWallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Failed to sync test wallet: %v", err))
	}

	// wallet.Get_Balance() returns stale data in simulator mode because the
	// in-memory wallet hasn't scanned genesis/funding blocks.  Use the direct
	// daemon query (same as syncBalancesUnlocked) for an accurate balance.
	var mature, locked uint64
	var zerohash [32]byte
	if bal, _, err := internalWallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, walletInfo.Address); err == nil {
		mature = bal
	} else {
		mature, locked = internalWallet.Get_Balance()
	}

	// CRITICAL: Disconnect immediately after sync/balance query to free the
	// simulator's single WebSocket slot. Leaving this open causes the daemon
	// to crash when any other component (Gnomon, SC deploy, etc.) connects.
	a.disconnectWalletAPI()

	if gnomonWasRunning {
		a.resumeGnomonForSimulator()
	}

	a.logToConsole(fmt.Sprintf("[OK] Opened test wallet #%d: %s (balance: %d)", index, walletInfo.Address[:20]+"...", mature))

	return map[string]interface{}{
		"success": true,
		"address": walletInfo.Address,
		"path":    walletManager.walletPath,
		"balance": mature,
		"locked":  locked,
		"index":   index,
	}
}

// FundTestWallet transfers funds from other test wallets to the target wallet
func (a *App) FundTestWallet(targetIndex int, amount uint64) map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator not initialized",
		}
	}

	// Get target wallet address
	targetWallet := a.simulatorManager.walletManager.GetWallet(targetIndex)
	if targetWallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Target wallet %d not found", targetIndex),
		}
	}

	// CRITICAL: Set globals for simulator mode before walletapi.Connect()
	// The walletapi checks globals.IsMainnet() which compares Config.Name
	// InitNetwork() sets Config based on --testnet flag
	globals.Arguments["--simulator"] = true
	globals.Arguments["--testnet"] = true
	globals.InitNetwork()

	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)

	// Sync all balances first
	if err := a.simulatorManager.walletManager.SyncBalances(endpoint); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Failed to sync balances: %v", err))
	}

	// Find wallets with balance to transfer from (excluding target)
	wallets := a.simulatorManager.walletManager.GetWallets()
	var totalTransferred uint64 = 0
	var transferCount int = 0
	remainingNeeded := amount
	var sourceIndices []int // Track which wallets we transferred from

	a.logToConsole(fmt.Sprintf("[FUND] Funding wallet #%d with %d atomic units...", targetIndex, amount))

	for i, w := range wallets {
		if i == targetIndex || remainingNeeded == 0 {
			continue
		}

		// Skip wallets with no balance
		if w.Balance < 100000 { // Need at least 100000 to cover transfer + fees
			continue
		}

		// Get the internal wallet for this source
		sourceWallet := a.simulatorManager.walletManager.GetInternalWallet(i)
		if sourceWallet == nil {
			continue
		}

		// Calculate how much to transfer (leave some for fees)
		available := w.Balance - 50000 // Leave 50000 for safety
		if available <= 0 {
			continue
		}

		transferAmount := available
		if transferAmount > remainingNeeded {
			transferAmount = remainingNeeded
		}

		// Connect and transfer
		if err := walletapi.Connect(endpoint); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Failed to connect for transfer from wallet %d: %v", i, err))
			continue
		}

		// Sync source wallet before transfer
		sourceWallet.SetOnlineMode()
		sourceWallet.Sync_Wallet_Memory_With_Daemon()

		// Build transfer transaction
		tx, err := sourceWallet.TransferPayload0([]rpc.Transfer{{
			Destination: targetWallet.Address,
			Amount:      transferAmount,
		}}, 2, false, rpc.Arguments{}, 0, false)

		if err != nil {
			disconnectWalletAPI()
			a.logToConsole(fmt.Sprintf("[WARN] Transfer build from wallet %d failed: %v", i, err))
			continue
		}

		// Actually send the transaction to the network
		if err := sourceWallet.SendTransaction(tx); err != nil {
			disconnectWalletAPI()
			a.logToConsole(fmt.Sprintf("[WARN] Transfer send from wallet %d failed: %v", i, err))
			continue
		}

		disconnectWalletAPI()

		a.logToConsole(fmt.Sprintf("[OK] Transferred %d from wallet #%d (tx: %s)", transferAmount, i, tx.GetHash().String()[:16]+"..."))

		totalTransferred += transferAmount
		transferCount++
		remainingNeeded -= transferAmount
		sourceIndices = append(sourceIndices, i)

		// Wait for block to be mined (simulator auto-mines)
		a.logToConsole("[WAIT] Waiting for block confirmation...")
		if err := a.waitForNewBlockWithHealthCheck(10 * time.Second); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Block wait: %v", err))
		} else {
			a.logToConsole("[OK] Block confirmed")
		}
	}

	if totalTransferred == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No funds available to transfer from other wallets",
		}
	}

	// Wait an extra block to ensure all transactions are fully confirmed
	a.logToConsole("[WAIT] Waiting for final block confirmation...")
	time.Sleep(500 * time.Millisecond)
	if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Final block wait: %v", err))
	}

	// Now sync the target wallet to pick up incoming funds
	a.logToConsole("[SYNC] Querying target wallet balance directly from daemon...")

	var newBalance uint64 = 0
	expectedBalance := targetWallet.Balance + totalTransferred

	// Connect to daemon for balance queries
	if err := walletapi.Connect(endpoint); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Connect for balance query failed: %v", err))
	}

	// Try querying balance up to 5 times with delays
	for attempt := 1; attempt <= 5; attempt++ {
		directBalance, err := a.simulatorManager.walletManager.GetDirectBalance(targetIndex)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Direct balance query attempt %d failed: %v", attempt, err))
		} else {
			newBalance = directBalance

			// Update the stored balance
			a.simulatorManager.walletManager.Lock()
			if targetIndex < len(a.simulatorManager.walletManager.wallets) {
				a.simulatorManager.walletManager.wallets[targetIndex].Balance = directBalance
			}
			a.simulatorManager.walletManager.Unlock()

			// If we got the expected balance (or close to it), we're done
			if directBalance >= expectedBalance-10000 {
				a.logToConsole(fmt.Sprintf("[OK] Target wallet balance updated to %d", directBalance))
				break
			}
		}

		// Wait before next attempt
		if attempt < 5 {
			time.Sleep(500 * time.Millisecond)
			a.waitForNewBlockWithHealthCheck(5 * time.Second)
		}
	}

	disconnectWalletAPI()

	// Also update source wallet balances using direct query
	a.logToConsole("[SYNC] Updating source wallet balances...")
	if err := walletapi.Connect(endpoint); err == nil {
		for _, srcIdx := range sourceIndices {
			if balance, err := a.simulatorManager.walletManager.UpdateBalanceFromDirect(srcIdx); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Failed to update source wallet %d balance: %v", srcIdx, err))
			} else {
				a.logToConsole(fmt.Sprintf("[OK] Source wallet #%d balance: %d", srcIdx, balance))
			}
		}
		disconnectWalletAPI()
	}

	a.logToConsole(fmt.Sprintf("[OK] Funded wallet #%d with %d atomic units from %d wallets", targetIndex, totalTransferred, transferCount))
	a.logToConsole(fmt.Sprintf("[OK] Final balance: %d atomic units (%.5f DERO)", newBalance, float64(newBalance)/100000))

	return map[string]interface{}{
		"success":          true,
		"totalTransferred": totalTransferred,
		"transferCount":    transferCount,
		"newBalance":       newBalance,
		"message":          fmt.Sprintf("Transferred %d atomic units from %d wallets", totalTransferred, transferCount),
	}
}

// ================== Legacy API Functions (for backward compatibility) ==================
// These wrap the new unified API to maintain compatibility with existing code

// GetSimulatorWalletStatus returns the status of the simulator wallet (uses primary wallet)
func (a *App) GetSimulatorWalletStatus() map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator manager not initialized",
		}
	}

	status := a.simulatorManager.walletManager.GetStatus()
	status["success"] = true
	return status
}

// IsSimulatorWalletRegistered checks if the primary simulator wallet is registered
func (a *App) IsSimulatorWalletRegistered() map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success":      false,
			"isRegistered": false,
			"error":        "Simulator manager not initialized",
		}
	}

	isRegistered := a.simulatorManager.walletManager.IsPrimaryRegistered()
	return map[string]interface{}{
		"success":      true,
		"isRegistered": isRegistered,
	}
}

// GetSimulatorWalletInfo returns info about the primary simulator wallet
func (a *App) GetSimulatorWalletInfo() map[string]interface{} {
	if a.simulatorManager == nil || a.simulatorManager.walletManager == nil {
		return map[string]interface{}{
			"success":   false,
			"available": false,
			"error":     "Simulator not running",
		}
	}

	if !a.simulatorManager.walletManager.IsSetup() {
		return map[string]interface{}{
			"success":   false,
			"available": false,
			"error":     "Simulator wallets not set up",
		}
	}

	address := a.simulatorManager.walletManager.GetPrimaryAddress()
	mature, locked, err := a.simulatorManager.walletManager.GetPrimaryBalance()
	if err != nil {
		return map[string]interface{}{
			"success":   false,
			"available": false,
			"error":     err.Error(),
		}
	}

	isRegistered := a.simulatorManager.walletManager.IsPrimaryRegistered()

	// Check if this is currently the active wallet
	walletManager.RLock()
	primaryWallet := a.simulatorManager.walletManager.GetPrimaryWallet()
	isActive := walletManager.wallet == primaryWallet && walletManager.isOpen
	walletManager.RUnlock()

	return map[string]interface{}{
		"success":      true,
		"available":    true,
		"address":      address,
		"balance":      mature,
		"locked":       locked,
		"isRegistered": isRegistered,
		"isActive":     isActive,
	}
}

// UseSimulatorWallet sets the primary simulator wallet as the active wallet
func (a *App) UseSimulatorWallet() map[string]interface{} {
	// Just use test wallet #0 as the "simulator wallet"
	return a.OpenSimulatorTestWallet(0)
}

