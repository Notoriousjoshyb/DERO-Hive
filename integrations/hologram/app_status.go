// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Status Broadcasting - Extracted from app.go for organization
// Session 87: Domain splitting

package main

import (
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// StatusBroadcaster handles periodic status updates via Wails events
type StatusBroadcaster struct {
	app      *App
	ticker   *time.Ticker
	stopChan chan struct{}
	running  bool
	mu       sync.Mutex
}

// StartStatusBroadcast begins broadcasting status updates via Wails events
// This replaces frontend polling with push-based updates
func (a *App) StartStatusBroadcast() {
	a.statusBroadcasterOnce.Do(func() {
		a.statusBroadcaster = &StatusBroadcaster{
			app:      a,
			stopChan: make(chan struct{}),
		}
		go a.statusBroadcaster.Start()
		a.logToConsole("[NET] Status broadcaster started (replaces polling)")
	})
}

// Start begins the status broadcast loop
func (sb *StatusBroadcaster) Start() {
	sb.mu.Lock()
	if sb.running {
		sb.mu.Unlock()
		return
	}
	sb.running = true
	sb.ticker = time.NewTicker(5 * time.Second)
	sb.mu.Unlock()

	// Initial broadcast
	sb.broadcast()

	for {
		select {
		case <-sb.ticker.C:
			sb.broadcast()
		case <-sb.stopChan:
			sb.ticker.Stop()
			sb.mu.Lock()
			sb.running = false
			sb.mu.Unlock()
			return
		}
	}
}

// Stop stops the status broadcast loop
func (sb *StatusBroadcaster) Stop() {
	sb.mu.Lock()
	if sb.running {
		close(sb.stopChan)
	}
	sb.mu.Unlock()
}

// broadcast sends the current status to all frontend listeners
func (sb *StatusBroadcaster) broadcast() {
	if sb.app.ctx == nil {
		return
	}

	status := sb.app.getFullStatus()
	wailsRuntime.EventsEmit(sb.app.ctx, "status:update", status)
}

// getFullStatus gathers all status information for broadcast
func (a *App) getFullStatus() map[string]interface{} {
	status := map[string]interface{}{
		"timestamp": time.Now().Unix(),
	}

	// Node/Daemon status
	nodeConnected := false
	var chainHeight int64 = 0
	var topoHeight int64 = 0
	var networkHashrate float64 = 0
	var difficulty int64 = 0
	var txPoolSize int = 0
	var peerCount int = 0
	var nodeVersion string = ""

	// Use nodeManager's network mode as default; infer effective network from daemon when connected
	nodeManager.RLock()
	networkType := string(nodeManager.networkMode)
	nodeManager.RUnlock()

	if info, err := a.daemonClient.GetInfo(); err == nil {
		nodeConnected = true
		if h, ok := info["height"].(float64); ok {
			chainHeight = int64(h)
		}
		// Reconcile network with actual connection using daemon-reported "network" field,
		// with localhost-port and height fallbacks.  This replaces the old height-only
		// heuristic that misclassified long-lived simulators (>10k blocks) as mainnet.
		connEndpoint := ""
		if a.daemonClient != nil {
			connEndpoint = a.daemonClient.GetEndpoint()
		}
		if inferred, ok := inferNetworkModeFromDaemonInfo(info, connEndpoint); ok {
			networkType = string(inferred)
		}
		if t, ok := info["topoheight"].(float64); ok {
			topoHeight = int64(t)
		}
		if hr, ok := info["averageblocktime50"].(float64); ok && hr > 0 {
			if d, ok := info["difficulty"].(float64); ok {
				networkHashrate = d / hr
			}
		}
		if d, ok := info["difficulty"].(float64); ok {
			difficulty = int64(d)
		}
		if tp, ok := info["tx_pool_size"].(float64); ok {
			txPoolSize = int(tp)
		}
		if pc, ok := info["incoming_connections_count"].(float64); ok {
			peerCount += int(pc)
		}
		if pc, ok := info["outgoing_connections_count"].(float64); ok {
			peerCount += int(pc)
		}
		if v, ok := info["version"].(string); ok {
			nodeVersion = v
		}
	}

	status["node"] = map[string]interface{}{
		"connected":   nodeConnected,
		"chainHeight": chainHeight,
		"topoHeight":  topoHeight,
		"hashrate":    networkHashrate,
		"difficulty":  difficulty,
		"txPoolSize":  txPoolSize,
		"peerCount":   peerCount,
		"version":     nodeVersion,
		"network":     networkType,
	}

	// XSWD/Wallet status - separate server running from actual wallet connections
	xswdServerRunning := false
	if a.xswdServer != nil && a.xswdServer.IsRunning() {
		xswdServerRunning = true
	}
	engramConnected := a.xswdClient.IsConnected() // Connected to external wallet (Engram)
	
	status["xswd"] = map[string]interface{}{
		"serverRunning":    xswdServerRunning,  // HOLOGRAM's XSWD server is running (can accept dApp connections)
		"engramConnected":  engramConnected,    // Connected to Engram as a client
		"connected":        xswdServerRunning || engramConnected, // Legacy: any XSWD activity
	}

	// Gnomon status
	gnomonStatus := a.gnomonClient.GetStatus()
	status["gnomon"] = gnomonStatus

	// Wallet status (if integrated wallet)
	if a.xswdServer != nil {
		walletOpen := a.xswdServer.IsWalletOpen()
		status["wallet"] = map[string]interface{}{
			"open": walletOpen,
		}
		if walletOpen {
			if addr := a.xswdServer.GetWalletAddress(); addr != "" {
				status["wallet"].(map[string]interface{})["address"] = addr
			}
			if bal, err := a.xswdServer.GetWalletBalance(); err == nil {
				status["wallet"].(map[string]interface{})["balance"] = bal
			}
		}
	}

	// EPOCH (Developer Support) status
	if a.epochHandler != nil {
		epochStats := a.epochHandler.GetStats()
		status["epoch"] = map[string]interface{}{
			"active":       epochStats.Active,
			"enabled":      epochStats.Enabled,
			"hashes":       epochStats.Hashes,
			"hashesStr":    epochStats.HashesStr,
			"miniblocks":   epochStats.MiniBlocks,
			"maxHashes":    epochStats.MaxHashes,
			"maxThreads":   epochStats.MaxThreads,
			"isProcessing": epochStats.IsProcessing,
		}
	}

	return status
}

