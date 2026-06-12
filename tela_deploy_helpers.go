// Copyright 2025 HOLOGRAM Project. All rights reserved.
// TELA Deploy Helpers - Extracted from tela_service.go for maintainability
// Session 87: Code restructuring

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/civilware/tela"
	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
)

// DOC content validation constants (from tela-cli).
// The tela library wraps content in a SC template that adds ~1.2–1.4KB of headers.
// MAX_DOC_CODE_SIZE must leave enough headroom so content + wrapper stays under
// the hard 19.2KB install limit enforced by tela.NewInstallArgs.
const (
	MAX_DOC_CODE_SIZE      = float64(17.5)  // Content-only limit; wrapper adds ~1.2–1.4KB → total ≤ 19.2KB
	MAX_DOC_INSTALL_SIZE   = float64(19.2)  // DOC SC total file size (including docCode) should be below this
	MAX_INDEX_INSTALL_SIZE = float64(11.64) // INDEX SC file size should be below this
)

// validateDocContent validates document content before deployment to prevent DVM crashes.
// This mirrors the validation done in tela-cli to catch issues before they reach the daemon.
func (a *App) validateDocContent(content string, fileName string) error {
	// Check for non-ASCII characters - these can crash the DVM
	for i, r := range content {
		if r > unicode.MaxASCII {
			// Find the position for helpful error message
			line := 1
			col := 1
			for j := 0; j < i; j++ {
				if content[j] == '\n' {
					line++
					col = 1
				} else {
					col++
				}
			}
			return fmt.Errorf("non-ASCII character '%c' (U+%04X) found in %s at line %d, column %d - this will crash the DVM", r, r, fileName, line, col)
		}
	}

	// Check content size
	contentSize := getCodeSizeInKB(content)
	if contentSize > MAX_DOC_CODE_SIZE {
		return fmt.Errorf("content size %.2fKB exceeds max %.2fKB for %s", contentSize, MAX_DOC_CODE_SIZE, fileName)
	}

	return nil
}

// mustCompressDocContent enforces DVM-safe storage for DOC payloads.
// Static assets are binary and CSS frequently trips DVM parsing when embedded raw.
func mustCompressDocContent(docType string, userRequested bool) bool {
	return userRequested || docType == tela.DOC_STATIC || docType == tela.DOC_CSS
}

// getCodeSizeInKB calculates the size of code in KB, counting newlines (from tela-cli)
func getCodeSizeInKB(code string) float64 {
	newLines := strings.Count(code, "\n")
	return float64(len([]byte(code))+newLines) / 1024
}

// getSimulatorTransferDestination returns a safe destination address for simulator transfers
// that is guaranteed to be different from the sender's address AND is registered on the blockchain.
//
// The issue: wallet #0's address is the same as tela.GetDefaultNetworkAddress() for simulator mode.
// If we deploy from wallet #0 to wallet #0, we get "Sending to self is not supported".
// If we use an unregistered address, we get "Account Unregistered".
//
// Solution: Use a REGISTERED wallet from the simulator wallet manager that's different from the sender.
func (a *App) getSimulatorTransferDestination(senderAddress string) string {
	// Get the default simulator destination
	_, defaultDest := tela.GetDefaultNetworkAddress()

	// Check if sender is the same as default destination (wallet #0)
	senderIsDefault := senderAddress != "" && len(senderAddress) >= 20 && strings.HasPrefix(defaultDest, senderAddress[:20])

	if !senderIsDefault {
		// Sender is not wallet #0, so we can use the default destination
		return defaultDest
	}

	// Sender IS wallet #0 - we need to find a different REGISTERED wallet

	// Try to get wallet #1 from the simulator wallet manager
	if a.simulatorManager != nil && a.simulatorManager.walletManager != nil {
		wallet1 := a.simulatorManager.walletManager.GetWallet(1)
		if wallet1 != nil && wallet1.Address != "" && wallet1.Registered {
			return wallet1.Address
		}

		// Wallet #1 not registered, try other wallets
		for i := 2; i < 22; i++ {
			wallet := a.simulatorManager.walletManager.GetWallet(i)
			if wallet != nil && wallet.Address != "" && wallet.Registered && wallet.Address != senderAddress {
				return wallet.Address
			}
		}

		a.logToConsole("[WARN] No registered alternate wallet found, using default (may fail)")
	} else {
		a.logToConsole("[WARN] Simulator wallet manager not available, using default destination")
	}

	return defaultDest
}

// BatchDeployConfig holds the configuration for a batch deployment
type BatchDeployConfig struct {
	Files       []DOCInfo `json:"files"`
	IndexName   string    `json:"indexName"`
	IndexDURL   string    `json:"indexDurl"`
	Description string    `json:"description"`
	IconURL     string    `json:"iconUrl"`
	Ringsize    uint64    `json:"ringsize"`
	Mods        string    `json:"mods"` // Comma-separated MOD tags (e.g., "vsoo,txdwd")
}

// DeployedFile represents a successfully deployed DOC
type DeployedFile struct {
	Name string `json:"name"`
	SCID string `json:"scid"`
}

// PreparedDOC represents a DOC ready for deployment
type PreparedDOC struct {
	DOC      *tela.DOC
	FileName string
	Original DOCInfo
}

// MainnetBatchBudget summarizes a pre-deployment balance gate for paid deploys.
type MainnetBatchBudget struct {
	EstimatedGas       uint64
	RequiredWithBuffer uint64
	WalletBalance      uint64
}

// setupNetworkForDeployment configures network and wallet for TELA deployment
// NOTE: For simulator mode, we DO NOT keep websocket open - the simulator daemon
// crashes when persistent connections are maintained. Instead, each transaction
// uses a temporary connect/send/disconnect pattern.
func (a *App) setupNetworkForDeployment(wallet *walletapi.Wallet_Disk, isSimulator bool) (string, error) {
	endpoint := "127.0.0.1:20000"

	// PRE-DEPLOYMENT HEALTH CHECK: Verify daemon is alive before starting
	if isSimulator {
		a.logToConsole("[CHECK] Verifying simulator daemon is healthy...")
		if a.daemonClient != nil {
			info, err := a.daemonClient.GetInfo()
			if err != nil {
				return "", fmt.Errorf("simulator daemon is not responding - please restart simulator mode: %v", err)
			}
			if info == nil {
				return "", fmt.Errorf("simulator daemon returned empty response - please restart simulator mode")
			}
			// Log daemon status
			if height, ok := info["topoheight"].(float64); ok {
				a.logToConsole(fmt.Sprintf("[OK] Simulator daemon healthy (height: %.0f)", height))
			} else {
				a.logToConsole("[OK] Simulator daemon responding")
			}
		}
	}

	if isSimulator {
		globals.Arguments["--simulator"] = true
		globals.InitNetwork()

		// Store endpoint for later use but DON'T connect yet
		// Each transaction will temporarily connect/disconnect
		walletapi.Daemon_Endpoint_Active = endpoint
		a.simulatorDeployEndpoint = endpoint // save real endpoint — Daemon_Endpoint_Active will be blanked between TXs
		a.logToConsole(fmt.Sprintf("[NET] Simulator endpoint configured: %s (temporary connect per tx)", endpoint))
	} else {
		// Get daemon endpoint for non-simulator
		if a.daemonClient != nil {
			endpoint = a.daemonClient.GetEndpoint()
			endpoint = strings.TrimPrefix(endpoint, "http://")
			endpoint = strings.TrimPrefix(endpoint, "https://")
		}

		// Privacy Mode: refuse a non-allowlisted remote daemon before walletapi opens
		// its own socket. The dialer gate would block it anyway; checking here first
		// surfaces the one-click allow-this-host opt-in instead of a bare dial error.
		if !a.checkDaemonEndpointPolicy(endpoint) {
			return "", fmt.Errorf("daemon endpoint blocked by Privacy Mode: %s", endpoint)
		}

		// Non-simulator: Connect walletapi normally
		if err := walletapi.Connect(endpoint); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] walletapi.Connect failed: %v", err))
		}
	}

	wallet.SetDaemonAddress(endpoint)
	wallet.SetOnlineMode()

	// For simulator: Do an initial sync via temporary connection
	if isSimulator {
		a.logToConsole("[SYNC] Initial wallet sync (temporary connection)...")
		if err := walletapi.Connect(endpoint); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Temporary connect failed: %v", err))
		} else {
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Wallet sync failed: %v", err))
			} else {
				a.logToConsole("[OK] Wallet synced with daemon")
			}
			// Blank endpoint first to suppress Keep_Connectivity, then disconnect.
			// deployDOC will restore it when it's ready to connect.
			walletapi.Daemon_Endpoint_Active = ""
			a.disconnectWalletAPI()
			a.logToConsole("[NET] Disconnected after initial sync")
		}
	} else {
		// Non-simulator: Normal sync with persistent connection
		a.logToConsole("[SYNC] Syncing wallet with daemon to update nonce...")
		if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Wallet sync failed: %v (continuing anyway)", err))
		} else {
			a.logToConsole("[OK] Wallet synced with daemon")
		}
	}

	return endpoint, nil
}

