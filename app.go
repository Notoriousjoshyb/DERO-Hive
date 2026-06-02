// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Core App Structure - Session 87 refactored into domain files
//
// Domain Files:
//   app_navigation.go  - Navigate, GoBack, GoForward, Reload, History
//   app_settings.go    - GetSetting, SetSetting, GetAllSettings
//   app_console.go     - ConsoleLog, logToConsole, GetConsoleLogs
//   app_status.go      - StatusBroadcaster, getFullStatus, StartStatusBroadcast
//   app_devsupport.go  - EPOCH, Developer Support
//   app_gnomon.go      - Gnomon, App Discovery, Search, Libraries

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/civilware/tela"
	"github.com/deroproject/derohe/cryptography/crypto"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var deroSCID = crypto.ZEROHASH.String()

// App struct
type App struct {
	ctx          context.Context
	xswdClient   *XSWDClient
	daemonClient BlockchainClient
	gnomonClient *GnomonClient
	cache        ContentCache
	xswdServer   *XSWDServer
	liveStats    *LiveStatsService
	settings     map[string]interface{}
	history      []string
	consoleLogs  []ConsoleLog
	launchURL    string

	// EPOCH (Developer Support)
	epochHandler     *EpochHandler
	devSupportWorker *DevSupportWorker

	// Phase 5: Advanced Services
	offlineCache       *OfflineCache       // Offline-first browsing
	contentFilter      *ContentFilter      // Safe browsing controls
	timeTravelExplorer *TimeTravelExplorer // SC state history

	// NRS Cache (Name Resolution Service - bidirectional)
	nrsCache *NRSCache

	// Simulator Mode (integrated testing environment)
	simulatorManager *SimulatorManager

	// simulatorDeployEndpoint holds the real daemon endpoint during simulator batch deploy.
	// Daemon_Endpoint_Active is intentionally blanked between TXs to suppress
	// walletapi.Keep_Connectivity from opening competing WebSocket connections.
	// This field lets deployDOC restore the endpoint when it needs to connect.
	simulatorDeployEndpoint string

	// Gnomon WebSocket API Server (simple-gnomon feature)
	gnomonWSServer *GnomonWSServer

	// Status broadcast
	statusBroadcaster     *StatusBroadcaster
	statusBroadcasterOnce sync.Once
	launchURLMu           sync.Mutex

	// Wizard / startup gating
	wizardComplete        bool
	backgroundStarted     bool
	backgroundStartedOnce sync.Once

	// EPOCH address monitor lifecycle
	epochMonitorStop chan struct{}
}

// NewApp creates a new App application struct
func NewApp() *App {
	daemonEndpoint := "http://127.0.0.1:10102"

	app := &App{
		xswdClient:   NewXSWDClient(),
		daemonClient: NewDaemonClient(daemonEndpoint),
		gnomonClient: NewGnomonClient("gravdb"),
		cache:        NewGravitonCache(),
		settings: map[string]interface{}{
			"min_rating":         60,
			"block_malware":      true,
			"show_nsfw":          false,
			"auto_connect_ws":    true,
			"gnomon_enabled":     false,
			"daemon_endpoint":    daemonEndpoint,
			"network":            "mainnet",
			"integrated_wallet":  true,
			"allow_github_check": true, // Allow pinging GitHub for derod updates
			"hide_balance":       false,
			"hide_address":       false,
			"avatar_hidden":      false,
			"privacy_mode":       false,
		},
		history:     make([]string, 0),
		consoleLogs: make([]ConsoleLog, 0),
	}

	app.xswdServer = NewXSWDServer(app)
	app.epochHandler = NewEpochHandler(app.logToConsole)
	app.devSupportWorker = NewDevSupportWorker(app.epochHandler, app.logToConsole)
	return app
}

