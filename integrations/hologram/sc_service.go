package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/civilware/tela"
)

// SCService handles smart contract operations

// SetVar sets a key/value store on a SCID
func (a *App) SetVar(scid, key, value string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[NOTE] Setting variable on %s: %s", scid[:16]+"...", key))

	// Check wallet
	wallet := GetWallet()
	if wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	// Validate inputs
	if scid == "" || len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID",
		}
	}

	if key == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Key cannot be empty",
		}
	}

	// Set variable using tela library
	txid, err := tela.SetVar(wallet, scid, key, value)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SetVar failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] Variable set: %s = %s (txid: %s)", key, value, txid[:16]+"..."))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"key":     key,
		"value":   value,
		"message": "Variable set successfully",
	}
}

// DeleteVar deletes a key/value store on a SCID (owner only)
func (a *App) DeleteVar(scid, key string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SC] Deleting variable on %s: %s", scid[:16]+"...", key))

	// Check wallet
	wallet := GetWallet()
	if wallet == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet is currently open",
		}
	}

	// Validate inputs
	if scid == "" || len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID",
		}
	}

	if key == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Key cannot be empty",
		}
	}

	// Delete variable using tela library
	txid, err := tela.DeleteVar(wallet, scid, key)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] DeleteVar failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] Variable deleted: %s (txid: %s)", key, txid[:16]+"..."))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"key":     key,
		"message": "Variable deleted successfully",
	}
}

// ExecuteSCViaXSWD executes a smart contract function via XSWD
func (a *App) ExecuteSCViaXSWD(scid, functionName, paramsJSON string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[FAST] Executing function %s on %s via XSWD", functionName, scid[:16]+"..."))

	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "XSWD not connected",
		}
	}

	// Build XSWD request
	var params map[string]interface{}
	if paramsJSON != "" {
		if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
			return map[string]interface{}{
				"success":        false,
				"error":          "Invalid parameters. Please check your input.",
				"technicalError": err.Error(),
			}
		}
	}

	// Add SCID and entrypoint to params
	scParams := map[string]interface{}{
		"scid":       scid,
		"entrypoint": functionName,
	}
	for k, v := range params {
		scParams[k] = v
	}

	result, err := a.xswdClient.Call("WALLET.Transfer", scParams)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Execute failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] Function executed: %s", functionName))

	return map[string]interface{}{
		"success":  true,
		"result":   result,
		"function": functionName,
		"message":  "Function executed successfully",
	}
}

// GetMODsList returns all available TELA MODs
func (a *App) GetMODsList() map[string]interface{} {
	a.logToConsole("[MODs] Getting TELA MODs list...")

	// Get all available MODs from tela library
	modList := []map[string]interface{}{}
	
	// Access MODs via tela.Mods.GetAllMods()
	allMods := tela.Mods.GetAllMods()
	for _, mod := range allMods {
		class := tela.Mods.GetClass(mod.Tag)
		modList = append(modList, map[string]interface{}{
			"tag":         mod.Tag,
			"name":        mod.Name,
			"class":       class.Name,
			"description": mod.Description,
		})
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d MODs", len(modList)))

	return map[string]interface{}{
		"success": true,
		"mods":    modList,
		"count":   len(modList),
	}
}

// GetMODInfo returns detailed information about a specific MOD
func (a *App) GetMODInfo(tag string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[TELA] Getting MOD info: %s", tag))

	// Get MOD by tag using tela.Mods.GetMod()
	mod := tela.Mods.GetMod(tag)
	if mod.Tag == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "MOD not found",
		}
	}

	class := tela.Mods.GetClass(tag)

	// Get function code for this MOD
	funcCode, funcNames := tela.Mods.Functions(tag)
	
	return map[string]interface{}{
		"success":       true,
		"tag":           mod.Tag,
		"name":          mod.Name,
		"class":         class.Name,
		"description":   mod.Description,
		"functionCode":  funcCode,
		"functionNames": funcNames,
	}
}