// prepareDOCForDeployment reads, compresses, and signs a file for DOC deployment
func (a *App) prepareDOCForDeployment(docInfo DOCInfo, wallet *walletapi.Wallet_Disk) (*PreparedDOC, error) {
	// Resolve file data — prefer in-memory content (virtual shard entries have no Path).
	// Priority: Data bytes → DataString → read from Path.
	var data []byte
	if len(docInfo.Data) > 0 {
		data = docInfo.Data
	} else if docInfo.DataString != "" {
		data = []byte(docInfo.DataString)
	} else if docInfo.Path != "" {
		var err error
		data, err = os.ReadFile(docInfo.Path)
		if err != nil {
			return nil, fmt.Errorf("failed to read file: %w", err)
		}
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("no file data provided for %s", docInfo.Name)
	}

	// Validate docType is accepted
	if !tela.IsAcceptedLanguage(docInfo.DocType) {
		return nil, fmt.Errorf("invalid docType %q for %s - must be one of: TELA-HTML-1, TELA-JS-1, TELA-CSS-1, TELA-JSON-1, TELA-MD-1, TELA-GO-1, TELA-STATIC-1", docInfo.DocType, docInfo.Name)
	}

	// Handle compression (forced for static/CSS for DVM safety)
	docCode := string(data)
	fileName := docInfo.Name

	shouldCompress := mustCompressDocContent(docInfo.DocType, docInfo.Compressed)
	if shouldCompress {
		ext := filepath.Ext(fileName)
		if !tela.IsCompressedExt(ext) {
			compressed, err := tela.Compress(data, tela.COMPRESSION_GZIP)
			if err != nil {
				return nil, fmt.Errorf("compression failed: %w", err)
			}
			docCode = compressed
			fileName = fileName + tela.COMPRESSION_GZIP

			if !docInfo.Compressed {
				a.logToConsole(fmt.Sprintf("[COMPRESS] Forced compression for %s (%s)", docInfo.Name, docInfo.DocType))
			}

			// Log compression results
			originalSize := len(data)
			compressedSize := len(compressed)
			savings := 100 - (float64(compressedSize) / float64(originalSize) * 100)
			a.logToConsole(fmt.Sprintf("[COMPRESS] %s: %d → %d bytes (%.1f%% smaller)",
				docInfo.Name, originalSize, compressedSize, savings))
		}
	}

	// CRITICAL: Validate content BEFORE signing and deployment
	// This prevents DVM crashes from non-ASCII characters or oversized content
	if err := a.validateDocContent(docCode, docInfo.Name); err != nil {
		return nil, fmt.Errorf("content validation failed: %w", err)
	}

	// Sign the (possibly compressed) file content
	signature := wallet.SignData([]byte(docCode))
	if signature == nil || len(signature) == 0 {
		return nil, fmt.Errorf("wallet.SignData returned nil")
	}

	_, checkC, checkS, err := tela.ParseSignature(signature)
	if err != nil {
		return nil, fmt.Errorf("ParseSignature failed: %w", err)
	}

	// Pad checkC and checkS to 64 chars
	checkC = padHex64(checkC)
	checkS = padHex64(checkS)

	// Build DOC
	doc := &tela.DOC{
		DocType: docInfo.DocType,
		Code:    docCode,
		SubDir:  docInfo.SubDir,
		Headers: tela.Headers{
			NameHdr:  fileName,
			DescrHdr: docInfo.Description,
		},
		Signature: tela.Signature{
			CheckC: checkC,
			CheckS: checkS,
		},
	}

	if shouldCompress {
		doc.Compression = tela.COMPRESSION_GZIP
	}

	return &PreparedDOC{
		DOC:      doc,
		FileName: fileName,
		Original: docInfo,
	}, nil
}

// disconnectWalletAPI properly disconnects the walletapi and ensures no lingering connections.
// CRITICAL for simulator mode: callers MUST blank walletapi.Daemon_Endpoint_Active BEFORE
// calling this function. Otherwise Keep_Connectivity's background goroutine will observe
// Connected==false and immediately open a competing WebSocket that crashes the daemon.
func (a *App) disconnectWalletAPI() {
	rpcClient := walletapi.GetRPCClient()
	if rpcClient != nil && rpcClient.WS != nil {
		_ = rpcClient.WS.Close()
	}

	walletapi.Connected = false

	// Give the daemon time to fully release the connection.
	// This is critical for the simulator which is single-threaded.
	time.Sleep(150 * time.Millisecond)
}

// pauseGnomonForSimulator stops Gnomon if it is running in simulator mode.
// The simulator daemon can only handle ONE WebSocket connection at a time.
// Gnomon holds a persistent WebSocket, so it must be stopped before any
// wallet WebSocket operation (deploy, invoke, etc.) and restarted after.
// Returns true if Gnomon was running and was stopped (caller must resume).
func (a *App) pauseGnomonForSimulator() bool {
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return false
	}
	a.logToConsole("[SIM] Pausing Gnomon to free simulator WebSocket slot...")
	a.gnomonClient.Stop()
	// Gnomon's WebSocket close is async — the "Closing indexer..." log appears ~1s after
	// Stop() returns. Give ample time for the WebSocket to fully close and the daemon to
	// release the connection slot before any wallet operation starts.
	time.Sleep(1500 * time.Millisecond)
	return true
}

// resumeGnomonForSimulator restarts Gnomon after a simulator WebSocket operation.
func (a *App) resumeGnomonForSimulator() {
	if a.gnomonClient == nil {
		return
	}
	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)
	a.logToConsole("[SIM] Resuming Gnomon indexer...")
	if err := a.gnomonClient.Start(endpoint, "simulator"); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Failed to restart Gnomon after deploy: %v", err))
	}
}

// pauseEpochForSimulator stops EPOCH developer support if it is active in simulator mode.
// EPOCH holds a persistent WebSocket to the daemon on the wallet WS port (10100).
// tela.GetGasEstimate also opens a WebSocket on the same port — the simulator daemon
// crashes when two concurrent WebSocket connections arrive.  EPOCH must be stopped for
// the entire duration of any simulator deploy/invoke/etc. and restarted afterward.
// Returns true if EPOCH was active and was stopped (caller must resume it).
func (a *App) pauseEpochForSimulator() bool {
	if a.epochHandler == nil || !a.epochHandler.IsActive() {
		return false
	}
	a.logToConsole("[SIM] Pausing EPOCH to free simulator WebSocket slot...")
	a.epochHandler.Shutdown()
	time.Sleep(200 * time.Millisecond)
	return true
}

// resumeEpochForSimulator restarts EPOCH developer support after a simulator WebSocket operation.
// EPOCH uses a mainnet address and is not re-connected during active simulator sessions —
// it will resume automatically when the user switches back to mainnet.
func (a *App) resumeEpochForSimulator() {
	if a.epochHandler == nil || !a.epochHandler.IsEnabled() {
		return
	}
	// Do not attempt to reconnect EPOCH while still in simulator mode.
	// The simulator daemon rejects mainnet addresses, so the connection would fail.
	// EPOCH resumes naturally the next time InitializeEpoch is called on mainnet.
	nodeManager.RLock()
	inSimulator := nodeManager.networkMode == "simulator"
	nodeManager.RUnlock()
	if inSimulator {
		a.logToConsole("[SIM] EPOCH paused for simulator session — will reconnect on mainnet")
		return
	}
	a.logToConsole("[SIM] Resuming EPOCH developer support...")
	a.InitializeEpoch()
}

