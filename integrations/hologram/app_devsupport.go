// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Developer Support Functions - EPOCH and passive hashing for developer support
// Session 91: Simplified from app_mining.go (mining feature removed)
// Session 109: Added fair EPOCH address switching for app developer support

package main

import (
	"fmt"
	"time"
)

// ================== EPOCH (Developer Support) Functions ==================

// InitializeEpoch starts EPOCH developer support if enabled
func (a *App) InitializeEpoch() map[string]interface{} {
	if a.epochHandler == nil {
		a.epochHandler = NewEpochHandler(a.logToConsole)
	}

	if !a.epochHandler.IsEnabled() {
		return map[string]interface{}{
			"success": false,
			"error":   "Developer support is disabled",
		}
	}

	address := DEFAULT_EPOCH_DEVELOPER_ADDRESS
	a.logToConsole(fmt.Sprintf("[EPOCH] Developer support rewards go to: %s...%s",
		address[:20], address[len(address)-8:]))

	daemonEndpoint := ""

	// Check if embedded node is running and use its RPC port
	if nodeManager != nil && nodeManager.isRunning {
		daemonEndpoint = fmt.Sprintf("127.0.0.1:%d", nodeManager.rpcPort)
		a.logToConsole(fmt.Sprintf("[EPOCH] Using embedded node at %s", daemonEndpoint))
	} else {
		daemonEndpoint = "127.0.0.1:10102"
		if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
			daemonEndpoint = ep
			if len(daemonEndpoint) > 7 && daemonEndpoint[:7] == "http://" {
				daemonEndpoint = daemonEndpoint[7:]
			}
			if len(daemonEndpoint) > 8 && daemonEndpoint[:8] == "https://" {
				daemonEndpoint = daemonEndpoint[8:]
			}
		}
		a.logToConsole(fmt.Sprintf("[EPOCH] Using external daemon at %s", daemonEndpoint))
	}

	err := a.epochHandler.Initialize(address, daemonEndpoint)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"message": "Developer support initialized",
		"address": address,
	}
}

// ShutdownEpoch stops EPOCH developer support
func (a *App) ShutdownEpoch() map[string]interface{} {
	if a.epochHandler != nil {
		a.epochHandler.Shutdown()
	}
	return map[string]interface{}{
		"success": true,
		"message": "Developer support stopped",
	}
}

// SetEpochEnabled toggles EPOCH developer support on/off (legacy)
func (a *App) SetEpochEnabled(enabled bool) map[string]interface{} {
	return a.SetDevSupportEnabled(enabled)
}

// SetDevSupportEnabled toggles Developer Support (EPOCH + passive hashing) on/off
func (a *App) SetDevSupportEnabled(enabled bool) map[string]interface{} {
	if a.epochHandler == nil {
		a.epochHandler = NewEpochHandler(a.logToConsole)
	}

	a.epochHandler.SetEnabled(enabled)

	a.settings["dev_support_enabled"] = enabled
	a.settings["epoch_enabled"] = enabled
	a.logToConsole(fmt.Sprintf("[EPOCH] Developer Support: Setting persisted - enabled=%v", enabled))

	if enabled {
		result := a.InitializeEpoch()

		if a.devSupportWorker != nil {
			a.devSupportWorker.SetEnabled(true)
			a.devSupportWorker.Start()
		}

		return result
	} else {
		if a.devSupportWorker != nil {
			a.devSupportWorker.Stop()
			a.devSupportWorker.SetEnabled(false)
		}

		a.saveDevSupportStats()
	}

	return map[string]interface{}{
		"success": true,
		"enabled": enabled,
		"message": "Developer support " + map[bool]string{true: "enabled", false: "disabled"}[enabled],
	}
}

// IsEpochEnabled returns whether EPOCH is enabled in settings
func (a *App) IsEpochEnabled() bool {
	if savedSetting, ok := a.settings["epoch_enabled"]; ok {
		if enabled, ok := savedSetting.(bool); ok {
			return enabled
		}
	}

	if a.epochHandler == nil {
		return true
	}
	return a.epochHandler.IsEnabled()
}

// IsEpochActive returns whether EPOCH connection is currently active
func (a *App) IsEpochActive() bool {
	if a.epochHandler == nil {
		return false
	}
	return a.epochHandler.IsActive()
}

