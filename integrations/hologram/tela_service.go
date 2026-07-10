package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/civilware/tela"
	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TELAService handles TELA content operations

// txidCache stores SCID+Height -> TXID mappings to avoid repeated daemon queries
// Key format: "scid:height" e.g. "abc123...:12345"
var txidCache sync.Map

// DOCInfo represents information about a file to be installed as a DOC
type DOCInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	SubDir      string `json:"subDir"`
	DocType     string `json:"docType"`
	Size        int64  `json:"size"`
	Compressed  bool   `json:"compressed"`
	Data        []byte `json:"-"`
	DataString  string `json:"data"` // Accept data as string from frontend
	Description string `json:"description"`
	IconURL     string `json:"iconUrl"`
	Ringsize    int    `json:"ringsize"` // 2 = updateable, 16+ = immutable
}

// INDEXInfo represents information for creating a TELA INDEX
type INDEXInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	DURL        string   `json:"durl"`
	IconURL     string   `json:"iconUrl"`
	DOCSCIDs    []string `json:"docScids"`
	Licenses    []string `json:"licenses"`
	Ringsize    int      `json:"ringsize"` // 2 = updateable, 16+ = immutable
	Mods        string   `json:"mods"`     // Comma-separated MOD tags (e.g., "vsoo,txdwd")
}

// sortFilesForDeployment sorts files to ensure the entry point (index.html) is deployed first.
// In TELA, the first DOC deployed becomes DOC1, which is the application's entry point.
// Without proper sorting, alphabetical order could make blocks.js the entrypoint instead of index.html.
func sortFilesForDeployment(files []DOCInfo) {
	if len(files) <= 1 {
		return
	}

	// Find the entry point file (index.html or index.htm in root directory)
	entryIndex := -1
	for i, f := range files {
		name := strings.ToLower(f.Name)
		subDir := strings.TrimSpace(f.SubDir)
		isRoot := subDir == "" || subDir == "/"

		if isRoot && (name == "index.html" || name == "index.htm") {
			entryIndex = i
			break
		}
	}

	// If entry point found and not already first, move it to the front
	if entryIndex > 0 {
		entryFile := files[entryIndex]
		// Shift all files before the entry point one position to the right
		copy(files[1:entryIndex+1], files[0:entryIndex])
		files[0] = entryFile
	}
}

// InstallDOC installs a single TELA DOC smart contract
func (a *App) InstallDOC(docJSON string) map[string]interface{} {
	isSimulator := a.IsInSimulatorMode()
	modeStr := ""
	if isSimulator {
		modeStr = " [SIMULATOR]"
	}
	a.logToConsole(fmt.Sprintf("[DOC] [TELA] InstallDOC: Starting installation...%s", modeStr))

	// Check wallet - use simulator wallet in simulator mode, otherwise main wallet
	wallet := a.getWalletForDeployment(isSimulator)
	if wallet == nil {
		errMsg := "No wallet is currently open"
		if isSimulator {
			errMsg = "Simulator wallet is not open. Restart simulator mode."
		}
		return map[string]interface{}{
			"success": false,
			"error":   errMsg,
		}
	}

	// Parse DOC info
	var docInfo DOCInfo
	if err := json.Unmarshal([]byte(docJSON), &docInfo); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Invalid DOC format. Please check your input.",
			"technicalError": err.Error(),
		}
	}

	// Convert DataString to Data if provided (from frontend)
	if len(docInfo.Data) == 0 && docInfo.DataString != "" {
		docInfo.Data = []byte(docInfo.DataString)
		a.logToConsole(fmt.Sprintf("[DOC] Received file data from frontend: %d bytes", len(docInfo.Data)))
	}

	// Read file content if path is provided (fallback for local file paths)
	if docInfo.Path != "" && len(docInfo.Data) == 0 {
		data, err := os.ReadFile(docInfo.Path)
		if err != nil {
			return ErrorResponse(err)
		}
		docInfo.Data = data
	}

	if len(docInfo.Data) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No file data provided",
		}
	}

	// Handle compression if requested (matching tela-cli install-doc behavior)
	// Compression must happen BEFORE signing, as we sign the compressed data
	docCode := string(docInfo.Data)
	fileName := docInfo.Name
	compressionStr := "none"

	if docInfo.Compressed {
		// Check if file is already compressed (has .gz extension)
		ext := filepath.Ext(fileName)
		if !tela.IsCompressedExt(ext) {
			// Compress the data using gzip (matching tela-cli)
			compressed, err := tela.Compress(docInfo.Data, tela.COMPRESSION_GZIP)
			if err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] [TELA] InstallDOC: Compression failed - %v", err))
				return map[string]interface{}{
					"success":        false,
					"error":          "Failed to compress file data",
					"technicalError": err.Error(),
				}
			}
			docCode = compressed
			fileName = fileName + tela.COMPRESSION_GZIP // Append .gz to filename
			compressionStr = "gzip"

			// Log compression results
			originalSize := len(docInfo.Data)
			compressedSize := len(compressed)
			savings := 100 - (float64(compressedSize) / float64(originalSize) * 100)
			a.logToConsole(fmt.Sprintf("[COMPRESS] %s: %d → %d bytes (%.1f%% smaller)",
				docInfo.Name, originalSize, compressedSize, savings))
		} else {
			// File already has compression extension
			compressionStr = ext
		}
	}

	// Sign the (possibly compressed) file content to generate CheckC and CheckS
	// IMPORTANT: We sign docCode, not docInfo.Data, as tela-cli signs the compressed data
	signature := wallet.SignData([]byte(docCode))
	if signature == nil || len(signature) == 0 {
		a.logToConsole("[ERR] [TELA] InstallDOC: wallet.SignData returned nil or empty")
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to sign file content",
		}
	}

	// Parse the signature to extract C and S values
	_, checkC, checkS, err := tela.ParseSignature(signature)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] InstallDOC: ParseSignature failed - %v", err))
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to parse signature",
			"technicalError": err.Error(),
		}
	}

	// IMPORTANT: CheckC and CheckS must be exactly 64 hex characters (32 bytes)
	// The signature may have fewer characters if there are leading zeros
	// Pad with leading zeros if needed
	if len(checkC) < 64 {
		checkC = strings.Repeat("0", 64-len(checkC)) + checkC
	}
	if len(checkS) < 64 {
		checkS = strings.Repeat("0", 64-len(checkS)) + checkS
	}

	// Build DOC structure (matching tela-cli)
	doc := tela.DOC{
		DocType: docInfo.DocType,
		Code:    docCode, // Use compressed code if compression enabled
		SubDir:  docInfo.SubDir,
		Headers: tela.Headers{
			NameHdr:  fileName, // Use filename with .gz extension if compressed
			DescrHdr: docInfo.Description,
			IconHdr:  docInfo.IconURL,
		},
		Signature: tela.Signature{
			CheckC: checkC,
			CheckS: checkS,
		},
	}

	// Set compression field on DOC struct
	if docInfo.Compressed {
		doc.Compression = tela.COMPRESSION_GZIP
	}

	a.logToConsole(fmt.Sprintf("[DOC] [TELA] InstallDOC: %s (type=%s, size=%d, subdir=%s, compression=%s)",
		docInfo.Name, docInfo.DocType, len(docInfo.Data), docInfo.SubDir, compressionStr))

	// Set up network configuration
	// CRITICAL: In simulator mode, we must NOT call walletapi.Connect() because:
	// 1. walletapi.Connect() creates a persistent websocket connection
	// 2. tela.GetGasEstimate() creates its OWN websocket connection
	// 3. The simulator daemon can only handle ONE websocket at a time
	// 4. Having both connections open crashes the daemon
	//
	// Solution: In simulator mode, only set the endpoint variable and flags.
	// Let the tela library create its own connection for everything.
	endpoint := "127.0.0.1:20000"

	if isSimulator {
		// Set globals for simulator
		globals.Arguments["--simulator"] = true
		globals.InitNetwork()

		// Set wallet daemon address and mode (no websocket connection yet)
		wallet.SetDaemonAddress(endpoint)
		wallet.SetOnlineMode()

		// Set the endpoint variable that tela.GetGasEstimate() uses
		walletapi.Daemon_Endpoint_Active = endpoint

		// Set Connected=true so TransferPayload0 doesn't reject as "offline"
		// NOTE: We're NOT creating a real walletapi websocket connection!
		// The tela library creates its own connection via GetGasEstimate().
		// Setting Connected=true just satisfies the check in TransferPayload0.
		walletapi.Connected = true

		a.logToConsole("[OK] Proceeding with installation (tela library will create its own websocket)")
	} else {
		// For mainnet: use setupNetworkForDeployment (which calls walletapi.Connect)
		var err error
		endpoint, err = a.setupNetworkForDeployment(wallet, isSimulator)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] setupNetworkForDeployment failed: %v", err))
			return map[string]interface{}{
				"success":        false,
				"error":          "Failed to setup network for deployment",
				"technicalError": err.Error(),
			}
		}
	}

	// Install DOC using tela library
	// Ringsize: 2 = updateable, 16+ = immutable (anonymous)
	ringsize := uint64(2) // Default: updateable
	if docInfo.Ringsize >= 2 {
		ringsize = uint64(docInfo.Ringsize)
	}
	a.logToConsole(fmt.Sprintf("[DOC] Using ringsize=%d (updateable=%v)", ringsize, ringsize <= 2))

	var txid string
	if isSimulator {
		// SIMULATOR MODE: Bypass tela.Installer() to avoid websocket conflicts
		// Uses retry logic similar to tela-cli tests for better reliability

		a.logToConsole("[DOC] Using simulator-specific installation with GetGasEstimate validation")

		// PRE-DEPLOYMENT HEALTH CHECK: Verify daemon is alive
		if a.daemonClient != nil {
			if _, err := a.daemonClient.GetInfo(); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] Simulator daemon not responding: %v", err))
				return map[string]interface{}{
					"success":        false,
					"error":          "Cannot connect to simulator daemon. Please restart simulator mode.",
					"technicalError": err.Error(),
				}
			}
			a.logToConsole("[OK] Simulator daemon responding")
		}

		// Build install arguments
		args, err := tela.NewInstallArgs(&doc)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to create install args: %v", err))
			return ErrorResponse(err)
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
				a.logToConsole(fmt.Sprintf("[RETRY] Attempt %d/%d...", attempt, maxRetries))
				// Wait for a new block before retrying
				if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Block wait failed: %v", err))
				}
			}

			// CRITICAL: The simulator daemon can only handle ONE websocket connection at a time.
			// tela.GetGasEstimate() creates its own websocket connection internally.
			// So we must: 1) Call GetGasEstimate (creates/closes its own WS), 2) Then connect walletapi

			// STEP 1: Ensure walletapi is DISCONNECTED before calling GetGasEstimate
			a.disconnectWalletAPI()
			time.Sleep(50 * time.Millisecond) // Brief settle time for daemon

			// STEP 2: Get gas estimate - this validates SC code AND creates its own temporary websocket
			a.logToConsole(fmt.Sprintf("[GAS] Getting gas estimate (attempt %d)...", attempt))
			gasFees, gasErr := tela.GetGasEstimate(wallet, ringsize, transfers, args)
			if gasErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] GetGasEstimate failed (attempt %d): %v", attempt, gasErr))
				lastErr = fmt.Errorf("failed to get gas estimate: %v", gasErr)
				continue
			}
			a.logToConsole(fmt.Sprintf("[OK] Gas estimate: %d", gasFees))

			// Brief pause to let GetGasEstimate's websocket fully close
			time.Sleep(100 * time.Millisecond)

			// STEP 3: NOW connect walletapi for sync/build/send
			a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi (attempt %d): %s", attempt, endpoint))
			if err := walletapi.Connect(endpoint); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] walletapi.Connect failed (attempt %d): %v", attempt, err))
				lastErr = fmt.Errorf("failed to connect to simulator daemon: %v", err)
				a.disconnectWalletAPI()
				continue
			}

			// Sync wallet to get correct nonce
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-tx sync failed: %v", err))
			}
			time.Sleep(50 * time.Millisecond) // Brief settle time

			// Build transaction
			tx, buildErr := wallet.TransferPayload0(transfers, ringsize, false, args, gasFees, false)
			if buildErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] TransferPayload0 failed (attempt %d): %v", attempt, buildErr))
				lastErr = fmt.Errorf("transfer build error: %v", buildErr)
				a.disconnectWalletAPI()
				continue
			}

			if tx == nil {
				lastErr = fmt.Errorf("transaction is nil after build")
				a.disconnectWalletAPI()
				continue
			}

			// Send transaction
			if err := wallet.SendTransaction(tx); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] SendTransaction failed (attempt %d): %v", attempt, err))
				lastErr = fmt.Errorf("transaction dispatch error: %v", err)
				a.disconnectWalletAPI()
				continue
			}

			txid = tx.GetHash().String()
			a.logToConsole(fmt.Sprintf("[OK] Transaction sent: %s", txid))

			// Disconnect walletapi (cleanup)
			a.disconnectWalletAPI()
			a.logToConsole("[NET] Disconnected after send")

			// SUCCESS! Exit retry loop
			lastErr = nil
			break
		}

		if lastErr != nil {
			return map[string]interface{}{
				"success":        false,
				"error":          fmt.Sprintf("Failed after %d attempts: %v", maxRetries, lastErr),
				"technicalError": lastErr.Error(),
			}
		}
	} else {
		// NON-SIMULATOR: Use standard tela.Installer() (supports multiple connections)
		var err error
		txid, err = tela.Installer(wallet, ringsize, &doc)
		if err != nil {
			// Handle "Account Unregistered" error specifically
			if strings.Contains(err.Error(), "Account Unregistered") || strings.Contains(err.Error(), "-32098") {
				a.logToConsole("[ERR] Wallet not registered on blockchain")
				return map[string]interface{}{
					"success":           false,
					"error":             "Wallet not registered. Please click 'Auto-mines to confirm' button or start mining to register your wallet on the simulator blockchain.",
					"technicalError":    err.Error(),
					"needsRegistration": true,
				}
			}
			a.logToConsole(fmt.Sprintf("[ERR] [TELA] InstallDOC: Failed - %v", err))
			return ErrorResponse(err)
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] [TELA] InstallDOC: Success! SCID=%s", txid))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"message": "DOC installed successfully",
	}
}