// SimulatorGasFee is the initial gas fee per transaction in simulator mode.
// Gas is refunded in simulator mode, but this value is still used as DVM
// gasstorage. We start with a conservative baseline and step up automatically
// when contract verification shows the install did not materialize on-chain.
const SimulatorGasFee = uint64(25000)

var simulatorGasFeeTiers = []uint64{
	SimulatorGasFee,
	75000,
	150000,
	300000,
}

func simulatorGasFeeForAttempt(attempt int) uint64 {
	if attempt <= 1 {
		return simulatorGasFeeTiers[0]
	}
	if attempt > len(simulatorGasFeeTiers) {
		return simulatorGasFeeTiers[len(simulatorGasFeeTiers)-1]
	}
	return simulatorGasFeeTiers[attempt-1]
}

// CheckBalanceForBatchDeployment checks if the wallet has sufficient balance
// for deploying the specified number of files (DOCs + 1 INDEX)
func (a *App) CheckBalanceForBatchDeployment(wallet *walletapi.Wallet_Disk, fileCount int, isSimulator bool) (bool, uint64, uint64, error) {
	if !isSimulator {
		// Non-simulator mode doesn't need pre-check (uses real gas estimation)
		return true, 0, 0, nil
	}

	// Calculate required balance: (fileCount DOCs + 1 INDEX) * gas fee
	requiredBalance := uint64(fileCount+1) * SimulatorGasFee

	// Get current balance via temporary connection
	endpoint := walletapi.Daemon_Endpoint_Active
	if endpoint == "" || endpoint == " " {
		return false, 0, requiredBalance, fmt.Errorf("daemon endpoint not configured")
	}

	// Temporarily connect to check balance
	if err := walletapi.Connect(endpoint); err != nil {
		return false, 0, requiredBalance, fmt.Errorf("failed to connect to daemon: %v", err)
	}

	// Sync wallet to get current balance
	if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		a.disconnectWalletAPI()
		return false, 0, requiredBalance, fmt.Errorf("failed to sync wallet: %v", err)
	}

	// Get_Balance() returns stale in-memory data in simulator mode because the
	// wallet hasn't scanned the genesis/funding blocks yet.  Use the direct
	// daemon query as the primary source and fall back to Get_Balance() for
	// non-simulator / offline cases.
	var mature uint64
	walletAddr := wallet.GetAddress().String()
	var zerohash [32]byte
	if bal, _, err := wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, walletAddr); err == nil {
		mature = bal
	} else {
		mature, _ = wallet.Get_Balance()
	}

	// Disconnect - MUST close websocket properly!
	a.disconnectWalletAPI()

	if mature < requiredBalance {
		return false, mature, requiredBalance, nil
	}

	return true, mature, requiredBalance, nil
}

// precheckMainnetBatchBudget estimates gas for all DOCs + INDEX before sending any
// transaction and verifies the wallet has enough headroom. This prevents partial
// deploys where early DOCs are paid for but later steps fail due to low balance.
func (a *App) precheckMainnetBatchBudget(wallet *walletapi.Wallet_Disk, batch *BatchDeployConfig, ringsize uint64) (*MainnetBatchBudget, error) {
	if wallet == nil {
		return nil, fmt.Errorf("no wallet is currently open")
	}
	if batch == nil || len(batch.Files) == 0 {
		return nil, fmt.Errorf("batch is empty")
	}
	if ringsize == 0 {
		ringsize = 2
	}

	// Ensure we don't carry a stale long-lived websocket into estimation calls.
	// The deploy path reconnects fresh per tx anyway.
	a.disconnectWalletAPI()
	defer a.disconnectWalletAPI()

	if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Mainnet precheck wallet sync failed: %v", err))

		// One-shot reconnect + retry to smooth transient websocket drops.
		endpoint := strings.TrimSpace(walletapi.Daemon_Endpoint_Active)
		if endpoint != "" {
			a.disconnectWalletAPI()
			time.Sleep(150 * time.Millisecond)
			if connErr := walletapi.Connect(endpoint); connErr == nil {
				err = wallet.Sync_Wallet_Memory_With_Daemon()
			} else {
				a.logToConsole(fmt.Sprintf("[WARN] Mainnet precheck reconnect failed: %v", connErr))
			}
		}

		if err != nil {
			return nil, fmt.Errorf("could not verify wallet balance during mainnet precheck. Please try deploy again")
		}
	}
	// Prefer decrypted-at-topo balance to avoid stale in-memory values.
	var mature uint64
	var zerohash [32]byte
	if bal, _, err := wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, wallet.GetAddress().String()); err == nil {
		mature = bal
	} else {
		mature, _ = wallet.Get_Balance()
	}

	_, destAddr := tela.GetDefaultNetworkAddress()
	transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

	var estimated uint64

	// Estimate each DOC install using the exact prepared payload (including compression/signature).
	for i, docInfo := range batch.Files {
		prepared, err := a.prepareDOCForDeployment(docInfo, wallet)
		if err != nil {
			return nil, fmt.Errorf("precheck failed while preparing %q: %w", docInfo.Name, err)
		}
		args, err := tela.NewInstallArgs(prepared.DOC)
		if err != nil {
			return nil, fmt.Errorf("precheck failed while building args for %q: %w", docInfo.Name, err)
		}
		gas, err := tela.GetGasEstimate(wallet, ringsize, transfers, args)
		if err != nil {
			return nil, fmt.Errorf("gas estimate failed for %q (%d/%d): %w", docInfo.Name, i+1, len(batch.Files), err)
		}
		estimated += gas
	}

	// Estimate INDEX gas using placeholder DOC SCIDs (real SCIDs are unknown pre-deploy).
	// SCID width/shape stays identical, so this is a practical estimate for budget gating.
	placeholderDocs := make([]string, len(batch.Files))
	for i := range placeholderDocs {
		placeholderDocs[i] = strings.Repeat("0", 64)
	}
	indexPreview := tela.INDEX{
		DURL: batch.IndexDURL,
		DOCs: placeholderDocs,
		Mods: batch.Mods,
		Headers: tela.Headers{
			NameHdr:  batch.IndexName,
			DescrHdr: batch.Description,
			IconHdr:  batch.IconURL,
		},
	}
	indexArgs, err := tela.NewInstallArgs(&indexPreview)
	if err != nil {
		return nil, fmt.Errorf("precheck failed while building INDEX args: %w", err)
	}
	indexGas, err := tela.GetGasEstimate(wallet, ringsize, transfers, indexArgs)
	if err != nil {
		return nil, fmt.Errorf("gas estimate failed for INDEX: %w", err)
	}
	estimated += indexGas

	// Safety cushion for mempool/estimation drift so users don't get stranded mid-batch.
	// 20% + a small fixed floor keeps this conservative without being excessive.
	buffer := estimated / 5
	requiredWithBuffer := estimated + buffer + 10000

	budget := &MainnetBatchBudget{
		EstimatedGas:       estimated,
		RequiredWithBuffer: requiredWithBuffer,
		WalletBalance:      mature,
	}
	if mature < requiredWithBuffer {
		return budget, fmt.Errorf(
			"insufficient wallet balance for safe batch deploy: balance=%s DERO, estimated=%s DERO, required_with_buffer=%s DERO",
			fmt.Sprintf("%.5f", float64(mature)/100000.0),
			fmt.Sprintf("%.5f", float64(estimated)/100000.0),
			fmt.Sprintf("%.5f", float64(requiredWithBuffer)/100000.0),
		)
	}
	return budget, nil
}