// shutdown is called when the app is closing. Ensures open wallets are
// flushed to disk so a hard exit / reboot cannot leave 0-byte wallet files.
func (a *App) shutdown(ctx context.Context) {
	a.logToConsole("[SHUTDOWN] HOLOGRAM shutting down — closing wallet...")

	walletManager.Lock()
	if walletManager.isOpen && walletManager.wallet != nil {
		walletManager.wallet.Close_Encrypted_Wallet()
		walletManager.wallet = nil
		walletManager.isOpen = false
		walletManager.walletPath = ""
	}
	walletManager.Unlock()

	a.logToConsole("[SHUTDOWN] Wallet closed. Goodbye.")
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.logToConsole("[START] TELA Browser starting up...")

	// Load persisted settings (daemon_endpoint, network, etc.) before any connections
	// This ensures user-configured endpoints survive app restarts
	a.loadSettings()

	// Reconcile daemon_endpoint with the actual network after loading persisted settings.
	// Bug #39 fix: persisted settings may contain a stale endpoint (e.g. simulator :20000)
	// from a previous session while the user is now on mainnet. We need to update both
	// the daemonClient and the settings before any services start using them.
	a.reconcileDaemonEndpoint()

	// Ensure datashards are writable before any TELA operations
	// CRITICAL: This MUST succeed or TELA apps will fail with "read-only file system" errors
	dataDir := getHologramDataDir()
	a.logToConsole(fmt.Sprintf("[INIT] Setting TELA datashards path to: %s", dataDir))

	// IMPORTANT:
	// `tela` caches its shard path at package init (tela.path.main = shards.GetPath()).
	// Calling `shards.SetPath()` later does NOT update tela's internal path.
	// We must use `tela.SetShardPath()` so both shards + tela are updated.
	err := tela.SetShardPath(dataDir)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] TELA datashards path not writable: %v", err))
		a.logToConsole("[ERR] TELA apps will NOT work correctly - datashards directory cannot be created")
		// Try to create the directory manually as a fallback
		if mkErr := os.MkdirAll(filepath.Join(dataDir, "datashards"), 0755); mkErr != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Manual datashards creation also failed: %v", mkErr))
		} else {
			// Retry after manual creation
			if err = tela.SetShardPath(dataDir); err != nil {
				a.logToConsole(fmt.Sprintf("[ERR] SetShardPath still failed after manual creation: %v", err))
			} else {
				a.logToConsole(fmt.Sprintf("[OK] TELA datashards path set (after retry): %s", filepath.Join(dataDir, "datashards")))
			}
		}
	} else {
		a.logToConsole(fmt.Sprintf("[OK] TELA datashards path: %s", filepath.Join(dataDir, "datashards")))
	}

	// Initialize XSWD permission manager
	if gc, ok := a.cache.(*GravitonCache); ok {
		InitPermissionManager(gc)
		a.logToConsole("[WALLET] XSWD permission manager initialized")
	}

	// Initialize Phase 5 Services
	a.offlineCache, err = NewOfflineCache(a.logToConsole)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Offline cache initialization failed: %v", err))
	}

	a.contentFilter, err = NewContentFilter(a.logToConsole)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Content filter initialization failed: %v", err))
	}

	a.timeTravelExplorer, err = NewTimeTravelExplorer(a, a.logToConsole)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Time-travel explorer initialization failed: %v", err))
	}

	// NRS Cache
	a.nrsCache = NewNRSCache(filepath.Join(getDatashardsDir(), "nrs_cache"))
	a.nrsCache.SetApp(a)
	a.logToConsole("[NRS] NRS cache initialized")

	// Test daemon connection
	go func() {
		a.logToConsole("[LINK] Testing daemon connection...")
		if err := a.daemonClient.TestConnection(); err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Daemon connection failed: %v", err))
			a.logToConsole("[WARN]  Make sure derod is running on http://127.0.0.1:10102")
		} else {
			a.logToConsole("[OK] Daemon connection successful!")
		}
	}()

	// Check if wizard was already completed (returning user)
	if wizardDone, ok := a.settings["wizard_complete"].(bool); ok && wizardDone {
		a.wizardComplete = true
		a.startBackgroundServices()
	} else {
		a.logToConsole("[START] First run detected - background services deferred until setup completes")
	}
}

// NotifyWizardComplete is called by the frontend when the FirstRunWizard finishes.
// It starts all the background services that were deferred during first run.
func (a *App) NotifyWizardComplete() {
	a.wizardComplete = true
	a.logToConsole("[START] Setup complete - starting background services")
	a.startBackgroundServices()
}

// startBackgroundServices starts all background goroutines (XSWD, EPOCH, Gnomon, StatusBroadcaster).
// Gated behind wizard completion so first-run users don't get hammered by daemon polling.
func (a *App) startBackgroundServices() {
	a.backgroundStartedOnce.Do(func() {
		a.backgroundStarted = true

		// Auto-connect to XSWD
		if autoConnect, ok := a.settings["auto_connect_ws"].(bool); ok && autoConnect {
			if integrated, ok := a.settings["integrated_wallet"].(bool); ok && integrated {
				go a.xswdServer.Start()
			} else {
				go func() {
					a.logToConsole("[XSWD] Auto-connecting to XSWD (external wallet)...")
					a.ConnectXSWD()
				}()
			}
		}

		// Initialize Developer Support
		go func() {
			time.Sleep(3 * time.Second)

			devSupportEnabled := true
			if savedSetting, ok := a.settings["dev_support_enabled"]; ok {
				if enabled, ok := savedSetting.(bool); ok {
					devSupportEnabled = enabled
				}
			} else if savedSetting, ok := a.settings["epoch_enabled"]; ok {
				if enabled, ok := savedSetting.(bool); ok {
					devSupportEnabled = enabled
				}
			}

			a.loadDevSupportStats()

			// Load verbose logging preference (default: on — heartbeat proves
			// EPOCH is alive while supporting; users who find it noisy can
			// disable it from the Developer Support settings panel)
			if a.devSupportWorker != nil {
				verbose := true
				if savedSetting, ok := a.settings["dev_support_verbose"]; ok {
					if v, ok := savedSetting.(bool); ok {
						verbose = v
					}
				}
				a.devSupportWorker.SetVerboseLogging(verbose)
			}

			if a.epochHandler == nil {
				a.epochHandler = NewEpochHandler(a.logToConsole)
			}
			a.epochHandler.SetEnabled(devSupportEnabled)

			if devSupportEnabled {
				// Wait for node sync before starting EPOCH
				// This helps avoid "unregistered miner" errors by ensuring node is ready
				if !a.waitForNodeSync(5 * time.Minute) {
					a.logToConsole("[WARN] EPOCH: Node sync check timeout - starting anyway")
				}

				a.InitializeEpoch()
				time.Sleep(2 * time.Second)

				if a.devSupportWorker != nil {
					a.devSupportWorker.SetEnabled(true)
					a.devSupportWorker.Start()
				}

				// Start the address monitor for fair developer support switching
				a.StartEpochAddressMonitor()
			} else {
				a.logToConsole("[EPOCH] Developer Support: Disabled by user preference")
			}
		}()

		// Sync simulator UI when derod survived a previous session (network=simulator, :20000 up).
		go func() {
			time.Sleep(1 * time.Second)
			a.ensureSimulatorReconnectedIfNeeded()
		}()

		// Auto-start Gnomon if enabled
		go func() {
			time.Sleep(2 * time.Second) // Wait for daemon connection test

			if autostart, ok := a.settings["gnomon_autostart"].(bool); ok && autostart {
				if err := a.daemonClient.TestConnection(); err == nil {
					a.logToConsole("[GNOMON] Auto-starting Gnomon indexer (user preference)...")
					a.StartGnomon()
				} else {
					a.logToConsole("[GNOMON] Auto-start skipped - daemon not connected")
				}
			}
		}()

		a.StartStatusBroadcast()
	})
}

