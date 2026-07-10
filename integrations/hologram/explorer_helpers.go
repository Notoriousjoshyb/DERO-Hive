// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Explorer Helpers - Extracted from explorer_service.go for maintainability
// Session 87: Code restructuring

package main

import (
	"encoding/hex"
	"fmt"
	"time"

	"github.com/deroproject/derohe/block"
	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/transaction"
)

// ParsedTransaction holds extracted transaction data
type ParsedTransaction struct {
	TxType       string
	MinerAddress string
	HeightBuilt  uint64
	BLID         string
	RootHash     string
	BurnValue    uint64
	SCArgs       interface{}
	Assets       []map[string]interface{}
	IsCoinbase   bool
}

// extractRingMembers extracts ring members from transaction data
func extractRingMembers(txData map[string]interface{}) []map[string]interface{} {
	rings := []map[string]interface{}{}

	ringData, ok := txData["ring"].([]interface{})
	if !ok {
		return rings
	}

	for idx, payload := range ringData {
		payloadRing := map[string]interface{}{
			"index":   idx,
			"members": []string{},
			"count":   0,
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
		}

		rings = append(rings, payloadRing)
	}

	return rings
}

// extractValidInvalidBlocks extracts valid and invalid block references
func extractValidInvalidBlocks(txData map[string]interface{}) (string, []string) {
	validBlock := ""
	if vb, ok := txData["valid_block"].(string); ok {
		validBlock = vb
	}

	invalidBlocks := []string{}
	if ib, ok := txData["invalid_block"].([]interface{}); ok {
		for _, b := range ib {
			if blockStr, ok := b.(string); ok {
				invalidBlocks = append(invalidBlocks, blockStr)
			}
		}
	}

	return validBlock, invalidBlocks
}

// parseTxBytes deserializes transaction hex and extracts structured data
func parseTxBytes(txHex string, rings []map[string]interface{}, isMainnet bool) ParsedTransaction {
	result := ParsedTransaction{
		TxType: "UNKNOWN",
		Assets: []map[string]interface{}{},
	}

	if txHex == "" {
		return result
	}

	txBytes, err := hex.DecodeString(txHex)
	if err != nil {
		return result
	}

	var tx transaction.Transaction
	if err := tx.Deserialize(txBytes); err != nil {
		return result
	}

	result.TxType = getTxTypeName(tx.TransactionType)
	result.HeightBuilt = tx.Height
	result.BLID = fmt.Sprintf("%x", tx.BLID)
	result.IsCoinbase = tx.TransactionType == transaction.COINBASE

	// Extract rootHash from first payload
	if len(tx.Payloads) >= 1 {
		result.RootHash = fmt.Sprintf("%x", tx.Payloads[0].Statement.Roothash[:])
	}

	// Get burn value
	if tx.TransactionType == transaction.BURN_TX {
		result.BurnValue = tx.Value
	}

	// Extract miner address for coinbase/registration/premine
	if tx.TransactionType == transaction.COINBASE ||
		tx.TransactionType == transaction.REGISTRATION ||
		tx.TransactionType == transaction.PREMINE {
		var acckey crypto.Point
		if err := acckey.DecodeCompressed(tx.MinerAddress[:]); err == nil {
			astring := rpc.NewAddressFromKeys(&acckey)
			astring.Mainnet = isMainnet
			result.MinerAddress = astring.String()
		}
	}

	// Extract SC args if SC_TX
	if tx.TransactionType == transaction.SC_TX {
		result.SCArgs = tx.SCDATA
	}

	// Build assets breakdown (per payload)
	for i, payload := range tx.Payloads {
		asset := map[string]interface{}{
			"index":     i,
			"scid":      payload.SCID.String(),
			"fees":      payload.Statement.Fees,
			"burn":      payload.BurnValue,
			"ring_size": int(payload.Statement.RingSize),
		}

		// Add ring members for this asset
		if i < len(rings) {
			asset["ring"] = rings[i]["members"]
		}

		result.Assets = append(result.Assets, asset)
	}

	return result
}

