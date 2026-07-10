package main

import (
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/proof"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/transaction"
)

// ExplorerService provides block explorer functionality with DeroProof validation

// GetBlock retrieves detailed block information
func (a *App) GetBlock(height int64) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting block at height: %d", height))

	params := map[string]interface{}{
		"height": height,
	}

	result, err := a.daemonClient.Call("DERO.GetBlock", params)
	if err != nil {
		return ErrorResponse(err)
	}

	// Parse block data
	blockData := map[string]interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		if block, ok := resultMap["block"].(map[string]interface{}); ok {
			blockData = block
		} else {
			blockData = resultMap
		}
	}

	return map[string]interface{}{
		"success": true,
		"height":  height,
		"block":   blockData,
	}
}

// GetBlockExtended retrieves comprehensive block information including all metadata
// This matches the official DERO explorer functionality
func (a *App) GetBlockExtended(heightOrHash string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting extended block: %s", heightOrHash))

	// Build params based on input type
	var params map[string]interface{}
	if len(heightOrHash) == 64 {
		params = map[string]interface{}{"hash": heightOrHash}
	} else {
		var height int64
		fmt.Sscanf(heightOrHash, "%d", &height)
		params = map[string]interface{}{"height": height}
	}

	result, err := a.daemonClient.Call("DERO.GetBlock", params)
	if err != nil {
		return ErrorResponse(err)
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return map[string]interface{}{"success": false, "error": "Invalid block data format"}
	}

	// Extract block_header and blob
	blockHeader := map[string]interface{}{}
	if bh, ok := resultMap["block_header"].(map[string]interface{}); ok {
		blockHeader = bh
	}

	blob := ""
	if b, ok := resultMap["blob"].(string); ok {
		blob = b
	}

	// Use helpers for extraction
	age, blockTime := "", ""
	if timestamp, ok := blockHeader["timestamp"].(float64); ok {
		age, blockTime = calculateBlockAge(timestamp)
	}

	tips := extractStringArray(blockHeader["tips"])
	miners := extractStringArray(blockHeader["miners"])

	// Determine network and parse block
	isMainnet := true
	if network, ok := a.settings["network"].(string); ok && network == "simulator" {
		isMainnet = false
	}
	parsed := parseBlockBlob(blob, isMainnet)

	// Calculate fees from transactions
	totalFees, txDetails := a.extractBlockTxDetails(parsed.TxHashes)

	// Build comprehensive response
	response := map[string]interface{}{
		"success": true,

		// Core identifiers
		"height":     blockHeader["height"],
		"topoheight": blockHeader["topoheight"],
		"hash":       blockHeader["hash"],

		// Block metadata
		"depth":         blockHeader["depth"],
		"difficulty":    blockHeader["difficulty"],
		"major_version": blockHeader["major_version"],
		"minor_version": blockHeader["minor_version"],
		"nonce":         blockHeader["nonce"],

		// Status flags
		"orphan_status": blockHeader["orphan_status"],
		"sync_block":    blockHeader["syncblock"],
		"side_block":    blockHeader["sideblock"],

		// DAG structure
		"tips": tips,

		// Mining info
		"miners":        miners,
		"miner_address": parsed.MinerAddress,
		"reward":        blockHeader["reward"],

		// Timing
		"timestamp":  blockHeader["timestamp"],
		"age":        age,
		"block_time": blockTime,

		// Transactions
		"tx_count":   blockHeader["txcount"],
		"tx_hashes":  parsed.TxHashes,
		"txs":        txDetails,
		"total_fees": totalFees,

		// Size
		"size_bytes": parsed.BlockSize,
		"size_kb":    fmt.Sprintf("%.03f", float64(parsed.BlockSize)/1024),

		// Raw data
		"blob": blob,
	}

	a.logToConsole(fmt.Sprintf("[OK] Block %v: %d TXs, %d tips, miner=%s",
		blockHeader["height"], len(parsed.TxHashes), len(tips),
		truncateAddrForLog(parsed.MinerAddress)))

	return response
}

// extractBlockTxDetails fetches transaction details for a block
func (a *App) extractBlockTxDetails(txHashes []string) (uint64, []map[string]interface{}) {
	var totalFees uint64 = 0
	txDetails := []map[string]interface{}{}

	for _, txHash := range txHashes {
		txInfo := a.GetTransactionBasic(txHash)
		if txInfo["success"].(bool) {
			if tx, ok := txInfo["tx"].(map[string]interface{}); ok {
				txDetails = append(txDetails, map[string]interface{}{
					"hash":   txHash,
					"fee":    tx["fee"],
					"type":   tx["tx_type"],
					"scid":   tx["scid"],
					"signer": tx["signer"],
				})
				if fee, ok := tx["fee"].(float64); ok {
					totalFees += uint64(fee)
				}
			}
		}
	}

	return totalFees, txDetails
}