// waitForNodeSync waits for the node to be synced before proceeding
// Returns true if node is synced, false if timeout
func (a *App) waitForNodeSync(maxWait time.Duration) bool {
	a.logToConsole("[EPOCH] Waiting for node sync before starting developer support...")

	startTime := time.Now()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	lastLoggedProgress := -1.0

	for time.Since(startTime) < maxWait {
		// Check if node is synced
		syncResult := a.GetSyncProgress()
		if isSynced, ok := syncResult["isSynced"].(bool); ok && isSynced {
			a.logToConsole("[EPOCH] Node is synced - starting developer support")
			return true
		}

		// Check if node is even running
		nodeStatus := a.GetNodeStatus()
		if isRunning, ok := nodeStatus["isRunning"].(bool); !ok || !isRunning {
			// Node not running yet, wait a bit longer
			<-ticker.C
			continue
		}

		// Log progress if available (every 10% to avoid spam)
		if progress, ok := syncResult["progress"].(float64); ok {
			currentProgress := int(progress/10) * 10 // Round down to nearest 10%
			if currentProgress != int(lastLoggedProgress) && currentProgress >= 0 {
				a.logToConsole(fmt.Sprintf("[EPOCH] Node sync progress: %.1f%% - waiting...", progress))
				lastLoggedProgress = float64(currentProgress)
			}
		}

		<-ticker.C
	}

	return false
}

// ================== XSWD Functions ==================

func (a *App) ConnectXSWD() map[string]interface{} {
	log.Println("[XSWD] Connecting...")

	if integrated, ok := a.settings["integrated_wallet"].(bool); ok && integrated {
		if a.xswdServer != nil && !a.xswdServer.IsRunning() {
			a.xswdServer.Start()
			return map[string]interface{}{
				"success":   true,
				"connected": true,
				"message":   "Internal XSWD server started",
			}
		}
		if a.xswdServer != nil && a.xswdServer.IsRunning() {
			return map[string]interface{}{
				"success":   true,
				"connected": true,
				"message":   "Internal XSWD server already running",
			}
		}
	}

	err := a.xswdClient.Connect()
	if err != nil {
		log.Printf("[ERR] XSWD connection failed: %v", err)
		return ErrorResponse(err)
	}

	log.Println("[OK] XSWD connected successfully")
	return map[string]interface{}{
		"success":   true,
		"connected": true,
		"message":   "Connected to XSWD on port 44326",
	}
}

func (a *App) DisconnectXSWD() map[string]interface{} {
	log.Println("[XSWD] Disconnecting...")

	a.xswdClient.Disconnect()

	if a.xswdServer != nil && a.xswdServer.IsRunning() {
		a.xswdServer.Stop()
		log.Println("[OK] Internal XSWD server stopped")
	}

	return map[string]interface{}{
		"success":   true,
		"connected": false,
		"message":   "Disconnected from XSWD",
	}
}

func (a *App) CallXSWD(methodJSON string) map[string]interface{} {
	var request XSWDRequest
	if err := json.Unmarshal([]byte(methodJSON), &request); err != nil {
		return xswdError("Invalid request format. Please check your input.", err.Error())
	}

	log.Printf("[XSWD] Calling method: %s", request.Method)

	integratedWallet := false
	if val, ok := a.settings["integrated_wallet"].(bool); ok {
		integratedWallet = val
	}

	// GetDaemon - always handle this first, regardless of XSWD server state
	// This is critical for dApps that need to connect directly to the daemon
	// Returns just host:port - dApps are expected to add the ws:// prefix and /ws path themselves
	// This matches Engram's behavior
	if request.Method == "GetDaemon" {
		endpoint := "127.0.0.1:10102"

		if a.simulatorManager != nil && a.simulatorManager.isInitialized {
			endpoint = "127.0.0.1:20000"
		} else {
			// Check if there's a custom daemon endpoint configured
			if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
				// Strip protocol prefix if present
				ep = strings.TrimPrefix(ep, "http://")
				ep = strings.TrimPrefix(ep, "https://")
				endpoint = ep
			}
		}
		return xswdSuccess(map[string]interface{}{
			"endpoint": endpoint,
		})
	}

	if a.xswdServer != nil && a.xswdServer.IsRunning() {
		switch {
		case strings.HasPrefix(request.Method, "DERO."):
			return a.routeDaemonCall(request.Method, request.Params)

		case isEpochMethod(request.Method):
			return a.routeEpochCall(request.Method, request.Params, "")

		case isTELAMethod(request.Method):
			return a.routeTELACall(request.Method, request.Params)

		case strings.HasPrefix(request.Method, "Gnomon."):
			return a.routeGnomonCall(request.Method, request.Params)
		}
	}

	if integratedWallet && (a.xswdClient == nil || !a.xswdClient.IsConnected()) {
		log.Printf("[WARN] Method %s called but external XSWD not connected (integrated wallet mode)", request.Method)
		return xswdError(fmt.Sprintf("Method %s not supported in integrated wallet mode", request.Method))
	}

	result, err := a.xswdClient.Call(request.Method, request.Params)
	if err != nil {
		log.Printf("[ERR] XSWD call failed: %v", err)
		return xswdError(FriendlyError(err), err.Error())
	}

	return xswdSuccess(result)
}

