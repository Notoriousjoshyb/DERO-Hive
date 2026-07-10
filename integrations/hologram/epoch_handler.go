package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/civilware/epoch"
)

// EpochHandler manages EPOCH (Event-Driven Propagation of Crowd Hashing) for HOLOGRAM.
// EPOCH allows TELA apps to request hash computations as a non-intrusive form of developer support.
// Default: ON (opt-out model)
//
// Address Switching: When a TELA app calls AttemptEPOCHWithAddr with a developer address,
// HOLOGRAM temporarily switches the EPOCH connection to that address so the app developer
// receives the mining rewards. After a period of inactivity (STICKY_TIMEOUT), it switches
// back to the default HOLOGRAM address.
type EpochHandler struct {
	sync.RWMutex

	enabled    bool   // User setting: is EPOCH enabled (default: true)
	maxHashes  int    // Max hashes per request (user-configurable)
	maxThreads int    // Max threads for EPOCH (user-configurable)
	address    string // Current reward address (may be app developer or default)

	// Address switching state
	defaultAddress    string    // The default HOLOGRAM developer address
	currentAppAddress string    // The current app's developer address (if switched)
	lastAppRequest    time.Time // When the last app-specific request was made
	daemonEndpoint    string    // Cached daemon endpoint for reconnection

	// Rate limiting per app
	rateLimits    map[string]*rateLimitEntry
	rateLimitLock sync.Mutex

	// Logging callback
	logFn func(string)
}

type rateLimitEntry struct {
	lastRequest time.Time
	hashCount   uint64
	window      time.Duration
	// Local support metrics retained across rolling rate-limit windows.
	totalRequests   uint64
	totalHashes     uint64
	totalMiniBlocks int
}

// EpochStats represents EPOCH session statistics for frontend display
type EpochStats struct {
	Active                 bool      `json:"active"`
	Enabled                bool      `json:"enabled"`
	Hashes                 uint64    `json:"hashes"`
	HashesStr              string    `json:"hashes_str"`
	MiniBlocks             int       `json:"miniblocks"`
	Version                string    `json:"version"`
	MaxHashes              int       `json:"max_hashes"`
	MaxThreads             int       `json:"max_threads"`
	Address                string    `json:"address"`
	IsProcessing           bool      `json:"is_processing"`
	TrackedApps            int       `json:"tracked_apps"`
	TotalRequests          uint64    `json:"total_requests"`
	LastRequester          string    `json:"last_requester"`
	LastRequestAt          time.Time `json:"last_request_at"`
	TopRequester           string    `json:"top_requester"`
	TopRequesterHashes     uint64    `json:"top_requester_hashes"`
	TopRequesterMiniblocks int       `json:"top_requester_miniblocks"`
}

// EpochResult represents the result of an EPOCH hash attempt
type EpochResult struct {
	Success    bool    `json:"success"`
	Hashes     uint64  `json:"hashes"`
	Submitted  int     `json:"submitted"`
	Duration   int64   `json:"duration_ms"`
	HashPerSec float64 `json:"hash_per_sec"`
	Error      string  `json:"error,omitempty"`
}

const (
	// Default settings for EPOCH
	DEFAULT_EPOCH_MAX_HASHES  = 100 // Conservative default for per-request limit
	DEFAULT_EPOCH_MAX_THREADS = 2   // Conservative CPU usage

	// Rate limiting
	RATE_LIMIT_WINDOW     = 10 * time.Second // Window for rate limiting
	RATE_LIMIT_MAX_HASHES = 500              // Max hashes per app per window

	// Address switching
	STICKY_TIMEOUT = 30 * time.Second // How long to stay on app developer's address after last request

	// EPOCH Developer Support Address
	// This is the default address where EPOCH mining rewards are sent when idle.
	// When a TELA app requests EPOCH with their developer address, we temporarily switch to that address.
	// After STICKY_TIMEOUT of inactivity, we switch back to this default address.
	DEFAULT_EPOCH_DEVELOPER_ADDRESS = "dero1qyqu6kdla44msn0ky5skpv4fahj2ay80ycjpz27kgc4wf7jk4ys0kqq6s36fh"
)