// GetTransactionBasic returns basic transaction info (used internally)
func (a *App) GetTransactionBasic(txid string) map[string]interface{} {
	params := map[string]interface{}{
		"txs_hashes":     []string{txid},
		"decode_as_json": 1,
	}

	result, err := a.daemonClient.Call("DERO.GetTransaction", params)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid response format",
		}
	}

	txs, ok := resultMap["txs"].([]interface{})
	if !ok || len(txs) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction not found",
		}
	}

	txData, ok := txs[0].(map[string]interface{})
	if !ok {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid transaction data",
		}
	}

	return map[string]interface{}{
		"success": true,
		"tx":      txData,
	}
}

// truncateAddrForLog truncates an address for logging
func truncateAddrForLog(addr string) string {
	if len(addr) > 16 {
		return addr[:8] + "..." + addr[len(addr)-8:]
	}
	return addr
}

// GetBlockByHash retrieves block information by hash
func (a *App) GetBlockByHash(hash string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting block by hash: %s", hash[:16]+"..."))

	params := map[string]interface{}{
		"hash": hash,
	}

	result, err := a.daemonClient.Call("DERO.GetBlock", params)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"hash":    hash,
		"block":   result,
	}
}

// GetTransaction retrieves transaction details
func (a *App) GetTransaction(txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting transaction: %s", txid[:16]+"..."))

	params := map[string]interface{}{
		"txs_hashes":     []string{txid},
		"decode_as_json": 1,
	}

	result, err := a.daemonClient.Call("DERO.GetTransaction", params)
	if err != nil {
		return ErrorResponse(err)
	}

	// Extract transaction from result
	txData := map[string]interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		if txs, ok := resultMap["txs"].([]interface{}); ok && len(txs) > 0 {
			if tx, ok := txs[0].(map[string]interface{}); ok {
				txData = tx
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"tx":      txData,
	}
}

// GetCoinbaseMiner extracts the miner address from a coinbase transaction
// by parsing the raw transaction binary
func (a *App) GetCoinbaseMiner(txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[MINE] Getting miner address for TX: %s", txid[:16]+"..."))

	// Fetch raw transaction hex
	params := map[string]interface{}{
		"txs_hashes":     []string{txid},
		"decode_as_json": 1,
	}

	result, err := a.daemonClient.Call("DERO.GetTransaction", params)
	if err != nil {
		return ErrorResponse(err)
	}

	var txHex string
	if resultMap, ok := result.(map[string]interface{}); ok {
		if txsHex, ok := resultMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
			if hexStr, ok := txsHex[0].(string); ok {
				txHex = hexStr
			}
		}
	}

	if txHex == "" {
		return map[string]interface{}{
			"success":    true,
			"isCoinbase": false,
			"message":    "No raw transaction hex available",
		}
	}

	// Decode hex to bytes
	txBytes, err := hex.DecodeString(txHex)
	if err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to decode transaction data",
			"technicalError": err.Error(),
		}
	}

	// Parse the transaction
	var tx transaction.Transaction
	if err := tx.Deserialize(txBytes); err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to parse transaction",
			"technicalError": err.Error(),
		}
	}

	// Check if this is a coinbase transaction
	if tx.TransactionType != transaction.COINBASE {
		return map[string]interface{}{
			"success":    true,
			"isCoinbase": false,
			"txType":     getTxTypeName(tx.TransactionType),
		}
	}

	// Extract miner address from coinbase TX
	var acckey crypto.Point
	if err := acckey.DecodeCompressed(tx.MinerAddress[:]); err != nil {
		return map[string]interface{}{
			"success":        true,
			"isCoinbase":     true,
			"error":          "Failed to decode miner address",
			"technicalError": err.Error(),
		}
	}

	// Determine network (mainnet vs simulator)
	mainnet := true
	if network, ok := a.settings["network"].(string); ok && network == "simulator" {
		mainnet = false
	}

	// Convert to address string
	astring := rpc.NewAddressFromKeys(&acckey)
	astring.Mainnet = mainnet
	minerAddress := astring.String()

	a.logToConsole(fmt.Sprintf("[OK] Coinbase TX miner: %s", minerAddress[:20]+"..."))

	return map[string]interface{}{
		"success":      true,
		"isCoinbase":   true,
		"minerAddress": minerAddress,
		"txType":       "COINBASE",
	}
}