// deployDOC installs a single prepared DOC and returns the SCID
// For simulator mode, uses retry logic similar to tela-cli tests
func (a *App) deployDOC(wallet *walletapi.Wallet_Disk, prepared *PreparedDOC, ringsize uint64, isSimulator bool) (string, error) {
	// Pre-flight check for simulator mode
	if isSimulator {
		// Use simulatorDeployEndpoint — Daemon_Endpoint_Active may be intentionally blank
		// between TXs to suppress walletapi.Keep_Connectivity from reconnecting.
		if a.simulatorDeployEndpoint == "" {
			return "", fmt.Errorf("simulator deploy endpoint not set - please restart simulator mode")
		}
	}

	var txid string

	if isSimulator {
		// SIMULATOR MODE: Use TEMPORARY connect/disconnect for each transaction
		// The simulator daemon CRASHES when websocket connections are kept open persistently.
		// Pattern: Connect → Sync → Build → Send → Disconnect → Wait for block (HTTP)

		endpoint := a.simulatorDeployEndpoint // Use stored endpoint, NOT Daemon_Endpoint_Active (may be blank)

		// Build install arguments (no connection needed for this)
		args, err := tela.NewInstallArgs(prepared.DOC)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to create install args for %s: %v", prepared.Original.Name, err))
			return "", err
		}

		// Create transfer with safe destination (avoids "Sending to self" error)
		senderAddr := wallet.GetAddress().String()
		destAddr := a.getSimulatorTransferDestination(senderAddr)
		transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

		// RETRY LOOP: increase gas tiers if the DOC does not materialize on-chain.
		maxRetries := len(simulatorGasFeeTiers)
		var lastErr error

		for attempt := 1; attempt <= maxRetries; attempt++ {
			if attempt > 1 {
				a.logToConsole(fmt.Sprintf("[RETRY] Attempt %d/%d for %s...", attempt, maxRetries, prepared.Original.Name))
				// Wait for a new block before retrying (like tela-cli tests do)
				if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Block wait failed: %v", err))
				}
			}

			// CRITICAL: The simulator daemon can only handle ONE websocket connection at a time.
			// walletapi.Keep_Connectivity() maintains a persistent WS on port 20000 and races
			// to reconnect the instant any disconnect fires.  We therefore skip GetGasEstimate
			// (which would open its own competing WS) and use a fixed SimulatorGasFee instead.
			// Gas is fully refunded in simulator mode anyway so the exact value doesn't matter.
			//
			// KEEP_CONNECTIVITY SUPPRESSION: Keep_Connectivity loops forever calling Connect("")
			// when Connected==false.  To prevent it from opening a competing WS during block waits,
			// we restore the endpoint here (just before connect) and blank it immediately after
			// disconnect.  With an empty endpoint, Connect("") is a no-op so the daemon stays safe.

			// STEP 1: Use fixed gas tier — no extra WebSocket needed
			gasFees := simulatorGasFeeForAttempt(attempt)
			a.logToConsole(fmt.Sprintf("[GAS] Simulator mode — using fixed gas fee: %d (gas is refunded)", gasFees))

			// STEP 2: Restore endpoint so our Connect() succeeds, then connect walletapi
			walletapi.Daemon_Endpoint_Active = endpoint
			a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi for %s (attempt %d)...", prepared.Original.Name, attempt))
			if err := walletapi.Connect(endpoint); err != nil {
				lastErr = fmt.Errorf("failed to connect to simulator daemon: %v", err)
				walletapi.Daemon_Endpoint_Active = ""
				a.disconnectWalletAPI()
				continue
			}

			// Sync wallet to get correct nonce
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-tx sync failed: %v", err))
			}
			time.Sleep(50 * time.Millisecond) // Brief settle time

			// Check wallet balance - use GetDecryptedBalanceAtTopoHeight as the
			// primary source because Get_Balance() returns stale in-memory data in
			// simulator mode until the wallet has scanned the genesis/funding blocks.
			var mature uint64
			var zerohash [32]byte
			if bal, _, err := wallet.GetDecryptedBalanceAtTopoHeight(zerohash, -1, wallet.GetAddress().String()); err == nil {
				mature = bal
			} else {
				mature, _ = wallet.Get_Balance()
			}
			_, locked := wallet.Get_Balance()
			if mature == 0 && locked == 0 {
				walletapi.Daemon_Endpoint_Active = ""
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("wallet has zero balance - registration may not have completed")
				continue
			}

			// STEP 3: Build transaction (walletapi is connected)
			tx, buildErr := wallet.TransferPayload0(transfers, ringsize, false, args, gasFees, false)
			if buildErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] TransferPayload0 failed (attempt %d): %v", attempt, buildErr))
				walletapi.Daemon_Endpoint_Active = ""
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transfer build error: %v", buildErr)
				continue
			}

			if tx == nil {
				walletapi.Daemon_Endpoint_Active = ""
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transaction is nil after build")
				continue
			}

			// Send transaction
			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] SendTransaction failed (attempt %d): %v", attempt, err))
				walletapi.Daemon_Endpoint_Active = ""
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transaction dispatch error: %v", err)
				continue
			}

			txid = tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] Transaction sent: %s", txid))

			// CRITICAL: Blank endpoint FIRST to suppress Keep_Connectivity, THEN disconnect.
			// Keep_Connectivity runs in a background goroutine and will immediately try to
			// reconnect when it sees Connected==false. If the endpoint is still set when
			// disconnectWalletAPI sets Connected=false, Keep_Connectivity opens a competing
			// WebSocket that crashes the single-connection simulator daemon.
			walletapi.Daemon_Endpoint_Active = ""
			a.disconnectWalletAPI()
			a.logToConsole("[NET] Disconnected after send (daemon freed)")

			// Wait for block confirmation via HTTP polling (no websocket needed)
			a.logToConsole("[WAIT] Waiting for block confirmation (HTTP polling)...")
			if err := a.waitForNewBlockWithHealthCheck(30 * time.Second); err != nil {
				// Check if daemon is still alive
				if a.daemonClient != nil {
					if _, rpcErr := a.daemonClient.GetInfo(); rpcErr != nil {
						return "", fmt.Errorf("daemon connection lost while waiting for block confirmation: %v", err)
					}
				}
				a.logToConsole(fmt.Sprintf("[WARN] Block wait issue: %v. Continuing...", err))
			} else {
				a.logToConsole("[OK] Block confirmed")
			}

			// Validate that this SCID is an actual DOC contract (not an empty/nonexistent SCID).
			// On simulator, this catches under-gassed installs that appear "sent" but cannot be fetched.
			if err := a.verifySimulatorDOCDeployment(txid, prepared.Original.Name, 3); err != nil {
				lastErr = fmt.Errorf("DOC install did not materialize on-chain: %v", err)
				a.logToConsole(fmt.Sprintf("[WARN] %v", lastErr))
				continue
			}

			// SUCCESS! Exit retry loop
			lastErr = nil
			break
		}

		if lastErr != nil {
			// Check if this is a known TELA deployment error and provide detailed help
			errMsg := lastErr.Error()
			if telaErr := DetectTELAError(errMsg); telaErr != nil {
				a.logToConsole(fmt.Sprintf("[HELP] %s", telaErr.Title))
				a.logToConsole(fmt.Sprintf("[HELP] Fix: %s", telaErr.Fix))
				if telaErr.Example != "" {
					a.logToConsole(fmt.Sprintf("[HELP] Example: %s", telaErr.Example))
				}
			}
			return "", fmt.Errorf("failed after %d attempts: %v", maxRetries, lastErr)
		}

	} else {
		// NON-SIMULATOR (MAINNET): Use manual transaction building for reliable nonce handling
		// The tela.Installer() library doesn't properly sync wallet nonces between transactions,
		// so we use the same manual approach that works for simulator mode.

		endpoint := walletapi.Daemon_Endpoint_Active
		if endpoint == "" {
			return "", fmt.Errorf("daemon endpoint is not set")
		}

		// Build install arguments
		args, err := tela.NewInstallArgs(prepared.DOC)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to create install args for %s: %v", prepared.Original.Name, err))
			return "", err
		}

		// Create transfer - use TELA's default network address (NOT self!)
		// DERO doesn't allow sending to yourself, even with 0 amount
		_, destAddr := tela.GetDefaultNetworkAddress()
		transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

		// RETRY LOOP for mainnet
		const maxRetries = 3
		var lastErr error

		for attempt := 1; attempt <= maxRetries; attempt++ {
			if attempt > 1 {
				a.logToConsole(fmt.Sprintf("[RETRY] Attempt %d/%d for %s...", attempt, maxRetries, prepared.Original.Name))
				// Wait before retrying
				time.Sleep(2 * time.Second)
			}

			// STEP 1: Disconnect any existing connection
			a.disconnectWalletAPI()
			time.Sleep(100 * time.Millisecond)

			// STEP 2: Get gas estimate (creates its own connection)
			a.logToConsole(fmt.Sprintf("[GAS] Getting gas estimate for %s (attempt %d)...", prepared.Original.Name, attempt))
			gasFees, gasErr := tela.GetGasEstimate(wallet, ringsize, transfers, args)
			if gasErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] GetGasEstimate failed (attempt %d): %v", attempt, gasErr))
				lastErr = fmt.Errorf("gas estimate error: %v", gasErr)
				continue
			}
			a.logToConsole(fmt.Sprintf("[OK] Gas estimate: %d", gasFees))

			// Brief pause to let GetGasEstimate's connection close
			time.Sleep(100 * time.Millisecond)

			// STEP 3: Connect walletapi fresh
			a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi for %s (attempt %d)...", prepared.Original.Name, attempt))
			if err := walletapi.Connect(endpoint); err != nil {
				lastErr = fmt.Errorf("failed to connect to daemon: %v", err)
				a.disconnectWalletAPI()
				continue
			}

			// Sync wallet to get correct nonce - do it multiple times to be sure
			for syncTry := 0; syncTry < 3; syncTry++ {
				if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Sync attempt %d failed: %v", syncTry+1, err))
				}
				time.Sleep(100 * time.Millisecond)
			}

			// STEP 4: Build transaction
			tx, buildErr := wallet.TransferPayload0(transfers, ringsize, false, args, gasFees, false)
			if buildErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] TransferPayload0 failed (attempt %d): %v", attempt, buildErr))
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transfer build error: %v", buildErr)
				continue
			}

			if tx == nil {
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transaction is nil after build")
				continue
			}

			// STEP 5: Send transaction
			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] SendTransaction failed (attempt %d): %v", attempt, err))
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("transaction dispatch error: %v", err)
				continue
			}

			txid = tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] Transaction sent: %s", txid))

			// Disconnect after send
			a.disconnectWalletAPI()

			// === POINT OF NO RETURN ===
			// The tx is on the wire. Do NOT retry from here — a second attempt
			// would send a duplicate tx, potentially orphaning the first DOC if
			// the original tx mines later. Break on any failure, never continue.

			if err := a.waitForTransactionConfirmation(txid, 120*time.Second, 3*time.Second); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] %v", err))
				lastErr = fmt.Errorf("transaction sent but not confirmed: %v", err)
				break
			}
			a.logToConsole(fmt.Sprintf("[OK] DOC transaction confirmed: %s", txid[:16]))

			if err := a.verifyDeployedDOC(txid, prepared.Original.Name, 3); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] %v", err))
				lastErr = fmt.Errorf("DOC install did not materialize on-chain: %v", err)
				break
			}

			// SUCCESS!
			lastErr = nil
			break
		}

		if lastErr != nil {
			return "", fmt.Errorf("failed after %d attempts: %v", maxRetries, lastErr)
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] tela.Installer succeeded for %s: SCID=%s", prepared.Original.Name, txid))
	return txid, nil
}