// NewEpochHandler creates a new EPOCH handler with sensible defaults
func NewEpochHandler(logFn func(string)) *EpochHandler {
	return &EpochHandler{
		enabled:        true, // DEFAULT ON (opt-out model)
		maxHashes:      DEFAULT_EPOCH_MAX_HASHES,
		maxThreads:     DEFAULT_EPOCH_MAX_THREADS,
		defaultAddress: DEFAULT_EPOCH_DEVELOPER_ADDRESS,
		rateLimits:     make(map[string]*rateLimitEntry),
		logFn:          logFn,
	}
}

// log helper
func (e *EpochHandler) log(msg string) {
	if e.logFn != nil {
		e.logFn(msg)
	}
}

// Initialize starts the EPOCH connection to the DERO node.
// Called automatically on app startup if enabled.
// IMPORTANT: EPOCH is for developer/ecosystem support. Rewards go to the developer address,
// NOT the user's wallet (that's what the background miner is for).
func (e *EpochHandler) Initialize(address, daemonEndpoint string) error {
	e.Lock()
	defer e.Unlock()

	if !e.enabled {
		e.log("[EPOCH] Developer support is disabled")
		return nil
	}

	if epoch.IsActive() {
		e.log("[EPOCH] Already active")
		return nil
	}

	// Use default developer address if none provided
	// EPOCH rewards should go to developers/ecosystem, not users
	if address == "" {
		address = DEFAULT_EPOCH_DEVELOPER_ADDRESS
		e.log("[EPOCH] Using default developer support address")
	}
	e.address = address
	e.defaultAddress = address
	e.daemonEndpoint = daemonEndpoint

	// Configure EPOCH
	epoch.SetMaxThreads(e.maxThreads)
	if err := epoch.SetMaxHashes(e.maxHashes); err != nil {
		e.log(fmt.Sprintf("[WARN] EPOCH: Could not set max hashes: %v", err))
	}

	e.log(fmt.Sprintf("[EPOCH] Connecting to daemon %s...", daemonEndpoint))

	// Start EPOCH connection
	err := epoch.StartGetWork(address, daemonEndpoint)
	if err != nil {
		e.log(fmt.Sprintf("[ERR] EPOCH: Connection failed: %v", err))
		return err
	}

	// Wait for first job (up to 10 seconds)
	if err := epoch.JobIsReady(10 * time.Second); err != nil {
		e.log(fmt.Sprintf("[WARN] EPOCH: No job received within timeout: %v", err))
		// Don't return error - connection is still active, job may come later
		return nil
	}

	// Option 3: Wait for successful job before logging "active"
	// Check if we can get a valid session after a short delay to ensure miner is registered
	// This helps avoid logging "active" when miner isn't registered yet
	go func() {
		// Wait 30 seconds to allow miner registration
		time.Sleep(30 * time.Second)

		// Check if EPOCH is still active (user might have disabled it)
		if !epoch.IsActive() {
			return
		}

		// Try to get a session - if successful, we can consider it "active"
		session, err := epoch.GetSession(5 * time.Second)
		if err == nil && session.Version != "" {
			e.log("[OK] EPOCH: Developer support active")
		} else {
			// Connected but waiting for miner registration
			e.log("[WARN] EPOCH: Connected but waiting for miner registration (may take up to 15 minutes)")
		}
	}()

	return nil
}

// Shutdown stops the EPOCH connection
func (e *EpochHandler) Shutdown() {
	e.Lock()
	defer e.Unlock()

	if epoch.IsActive() {
		epoch.StopGetWork()
		e.log("[EPOCH] Developer support stopped")
	}
}

// SetEnabled toggles EPOCH on/off
func (e *EpochHandler) SetEnabled(enabled bool) {
	e.Lock()
	e.enabled = enabled
	e.Unlock()

	if !enabled && epoch.IsActive() {
		epoch.StopGetWork()
		e.log("[EPOCH] Developer support disabled by user")
	}
}

