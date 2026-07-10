// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for wallet.go

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/deroproject/derohe/globals"
)

// ============== WalletManager Tests ==============

func TestNewWalletManager(t *testing.T) {
	wm := NewWalletManager()

	if wm == nil {
		t.Fatal("NewWalletManager should not return nil")
	}

	if wm.recentWallets == nil {
		t.Error("recentWallets should be initialized")
	}

	if wm.isOpen {
		t.Error("isOpen should be false initially")
	}

	if wm.wallet != nil {
		t.Error("wallet should be nil initially")
	}
}

func TestWalletManager_InitialState(t *testing.T) {
	// Create a fresh wallet manager for testing
	wm := &WalletManager{
		recentWallets: make([]string, 0),
	}

	if wm.isOpen {
		t.Error("New WalletManager should not have isOpen=true")
	}

	if wm.walletPath != "" {
		t.Error("walletPath should be empty initially")
	}

	if len(wm.recentWallets) != 0 {
		t.Error("recentWallets should be empty initially")
	}
}

// ============== No-Wallet Error Path Tests ==============

// TestApp is a minimal test struct to test wallet methods
type testWalletApp struct {
	settings    map[string]interface{}
	consoleLogs []ConsoleLog
}

func (a *testWalletApp) logToConsole(msg string) {
	a.consoleLogs = append(a.consoleLogs, ConsoleLog{Message: msg})
}

func TestCloseWallet_NotOpen(t *testing.T) {
	// Reset global wallet manager state
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	result := app.CloseWallet()

	if result["success"] != false {
		t.Error("CloseWallet should return success=false when no wallet is open")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg == "" {
		t.Error("CloseWallet should return an error message")
	}
}

func TestGetWalletStatus_NoWallet(t *testing.T) {
	// Reset global wallet manager state
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetWalletStatus()

	if result["success"] != true {
		t.Error("GetWalletStatus should return success=true even when no wallet")
	}

	if result["isOpen"] != false {
		t.Error("isOpen should be false when no wallet is open")
	}
}

func TestGetBalance_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetBalance()

	if result["success"] != false {
		t.Error("GetBalance should return success=false when no wallet is open")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg == "" {
		t.Error("GetBalance should return an error message")
	}
}

func TestGetAddress_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetAddress()

	if result["success"] != false {
		t.Error("GetAddress should return success=false when no wallet is open")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg == "" {
		t.Error("GetAddress should return an error message")
	}
}

func TestGetIntegratedAddress_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetIntegratedAddress(0, "", 0)

	if result["success"] != false {
		t.Error("GetIntegratedAddress should return success=false when no wallet is open")
	}
}

func TestTransfer_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{consoleLogs: make([]ConsoleLog, 0)}

	result := app.Transfer("dero1dest...", 1000000, "", 16)

	if result["success"] != false {
		t.Error("Transfer should return success=false when no wallet is open")
	}
}

func TestGetTransactionHistory_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetTransactionHistory(50)

	if result["success"] != false {
		t.Error("GetTransactionHistory should return success=false when no wallet is open")
	}
}

func TestGetTransactionHistory_DefaultLimit(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	// Test with 0 limit - should default to 50
	result := app.GetTransactionHistory(0)

	// Will fail because no wallet, but we're testing the limit isn't causing issues
	if result["success"] != false {
		t.Error("GetTransactionHistory should return success=false")
	}

	// Test with negative limit
	result = app.GetTransactionHistory(-10)
	if result["success"] != false {
		t.Error("GetTransactionHistory should return success=false")
	}
}

func TestGetWalletMiningEarnings_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetWalletMiningEarnings(100)

	if result["success"] != false {
		t.Error("GetWalletMiningEarnings should return success=false when no wallet")
	}

	// Should still return empty earnings array
	earnings, ok := result["earnings"].([]map[string]interface{})
	if !ok {
		t.Error("earnings should be present even on error")
	}
	if len(earnings) != 0 {
		t.Error("earnings should be empty when no wallet")
	}
}

