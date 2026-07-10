package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
	"unicode"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/dvm"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
)

// SCFunction represents a parsed smart contract function
type SCFunction struct {
	Name       string    `json:"name"`
	Params     []SCParam `json:"params"`
	ReturnType string    `json:"returnType"`
	UsesDERO   bool      `json:"usesDero"`   // DEROVALUE() detected
	UsesAsset  bool      `json:"usesAsset"`  // ASSETVALUE() detected
	UsesSigner bool      `json:"usesSigner"` // SIGNER() detected - can't be anonymous
}

// SCParam represents a function parameter
type SCParam struct {
	Name     string `json:"name"`
	Type     string `json:"type"`     // "String" or "Uint64"
	DataType string `json:"dataType"` // "S" or "U" for XSWD
}

// ParseSCFunctions parses SC code and returns callable functions
func (a *App) ParseSCFunctions(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SC] Parsing functions for: %s...", scid[:16]))

	// Get SC code from daemon
	codeResult := a.GetSCCode(scid)
	if success, ok := codeResult["success"].(bool); !ok || !success {
		return codeResult
	}

	code, ok := codeResult["code"].(string)
	if !ok || code == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Smart contract has no code",
		}
	}

	// Parse the DVM code
	sc, _, err := dvm.ParseSmartContract(code)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to parse smart contract: " + err.Error(),
		}
	}

	// Extract exported functions (start with uppercase)
	functions := []SCFunction{}

	for name, fn := range sc.Functions {
		// Check if exported (first char uppercase)
		runes := []rune(name)
		if len(runes) == 0 || !unicode.IsUpper(runes[0]) {
			continue // Skip private functions
		}

		scFn := SCFunction{
			Name:       name,
			Params:     []SCParam{},
			ReturnType: "Uint64", // DVM functions return Uint64
		}

		// Extract parameters
		for _, param := range fn.Params {
			paramType := "String"
			dataType := "S"
			if param.Type == dvm.Uint64 {
				paramType = "Uint64"
				dataType = "U"
			}

			scFn.Params = append(scFn.Params, SCParam{
				Name:     param.Name,
				Type:     paramType,
				DataType: dataType,
			})
		}

		// Scan function lines for special keywords
		for _, line := range fn.Lines {
			for _, token := range line {
				switch token {
				case "DEROVALUE":
					scFn.UsesDERO = true
				case "ASSETVALUE":
					scFn.UsesAsset = true
				case "SIGNER":
					scFn.UsesSigner = true
				}
			}
		}

		functions = append(functions, scFn)
	}

	// Sort functions alphabetically
	sort.Slice(functions, func(i, j int) bool {
		return functions[i].Name < functions[j].Name
	})

	a.logToConsole(fmt.Sprintf("[OK] Found %d exported functions", len(functions)))

	return map[string]interface{}{
		"success":   true,
		"functions": functions,
		"count":     len(functions),
		"scid":      scid,
	}
}

// ValidateSCCode parses raw DVM-BASIC code and returns validation result with extracted functions.
// This allows pre-deploy validation without hitting the daemon or spending DERO.
func (a *App) ValidateSCCode(code string) map[string]interface{} {
	if code == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Smart contract code cannot be empty",
		}
	}

	sc, _, err := dvm.ParseSmartContract(code)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Parse error: " + err.Error(),
		}
	}

	functions := []SCFunction{}
	hasInitialize := false

	for name, fn := range sc.Functions {
		runes := []rune(name)
		if len(runes) == 0 || !unicode.IsUpper(runes[0]) {
			continue
		}

		if name == "Initialize" || name == "InitializePrivate" {
			hasInitialize = true
		}

		scFn := SCFunction{
			Name:       name,
			Params:     []SCParam{},
			ReturnType: "Uint64",
		}

		for _, param := range fn.Params {
			paramType := "String"
			dataType := "S"
			if param.Type == dvm.Uint64 {
				paramType = "Uint64"
				dataType = "U"
			}
			scFn.Params = append(scFn.Params, SCParam{
				Name:     param.Name,
				Type:     paramType,
				DataType: dataType,
			})
		}

		for _, line := range fn.Lines {
			for _, token := range line {
				switch token {
				case "DEROVALUE":
					scFn.UsesDERO = true
				case "ASSETVALUE":
					scFn.UsesAsset = true
				case "SIGNER":
					scFn.UsesSigner = true
				}
			}
		}

		functions = append(functions, scFn)
	}

	sort.Slice(functions, func(i, j int) bool {
		return functions[i].Name < functions[j].Name
	})

	a.logToConsole(fmt.Sprintf("[SC] Validated code: %d functions, Initialize=%v", len(functions), hasInitialize))

	return map[string]interface{}{
		"success":       true,
		"functions":     functions,
		"count":         len(functions),
		"hasInitialize": hasInitialize,
	}
}