func (a *App) GetXSWDStatus() map[string]interface{} {
	// XSWD server status (HOLOGRAM's internal server for dApps)
	xswdServerRunning := false
	if a.xswdServer != nil && a.xswdServer.IsRunning() {
		xswdServerRunning = true
	}

	// Engram connection status (HOLOGRAM as client to external wallet)
	engramConnected := a.xswdClient.IsConnected()

	// Legacy: any XSWD activity
	connected := xswdServerRunning || engramConnected

	return map[string]interface{}{
		"connected":       connected,
		"serverRunning":   xswdServerRunning,
		"engramConnected": engramConnected,
		"endpoint":        "ws://127.0.0.1:44326/xswd",
	}
}

// GetActiveXSWDConnections returns all active XSWD connections
func (a *App) GetActiveXSWDConnections() map[string]interface{} {
	if a.xswdServer == nil {
		return map[string]interface{}{
			"success":     false,
			"error":       "XSWD server not initialized",
			"connections": []map[string]interface{}{},
		}
	}

	connections := a.xswdServer.GetActiveConnections()

	return map[string]interface{}{
		"success":     true,
		"connections": connections,
		"count":       len(connections),
	}
}

// RevokeXSWDConnection revokes permissions for a specific app/origin
func (a *App) RevokeXSWDConnection(origin string) map[string]interface{} {
	pm := GetPermissionManager()
	if pm == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Permission manager not initialized",
		}
	}

	err := pm.RevokeAllPermissions(origin)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Revoked permissions for %s", origin),
	}
}

// SubscribeToBlockEvents enables real-time block notifications
func (a *App) SubscribeToBlockEvents() map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "XSWD not connected",
		}
	}

	err := a.xswdClient.Subscribe("new_topoheight", func(event string, data interface{}) {
		wailsRuntime.EventsEmit(a.ctx, "explorer:newTopoheight", data)
		a.logToConsole(fmt.Sprintf("[PKG] New block: %v", data))
	})

	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"event":   "new_topoheight",
	}
}

// SubscribeToWalletEvents enables real-time wallet notifications
func (a *App) SubscribeToWalletEvents() map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "XSWD not connected",
		}
	}

	err := a.xswdClient.Subscribe("new_entry", func(event string, data interface{}) {
		if entry, ok := data.(map[string]interface{}); ok {
			wailsRuntime.EventsEmit(a.ctx, "wallet:newTransaction", entry)

			incoming := false
			if inc, ok := entry["incoming"].(bool); ok {
				incoming = inc
			}

			amount := uint64(0)
			if amt, ok := entry["amount"].(float64); ok {
				amount = uint64(amt)
			}

			if incoming {
				a.logToConsole(fmt.Sprintf("[BALANCE] Received: %s DERO", formatDEROAmount(amount)))
			} else {
				a.logToConsole(fmt.Sprintf("[TX] Sent: %s DERO", formatDEROAmount(amount)))
			}
		}
	})

	if err != nil {
		return ErrorResponse(err)
	}

	err = a.xswdClient.Subscribe("new_balance", func(event string, data interface{}) {
		wailsRuntime.EventsEmit(a.ctx, "wallet:balanceChanged", data)
	})

	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"events":  []string{"new_entry", "new_balance"},
	}
}

// UnsubscribeFromEvents removes all event subscriptions
func (a *App) UnsubscribeFromEvents() {
	if a.xswdClient != nil {
		a.xswdClient.ClearAllSubscriptions()
	}
}

// ================== Blockchain Functions ==================

func (a *App) FetchSCID(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[START] Starting TELA content fetch for: %s", scid))

	var version int64 = 0
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		version = a.gnomonClient.LatestInteractionHeight(scid)
	}

	if a.cache != nil {
		if html, ok := a.cache.GetHTMLIfVersion(scid, version); ok && html != "" {
			a.logToConsole("[FAST] Cache hit (versioned): serving content from local cache")
			ch := computeContentHash(html)
			return map[string]interface{}{
				"success": true,
				"scid":    scid,
				"content": html,
				"meta":    map[string]interface{}{"cache": true, "version": version, "hash": ch},
				"message": "Content served from cache",
			}
		}
	}

	// IMPORTANT: Do not serve unverified cache snapshots.
	// They can be stale and cause incorrect rendering after deploys/fixes.
	// If versioned cache misses, fetch fresh content from blockchain.

	content, err := a.FetchTELAContent(scid)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Fetch failed: %v", err))
		return ErrorResponseWithData(err, map[string]interface{}{"scid": scid})
	}

	if content == nil || content.HTML == "" {
		a.logToConsole("[ERR] No HTML content extracted")
		return map[string]interface{}{
			"success": false,
			"error":   "No HTML content found in TELA app",
			"scid":    scid,
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] TELA content ready for rendering (%d bytes HTML)", len(content.HTML)))

	if a.cache != nil && content.HTML != "" {
		ch := computeContentHash(content.HTML)
		durl := ""
		if dv, ok := content.Meta["durl"].(string); ok {
			durl = dv
		}
		if durl != "" {
			if err := a.cache.PutHTMLVersionHashWithDURL(scid, durl, version, ch, content.HTML); err != nil {
				a.logToConsole(fmt.Sprintf("[WARN]  Cache write (with dURL) failed: %v", err))
			}
			a.cacheDURLMapping(durl, scid)
		} else if err := a.cache.PutHTMLVersionHash(scid, version, ch, content.HTML); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN]  Cache write failed: %v", err))
		}
	}

	return map[string]interface{}{
		"success": true,
		"scid":    scid,
		"content": content.HTML,
		"meta":    withHashAndVersion(content.Meta, version, computeContentHash(content.HTML)),
		"message": func() string {
			if du, ok := content.Meta["durl"].(string); ok && isLibraryDURL(du) {
				return "Library info rendered"
			}
			return "Content fetched from blockchain successfully"
		}(),
	}
}

