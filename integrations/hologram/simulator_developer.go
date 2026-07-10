package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
)

// SimulatorDeveloper provides developer experience features for simulator mode
// These functions wrap existing deployment functions with simulator-specific enhancements

// ================== Smart Contract Deployment ==================

// DeployToSimulator deploys a smart contract in simulator mode with auto-mine confirmation
// This is faster than regular deployment since it auto-mines to confirm the transaction
func (a *App) DeployToSimulator(code string) map[string]interface{} {
	// Check simulator mode
	if !a.IsInSimulatorMode() {
		return map[string]interface{}{
			"success": false,
			"error":   "DeployToSimulator is only available in Simulator mode. Switch to Simulator first.",
		}
	}

	// Check simulator is ready
	if a.simulatorManager == nil || !a.simulatorManager.IsReady() {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator is not ready. Start simulator mode first.",
		}
	}

	// Check wallet (use primary wallet #0)
	wallet := a.simulatorManager.walletManager.GetPrimaryWallet()
	if wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator wallet is not available",
		}
	}

	a.logToConsole("[START] Deploying smart contract to Simulator...")
	a.logToConsole("[NOTE] Code length: " + fmt.Sprintf("%d bytes", len(code)))

	// Deploy the SC using wallet transfer with SC code
	// For simulator, we use the XSWD server to install
	txid, err := a.deployRawSC(code)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Deployment failed: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[TX] Transaction submitted: %s", txid))

	// Wait a moment for block generation (simulator auto-generates blocks)
	time.Sleep(500 * time.Millisecond)

	// The TXID is also the SCID for SC deployments
	scid := txid

	a.logToConsole(fmt.Sprintf("[OK] Smart contract deployed: %s", scid))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"scid":    scid,
		"gasCost": "FREE (Simulator)",
		"message": "Smart contract deployed - will confirm on next block",
	}
}

// deployRawSC deploys raw SC code using the simulator's primary wallet.
// Pauses Gnomon and uses a temporary connect/disconnect pattern to avoid
// crashing the simulator daemon's single WebSocket slot.
func (a *App) deployRawSC(code string) (string, error) {
	wallet := a.simulatorManager.walletManager.GetPrimaryWallet()
	if wallet == nil {
		return "", fmt.Errorf("no wallet available")
	}

	scArgs := rpc.Arguments{
		{Name: rpc.SCACTION, DataType: rpc.DataUint64, Value: uint64(rpc.SC_INSTALL)},
		{Name: rpc.SCCODE, DataType: rpc.DataString, Value: code},
	}

	endpoint := fmt.Sprintf("127.0.0.1:%d", GetNetworkConfig(NetworkSimulator).RPCPort)

	gnomonWasRunning := a.pauseGnomonForSimulator()

	a.disconnectWalletAPI()
	if err := walletapi.Connect(endpoint); err != nil {
		if gnomonWasRunning {
			a.resumeGnomonForSimulator()
		}
		return "", fmt.Errorf("failed to connect to simulator daemon: %v", err)
	}

	if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Pre-deploy sync failed: %v", err))
	}

	senderAddr := wallet.GetAddress().String()
	destAddr := a.getSimulatorTransferDestination(senderAddr)
	transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}

	tx, err := wallet.TransferPayload0(transfers, 2, false, scArgs, 0, false)
	if err != nil {
		a.disconnectWalletAPI()
		if gnomonWasRunning {
			a.resumeGnomonForSimulator()
		}
		return "", fmt.Errorf("transaction build failed: %v", err)
	}

	if err := wallet.SendTransaction(tx); err != nil {
		a.disconnectWalletAPI()
		if gnomonWasRunning {
			a.resumeGnomonForSimulator()
		}
		return "", fmt.Errorf("transaction send failed: %v", err)
	}

	txid := tx.GetHash().String()
	a.disconnectWalletAPI()

	// Wait for the daemon to process the transaction and mine the block
	// before allowing Gnomon to reconnect
	time.Sleep(2 * time.Second)

	if gnomonWasRunning {
		a.resumeGnomonForSimulator()
	}

	return txid, nil
}

// ================== TELA App Deployment ==================