func TestGetMiningEarningsSummary_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	result := app.GetMiningEarningsSummary()

	if result["success"] != false {
		t.Error("GetMiningEarningsSummary should return success=false when no wallet")
	}

	// Should have zero total_amount
	if result["total_amount"] != uint64(0) {
		t.Error("total_amount should be 0 when no wallet")
	}
}

func TestIsWalletOpen_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}

	if app.IsWalletOpen() {
		t.Error("IsWalletOpen should return false when no wallet is open")
	}
}

func TestGetWallet_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	wallet := GetWallet()

	if wallet != nil {
		t.Error("GetWallet should return nil when no wallet is open")
	}
}

func TestGetCurrentWalletPath_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.walletPath = ""
	walletManager.Unlock()

	app := &App{}

	path := app.GetCurrentWalletPath()

	if path != "" {
		t.Errorf("GetCurrentWalletPath should return empty string, got %s", path)
	}
}

// ============== File Validation Tests ==============

func TestOpenWallet_FileNotFound(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	result := app.OpenWallet("/nonexistent/path/wallet.db", "password")

	if result["success"] != false {
		t.Error("OpenWallet should fail for nonexistent file")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg != "Wallet file not found" {
		t.Errorf("Expected 'Wallet file not found' error, got: %v", result["error"])
	}
}

func TestCreateWallet_FileExists(t *testing.T) {
	// Create a temp file
	tempDir, err := os.MkdirTemp("", "hologram_wallet_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	existingFile := filepath.Join(tempDir, "existing.db")
	os.WriteFile(existingFile, []byte("test"), 0600)

	app := &App{consoleLogs: make([]ConsoleLog, 0)}

	result := app.CreateWallet(existingFile, "password")

	if result["success"] != false {
		t.Error("CreateWallet should fail when file already exists")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg != "A wallet with this name already exists" {
		t.Errorf("Expected 'A wallet with this name already exists' error, got: %v", result["error"])
	}
}

func TestRestoreWallet_FileExists(t *testing.T) {
	// Create a temp file
	tempDir, err := os.MkdirTemp("", "hologram_wallet_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	existingFile := filepath.Join(tempDir, "existing.db")
	os.WriteFile(existingFile, []byte("test"), 0600)

	app := &App{consoleLogs: make([]ConsoleLog, 0)}

	result := app.RestoreWallet(existingFile, "password", "test seed phrase words")

	if result["success"] != false {
		t.Error("RestoreWallet should fail when file already exists")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg != "A wallet with this name already exists" {
		t.Errorf("Expected 'A wallet with this name already exists' error, got: %v", result["error"])
	}
}

func TestSwitchWallet_FileNotFound(t *testing.T) {
	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	result := app.SwitchWallet("/nonexistent/wallet.db", "password")

	if result["success"] != false {
		t.Error("SwitchWallet should fail for nonexistent file")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg != "Wallet file not found" {
		t.Errorf("Expected 'Wallet file not found' error, got: %v", result["error"])
	}
}

// ============== InternalWalletCall Validation Tests ==============

func TestInternalWalletCall_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.walletPath = ""
	walletManager.Unlock()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	result := app.InternalWalletCall("transfer", map[string]interface{}{}, "")

	if result["success"] != false {
		t.Error("InternalWalletCall should fail when no wallet is open")
	}

	errMsg, ok := result["error"].(string)
	if !ok || errMsg != "Wallet not open" {
		t.Errorf("Expected 'Wallet not open' error, got: %v", result["error"])
	}
}

func TestInternalWalletCall_Transfer_NoTransfers(t *testing.T) {
	// Simulate wallet open state but we can't actually make calls
	walletManager.Lock()
	originalIsOpen := walletManager.isOpen
	originalWallet := walletManager.wallet
	walletManager.isOpen = true
	// Note: wallet is nil so actual call will fail, but we test param validation
	walletManager.Unlock()

	defer func() {
		walletManager.Lock()
		walletManager.isOpen = originalIsOpen
		walletManager.wallet = originalWallet
		walletManager.Unlock()
	}()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	// Empty transfers should fail
	result := app.InternalWalletCall("transfer", map[string]interface{}{}, "password")

	if result["success"] != false {
		t.Error("InternalWalletCall transfer with no transfers should fail")
	}
}

func TestInternalWalletCall_SCInvoke_MissingSCID(t *testing.T) {
	// Note: Without a real wallet, we can't test parameter validation in isolation
	// because the code checks wallet.isOpen && wallet != nil first.
	// This test verifies the error path when wallet state is inconsistent.

	walletManager.Lock()
	originalIsOpen := walletManager.isOpen
	originalWallet := walletManager.wallet
	walletManager.isOpen = true
	walletManager.wallet = nil // Wallet object is nil even though isOpen is true
	walletManager.Unlock()

	defer func() {
		walletManager.Lock()
		walletManager.isOpen = originalIsOpen
		walletManager.wallet = originalWallet
		walletManager.Unlock()
	}()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	// With isOpen=true but wallet=nil, should fail
	result := app.InternalWalletCall("scinvoke", map[string]interface{}{}, "password")

	if result["success"] != false {
		t.Error("InternalWalletCall should fail when wallet object is nil")
	}

	// Error should indicate wallet not usable
	_, ok := result["error"].(string)
	if !ok {
		t.Error("Should return an error message")
	}
}

func TestInternalWalletCall_UnsupportedMethod(t *testing.T) {
	// Note: Without a real wallet, we can't test the unsupported method path
	// because the code checks wallet state first.
	// This test verifies behavior when wallet object is nil.

	walletManager.Lock()
	originalIsOpen := walletManager.isOpen
	originalWallet := walletManager.wallet
	walletManager.isOpen = true
	walletManager.wallet = nil
	walletManager.Unlock()

	defer func() {
		walletManager.Lock()
		walletManager.isOpen = originalIsOpen
		walletManager.wallet = originalWallet
		walletManager.Unlock()
	}()

	app := &App{
		settings:    make(map[string]interface{}),
		consoleLogs: make([]ConsoleLog, 0),
	}

	result := app.InternalWalletCall("unsupported_method", map[string]interface{}{}, "")

	if result["success"] != false {
		t.Error("InternalWalletCall should fail when wallet object is nil")
	}

	// Should return some error
	_, ok := result["error"].(string)
	if !ok {
		t.Error("Should return an error message")
	}
}

// ============== Recent Wallets Tests ==============

func TestAddToRecentWalletsWithInfo_NoDuplicates(t *testing.T) {
	// Create temp directory for settings
	tempDir, err := os.MkdirTemp("", "hologram_recent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override the data directory for this test
	originalOverride := testDataDirOverride
	testDataDirOverride = tempDir
	defer func() { testDataDirOverride = originalOverride }()

	// Reset wallet manager
	walletManager.Lock()
	walletManager.recentWallets = []string{}
	walletManager.Unlock()

	// Add same path twice (addToRecentWalletsWithInfo requires path + address)
	addToRecentWalletsWithInfo("/path/to/wallet.db", "dero1qwerty1234567890abcdef")
	addToRecentWalletsWithInfo("/other/wallet.db", "dero1other1234567890abcdef")
	addToRecentWalletsWithInfo("/path/to/wallet.db", "dero1qwerty1234567890abcdef") // Duplicate

	walletManager.RLock()
	count := len(walletManager.recentWallets)
	walletManager.RUnlock()

	if count != 2 {
		t.Errorf("Expected 2 wallets (no duplicates), got %d", count)
	}

	// The duplicate should move to front
	walletManager.RLock()
	first := walletManager.recentWallets[0]
	walletManager.RUnlock()

	if first != "/path/to/wallet.db" {
		t.Error("Most recently added should be first")
	}
}

func TestAddToRecentWalletsWithInfo_Max10(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "hologram_recent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override the data directory for this test
	originalOverride := testDataDirOverride
	testDataDirOverride = tempDir
	defer func() { testDataDirOverride = originalOverride }()

	// Reset
	walletManager.Lock()
	walletManager.recentWallets = []string{}
	walletManager.Unlock()

	// Add 12 wallets (exceeds the max of 10)
	for i := 0; i < 12; i++ {
		addToRecentWalletsWithInfo(
			filepath.Join(tempDir, "wallet"+string(rune('A'+i))+".db"),
			"dero1testaddr1234567890abc",
		)
	}

	walletManager.RLock()
	count := len(walletManager.recentWallets)
	walletManager.RUnlock()

	if count != 10 {
		t.Errorf("Expected max 10 recent wallets, got %d", count)
	}
}

func TestLoadSaveRecentWalletsData_Roundtrip(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "hologram_recent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override the data directory for this test
	originalOverride := testDataDirOverride
	testDataDirOverride = tempDir
	defer func() { testDataDirOverride = originalOverride }()

	// Save some wallets using the new data format
	testWallets := []recentWalletData{
		{Path: "/path/a.db", AddressPrefix: "dero1aaa...", LastUsed: 1000, Network: "mainnet"},
		{Path: "/path/b.db", AddressPrefix: "dero1bbb...", LastUsed: 2000, Network: "mainnet"},
	}
	saveRecentWalletsData(testWallets)

	// Load them back
	loaded := loadRecentWalletsData()

	if len(loaded) != 2 {
		t.Errorf("Expected 2 wallets, got %d", len(loaded))
	}

	if loaded[0].Path != "/path/a.db" || loaded[1].Path != "/path/b.db" {
		t.Errorf("Loaded wallet paths don't match: %v", loaded)
	}

	if loaded[0].Network != "mainnet" || loaded[1].Network != "mainnet" {
		t.Errorf("Loaded wallet networks don't match: %v", loaded)
	}
}

func TestLoadRecentWallets_NoFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "hologram_recent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override the data directory for this test
	originalOverride := testDataDirOverride
	testDataDirOverride = tempDir
	defer func() { testDataDirOverride = originalOverride }()

	// No settings file exists
	loaded := loadRecentWallets()

	if len(loaded) != 0 {
		t.Errorf("Expected empty slice when no file, got %d items", len(loaded))
	}
}

func TestLoadRecentWallets_InvalidJSON(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "hologram_recent_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Override the data directory for this test
	originalOverride := testDataDirOverride
	testDataDirOverride = tempDir
	defer func() { testDataDirOverride = originalOverride }()

	// Create invalid JSON file in the test data directory
	settingsDir := filepath.Join(tempDir, "datashards", "settings")
	os.MkdirAll(settingsDir, 0700)
	os.WriteFile(filepath.Join(settingsDir, "recent_wallets.json"), []byte("invalid json"), 0600)

	loaded := loadRecentWallets()

	if len(loaded) != 0 {
		t.Errorf("Expected empty slice for invalid JSON, got %d items", len(loaded))
	}
}

// ============== WalletInfo Tests ==============

func TestWalletInfo_Structure(t *testing.T) {
	info := WalletInfo{
		Path:          "/path/to/wallet.db",
		Filename:      "wallet.db",
		AddressPrefix: "dero1abc123...",
		LastUsed:      1234567890,
		IsCurrent:     true,
	}

	if info.Path != "/path/to/wallet.db" {
		t.Error("Path mismatch")
	}
	if info.Filename != "wallet.db" {
		t.Error("Filename mismatch")
	}
	if info.AddressPrefix != "dero1abc123..." {
		t.Error("AddressPrefix mismatch")
	}
	if info.LastUsed != 1234567890 {
		t.Error("LastUsed mismatch")
	}
	if !info.IsCurrent {
		t.Error("IsCurrent mismatch")
	}
}

func TestWalletInfo_JSONMarshal(t *testing.T) {
	info := WalletInfo{
		Path:     "/test.db",
		Filename: "test.db",
	}

	data, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("JSON marshal failed: %v", err)
	}

	var decoded WalletInfo
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("JSON unmarshal failed: %v", err)
	}

	if decoded.Path != info.Path {
		t.Error("JSON roundtrip failed for Path")
	}
}

// ============== Mining Reward Classification Tests ==============

func TestMiningRewardType_Classification(t *testing.T) {
	// Block rewards are >= 2 DERO (200000 atomic units with 5 decimals)
	// Miniblock rewards are < 2 DERO

	tests := []struct {
		amount       uint64
		expectedType string
	}{
		{200000, "block"},     // Exactly 2 DERO
		{300000, "block"},     // 3 DERO
		{1000000, "block"},    // 10 DERO
		{199999, "miniblock"}, // Just under 2 DERO
		{100000, "miniblock"}, // 1 DERO
		{50000, "miniblock"},  // 0.5 DERO
		{0, "miniblock"},      // Zero
	}

	for _, tt := range tests {
		t.Run(string(rune(tt.amount)), func(t *testing.T) {
			rewardType := "miniblock"
			if tt.amount >= 200000 {
				rewardType = "block"
			}

			if rewardType != tt.expectedType {
				t.Errorf("Amount %d: got %s, expected %s", tt.amount, rewardType, tt.expectedType)
			}
		})
	}
}

// ============== Concurrent Access Tests ==============

func TestWalletManager_ConcurrentStatusCheck(t *testing.T) {
	var wg sync.WaitGroup
	iterations := 100

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			walletManager.RLock()
			_ = walletManager.isOpen
			_ = walletManager.walletPath
			walletManager.RUnlock()
		}()
	}

	wg.Wait()
	// No race conditions = success
}

func TestListRecentWallets_Concurrent(t *testing.T) {
	var wg sync.WaitGroup
	iterations := 50

	app := &App{}

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = app.ListRecentWallets()
		}()
	}

	wg.Wait()
	// No race conditions = success
}