// FetchByDURL resolves a dURL → SCID and serves from cache
func (a *App) FetchByDURL(durl string) map[string]interface{} {
	name := durl
	cachedSCID, cached := a.getCachedDURLMapping(name)
	scid := ""

	// Prefer live Gnomon resolution first so stale cache mappings don't override
	// the latest on-chain contract for the same dURL.
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		if sc, ok := a.gnomonClient.ResolveDURL(name); ok {
			scid = sc
		} else if sc, ok2 := a.gnomonClient.ResolveName(name); ok2 {
			scid = sc
		} else if cached {
			scid = cachedSCID
			a.logToConsole(fmt.Sprintf("[Search] Using cached dURL mapping fallback for %s → %s", name, cachedSCID))
		} else {
			return map[string]interface{}{
				"success": false,
				"error":   "dURL not found",
			}
		}
	} else if cached {
		scid = cachedSCID
	} else {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon not running",
		}
	}

	if scid != "" {
		a.cacheDURLMapping(name, scid)
	}

	var version int64 = 0
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		version = a.gnomonClient.LatestInteractionHeight(scid)
	}
	if a.cache != nil {
		if html, ok := a.cache.GetHTMLIfVersionByDURL(name, version); ok && html != "" {
			ch := computeContentHash(html)
			return map[string]interface{}{
				"success": true,
				"scid":    scid,
				"content": html,
				"meta":    map[string]interface{}{"cache": true, "version": version, "hash": ch, "durl": name},
				"message": "Content served from cache",
			}
		}
	}

	res := a.FetchSCID(scid)
	if res != nil && res["success"] == true {
		if meta, ok := res["meta"].(map[string]interface{}); ok {
			meta["durl"] = name
			if cached {
				meta["durl_cache"] = true
			}
		}
	}
	return res
}

func computeContentHash(html string) string {
	sum := sha256.Sum256([]byte(html))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func withHashAndVersion(meta map[string]interface{}, version int64, hash string) map[string]interface{} {
	if meta == nil {
		meta = make(map[string]interface{})
	}
	meta["version"] = version
	meta["hash"] = hash
	return meta
}

func (a *App) GetNetworkInfo() map[string]interface{} {
	// Note: This is called frequently by status polling - avoid verbose logging
	result, err := a.daemonClient.GetInfo()
	if err != nil {
		// Only log errors, not routine calls
		a.logToConsole(fmt.Sprintf("[ERR] DERO.GetInfo failed: %v", err))
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"info":    result,
	}
}

// Direct Daemon passthroughs
func (a *App) DaemonGetBlockHeaderByHeight(height int) map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{"success": false, "error": "Not connected to any node. Please connect to a network first."}
	}
	params := map[string]interface{}{"height": height}
	res, err := a.daemonClient.Call("DERO.GetBlock", params)
	if err != nil {
		return ErrorResponse(err)
	}
	return map[string]interface{}{"success": true, "result": res}
}

func (a *App) DaemonGetTxPool() map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{"success": false, "error": "Not connected to any node. Please connect to a network first."}
	}
	res, err := a.daemonClient.Call("DERO.GetTxPool", nil)
	if err != nil {
		return ErrorResponse(err)
	}
	return map[string]interface{}{"success": true, "result": res}
}

func (a *App) DaemonGetSC(scid string) map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{"success": false, "error": "Not connected to any node. Please connect to a network first."}
	}
	params := map[string]interface{}{
		"scid":      scid,
		"code":      true,
		"variables": true,
	}
	res, err := a.daemonClient.Call("DERO.GetSC", params)
	if err != nil {
		return ErrorResponse(err)
	}
	res = normalizeDEROGetSCResult(res)
	return map[string]interface{}{"success": true, "result": res}
}

// GetSCVariable queries specific keys from a smart contract
// Used for fetching individual variables like avatar data without fetching all contract data
func (a *App) GetSCVariable(scid string, keys []string) map[string]interface{} {
	if a.daemonClient == nil {
		return map[string]interface{}{"success": false, "error": "Not connected to any node. Please connect to a network first."}
	}
	if scid == "" {
		return map[string]interface{}{"success": false, "error": "SCID is required"}
	}
	if len(keys) == 0 {
		return map[string]interface{}{"success": false, "error": "At least one key is required"}
	}

	params := map[string]interface{}{
		"scid":       scid,
		"code":       false,
		"variables":  false,
		"keysstring": keys,
	}

	res, err := a.daemonClient.Call("DERO.GetSC", params)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] GetSCVariable failed for %s: %v", scid[:16], err))
		return ErrorResponse(err)
	}

	// Extract valuesstring from result
	if resMap, ok := res.(map[string]interface{}); ok {
		return map[string]interface{}{
			"success":      true,
			"scid":         scid,
			"valuesstring": resMap["valuesstring"],
		}
	}

	return map[string]interface{}{"success": true, "result": res}
}

// ================== NRS & Explorer Features ==================