// GetEpochStats returns current EPOCH session statistics
func (a *App) GetEpochStats() map[string]interface{} {
	result := map[string]interface{}{
		"active":            false,
		"enabled":           a.IsDevSupportEnabled(),
		"paused":            false,
		"pause_reason":      "",
		"developer_address": DEFAULT_EPOCH_DEVELOPER_ADDRESS,
	}

	if a.epochHandler != nil {
		stats := a.epochHandler.GetStats()
		result["active"] = stats.Active
		result["enabled"] = stats.Enabled
		result["hashes"] = stats.Hashes
		result["hashes_str"] = stats.HashesStr
		result["miniblocks"] = stats.MiniBlocks
		result["version"] = stats.Version
		result["max_hashes"] = stats.MaxHashes
		result["max_threads"] = stats.MaxThreads
		result["address"] = stats.Address
		result["is_processing"] = stats.IsProcessing
		result["tracked_apps"] = stats.TrackedApps
		result["total_requests"] = stats.TotalRequests
		result["last_requester"] = stats.LastRequester
		result["last_request_at"] = stats.LastRequestAt
		result["top_requester"] = stats.TopRequester
		result["top_requester_hashes"] = stats.TopRequesterHashes
		result["top_requester_miniblocks"] = stats.TopRequesterMiniblocks
	}

	if a.devSupportWorker != nil {
		workerStats := a.devSupportWorker.GetStats()
		result["paused"] = workerStats.IsPaused
		result["pause_reason"] = workerStats.PauseReason
		result["worker_running"] = workerStats.IsRunning
		result["total_hashes"] = workerStats.TotalHashes
		result["total_hashes_str"] = workerStats.TotalHashesStr
		result["total_miniblocks"] = workerStats.MiniBlocksFound
		result["uptime_seconds"] = workerStats.UptimeSeconds
	}

	return result
}

// SetEpochConfig updates EPOCH configuration
func (a *App) SetEpochConfig(maxHashes, maxThreads int) map[string]interface{} {
	if a.epochHandler == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "EPOCH handler not initialized",
		}
	}

	enabled := a.epochHandler.IsEnabled()
	a.epochHandler.SetConfig(enabled, maxHashes, maxThreads)

	return map[string]interface{}{
		"success":     true,
		"max_hashes":  maxHashes,
		"max_threads": maxThreads,
	}
}

// HandleEpochRequest processes an EPOCH request from a TELA app
func (a *App) HandleEpochRequest(requestedHashes int, appSCID string) map[string]interface{} {
	if a.epochHandler == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "EPOCH handler not initialized",
		}
	}

	result := a.epochHandler.HandleRequest(requestedHashes, appSCID)

	return map[string]interface{}{
		"success":      result.Success,
		"hashes":       result.Hashes,
		"submitted":    result.Submitted,
		"duration_ms":  result.Duration,
		"hash_per_sec": result.HashPerSec,
		"error":        result.Error,
	}
}

// ================== Developer Support Functions ==================

// GetDevSupportStatus returns the unified developer support status
func (a *App) GetDevSupportStatus() map[string]interface{} {
	status := map[string]interface{}{
		"enabled":           false,
		"running":           false,
		"paused":            false,
		"pause_reason":      "",
		"epoch_active":      false,
		"developer_address": DEFAULT_EPOCH_DEVELOPER_ADDRESS,
	}

	if a.epochHandler != nil {
		status["enabled"] = a.epochHandler.IsEnabled()
		status["epoch_active"] = a.epochHandler.IsActive()
	}

	if a.devSupportWorker != nil {
		stats := a.devSupportWorker.GetStats()
		status["running"] = stats.IsRunning
		status["paused"] = stats.IsPaused
		status["pause_reason"] = stats.PauseReason
		status["total_hashes"] = stats.TotalHashes
		status["total_hashes_str"] = stats.TotalHashesStr
		status["miniblocks_found"] = stats.MiniBlocksFound
		status["uptime_seconds"] = stats.UptimeSeconds
		status["session_hashes"] = stats.SessionHashes
		status["session_miniblocks"] = stats.SessionMiniblocks
		status["total_sessions"] = stats.TotalSessions
		status["last_active"] = stats.LastActive
	}

	return status
}