// ============== Benchmark Tests ==============

func BenchmarkGetWalletStatus(b *testing.B) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.Unlock()

	app := &App{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		app.GetWalletStatus()
	}
}

func BenchmarkIsWalletOpen(b *testing.B) {
	app := &App{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		app.IsWalletOpen()
	}
}

func BenchmarkListRecentWallets(b *testing.B) {
	walletManager.Lock()
	walletManager.recentWallets = []string{"a.db", "b.db", "c.db", "d.db", "e.db"}
	walletManager.Unlock()

	app := &App{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		app.ListRecentWallets()
	}
}

// ============== Tracked-token concurrency ==============

// TestAddTrackedToken_ConcurrentNoLostUpdates verifies that trackedTokensMu
// serializes the load-modify-save of tracked_tokens.json: concurrent adds of
// distinct SCIDs must all persist, with none clobbered by a racing whole-file
// rewrite. Run under -race, it also flags any data race on the shared file.
func TestAddTrackedToken_ConcurrentNoLostUpdates(t *testing.T) {
	dir := t.TempDir()
	prev := testDataDirOverride
	testDataDirOverride = dir
	defer func() { testDataDirOverride = prev }()

	// No wallet open: AddTrackedToken still runs the persistence path and skips
	// the wallet-registration block.
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{settings: make(map[string]interface{}), consoleLogs: make([]ConsoleLog, 0)}

	const n = 50
	scids := make([]string, n)
	for i := range scids {
		// distinct, valid 64-hex SCIDs
		scids[i] = fmt.Sprintf("%064x", i+1)
	}

	var wg sync.WaitGroup
	for _, s := range scids {
		wg.Add(1)
		go func(scid string) {
			defer wg.Done()
			app.AddTrackedToken(scid, "T", "T")
		}(s)
	}
	wg.Wait()

	got := loadTrackedTokens()
	if len(got) != n {
		t.Fatalf("expected %d tracked tokens after concurrent adds, got %d (lost-update race?)", n, len(got))
	}

	seen := make(map[string]bool, n)
	for _, tok := range got {
		seen[tok.SCID] = true
	}
	for _, s := range scids {
		if !seen[s] {
			t.Errorf("SCID %s missing — clobbered by a concurrent write", s)
		}
	}
}