func (a *App) ResolveDeroName(name string) map[string]interface{} {
	if a.nrsCache != nil {
		if addr, found := a.nrsCache.GetAddressForName(name); found {
			return map[string]interface{}{
				"success": true,
				"name":    name,
				"address": addr,
				"cached":  true,
			}
		}
	}

	params := map[string]interface{}{
		"name":       name,
		"topoheight": int64(0),
	}

	var result interface{}
	var err error

	if a.xswdClient.IsConnected() {
		result, err = a.xswdClient.Call("DERO.NameToAddress", params)
	} else {
		result, err = a.daemonClient.Call("DERO.NameToAddress", params)
	}

	if err != nil {
		return ErrorResponse(err)
	}

	if resultMap, ok := result.(map[string]interface{}); ok {
		addr, _ := resultMap["address"].(string)

		if addr != "" && a.nrsCache != nil {
			a.nrsCache.CacheNameAddress(name, addr)
		}

		return map[string]interface{}{
			"success": true,
			"name":    name,
			"address": addr,
			"result":  result,
			"cached":  false,
		}
	}

	return map[string]interface{}{
		"success": true,
		"name":    name,
		"result":  result,
	}
}

func (a *App) GetNameForAddress(address string) map[string]interface{} {
	if a.nrsCache == nil {
		return map[string]interface{}{
			"found":   false,
			"address": address,
			"error":   "NRS cache not initialized",
		}
	}

	name, found := a.nrsCache.GetNameForAddress(address)
	return map[string]interface{}{
		"found":   found,
		"name":    name,
		"address": address,
	}
}

func (a *App) GetNRSCacheStats() map[string]interface{} {
	if a.nrsCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "NRS cache not initialized",
		}
	}

	stats := a.nrsCache.GetCacheStats()
	stats["success"] = true
	return stats
}

func (a *App) GetAllCachedNames() map[string]interface{} {
	if a.nrsCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "NRS cache not initialized",
		}
	}

	return map[string]interface{}{
		"success": true,
		"names":   a.nrsCache.GetAllCachedNames(),
	}
}

// ================== Token & Wallet Functions ==================

func (a *App) GetTokenPortfolio() map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
			"tokens":  []map[string]interface{}{},
		}
	}

	result, err := a.xswdClient.Call("GetTrackedAssets", map[string]interface{}{
		"only_positive_balances": true,
		"skip_balance_check":     false,
	})

	if err != nil {
		return ErrorResponseWithData(err, map[string]interface{}{"tokens": []map[string]interface{}{}})
	}

	tokens := make([]map[string]interface{}, 0)

	if resultMap, ok := result.(map[string]interface{}); ok {
		if balances, ok := resultMap["balances"].(map[string]interface{}); ok {
			for scid, balance := range balances {
				token := map[string]interface{}{
					"scid":    scid,
					"balance": balance,
				}

				if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
					vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)
					for _, v := range vars {
						key := fmt.Sprintf("%v", v.Key)
						switch key {
						case "nameHdr":
							token["name"] = decodeHexString(fmt.Sprintf("%v", v.Value))
						case "iconURLHdr":
							token["icon"] = decodeHexString(fmt.Sprintf("%v", v.Value))
						case "symbolHdr":
							token["symbol"] = decodeHexString(fmt.Sprintf("%v", v.Value))
						case "descriptionHdr":
							token["description"] = decodeHexString(fmt.Sprintf("%v", v.Value))
						}
					}
				}

				if scid == deroSCID {
					token["name"] = "DERO"
					token["symbol"] = "DERO"
					token["native"] = true
				}

				tokens = append(tokens, token)
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"tokens":  tokens,
		"count":   len(tokens),
	}
}

func (a *App) CreatePaymentRequest(amount uint64, comment string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[PayReq] CreatePaymentRequest entry: amount=%d comment_len=%d", amount, len(comment)))

	// Prefer the in-app wallet (same path the Receive view uses). The XSWD
	// route only fires when HOLOGRAM is acting as a host for an external
	// wallet (Engram, G45, etc.) and the integrated wallet is unavailable.
	walletManager.RLock()
	hasLocalWallet := walletManager.isOpen && walletManager.wallet != nil
	walletManager.RUnlock()

	if hasLocalWallet {
		local := a.GetIntegratedAddress(0, comment, amount)
		if ok, _ := local["success"].(bool); !ok {
			errMsg := "Failed to generate integrated address"
			if msg, _ := local["error"].(string); msg != "" {
				errMsg = msg
			}
			a.logToConsole(fmt.Sprintf("[PayReq] ERROR: local wallet path failed: %s", errMsg))
			return map[string]interface{}{
				"success": false,
				"error":   errMsg,
			}
		}
		integratedAddr, _ := local["integratedAddress"].(string)
		if integratedAddr == "" {
			a.logToConsole("[PayReq] ERROR: local wallet returned empty integrated address")
			return map[string]interface{}{
				"success": false,
				"error":   "Wallet returned no integrated address",
			}
		}
		a.logToConsole(fmt.Sprintf("[PayReq] OK (local): %s...", integratedAddr[:16]))
		return map[string]interface{}{
			"success":            true,
			"integrated_address": integratedAddr,
			"amount":             amount,
			"amount_formatted":   formatDEROAmount(amount),
			"comment":            comment,
		}
	}

	if !a.xswdClient.IsConnected() {
		a.logToConsole("[PayReq] ERROR: no local wallet and XSWD not connected")
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet available (open the integrated wallet or connect via XSWD)",
		}
	}

	payloadRPC := []map[string]interface{}{}

	if comment != "" {
		payloadRPC = append(payloadRPC, map[string]interface{}{
			"name":     "C",
			"datatype": "S",
			"value":    comment,
		})
	}

	if amount > 0 {
		payloadRPC = append(payloadRPC, map[string]interface{}{
			"name":     "A",
			"datatype": "U",
			"value":    amount,
		})
	}

	result, err := a.xswdClient.Call("MakeIntegratedAddress", map[string]interface{}{
		"payload_rpc": payloadRPC,
	})

	if err != nil {
		a.logToConsole(fmt.Sprintf("[PayReq] ERROR: XSWD MakeIntegratedAddress failed: %v", err))
		return ErrorResponse(err)
	}

	integratedAddr := ""
	if resultMap, ok := result.(map[string]interface{}); ok {
		if addr, ok := resultMap["integrated_address"].(string); ok {
			integratedAddr = addr
		}
	}

	if integratedAddr == "" {
		a.logToConsole(fmt.Sprintf("[PayReq] ERROR: response had no integrated_address field; raw=%v", result))
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet returned no integrated address",
		}
	}

	a.logToConsole(fmt.Sprintf("[PayReq] OK (xswd): %s...", integratedAddr[:16]))

	return map[string]interface{}{
		"success":            true,
		"integrated_address": integratedAddr,
		"amount":             amount,
		"amount_formatted":   formatDEROAmount(amount),
		"comment":            comment,
		"result":             result,
	}
}

