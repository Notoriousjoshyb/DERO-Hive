// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Developer Support Worker - Passive background hashing for developer support

package main

import (
	"fmt"
	"math"
	"os/exec"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/civilware/epoch"
)

// DevSupportWorker handles passive background hashing for developer support
type DevSupportWorker struct {
	sync.RWMutex

	// Configuration
	enabled        bool          // User setting: is dev support enabled
	verboseLogging bool          // User setting: log periodic heartbeats to console
	hashesPerCycle int           // Hashes to compute per cycle (default: 50)
	cycleInterval  time.Duration // Time between cycles (default: 5 seconds)

	// Runtime state
	running       bool
	paused        bool
	pauseReason   string
	manualPaused  bool   // True when paused by Pause() call (for app support)
	manualReason  string // Reason for manual pause
	stopChan      chan struct{}
	lastHeartbeat time.Time // Last time we logged a heartbeat line

	// Statistics (persisted)
	stats DevSupportStats

	// Dependencies
	epochHandler *EpochHandler
	logFn        func(string)

	// Callbacks
	onStatsUpdate func(DevSupportStats)
}

// DevSupportStats tracks developer support contributions
type DevSupportStats struct {
	TotalHashes       uint64    `json:"total_hashes"`
	TotalHashesStr    string    `json:"total_hashes_str"`
	MiniBlocksFound   int       `json:"miniblocks_found"`
	UptimeSeconds     int64     `json:"uptime_seconds"`
	SessionHashes     uint64    `json:"session_hashes"`
	SessionMiniblocks int       `json:"session_miniblocks"`
	SessionStart      time.Time `json:"session_start"`
	LastActive        time.Time `json:"last_active"`
	TotalSessions     int       `json:"total_sessions"`

	// Current state
	IsRunning   bool   `json:"is_running"`
	IsPaused    bool   `json:"is_paused"`
	PauseReason string `json:"pause_reason,omitempty"`
}

// PauseReason constants - User-friendly messages
const (
	PauseReasonNone          = ""
	PauseReasonHighCPU       = "Paused - system under heavy load"
	PauseReasonBattery       = "Paused - device is on battery power"
	PauseReasonNoNode        = "Waiting for node connection - start or connect to a node"
	PauseReasonNodeSyncing   = "Waiting for node to sync"
	PauseReasonEpochNotReady = "Waiting for node connection"
	PauseReasonAppActive     = "Supporting app developer" // EPOCH is switched to app dev address
)

// Default configuration
const (
	DefaultHashesPerCycle = 50
	DefaultCycleInterval  = 5 * time.Second
	DefaultMaxThreads     = 2
	maxReasonableUptime   = int64(25 * 365 * 24 * 60 * 60) // 25 years
	heartbeatInterval     = 60 * time.Second               // How often to log EPOCH activity heartbeat
)

// NewDevSupportWorker creates a new developer support worker
func NewDevSupportWorker(epochHandler *EpochHandler, logFn func(string)) *DevSupportWorker {
	return &DevSupportWorker{
		enabled:        true, // Default ON (opt-out model)
		verboseLogging: true, // Default ON - heartbeat confirms EPOCH is alive while supporting
		hashesPerCycle: DefaultHashesPerCycle,
		cycleInterval:  DefaultCycleInterval,
		epochHandler:   epochHandler,
		logFn:          logFn,
		stats: DevSupportStats{
			SessionStart: time.Now(),
		},
	}
}

// log helper
func (w *DevSupportWorker) log(msg string) {
	if w.logFn != nil {
		w.logFn(msg)
	}
}

// SetEnabled enables or disables developer support
func (w *DevSupportWorker) SetEnabled(enabled bool) {
	w.Lock()
	w.enabled = enabled
	w.Unlock()

	if enabled {
		w.Start()
	} else {
		w.Stop()
	}
}

// IsEnabled returns whether dev support is enabled
func (w *DevSupportWorker) IsEnabled() bool {
	w.RLock()
	defer w.RUnlock()
	return w.enabled
}