// ============== Token Metadata Sanitization ==============

// TestSanitizeTokenText pins the on-chain-metadata defenses: an NFA's name/symbol/
// description headers are attacker-controlled, so a crafted token must not be able
// to smuggle bidi-override or zero-width characters into the rendered identity, nor
// bloat tracked_tokens.json with an unbounded value. A regression here re-opens the
// spoofing/DoS surface, so it should fail loud.
func TestSanitizeTokenText(t *testing.T) {
	const (
		rlo = "\u202e" // right-to-left override (bidi spoofing)
		lro = "\u202d" // left-to-right override
		zwj = "\u200d" // zero-width joiner
		zws = "\u200b" // zero-width space
		bom = "\ufeff" // byte-order mark / zero-width no-break space
		wj  = "\u2060" // word joiner
	)
	cases := []struct {
		name  string
		in    string
		limit int
		want  string
	}{
		{"plain passes through", "Lotto", tokenNameLimit, "Lotto"},
		{"empty stays empty", "", tokenNameLimit, ""},
		{"bidi override stripped", "abc" + rlo + "def" + lro, tokenNameLimit, "abcdef"},
		{"zero-width family stripped", "DE" + zws + "RO" + zwj + bom + wj, tokenNameLimit, "DERO"},
		{"control chars stripped", "a\x00b\x07c\x1bd", tokenNameLimit, "abcd"},
		{"newlines/tabs collapse to space", "line1\nline2\ttail", tokenNameLimit, "line1line2 tail"},
		{"surrounding space trimmed", "  spaced  ", tokenNameLimit, "spaced"},
		{"all-junk degrades to empty", rlo + zws + bom + "\x00", tokenNameLimit, ""},
		{"length cap by rune count", strings.Repeat("x", tokenNameLimit+50), tokenNameLimit, strings.Repeat("x", tokenNameLimit)},
		{"description gets wider cap", strings.Repeat("y", tokenDescLimit+1), tokenDescLimit, strings.Repeat("y", tokenDescLimit)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeTokenText(tc.in, tc.limit)
			if got != tc.want {
				t.Errorf("sanitizeTokenText(%q, %d) = %q; want %q", tc.in, tc.limit, got, tc.want)
			}
		})
	}
}