// IsEnabled returns whether EPOCH is enabled in settings
func (e *EpochHandler) IsEnabled() bool {
	e.RLock()
	defer e.RUnlock()
	return e.enabled
}

// IsActive returns whether EPOCH connection is active
func (e *EpochHandler) IsActive() bool {
	return epoch.IsActive()
}

// SetMaxHashes updates the per-request hash limit
func (e *EpochHandler) SetMaxHashes(max int) error {
	e.Lock()
	defer e.Unlock()

	if max < 1 || max > epoch.LIMIT_MAX_HASHES {
		return fmt.Errorf("max hashes must be between 1 and %d", epoch.LIMIT_MAX_HASHES)
	}

	e.maxHashes = max
	return epoch.SetMaxHashes(max)
}

// SetMaxThreads updates the thread count
func (e *EpochHandler) SetMaxThreads(threads int) {
	e.Lock()
	defer e.Unlock()

	e.maxThreads = threads
	epoch.SetMaxThreads(threads)
}

// GetStats returns current EPOCH session statistics
func (e *EpochHandler) GetStats() EpochStats {
	e.RLock()
	enabled := e.enabled
	maxHashes := e.maxHashes
	maxThreads := e.maxThreads
	address := e.address
	e.RUnlock()

	stats := EpochStats{
		Enabled:    enabled,
		MaxHashes:  maxHashes,
		MaxThreads: maxThreads,
		Address:    address,
	}

	if epoch.IsActive() {
		stats.Active = true
		stats.IsProcessing = epoch.IsProcessing()

		session, err := epoch.GetSession(2 * time.Second)
		if err == nil {
			stats.Hashes = session.Hashes
			stats.HashesStr = epoch.HashesToString(session.Hashes)
			stats.MiniBlocks = session.MiniBlocks
			stats.Version = session.Version
		}
	}

	e.rateLimitLock.Lock()
	stats.TrackedApps = len(e.rateLimits)
	for appID, entry := range e.rateLimits {
		if entry == nil {
			continue
		}
		stats.TotalRequests += entry.totalRequests
		if entry.totalHashes > stats.TopRequesterHashes {
			stats.TopRequester = appID
			stats.TopRequesterHashes = entry.totalHashes
			stats.TopRequesterMiniblocks = entry.totalMiniBlocks
		}
		if entry.lastRequest.After(stats.LastRequestAt) {
			stats.LastRequestAt = entry.lastRequest
			stats.LastRequester = appID
		}
	}
	e.rateLimitLock.Unlock()

	if stats.LastRequester == "" {
		stats.LastRequester = "none"
	}
	if stats.TopRequester == "" {
		stats.TopRequester = "none"
	}

	return stats
}

// HandleRequest processes an EPOCH request from a TELA app via XSWD.
// This is the main entry point for dApps to request hash computations.
// HOLOGRAM enforces its own limits regardless of what the app requests.
func (e *EpochHandler) HandleRequest(requestedHashes int, appSCID string) EpochResult {
	e.RLock()
	enabled := e.enabled
	maxAllowed := e.maxHashes
	e.RUnlock()

	result := EpochResult{}
	appID := normalizeAppIdentifier(appSCID)

	// Check if enabled
	if !enabled {
		result.Error = "Developer support is disabled"
		return result
	}

	// Check if active
	if !epoch.IsActive() {
		result.Error = "EPOCH not connected"
		return result
	}

	// Enforce HOLOGRAM's limits (not the app's request)
	if requestedHashes > maxAllowed {
		requestedHashes = maxAllowed
	}
	if requestedHashes < 1 {
		requestedHashes = 1
	}

	// Rate limiting per app
	if e.isRateLimited(appID, uint64(requestedHashes)) {
		result.Error = "Rate limited"
		return result
	}

	// Attempt hashes
	epochResult, err := epoch.AttemptHashes(requestedHashes)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	// Record for rate limiting
	e.recordRequest(appID, epochResult.Hashes, epochResult.Submitted)

	result.Success = true
	result.Hashes = epochResult.Hashes
	result.Submitted = epochResult.Submitted
	result.Duration = epochResult.Duration
	result.HashPerSec = epochResult.HashPerSec

	if epochResult.Submitted > 0 {
		e.log(fmt.Sprintf("[EPOCH] Found %d miniblock(s) for app %s!", epochResult.Submitted, previewAppIdentifier(appID)))
	}

	return result
}