// PreviewDOC analyzes a file and returns DOC metadata without installing
func (a *App) PreviewDOC(filePath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] [TELA] PreviewDOC: Analyzing %s", filepath.Base(filePath)))

	// Check file exists
	info, err := os.Stat(filePath)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] PreviewDOC: File not found - %s", filePath))
		return map[string]interface{}{
			"success":        false,
			"error":          "File not found. Check the path.",
			"technicalError": err.Error(),
		}
	}

	// Detect doc type from extension
	ext := strings.ToLower(filepath.Ext(filePath))
	docType := tela.ParseDocType(filepath.Base(filePath))

	// Read file for size and potential compression estimate
	data, err := os.ReadFile(filePath)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] PreviewDOC: Failed to read file - %v", err))
		return ErrorResponse(err)
	}

	// Estimate gas cost (simplified calculation)
	gasEstimate := estimateGasCost(len(data))
	compress := canCompress(docType)

	a.logToConsole(fmt.Sprintf("[OK] [TELA] PreviewDOC: %s (%d bytes, type=%s, compress=%v, gas=%d)",
		filepath.Base(filePath), info.Size(), docType, compress, gasEstimate))

	return map[string]interface{}{
		"success":     true,
		"name":        filepath.Base(filePath),
		"path":        filePath,
		"size":        info.Size(),
		"docType":     docType,
		"extension":   ext,
		"gasEstimate": gasEstimate,
		"canCompress": compress,
	}
}

// GetGasEstimate estimates gas cost for DOC installation
func (a *App) GetGasEstimate(docJSON string) map[string]interface{} {
	var doc DOCInfo
	if err := json.Unmarshal([]byte(docJSON), &doc); err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] GetGasEstimate: Invalid JSON - %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid DOC info",
		}
	}

	size := doc.Size
	if size == 0 && doc.Path != "" {
		if info, err := os.Stat(doc.Path); err == nil {
			size = info.Size()
		}
	}

	gasEstimate := estimateGasCost(int(size))

	// Check if we're in simulator mode (gas is free)
	isSimulator := a.IsInSimulatorMode()
	if isSimulator {
		a.logToConsole(fmt.Sprintf("[BALANCE] [TELA] GetGasEstimate: %s (%d bytes) → FREE (Simulator Mode)", doc.Name, size))
	} else {
		a.logToConsole(fmt.Sprintf("[BALANCE] [TELA] GetGasEstimate: %s (%d bytes) → %d gas (~%.5f DERO)", doc.Name, size, gasEstimate, float64(gasEstimate)/100000))
	}

	return map[string]interface{}{
		"success":     true,
		"gasEstimate": gasEstimate,
		"size":        size,
	}
}