// SetVerboseLogging enables or disables the periodic heartbeat log line.
// When false (default), the worker runs silently except for miniblock finds
// and pause/resume state changes.
func (w *DevSupportWorker) SetVerboseLogging(verbose bool) {
	w.Lock()
	defer w.Unlock()
	w.verboseLogging = verbose
}

// IsVerboseLogging returns whether the heartbeat log line is enabled.
func (w *DevSupportWorker) IsVerboseLogging() bool {
	w.RLock()
	defer w.RUnlock()
	return w.verboseLogging
}

// IsRunning returns whether the worker is actively running
func (w *DevSupportWorker) IsRunning() bool {
	w.RLock()
	defer w.RUnlock()
	return w.running
}

// IsPaused returns whether the worker is paused
func (w *DevSupportWorker) IsPaused() bool {
	w.RLock()
	defer w.RUnlock()
	return w.paused
}

// GetPauseReason returns why the worker is paused
func (w *DevSupportWorker) GetPauseReason() string {
	w.RLock()
	defer w.RUnlock()
	return w.pauseReason
}

// Start begins the passive hashing loop
func (w *DevSupportWorker) Start() {
	w.Lock()
	if w.running {
		w.Unlock()
		return
	}

	if !w.enabled {
		w.Unlock()
		w.log("[EPOCH] Developer Support: Cannot start - disabled by user")
		return
	}

	w.running = true
	w.stopChan = make(chan struct{})
	w.stats.SessionStart = time.Now()
	w.stats.SessionHashes = 0
	w.stats.SessionMiniblocks = 0
	w.stats.TotalSessions++
	w.stats.IsRunning = true
	w.Unlock()

	w.log("[EPOCH] Developer Support: Starting passive background support")
	go w.runLoop()
}

// Stop stops the passive hashing loop
func (w *DevSupportWorker) Stop() {
	w.Lock()
	if !w.running {
		w.Unlock()
		return
	}

	w.running = false
	w.stats.IsRunning = false
	if w.stopChan != nil {
		close(w.stopChan)
	}
	w.Unlock()

	w.log("[EPOCH] Developer Support: Stopped")
}

// runLoop is the main passive hashing loop
func (w *DevSupportWorker) runLoop() {
	ticker := time.NewTicker(w.cycleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopChan:
			return
		case <-ticker.C:
			w.doCycle()
		}
	}
}

// doCycle performs one hashing cycle (if not paused)
func (w *DevSupportWorker) doCycle() {
	// Check pause conditions
	pauseReason := w.checkPauseConditions()

	w.Lock()
	if pauseReason != PauseReasonNone {
		if !w.paused {
			w.paused = true
			w.pauseReason = pauseReason
			w.stats.IsPaused = true
			w.stats.PauseReason = pauseReason
			w.Unlock()
			w.log(fmt.Sprintf("[EPOCH] Developer Support: Paused - %s", pauseReason))
			return
		}
		w.Unlock()
		return
	}

	// Resume if we were paused
	if w.paused {
		w.paused = false
		w.pauseReason = PauseReasonNone
		w.stats.IsPaused = false
		w.stats.PauseReason = ""
		w.Unlock()
		w.log("[EPOCH] Developer Support: Resumed")
	} else {
		w.Unlock()
	}

	// Do the actual hashing
	w.doHashing()
}

// checkPauseConditions checks if we should pause
func (w *DevSupportWorker) checkPauseConditions() string {
	// Check if manually paused (e.g., for app developer support)
	w.RLock()
	if w.manualPaused {
		reason := w.manualReason
		w.RUnlock()
		return reason
	}
	w.RUnlock()

	// Check if EPOCH is ready (requires node connection)
	if w.epochHandler == nil || !w.epochHandler.IsActive() {
		// EPOCH not active means no node connection
		return PauseReasonNoNode
	}

	// Check battery status (be nice to laptop users)
	if w.isOnBattery() {
		return PauseReasonBattery
	}

	// Check CPU load (don't add to heavy load)
	if w.isHighCPULoad() {
		return PauseReasonHighCPU
	}

	return PauseReasonNone
}