// InvokeSCFunctionParams represents the parameters for invoking an SC function
type InvokeSCFunctionParams struct {
	SCID        string                 `json:"scid"`
	Function    string                 `json:"function"`
	Params      map[string]interface{} `json:"params"`      // Function parameters
	DeroAmount  uint64                 `json:"deroAmount"`  // DERO to send (atomic units)
	AssetSCID   string                 `json:"assetScid"`   // Token SCID if sending asset
	AssetAmount uint64                 `json:"assetAmount"` // Token amount
	Anonymous   bool                   `json:"anonymous"`   // Use ringsize 16
}

// InvokeSCFunction builds and sends an SC invocation transaction
func (a *App) InvokeSCFunction(paramsJSON string) map[string]interface{} {
	var params InvokeSCFunctionParams
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid parameters: " + err.Error(),
		}
	}

	scidPrefix := params.SCID
	if len(scidPrefix) > 16 {
		scidPrefix = scidPrefix[:16]
	}
	a.logToConsole(fmt.Sprintf("[SC] Invoking %s on %s...", params.Function, scidPrefix))

	// Check wallet
	wallet := GetWallet()
	if wallet == nil {
		// Try XSWD if no local wallet
		if a.xswdClient != nil && a.xswdClient.IsConnected() {
			return a.invokeSCViaXSWD(params)
		}
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet available. Open a wallet or connect via XSWD.",
		}
	}

	// Route through the wallet's built-in scinvoke path (same path used by dApps),
	// which keeps SC arg handling consistent across Studio and XSWD calls.
	scRPC := []interface{}{
		map[string]interface{}{"name": "entrypoint", "datatype": "S", "value": params.Function},
	}
	for name, value := range params.Params {
		switch v := value.(type) {
		case string:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "S", "value": v,
			})
		case float64:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "U", "value": v,
			})
		case int:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "U", "value": float64(v),
			})
		case uint64:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "U", "value": float64(v),
			})
		}
	}

	walletParams := map[string]interface{}{
		"scid":     params.SCID,
		"sc_rpc":   scRPC,
		"ringsize": float64(2),
	}
	if params.Anonymous {
		walletParams["ringsize"] = float64(16)
	}
	if params.DeroAmount > 0 {
		walletParams["sc_dero_deposit"] = float64(params.DeroAmount)
	}
	if params.AssetSCID != "" && params.AssetAmount > 0 {
		walletParams["sc_token_deposit"] = float64(params.AssetAmount)
		walletParams["sc_token_deposit_scid"] = params.AssetSCID
	}

	a.logToConsole(fmt.Sprintf("[SC] Forwarding invoke through wallet scinvoke path (args=%d)", len(scRPC)-1))
	invokeResult := a.InternalWalletCall("scinvoke", walletParams, "")
	if success, _ := invokeResult["success"].(bool); !success {
		errorMessage := "Transaction failed"
		if errText, ok := invokeResult["error"].(string); ok && errText != "" {
			errorMessage = errText
		}
		resp := map[string]interface{}{
			"success": false,
			"error":   errorMessage,
		}
		if technicalError, ok := invokeResult["technicalError"].(string); ok && technicalError != "" {
			resp["technicalError"] = technicalError
		}
		return resp
	}

	txid := ""
	if resultMap, ok := invokeResult["result"].(map[string]interface{}); ok {
		if tx, ok := resultMap["txid"].(string); ok {
			txid = tx
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] SC invoked successfully: %s...", txid))
	return map[string]interface{}{
		"success":  true,
		"txid":     txid,
		"function": params.Function,
		"message":  "Smart contract function called successfully",
	}
}