// InstallINDEX creates a TELA INDEX smart contract
func (a *App) InstallINDEX(indexJSON string) map[string]interface{} {
	isSimulator := a.IsInSimulatorMode()
	modeStr := ""
	if isSimulator {
		modeStr = " [SIMULATOR]"
	}
	a.logToConsole(fmt.Sprintf("[INDEX] [TELA] InstallINDEX: Starting installation...%s", modeStr))

	// Check wallet - use simulator wallet in simulator mode, otherwise main wallet
	wallet := a.getWalletForDeployment(isSimulator)
	if wallet == nil {
		errMsg := "No wallet is currently open"
		if isSimulator {
			errMsg = "Simulator wallet is not open. Restart simulator mode."
		}
		return map[string]interface{}{
			"success": false,
			"error":   errMsg,
		}
	}

	// Parse INDEX info
	var idx INDEXInfo
	if err := json.Unmarshal([]byte(indexJSON), &idx); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Invalid INDEX format. Please check your input.",
			"technicalError": err.Error(),
		}
	}

	// Build INDEX structure
	index := tela.INDEX{
		DURL: idx.DURL,
		DOCs: idx.DOCSCIDs,
		Mods: idx.Mods, // MOD tags (e.g., "vsoo,txdwd")
		Headers: tela.Headers{
			NameHdr:  idx.Name,
			DescrHdr: idx.Description,
			IconHdr:  idx.IconURL,
		},
	}

	// Log MODs if any
	modsStr := "none"
	if idx.Mods != "" {
		modsStr = idx.Mods
	}
	a.logToConsole(fmt.Sprintf("[INDEX] [TELA] InstallINDEX: %s (durl=%s, docs=%d, mods=%s)",
		idx.Name, idx.DURL, len(idx.DOCSCIDs), modsStr))

	// Set up network configuration
	// CRITICAL: In simulator mode, do NOT call walletapi.Connect() - see InstallDOC for explanation
	endpoint := "127.0.0.1:20000"

	if isSimulator {
		globals.Arguments["--simulator"] = true
		globals.InitNetwork()

		// Set wallet daemon address and mode (no websocket connection yet)
		wallet.SetDaemonAddress(endpoint)
		wallet.SetOnlineMode()

		// Set the endpoint variable and Connected flag for tela library
		walletapi.Daemon_Endpoint_Active = endpoint
		walletapi.Connected = true // Required for TransferPayload0 check
	} else {
		// Get daemon endpoint for non-simulator
		if a.daemonClient != nil {
			endpoint = a.daemonClient.GetEndpoint()
			endpoint = strings.TrimPrefix(endpoint, "http://")
			endpoint = strings.TrimPrefix(endpoint, "https://")
		}

		// For non-simulator: use walletapi.Connect()
		a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi to daemon: %s", endpoint))
		if err := walletapi.Connect(endpoint); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] walletapi.Connect failed: %v", err))
		}
		wallet.SetDaemonAddress(endpoint)
		wallet.SetOnlineMode()
	}

	// Install INDEX using tela library
	// Ringsize: 2 = updateable, 16+ = immutable (anonymous)
	// MODs require ringsize 2 (they have no functionality above RS 2)
	ringsize := uint64(2) // Default: updateable
	if idx.Mods != "" {
		// MODs force ringsize 2
		ringsize = 2
		a.logToConsole("[INDEX] MODs enabled - forcing ringsize 2 (MODs require updateable INDEX)")
	} else if idx.Ringsize >= 2 {
		ringsize = uint64(idx.Ringsize)
	}
	a.logToConsole(fmt.Sprintf("[INDEX] Using ringsize=%d (updateable=%v)", ringsize, ringsize <= 2))
	txid, err := tela.Installer(wallet, ringsize, &index)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] InstallINDEX: Failed - %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] [TELA] InstallINDEX: Success! SCID=%s, dURL=%s", txid, idx.DURL))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"durl":    idx.DURL,
		"message": "INDEX installed successfully",
	}
}

// UpdateINDEX updates an existing TELA INDEX
func (a *App) UpdateINDEX(scid, indexJSON string) map[string]interface{} {
	isSimulator := a.IsInSimulatorMode()
	modeStr := ""
	if isSimulator {
		modeStr = " [SIMULATOR]"
	}
	a.logToConsole(fmt.Sprintf("[SYNC] Updating INDEX: %s%s", scid[:16]+"...", modeStr))

	// Check wallet - use simulator wallet in simulator mode
	wallet := a.getWalletForDeployment(isSimulator)
	if wallet == nil {
		errMsg := "No wallet is currently open"
		if isSimulator {
			errMsg = "Simulator wallet is not open. Restart simulator mode."
		}
		return map[string]interface{}{
			"success": false,
			"error":   errMsg,
		}
	}

	// Parse INDEX info
	var idx INDEXInfo
	if err := json.Unmarshal([]byte(indexJSON), &idx); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Invalid INDEX format. Please check your input.",
			"technicalError": err.Error(),
		}
	}

	// Get daemon endpoint
	// CRITICAL: In simulator mode, do NOT call walletapi.Connect() - see InstallDOC for explanation
	endpoint := "127.0.0.1:10102"
	if isSimulator {
		endpoint = "127.0.0.1:20000"
		globals.Arguments["--simulator"] = true
		globals.InitNetwork()

		// Set wallet daemon address and mode (no websocket connection yet)
		wallet.SetDaemonAddress(endpoint)
		wallet.SetOnlineMode()

		// Set the endpoint variable and Connected flag for tela library
		walletapi.Daemon_Endpoint_Active = endpoint
		walletapi.Connected = true // Required for TransferPayload0 check
	} else if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpoint = strings.TrimPrefix(ep, "http://")
		endpoint = strings.TrimPrefix(endpoint, "https://")

		// Connect walletapi for non-simulator mode
		a.logToConsole(fmt.Sprintf("[NET] Connecting walletapi to daemon: %s", endpoint))
		if err := walletapi.Connect(endpoint); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] walletapi.Connect failed: %v", err))
		}
		wallet.SetDaemonAddress(endpoint)
		wallet.SetOnlineMode()
	}

	// Verify owner (only original author can update)
	existingIndex, err := tela.GetINDEXInfo(scid, endpoint)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Could not verify INDEX ownership: %v", err))
		return map[string]interface{}{
			"success":        false,
			"error":          "Could not verify INDEX: " + FriendlyError(err),
			"technicalError": err.Error(),
		}
	}

	// Check if INDEX is immutable (anon author)
	if existingIndex.Author == "anon" {
		return map[string]interface{}{
			"success": false,
			"error":   "This INDEX is immutable and cannot be updated (deployed with Ring 16+)",
		}
	}

	// Check if wallet is owner
	walletAddr := wallet.GetAddress().String()
	if existingIndex.Author != walletAddr {
		return map[string]interface{}{
			"success": false,
			"error":   "Your wallet is not the owner of this INDEX. Only the original author can update it.",
		}
	}

	// Build INDEX structure with SCID for update
	// Preserve existing version info so Updater knows how to handle the update
	index := tela.INDEX{
		SCID:      scid,
		DURL:      idx.DURL,
		DOCs:      idx.DOCSCIDs,
		SCVersion: existingIndex.SCVersion,
		Mods:      existingIndex.Mods, // Preserve existing mods unless explicitly changed
		Headers: tela.Headers{
			NameHdr:  idx.Name,
			DescrHdr: idx.Description,
			IconHdr:  idx.IconURL,
		},
	}

	// Log version info
	if existingIndex.SCVersion != nil {
		latestVersion := tela.GetLatestContractVersion(false)
		if existingIndex.SCVersion.LessThan(latestVersion) {
			a.logToConsole(fmt.Sprintf("[INFO] INDEX version %s will be updated to %s", existingIndex.SCVersion.String(), latestVersion.String()))
		}
	}

	// Update INDEX using tela library
	txid, err := tela.Updater(wallet, &index)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] INDEX update failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] INDEX updated successfully! TXID: %s", txid))

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"txid":    txid,
		"message": "INDEX updated successfully",
	}
}

// GetINDEXInfo retrieves information about a TELA INDEX
func (a *App) GetINDEXInfo(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[TELA] Getting INDEX info: %s", scid[:16]+"..."))

	// Get daemon endpoint
	isSimulator := a.IsInSimulatorMode()
	endpoint := "127.0.0.1:10102"
	if isSimulator {
		endpoint = "127.0.0.1:20000"
	} else if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpoint = strings.TrimPrefix(ep, "http://")
		endpoint = strings.TrimPrefix(endpoint, "https://")
	}

	// Get INDEX info using tela library
	index, err := tela.GetINDEXInfo(scid, endpoint)
	if err != nil {
		return ErrorResponse(err)
	}

	// Check version info
	latestVersion := tela.GetLatestContractVersion(false)
	isLatest := true
	currentVersion := ""
	if index.SCVersion != nil {
		currentVersion = index.SCVersion.String()
		isLatest = !index.SCVersion.LessThan(latestVersion)
	}

	// Check if current wallet is owner
	isOwner := false
	canUpdate := true
	wallet := GetWallet()
	if wallet != nil {
		walletAddr := wallet.GetAddress().String()
		isOwner = index.Author == walletAddr
	}

	// "anon" author means immutable (ring 16+)
	if index.Author == "anon" {
		canUpdate = false
	}

	return map[string]interface{}{
		"success":        true,
		"scid":           scid,
		"name":           index.Headers.NameHdr,
		"description":    index.Headers.DescrHdr,
		"icon":           index.Headers.IconHdr,
		"durl":           index.DURL,
		"owner":          index.Author,
		"docs":           index.DOCs,
		"currentVersion": currentVersion,
		"latestVersion":  latestVersion.String(),
		"isLatest":       isLatest,
		"isOwner":        isOwner,
		"canUpdate":      canUpdate,
		"mods":           index.Mods,
	}
}