// TestSanitizeTokenText_MultibyteCapBoundary guards that the length cap never splits
// a multi-byte rune (a byte-slice cap would corrupt the trailing character).
func TestSanitizeTokenText_MultibyteCapBoundary(t *testing.T) {
	in := strings.Repeat("é", tokenNameLimit+10) // 2 bytes per rune
	got := sanitizeTokenText(in, tokenNameLimit)
	if rc := utf8.RuneCountInString(got); rc != tokenNameLimit {
		t.Errorf("expected %d runes after cap, got %d", tokenNameLimit, rc)
	}
	if !utf8.ValidString(got) {
		t.Error("cap split a multi-byte rune — result is not valid UTF-8")
	}
}

// TestRefreshTokenMetadata_NeverBlanksExisting pins the merge rule: an empty
// fresh value (Gnomon off, or the chain has no header) must never blank a
// stored name/symbol — even in overwriteNames mode, which only lets non-empty
// chain values replace existing ones. A regression here would let a metadata
// refresh silently wipe a user's token labels.
func TestRefreshTokenMetadata_NeverBlanksExisting(t *testing.T) {
	dir := t.TempDir()
	prev := testDataDirOverride
	testDataDirOverride = dir
	defer func() { testDataDirOverride = prev }()

	app := &App{settings: make(map[string]interface{}), consoleLogs: make([]ConsoleLog, 0)}
	scid := fmt.Sprintf("%064x", 0xbeef)

	saveTrackedTokens([]TrackedToken{{SCID: scid, Name: "MyToken", Symbol: "MTK"}})

	// gnomonClient is nil → fetchTokenHeader returns the lock inputs unchanged.
	// overwriteNames=true passes empty locks, so fresh comes back all-empty —
	// the exact case that must not blank stored values.
	result := app.RefreshTokenMetadata(scid, true, true)
	if result["success"] != true {
		t.Fatalf("expected success, got %v", result["error"])
	}
	if result["changed"] != false {
		t.Error("all-empty fresh values must report changed=false")
	}

	got := loadTrackedTokens()
	if len(got) != 1 || got[0].Name != "MyToken" || got[0].Symbol != "MTK" {
		t.Errorf("stored metadata was modified: %+v", got)
	}
}