// verifyDeployedDOC checks that a deployed DOC contract has stringkeys (init() succeeded)
// Returns nil if valid, error if stringkeys are missing
func (a *App) verifyDeployedDOC(scid string, fileName string, maxRetries int) error {
	if maxRetries <= 0 {
		maxRetries = 3
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			a.logToConsole(fmt.Sprintf("[VERIFY] Retry %d/%d for %s...", attempt, maxRetries, fileName))
			time.Sleep(2 * time.Second) // Wait for blockchain propagation
		}

		// Fetch the SC data
		scData, err := a.fetchSmartContract(scid, true, true)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[VERIFY] Fetch failed (attempt %d): %v", attempt, err))
			continue
		}

		// Primary check: stringkeys indicate init() ran successfully.
		if stringKeys, hasStringKeys := scData["stringkeys"].(map[string]interface{}); hasStringKeys && len(stringKeys) > 0 {
			// Check for essential TELA DOC fields
			if _, hasFileURL := stringKeys["fileURL"]; hasFileURL {
				a.logToConsole(fmt.Sprintf("[OK] DOC %s verified: stringkeys present with fileURL", fileName))
				return nil
			}
			// Some daemons propagate metadata in stages; contract code presence is still
			// a strong signal that the install landed.
			if code, ok := scData["code"].(string); ok && strings.TrimSpace(code) != "" {
				a.logToConsole(fmt.Sprintf("[OK] DOC %s verified: contract code present (metadata still propagating)", fileName))
				return nil
			}
			a.logToConsole(fmt.Sprintf("[WARN] DOC %s has stringkeys but missing fileURL", fileName))
		}

		// Fallback: if contract code is present and non-empty, the DOC exists on-chain
		// even if stringkeys are temporarily unavailable on this node.
		if code, ok := scData["code"].(string); ok && strings.TrimSpace(code) != "" {
			a.logToConsole(fmt.Sprintf("[OK] DOC %s verified: contract code present", fileName))
			return nil
		}

		// Log what we got for debugging
		if scData != nil {
			keys := make([]string, 0)
			for k := range scData {
				keys = append(keys, k)
			}
			a.logToConsole(fmt.Sprintf("[WARN] DOC %s unresolved during verification (keys: %v)", fileName, keys))
		}
	}

	return fmt.Errorf("DOC %s unresolved after %d retries (empty code / missing metadata)", fileName, maxRetries)
}

// waitForTransactionConfirmation waits until a transaction appears in a block.
// A "sent" tx hash can still be dropped by mempool; this catches that case.
func (a *App) waitForTransactionConfirmation(txid string, timeout time.Duration, pollInterval time.Duration) error {
	if a.daemonClient == nil {
		return fmt.Errorf("daemon client not available")
	}
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		result, err := a.daemonClient.Call("DERO.GetTransaction", map[string]interface{}{
			"txs_hashes":     []string{txid},
			"decode_as_json": 0,
		})
		if err == nil {
			if resultMap, ok := result.(map[string]interface{}); ok {
				if txs, ok := resultMap["txs"].([]interface{}); ok && len(txs) > 0 {
					if tx, ok := txs[0].(map[string]interface{}); ok {
						switch bh := tx["block_height"].(type) {
						case float64:
							if int64(bh) > 0 {
								return nil
							}
						case int64:
							if bh > 0 {
								return nil
							}
						case int:
							if bh > 0 {
								return nil
							}
						}
					}
				}
			}
		}
		time.Sleep(pollInterval)
	}

	return fmt.Errorf("transaction %s was not confirmed within %s", txid, timeout)
}

// verifySimulatorDOCDeployment validates a DOC deploy in simulator mode.
// The simulator can omit stringkeys for DOCs, so we primarily verify that
// CODE is present and non-empty. Empty CODE with no metadata means the SCID
// is effectively unresolved/nonexistent for content fetch purposes.
func (a *App) verifySimulatorDOCDeployment(scid string, fileName string, maxRetries int) error {
	if maxRetries <= 0 {
		maxRetries = 3
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			a.logToConsole(fmt.Sprintf("[VERIFY] Simulator DOC retry %d/%d for %s...", attempt, maxRetries, fileName))
			time.Sleep(2 * time.Second)
		}

		scData, err := a.fetchSmartContract(scid, true, true)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[VERIFY] Simulator DOC fetch failed (attempt %d): %v", attempt, err))
			continue
		}

		if code, ok := scData["code"].(string); ok && strings.TrimSpace(code) != "" {
			a.logToConsole(fmt.Sprintf("[OK] Simulator DOC %s verified: contract code present", fileName))
			return nil
		}

		if stringKeys, hasStringKeys := scData["stringkeys"].(map[string]interface{}); hasStringKeys && len(stringKeys) > 0 {
			if _, hasFileURL := stringKeys["fileURL"]; hasFileURL {
				a.logToConsole(fmt.Sprintf("[OK] Simulator DOC %s verified: stringkeys present with fileURL", fileName))
				return nil
			}
		}

		keys := make([]string, 0, len(scData))
		for k := range scData {
			keys = append(keys, k)
		}
		a.logToConsole(fmt.Sprintf("[WARN] Simulator DOC %s unresolved during verification (keys: %v)", fileName, keys))
	}

	return fmt.Errorf("DOC %s unresolved after %d retries (empty code / missing metadata)", fileName, maxRetries)
}