// GetDevSupportStats returns developer support contribution statistics
func (a *App) GetDevSupportStats() map[string]interface{} {
	if a.devSupportWorker == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Developer support not initialized",
		}
	}

	stats := a.devSupportWorker.GetStats()
	return map[string]interface{}{
		"success":            true,
		"total_hashes":       stats.TotalHashes,
		"total_hashes_str":   stats.TotalHashesStr,
		"miniblocks_found":   stats.MiniBlocksFound,
		"uptime_seconds":     stats.UptimeSeconds,
		"uptime_formatted":   formatUptime(stats.UptimeSeconds),
		"session_hashes":     stats.SessionHashes,
		"session_miniblocks": stats.SessionMiniblocks,
		"total_sessions":     stats.TotalSessions,
		"is_running":         stats.IsRunning,
		"is_paused":          stats.IsPaused,
		"pause_reason":       stats.PauseReason,
	}
}

// SetDevSupportVerboseLogging toggles periodic EPOCH heartbeat log lines.
// When true, a one-line heartbeat is written to the console once per minute
// while the worker is actively hashing. When false (default), the worker
// only logs miniblock finds and state transitions.
func (a *App) SetDevSupportVerboseLogging(verbose bool) map[string]interface{} {
	if a.devSupportWorker != nil {
		a.devSupportWorker.SetVerboseLogging(verbose)
	}
	a.settings["dev_support_verbose"] = verbose
	a.logToConsole(fmt.Sprintf("[EPOCH] Verbose logging %s", map[bool]string{true: "enabled", false: "disabled"}[verbose]))
	return map[string]interface{}{
		"success": true,
		"verbose": verbose,
	}
}

// IsDevSupportVerboseLogging returns whether heartbeat logging is enabled.
// Defaults to true so supporters can see proof of life in the console; they
// can disable it from the Developer Support settings if they find it noisy.
func (a *App) IsDevSupportVerboseLogging() bool {
	if savedSetting, ok := a.settings["dev_support_verbose"]; ok {
		if v, ok := savedSetting.(bool); ok {
			return v
		}
	}
	return true
}

// IsDevSupportEnabled returns whether developer support is enabled
func (a *App) IsDevSupportEnabled() bool {
	if savedSetting, ok := a.settings["dev_support_enabled"]; ok {
		if enabled, ok := savedSetting.(bool); ok {
			return enabled
		}
	}

	if savedSetting, ok := a.settings["epoch_enabled"]; ok {
		if enabled, ok := savedSetting.(bool); ok {
			return enabled
		}
	}

	return true
}

// loadDevSupportStats loads persisted dev support stats from settings
func (a *App) loadDevSupportStats() {
	if a.devSupportWorker == nil {
		return
	}

	stats := DevSupportStats{}

	if val, ok := a.settings["dev_support_total_hashes"].(float64); ok {
		stats.TotalHashes = uint64(val)
		stats.TotalHashesStr = formatHashCount(stats.TotalHashes)
	}
	if val, ok := a.settings["dev_support_miniblocks"].(float64); ok {
		stats.MiniBlocksFound = int(val)
	}
	if val, ok := a.settings["dev_support_uptime"].(float64); ok {
		stats.UptimeSeconds = int64(val)
	}
	if val, ok := a.settings["dev_support_sessions"].(float64); ok {
		stats.TotalSessions = int(val)
	}

	a.devSupportWorker.SetStats(stats)
	a.logToConsole(fmt.Sprintf("[EPOCH] Developer Support: Loaded stats - %s hashes, %d miniblocks",
		stats.TotalHashesStr, stats.MiniBlocksFound))
}

// saveDevSupportStats saves dev support stats to settings for persistence
func (a *App) saveDevSupportStats() {
	if a.devSupportWorker == nil {
		return
	}

	stats := a.devSupportWorker.GetStats()

	a.settings["dev_support_total_hashes"] = float64(stats.TotalHashes)
	a.settings["dev_support_miniblocks"] = float64(stats.MiniBlocksFound)
	a.settings["dev_support_uptime"] = float64(stats.UptimeSeconds)
	a.settings["dev_support_sessions"] = float64(stats.TotalSessions)

	a.logToConsole(fmt.Sprintf("[EPOCH] Developer Support: Saved stats - %s hashes, %d miniblocks",
		stats.TotalHashesStr, stats.MiniBlocksFound))
}