func (a *App) invokeSCFunctionSimulator(params InvokeSCFunctionParams, wallet *walletapi.Wallet_Disk, scArgs rpc.Arguments) map[string]interface{} {
	mature, _ := wallet.Get_Balance()
	if mature == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Insufficient balance. Smart contract calls require gas fees — please fund your simulator wallet first.",
		}
	}

	destination := a.getSimulatorTransferDestination(wallet.GetAddress().String())
	transfers := []rpc.Transfer{}
	if params.DeroAmount > 0 {
		transfers = append(transfers, rpc.Transfer{
			Destination: destination,
			Amount:      0,
			Burn:        params.DeroAmount,
		})
	}
	if params.AssetSCID != "" && params.AssetAmount > 0 {
		transfers = append(transfers, rpc.Transfer{
			Destination: destination,
			SCID:        crypto.HashHexToHash(params.AssetSCID),
			Amount:      0,
			Burn:        params.AssetAmount,
		})
	}
	if len(transfers) == 0 {
		transfers = append(transfers, rpc.Transfer{
			Destination: destination,
			Amount:      0,
		})
	}

	ringsize := uint64(2)
	if params.Anonymous {
		ringsize = 16
	}

	gasStorage := a.estimateSCInvokeGas(params, wallet, ringsize)
	a.logToConsole(fmt.Sprintf("[SC] Building simulator TX: ringsize=%d gasStorage=%d transfers=%d", ringsize, gasStorage, len(transfers)))

	tx, err := wallet.TransferPayload0(transfers, ringsize, false, scArgs, gasStorage, false)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction failed: " + err.Error(),
		}
	}

	if err := wallet.SendTransaction(tx); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to send transaction: " + err.Error(),
		}
	}

	txid := tx.GetHash().String()
	a.logToConsole(fmt.Sprintf("[OK] SC invoked successfully: %s...", txid[:16]))
	return map[string]interface{}{
		"success":  true,
		"txid":     txid,
		"function": params.Function,
		"message":  "Smart contract function called successfully",
	}
}

func (a *App) estimateSCInvokeGas(params InvokeSCFunctionParams, wallet *walletapi.Wallet_Disk, ringsize uint64) uint64 {
	gasRPC := []map[string]interface{}{
		{"name": "SC_ACTION", "datatype": "U", "value": uint64(0)},
		{"name": "SC_ID", "datatype": "H", "value": params.SCID},
		{"name": "entrypoint", "datatype": "S", "value": params.Function},
	}
	for name, value := range params.Params {
		switch v := value.(type) {
		case string:
			gasRPC = append(gasRPC, map[string]interface{}{"name": name, "datatype": "S", "value": v})
		case float64:
			gasRPC = append(gasRPC, map[string]interface{}{"name": name, "datatype": "U", "value": uint64(v)})
		case int:
			gasRPC = append(gasRPC, map[string]interface{}{"name": name, "datatype": "U", "value": uint64(v)})
		}
	}

	gasParams := map[string]interface{}{
		"sc_rpc":   gasRPC,
		"ringsize": ringsize,
		"signer":   wallet.GetAddress().String(),
	}
	if a.daemonClient == nil {
		return 0
	}

	gasResult, gasErr := a.daemonClient.Call("DERO.GetGasEstimate", gasParams)
	if gasErr != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Gas estimate failed (proceeding with 0): %v", gasErr))
		return 0
	}

	resultMap, ok := gasResult.(map[string]interface{})
	if !ok {
		return 0
	}
	if gs, ok := resultMap["gasstorage"].(float64); ok {
		return uint64(gs)
	}
	return 0
}