// isRateLimited checks if an app has exceeded its rate limit
func (e *EpochHandler) isRateLimited(appSCID string, requestedHashes uint64) bool {
	appSCID = normalizeAppIdentifier(appSCID)

	e.rateLimitLock.Lock()
	defer e.rateLimitLock.Unlock()

	now := time.Now()
	entry, exists := e.rateLimits[appSCID]

	if !exists {
		// First request from this app
		return false
	}

	// Check if window has expired
	if now.Sub(entry.lastRequest) > entry.window {
		// Window expired, reset
		entry.hashCount = 0
		entry.lastRequest = now
		return false
	}

	// Check if adding these hashes would exceed limit
	if entry.hashCount+requestedHashes > RATE_LIMIT_MAX_HASHES {
		return true
	}

	return false
}

// recordRequest records a request for rate limiting
func (e *EpochHandler) recordRequest(appSCID string, hashes uint64, submitted int) {
	appSCID = normalizeAppIdentifier(appSCID)

	e.rateLimitLock.Lock()
	defer e.rateLimitLock.Unlock()

	now := time.Now()
	entry, exists := e.rateLimits[appSCID]

	if !exists {
		e.rateLimits[appSCID] = &rateLimitEntry{
			lastRequest:     now,
			hashCount:       hashes,
			window:          RATE_LIMIT_WINDOW,
			totalRequests:   1,
			totalHashes:     hashes,
			totalMiniBlocks: submitted,
		}
		return
	}

	// Check if window has expired
	if now.Sub(entry.lastRequest) > entry.window {
		entry.hashCount = hashes
		entry.lastRequest = now
	} else {
		entry.hashCount += hashes
	}
	entry.totalRequests++
	entry.totalHashes += hashes
	entry.totalMiniBlocks += submitted
}

// GetConfig returns the current EPOCH configuration
func (e *EpochHandler) GetConfig() map[string]interface{} {
	e.RLock()
	defer e.RUnlock()

	return map[string]interface{}{
		"enabled":     e.enabled,
		"max_hashes":  e.maxHashes,
		"max_threads": e.maxThreads,
		"address":     e.address,
	}
}

// SetConfig updates EPOCH configuration
func (e *EpochHandler) SetConfig(enabled bool, maxHashes, maxThreads int) {
	e.Lock()
	e.enabled = enabled
	if maxHashes > 0 && maxHashes <= epoch.LIMIT_MAX_HASHES {
		e.maxHashes = maxHashes
		epoch.SetMaxHashes(maxHashes)
	}
	if maxThreads > 0 {
		e.maxThreads = maxThreads
		epoch.SetMaxThreads(maxThreads)
	}
	e.Unlock()

	if !enabled && epoch.IsActive() {
		epoch.StopGetWork()
	}
}

// ================== Address Switching for Fair Developer Support ==================