// formatUptime formats seconds into human readable format
func formatUptime(seconds int64) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	} else if seconds < 3600 {
		return fmt.Sprintf("%dm %ds", seconds/60, seconds%60)
	} else {
		hours := seconds / 3600
		minutes := (seconds % 3600) / 60
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
}

// formatDEROAmount formats atomic units to human-readable DERO.
// DERO has 5 decimal places: 1 DERO = 100000 (1e5) atomic units. This must match
// the divisor used everywhere else (Get_Balance display, live stats); a wrong
// divisor understates the figure on the send/approval surface, which mis-anchors
// consent on an irreversible action.
func formatDEROAmount(atomicUnits uint64) string {
	dero := float64(atomicUnits) / 1e5
	if dero >= 1000000 {
		return fmt.Sprintf("%.2fM", dero/1000000)
	} else if dero >= 1000 {
		return fmt.Sprintf("%.2fK", dero/1000)
	} else if dero >= 1 {
		return fmt.Sprintf("%.5f", dero)
	}
	return fmt.Sprintf("%.5f", dero)
}

// ================== EPOCH Address Switching (Fair Developer Support) ==================
//
// When a TELA app calls AttemptEPOCHWithAddr with their developer address, HOLOGRAM
// temporarily switches the EPOCH connection to that address so the app developer
// receives the mining rewards. After STICKY_TIMEOUT (30s) of inactivity, it switches
// back to the default HOLOGRAM address.
//
// This ensures:
// 1. App developers get rewarded when users actively use their apps
// 2. HOLOGRAM gets background support when users are idle
// 3. Fair distribution of developer support across the ecosystem

// StartEpochAddressMonitor starts a goroutine that monitors EPOCH address state
// and switches back to default after STICKY_TIMEOUT of inactivity.
// Called during app startup.
func (a *App) StartEpochAddressMonitor() {
	// Stop any existing monitor before starting a new one
	a.StopEpochAddressMonitor()

	a.epochMonitorStop = make(chan struct{})
	stopCh := a.epochMonitorStop

	go func() {
		ticker := time.NewTicker(5 * time.Second) // Check every 5 seconds
		defer ticker.Stop()

		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				a.checkEpochAddressTimeout()
			}
		}
	}()

	a.logToConsole("[EPOCH] Address monitor started - will switch back to default after 30s of app inactivity")
}

// StopEpochAddressMonitor stops the EPOCH address monitor goroutine
func (a *App) StopEpochAddressMonitor() {
	if a.epochMonitorStop != nil {
		select {
		case <-a.epochMonitorStop:
			// Already closed
		default:
			close(a.epochMonitorStop)
		}
		a.epochMonitorStop = nil
	}
}

// checkEpochAddressTimeout checks if we should switch back to the default address
func (a *App) checkEpochAddressTimeout() {
	if a.epochHandler == nil {
		return
	}

	// Check if we should switch back to default
	if a.epochHandler.ShouldSwitchBackToDefault() {
		// Switch back to default address
		err := a.epochHandler.SwitchToDefault()
		if err != nil {
			a.logToConsole(fmt.Sprintf("[EPOCH] Failed to switch back to default: %v", err))
			return
		}

		// Resume background worker
		if a.devSupportWorker != nil {
			a.devSupportWorker.Resume()
		}
	}
}

// GetEpochAddressInfo returns current EPOCH address switching state
func (a *App) GetEpochAddressInfo() map[string]interface{} {
	result := map[string]interface{}{
		"current_address":      "",
		"default_address":      DEFAULT_EPOCH_DEVELOPER_ADDRESS,
		"is_on_app_address":    false,
		"last_app_request":     time.Time{},
		"seconds_until_switch": 0,
	}

	if a.epochHandler == nil {
		return result
	}

	result["current_address"] = a.epochHandler.GetCurrentAddress()
	result["default_address"] = a.epochHandler.GetDefaultAddress()
	result["is_on_app_address"] = a.epochHandler.IsOnAppAddress()
	result["last_app_request"] = a.epochHandler.GetLastAppRequestTime()

	if a.epochHandler.IsOnAppAddress() {
		lastRequest := a.epochHandler.GetLastAppRequestTime()
		elapsed := time.Since(lastRequest)
		remaining := STICKY_TIMEOUT - elapsed
		if remaining > 0 {
			result["seconds_until_switch"] = int(remaining.Seconds())
		}
	}

	return result
}