// verifyDaemonStability confirms the daemon keeps answering for a short window.
// This catches cases where simulator deploy appears to succeed and then the RPC
// dies a few seconds later before the UI fetches the freshly deployed INDEX.
func (a *App) verifyDaemonStability(window time.Duration, pollInterval time.Duration) error {
	if a.daemonClient == nil {
		return fmt.Errorf("daemon client not available")
	}
	if window <= 0 {
		window = 8 * time.Second
	}
	if pollInterval <= 0 {
		pollInterval = 500 * time.Millisecond
	}

	deadline := time.Now().Add(window)
	for time.Now().Before(deadline) {
		if _, err := a.daemonClient.GetInfo(); err != nil {
			return fmt.Errorf("simulator daemon became unavailable during post-deploy verification: %v", err)
		}
		time.Sleep(pollInterval)
	}

	return nil
}

// verifyDeployedINDEX checks that an INDEX contract has the stringkeys expected
// from InitializePrivate(), confirming the contract is fetchable as TELA content.
func (a *App) verifyDeployedINDEX(scid string, durl string, maxRetries int) error {
	if maxRetries <= 0 {
		maxRetries = 3
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			a.logToConsole(fmt.Sprintf("[VERIFY] Retry %d/%d for INDEX...", attempt, maxRetries))
			time.Sleep(2 * time.Second)
		}

		scData, err := a.fetchSmartContract(scid, true, true)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[VERIFY] INDEX fetch failed (attempt %d): %v", attempt, err))
			continue
		}

		if stringKeys, hasStringKeys := scData["stringkeys"].(map[string]interface{}); hasStringKeys && len(stringKeys) > 0 {
			if _, hasDURL := stringKeys["dURL"]; hasDURL {
				if _, hasDOC1 := stringKeys["DOC1"]; hasDOC1 {
					a.logToConsole(fmt.Sprintf("[OK] INDEX verified: stringkeys present with dURL and DOC1 (%s)", durl))
					return nil
				}
			}
			a.logToConsole("[WARN] INDEX has stringkeys but is missing dURL or DOC1")
		}

		if scData != nil {
			keys := make([]string, 0)
			for k := range scData {
				keys = append(keys, k)
			}
			a.logToConsole(fmt.Sprintf("[WARN] INDEX unresolved during verification (keys: %v)", keys))
		}
	}

	return fmt.Errorf("INDEX deployed but init() may have failed - no usable stringkeys after %d retries", maxRetries)
}

// createINDEX creates a TELA INDEX from deployed DOC SCIDs
// For simulator mode, uses retry logic similar to tela-cli tests
func (a *App) createINDEX(wallet *walletapi.Wallet_Disk, config *BatchDeployConfig, docScids []string, ringsize uint64, isSimulator bool) (string, error) {
	// Log MODs if any
	modsStr := "none"
	if config.Mods != "" {
		modsStr = config.Mods
	}
	a.logToConsole(fmt.Sprintf("[INDEX] [TELA] Creating INDEX with %d DOCs, mods=%s", len(docScids), modsStr))

	index := tela.INDEX{
		DURL: config.IndexDURL,
		DOCs: docScids,
		Mods: config.Mods, // MOD tags (e.g., "vsoo,txdwd")
		Headers: tela.Headers{
			NameHdr:  config.IndexName,
			DescrHdr: config.Description,
			IconHdr:  config.IconURL,
		},
	}

	var txid string

	if isSimulator {
		// SIMULATOR MODE: Use TEMPORARY connect/disconnect with retry logic
		// The simulator daemon CRASHES with persistent websocket connections

		endpoint := a.simulatorDeployEndpoint
		if endpoint == "" {
			return "", fmt.Errorf("daemon endpoint is invalid - please restart simulator mode")
		}

		// Build install arguments for INDEX (no connection needed)
		args, err := tela.NewInstallArgs(&index)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to create INDEX install args: %v", err))
			return "", err
		}

		// Create transfer with safe destination (avoids "Sending to self" error)
		senderAddr := wallet.GetAddress().String()
		destAddr := a.getSimulatorTransferDestination(senderAddr)
		transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

		// RETRY LOOP: Similar to tela-cli tests, retry up to 3 times
		const maxRetries = 3
		var lastErr error

		for attempt := 1; attempt <= maxRetries; attempt++ {
			if attempt > 1 {
				a.logToConsole(fmt.Sprintf("[RETRY] INDEX attempt %d/%d...", attempt, maxRetries))
				// Wait for a new block before retrying
				if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Block wait failed: %v", err))
				}
			}

			a.disconnectWalletAPI()
			walletapi.Daemon_Endpoint_Active = ""
			time.Sleep(50 * time.Millisecond)

			// Skip GetGasEstimate in simulator — it opens a competing WebSocket that
			// crashes the single-connection daemon. Use fixed gas fee instead.
			gasFees := SimulatorGasFee
			a.logToConsole(fmt.Sprintf("[GAS] Simulator mode — using fixed gas fee for INDEX: %d", gasFees))

			// Connect walletapi for sync/build/send
			walletapi.Daemon_Endpoint_Active = endpoint
			a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi for INDEX (attempt %d)...", attempt))
			if err := walletapi.Connect(endpoint); err != nil {
				lastErr = fmt.Errorf("failed to connect for INDEX: %v", err)
				a.disconnectWalletAPI()
				walletapi.Daemon_Endpoint_Active = ""
				continue
			}

			// Sync wallet to get correct nonce
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-INDEX sync failed: %v", err))
			}
			time.Sleep(50 * time.Millisecond) // Settle time

			// Check wallet balance
			mature, locked := wallet.Get_Balance()

			if mature == 0 && locked == 0 {
				a.disconnectWalletAPI()
				walletapi.Daemon_Endpoint_Active = ""
				a.logToConsole("[WARN] Zero balance - waiting for mining reward...")
				for balanceWait := 0; balanceWait < 3; balanceWait++ {
					if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
						a.logToConsole(fmt.Sprintf("[WARN] Block wait failed: %v", err))
					}
					walletapi.Daemon_Endpoint_Active = endpoint
					if err := walletapi.Connect(endpoint); err == nil {
						wallet.Sync_Wallet_Memory_With_Daemon()
						mature, locked = wallet.Get_Balance()
						a.disconnectWalletAPI()
						walletapi.Daemon_Endpoint_Active = ""
					}
					if mature > 0 {
						break
					}
				}
				walletapi.Daemon_Endpoint_Active = endpoint
				if err := walletapi.Connect(endpoint); err != nil {
					lastErr = fmt.Errorf("reconnect failed after balance wait: %v", err)
					a.disconnectWalletAPI()
					walletapi.Daemon_Endpoint_Active = ""
					continue
				}
				wallet.Sync_Wallet_Memory_With_Daemon()
				time.Sleep(50 * time.Millisecond)
			}

			// Build transaction
			tx, buildErr := wallet.TransferPayload0(transfers, ringsize, false, args, gasFees, false)
			if buildErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] TransferPayload0 failed for INDEX (attempt %d): %v", attempt, buildErr))
				a.disconnectWalletAPI()
				walletapi.Daemon_Endpoint_Active = ""
				lastErr = fmt.Errorf("INDEX transfer build error: %v", buildErr)
				continue
			}

			if tx == nil {
				a.disconnectWalletAPI()
				walletapi.Daemon_Endpoint_Active = ""
				lastErr = fmt.Errorf("INDEX transaction is nil")
				continue
			}

			// Send transaction
			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] SendTransaction failed for INDEX (attempt %d): %v", attempt, err))
				a.disconnectWalletAPI()
				walletapi.Daemon_Endpoint_Active = ""
				lastErr = fmt.Errorf("INDEX transaction dispatch error: %v", err)
				continue
			}

			txid = tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] INDEX transaction sent: %s", txid))

			// CRITICAL: Disconnect IMMEDIATELY and blank endpoint
			a.disconnectWalletAPI()
			walletapi.Daemon_Endpoint_Active = ""
			a.logToConsole("[NET] Disconnected (batch complete)")

			// SUCCESS! Exit retry loop
			lastErr = nil
			break
		}

		if lastErr != nil {
			return "", fmt.Errorf("INDEX creation failed after %d attempts: %v", maxRetries, lastErr)
		}

	} else {
		// NON-SIMULATOR (MAINNET): Use manual transaction building for reliable nonce handling
		endpoint := walletapi.Daemon_Endpoint_Active
		if endpoint == "" {
			return "", fmt.Errorf("daemon endpoint is not set")
		}

		// Build INDEX install arguments
		args, err := tela.NewInstallArgs(&index)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to create INDEX install args: %v", err))
			return "", err
		}

		// Create transfer - use TELA's default network address (NOT self!)
		_, destAddr := tela.GetDefaultNetworkAddress()
		transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

		// RETRY LOOP for mainnet INDEX
		const maxRetries = 3
		var lastErr error

		for attempt := 1; attempt <= maxRetries; attempt++ {
			if attempt > 1 {
				a.logToConsole(fmt.Sprintf("[RETRY] INDEX attempt %d/%d...", attempt, maxRetries))
				time.Sleep(2 * time.Second)
			}

			// STEP 1: Disconnect any existing connection
			a.disconnectWalletAPI()
			time.Sleep(100 * time.Millisecond)

			// STEP 2: Get gas estimate
			a.logToConsole(fmt.Sprintf("[GAS] Getting gas estimate for INDEX (attempt %d)...", attempt))
			gasFees, gasErr := tela.GetGasEstimate(wallet, ringsize, transfers, args)
			if gasErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] INDEX GetGasEstimate failed (attempt %d): %v", attempt, gasErr))
				lastErr = fmt.Errorf("INDEX gas estimate error: %v", gasErr)
				continue
			}
			a.logToConsole(fmt.Sprintf("[OK] INDEX gas estimate: %d", gasFees))

			time.Sleep(100 * time.Millisecond)

			// STEP 3: Connect walletapi fresh
			a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi for INDEX (attempt %d)...", attempt))
			if err := walletapi.Connect(endpoint); err != nil {
				lastErr = fmt.Errorf("failed to connect to daemon for INDEX: %v", err)
				a.disconnectWalletAPI()
				continue
			}

			// Sync wallet multiple times
			for syncTry := 0; syncTry < 3; syncTry++ {
				if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] INDEX sync attempt %d failed: %v", syncTry+1, err))
				}
				time.Sleep(100 * time.Millisecond)
			}

			// STEP 4: Build transaction
			tx, buildErr := wallet.TransferPayload0(transfers, ringsize, false, args, gasFees, false)
			if buildErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] INDEX TransferPayload0 failed (attempt %d): %v", attempt, buildErr))
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("INDEX transfer build error: %v", buildErr)
				continue
			}

			if tx == nil {
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("INDEX transaction is nil after build")
				continue
			}

			// STEP 5: Send transaction
			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] INDEX SendTransaction failed (attempt %d): %v", attempt, err))
				a.disconnectWalletAPI()
				lastErr = fmt.Errorf("INDEX transaction dispatch error: %v", err)
				continue
			}

			txid = tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] INDEX transaction sent: %s", txid))

			// Disconnect after send
			a.disconnectWalletAPI()

			// === POINT OF NO RETURN ===
			// Same safety rule as DOC: tx is on the wire, no retries.

			if err := a.waitForTransactionConfirmation(txid, 120*time.Second, 3*time.Second); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] %v", err))
				lastErr = fmt.Errorf("INDEX transaction sent but not confirmed: %v", err)
				break
			}
			a.logToConsole(fmt.Sprintf("[OK] INDEX transaction confirmed: %s", txid[:16]))

			if err := a.verifyDeployedINDEX(txid, config.IndexDURL, 3); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] %v", err))
				lastErr = fmt.Errorf("INDEX did not materialize on-chain: %v", err)
				break
			}
			a.logToConsole("[OK] INDEX verified on-chain")

			// SUCCESS!
			lastErr = nil
			break
		}

		if lastErr != nil {
			return "", fmt.Errorf("INDEX creation failed after %d attempts: %v", maxRetries, lastErr)
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] INDEX created: SCID=%s, dURL=%s", txid, config.IndexDURL))
	return txid, nil
}