// invokeSCViaXSWD invokes SC function via XSWD connection
func (a *App) invokeSCViaXSWD(params InvokeSCFunctionParams) map[string]interface{} {
	// Build XSWD-compatible request
	scRPC := []map[string]interface{}{
		{"name": "entrypoint", "datatype": "S", "value": params.Function},
	}

	for name, value := range params.Params {
		switch v := value.(type) {
		case string:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "S", "value": v,
			})
		case float64:
			scRPC = append(scRPC, map[string]interface{}{
				"name": name, "datatype": "U", "value": uint64(v),
			})
		}
	}

	xswdParams := map[string]interface{}{
		"scid":   params.SCID,
		"sc_rpc": scRPC,
	}

	// Add transfers if DERO/asset amounts
	if params.DeroAmount > 0 || params.AssetAmount > 0 {
		transfers := []map[string]interface{}{}
		if params.DeroAmount > 0 {
			transfers = append(transfers, map[string]interface{}{
				"burn": params.DeroAmount,
			})
		}
		if params.AssetSCID != "" && params.AssetAmount > 0 {
			transfers = append(transfers, map[string]interface{}{
				"scid": params.AssetSCID,
				"burn": params.AssetAmount,
			})
		}
		xswdParams["transfers"] = transfers
	}

	if params.Anonymous {
		xswdParams["ringsize"] = 16
	}

	result, err := a.xswdClient.Call("scinvoke", xswdParams)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "XSWD call failed: " + err.Error(),
		}
	}

	// Extract txid from result if available
	txid := ""
	if resultMap, ok := result.(map[string]interface{}); ok {
		if t, ok := resultMap["txid"].(string); ok {
			txid = t
		}
	}

	return map[string]interface{}{
		"success":  true,
		"txid":     txid,
		"result":   result,
		"function": params.Function,
		"message":  "Smart contract function called via XSWD",
	}
}