// CloneTELA downloads TELA content from a SCID
func (a *App) CloneTELA(scid string, allowUpdates bool) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Clone] TELA content: %s", scid))

	// Validate SCID format
	// Standard SCID = 64 chars, at commit = scid@txid = 129 chars
	atCommit := ""
	if len(scid) == 129 && strings.Contains(scid, "@") {
		parts := strings.Split(scid, "@")
		if len(parts) == 2 && len(parts[0]) == 64 && len(parts[1]) == 64 {
			atCommit = parts[1]
			scid = parts[0]
		} else {
			return map[string]interface{}{
				"success": false,
				"error":   "Invalid format. Use 64-char SCID or scid@txid for specific version",
			}
		}
	} else if len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID. Must be exactly 64 characters",
		}
	}

	// Get daemon endpoint
	endpoint := "127.0.0.1:10102"
	isSimulator := a.IsInSimulatorMode()
	if isSimulator {
		endpoint = "127.0.0.1:20000"
	} else if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpoint = strings.TrimPrefix(ep, "http://")
		endpoint = strings.TrimPrefix(endpoint, "https://")
	}

	// First, get info about what we're cloning
	var contentType string
	var name, dURL, description string
	var fileCount int

	// Try INDEX first
	indexInfo, err := tela.GetINDEXInfo(scid, endpoint)
	if err == nil {
		contentType = "INDEX"
		name = indexInfo.NameHdr
		dURL = indexInfo.DURL
		description = indexInfo.DescrHdr
		fileCount = len(indexInfo.DOCs)
		a.logToConsole(fmt.Sprintf("[INFO] Detected INDEX: %s (%s) with %d DOCs", name, dURL, fileCount))
	} else {
		// Try DOC
		docInfo, err := tela.GetDOCInfo(scid, endpoint)
		if err == nil {
			contentType = "DOC"
			name = docInfo.NameHdr
			dURL = docInfo.DURL
			description = docInfo.DescrHdr
			fileCount = 1
			a.logToConsole(fmt.Sprintf("[INFO] Detected DOC: %s (%s)", name, dURL))
		} else {
			a.logToConsole(fmt.Sprintf("[ERR] Could not identify SCID as DOC or INDEX: %v", err))
			return map[string]interface{}{
				"success":        false,
				"error":          "Could not identify SCID as TELA DOC or INDEX",
				"technicalError": err.Error(),
			}
		}
	}

	// Set allow updates flag for tela library
	if allowUpdates {
		tela.AllowUpdates(true)
	}

	// Clone using tela library
	if atCommit != "" {
		a.logToConsole(fmt.Sprintf("[CLONE] Cloning at commit: %s", atCommit))
		err = tela.CloneAtCommit(scid, atCommit, endpoint)
	} else {
		err = tela.Clone(scid, endpoint)
	}

	// Reset allow updates flag
	if allowUpdates {
		tela.AllowUpdates(false)
	}

	if err != nil {
		errStr := err.Error()
		a.logToConsole(fmt.Sprintf("[ERR] Clone failed: %v", err))

		// Check if it's an "updated content" error - user needs to confirm
		if strings.Contains(errStr, "user defined no updates and content has been updated") {
			return map[string]interface{}{
				"success":         false,
				"error":           "Content has been updated since original deployment",
				"technicalError":  errStr,
				"requiresConfirm": true,
				"confirmMessage":  "This TELA content has been updated. Do you want to clone the latest version?",
			}
		}

		return map[string]interface{}{
			"success":        false,
			"error":          FriendlyError(err),
			"technicalError": errStr,
		}
	}

	// Get the clone directory
	cloneDir := filepath.Join(tela.GetClonePath(), dURL)
	a.logToConsole(fmt.Sprintf("[OK] Content cloned to: %s", cloneDir))

	return map[string]interface{}{
		"success":     true,
		"directory":   cloneDir,
		"contentType": contentType,
		"name":        name,
		"dURL":        dURL,
		"description": description,
		"fileCount":   fileCount,
		"message":     fmt.Sprintf("Successfully cloned %s: %s", contentType, name),
	}
}

// GetClonePath returns the path where TELA content is cloned to
func (a *App) GetClonePath() string {
	return tela.GetClonePath()
}

// RateTELA submits a rating for TELA content
func (a *App) RateTELA(scid string, rating uint64) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STAR] Rating SCID %s with %d", scid[:16]+"...", rating))

	// Check wallet
	wallet := GetWallet()
	if wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	// Validate rating (0-10)
	if rating > 10 {
		return map[string]interface{}{
			"success": false,
			"error":   "Rating must be between 0 and 10",
		}
	}

	// Submit rating using tela library
	txid, err := tela.Rate(wallet, scid, rating)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Rating failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] Rating submitted: %s", txid))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"rating":  rating,
		"message": "Rating submitted successfully",
	}
}

// ParseFolderForTELA analyzes a folder and returns staged file information
func (a *App) ParseFolderForTELA(folderPath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DIR] [TELA] ParseFolderForTELA: Scanning %s", folderPath))

	files := []DOCInfo{}
	var totalSize int64
	var totalGas uint64
	errors := []string{}

	err := filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			errors = append(errors, fmt.Sprintf("Error accessing %s: %v", path, err))
			return nil
		}

		if info.IsDir() {
			return nil
		}

		// Get relative path for subDir
		relPath, _ := filepath.Rel(folderPath, path)
		subDir := filepath.Dir(relPath)
		if subDir == "." {
			subDir = "/"
		} else {
			subDir = "/" + subDir
		}

		// Detect doc type
		docType := tela.ParseDocType(info.Name())

		files = append(files, DOCInfo{
			Name:    info.Name(),
			Path:    path,
			SubDir:  subDir,
			DocType: docType,
			Size:    info.Size(),
		})

		totalSize += info.Size()
		totalGas += estimateGasCost(int(info.Size()))

		return nil
	})

	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] [TELA] ParseFolderForTELA: Error walking folder - %v", err))
		return ErrorResponse(err)
	}

	// Log details about found files
	if len(files) > 0 {
		a.logToConsole(fmt.Sprintf("[OK] [TELA] ParseFolderForTELA: Found %d files:", len(files)))
		for _, f := range files {
			a.logToConsole(fmt.Sprintf("   [DOC] %s (type=%s, size=%d, subdir=%s)", f.Name, f.DocType, f.Size, f.SubDir))
		}
		a.logToConsole(fmt.Sprintf("   [STATS] Total: %d bytes, estimated gas: %d", totalSize, totalGas))
	} else {
		a.logToConsole(fmt.Sprintf("[WARN] [TELA] ParseFolderForTELA: No files found in %s", folderPath))
	}

	if len(errors) > 0 {
		a.logToConsole(fmt.Sprintf("[WARN] [TELA] ParseFolderForTELA: %d errors encountered", len(errors)))
	}

	// Calculate estimated gas (for informational display only)
	// Note: This is a rough estimate. Actual gas in simulator is FREE.
	// Real gas estimation happens via tela.GetGasEstimate() during deployment.
	estimatedGas := totalGas

	return map[string]interface{}{
		"success":      true,
		"files":        files,
		"totalFiles":   len(files),
		"totalSize":    totalSize,
		"totalGas":     totalGas,
		"errors":       errors,
		"folderPath":   folderPath,
		"estimatedGas": estimatedGas,
	}
}