// getTxTypeName returns a human-readable name for the transaction type
func getTxTypeName(txType transaction.TransactionType) string {
	switch txType {
	case transaction.PREMINE:
		return "PREMINE"
	case transaction.REGISTRATION:
		return "REGISTRATION"
	case transaction.COINBASE:
		return "COINBASE"
	case transaction.NORMAL:
		return "NORMAL"
	case transaction.BURN_TX:
		return "BURN"
	case transaction.SC_TX:
		return "SC"
	default:
		return "UNKNOWN"
	}
}

// GetTransactionExtended returns comprehensive transaction info matching official DERO explorer
// Includes: ring members per payload, assets breakdown, valid/invalid blocks, size, raw hex
func (a *App) GetTransactionExtended(txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting extended transaction: %s", txid[:16]+"..."))

	// Fetch full transaction data from daemon
	params := map[string]interface{}{
		"txs_hashes":     []string{txid},
		"decode_as_json": 1,
	}

	result, err := a.daemonClient.Call("DERO.GetTransaction", params)
	if err != nil {
		return ErrorResponse(err)
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return map[string]interface{}{"success": false, "error": "Invalid response format"}
	}

	// Extract raw hex
	var txHex string
	if txsHex, ok := resultMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
		if hexStr, ok := txsHex[0].(string); ok {
			txHex = hexStr
		}
	}

	// Extract transaction info
	txs, ok := resultMap["txs"].([]interface{})
	if !ok || len(txs) == 0 {
		return map[string]interface{}{"success": false, "error": "Transaction not found"}
	}

	txData, ok := txs[0].(map[string]interface{})
	if !ok {
		return map[string]interface{}{"success": false, "error": "Invalid transaction data"}
	}

	// Use helper functions for extraction
	sizeBytes := calculateTxSize(txHex)
	rings := extractRingMembers(txData)
	validBlock, invalidBlocks := extractValidInvalidBlocks(txData)

	// Determine network mode
	isMainnet := true
	if network, ok := a.settings["network"].(string); ok && network == "simulator" {
		isMainnet = false
	}

	// Parse transaction bytes
	parsed := parseTxBytes(txHex, rings, isMainnet)

	// Calculate age
	age, blockTime := "", ""
	if blockHeight, ok := txData["block_height"].(float64); ok {
		age, blockTime = a.calculateTxAge(blockHeight)
	}

	maxRingSize := getMaxRingSize(rings)

	// Build comprehensive response
	response := map[string]interface{}{
		"success": true,
		"txid":    txid,

		// Transaction type & status
		"tx_type":     parsed.TxType,
		"in_pool":     txData["in_pool"],
		"ignored":     txData["ignored"],
		"is_coinbase": parsed.IsCoinbase,

		// Block info
		"block_height":   txData["block_height"],
		"valid_block":    validBlock,
		"invalid_blocks": invalidBlocks,

		// Timing
		"age":        age,
		"block_time": blockTime,

		// Build info
		"height_built": parsed.HeightBuilt,
		"blid":         parsed.BLID,
		"root_hash":    parsed.RootHash,

		// Addresses
		"miner_address": parsed.MinerAddress,
		"signer":        txData["signer"],

		// Economics
		"fee":        txData["fee"],
		"reward":     txData["reward"],
		"burn_value": parsed.BurnValue,
		"balance":    txData["balance"],

		// Ring members
		"rings":         rings,
		"ring_count":    len(rings),
		"max_ring_size": maxRingSize,

		// Assets breakdown
		"assets": parsed.Assets,

		// Smart Contract data
		"sc_args":        parsed.SCArgs,
		"sc_code":        txData["code"],
		"sc_balance":     txData["balance"],
		"sc_balance_now": txData["balancenow"],
		"sc_code_now":    txData["codenow"],

		// Size
		"size_bytes": sizeBytes,
		"size_kb":    fmt.Sprintf("%.03f", float64(sizeBytes)/1024),

		// Raw data
		"hex":            txHex,
		"output_indices": txData["output_indices"],

		// Original tx object for backward compatibility
		"tx": txData,
	}

	a.logToConsole(fmt.Sprintf("[OK] TX %s: type=%s, %d assets, ring=%d",
		txid[:16]+"...", parsed.TxType, len(parsed.Assets), maxRingSize))

	return response
}