// TELAAppPreview represents a complete TELA app for preview deployment
type TELAAppPreview struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	DURL        string                 `json:"durl"`
	IconURL     string                 `json:"iconUrl"`
	Files       []TELAFilePreview      `json:"files"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// TELAFilePreview represents a single file in the TELA app
type TELAFilePreview struct {
	Name     string `json:"name"`
	Path     string `json:"path"`     // Local path if reading from disk
	Content  string `json:"content"`  // Direct content if provided
	SubDir   string `json:"subDir"`   // Subdirectory in the app
	DocType  string `json:"docType"`  // File type (html, css, js, etc.)
}

// PreviewTELAApp deploys a complete TELA app to the simulator for preview
// This creates the INDEX and all DOC smart contracts in one operation
func (a *App) PreviewTELAApp(appJSON string) map[string]interface{} {
	// Check simulator mode
	if !a.IsInSimulatorMode() {
		return map[string]interface{}{
			"success": false,
			"error":   "PreviewTELAApp is only available in Simulator mode",
		}
	}

	// Check simulator is ready
	if a.simulatorManager == nil || !a.simulatorManager.IsReady() {
		return map[string]interface{}{
			"success": false,
			"error":   "Simulator is not ready. Start simulator mode first.",
		}
	}

	// Parse app info
	var app TELAAppPreview
	if err := json.Unmarshal([]byte(appJSON), &app); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Invalid app JSON: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[START] Deploying TELA App: %s", app.Name))
	a.logToConsole(fmt.Sprintf("[DIR] Files: %d", len(app.Files)))

	// Track deployed DOC SCIDs
	docSCIDs := []string{}
	deployedFiles := []map[string]interface{}{}

	// Step 1: Deploy all DOC files
	for i, file := range app.Files {
		a.logToConsole(fmt.Sprintf("[DOC] [%d/%d] Deploying: %s", i+1, len(app.Files), file.Name))

		// Build DOC info
		docInfo := DOCInfo{
			Name:    file.Name,
			SubDir:  file.SubDir,
			DocType: file.DocType,
		}

		// Get content
		if file.Content != "" {
			docInfo.Data = []byte(file.Content)
		} else if file.Path != "" {
			// Read from file path
			data, err := readFileContent(file.Path)
			if err != nil {
				return map[string]interface{}{
					"success": false,
					"error":   fmt.Sprintf("Failed to read file %s: %v", file.Name, err),
				}
			}
			docInfo.Data = data
		}

		// Install DOC
		docJSON, _ := json.Marshal(docInfo)
		result := a.InstallDOC(string(docJSON))

		if !result["success"].(bool) {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to deploy %s: %v", file.Name, result["error"]),
			}
		}

		// Wait for block generation (simulator auto-generates)
		time.Sleep(200 * time.Millisecond)

		// The TXID is the SCID for DOC
		scid := result["txid"].(string)
		docSCIDs = append(docSCIDs, scid)
		
		deployedFiles = append(deployedFiles, map[string]interface{}{
			"name": file.Name,
			"scid": scid,
		})

		a.logToConsole(fmt.Sprintf("   [OK] Deployed: %s", scid[:16]+"..."))
	}

	// Step 2: Deploy INDEX with all DOC references
	a.logToConsole("[INDEX] Deploying INDEX...")

	indexInfo := INDEXInfo{
		Name:        app.Name,
		Description: app.Description,
		DURL:        app.DURL,
		IconURL:     app.IconURL,
		DOCSCIDs:    docSCIDs,
	}

	indexJSON, _ := json.Marshal(indexInfo)
	indexResult := a.InstallINDEX(string(indexJSON))

	if !indexResult["success"].(bool) {
		return map[string]interface{}{
			"success":       false,
			"error":         fmt.Sprintf("Failed to deploy INDEX: %v", indexResult["error"]),
			"deployedFiles": deployedFiles, // Return partial success info
		}
	}

	// Wait for block generation (simulator auto-generates)
	time.Sleep(200 * time.Millisecond)

	indexSCID := indexResult["txid"].(string)

	a.logToConsole(fmt.Sprintf("[OK] TELA App deployed successfully!"))
	a.logToConsole(fmt.Sprintf("[LINK] INDEX SCID: %s", indexSCID))
	a.logToConsole(fmt.Sprintf("[NET] URL: dero://%s", indexSCID))

	return map[string]interface{}{
		"success":       true,
		"indexSCID":     indexSCID,
		"durl":          app.DURL,
		"url":           fmt.Sprintf("dero://%s", indexSCID),
		"deployedFiles": deployedFiles,
		"totalFiles":    len(app.Files),
		"gasCost":       "FREE (Simulator)",
		"message":       "TELA app deployed and ready for preview",
	}
}

// readFileContent reads file content from disk
func readFileContent(path string) ([]byte, error) {
	return os.ReadFile(path)
}

// ================== Gas Estimation for Simulator ==================

// EstimateSimulatorGas returns gas estimate with simulator-specific info
func (a *App) EstimateSimulatorGas(docJSON string) map[string]interface{} {
	// Get regular gas estimate
	result := a.GetGasEstimate(docJSON)
	
	// Add simulator-specific info
	if a.IsInSimulatorMode() {
		result["isSimulator"] = true
		result["actualCost"] = "FREE"
		result["note"] = "Simulator mode - no real DERO required"
	} else {
		result["isSimulator"] = false
	}
	
	return result
}

// ================== Utility Functions ==================

// IsInSimulatorMode checks if we're currently in simulator mode
func (a *App) IsInSimulatorMode() bool {
	return nodeManager.networkMode == NetworkSimulator
}

// GetSimulatorDeploymentInfo returns information about deploying in simulator mode
func (a *App) GetSimulatorDeploymentInfo() map[string]interface{} {
	isSimulator := a.IsInSimulatorMode()
	
	info := map[string]interface{}{
		"isSimulator":    isSimulator,
		"deploymentCost": "FREE",
		"confirmTime":    "Instant (auto-mined)",
	}
	
	if isSimulator && a.simulatorManager != nil {
		status := a.simulatorManager.GetStatus()
		info["simulatorReady"] = a.simulatorManager.IsReady()
		info["walletOpen"] = status.WalletOpen
		info["walletAddress"] = status.WalletAddress
		info["balance"] = status.Balance
		info["blockHeight"] = status.BlockHeight
	} else {
		info["simulatorReady"] = false
		info["note"] = "Switch to Simulator mode for free deployments"
	}
	
	return info
}

// QuickDeployFile is a convenience function to deploy a single file to simulator
func (a *App) QuickDeployFile(name, content, docType string) map[string]interface{} {
	if !a.IsInSimulatorMode() {
		return map[string]interface{}{
			"success": false,
			"error":   "QuickDeployFile is only available in Simulator mode",
		}
	}

	docInfo := DOCInfo{
		Name:    name,
		DocType: docType,
		Data:    []byte(content),
	}

	docJSON, _ := json.Marshal(docInfo)
	result := a.InstallDOC(string(docJSON))

	if result["success"].(bool) {
		result["gasCost"] = "FREE (Simulator)"
	}

	return result
}

// BatchDeployToSimulator deploys multiple SCs in sequence with auto-mining
func (a *App) BatchDeployToSimulator(codesJSON string) map[string]interface{} {
	if !a.IsInSimulatorMode() {
		return map[string]interface{}{
			"success": false,
			"error":   "BatchDeployToSimulator is only available in Simulator mode",
		}
	}

	var codes []string
	if err := json.Unmarshal([]byte(codesJSON), &codes); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Invalid codes JSON: %v", err),
		}
	}

	results := []map[string]interface{}{}
	successful := 0

	for i, code := range codes {
		a.logToConsole(fmt.Sprintf("[PKG] [%d/%d] Deploying SC...", i+1, len(codes)))
		
		result := a.DeployToSimulator(code)
		results = append(results, result)
		
		if result["success"].(bool) {
			successful++
		}
	}

	return map[string]interface{}{
		"success":    successful == len(codes),
		"total":      len(codes),
		"successful": successful,
		"failed":     len(codes) - successful,
		"results":    results,
		"gasCost":    "FREE (Simulator)",
	}
}