func (a *App) DecodeIntegratedAddress(integratedAddr string) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
		}
	}

	result, err := a.xswdClient.Call("SplitIntegratedAddress", map[string]interface{}{
		"integrated_address": integratedAddr,
	})

	if err != nil {
		return ErrorResponse(err)
	}

	decoded := map[string]interface{}{}
	if resultMap, ok := result.(map[string]interface{}); ok {
		if addr, ok := resultMap["address"].(string); ok {
			decoded["address"] = addr
		}
		if payload, ok := resultMap["payload_rpc"].([]interface{}); ok {
			payloadData := []map[string]interface{}{}
			for _, item := range payload {
				if itemMap, ok := item.(map[string]interface{}); ok {
					payloadData = append(payloadData, itemMap)
				}
			}
			decoded["payload"] = payloadData
		}
	}

	return map[string]interface{}{
		"success": true,
		"decoded": decoded,
		"result":  result,
	}
}

// ================== Smart Contract Functions ==================

func (a *App) EstimateSCGas(scid string, entrypoint string, args []map[string]interface{}) map[string]interface{} {
	scRPC := []map[string]interface{}{
		{"name": "SC_ACTION", "datatype": "U", "value": uint64(0)},
		{"name": "SC_ID", "datatype": "H", "value": scid},
		{"name": "entrypoint", "datatype": "S", "value": entrypoint},
	}

	for _, arg := range args {
		scRPC = append(scRPC, arg)
	}

	params := map[string]interface{}{
		"sc_rpc": scRPC,
	}

	var result interface{}
	var err error

	if a.xswdClient.IsConnected() {
		result, err = a.xswdClient.Call("DERO.GetGasEstimate", params)
	} else {
		result, err = a.daemonClient.Call("DERO.GetGasEstimate", params)
	}

	if err != nil {
		return ErrorResponse(err)
	}

	gasCompute := uint64(0)
	gasStorage := uint64(0)
	if resultMap, ok := result.(map[string]interface{}); ok {
		if gc, ok := resultMap["gascompute"].(float64); ok {
			gasCompute = uint64(gc)
		}
		if gs, ok := resultMap["gasstorage"].(float64); ok {
			gasStorage = uint64(gs)
		}
	}

	totalGas := gasCompute + gasStorage

	return map[string]interface{}{
		"success":    true,
		"gascompute": gasCompute,
		"gasstorage": gasStorage,
		"total":      totalGas,
		"cost_dero":  formatDEROAmount(totalGas),
		"result":     result,
	}
}

func (a *App) InvokeSCFromExplorer(scid string, entrypoint string, args []map[string]interface{}, deposit uint64) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
		}
	}

	scRPC := []map[string]interface{}{
		{"name": "entrypoint", "datatype": "S", "value": entrypoint},
	}

	for _, arg := range args {
		scRPC = append(scRPC, arg)
	}

	params := map[string]interface{}{
		"scid":   scid,
		"sc_rpc": scRPC,
	}

	if deposit > 0 {
		params["sc_dero_deposit"] = deposit
	}

	a.logToConsole(fmt.Sprintf("[NOTE] Invoking SC %s.%s() via XSWD...", scid[:12], entrypoint))

	result, err := a.xswdClient.Call("scinvoke", params)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SC invoke failed: %v", err))
		return ErrorResponse(err)
	}

	txid := ""
	if resultMap, ok := result.(map[string]interface{}); ok {
		if tx, ok := resultMap["txid"].(string); ok {
			txid = tx
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] SC invoked! TXID: %s", txid))

	return map[string]interface{}{
		"success": true,
		"txid":    txid,
		"result":  result,
	}
}

// ================== TELA Rating Functions ==================

func (a *App) RateTELAApp(scid string, rating int) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
		}
	}

	if rating < 0 || rating > 99 {
		return map[string]interface{}{
			"success": false,
			"error":   "Rating must be between 0 and 99",
		}
	}

	args := []map[string]interface{}{
		{"name": "rating", "datatype": "U", "value": uint64(rating)},
	}

	return a.InvokeSCFromExplorer(scid, "Rate", args, 0)
}

func (a *App) LikeTELAApp(scid string) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
		}
	}

	return a.InvokeSCFromExplorer(scid, "Like", []map[string]interface{}{}, 0)
}