// doHashing performs the actual hash computation
func (w *DevSupportWorker) doHashing() {
	if w.epochHandler == nil {
		return
	}

	// Get hashes per cycle
	w.RLock()
	hashCount := w.hashesPerCycle
	w.RUnlock()

	// Attempt hashes via EPOCH
	result, err := epoch.AttemptHashes(hashCount)
	if err != nil {
		// Don't log every failure - EPOCH might just not be ready
		return
	}

	// Update statistics
	w.Lock()
	if w.stats.SessionStart.IsZero() {
		w.stats.SessionStart = time.Now()
	}
	w.stats.SessionHashes += result.Hashes
	w.stats.TotalHashes += result.Hashes
	w.stats.TotalHashesStr = formatHashCount(w.stats.TotalHashes)
	w.stats.SessionMiniblocks += result.Submitted
	w.stats.MiniBlocksFound += result.Submitted
	w.stats.LastActive = time.Now()
	w.stats.UptimeSeconds = sanitizeUptimeSeconds(int64(time.Since(w.stats.SessionStart).Seconds()))

	// Periodic heartbeat so operators can confirm EPOCH is actually hashing.
	// Logs once per heartbeatInterval, and only when verbose logging is enabled.
	verbose := w.verboseLogging
	shouldHeartbeat := verbose && time.Since(w.lastHeartbeat) >= heartbeatInterval
	if shouldHeartbeat {
		w.lastHeartbeat = time.Now()
	}
	sessionHashes := w.stats.SessionHashes
	sessionMBs := w.stats.SessionMiniblocks
	totalMBs := w.stats.MiniBlocksFound
	w.Unlock()

	if shouldHeartbeat {
		w.log(fmt.Sprintf("[EPOCH] Heartbeat: session=%s hashes, %d miniblocks submitted (total found: %d)",
			formatHashCount(sessionHashes), sessionMBs, totalMBs))
	}

	// Log miniblock finds immediately
	if result.Submitted > 0 {
		w.log(fmt.Sprintf("[EPOCH] Developer Support: Found %d miniblock(s)! Total: %d", result.Submitted, totalMBs))
	}

	// Trigger callback if set
	if w.onStatsUpdate != nil {
		w.onStatsUpdate(w.GetStats())
	}
}

// isOnBattery checks if device is on battery power
func (w *DevSupportWorker) isOnBattery() bool {
	switch runtime.GOOS {
	case "darwin":
		// macOS: check using pmset
		cmd := exec.Command("pmset", "-g", "batt")
		if runtime.GOOS == "windows" {
			attr := &syscall.SysProcAttr{}
			if f := reflect.ValueOf(attr).Elem().FieldByName("HideWindow"); f.IsValid() {
				f.SetBool(true)
			}
			cmd.SysProcAttr = attr
		}
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		// If output contains "Battery Power" we're on battery
		return contains(string(out), "Battery Power")
	case "linux":
		// Linux: check /sys/class/power_supply/
		// Simplified check - look for AC adapter status
		cmd := exec.Command("cat", "/sys/class/power_supply/AC/online")
		if runtime.GOOS == "windows" {
			attr := &syscall.SysProcAttr{}
			if f := reflect.ValueOf(attr).Elem().FieldByName("HideWindow"); f.IsValid() {
				f.SetBool(true)
			}
			cmd.SysProcAttr = attr
		}
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		return string(out) == "0\n" // 0 means not on AC
	case "windows":
		// Windows: use PowerShell to check battery status via WMI
		cmd := exec.Command("powershell", "-Command",
			"(Get-WmiObject Win32_Battery).BatteryStatus")
		attr := &syscall.SysProcAttr{}
		if f := reflect.ValueOf(attr).Elem().FieldByName("HideWindow"); f.IsValid() {
			f.SetBool(true)
		}
		cmd.SysProcAttr = attr
		out, err := cmd.Output()
		if err != nil {
			return false // Assume plugged in if we can't detect
		}
		// BatteryStatus: 1 = Discharging (on battery), 2 = AC Power
		return strings.TrimSpace(string(out)) == "1"
	}
	return false
}