// GetMODsByClass returns all MODs in a specific class
func (a *App) GetMODsByClass(className string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[MODs] Getting MODs by class: %s", className))

	// Get MODs filtered by class
	filteredMods := []map[string]interface{}{}

	allClasses := tela.Mods.GetAllClasses()
	for _, class := range allClasses {
		if strings.EqualFold(class.Name, className) {
			// Get all mods and filter by this class
			allMods := tela.Mods.GetAllMods()
			for _, mod := range allMods {
				modClass := tela.Mods.GetClass(mod.Tag)
				if modClass.Name == class.Name {
					filteredMods = append(filteredMods, map[string]interface{}{
						"tag":         mod.Tag,
						"name":        mod.Name,
						"class":       class.Name,
						"description": mod.Description,
					})
				}
			}
			break
		}
	}

	return map[string]interface{}{
		"success": true,
		"class":   className,
		"mods":    filteredMods,
		"count":   len(filteredMods),
	}
}

// GetAllMODClasses returns all available MOD classes
func (a *App) GetAllMODClasses() map[string]interface{} {
	a.logToConsole("[MODs] Getting all MOD classes...")

	allClasses := tela.Mods.GetAllClasses()
	classes := []map[string]interface{}{}

	for _, class := range allClasses {
		// Count MODs in this class
		modCount := 0
		allMods := tela.Mods.GetAllMods()
		for _, mod := range allMods {
			modClass := tela.Mods.GetClass(mod.Tag)
			if modClass.Name == class.Name {
				modCount++
			}
		}

		classes = append(classes, map[string]interface{}{
			"name":     class.Name,
			"tag":      class.Tag,
			"modCount": modCount,
		})
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d MOD classes", len(classes)))

	return map[string]interface{}{
		"success": true,
		"classes": classes,
		"count":   len(classes),
	}
}

// PrepareMODInstall prepares a MOD installation by returning the updated code
// The actual installation requires calling UpdateSC via XSWD or a custom SC call
func (a *App) PrepareMODInstall(scid, modTag string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[MODs] Preparing MOD %s for SCID %s...", modTag, scid[:16]+"..."))

	// Validate SCID
	if scid == "" || len(scid) != 64 {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID",
		}
	}

	// Validate MOD exists
	mod := tela.Mods.GetMod(modTag)
	if mod.Tag == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "MOD not found. Please check the MOD tag.",
		}
	}

	// Get the MOD's function code
	funcCode, funcNames := tela.Mods.Functions(modTag)
	if funcCode == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "MOD has no function code",
		}
	}

	// Get current SC code
	scResult, err := a.daemonClient.Call("DERO.GetSC", map[string]interface{}{
		"scid": scid,
		"code": true,
	})
	if err != nil {
		return ErrorResponse(err)
	}

	currentCode := ""
	if resultMap, ok := scResult.(map[string]interface{}); ok {
		if code, ok := resultMap["code"].(string); ok {
			currentCode = code
		}
	}

	if currentCode == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Could not retrieve current SC code",
		}
	}

	// Prepare MOD header comment
	modHeader := fmt.Sprintf("\n\n// ========================================\n// MOD: %s (%s)\n// %s\n// ========================================\n", mod.Name, modTag, mod.Description)

	// Append MOD functions to current code
	updatedCode := currentCode + modHeader + funcCode

	a.logToConsole(fmt.Sprintf("[OK] MOD code prepared: %d new functions", len(funcNames)))

	return map[string]interface{}{
		"success":       true,
		"modTag":        modTag,
		"modName":       mod.Name,
		"modDescription": mod.Description,
		"scid":          scid,
		"functionNames": funcNames,
		"functionCode":  funcCode,
		"updatedCode":   updatedCode,
		"originalCode":  currentCode,
		"message":       fmt.Sprintf("MOD '%s' prepared - use UpdateSC to install", mod.Name),
	}
}