// SwitchToAddress temporarily switches EPOCH to a different developer's address.
// This is called when a TELA app requests AttemptEPOCHWithAddr with their developer address.
// The connection is switched so that app's developer receives the mining rewards.
// Returns error if switch fails (invalid address, connection issues).
func (e *EpochHandler) SwitchToAddress(newAddress string) error {
	e.Lock()
	defer e.Unlock()

	if !e.enabled {
		return fmt.Errorf("EPOCH is disabled")
	}

	// If same address, just update the timestamp
	if newAddress == e.address {
		e.lastAppRequest = time.Now()
		return nil
	}

	// Validate the new address
	if newAddress == "" {
		return fmt.Errorf("empty address")
	}

	// Stop current connection
	if epoch.IsActive() {
		epoch.StopGetWork()
		// Brief pause to allow clean disconnect
		time.Sleep(100 * time.Millisecond)
	}

	// Start new connection with the app developer's address
	err := epoch.StartGetWork(newAddress, e.daemonEndpoint)
	if err != nil {
		// Try to restore default connection
		e.log(fmt.Sprintf("[EPOCH] Failed to switch to %s...%s: %v",
			newAddress[:12], newAddress[len(newAddress)-8:], err))
		epoch.StartGetWork(e.defaultAddress, e.daemonEndpoint)
		e.address = e.defaultAddress
		e.currentAppAddress = ""
		return err
	}

	// Wait briefly for connection
	epoch.JobIsReady(3 * time.Second)

	// Update state
	e.address = newAddress
	e.currentAppAddress = newAddress
	e.lastAppRequest = time.Now()

	e.log(fmt.Sprintf("[EPOCH] Switched to app developer: %s...%s",
		newAddress[:12], newAddress[len(newAddress)-8:]))

	return nil
}

// SwitchToDefault switches EPOCH back to the default HOLOGRAM developer address.
// Called after STICKY_TIMEOUT of inactivity from app requests.
func (e *EpochHandler) SwitchToDefault() error {
	e.Lock()
	defer e.Unlock()

	// Already on default
	if e.address == e.defaultAddress {
		e.currentAppAddress = ""
		return nil
	}

	if !e.enabled {
		return fmt.Errorf("EPOCH is disabled")
	}

	// Stop current connection
	if epoch.IsActive() {
		epoch.StopGetWork()
		time.Sleep(100 * time.Millisecond)
	}

	// Reconnect with default address
	err := epoch.StartGetWork(e.defaultAddress, e.daemonEndpoint)
	if err != nil {
		e.log(fmt.Sprintf("[ERR] EPOCH: Failed to switch back to default: %v", err))
		return err
	}

	epoch.JobIsReady(3 * time.Second)

	e.address = e.defaultAddress
	e.currentAppAddress = ""

	e.log("[EPOCH] Switched back to default developer support address")

	return nil
}

// GetCurrentAddress returns the current reward address
func (e *EpochHandler) GetCurrentAddress() string {
	e.RLock()
	defer e.RUnlock()
	return e.address
}

// GetDefaultAddress returns the default HOLOGRAM developer address
func (e *EpochHandler) GetDefaultAddress() string {
	e.RLock()
	defer e.RUnlock()
	return e.defaultAddress
}

// IsOnAppAddress returns true if currently switched to an app developer's address
func (e *EpochHandler) IsOnAppAddress() bool {
	e.RLock()
	defer e.RUnlock()
	return e.currentAppAddress != "" && e.address != e.defaultAddress
}

// GetLastAppRequestTime returns when the last app-specific EPOCH request was made
func (e *EpochHandler) GetLastAppRequestTime() time.Time {
	e.RLock()
	defer e.RUnlock()
	return e.lastAppRequest
}

// ShouldSwitchBackToDefault returns true if we've been on an app address for too long
// without any new requests (exceeded STICKY_TIMEOUT)
func (e *EpochHandler) ShouldSwitchBackToDefault() bool {
	e.RLock()
	defer e.RUnlock()

	if e.currentAppAddress == "" || e.address == e.defaultAddress {
		return false
	}

	return time.Since(e.lastAppRequest) > STICKY_TIMEOUT
}

// SetDaemonEndpoint updates the daemon endpoint (for reconnection)
func (e *EpochHandler) SetDaemonEndpoint(endpoint string) {
	e.Lock()
	defer e.Unlock()
	e.daemonEndpoint = endpoint
}

func normalizeAppIdentifier(appID string) string {
	normalized := strings.TrimSpace(appID)
	if normalized == "" {
		return "unknown"
	}
	if len(normalized) > 128 {
		return normalized[:128]
	}
	return normalized
}

func previewAppIdentifier(appID string) string {
	normalized := normalizeAppIdentifier(appID)
	if normalized == "unknown" || len(normalized) <= 16 {
		return normalized
	}
	return normalized[:16] + "..."
}