// TestRefreshTokenMetadata_PreviewWritesNothing pins apply=false as a pure
// read: even if values would change, nothing reaches disk.
func TestRefreshTokenMetadata_PreviewWritesNothing(t *testing.T) {
	dir := t.TempDir()
	prev := testDataDirOverride
	testDataDirOverride = dir
	defer func() { testDataDirOverride = prev }()

	app := &App{settings: make(map[string]interface{}), consoleLogs: make([]ConsoleLog, 0)}
	scid := fmt.Sprintf("%064x", 0xcafe)
	saveTrackedTokens([]TrackedToken{{SCID: scid, Name: "", Symbol: ""}})

	result := app.RefreshTokenMetadata(scid, false, false)
	if result["success"] != true {
		t.Fatalf("expected success, got %v", result["error"])
	}
	if _, hasUpdated := result["updated"]; hasUpdated {
		t.Error("preview must not include an updated field (nothing persisted)")
	}

	if got := loadTrackedTokens(); got[0].Name != "" {
		t.Errorf("preview persisted data: %+v", got)
	}
}

// TestRefreshTokenMetadata_UnknownSCID pins the not-tracked error path.
func TestRefreshTokenMetadata_UnknownSCID(t *testing.T) {
	dir := t.TempDir()
	prev := testDataDirOverride
	testDataDirOverride = dir
	defer func() { testDataDirOverride = prev }()

	app := &App{settings: make(map[string]interface{}), consoleLogs: make([]ConsoleLog, 0)}
	result := app.RefreshTokenMetadata(fmt.Sprintf("%064x", 0xdead), true, false)
	if result["success"] != false {
		t.Error("refresh of an untracked SCID must fail")
	}
}