func (a *App) InstallSmartContract(code string, anonymous bool) map[string]interface{} {
	a.logToConsole("[SC] Installing smart contract...")

	isSimulator := a.simulatorManager != nil && a.simulatorManager.isInitialized

	// In simulator mode, use the simulator wallet manager's primary wallet
	// (same as TELA deployment) rather than the user-facing walletManager.
	// GetWallet() returns the wallet opened via the UI, but it may not have
	// a properly synced encrypted balance in simulator mode.
	var wallet *walletapi.Wallet_Disk
	if isSimulator {
		if a.simulatorManager != nil && a.simulatorManager.walletManager != nil {
			wallet = a.simulatorManager.walletManager.GetPrimaryWallet()
		}
	} else {
		wallet = GetWallet()
	}

	if wallet == nil {
		errMsg := "No wallet available. Open a wallet first."
		if isSimulator {
			errMsg = "Simulator wallet not available. Restart simulator mode."
		}
		return map[string]interface{}{
			"success": false,
			"error":   errMsg,
		}
	}

	if code == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Smart contract code cannot be empty",
		}
	}

	_, _, err := dvm.ParseSmartContract(code)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid smart contract code: " + err.Error(),
		}
	}

	scArgs := rpc.Arguments{
		{Name: rpc.SCACTION, DataType: rpc.DataUint64, Value: uint64(rpc.SC_INSTALL)},
		{Name: rpc.SCCODE, DataType: rpc.DataString, Value: code},
	}

	ringsize := uint64(2)
	if anonymous {
		ringsize = 16
	}

	endpoint := a.getDaemonEndpointForWallet()

	if isSimulator {
		// SIMULATOR MODE: The simulator daemon can only handle ONE WebSocket at a
		// time. We must ensure ALL WebSocket connections are closed before opening
		// our own, then resume them after we disconnect.
		a.logToConsole("[SC] Using simulator-safe connect/disconnect pattern")

		// Step 1: Close any lingering walletapi WebSocket (e.g. from OpenSimulatorTestWallet)
		// BEFORE pausing Gnomon, so the daemon isn't juggling multiple connections.
		walletapi.Daemon_Endpoint_Active = ""
		a.disconnectWalletAPI()

		// Step 2: Pause Gnomon (closes its persistent WebSocket)
		gnomonWasRunning := a.pauseGnomonForSimulator()

		// Extra settle time to let the daemon fully release all connections
		time.Sleep(300 * time.Millisecond)

		if err := walletapi.Connect(endpoint); err != nil {
			walletapi.Daemon_Endpoint_Active = ""
			if gnomonWasRunning {
				a.resumeGnomonForSimulator()
			}
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to connect to simulator daemon: %v", err),
			}
		}

		// Sync multiple times to ensure encrypted balance is available
		for i := 0; i < 3; i++ {
			if err := wallet.Sync_Wallet_Memory_With_Daemon(); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Sync attempt %d failed: %v", i+1, err))
			}
			time.Sleep(50 * time.Millisecond)
		}

		senderAddr := wallet.GetAddress().String()
		destAddr := a.getSimulatorTransferDestination(senderAddr)
		transfers := []rpc.Transfer{{Destination: destAddr, Amount: 0}}
		gasStorage := SimulatorGasFee
		a.logToConsole(fmt.Sprintf("[GAS] Simulator mode — using fixed gas fee for SC install: %d", gasStorage))

		tx, err := wallet.TransferPayload0(transfers, ringsize, false, scArgs, gasStorage, false)
		if err != nil {
			walletapi.Daemon_Endpoint_Active = ""
			a.disconnectWalletAPI()
			if gnomonWasRunning {
				a.resumeGnomonForSimulator()
			}
			return map[string]interface{}{
				"success": false,
				"error":   "Transaction failed: " + err.Error(),
			}
		}

		if err := wallet.SendTransaction(tx); err != nil {
			walletapi.Daemon_Endpoint_Active = ""
			a.disconnectWalletAPI()
			if gnomonWasRunning {
				a.resumeGnomonForSimulator()
			}
			return map[string]interface{}{
				"success": false,
				"error":   "Failed to send transaction: " + err.Error(),
			}
		}

		txid := tx.GetHash().String()

		// Disconnect to free the daemon's single WebSocket slot
		walletapi.Daemon_Endpoint_Active = ""
		a.disconnectWalletAPI()
		a.logToConsole(fmt.Sprintf("[OK] SC installed! TXID: %s (simulator, disconnected)", txid[:16]))

		// Wait for the daemon to fully process the transaction and stabilize
		// before allowing Gnomon to reconnect. The simulator needs time to
		// mine the block containing the SC install transaction.
		time.Sleep(2 * time.Second)

		// Resume Gnomon now that the WebSocket is free and the block is mined
		if gnomonWasRunning {
			a.resumeGnomonForSimulator()
		}

		return map[string]interface{}{
			"success": true,
			"txid":    txid,
			"message": "Smart contract installed successfully. The SCID will be available once the transaction is confirmed.",
		}
	}

	// NON-SIMULATOR (MAINNET): Use persistent connection with Keep_Connectivity
	a.ensureWalletDaemonConnectivity(endpoint)

	randos := wallet.Random_ring_members(crypto.ZEROHASH)
	if len(randos) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Could not get ring members - check daemon connection",
		}
	}
	destination := randos[0]
	if destination == wallet.GetAddress().String() && len(randos) > 1 {
		destination = randos[1]
	}

	transfers := []rpc.Transfer{{Destination: destination, Amount: 0}}

	tx, err := wallet.TransferPayload0(transfers, ringsize, false, scArgs, 0, false)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction failed: " + err.Error(),
		}
	}

	if err := wallet.SendTransaction(tx); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to send transaction: " + err.Error(),
		}
	}

	txid := tx.GetHash().String()
	a.logToConsole(fmt.Sprintf("[OK] SC installed! TXID: %s", txid[:16]))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"message": "Smart contract installed successfully. The SCID will be available once the transaction is confirmed.",
	}
}