// DeployTELABatch deploys multiple DOCs and creates an INDEX
// Emits Wails events for real-time progress tracking:
// - tela:deploy:start - deployment initiated
// - tela:deploy:progress - each DOC deployed
// - tela:deploy:complete - INDEX created
// - tela:deploy:error - if something fails
func (a *App) DeployTELABatch(batchJSON string) map[string]interface{} {
	isSimulator := a.IsInSimulatorMode()
	modeStr := ""
	if isSimulator {
		modeStr = " [SIMULATOR - FREE]"
	}
	a.logToConsole(fmt.Sprintf("[START] [TELA] DeployTELABatch: Starting batch deployment...%s", modeStr))

	// PRE-DEPLOYMENT HEALTH CHECK: Verify daemon is alive before starting
	if isSimulator {
		a.logToConsole("[CHECK] Verifying simulator daemon is healthy before deployment...")
		if a.daemonClient == nil {
			errMsg := "Simulator daemon client not initialized. Restart simulator mode."
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": errMsg})
			return map[string]interface{}{"success": false, "error": errMsg}
		}
		info, err := a.daemonClient.GetInfo()
		if err != nil {
			errMsg := fmt.Sprintf("Cannot connect to simulator daemon: %v. Please restart simulator mode.", err)
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": errMsg})
			return map[string]interface{}{"success": false, "error": errMsg}
		}
		if info == nil {
			errMsg := "Simulator daemon returned empty response. Please restart simulator mode."
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": errMsg})
			return map[string]interface{}{"success": false, "error": errMsg}
		}
		// Log daemon status
		if height, ok := info["topoheight"].(float64); ok {
			a.logToConsole(fmt.Sprintf("[OK] Simulator daemon healthy (height: %.0f)", height))
		} else {
			a.logToConsole("[OK] Simulator daemon responding")
		}
	}

	// Check wallet
	wallet := a.getWalletForDeployment(isSimulator)
	if wallet == nil {
		errMsg := "No wallet is currently open"
		if isSimulator {
			errMsg = "Simulator wallet is not open. Restart simulator mode."
		}
		runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": errMsg})
		return map[string]interface{}{"success": false, "error": errMsg}
	}
	a.logToConsole(fmt.Sprintf("[WALLET] Deploy wallet address: %s", wallet.GetAddress().String()))

	// Parse batch config
	var batch BatchDeployConfig
	if err := json.Unmarshal([]byte(batchJSON), &batch); err != nil {
		runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": "Invalid batch format"})
		return map[string]interface{}{"success": false, "error": "Invalid batch format", "technicalError": err.Error()}
	}

	// Use ringsize from batch, default to 2 (updateable)
	ringsize := batch.Ringsize
	if ringsize == 0 {
		ringsize = 2
	}

	// CRITICAL: Sort files to ensure entry point (index.html) is deployed FIRST
	// The first DOC deployed becomes DOC1 in the INDEX, which is the application entrypoint.
	// Without this sort, alphabetical ordering could make blocks.js the entrypoint instead of index.html.
	sortFilesForDeployment(batch.Files)
	a.logToConsole(fmt.Sprintf("[SORT] Files ordered for deployment (entry point first): %s", batch.Files[0].Name))

	// CRITICAL: In simulator mode, the daemon can only handle ONE WebSocket at a time.
	// Both EPOCH and Gnomon hold persistent WebSocket connections that will crash the
	// daemon if they're active when walletapi connects to send transactions.
	// Pause both for the entire batch deploy and resume when done.
	epochWasActive := false
	gnomonWasActive := false
	if isSimulator {
		epochWasActive = a.pauseEpochForSimulator()
		gnomonWasActive = a.pauseGnomonForSimulator()
	}
	defer func() {
		if gnomonWasActive {
			a.resumeGnomonForSimulator()
		}
		if epochWasActive {
			a.resumeEpochForSimulator()
		}
		// Restore Daemon_Endpoint_Active after simulator deploy so walletapi can
		// reconnect normally. Also clear our cached endpoint.
		if isSimulator && a.simulatorDeployEndpoint != "" {
			walletapi.Daemon_Endpoint_Active = a.simulatorDeployEndpoint
			a.simulatorDeployEndpoint = ""
		}
	}()

	// Set up network
	if _, err := a.setupNetworkForDeployment(wallet, isSimulator); err != nil {
		runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": err.Error()})
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	// MAINNET SAFETY GATE: estimate total batch gas up front and ensure the wallet
	// has enough headroom before sending the first transaction. This avoids partial
	// deployments where early DOCs land on-chain but later DOC/INDEX sends fail.
	if !isSimulator {
		budget, err := a.precheckMainnetBatchBudget(wallet, &batch, ringsize)
		if err != nil {
			errMsg := "Mainnet precheck failed: " + err.Error()
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{"error": errMsg})
			return map[string]interface{}{"success": false, "error": errMsg}
		}
		a.logToConsole(fmt.Sprintf(
			"[CHECK] Mainnet budget gate passed: wallet=%d, estimated=%d, required(with 20%% buffer)=%d",
			budget.WalletBalance,
			budget.EstimatedGas,
			budget.RequiredWithBuffer,
		))
	}

	// NOTE: Pre-deployment balance check REMOVED for simulator mode (Session 103)
	// Reason: The hardcoded SimulatorGasFee (100,000) was overly conservative and blocked
	// deployments that would have succeeded. Gas is FREE in simulator mode anyway.
	// The actual deployment uses tela.GetGasEstimate() which validates SC code properly.
	// For mainnet, real gas estimation happens per-transaction in deployDOC().

	// Emit start event
	runtime.EventsEmit(a.ctx, "tela:deploy:start", map[string]interface{}{
		"totalFiles": len(batch.Files),
		"indexName":  batch.IndexName,
	})

	// Deploy each DOC
	docScids := []string{}
	deployedFiles := []map[string]interface{}{}

	for i, docInfo := range batch.Files {
		a.logToConsole(fmt.Sprintf("[DOC] Deploying %d/%d: %s (type=%s, size=%d)",
			i+1, len(batch.Files), docInfo.Name, docInfo.DocType, docInfo.Size))

		runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
			"current": i + 1, "total": len(batch.Files), "fileName": docInfo.Name, "status": "deploying",
		})

		// Prepare DOC (read, compress, sign)
		prepared, err := a.prepareDOCForDeployment(docInfo, wallet)
		if err != nil {
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
				"error": err.Error(), "fileName": docInfo.Name, "index": i, "partial": deployedFiles,
			})
			return map[string]interface{}{
				"success": false, "error": err.Error(), "partial": deployedFiles,
			}
		}

		// Deploy DOC
		txid, err := a.deployDOC(wallet, prepared, ringsize, isSimulator)
		if err != nil {
			// Check for TELA-specific errors and provide detailed help
			errResp := GetTELAErrorResponse(err.Error(), docInfo.Name)
			errResp["index"] = i
			errResp["partial"] = deployedFiles

			runtime.EventsEmit(a.ctx, "tela:deploy:error", errResp)
			return errResp
		}

		docScids = append(docScids, txid)
		deployedFiles = append(deployedFiles, map[string]interface{}{"name": docInfo.Name, "scid": txid})

		runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
			"current": i + 1, "total": len(batch.Files), "fileName": docInfo.Name, "status": "completed", "scid": txid,
		})

		// POST-DEPLOYMENT VERIFICATION (belt-and-suspenders: deployDOC already verified,
		// but re-check before committing to INDEX creation)
		if !isSimulator {
			a.logToConsole(fmt.Sprintf("[VERIFY] Re-checking DOC %s (%s...) before proceeding...", docInfo.Name, txid[:16]))
			runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
				"current": i + 1, "total": len(batch.Files), "fileName": docInfo.Name,
				"status": "verifying", "scid": txid,
			})

			time.Sleep(1 * time.Second)

			if err := a.verifyDeployedDOC(txid, docInfo.Name, 3); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] DOC re-verification failed — aborting batch: %v", err))
				runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
					"error": err.Error(), "fileName": docInfo.Name, "index": i, "partial": deployedFiles,
				})
				return map[string]interface{}{
					"success": false, "error": "DOC verification failed after deploy: " + err.Error(), "partial": deployedFiles,
				}
			}
			a.logToConsole(fmt.Sprintf("[OK] DOC %s verified successfully", docInfo.Name))
		}

		// CRITICAL: Wait for block confirmation between deployments
		// On mainnet, each transaction must be confirmed in a block before the next can be sent
		// Otherwise the daemon will reject the transaction with "rejected by pool by mempool"
		if !isSimulator && i < len(batch.Files)-1 { // Don't wait after last DOC (INDEX will handle its own wait)
			a.logToConsole("[WAIT] Waiting for block confirmation before next DOC...")
			runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
				"current": i + 1, "total": len(batch.Files), "fileName": docInfo.Name,
				"status": "waiting_confirmation", "scid": txid,
			})

			// CRITICAL: Must wait for block confirmation - retry up to 3 times with increasing timeout
			// If we don't wait, the next transaction will be rejected with "rejected by pool by mempool"
			blockConfirmed := false
			for blockWaitAttempt := 0; blockWaitAttempt < 3; blockWaitAttempt++ {
				timeout := time.Duration(60+blockWaitAttempt*30) * time.Second // 60s, 90s, 120s

				if err := a.waitForNewBlockWithHealthCheck(timeout); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Block wait attempt %d failed: %v", blockWaitAttempt+1, err))
					// Wait a bit before retrying
					time.Sleep(5 * time.Second)
				} else {
					a.logToConsole("[OK] Block confirmed, proceeding with next DOC")
					blockConfirmed = true
					break
				}
			}

			if !blockConfirmed {
				// Last resort: wait a fixed amount of time for the block to be mined
				a.logToConsole("[WARN] Block confirmation retries exhausted. Waiting 30s as fallback...")
				time.Sleep(30 * time.Second)
			}

			// CRITICAL: Sync wallet MULTIPLE times after block confirmation to ensure nonce is updated
			// The first sync may return before the daemon has fully processed the new block
			// Adding a brief delay and double-sync ensures the wallet has the correct nonce
			time.Sleep(500 * time.Millisecond) // Let daemon fully process the new block

			for syncAttempt := 0; syncAttempt < 3; syncAttempt++ {
				if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Post-deploy wallet sync attempt %d failed: %v", syncAttempt+1, err))
				} else {
					a.logToConsole(fmt.Sprintf("[OK] Wallet synced (attempt %d)", syncAttempt+1))
				}
				if syncAttempt < 2 {
					time.Sleep(200 * time.Millisecond)
				}
			}
		}

		// SIMULATOR MODE: Add delay between deployments (like tela-cli tests do)
		// This gives the simulator daemon time to process and prevents transaction conflicts
		if isSimulator && i < len(batch.Files)-1 {
			a.logToConsole("[WAIT] Brief delay before next DOC deployment...")
			time.Sleep(500 * time.Millisecond)
		}
	}

	// Create INDEX
	runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
		"current": len(batch.Files), "total": len(batch.Files), "fileName": "INDEX", "status": "creating_index",
	})

	// SIMULATOR MODE: Add delay before INDEX creation to let all DOC transactions settle
	// This gives the simulator daemon time to fully process all DOC transactions
	if isSimulator {
		a.logToConsole("[WAIT] Waiting for DOC transactions to settle before INDEX creation...")
		time.Sleep(1 * time.Second)
	}

	// MAINNET: Wait for last DOC's block confirmation before creating INDEX
	// This ensures all DOC transactions are confirmed before the INDEX references them
	if !isSimulator && len(batch.Files) > 0 {
		a.logToConsole("[WAIT] Waiting for last DOC block confirmation before INDEX creation...")
		runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
			"current": len(batch.Files), "total": len(batch.Files),
			"fileName": "INDEX", "status": "waiting_for_docs",
		})

		// CRITICAL: Must wait for block confirmation - retry up to 3 times
		blockConfirmed := false
		for blockWaitAttempt := 0; blockWaitAttempt < 3; blockWaitAttempt++ {
			timeout := time.Duration(60+blockWaitAttempt*30) * time.Second

			if err := a.waitForNewBlockWithHealthCheck(timeout); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] INDEX block wait attempt %d failed: %v", blockWaitAttempt+1, err))
				time.Sleep(5 * time.Second)
			} else {
				a.logToConsole("[OK] DOC transactions confirmed, creating INDEX")
				blockConfirmed = true
				break
			}
		}

		if !blockConfirmed {
			a.logToConsole("[WARN] INDEX block confirmation retries exhausted. Waiting 30s as fallback...")
			time.Sleep(30 * time.Second)
		}

		// CRITICAL: Sync wallet multiple times after block confirmation
		time.Sleep(500 * time.Millisecond)
		for syncAttempt := 0; syncAttempt < 3; syncAttempt++ {
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Pre-INDEX wallet sync attempt %d failed: %v", syncAttempt+1, err))
			} else {
				a.logToConsole(fmt.Sprintf("[OK] Wallet synced for INDEX (attempt %d)", syncAttempt+1))
			}
			if syncAttempt < 2 {
				time.Sleep(200 * time.Millisecond)
			}
		}
	}

	// Sync wallet before INDEX creation to ensure nonce is correct
	// NOTE: Skip in simulator mode - tela library manages its own connections
	if !isSimulator {
		if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Pre-INDEX wallet sync failed: %v", err))
		}
	}

	indexTxid, err := a.createINDEX(wallet, &batch, docScids, ringsize, isSimulator)
	if err != nil {
		runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
			"error": "DOCs deployed but INDEX creation failed: " + err.Error(), "deployedDocs": deployedFiles,
		})
		return map[string]interface{}{
			"success": false, "error": "INDEX creation failed: " + FriendlyError(err), "deployedDocs": deployedFiles,
		}
	}

	if isSimulator {
		a.logToConsole("[WAIT] Waiting for INDEX block confirmation...")
		runtime.EventsEmit(a.ctx, "tela:deploy:progress", map[string]interface{}{
			"current": len(batch.Files), "total": len(batch.Files), "fileName": "INDEX",
			"status": "waiting_confirmation", "scid": indexTxid,
		})
		if err := a.waitForNewBlockWithHealthCheck(15 * time.Second); err != nil {
			errMsg := "INDEX transaction was sent, but simulator daemon failed before confirmation: " + FriendlyError(err)
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
				"error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			})
			return map[string]interface{}{
				"success": false, "error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			}
		}

		a.logToConsole("[VERIFY] Checking simulator daemon stability after INDEX...")
		if err := a.verifyDaemonStability(8*time.Second, 500*time.Millisecond); err != nil {
			errMsg := "INDEX transaction confirmed, but simulator daemon died immediately after deploy: " + FriendlyError(err)
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
				"error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			})
			return map[string]interface{}{
				"success": false, "error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			}
		}

		a.logToConsole("[VERIFY] Checking INDEX stringkeys...")
		if err := a.verifyDeployedINDEX(indexTxid, batch.IndexDURL, 4); err != nil {
			errMsg := "INDEX transaction confirmed, but the deployed TELA contract could not be verified: " + FriendlyError(err)
			runtime.EventsEmit(a.ctx, "tela:deploy:error", map[string]interface{}{
				"error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			})
			return map[string]interface{}{
				"success": false, "error": errMsg, "deployedDocs": deployedFiles, "indexScid": indexTxid, "durl": batch.IndexDURL,
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Complete! INDEX=%s, dURL=%s, DOCs=%d", indexTxid, batch.IndexDURL, len(deployedFiles)))

	runtime.EventsEmit(a.ctx, "tela:deploy:complete", map[string]interface{}{
		"indexScid": indexTxid, "deployedDocs": deployedFiles, "durl": batch.IndexDURL, "totalFiles": len(deployedFiles),
	})

	return map[string]interface{}{
		"success": true, "indexScid": indexTxid, "deployedDocs": deployedFiles, "durl": batch.IndexDURL,
		"message": fmt.Sprintf("Successfully deployed %d DOCs and created INDEX", len(deployedFiles)),
	}
}

// ServeLocalDirectory starts a local server to preview TELA content
func (a *App) ServeLocalDirectory(directory string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[NET] Starting local server for: %s", directory))

	// Check directory exists
	if _, err := os.Stat(directory); os.IsNotExist(err) {
		return map[string]interface{}{
			"success": false,
			"error":   "Directory not found",
		}
	}

	// Find an open port and start serving
	server, found := tela.FindOpenPort()
	if !found {
		return map[string]interface{}{
			"success": false,
			"error":   "No available ports",
		}
	}

	// Get the server address
	addr := server.Addr

	a.logToConsole(fmt.Sprintf("[OK] Local server available at: %s", addr))

	return map[string]interface{}{
		"success":   true,
		"address":   addr,
		"directory": directory,
		"message":   "Local server available",
	}
}

// ================== VERSION CONTROL (GitHub-like) ==================

// Commit represents a single version in the TELA content history
type Commit struct {
	Number    int    `json:"number"`    // Commit number (1, 2, 3...)
	TXID      string `json:"txid"`      // Transaction ID that made this commit
	Height    int64  `json:"height"`    // Block height of the commit
	Timestamp int64  `json:"timestamp"` // Unix timestamp (if available)
	IsCurrent bool   `json:"isCurrent"` // True if this is the latest version
	Label     string `json:"label"`     // Auto-generated semantic label
}

// FileDiff represents differences in a single file between versions
type FileDiff struct {
	FileName  string                   `json:"fileName"`
	Status    string                   `json:"status"` // "added", "removed", "modified", "unchanged"
	LineDiffs []map[string]interface{} `json:"lineDiffs,omitempty"`
}

// CommitDiff represents the full diff between two commits
type CommitDiff struct {
	SCID       string     `json:"scid"`
	FromCommit int        `json:"fromCommit"`
	ToCommit   int        `json:"toCommit"`
	FromTXID   string     `json:"fromTxid"`
	ToTXID     string     `json:"toTxid"`
	FileDiffs  []FileDiff `json:"fileDiffs"`
	Summary    string     `json:"summary"`
	HasChanges bool       `json:"hasChanges"`
}

// GetCommitHistory retrieves all commits (versions) for a TELA SCID
func (a *App) GetCommitHistory(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SC] Getting commit history for: %s", scid[:16]+"..."))

	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		// Fallback: try to get from daemon directly
		return a.getCommitHistoryFromDaemon(scid)
	}

	// Get SC interaction history from Gnomon
	commits := []Commit{}

	// Get all SCID interaction heights
	heights := a.gnomonClient.Indexer.GravDBBackend.GetSCIDInteractionHeight(scid)

	if len(heights) == 0 {
		return map[string]interface{}{
			"success": true,
			"scid":    scid,
			"commits": commits,
			"count":   0,
		}
	}

	// Build commit list with TXIDs
	for i, height := range heights {
		commit := Commit{
			Number:    i + 1,
			Height:    height,
			IsCurrent: i == len(heights)-1,
		}

		// Try to get TXID for this commit by querying the block
		txid := a.findSCIDTxAtHeight(scid, height)
		if txid != "" {
			commit.TXID = txid
		}

		// Generate semantic label
		if i == 0 {
			commit.Label = "Initial deployment"
		} else {
			commit.Label = fmt.Sprintf("Update #%d", i)
		}

		commits = append(commits, commit)
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d commits", len(commits)))

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"commits": commits,
		"count":   len(commits),
	}
}

// findSCIDTxAtHeight finds the transaction that interacted with the SCID at a specific height
// Results are cached to avoid repeated daemon queries for the same SCID+height combination
func (a *App) findSCIDTxAtHeight(scid string, height int64) string {
	// Check cache first
	cacheKey := fmt.Sprintf("%s:%d", scid, height)
	if cached, ok := txidCache.Load(cacheKey); ok {
		return cached.(string)
	}

	// Get block at this height
	blockResult := a.GetBlock(height)
	if blockResult["success"] != true {
		return ""
	}

	block, ok := blockResult["block"].(map[string]interface{})
	if !ok {
		return ""
	}

	// Get transaction hashes from block
	txHashes := []string{}

	// Try different field names for tx hashes
	if txs, ok := block["tx_hashes"].([]interface{}); ok {
		for _, tx := range txs {
			if txHash, ok := tx.(string); ok {
				txHashes = append(txHashes, txHash)
			}
		}
	}

	// If no tx_hashes, try getting extended block info
	if len(txHashes) == 0 {
		extBlock := a.GetBlockExtended(fmt.Sprintf("%d", height))
		if extBlock["success"] == true {
			if txs, ok := extBlock["tx_hashes"].([]string); ok {
				txHashes = txs
			}
		}
	}

	// Search through transactions for one that targets this SCID
	for _, txHash := range txHashes {
		txInfo := a.GetTransactionBasic(txHash)
		if txInfo["success"] != true {
			continue
		}

		if tx, ok := txInfo["tx"].(map[string]interface{}); ok {
			// Check if this transaction targets our SCID
			if txScid, ok := tx["scid"].(string); ok && txScid == scid {
				// Cache the result before returning
				txidCache.Store(cacheKey, txHash)
				return txHash
			}

			// Also check scdata for SC interactions
			if scdata, ok := tx["scdata"].(map[string]interface{}); ok {
				if scidInData, ok := scdata["scid"].(string); ok && scidInData == scid {
					// Cache the result before returning
					txidCache.Store(cacheKey, txHash)
					return txHash
				}
			}
		}
	}

	// Cache empty result to avoid re-querying (TXID not found at this height)
	txidCache.Store(cacheKey, "")
	return ""
}

// GenerateSemanticLabel creates a descriptive label for a commit based on file changes
// This is called when comparing two consecutive versions to generate meaningful labels
func (a *App) GenerateSemanticLabel(scid string, commitNum int) string {
	// First commit is always "Initial deployment"
	if commitNum == 1 {
		return "Initial deployment"
	}

	// Try to get diff with previous commit to determine what changed
	diffResult := a.DiffCommits(scid, commitNum-1, commitNum)
	if diffResult["success"] != true {
		return fmt.Sprintf("Update #%d", commitNum-1)
	}

	// Analyze the file changes
	fileDiffs, ok := diffResult["fileDiffs"].([]FileDiff)
	if !ok || len(fileDiffs) == 0 {
		return fmt.Sprintf("Update #%d", commitNum-1)
	}

	// Build a descriptive label
	added := []string{}
	modified := []string{}
	removed := []string{}

	for _, fd := range fileDiffs {
		switch fd.Status {
		case "added":
			added = append(added, fd.FileName)
		case "modified":
			modified = append(modified, fd.FileName)
		case "removed":
			removed = append(removed, fd.FileName)
		}
	}

	// Generate label based on changes
	parts := []string{}

	if len(modified) > 0 {
		if len(modified) <= 2 {
			parts = append(parts, "Updated "+strings.Join(modified, ", "))
		} else {
			parts = append(parts, fmt.Sprintf("Updated %d files", len(modified)))
		}
	}

	if len(added) > 0 {
		if len(added) <= 2 {
			parts = append(parts, "Added "+strings.Join(added, ", "))
		} else {
			parts = append(parts, fmt.Sprintf("Added %d files", len(added)))
		}
	}

	if len(removed) > 0 {
		if len(removed) <= 2 {
			parts = append(parts, "Removed "+strings.Join(removed, ", "))
		} else {
			parts = append(parts, fmt.Sprintf("Removed %d files", len(removed)))
		}
	}

	if len(parts) == 0 {
		return fmt.Sprintf("Update #%d", commitNum-1)
	}

	// Truncate if too long
	label := strings.Join(parts, ", ")
	if len(label) > 60 {
		label = label[:57] + "..."
	}

	return label
}

// GetCommitHistoryWithLabels retrieves commit history with enhanced semantic labels
// This is a more expensive call as it fetches content to generate labels
func (a *App) GetCommitHistoryWithLabels(scid string) map[string]interface{} {
	// Get basic history first
	result := a.GetCommitHistory(scid)
	if result["success"] != true {
		return result
	}

	commits, ok := result["commits"].([]Commit)
	if !ok || len(commits) == 0 {
		return result
	}

	// Enhance labels by analyzing changes
	// Note: This can be slow for large histories, so we only do it for recent commits
	maxEnhance := 5 // Only enhance the last 5 commits
	startIdx := len(commits) - maxEnhance
	if startIdx < 0 {
		startIdx = 0
	}

	for i := startIdx; i < len(commits); i++ {
		// Skip first commit (already has "Initial deployment")
		if commits[i].Number == 1 {
			continue
		}

		// Generate semantic label based on diff with previous version
		label := a.GenerateSemanticLabel(scid, commits[i].Number)
		commits[i].Label = label
	}

	result["commits"] = commits
	return result
}

// getCommitHistoryFromDaemon fetches commit history directly from daemon
func (a *App) getCommitHistoryFromDaemon(scid string) map[string]interface{} {
	// Get SC variables to find version info
	vars, err := a.daemonClient.GetSCVariables(scid, true, true)
	if err != nil {
		return ErrorResponse(err)
	}

	commits := []Commit{}

	// Look for "C" variable which typically holds commit/version counter
	if stringKeys, ok := vars["stringkeys"].(map[string]interface{}); ok {
		if cVal, ok := stringKeys["C"].(string); ok {
			// C often contains version count
			versionCount := parseVersionCount(cVal)
			for i := 1; i <= versionCount; i++ {
				commit := Commit{
					Number:    i,
					IsCurrent: i == versionCount,
				}
				if i == 1 {
					commit.Label = "Initial deployment"
				} else {
					commit.Label = fmt.Sprintf("Update #%d", i-1)
				}
				commits = append(commits, commit)
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"commits": commits,
		"count":   len(commits),
	}
}

// GetCommitContent fetches content at a specific commit number
func (a *App) GetCommitContent(scid string, commitNum int) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DOC] Getting content at commit %d for: %s", commitNum, scid[:16]+"..."))

	// Get commit history first
	historyResult := a.GetCommitHistory(scid)
	commits, ok := historyResult["commits"].([]Commit)
	if !ok || len(commits) < commitNum || commitNum < 1 {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Commit %d not found", commitNum),
		}
	}

	commit := commits[commitNum-1]

	// Get daemon endpoint for cloning
	endpoint := a.daemonClient.GetEndpoint()
	if endpoint == "" {
		endpoint = "127.0.0.1:10102"
	}
	// Ensure http:// prefix is stripped for tela library
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	// If we have a TXID, use CloneAtCommit to get content at that specific version
	var files map[string]string
	var docs []string
	var durl string

	if commit.TXID != "" {
		a.logToConsole(fmt.Sprintf("[DOC] Cloning at commit TXID: %s", commit.TXID[:16]+"..."))

		// Use tela.CloneAtCommit to clone content at this specific version
		err := tela.CloneAtCommit(scid, commit.TXID, endpoint)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] CloneAtCommit failed: %v", err))
			// Fall back to getting current SC info
			return a.getCommitContentFallback(scid, commit, commitNum)
		}

		// Read cloned files
		clonePath := tela.GetClonePath()
		files, err = a.readClonedFiles(clonePath)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Could not read cloned files: %v", err))
		}

		// Clean up clone directory
		if clonePath != "" {
			os.RemoveAll(clonePath)
		}
	} else if commit.IsCurrent {
		// For current version without TXID, get live content
		return a.getCommitContentFallback(scid, commit, commitNum)
	} else {
		// Historical commit without TXID - limited info available
		return map[string]interface{}{
			"success":   true,
			"scid":      scid,
			"commit":    commit,
			"commitNum": commitNum,
			"files":     map[string]string{},
			"docs":      []string{},
			"durl":      "",
			"message":   fmt.Sprintf("Content at commit %d (TXID not available - limited data)", commitNum),
			"warning":   "Historical commit TXID not indexed. Content may be incomplete.",
		}
	}

	// Get INDEX info for docs and durl
	indexInfo, err := tela.GetINDEXInfo(scid, endpoint)
	if err == nil {
		durl = indexInfo.DURL
		docs = indexInfo.DOCs
	}

	return map[string]interface{}{
		"success":   true,
		"scid":      scid,
		"commit":    commit,
		"commitNum": commitNum,
		"files":     files,
		"docs":      docs,
		"durl":      durl,
		"message":   fmt.Sprintf("Content at commit %d", commitNum),
	}
}