// GetSCVariables returns all variables stored in a smart contract
func (a *App) GetSCVariables(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SC] Getting SC variables: %s", scid[:16]+"..."))

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
		}
	}

	// Get all variables from Gnomon
	vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)

	variableList := []map[string]interface{}{}
	for _, v := range vars {
		variableList = append(variableList, map[string]interface{}{
			"key":   v.Key,
			"value": v.Value,
		})
	}

	return map[string]interface{}{
		"success":   true,
		"scid":      scid,
		"variables": variableList,
		"count":     len(variableList),
	}
}

// GetSCCode returns the smart contract code
func (a *App) GetSCCode(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[SC] Getting SC code: %s", scid[:16]+"..."))

	// Call daemon to get SC code
	params := map[string]interface{}{
		"scid": scid,
		"code": true,
	}

	result, err := a.daemonClient.Call("DERO.GetSC", params)
	if err != nil {
		return ErrorResponse(err)
	}

	// Extract code from result
	code := ""
	if resultMap, ok := result.(map[string]interface{}); ok {
		if c, ok := resultMap["code"].(string); ok {
			code = c
		}
	}

	// Fallback: when GetSC returns empty (e.g. simulator daemon), extract code from deployment TX.
	// For SC deployment, SCID = TXID, so we can parse the deployment transaction payload.
	if code == "" {
		txResult, err := a.daemonClient.Call("DERO.GetTransaction", map[string]interface{}{
			"txs_hashes": []string{scid},
		})
		if err == nil {
			if txMap, ok := txResult.(map[string]interface{}); ok {
				if txsHex, ok := txMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
					if hexStr, ok := txsHex[0].(string); ok {
						code = ExtractSCCodeFromDeploymentTx(hexStr)
						if code != "" {
							a.logToConsole(fmt.Sprintf("[SC] Extracted code from deployment TX (%d chars)", len(code)))
						}
					}
				}
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"code":    code,
	}
}

// GetSCInteractionHistory returns the interaction history for a smart contract
// This shows all block heights where the SC was called/modified
func (a *App) GetSCInteractionHistory(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STATS] Getting SC interaction history: %s", scid[:16]+"..."))

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is required for interaction history. Enable it in Settings.",
		}
	}

	// Get interaction heights from Gnomon
	heights := a.gnomonClient.Indexer.GravDBBackend.GetSCIDInteractionHeight(scid)

	if len(heights) == 0 {
		return map[string]interface{}{
			"success":      true,
			"scid":         scid,
			"interactions": []interface{}{},
			"count":        0,
			"message":      "No interactions found (SC may not be indexed yet)",
		}
	}

	// Convert to interaction records with timestamps
	interactions := make([]map[string]interface{}, 0, len(heights))
	
	// Get the most recent 50 interactions (sorted descending by height)
	startIdx := 0
	if len(heights) > 50 {
		startIdx = len(heights) - 50
	}
	
	for i := len(heights) - 1; i >= startIdx; i-- {
		height := heights[i]
		interaction := map[string]interface{}{
			"height": height,
			"index":  i + 1,
		}
		
		// Try to get block timestamp for this height
		blockResult, err := a.daemonClient.Call("DERO.GetBlockHeaderByTopoheight", map[string]interface{}{
			"topoheight": height,
		})
		if err == nil {
			if resultMap, ok := blockResult.(map[string]interface{}); ok {
				if header, ok := resultMap["block_header"].(map[string]interface{}); ok {
					if ts, ok := header["timestamp"].(float64); ok {
						interaction["timestamp"] = int64(ts)
					}
				}
			}
		}
		
		interactions = append(interactions, interaction)
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d interactions for SC", len(heights)))

	return map[string]interface{}{
		"success":      true,
		"scid":         scid,
		"interactions": interactions,
		"count":        len(heights),
		"showing":      len(interactions),
	}
}