// ExtractSCCodeFromDeploymentTx extracts SC code from an SC_INSTALL deployment transaction.
// For deployment TX, SCID = TXID, so we can get the code from the tx payload when GetSC returns empty
// (e.g. simulator daemon may not populate GetSC code).
func ExtractSCCodeFromDeploymentTx(txHex string) string {
	if txHex == "" {
		return ""
	}
	txBytes, err := hex.DecodeString(txHex)
	if err != nil {
		return ""
	}
	var tx transaction.Transaction
	if err := tx.Deserialize(txBytes); err != nil {
		return ""
	}
	if tx.TransactionType != transaction.SC_TX {
		return ""
	}
	if !tx.SCDATA.Has(rpc.SCACTION, rpc.DataUint64) {
		return ""
	}
	action := rpc.SC_ACTION(tx.SCDATA.Value(rpc.SCACTION, rpc.DataUint64).(uint64))
	if action != rpc.SC_INSTALL {
		return ""
	}
	if c, ok := tx.SCDATA.Value(rpc.SCCODE, rpc.DataString).(string); ok {
		return c
	}
	return ""
}

// calculateTxAge calculates the age of a transaction from block data
func (a *App) calculateTxAge(blockHeight float64) (age string, blockTime string) {
	if blockHeight <= 0 {
		return "", ""
	}

	blockResult := a.GetBlock(int64(blockHeight))
	if !blockResult["success"].(bool) {
		return "", ""
	}

	blockData, ok := blockResult["block"].(map[string]interface{})
	if !ok {
		return "", ""
	}

	bh, ok := blockData["block_header"].(map[string]interface{})
	if !ok {
		return "", ""
	}

	ts, ok := bh["timestamp"].(float64)
	if !ok {
		return "", ""
	}

	timestamp := uint64(ts)
	durationMs := uint64(time.Now().UTC().UnixMilli()) - timestamp
	age = formatAge(time.Duration(durationMs) * time.Millisecond)
	blockTime = time.Unix(0, int64(timestamp*uint64(time.Millisecond))).Format("2006-01-02 15:04:05 UTC")

	return age, blockTime
}

// getMaxRingSize returns the maximum ring size from a slice of rings
func getMaxRingSize(rings []map[string]interface{}) int {
	maxRingSize := 0
	for _, r := range rings {
		if count, ok := r["count"].(int); ok && count > maxRingSize {
			maxRingSize = count
		}
	}
	return maxRingSize
}

// calculateTxSize calculates transaction size from hex string
func calculateTxSize(txHex string) int64 {
	if txHex == "" {
		return 0
	}
	return int64(len(txHex) / 2) // hex is 2 chars per byte
}

// ParsedBlock holds extracted block data
type ParsedBlock struct {
	TxHashes     []string
	MinerAddress string
	BlockSize    int64
}

// parseBlockBlob deserializes block blob and extracts structured data
func parseBlockBlob(blob string, isMainnet bool) ParsedBlock {
	result := ParsedBlock{
		TxHashes: []string{},
	}

	if blob == "" {
		return result
	}

	blockBin, err := hex.DecodeString(blob)
	if err != nil {
		return result
	}

	var bl block.Block
	if err := bl.Deserialize(blockBin); err != nil {
		return result
	}

	result.BlockSize = int64(len(blockBin))

	// Get TX hashes
	for _, txHash := range bl.Tx_hashes {
		result.TxHashes = append(result.TxHashes, txHash.String())
	}

	// Extract miner address from coinbase TX
	if bl.Miner_TX.TransactionType == transaction.COINBASE ||
		bl.Miner_TX.TransactionType == transaction.PREMINE {
		var acckey crypto.Point
		if err := acckey.DecodeCompressed(bl.Miner_TX.MinerAddress[:]); err == nil {
			astring := rpc.NewAddressFromKeys(&acckey)
			astring.Mainnet = isMainnet
			result.MinerAddress = astring.String()
		}
	}

	return result
}

// extractStringArray extracts a string array from interface slice
func extractStringArray(data interface{}) []string {
	result := []string{}
	if arr, ok := data.([]interface{}); ok {
		for _, item := range arr {
			if str, ok := item.(string); ok {
				result = append(result, str)
			}
		}
	}
	return result
}

// calculateBlockAge calculates age from block timestamp
func calculateBlockAge(timestamp float64) (age string, blockTime string) {
	if timestamp <= 0 {
		return "", ""
	}

	ts := uint64(timestamp)
	durationMs := uint64(time.Now().UTC().UnixMilli()) - ts
	age = formatAge(time.Duration(durationMs) * time.Millisecond)
	blockTime = time.Unix(0, int64(ts*uint64(time.Millisecond))).Format("2006-01-02 15:04:05 UTC")

	return age, blockTime
}