// SearchAddress searches for transactions related to an address
func (a *App) SearchAddress(address string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Searching address: %s", address[:16]+"..."))

	// Validate address format
	if !strings.HasPrefix(address, "dero1") {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid DERO address format",
		}
	}

	// Note: DERO doesn't have a direct "search by address" API due to privacy
	// This would need to use Gnomon indexing or local wallet history

	if a.gnomonClient.IsRunning() {
		// Search through Gnomon for SCIDs owned by this address
		ownedSCIDs := a.getOwnedSCIDs(address)

		return map[string]interface{}{
			"success":    true,
			"address":    address,
			"ownedSCIDs": ownedSCIDs,
			"ownedCount": len(ownedSCIDs),
			"note":       "Due to DERO's privacy features, full transaction history is only available for owned wallets",
		}
	}

	return map[string]interface{}{
		"success": false,
		"error":   "Gnomon indexer required for address search",
	}
}

// getOwnedSCIDs returns all SCIDs where the given address is the owner
func (a *App) getOwnedSCIDs(address string) []map[string]interface{} {
	ownedSCIDs := []map[string]interface{}{}

	if !a.gnomonClient.IsRunning() {
		return ownedSCIDs
	}

	// Get all indexed SCIDs and their owners
	allSCIDs := a.gnomonClient.GetAllOwnersAndSCIDs()

	for scid, owner := range allSCIDs {
		// Check if this address owns the SCID
		if strings.EqualFold(owner, address) {
			// Get more details about this SCID
			scidInfo := map[string]interface{}{
				"scid":  scid,
				"owner": owner,
			}

			// Try to get name/description from variables
			vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)
			for _, v := range vars {
				key := fmt.Sprintf("%v", v.Key)
				switch key {
				// V2 headers (TELA standard) - check first
				case "var_header_name":
					if v.Value != nil {
						scidInfo["name"] = decodeHexString(fmt.Sprintf("%v", v.Value))
					}
				case "var_header_description":
					if v.Value != nil {
						scidInfo["description"] = decodeHexString(fmt.Sprintf("%v", v.Value))
					}
				// V1 headers (ART-NFA standard) - fallback if V2 not set
				case "nameHdr":
					if v.Value != nil && scidInfo["name"] == nil {
						scidInfo["name"] = decodeHexString(fmt.Sprintf("%v", v.Value))
					}
				case "descrHdr":
					if v.Value != nil && scidInfo["description"] == nil {
						scidInfo["description"] = decodeHexString(fmt.Sprintf("%v", v.Value))
					}
				case "dURL":
					if v.Value != nil {
						scidInfo["durl"] = decodeHexString(fmt.Sprintf("%v", v.Value))
					}
				}
			}

			ownedSCIDs = append(ownedSCIDs, scidInfo)
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d SCIDs owned by address", len(ownedSCIDs)))
	return ownedSCIDs
}

// GetAddressSCIDReferences finds SCIDs where an address appears in stored variables
func (a *App) GetAddressSCIDReferences(address string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Finding SCID references for: %s", address[:16]+"..."))

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer required",
		}
	}

	references := []map[string]interface{}{}

	// Get all indexed SCIDs
	allSCIDs := a.gnomonClient.GetAllOwnersAndSCIDs()

	for scid := range allSCIDs {
		// Check if this address appears in any variables
		vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)
		for _, v := range vars {
			valueStr := fmt.Sprintf("%v", v.Value)
			// Check if the address appears in this value (decoded)
			decodedValue := decodeHexString(valueStr)
			if strings.Contains(strings.ToLower(decodedValue), strings.ToLower(address)) ||
				strings.Contains(strings.ToLower(valueStr), strings.ToLower(address)) {
				references = append(references, map[string]interface{}{
					"scid":     scid,
					"variable": fmt.Sprintf("%v", v.Key),
				})
				break // Only add each SCID once
			}
		}
	}

	return map[string]interface{}{
		"success":    true,
		"address":    address,
		"references": references,
		"count":      len(references),
	}
}

