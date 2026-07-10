package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// LiveStatsService provides real-time blockchain statistics
type LiveStatsService struct {
	app              *App
	lastHeight       int64
	lastStats        map[string]interface{}
	monitoring       bool
	monitoringLock   sync.Mutex
	stopChan         chan struct{}
	networkSwitching bool
	switchNoticeSeen bool
}

// NewLiveStatsService creates a new live stats service
func NewLiveStatsService(app *App) *LiveStatsService {
	return &LiveStatsService{
		app:       app,
		lastStats: make(map[string]interface{}),
		stopChan:  make(chan struct{}),
	}
}

// GetLiveStats returns current network statistics
func (a *App) GetLiveStats() map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Daemon client not initialized",
		}
	}

	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to get network info: %v", err),
		}
	}

	// Extract values with defaults
	height := getInt64(info, "height", 0)
	topoheight := getInt64(info, "topoheight", 0)
	difficulty := getInt64(info, "difficulty", 0)
	txPoolSize := getInt64(info, "tx_pool_size", 0)
	uptime := getInt64(info, "uptime", 0)
	incomingPeers := getInt64(info, "incoming_connections_count", 0)
	outgoingPeers := getInt64(info, "outgoing_connections_count", 0)
	version := getString(info, "version", "Unknown")
	network := getString(info, "network", "mainnet")
	averageBlockTime := getFloat64(info, "averageblocktime50", 18.0)
	stableHeight := getInt64(info, "stableheight", 0)
	totalSupply := getInt64(info, "total_supply", 0)

	// Calculate hashrate from difficulty (difficulty / block_time)
	hashrate := float64(difficulty) / averageBlockTime

	// Total peers
	peers := incomingPeers + outgoingPeers

	return map[string]interface{}{
		"success": true,
		"stats": map[string]interface{}{
			"height":           height,
			"topoheight":       topoheight,
			"difficulty":       difficulty,
			"hashrate":         hashrate,
			"peers":            peers,
			"incomingPeers":    incomingPeers,
			"outgoingPeers":    outgoingPeers,
			"txPoolSize":       txPoolSize,
			"uptime":           uptime,
			"version":          version,
			"network":          network,
			"averageBlockTime": averageBlockTime,
			"stableHeight":     stableHeight,
			"totalSupply":      totalSupply,
		},
	}
}

// GetNetworkHealth calculates network health score and status
func (a *App) GetNetworkHealth() map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Daemon client not initialized",
		}
	}

	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to get network info: %v", err),
		}
	}

	// Calculate health score
	healthScore := 100
	issues := []string{}

	// Check peer count
	incomingPeers := getInt64(info, "incoming_connections_count", 0)
	outgoingPeers := getInt64(info, "outgoing_connections_count", 0)
	totalPeers := incomingPeers + outgoingPeers

	if totalPeers < 3 {
		healthScore -= 40
		issues = append(issues, "Very low peer count")
	} else if totalPeers < 8 {
		healthScore -= 20
		issues = append(issues, "Low peer count")
	} else if totalPeers < 15 {
		healthScore -= 5
		issues = append(issues, "Few peers")
	}

	// Check if difficulty exists
	difficulty := getInt64(info, "difficulty", 0)
	if difficulty == 0 {
		healthScore -= 30
		issues = append(issues, "No difficulty data")
	}

	// Check block height
	height := getInt64(info, "height", 0)
	if height == 0 {
		healthScore -= 50
		issues = append(issues, "No block height")
	}

	// Check uptime
	uptime := getInt64(info, "uptime", 0)
	if uptime < 60 {
		healthScore -= 10
		issues = append(issues, "Node recently started")
	}

	// Determine status
	status := "Excellent"
	description := "All systems healthy"
	statusColor := "green"

	if healthScore >= 90 {
		status = "Excellent"
		description = "All systems healthy"
		statusColor = "green"
	} else if healthScore >= 70 {
		status = "Good"
		if len(issues) > 0 {
			description = issues[0]
		} else {
			description = "Minor issues detected"
		}
		statusColor = "green"
	} else if healthScore >= 50 {
		status = "Fair"
		if len(issues) > 0 {
			description = joinStrings(issues, ", ")
		} else {
			description = "Some issues detected"
		}
		statusColor = "yellow"
	} else {
		status = "Poor"
		description = "Multiple issues detected"
		statusColor = "red"
	}

	return map[string]interface{}{
		"success":     true,
		"healthScore": healthScore,
		"status":      status,
		"description": description,
		"statusColor": statusColor,
		"issues":      issues,
		"metrics": map[string]interface{}{
			"peers":      totalPeers,
			"difficulty": difficulty,
			"height":     height,
			"uptime":     uptime,
		},
	}
}

// StartBlockMonitoring starts background monitoring for new blocks
func (a *App) StartBlockMonitoring() {
	if a.liveStats == nil {
		a.liveStats = NewLiveStatsService(a)
	}

	a.liveStats.monitoringLock.Lock()
	if a.liveStats.monitoring {
		a.liveStats.monitoringLock.Unlock()
		return
	}
	a.liveStats.monitoring = true
	a.liveStats.stopChan = make(chan struct{})
	a.liveStats.monitoringLock.Unlock()

	a.logToConsole("[LIVE] Starting live block monitoring...")

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-a.liveStats.stopChan:
				a.logToConsole("[STOP] Block monitoring stopped")
				return
			case <-ticker.C:
				a.checkForNewBlocks()
			}
		}
	}()
}