// getCommitContentFallback gets content when CloneAtCommit is not available
func (a *App) getCommitContentFallback(scid string, commit Commit, commitNum int) map[string]interface{} {
	endpoint := a.daemonClient.GetEndpoint()
	if endpoint == "" {
		endpoint = "127.0.0.1:10102"
	}
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	var files = make(map[string]string)
	var docs []string
	var durl string

	// Get INDEX info
	indexInfo, err := tela.GetINDEXInfo(scid, endpoint)
	if err != nil {
		// Might be a DOC, not an INDEX
		docInfo, docErr := tela.GetDOCInfo(scid, endpoint)
		if docErr == nil {
			// It's a DOC - get the code directly
			scData, _ := a.daemonClient.GetSC(scid, true, false)
			if code, ok := scData["code"].(string); ok {
				// Extract doc content from SC code
				docContent := extractDocCodeFromSC(code)
				fileName := inferFileNameFromDocType(docInfo.DocType, docInfo.DURL)
				files[fileName] = docContent
			}
			durl = docInfo.DURL
		}
	} else {
		durl = indexInfo.DURL
		docs = indexInfo.DOCs

		// Get content for each DOC in the INDEX
		for _, docScid := range docs {
			docInfo, docErr := tela.GetDOCInfo(docScid, endpoint)
			if docErr != nil {
				continue
			}

			scData, _ := a.daemonClient.GetSC(docScid, true, false)
			if code, ok := scData["code"].(string); ok {
				docContent := extractDocCodeFromSC(code)
				fileName := inferFileNameFromDocType(docInfo.DocType, docInfo.DURL)
				if docInfo.SubDir != "" {
					fileName = docInfo.SubDir + "/" + fileName
				}
				files[fileName] = docContent
			}
		}
	}

	return map[string]interface{}{
		"success":   true,
		"scid":      scid,
		"commit":    commit,
		"commitNum": commitNum,
		"files":     files,
		"docs":      docs,
		"durl":      durl,
		"message":   fmt.Sprintf("Content at commit %d (current version)", commitNum),
	}
}