// formatAge formats a duration into a human-readable "time ago" format
// Ported from explorerlib.go
func formatAge(d time.Duration) string {
	totalSeconds := int64(d.Seconds())

	if totalSeconds < 60 {
		return fmt.Sprintf("%ds ago", totalSeconds)
	} else if totalSeconds < 3600 {
		minutes := totalSeconds / 60
		seconds := totalSeconds % 60
		return fmt.Sprintf("%dm %ds ago", minutes, seconds)
	} else if totalSeconds < 86400 {
		hours := totalSeconds / 3600
		minutes := (totalSeconds % 3600) / 60
		return fmt.Sprintf("%dh %dm ago", hours, minutes)
	} else {
		days := totalSeconds / 86400
		hours := (totalSeconds % 86400) / 3600
		return fmt.Sprintf("%dd %dh ago", days, hours)
	}
}

// FormatBlockAge formats a block timestamp into "time ago" format
func (a *App) FormatBlockAge(timestampMs int64) string {
	blockTime := time.UnixMilli(timestampMs)
	duration := time.Since(blockTime)
	return formatAge(duration)
}

// ValidateProofFull validates a DeroProof using the proof.Prove() function
// This requires fetching the transaction data to get the raw hex and ring members
func (a *App) ValidateProofFull(proofString string, txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[WALLET] Validating DeroProof: %s...", proofString[:20]))

	if proofString == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "No proof string provided",
		}
	}

	// We need the transaction data to validate the proof
	// The proof.Prove() function requires:
	// 1. The proof string (deroproof1q... format)
	// 2. The raw transaction hex
	// 3. The ring members for each payload

	var txHex string
	var ringData [][]string

	if txid != "" {
		// Fetch transaction data from daemon
		params := map[string]interface{}{
			"txs_hashes":     []string{txid},
			"decode_as_json": 1,
		}

		result, err := a.daemonClient.Call("DERO.GetTransaction", params)
		if err != nil {
			return ErrorResponse(err)
		}

		// Extract tx hex and ring data from result
		if resultMap, ok := result.(map[string]interface{}); ok {
			// Get raw hex
			if txsHex, ok := resultMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
				if hexStr, ok := txsHex[0].(string); ok {
					txHex = hexStr
				}
			}

			// Get ring data from txs array
			if txs, ok := resultMap["txs"].([]interface{}); ok && len(txs) > 0 {
				if tx, ok := txs[0].(map[string]interface{}); ok {
					if ring, ok := tx["ring"].([]interface{}); ok {
						for _, payload := range ring {
							var payloadRing []string
							if addresses, ok := payload.([]interface{}); ok {
								for _, addr := range addresses {
									if addrStr, ok := addr.(string); ok {
										payloadRing = append(payloadRing, addrStr)
									}
								}
							}
							ringData = append(ringData, payloadRing)
						}
					}
				}
			}
		}

		if txHex == "" {
			return map[string]interface{}{
				"success": false,
				"error":   "Could not extract transaction hex from daemon response",
			}
		}
	} else {
		// No txid provided - the proof might be self-contained or we need user to provide tx data
		return map[string]interface{}{
			"success": false,
			"error":   "Transaction ID required for proof validation. The proof must be validated against a specific transaction.",
		}
	}

	// Determine network (mainnet vs simulator)
	mainnet := true
	if network, ok := a.settings["network"].(string); ok && network == "simulator" {
		mainnet = false
	}

	// Call proof.Prove() to validate
	a.logToConsole(fmt.Sprintf("[...] Validating proof against TX with %d ring groups", len(ringData)))

	addresses, amounts, payloadRaw, payloadDecoded, err := proof.Prove(proofString, txHex, ringData, mainnet)

	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Proof validation failed: %v", err))
		return map[string]interface{}{
			"success": true,
			"valid":   false,
			"error":   err.Error(),
		}
	}

	// Security validation: Check proof amounts before display
	// Blocks fake proofs with impossible amounts (> DERO hard cap or wraparound attacks)
	var allWarnings []string
	var supplyContexts []string
	var percentages []float64

	for i, amt := range amounts {
		// Validate each amount
		validationResult := ValidatePayloadProofAmountWithContext(amt)

		if !validationResult.Valid {
			a.logToConsole(fmt.Sprintf("[SECURITY] Fake proof rejected for receiver %d: %s", i+1, validationResult.Error))
			return map[string]interface{}{
				"success":      true,
				"valid":        false,
				"error":        fmt.Sprintf("Proof rejected: %s", validationResult.Error),
				"securityNote": "This proof claims an amount that exceeds the DERO hard cap (21M) and is therefore fabricated.",
			}
		}

		// Collect warnings and context
		allWarnings = append(allWarnings, validationResult.Warnings...)
		supplyContexts = append(supplyContexts, validationResult.SupplyContext)
		percentages = append(percentages, validationResult.PercentOfSupply)
	}

	// Format the amounts using globals.FormatMoney
	formattedAmounts := make([]string, len(amounts))
	for i, amt := range amounts {
		formattedAmounts[i] = globals.FormatMoney(amt)
	}

	// Convert raw payloads to hex for display
	payloadHex := make([]string, len(payloadRaw))
	for i, raw := range payloadRaw {
		payloadHex[i] = hex.EncodeToString(raw)
	}

	a.logToConsole(fmt.Sprintf("[OK] Proof validated! Found %d receiver(s)", len(addresses)))

	return map[string]interface{}{
		"success":          true,
		"valid":            true,
		"addresses":        addresses,
		"amounts":          amounts,
		"amountsFormatted": formattedAmounts,
		"payloadRaw":       payloadHex,
		"payloadDecoded":   payloadDecoded,
		"txid":             txid,
		"warnings":         allWarnings,
		"supplyContexts":   supplyContexts,
		"percentOfSupply":  percentages,
	}
}