// padHex64 pads a hex string to 64 characters with leading zeros
func padHex64(s string) string {
	if len(s) < 64 {
		return strings.Repeat("0", 64-len(s)) + s
	}
	return s
}

// waitForNewBlockWithHealthCheck waits for a new block using HTTP polling (safer than websocket subscriptions)
// This prevents hanging indefinitely if the daemon crashes and detects crashes early
// IMPORTANT: Uses HTTP RPC polling instead of walletapi.WaitNewHeightBlock() which can cause
// websocket issues with the simulator daemon
func (a *App) waitForNewBlockWithHealthCheck(timeout time.Duration) error {
	// Get current height
	startHeight := int64(0)
	if a.daemonClient != nil {
		info, err := a.daemonClient.GetInfo()
		if err != nil {
			return fmt.Errorf("failed to get initial height: %v", err)
		}
		// Extract topoheight from map
		if th, ok := info["topoheight"].(float64); ok {
			startHeight = int64(th)
		} else if th, ok := info["topoheight"].(int64); ok {
			startHeight = th
		}
	} else {
		return fmt.Errorf("daemon client not available")
	}

	// Start with faster polling to detect daemon crashes quickly
	// Then slow down after confirming daemon is alive
	fastPollInterval := 200 * time.Millisecond   // Fast initial polls
	normalPollInterval := 500 * time.Millisecond // Normal interval
	timeoutTime := time.Now().Add(timeout)
	pollCount := 0
	consecutiveFailures := 0

	for time.Now().Before(timeoutTime) {
		pollCount++
		// Use fast polling for first 5 polls (1 second), then normal
		interval := normalPollInterval
		if pollCount <= 5 {
			interval = fastPollInterval
		}
		time.Sleep(interval)

		// Check daemon via HTTP RPC (not websocket)
		if a.daemonClient != nil {
			info, err := a.daemonClient.GetInfo()
			if err != nil {
				consecutiveFailures++
				// If we get 2 consecutive failures, daemon is likely crashed
				if consecutiveFailures >= 2 {
					return fmt.Errorf("daemon crashed - please restart simulator mode (error: %v)", err)
				}
				continue
			}
			consecutiveFailures = 0 // Reset on success

			// Extract topoheight from map
			var currentHeight int64
			if th, ok := info["topoheight"].(float64); ok {
				currentHeight = int64(th)
			} else if th, ok := info["topoheight"].(int64); ok {
				currentHeight = th
			}

			if currentHeight > startHeight {
				a.logToConsole(fmt.Sprintf("[OK] New block detected: %d → %d", startHeight, currentHeight))
				return nil // New block found!
			}
		}
	}

	return fmt.Errorf("timeout after %v waiting for new block", timeout)
}

// =============================================================================
// Auto-Shard Preflight — Phase 1
// =============================================================================

// PreflightConfig controls how buildPreflightExpansion behaves.
type PreflightConfig struct {
	AutoShard bool   `json:"autoShard"`
	Compress  bool   `json:"compress"`
	IndexDURL string `json:"indexDurl"` // passed through to summary for context
}

// ShardEntry describes one shard produced from an oversized source file.
// ShardIndex 0 is a sentinel meaning the file fit in one DOC (no splitting occurred).
type ShardEntry struct {
	Name         string `json:"name"`
	Content      string `json:"content"`
	ShardIndex   int    `json:"shardIndex"`
	ShardCount   int    `json:"shardCount"`
	OriginalName string `json:"originalName"`
	InstallBytes int    `json:"installBytes"`
}

// ShardGroup groups all shard entries that came from a single source file.
// Returned in PreflightExpansion so the frontend can render provenance:
// "rive.js → 4 shard DOCs".
type ShardGroup struct {
	OriginalName      string       `json:"originalName"`
	DocType           string       `json:"docType"`
	ShardCount        int          `json:"shardCount"`
	TotalInstallBytes int          `json:"totalInstallBytes"`
	Shards            []ShardEntry `json:"shards"`
}