// readClonedFiles reads all files from a cloned TELA directory
func (a *App) readClonedFiles(basePath string) (map[string]string, error) {
	files := make(map[string]string)

	if basePath == "" {
		return files, fmt.Errorf("empty clone path")
	}

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// Get relative path
		relPath, err := filepath.Rel(basePath, path)
		if err != nil {
			relPath = filepath.Base(path)
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return nil // Skip files we can't read
		}

		files[relPath] = string(content)
		return nil
	})

	return files, err
}

// extractDocCodeFromSC extracts the document content from SC code
func extractDocCodeFromSC(code string) string {
	// TELA DOC code is stored in a comment block at the start of the SC
	// Format: /* DOC_CONTENT */ followed by the actual BASIC code
	if strings.HasPrefix(code, "/*") {
		endIdx := strings.Index(code, "*/")
		if endIdx > 2 {
			return strings.TrimSpace(code[2:endIdx])
		}
	}
	return code
}

// inferFileNameFromDocType generates a filename from doc type and dURL
func inferFileNameFromDocType(docType, durl string) string {
	// Extract extension from docType (e.g., "TELA-HTML-1" -> "html")
	ext := ".txt"
	isHTML := false
	switch {
	case strings.Contains(docType, "HTML"):
		ext = ".html"
		isHTML = true
	case strings.Contains(docType, "CSS"):
		ext = ".css"
	case strings.Contains(docType, "JSON"):
		// Check JSON before JS since "JS" is substring of "JSON"
		ext = ".json"
	case strings.Contains(docType, "JS"):
		ext = ".js"
	case strings.Contains(docType, "SVG"):
		ext = ".svg"
	case strings.Contains(docType, "MD"):
		ext = ".md"
	}

	// Try to extract filename from dURL
	if durl != "" {
		// dURL might be like "myapp.tela" or just a name
		baseName := strings.TrimSuffix(durl, ".tela")
		baseName = strings.TrimSuffix(baseName, ".lib")
		if baseName != "" {
			// If dURL suggests a specific file, use that
			if strings.HasSuffix(durl, ext) {
				return durl
			}
			// Default to index for HTML
			if isHTML {
				return "index.html"
			}
			return baseName + ext
		}
	}

	// For HTML without dURL, default to index.html
	if isHTML {
		return "index.html"
	}

	// Fallback
	return "content" + ext
}