// ValidateProof validates a DeroProof (legacy method - calls ValidateProofFull)
func (a *App) ValidateProof(proofData string) map[string]interface{} {
	a.logToConsole("[WALLET] Validating DeroProof...")

	if proofData == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "No proof data provided",
		}
	}

	// For standalone proof validation without a specific txid,
	// we return an error indicating the txid is needed
	return map[string]interface{}{
		"success": false,
		"error":   "Please provide a transaction ID along with the proof. Use ValidateProofFull(proof, txid) instead.",
	}
}

// ValidateSenderProof validates a sender proof for a transaction
func (a *App) ValidateSenderProof(txid, senderAddress, receiverAddress string, amount uint64, proofSignature string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[WALLET] Validating sender proof for TX: %s", txid[:16]+"..."))

	// Build proof validation request
	params := map[string]interface{}{
		"txid":             txid,
		"sender_address":   senderAddress,
		"receiver_address": receiverAddress,
		"amount":           amount,
		"proof_signature":  proofSignature,
	}

	result, err := a.daemonClient.Call("DERO.ValidateSenderProof", params)
	if err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Proof validation failed. Please check the proof format.",
			"technicalError": err.Error(),
		}
	}

	isValid := false
	if resultMap, ok := result.(map[string]interface{}); ok {
		if valid, ok := resultMap["valid"].(bool); ok {
			isValid = valid
		}
	}

	return map[string]interface{}{
		"success": true,
		"valid":   isValid,
		"txid":    txid,
		"amount":  amount,
	}
}

// GetBlockchainStats returns overall blockchain statistics
func (a *App) GetBlockchainStats() map[string]interface{} {
	a.logToConsole("[STATS] Getting blockchain statistics...")

	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return ErrorResponse(err)
	}

	// Extract relevant stats - info is already map[string]interface{}
	stats := map[string]interface{}{}

	stats["height"] = info["height"]
	stats["topoheight"] = info["topoheight"]
	stats["difficulty"] = info["difficulty"]
	stats["hashrate"] = info["hashrate"]
	stats["total_supply"] = info["total_supply"]
	stats["tx_pool_size"] = info["tx_pool_size"]
	stats["peers"] = info["peers"]
	stats["network"] = info["network"]
	stats["version"] = info["version"]
	stats["uptime"] = info["uptime"]

	return map[string]interface{}{
		"success": true,
		"stats":   stats,
	}
}

// GetRecentBlocks returns the most recent blocks
func (a *App) GetRecentBlocks(count int) map[string]interface{} {
	if count <= 0 {
		count = 10
	}
	if count > 100 {
		count = 100
	}

	a.logToConsole(fmt.Sprintf("[STATS] Getting %d recent blocks...", count))

	// Get current height
	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return ErrorResponse(err)
	}

	height := int64(0)
	if h, ok := info["height"].(float64); ok {
		height = int64(h)
	}

	if height == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "Could not determine chain height",
		}
	}

	// Fetch recent blocks
	blocks := []map[string]interface{}{}
	for i := 0; i < count && height-int64(i) > 0; i++ {
		h := height - int64(i)
		result, err := a.daemonClient.Call("DERO.GetBlock", map[string]interface{}{"height": h})
		if err != nil {
			continue
		}

		blockData := map[string]interface{}{
			"height": h,
		}

		if resultMap, ok := result.(map[string]interface{}); ok {
			if block, ok := resultMap["block"].(map[string]interface{}); ok {
				if header, ok := block["block_header"].(map[string]interface{}); ok {
					blockData["hash"] = header["hash"]
					blockData["timestamp"] = header["timestamp"]
					blockData["tx_count"] = header["tx_count"]
					blockData["reward"] = header["reward"]
				}
			}
		}

		blocks = append(blocks, blockData)
	}

	return map[string]interface{}{
		"success": true,
		"blocks":  blocks,
		"count":   len(blocks),
	}
}