func (a *App) DislikeTELAApp(scid string) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success": false,
			"error":   "Wallet not connected via XSWD",
		}
	}

	return a.InvokeSCFromExplorer(scid, "Dislike", []map[string]interface{}{}, 0)
}

// ================== EPOCH App Support ==================

func (a *App) CheckAppSupportsEpoch(scid string) map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success":        false,
			"supports_epoch": false,
			"error":          "Gnomon is not running",
		}
	}

	supportsEpoch := a.gnomonClient.CheckAppSupportsEpoch(scid)

	return map[string]interface{}{
		"success":        true,
		"scid":           scid,
		"supports_epoch": supportsEpoch,
	}
}

func (a *App) GetEpochSupportingApps() map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
			"apps":    []map[string]interface{}{},
		}
	}

	allApps := a.gnomonClient.GetTELAAppsWithEpochInfo()
	epochApps := make([]map[string]interface{}, 0)

	for _, app := range allApps {
		if supportsEpoch, ok := app["supports_epoch"].(bool); ok && supportsEpoch {
			epochApps = append(epochApps, app)
		}
	}

	return map[string]interface{}{
		"success": true,
		"apps":    epochApps,
		"count":   len(epochApps),
	}
}

// ================== Balance & Transfer Functions ==================

func (a *App) GetBalanceAtHeight(address string, topoheight int64, scid string) map[string]interface{} {
	params := map[string]interface{}{
		"address":    address,
		"topoheight": topoheight,
	}

	if scid != "" && scid != deroSCID {
		params["scid"] = scid
	}

	var result interface{}
	var err error

	if a.xswdClient.IsConnected() {
		result, err = a.xswdClient.Call("DERO.GetEncryptedBalance", params)
	} else {
		result, err = a.daemonClient.Call("DERO.GetEncryptedBalance", params)
	}

	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":    true,
		"address":    address,
		"topoheight": topoheight,
		"result":     result,
	}
}

func (a *App) GetPersonalTransfers(filters map[string]interface{}) map[string]interface{} {
	if !a.xswdClient.IsConnected() {
		return map[string]interface{}{
			"success":   false,
			"error":     "Wallet not connected via XSWD",
			"transfers": []interface{}{},
		}
	}

	params := map[string]interface{}{}

	if scid, ok := filters["scid"].(string); ok && scid != "" {
		params["scid"] = scid
	}
	if coinbase, ok := filters["coinbase"].(bool); ok {
		params["coinbase"] = coinbase
	}
	if incoming, ok := filters["in"].(bool); ok {
		params["in"] = incoming
	}
	if outgoing, ok := filters["out"].(bool); ok {
		params["out"] = outgoing
	}
	if minHeight, ok := filters["min_height"].(float64); ok {
		params["min_height"] = int64(minHeight)
	}
	if maxHeight, ok := filters["max_height"].(float64); ok {
		params["max_height"] = int64(maxHeight)
	}

	result, err := a.xswdClient.Call("GetTransfers", params)
	if err != nil {
		return ErrorResponseWithData(err, map[string]interface{}{"transfers": []interface{}{}})
	}

	return map[string]interface{}{
		"success":   true,
		"transfers": result,
	}
}

// ================== XSWD Permission Management ==================

func (a *App) GetConnectedApps() []map[string]interface{} {
	pm := GetPermissionManager()
	if pm == nil {
		return []map[string]interface{}{}
	}

	apps := pm.GetAllApps()
	result := make([]map[string]interface{}, 0, len(apps))

	for _, app := range apps {
		perms := make([]string, 0, len(app.Permissions))
		for p, granted := range app.Permissions {
			if granted {
				perms = append(perms, string(p))
			}
		}

		result = append(result, map[string]interface{}{
			"origin":       app.Origin,
			"name":         app.Name,
			"description":  app.Description,
			"permissions":  perms,
			"grantedAt":    app.GrantedAt,
			"lastAccessed": app.LastAccessed,
			"isActive":     pm.IsClientActive(app.Origin),
		})
	}

	return result
}

func (a *App) RevokeAppPermissions(origin string) map[string]interface{} {
	pm := GetPermissionManager()
	if pm == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Permission manager not initialized",
		}
	}

	if err := pm.RevokeAllPermissions(origin); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[WALLET] Revoked all permissions for: %s", origin))

	return map[string]interface{}{
		"success": true,
	}
}

func (a *App) RevokeAppPermission(origin string, permission string) map[string]interface{} {
	pm := GetPermissionManager()
	if pm == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Permission manager not initialized",
		}
	}

	if err := pm.RevokePermission(origin, XSWDPermission(permission)); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[WALLET] Revoked permission %s for: %s", permission, origin))

	return map[string]interface{}{
		"success": true,
	}
}

func (a *App) GetPermissionTypes() []map[string]interface{} {
	perms := AllPermissions()
	result := make([]map[string]interface{}, 0, len(perms))

	for _, p := range perms {
		info := GetPermissionInfo(p)
		result = append(result, map[string]interface{}{
			"id":          string(info.ID),
			"name":        info.Name,
			"description": info.Description,
			"alwaysAsk":   info.AlwaysAsk,
		})
	}

	return result
}

func (a *App) GrantAppPermission(origin string, name string, permission string) map[string]interface{} {
	pm := GetPermissionManager()
	if pm == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Permission manager not initialized",
		}
	}

	if err := pm.GrantPermissions(origin, name, "", []XSWDPermission{XSWDPermission(permission)}); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[WALLET] Granted permission %s for: %s", permission, origin))

	return map[string]interface{}{
		"success": true,
	}
}