// DiffCommits compares two commits and returns the differences
func (a *App) DiffCommits(scid string, commitA, commitB int) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SYNC] Diffing commits %d vs %d for: %s", commitA, commitB, scid[:16]+"..."))

	// Get content at both commits
	contentAResult := a.GetCommitContent(scid, commitA)
	contentBResult := a.GetCommitContent(scid, commitB)

	if contentAResult["success"] != true {
		return contentAResult
	}
	if contentBResult["success"] != true {
		return contentBResult
	}

	// Extract files from both commits
	filesA := make(map[string]string)
	filesB := make(map[string]string)

	if f, ok := contentAResult["files"].(map[string]string); ok {
		filesA = f
	}
	if f, ok := contentBResult["files"].(map[string]string); ok {
		filesB = f
	}

	// Get commit info for TXIDs
	commitInfoA, _ := contentAResult["commit"].(Commit)
	commitInfoB, _ := contentBResult["commit"].(Commit)

	// Generate file-based diff
	fileDiffs := generateFileDiffs(filesA, filesB)

	// Generate summary
	added, modified, removed := 0, 0, 0
	for _, fd := range fileDiffs {
		switch fd.Status {
		case "added":
			added++
		case "modified":
			modified++
		case "removed":
			removed++
		}
	}

	summary := ""
	if added+modified+removed == 0 {
		summary = "No changes"
	} else {
		parts := []string{}
		if modified > 0 {
			parts = append(parts, fmt.Sprintf("%d modified", modified))
		}
		if added > 0 {
			parts = append(parts, fmt.Sprintf("%d added", added))
		}
		if removed > 0 {
			parts = append(parts, fmt.Sprintf("%d removed", removed))
		}
		summary = strings.Join(parts, ", ")
	}

	// Also provide legacy single-content diff for backward compatibility
	// Concatenate all files for simple diff
	var contentA, contentB string
	for name, content := range filesA {
		contentA += fmt.Sprintf("// === %s ===\n%s\n\n", name, content)
	}
	for name, content := range filesB {
		contentB += fmt.Sprintf("// === %s ===\n%s\n\n", name, content)
	}
	legacyDiff := generateDiff(contentA, contentB)

	return map[string]interface{}{
		"success":    true,
		"scid":       scid,
		"commitA":    commitA,
		"commitB":    commitB,
		"fromTxid":   commitInfoA.TXID,
		"toTxid":     commitInfoB.TXID,
		"fileDiffs":  fileDiffs,
		"diff":       legacyDiff, // Legacy format for backward compatibility
		"summary":    summary,
		"hasChanges": added+modified+removed > 0,
		"stats": map[string]int{
			"added":    added,
			"modified": modified,
			"removed":  removed,
		},
	}
}

// generateFileDiffs compares two sets of files and generates per-file diffs
func generateFileDiffs(filesA, filesB map[string]string) []FileDiff {
	diffs := []FileDiff{}

	// Track all filenames
	allFiles := make(map[string]bool)
	for name := range filesA {
		allFiles[name] = true
	}
	for name := range filesB {
		allFiles[name] = true
	}

	// Compare each file
	for name := range allFiles {
		contentA, existsA := filesA[name]
		contentB, existsB := filesB[name]

		var fd FileDiff
		fd.FileName = name

		if !existsA && existsB {
			// File was added
			fd.Status = "added"
			fd.LineDiffs = generateDiff("", contentB)
		} else if existsA && !existsB {
			// File was removed
			fd.Status = "removed"
			fd.LineDiffs = generateDiff(contentA, "")
		} else if contentA != contentB {
			// File was modified
			fd.Status = "modified"
			fd.LineDiffs = generateDiff(contentA, contentB)
		} else {
			// File unchanged - skip
			continue
		}

		diffs = append(diffs, fd)
	}

	return diffs
}

// generateDiff creates a simple line-by-line diff
func generateDiff(oldContent, newContent string) []map[string]interface{} {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	diff := []map[string]interface{}{}

	maxLen := len(oldLines)
	if len(newLines) > maxLen {
		maxLen = len(newLines)
	}

	for i := 0; i < maxLen; i++ {
		oldLine := ""
		newLine := ""
		if i < len(oldLines) {
			oldLine = oldLines[i]
		}
		if i < len(newLines) {
			newLine = newLines[i]
		}

		if oldLine != newLine {
			if oldLine != "" && newLine == "" {
				diff = append(diff, map[string]interface{}{
					"type":    "removed",
					"line":    i + 1,
					"content": oldLine,
				})
			} else if oldLine == "" && newLine != "" {
				diff = append(diff, map[string]interface{}{
					"type":    "added",
					"line":    i + 1,
					"content": newLine,
				})
			} else {
				diff = append(diff, map[string]interface{}{
					"type":       "modified",
					"line":       i + 1,
					"oldContent": oldLine,
					"newContent": newLine,
				})
			}
		}
	}

	return diff
}

// parseVersionCount parses version count from SC variable
func parseVersionCount(val string) int {
	// Try direct parse
	count := 0
	decoded := decodeHexString(val)
	fmt.Sscanf(decoded, "%d", &count)
	return count
}

// Helper functions

// getWalletForDeployment returns the appropriate wallet for TELA deployments
// In simulator mode, it returns the primary simulator wallet (#0); otherwise the main app wallet
func (a *App) getWalletForDeployment(isSimulator bool) *walletapi.Wallet_Disk {
	if isSimulator {
		// Use the currently-open wallet (set by OpenTestWallet), NOT hardcoded wallet #0.
		// The user may have funded and opened a different test wallet (e.g. wallet #1)
		// and that is the wallet that holds the balance for deployment.
		w := GetWallet()
		if w != nil {
			return w
		}
		// Fallback to the internal primary wallet if nothing is open in walletManager
		if a.simulatorManager != nil && a.simulatorManager.walletManager != nil {
			return a.simulatorManager.walletManager.GetPrimaryWallet()
		}
		return nil
	}
	return GetWallet()
}

func estimateGasCost(sizeBytes int) uint64 {
	// UI display estimate only — real gas is from tela.GetGasEstimate() at deploy time.
	// Linear scaling: baseCost(100) + 0.1 gas per byte. Deliberately calibrated down from
	// an earlier logarithmic formula that produced estimates far too high.
	// Do not change without verifying against real GetGasEstimate outputs.
	// See docs/proposals/AUTO-SHARD-DURING-DEPLOY.md §12.14 for the full calibration table.
	const minGas = uint64(100)
	const baseCost = uint64(100)

	if sizeBytes <= 0 {
		return minGas
	}

	sizeCost := uint64(float64(sizeBytes) * 0.1)
	if sizeCost < 50 {
		sizeCost = 50
	}

	total := baseCost + sizeCost
	if total < minGas {
		return minGas
	}
	return total
}

func canCompress(docType string) bool {
	// Text-based types can benefit from compression
	compressible := []string{
		tela.DOC_HTML,
		tela.DOC_CSS,
		tela.DOC_JS,
		tela.DOC_JSON,
		tela.DOC_MD,
	}

	for _, t := range compressible {
		if docType == t {
			return true
		}
	}
	return false
}