// GetMempoolTransactions returns current mempool transactions
func (a *App) GetMempoolTransactions() map[string]interface{} {
	a.logToConsole("[STATS] Getting mempool transactions...")

	result, err := a.daemonClient.Call("DERO.GetTxPool", nil)
	if err != nil {
		return ErrorResponse(err)
	}

	txs := []interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		if pool, ok := resultMap["txs"].([]interface{}); ok {
			txs = pool
		}
	}

	return map[string]interface{}{
		"success": true,
		"txs":     txs,
		"count":   len(txs),
	}
}

// GetMempoolExtended returns detailed mempool with full transaction info
// Matches official DERO explorer's mempool page functionality
func (a *App) GetMempoolExtended(maxCount int) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[POOL] Getting extended mempool (max %d)...", maxCount))

	if maxCount <= 0 {
		maxCount = 100
	}
	if maxCount > 500 {
		maxCount = 500
	}

	// Get mempool transaction hashes
	result, err := a.daemonClient.Call("DERO.GetTxPool", nil)
	if err != nil {
		return ErrorResponse(err)
	}

	var txHashes []string
	if resultMap, ok := result.(map[string]interface{}); ok {
		if pool, ok := resultMap["tx_list"].([]interface{}); ok {
			for _, tx := range pool {
				if txHash, ok := tx.(string); ok {
					txHashes = append(txHashes, txHash)
				}
			}
		}
	}

	// Fetch detailed info for each transaction
	txDetails := []map[string]interface{}{}
	var totalFees uint64 = 0
	var totalSize int64 = 0

	// Stats by type
	typeCount := map[string]int{
		"NORMAL": 0,
		"SC":     0,
		"BURN":   0,
		"OTHER":  0,
	}

	for i, txHash := range txHashes {
		if i >= maxCount {
			break
		}

		// Fetch transaction details
		params := map[string]interface{}{
			"txs_hashes":     []string{txHash},
			"decode_as_json": 1,
		}

		txResult, err := a.daemonClient.Call("DERO.GetTransaction", params)
		if err != nil {
			continue
		}

		txResultMap, ok := txResult.(map[string]interface{})
		if !ok {
			continue
		}

		// Get raw hex for size calculation
		var txHex string
		if txsHex, ok := txResultMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
			if hexStr, ok := txsHex[0].(string); ok {
				txHex = hexStr
			}
		}

		// Get transaction info
		txs, ok := txResultMap["txs"].([]interface{})
		if !ok || len(txs) == 0 {
			continue
		}

		txData, ok := txs[0].(map[string]interface{})
		if !ok {
			continue
		}

		// Parse transaction for type detection
		var txType string = "NORMAL"
		var ringSize int = 0
		var fee uint64 = 0
		var sizeBytes int64 = 0

		if txHex != "" {
			sizeBytes = int64(len(txHex) / 2)
			totalSize += sizeBytes

			txBytes, err := hex.DecodeString(txHex)
			if err == nil {
				var tx transaction.Transaction
				if err := tx.Deserialize(txBytes); err == nil {
					txType = getTxTypeName(tx.TransactionType)
					fee = tx.Fees()
					totalFees += fee

					if len(tx.Payloads) > 0 {
						ringSize = int(tx.Payloads[0].Statement.RingSize)
					}
				}
			}
		}

		// Track type stats
		switch txType {
		case "NORMAL":
			typeCount["NORMAL"]++
		case "SC":
			typeCount["SC"]++
		case "BURN":
			typeCount["BURN"]++
		default:
			typeCount["OTHER"]++
		}

		// Extract ring members
		rings := []map[string]interface{}{}
		if ringData, ok := txData["ring"].([]interface{}); ok {
			for idx, payload := range ringData {
				payloadRing := map[string]interface{}{
					"index": idx,
					"count": 0,
				}
				if addresses, ok := payload.([]interface{}); ok {
					payloadRing["count"] = len(addresses)
					if ringSize == 0 && len(addresses) > 0 {
						ringSize = len(addresses)
					}
				}
				rings = append(rings, payloadRing)
			}
		}

		txDetail := map[string]interface{}{
			"hash":       txHash,
			"type":       txType,
			"fee":        fee,
			"fee_dero":   globals.FormatMoney(fee),
			"size_bytes": sizeBytes,
			"size_kb":    fmt.Sprintf("%.03f", float64(sizeBytes)/1024),
			"ring_size":  ringSize,
			"ring_count": len(rings),
			"signer":     txData["signer"],
			"in_pool":    true,
		}

		txDetails = append(txDetails, txDetail)
	}

	a.logToConsole(fmt.Sprintf("[OK] Mempool: %d TXs, fees=%.05f DERO, size=%.02f KB",
		len(txDetails), float64(totalFees)/100000, float64(totalSize)/1024))

	return map[string]interface{}{
		"success":     true,
		"txs":         txDetails,
		"count":       len(txDetails),
		"total_count": len(txHashes),
		"truncated":   len(txHashes) > maxCount,

		// Aggregate stats
		"total_fees":       totalFees,
		"total_fees_dero":  globals.FormatMoney(totalFees),
		"total_size_bytes": totalSize,
		"total_size_kb":    fmt.Sprintf("%.02f", float64(totalSize)/1024),

		// Type breakdown
		"type_stats": typeCount,
	}
}