// TestNetworkDerivation_IgnoresStaleSimulatorFlag pins the fix for the
// simulator→mainnet wallet bug: every simulator start path sets the derohe
// package-global --simulator flag, but it was only cleared on app launch, so a
// wallet opened after switching back to mainnet was flagged testnet — deto1
// address, "unregistered" on mainnet, sync wedged. Wallet network derivation
// must follow nodeManager.networkMode and ignore the stale global entirely.
func TestNetworkDerivation_IgnoresStaleSimulatorFlag(t *testing.T) {
	dir := t.TempDir()
	prev := testDataDirOverride
	testDataDirOverride = dir
	defer func() { testDataDirOverride = prev }()

	// Simulate the leak: a simulator session set the global and nothing reset it.
	prevFlag := globals.Arguments["--simulator"]
	globals.Arguments["--simulator"] = true
	defer func() { globals.Arguments["--simulator"] = prevFlag }()

	prevMode := nodeManager.networkMode
	nodeManager.networkMode = NetworkMainnet
	defer func() { nodeManager.networkMode = prevMode }()

	// addToRecentWalletsWithInfo stamps the session network using the same
	// derivation OpenWallet uses — it must say mainnet despite the stale flag.
	addToRecentWalletsWithInfo(filepath.Join(dir, "guard.db"), "dero1qyguardaddressxxxxxxxxxxxxxxxxxxxxxxxx")
	data := loadRecentWalletsData()
	if len(data) == 0 {
		t.Fatal("expected a recent-wallets entry")
	}
	if data[0].Network != "mainnet" {
		t.Errorf("network derivation followed the stale --simulator global: got %q, want mainnet", data[0].Network)
	}

	// And the inverse: simulator mode must still be honored.
	nodeManager.networkMode = NetworkSimulator
	addToRecentWalletsWithInfo(filepath.Join(dir, "guard2.db"), "deto1qyguardaddressxxxxxxxxxxxxxxxxxxxxxxxx")
	data = loadRecentWalletsData()
	if data[0].Network != "simulator" {
		t.Errorf("simulator mode not honored: got %q, want simulator", data[0].Network)
	}
}