// isHighCPULoad checks if system is under heavy load
func (w *DevSupportWorker) isHighCPULoad() bool {
	// Simple heuristic: check number of goroutines as proxy for load
	// A more sophisticated approach would use runtime metrics or OS calls
	numGoroutines := runtime.NumGoroutine()
	// If we have way more goroutines than CPUs, system might be busy
	return numGoroutines > runtime.NumCPU()*50
}

// GetStats returns current statistics
func (w *DevSupportWorker) GetStats() DevSupportStats {
	w.RLock()
	defer w.RUnlock()

	stats := w.stats
	if w.running && !w.stats.SessionStart.IsZero() {
		stats.UptimeSeconds = sanitizeUptimeSeconds(int64(time.Since(w.stats.SessionStart).Seconds()))
	} else {
		stats.UptimeSeconds = sanitizeUptimeSeconds(stats.UptimeSeconds)
	}
	stats.IsRunning = w.running
	stats.IsPaused = w.paused
	stats.PauseReason = w.pauseReason
	return stats
}

// SetStats sets statistics (for loading persisted data)
func (w *DevSupportWorker) SetStats(stats DevSupportStats) {
	w.Lock()
	defer w.Unlock()

	// Preserve runtime state
	isRunning := w.running
	isPaused := w.paused
	pauseReason := w.pauseReason

	w.stats = stats
	if w.stats.SessionStart.IsZero() {
		// Keep a non-zero anchor to prevent overflow in any elapsed-time calculations.
		w.stats.SessionStart = time.Now()
	}
	w.stats.UptimeSeconds = sanitizeUptimeSeconds(w.stats.UptimeSeconds)
	w.stats.IsRunning = isRunning
	w.stats.IsPaused = isPaused
	w.stats.PauseReason = pauseReason
}

func sanitizeUptimeSeconds(v int64) int64 {
	if v < 0 || v == math.MaxInt64 || v > maxReasonableUptime {
		return 0
	}
	return v
}

// SetOnStatsUpdate sets a callback for stats updates
func (w *DevSupportWorker) SetOnStatsUpdate(fn func(DevSupportStats)) {
	w.Lock()
	defer w.Unlock()
	w.onStatsUpdate = fn
}

// ================== Manual Pause/Resume for App Developer Support ==================

// Pause temporarily pauses the background worker with a given reason.
// This is used when EPOCH is switched to an app developer's address.
// The worker will not compute hashes while paused.
func (w *DevSupportWorker) Pause(reason string) {
	w.Lock()
	defer w.Unlock()

	if w.manualPaused {
		return // Already paused
	}

	w.manualPaused = true
	w.manualReason = reason
	w.paused = true
	w.pauseReason = reason
	w.stats.IsPaused = true
	w.stats.PauseReason = reason

	w.log(fmt.Sprintf("[EPOCH] Background support paused: %s", reason))
}

// Resume resumes the background worker after a manual pause.
// Called when EPOCH switches back to the default address.
func (w *DevSupportWorker) Resume() {
	w.Lock()
	defer w.Unlock()

	if !w.manualPaused {
		return // Not manually paused
	}

	w.manualPaused = false
	w.manualReason = ""
	// Don't clear w.paused here - let checkPauseConditions handle it
	// This way if there's another pause reason (battery, CPU), it will still pause

	w.log("[EPOCH] Background support resumed")
}

// IsManuallyPaused returns true if the worker was paused via Pause()
func (w *DevSupportWorker) IsManuallyPaused() bool {
	w.RLock()
	defer w.RUnlock()
	return w.manualPaused
}

// formatHashCount formats hash count for display
func formatHashCount(hashes uint64) string {
	if hashes >= 1000000 {
		return fmt.Sprintf("%.1fM", float64(hashes)/1000000)
	} else if hashes >= 1000 {
		return fmt.Sprintf("%.1fK", float64(hashes)/1000)
	}
	return fmt.Sprintf("%d", hashes)
}

// contains checks if string contains substring (helper)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsAt(s, substr))
}

func containsAt(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