// GetSCInfo retrieves detailed smart contract information
func (a *App) GetSCInfo(scid string) map[string]interface{} {
	// Normalize SCID to lowercase (DERO requires lowercase hex)
	normalizedSCID := strings.ToLower(strings.TrimSpace(scid))

	a.logToConsole(fmt.Sprintf("[...] Getting SC info: %s", normalizedSCID[:16]+"..."))

	params := map[string]interface{}{
		"scid":      normalizedSCID,
		"code":      true,
		"variables": true,
	}

	result, err := a.daemonClient.Call("DERO.GetSC", params)
	if err != nil {
		return ErrorResponse(err)
	}
	result = normalizeDEROGetSCResult(result)

	scData := map[string]interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		scData = resultMap
	}

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"sc":      scData,
	}
}

// GetRingMembers extracts ring members from a transaction
func (a *App) GetRingMembers(txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[LINK] Getting ring members for TX: %s", txid[:16]+"..."))

	params := map[string]interface{}{
		"txs_hashes":     []string{txid},
		"decode_as_json": 1,
	}

	result, err := a.daemonClient.Call("DERO.GetTransaction", params)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to fetch transaction: %v", err),
		}
	}

	ringData := []map[string]interface{}{}
	ringSize := 0

	if resultMap, ok := result.(map[string]interface{}); ok {
		if txs, ok := resultMap["txs"].([]interface{}); ok && len(txs) > 0 {
			if tx, ok := txs[0].(map[string]interface{}); ok {
				// Extract ring data from the transaction
				if ring, ok := tx["ring"].([]interface{}); ok {
					for idx, payload := range ring {
						payloadRing := map[string]interface{}{
							"index":   idx,
							"members": []string{},
						}

						if addresses, ok := payload.([]interface{}); ok {
							members := []string{}
							for _, addr := range addresses {
								if addrStr, ok := addr.(string); ok {
									members = append(members, addrStr)
								}
							}
							payloadRing["members"] = members
							payloadRing["count"] = len(members)

							if len(members) > ringSize {
								ringSize = len(members)
							}
						}

						ringData = append(ringData, payloadRing)
					}
				}
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d ring groups, max size %d", len(ringData), ringSize))

	return map[string]interface{}{
		"success":     true,
		"txid":        txid,
		"rings":       ringData,
		"ringCount":   len(ringData),
		"maxRingSize": ringSize,
	}
}

// GetTransactionWithRings returns transaction data including ring members
func (a *App) GetTransactionWithRings(txid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Getting transaction with rings: %s", txid[:16]+"..."))

	// Get basic transaction data
	txResult := a.GetTransaction(txid)
	if !txResult["success"].(bool) {
		return txResult
	}

	// Get ring members
	ringResult := a.GetRingMembers(txid)

	// Combine results
	return map[string]interface{}{
		"success":     true,
		"txid":        txid,
		"tx":          txResult["tx"],
		"rings":       ringResult["rings"],
		"ringCount":   ringResult["ringCount"],
		"maxRingSize": ringResult["maxRingSize"],
	}
}