// StopBlockMonitoring stops the background monitoring
func (a *App) StopBlockMonitoring() {
	if a.liveStats == nil {
		return
	}

	a.liveStats.monitoringLock.Lock()
	defer a.liveStats.monitoringLock.Unlock()

	if a.liveStats.monitoring {
		close(a.liveStats.stopChan)
		a.liveStats.monitoring = false
	}
}

// setNetworkSwitching toggles temporary suppression of block tick logs/events
// during network handoff (mainnet <-> simulator) to avoid misleading [MINE] noise.
func (a *App) setNetworkSwitching(inProgress bool, target string) {
	if a.liveStats == nil {
		a.liveStats = NewLiveStatsService(a)
	}

	a.liveStats.monitoringLock.Lock()
	wasSwitching := a.liveStats.networkSwitching
	a.liveStats.networkSwitching = inProgress
	if inProgress {
		a.liveStats.switchNoticeSeen = false
	}
	a.liveStats.monitoringLock.Unlock()

	if inProgress && !wasSwitching {
		a.logToConsole(fmt.Sprintf("[NET] Switching network: pausing block monitor (%s)...", target))
		return
	}
	if !inProgress && wasSwitching {
		a.logToConsole(fmt.Sprintf("[NET] Block monitor resumed on %s", target))
	}
}

// checkForNewBlocks checks if there's a new block and emits an event
func (a *App) checkForNewBlocks() {
	if a.daemonClient == nil {
		return
	}

	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return
	}

	currentHeight := getInt64(info, "height", 0)

	// During network handoff, suppress normal block tick logs/events and simply
	// advance the cursor so we don't emit stale burst logs after the switch.
	a.liveStats.monitoringLock.Lock()
	switching := a.liveStats.networkSwitching
	needSwitchNotice := switching && !a.liveStats.switchNoticeSeen
	if needSwitchNotice {
		a.liveStats.switchNoticeSeen = true
	}
	a.liveStats.monitoringLock.Unlock()
	if switching {
		if needSwitchNotice {
			a.logToConsole("[NET] Network switch in progress (suppressing block tick events)")
		}
		a.liveStats.lastHeight = currentHeight
		return
	}

	if a.liveStats.lastHeight > 0 && currentHeight > a.liveStats.lastHeight {
		// New block detected!
		blockDiff := currentHeight - a.liveStats.lastHeight

		// Get the new block header
		blockRes, err := a.daemonClient.Call("DERO.GetBlockHeaderByHeight", map[string]interface{}{
			"height": currentHeight,
		})

		blockData := map[string]interface{}{
			"height":     currentHeight,
			"prevHeight": a.liveStats.lastHeight,
			"blockDiff":  blockDiff,
		}

		if err == nil && blockRes != nil {
			if result, ok := blockRes.(map[string]interface{}); ok {
				if header, ok := result["block_header"].(map[string]interface{}); ok {
					blockData["hash"] = header["hash"]
					blockData["timestamp"] = header["timestamp"]
					blockData["reward"] = header["reward"]
					blockData["txCount"] = header["tx_count"]
				}
			}
		}

		// Emit event to frontend
		runtime.EventsEmit(a.ctx, "explorer:newBlock", blockData)

		a.logToConsole(fmt.Sprintf("[MINE] New block detected: #%d", currentHeight))
	}

	a.liveStats.lastHeight = currentHeight
}

// GetMempoolStats returns enhanced mempool statistics
func (a *App) GetMempoolStats() map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Daemon client not initialized",
		}
	}

	result, err := a.daemonClient.Call("DERO.GetTxPool", nil)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to get mempool: %v", err),
		}
	}

	txs := []interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		if pool, ok := resultMap["txs"].([]interface{}); ok {
			txs = pool
		}
	}

	// Calculate stats
	totalCount := len(txs)
	totalSize := int64(0)
	totalFees := int64(0)

	for _, tx := range txs {
		if txMap, ok := tx.(map[string]interface{}); ok {
			if size, ok := txMap["size"].(float64); ok {
				totalSize += int64(size)
			}
			if fee, ok := txMap["fee"].(float64); ok {
				totalFees += int64(fee)
			}
		}
	}

	avgFee := float64(0)
	if totalCount > 0 {
		avgFee = float64(totalFees) / float64(totalCount) / 100000 // Convert to DERO
	}

	avgSize := float64(0)
	if totalCount > 0 {
		avgSize = float64(totalSize) / float64(totalCount)
	}

	return map[string]interface{}{
		"success": true,
		"stats": map[string]interface{}{
			"count":     totalCount,
			"totalSize": totalSize,
			"totalFees": float64(totalFees) / 100000,
			"avgFee":    avgFee,
			"avgSize":   avgSize,
		},
		"txs": txs,
	}
}

// Helper functions for safe type conversion
func getInt64(m map[string]interface{}, key string, defaultVal int64) int64 {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return int64(val)
		case int64:
			return val
		case int:
			return int64(val)
		}
	}
	return defaultVal
}

func getFloat64(m map[string]interface{}, key string, defaultVal float64) float64 {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return val
		case int64:
			return float64(val)
		case int:
			return float64(val)
		}
	}
	return defaultVal
}

func getString(m map[string]interface{}, key string, defaultVal string) string {
	if v, ok := m[key]; ok {
		if val, ok := v.(string); ok {
			return val
		}
	}
	return defaultVal
}

func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}