// PreflightSummary is the aggregated statistics returned to the frontend.
// EstimatedGas is the only pre-deploy gas number the frontend should display
// when auto-shard is active — it replaces ScanFolder.totalGas.
type PreflightSummary struct {
	SourceFileCount   int    `json:"sourceFileCount"`
	DeployDocCount    int    `json:"deployDocCount"`
	ShardCount        int    `json:"shardCount"`
	TotalSourceBytes  int64  `json:"totalSourceBytes"`
	TotalInstallBytes int    `json:"totalInstallBytes"`
	EstimatedGas      uint64 `json:"estimatedGas"`
}

// PreflightExpansion is the full response from buildPreflightExpansion.
// DeployFiles is the expanded, ready-to-deploy DOCInfo list.
// Phase 3 will wire DeployTELABatch to consume DeployFiles directly.
type PreflightExpansion struct {
	DeployFiles []DOCInfo
	ShardGroups []ShardGroup
	Warnings    []string
	Summary     PreflightSummary
}

// expandFileToShards splits content into DOC-sized chunks using binary search.
// content must already be in its final deploy form (post-compression if applicable).
// Returns a single-entry slice when the content fits in one DOC (fast path).
// ShardIndex is 0 on the fast-path entry (sentinel: "not a shard").
// ShardCount is backfilled on all entries once the total is known.
func expandFileToShards(content, fileName, docType string) ([]ShardEntry, error) {
	// Fast path: content already fits in one DOC
	if getCodeSizeInKB(content) <= MAX_DOC_CODE_SIZE {
		return []ShardEntry{{
			Name:         fileName,
			Content:      content,
			ShardIndex:   0, // sentinel: file was not split
			ShardCount:   1,
			OriginalName: fileName,
			InstallBytes: len(content),
		}}, nil
	}

	ext := filepath.Ext(fileName)
	base := strings.TrimSuffix(fileName, ext)

	runes := []rune(content)
	var shards []ShardEntry
	cursor := 0
	shardIndex := 1

	for cursor < len(runes) {
		low := cursor + 1
		high := len(runes)
		bestEnd := -1

		for low <= high {
			mid := (low + high) / 2
			chunk := string(runes[cursor:mid])
			if getCodeSizeInKB(chunk) <= MAX_DOC_CODE_SIZE {
				bestEnd = mid
				low = mid + 1
			} else {
				high = mid - 1
			}
		}

		if bestEnd == -1 {
			return nil, fmt.Errorf("cannot shard %s: a single character exceeds the DOC size limit", fileName)
		}

		shardName := fmt.Sprintf("%s-%d%s", base, shardIndex, ext)
		chunk := string(runes[cursor:bestEnd])
		shards = append(shards, ShardEntry{
			Name:         shardName,
			Content:      chunk,
			ShardIndex:   shardIndex,
			OriginalName: fileName,
			InstallBytes: len(chunk),
		})
		cursor = bestEnd
		shardIndex++
	}

	// Backfill ShardCount on all entries now that the total is known
	total := len(shards)
	for i := range shards {
		shards[i].ShardCount = total
	}
	return shards, nil
}

// readDocContent resolves the content of a DOCInfo for preflight analysis.
// If compress is true and the file is not already compressed, GZIP is applied.
// This mirrors the compress-first pipeline enforced in ShardFile and prepareDOCForDeployment.
func (a *App) readDocContent(f DOCInfo, compress bool) (string, error) {
	var data []byte
	if len(f.Data) > 0 {
		data = f.Data
	} else if f.DataString != "" {
		data = []byte(f.DataString)
	} else if f.Path != "" {
		var err error
		data, err = os.ReadFile(f.Path)
		if err != nil {
			return "", fmt.Errorf("cannot read %s: %w", f.Name, err)
		}
	}
	if len(data) == 0 {
		return "", fmt.Errorf("no content source for %s", f.Name)
	}

	if compress && !tela.IsCompressedExt(filepath.Ext(f.Name)) {
		compressed, err := tela.Compress(data, tela.COMPRESSION_GZIP)
		if err != nil {
			return "", fmt.Errorf("compression failed for %s: %w", f.Name, err)
		}
		return compressed, nil
	}
	return string(data), nil
}

// buildPreflightExpansion processes a list of DOCInfos and returns an expanded
// deploy plan. When a file exceeds MAX_DOC_CODE_SIZE it is split in-memory into
// shard DOCInfos — no files are written to disk.
//
// Decision #3 (§12.16): oversized index.html (exact name match, case-insensitive)
// is rejected with a clear error. Other oversized files are auto-sharded normally.
func (a *App) buildPreflightExpansion(files []DOCInfo, config PreflightConfig) (PreflightExpansion, error) {
	var result PreflightExpansion
	var deployFiles []DOCInfo
	var shardGroups []ShardGroup
	var warnings []string
	var totalSourceBytes int64
	var totalInstallBytes int
	var totalShardCount int
	var totalGas uint64

	for _, f := range files {
		totalSourceBytes += f.Size

		// All non-HTML DOC types must be compressed (base64+gzip) for DVM storage.
		// TELA-STATIC-1: raw binary bytes contain non-ASCII characters.
		// TELA-CSS-1: CSS syntax (colons, braces) confuses the DVM BASIC parser,
		//   causing SC init() to fail even though the TX is accepted on-chain.
		// HTML is the only type whose content is safely embedded in the SC template.
		mustCompress := config.Compress || f.DocType == tela.DOC_STATIC || f.DocType == tela.DOC_CSS
		content, err := a.readDocContent(f, mustCompress)
		if err != nil {
			return result, err
		}

		// Compute the deploy filename (append .gz suffix when compressed)
		deployName := f.Name
		if mustCompress && !tela.IsCompressedExt(filepath.Ext(f.Name)) {
			deployName = f.Name + tela.COMPRESSION_GZIP
		}

		// Reject oversized index.html — auto-sharding it would break entrypoint ordering.
		if strings.EqualFold(f.Name, "index.html") && getCodeSizeInKB(content) > MAX_DOC_CODE_SIZE {
			return result, fmt.Errorf(
				"index.html exceeds the %.0fKB DOC limit and cannot be auto-sharded — "+
					"splitting index.html would break the TELA application entrypoint (DOC1). "+
					"Please reduce its size or split it manually.",
				MAX_DOC_CODE_SIZE,
			)
		}

		shards, err := expandFileToShards(content, deployName, f.DocType)
		if err != nil {
			return result, fmt.Errorf("failed to expand %s: %w", f.Name, err)
		}

		group := ShardGroup{
			OriginalName: f.Name,
			DocType:      f.DocType,
			ShardCount:   len(shards),
		}

		for _, shard := range shards {
			group.TotalInstallBytes += shard.InstallBytes
			group.Shards = append(group.Shards, shard)

			totalInstallBytes += shard.InstallBytes
			gasEstimate := estimateGasCost(shard.InstallBytes)
			totalGas += gasEstimate

			deployFiles = append(deployFiles, DOCInfo{
				Name:        shard.Name,
				SubDir:      f.SubDir,
				DocType:     f.DocType,
				Compressed:  mustCompress,
				DataString:  shard.Content,
				Description: f.Description,
				IconURL:     f.IconURL,
				Ringsize:    f.Ringsize,
				Size:        int64(shard.InstallBytes),
			})

			if shard.ShardIndex > 0 {
				totalShardCount++
			}
		}

		if len(shards) > 1 {
			warnings = append(warnings, fmt.Sprintf(
				"%s will be split into %d shard DOCs",
				f.Name, len(shards),
			))
		}

		if group.ShardCount > 1 {
			shardGroups = append(shardGroups, group)
		}
	}

	// Add a conservative INDEX gas estimate (INDEX SC is typically ~500 bytes of template)
	totalGas += estimateGasCost(512)

	result = PreflightExpansion{
		DeployFiles: deployFiles,
		ShardGroups: shardGroups,
		Warnings:    warnings,
		Summary: PreflightSummary{
			SourceFileCount:   len(files),
			DeployDocCount:    len(deployFiles),
			ShardCount:        totalShardCount,
			TotalSourceBytes:  totalSourceBytes,
			TotalInstallBytes: totalInstallBytes,
			EstimatedGas:      totalGas,
		},
	}
	return result, nil
}
