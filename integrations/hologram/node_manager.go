package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// NodeManager handles embedded derod subprocess lifecycle

// NetworkMode represents the blockchain network type
type NetworkMode string

const (
	NetworkMainnet   NetworkMode = "mainnet"
	NetworkSimulator NetworkMode = "simulator"
)

// NetworkConfig holds network-specific configuration
type NetworkConfig struct {
	RPCPort     int
	P2PPort     int
	GetWorkPort int
	DataDir     string
	Flags       []string
}

// GetNetworkConfig returns port and flag configuration for each network
func GetNetworkConfig(mode NetworkMode) NetworkConfig {
	switch mode {
	case NetworkSimulator:
		return NetworkConfig{
			RPCPort:     20000,
			P2PPort:     20001, // Not used by simulator, but kept for consistency
			GetWorkPort: 20002, // Not used by simulator, but kept for consistency
			DataDir:     "simulator",
			Flags:       []string{}, // Simulator is a separate binary, no flags needed
		}
	default: // mainnet
		return NetworkConfig{
			RPCPort:     10102,
			P2PPort:     10101,
			GetWorkPort: 10100,
			DataDir:     "mainnet",
			Flags:       []string{},
		}
	}
}

type NodeManager struct {
	sync.RWMutex
	process       *exec.Cmd
	dataDir       string
	rpcPort       int
	p2pPort       int
	getworkPort   int // Port for GetWork mining server (default: 10100)
	isRunning     bool
	isSyncing     bool
	syncHeight    int64
	chainHeight   int64
	peerCount     int
	stdout        io.ReadCloser
	stderr        io.ReadCloser
	logBuffer     []string
	lastSyncLine  string
	syncStartTime time.Time

	// Network mode (mainnet, simulator)
	networkMode NetworkMode

	// Advanced node options
	fastSyncEnabled  bool   // Use --fastsync for quick initial sync
	pruneHistory     int    // Use --prune-history=N (0 = disabled)
	syncNodeEndpoint string // Use --sync-node=ENDPOINT to sync from a trusted node
}

// Regex patterns for parsing derod output
var (
	heightRegex     = regexp.MustCompile(`Height:\s*(\d+)`)
	topoHeightRegex = regexp.MustCompile(`TopoHeight:\s*(\d+)`)
	syncingRegex    = regexp.MustCompile(`Syncing\s+(\d+)\s*/\s*(\d+)`)
	peerRegex       = regexp.MustCompile(`Peers:\s*(\d+)`)
	syncedRegex     = regexp.MustCompile(`(?i)(fully synced|sync complete|100%)`)
	blockSyncRegex  = regexp.MustCompile(`Block\s+(\d+)\s+synced`)
)

// Global node manager instance
var nodeManager = &NodeManager{
	rpcPort:     10102,
	p2pPort:     10101,
	getworkPort: 10100, // Default GetWork port for mining
	logBuffer:   make([]string, 0),
	networkMode: NetworkMainnet, // Default to mainnet
}

// DetectRunningNode attempts to connect to an existing DERO node
// Returns node info if found, or an indication that no node is running
func (a *App) DetectRunningNode() map[string]interface{} {
	a.logToConsole("[...] Detecting running DERO node...")

	// Endpoints to check in order (base URL without /json_rpc - client adds it)
	endpoints := []string{
		"http://127.0.0.1:10102", // Default local RPC
		"http://localhost:10102", // Alternative localhost
	}

	// Also check any configured endpoint
	if a.settings != nil {
		if endpoint, ok := a.settings["daemonEndpoint"].(string); ok && endpoint != "" {
			// Prepend configured endpoint to check it first
			// Strip /json_rpc if present since client adds it
			cleanEndpoint := strings.TrimSuffix(endpoint, "/json_rpc")
			endpoints = append([]string{cleanEndpoint}, endpoints...)
		}
	}

	for _, endpoint := range endpoints {
		a.logToConsole(fmt.Sprintf("  Trying %s...", endpoint))

		// Create a temporary client with SHORT timeout for detection
		client := NewDaemonClientWithTimeout(endpoint, 3*time.Second)

		info, err := client.GetInfo()
		if err != nil {
			a.logToConsole(fmt.Sprintf("  [ERR] %s: %v", endpoint, err))
			continue // Try next endpoint
		}

		// Parse the response
		if info != nil {
			height := int64(0)
			topoHeight := int64(0)
			version := ""
			network := ""

			if h, ok := info["height"].(float64); ok {
				height = int64(h)
			}
			if th, ok := info["topoheight"].(float64); ok {
				topoHeight = int64(th)
			}
			if v, ok := info["version"].(string); ok {
				version = v
			}
			if n, ok := info["network"].(string); ok {
				network = n
			}

			a.logToConsole(fmt.Sprintf("[OK] Found running node at %s (v%s, %s, height: %d)", endpoint, version, network, height))

			return map[string]interface{}{
				"success":    true,
				"found":      true,
				"endpoint":   endpoint,
				"height":     height,
				"topoHeight": topoHeight,
				"version":    version,
				"network":    network,
			}
		}
	}

	a.logToConsole("[INFO] No running DERO node detected")

	return map[string]interface{}{
		"success":          true,
		"found":            false,
		"checkedEndpoints": endpoints,
	}
}

// TestAndConnectEndpoint tests a custom endpoint and connects if successful
// This allows power users to connect to LAN nodes without running an embedded node
func (a *App) TestAndConnectEndpoint(endpoint string) map[string]interface{} {
	if endpoint == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Endpoint cannot be empty",
		}
	}

	// Normalize endpoint - strip trailing slash and /json_rpc
	endpoint = strings.TrimSuffix(endpoint, "/")
	endpoint = strings.TrimSuffix(endpoint, "/json_rpc")

	a.logToConsole(fmt.Sprintf("[...] Testing connection to %s...", endpoint))

	// Create a temporary client with reasonable timeout
	client := NewDaemonClientWithTimeout(endpoint, 5*time.Second)

	info, err := client.GetInfo()
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Connection failed: %v", err))
		return map[string]interface{}{
			"success":  false,
			"error":    fmt.Sprintf("Connection failed: %v", err),
			"endpoint": endpoint,
		}
	}

	if info == nil {
		a.logToConsole("[ERR] No response from node")
		return map[string]interface{}{
			"success":  false,
			"error":    "No response from node",
			"endpoint": endpoint,
		}
	}

	// Parse node info
	height := int64(0)
	topoHeight := int64(0)
	version := ""
	network := ""

	if h, ok := info["height"].(float64); ok {
		height = int64(h)
	}
	if th, ok := info["topoheight"].(float64); ok {
		topoHeight = int64(th)
	}
	if v, ok := info["version"].(string); ok {
		version = v
	}
	if n, ok := info["network"].(string); ok {
		network = n
	}

	a.logToConsole(fmt.Sprintf("[OK] Connected to %s (v%s, %s, height: %d)", endpoint, version, network, height))

	// Save the endpoint to settings and persist to disk immediately
	a.settings["daemon_endpoint"] = endpoint
	a.saveSettings()
	a.logToConsole(fmt.Sprintf("[OK] Saved endpoint: %s", endpoint))

	// Update the daemon client to use this endpoint
	if a.daemonClient != nil {
		a.daemonClient.SetEndpoint(endpoint)
		a.logToConsole("[OK] Daemon client updated to use new endpoint")
	}

	return map[string]interface{}{
		"success":    true,
		"connected":  true,
		"endpoint":   endpoint,
		"height":     height,
		"topoHeight": topoHeight,
		"version":    version,
		"network":    network,
		"message":    fmt.Sprintf("Connected to %s node (v%s) at height %d", network, version, height),
	}
}

// DetectExistingBlockchain scans common locations for existing blockchain data
func (a *App) DetectExistingBlockchain() map[string]interface{} {
	a.logToConsole("[...] Scanning for existing blockchain data...")

	// Common locations to check
	homeDir, _ := os.UserHomeDir()
	locations := []string{
		filepath.Join(homeDir, ".dero", "mainnet"),
		filepath.Join(homeDir, "dero", "mainnet"),
		filepath.Join(".", "mainnet"),
	}

	foundLocations := []map[string]interface{}{}

	for _, loc := range locations {
		if info, err := os.Stat(loc); err == nil && info.IsDir() {
			// Check for blockchain data files
			dbPath := filepath.Join(loc, "balances")
			if _, err := os.Stat(dbPath); err == nil {
				// Just check existence - don't walk entire blockchain (too slow for large chains)
				// Size can be calculated later if needed
				foundLocations = append(foundLocations, map[string]interface{}{
					"path":    loc,
					"size":    int64(0), // Size calculation skipped for speed
					"sizeGB":  float64(0),
					"network": "mainnet",
					"exists":  true,
				})
				a.logToConsole(fmt.Sprintf("  OK Found blockchain at %s", loc))
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d blockchain location(s)", len(foundLocations)))

	return map[string]interface{}{
		"success":   true,
		"locations": foundLocations,
		"count":     len(foundLocations),
	}
}

// GetBinaryPath returns the path to the derod binary for the current platform
// Search order:
// 1. Co-located binary (built from source via Makefile) - build/bin/derod-*
// 2. Downloaded derod at ~/.dero/hologram/derod/{version}/derod
// 3. Bundled binaries directory (for manual installs)
// 4. System PATH
// 5. Common locations (~/.dero/, /usr/local/bin/)
func GetBinaryPath() string {
	// DERO binaries have platform-specific names
	var binaryNames []string
	switch runtime.GOOS {
	case "darwin":
		binaryNames = []string{"derod-darwin", "derod"}
	case "windows":
		binaryNames = []string{"derod-windows-amd64.exe", "derod.exe"}
	case "linux":
		switch runtime.GOARCH {
		case "arm64":
			binaryNames = []string{"derod-linux-arm64", "derod"}
		case "arm":
			binaryNames = []string{"derod-linux-arm", "derod"}
		default:
			binaryNames = []string{"derod-linux-amd64", "derod"}
		}
	default:
		binaryNames = []string{"derod"}
	}

	// 0. Check co-located binary (built from source via Makefile)
	// This is the preferred method - binaries built alongside HOLOGRAM
	execPath, err := os.Executable()
	if err == nil {
		execDir := filepath.Dir(execPath)
		for _, binaryName := range binaryNames {
			colocatedPath := filepath.Join(execDir, binaryName)
			if _, err := os.Stat(colocatedPath); err == nil {
				return colocatedPath
			}
		}
		// Also check build/bin relative to working directory (for dev mode)
		for _, binaryName := range binaryNames {
			buildPath := filepath.Join("build", "bin", binaryName)
			if _, err := os.Stat(buildPath); err == nil {
				absPath, _ := filepath.Abs(buildPath)
				return absPath
			}
		}
	}

	homeDir, _ := os.UserHomeDir()

	// 1. Check downloaded derod location (~/.dero/hologram/derod/)
	downloadedBase := filepath.Join(homeDir, ".dero", "hologram", "derod")
	if entries, err := os.ReadDir(downloadedBase); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				versionDir := filepath.Join(downloadedBase, entry.Name())
				// Try each possible binary name
				for _, binaryName := range binaryNames {
					path := findBinaryInDir(versionDir, binaryName)
					if path != "" {
						return path
					}
				}
			}
		}
	}

	// 2. Check bundled binaries directory
	platformDir := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	for _, binaryName := range binaryNames {
		bundledPath := filepath.Join(".", "binaries", platformDir, binaryName)
		if _, err := os.Stat(bundledPath); err == nil {
			return bundledPath
		}
	}

	// 3. Fallback to PATH
	for _, binaryName := range binaryNames {
		if path, err := exec.LookPath(binaryName); err == nil {
			return path
		}
	}

	// 4. Check common locations
	for _, binaryName := range binaryNames {
		commonPaths := []string{
			filepath.Join(homeDir, ".dero", binaryName),
			filepath.Join(homeDir, "dero", binaryName),
			"/usr/local/bin/" + binaryName,
			"/usr/bin/" + binaryName,
		}
		for _, path := range commonPaths {
			if _, err := os.Stat(path); err == nil {
				return path
			}
		}
	}

	return ""
}

// CheckDerodStatus returns the current status of the derod binary.
// Uses GetBinaryPath() to find the binary via all standard search paths
// (co-located from Makefile build, system PATH, common locations).
func (a *App) CheckDerodStatus() map[string]interface{} {
	path := GetBinaryPath()
	installed := path != ""

	return map[string]interface{}{
		"installed": installed,
		"path":      path,
	}
}

// getSimulatorBinaryName returns the platform-specific simulator binary name
func getSimulatorBinaryName() string {
	switch runtime.GOOS {
	case "darwin":
		return "simulator-darwin"
	case "windows":
		return fmt.Sprintf("simulator-windows-%s.exe", runtime.GOARCH)
	case "linux":
		return fmt.Sprintf("simulator-linux-%s", runtime.GOARCH)
	default:
		return "simulator"
	}
}

// GetSimulatorBinaryPath returns the path to the simulator binary for the current platform
// Search order:
// 1. Co-located binary (built from source via Makefile) - build/bin/simulator-*
// 2. Downloaded derod at ~/.dero/hologram/derod/{version}/simulator-* (platform-specific)
// 3. Bundled binaries directory
// 4. System PATH
// 5. Common locations
func GetSimulatorBinaryPath() string {
	// Simulator binaries have platform-specific names
	var binaryNames []string
	switch runtime.GOOS {
	case "darwin":
		binaryNames = []string{"simulator-darwin", "simulator"}
	case "windows":
		binaryNames = []string{"simulator-windows-amd64.exe", "simulator.exe"}
	case "linux":
		switch runtime.GOARCH {
		case "arm64":
			binaryNames = []string{"simulator-linux-arm64", "simulator"}
		case "arm":
			binaryNames = []string{"simulator-linux-arm", "simulator"}
		default:
			binaryNames = []string{"simulator-linux-amd64", "simulator"}
		}
	default:
		binaryNames = []string{"simulator"}
	}

	// 0. Check co-located binary (built from source via Makefile)
	// This is the preferred method - binaries built alongside HOLOGRAM
	execPath, err := os.Executable()
	if err == nil {
		execDir := filepath.Dir(execPath)
		for _, binaryName := range binaryNames {
			colocatedPath := filepath.Join(execDir, binaryName)
			if _, err := os.Stat(colocatedPath); err == nil {
				return colocatedPath
			}
		}
		// Also check build/bin relative to working directory (for dev mode)
		for _, binaryName := range binaryNames {
			buildPath := filepath.Join("build", "bin", binaryName)
			if _, err := os.Stat(buildPath); err == nil {
				absPath, _ := filepath.Abs(buildPath)
				return absPath
			}
		}
	}

	homeDir, _ := os.UserHomeDir()

	// 1. Check downloaded derod location (~/.dero/hologram/derod/)
	downloadedBase := filepath.Join(homeDir, ".dero", "hologram", "derod")
	if entries, err := os.ReadDir(downloadedBase); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				versionDir := filepath.Join(downloadedBase, entry.Name())
				// Try each possible binary name
				for _, binaryName := range binaryNames {
					path := findBinaryInDir(versionDir, binaryName)
					if path != "" {
						return path
					}
				}
			}
		}
	}

	// 2. Check bundled binaries directory
	platformDir := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	for _, binaryName := range binaryNames {
		bundledPath := filepath.Join(".", "binaries", platformDir, binaryName)
		if _, err := os.Stat(bundledPath); err == nil {
			return bundledPath
		}
	}

	// 3. Fallback to PATH
	for _, binaryName := range binaryNames {
		if path, err := exec.LookPath(binaryName); err == nil {
			return path
		}
	}

	// 4. Check common locations
	for _, binaryName := range binaryNames {
		commonPaths := []string{
			filepath.Join(homeDir, ".dero", binaryName),
			filepath.Join(homeDir, "dero", binaryName),
			"/usr/local/bin/" + binaryName,
			"/usr/bin/" + binaryName,
		}
		for _, path := range commonPaths {
			if _, err := os.Stat(path); err == nil {
				return path
			}
		}
	}

	return ""
}

// findBinaryInDir searches recursively for a binary in a directory
func findBinaryInDir(dir, binaryName string) string {
	var found string
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.EqualFold(info.Name(), binaryName) {
			found = path
			return filepath.SkipDir
		}
		return nil
	})
	return found
}

// StartNode starts the embedded derod node (defaults to current network mode)
func (a *App) StartNode(dataDir string) map[string]interface{} {
	return a.StartNodeWithNetwork(dataDir, string(nodeManager.networkMode))
}

// StartNodeWithNetwork starts the embedded derod node with a specific network mode
func (a *App) StartNodeWithNetwork(dataDir string, network string) map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if nodeManager.isRunning {
		return map[string]interface{}{"success": false, "error": "Node is already running"}
	}

	// Set network mode
	networkMode := NetworkMode(network)
	if networkMode != NetworkMainnet && networkMode != NetworkSimulator {
		networkMode = NetworkMainnet
	}
	nodeManager.networkMode = networkMode

	// Get network-specific configuration
	netConfig := GetNetworkConfig(networkMode)
	nodeManager.rpcPort = netConfig.RPCPort
	nodeManager.p2pPort = netConfig.P2PPort
	nodeManager.getworkPort = netConfig.GetWorkPort

	// Check for external node
	expectedEndpoint := fmt.Sprintf("http://127.0.0.1:%d", nodeManager.rpcPort)
	extResult := a.checkForExternalNode(expectedEndpoint, networkMode)

	if extResult.Found {
		// Simulator mode must be launched from a clean, HOLOGRAM-controlled daemon.
		// Reconnecting to an already-running simulator is handled elsewhere on app restart.
		// Silently attaching here can bind us to a stale foreign process on :20000 that
		// later disappears, causing "pseudo success" deploys followed by connection refused.
		if networkMode == NetworkSimulator {
			a.logToConsole(fmt.Sprintf("[WARN] Existing simulator daemon detected at %s", expectedEndpoint))
			a.logToConsole("[WARN] Refusing to attach to external simulator during activation")
			return map[string]interface{}{
				"success": false,
				"error":   "A simulator daemon is already running on port 20000. Reset or stop the stale simulator, then try again.",
				"technicalError": fmt.Sprintf("external simulator detected at %s (v%s, height: %d)",
					expectedEndpoint, extResult.Version, extResult.Height),
				"staleSimulator": true,
			}
		}

		if extResult.IsConflict {
			return map[string]interface{}{
				"success":         false,
				"error":           "Port is already in use by a different network node",
				"technicalError":  extResult.Error.Error(),
				"conflict":        true,
				"existingNetwork": extResult.Network,
			}
		}

		// Connect to external node
		nodeManager.isRunning = false
		nodeManager.dataDir = ""

		if err := a.connectToExternalNode(expectedEndpoint); err != nil {
			return map[string]interface{}{
				"success":        false,
				"error":          "External node detected but connection failed",
				"technicalError": err.Error(),
			}
		}

		a.logToConsole(fmt.Sprintf("[OK] Successfully connected to external %s node", networkMode))
		return map[string]interface{}{
			"success":    true,
			"isExternal": true,
			"endpoint":   expectedEndpoint,
			"rpcPort":    nodeManager.rpcPort,
			"network":    string(networkMode),
			"height":     extResult.Height,
			"version":    extResult.Version,
			"message":    fmt.Sprintf("Connected to external %s node", networkMode),
		}
	}

	// No external node - start embedded
	a.logToConsole("[INFO] No external node detected, starting embedded node...")

	fullDataDir := filepath.Join(dataDir, netConfig.DataDir)
	a.logToConsole(fmt.Sprintf("[START] Starting %s node with data directory: %s", networkMode, fullDataDir))

	// Get binary
	binaryPath, err := getBinaryForNetwork(networkMode)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	if networkMode == NetworkSimulator {
		a.logToConsole(fmt.Sprintf("[SIM] Using simulator binary: %s", binaryPath))
	}

	// Create data directory
	if err := os.MkdirAll(fullDataDir, 0755); err != nil {
		return map[string]interface{}{
			"success": false, "error": "Failed to create data directory", "technicalError": err.Error(),
		}
	}

	// Build args and start process
	args := a.buildNodeArgs(networkMode, fullDataDir, netConfig)

	if err := a.startNodeProcess(binaryPath, args, fullDataDir, networkMode); err != nil {
		// Check for port conflict
		if isPortConflictError(err) {
			a.logToConsole(fmt.Sprintf("[WARN] Port conflict detected: %v", err))
			a.logToConsole("[...] Re-checking for external node...")

			// Re-check for external node
			recheckClient := NewDaemonClientWithTimeout(expectedEndpoint, 2*time.Second)
			if recheckInfo, recheckErr := recheckClient.GetInfo(); recheckErr == nil && recheckInfo != nil {
				a.logToConsole("[OK] External node found on re-check, connecting...")
				a.daemonClient = NewDaemonClient(expectedEndpoint)
				nodeManager.isRunning = false
				nodeManager.dataDir = ""
				return map[string]interface{}{
					"success":    true,
					"isExternal": true,
					"endpoint":   expectedEndpoint,
					"rpcPort":    nodeManager.rpcPort,
					"network":    string(networkMode),
					"message":    "Connected to external node (detected after port conflict)",
				}
			}

			return map[string]interface{}{
				"success":        false,
				"error":          "Port is already in use",
				"technicalError": fmt.Sprintf("Port %d conflict", nodeManager.rpcPort),
				"conflict":       true,
			}
		}

		return ErrorResponse(err)
	}

	// CRITICAL: Update daemon client to point at the node we just started.
	// Without this, Explorer/GetSCCode would keep querying the old endpoint (e.g. mainnet)
	// and return "Smart contract has no code" for simulator-deployed contracts.
	a.daemonClient = NewDaemonClient(expectedEndpoint)
	a.settings["daemon_endpoint"] = expectedEndpoint
	a.logToConsole(fmt.Sprintf("[OK] Daemon client connected to %s node at %s", networkMode, expectedEndpoint))

	return map[string]interface{}{
		"success":     true,
		"dataDir":     fullDataDir,
		"rpcPort":     nodeManager.rpcPort,
		"p2pPort":     nodeManager.p2pPort,
		"getworkPort": nodeManager.getworkPort,
		"network":     string(networkMode),
		"pid":         nodeManager.process.Process.Pid,
		"message":     fmt.Sprintf("%s node started successfully", networkMode),
	}
}

// StopNode stops the embedded derod node
func (a *App) StopNode() map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if !nodeManager.isRunning || nodeManager.process == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Node is not running",
		}
	}

	a.logToConsole("[STOP] Stopping node...")

	// Try graceful shutdown first
	if nodeManager.process.Process != nil {
		// Send interrupt signal
		nodeManager.process.Process.Signal(os.Interrupt)

		// Wait for up to 10 seconds
		done := make(chan error, 1)
		go func() {
			done <- nodeManager.process.Wait()
		}()

		select {
		case <-done:
			a.logToConsole("[OK] Node stopped gracefully")
		case <-time.After(10 * time.Second):
			// Force kill
			nodeManager.process.Process.Kill()
			a.logToConsole("[WARN] Node force killed after timeout")
		}
	}

	nodeManager.isRunning = false
	nodeManager.process = nil

	return map[string]interface{}{
		"success": true,
		"message": "Node stopped successfully",
	}
}

// GetNodeStatus returns the current node status
func (a *App) GetNodeStatus() map[string]interface{} {
	nodeManager.RLock()
	defer nodeManager.RUnlock()

	// First check if embedded node is running
	embeddedRunning := nodeManager.isRunning

	// Also check if we can connect to daemon RPC (covers external nodes too)
	info, err := a.daemonClient.GetInfo()
	rpcConnected := err == nil && info != nil

	// Node is "running" if either embedded process is running OR we can connect via RPC
	if !embeddedRunning && !rpcConnected {
		return map[string]interface{}{
			"success":   true,
			"isRunning": false,
		}
	}

	// Get sync progress from daemon RPC (we already have info from above)
	syncProgress := 0.0
	height := int64(0)
	topoHeight := int64(0)
	peers := int64(0)
	version := ""
	network := string(nodeManager.networkMode)

	if rpcConnected {
		if h, ok := info["height"].(float64); ok {
			height = int64(h)
		}
		if th, ok := info["topoheight"].(float64); ok {
			topoHeight = int64(th)
		}
		if p, ok := info["peers"].(float64); ok {
			peers = int64(p)
		}
		if v, ok := info["version"].(string); ok {
			version = v
		}
		if n, ok := info["network"].(string); ok && n != "" {
			network = n
		}
	} else if embeddedRunning {
		// Fall back to parsed values from stdout for embedded node
		height = nodeManager.chainHeight
		topoHeight = nodeManager.syncHeight
		peers = int64(nodeManager.peerCount)
	}

	// Calculate sync progress
	if height > 0 && topoHeight > 0 {
		syncProgress = float64(topoHeight) / float64(height) * 100
		if syncProgress > 100 {
			syncProgress = 100
		}
	}

	var pid int
	if nodeManager.process != nil && nodeManager.process.Process != nil {
		pid = nodeManager.process.Process.Pid
	}

	return map[string]interface{}{
		"success":      true,
		"isRunning":    true,
		"isEmbedded":   embeddedRunning,
		"isExternal":   !embeddedRunning && rpcConnected,
		"isSyncing":    nodeManager.isSyncing || (topoHeight > 0 && topoHeight < height),
		"dataDir":      nodeManager.dataDir,
		"rpcPort":      nodeManager.rpcPort,
		"p2pPort":      nodeManager.p2pPort,
		"getworkPort":  nodeManager.getworkPort,
		"network":      network,
		"version":      version,
		"isSimulator":  nodeManager.networkMode == NetworkSimulator,
		"height":       height,
		"topoHeight":   topoHeight,
		"syncProgress": syncProgress,
		"peers":        peers,
		"pid":          pid,
		"lastSyncLine": nodeManager.lastSyncLine,
	}
}

// GetSyncProgress returns the current sync progress
func (a *App) GetSyncProgress() map[string]interface{} {
	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return ErrorResponse(err)
	}

	height := int64(0)
	topoHeight := int64(0)
	peers := int64(0)

	if h, ok := info["height"].(float64); ok {
		height = int64(h)
	}
	if th, ok := info["topoheight"].(float64); ok {
		topoHeight = int64(th)
	}
	if p, ok := info["peers"].(float64); ok {
		peers = int64(p)
	}

	syncProgress := 0.0
	if height > 0 {
		syncProgress = float64(topoHeight) / float64(height) * 100
		if syncProgress > 100 {
			syncProgress = 100
		}
	}

	isSynced := syncProgress >= 99.9

	return map[string]interface{}{
		"success":    true,
		"height":     height,
		"topoHeight": topoHeight,
		"progress":   syncProgress,
		"isSynced":   isSynced,
		"peers":      peers,
	}
}

// GetNodeLogs returns recent node output logs
func (a *App) GetNodeLogs(limit int) map[string]interface{} {
	nodeManager.RLock()
	defer nodeManager.RUnlock()

	if limit <= 0 {
		limit = 100
	}

	logs := nodeManager.logBuffer
	if len(logs) > limit {
		logs = logs[len(logs)-limit:]
	}

	return map[string]interface{}{
		"success": true,
		"logs":    logs,
		"count":   len(logs),
	}
}

// SetNodePorts sets the RPC and P2P ports for the node
func (a *App) SetNodePorts(rpcPort, p2pPort int) map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if nodeManager.isRunning {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot change ports while node is running",
		}
	}

	if rpcPort < 1024 || rpcPort > 65535 {
		return map[string]interface{}{
			"success": false,
			"error":   "RPC port must be between 1024 and 65535",
		}
	}

	if p2pPort < 1024 || p2pPort > 65535 {
		return map[string]interface{}{
			"success": false,
			"error":   "P2P port must be between 1024 and 65535",
		}
	}

	nodeManager.rpcPort = rpcPort
	nodeManager.p2pPort = p2pPort

	return map[string]interface{}{
		"success": true,
		"rpcPort": rpcPort,
		"p2pPort": p2pPort,
		"message": "Ports updated",
	}
}

// Helper functions

func (a *App) readNodeOutput(reader io.ReadCloser, source string) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()

		// Add to log buffer
		nodeManager.Lock()
		nodeManager.logBuffer = append(nodeManager.logBuffer, fmt.Sprintf("[%s] %s", source, line))
		// Keep only last 1000 lines
		if len(nodeManager.logBuffer) > 1000 {
			nodeManager.logBuffer = nodeManager.logBuffer[len(nodeManager.logBuffer)-1000:]
		}
		nodeManager.lastSyncLine = line
		nodeManager.Unlock()

		// Determine log level
		level := "info"
		lowerLine := strings.ToLower(line)
		if source == "stderr" || strings.Contains(lowerLine, "error") || strings.Contains(lowerLine, "fatal") ||
			strings.Contains(lowerLine, "panic") || strings.Contains(lowerLine, "failed") {
			level = "error"
		} else if strings.Contains(lowerLine, "warn") || strings.Contains(lowerLine, "warning") {
			level = "warn"
		} else if strings.Contains(lowerLine, "started") || strings.Contains(lowerLine, "ready") ||
			strings.Contains(lowerLine, "success") || strings.Contains(line, "[OK]") {
			level = "success"
		}

		// Emit real-time event for terminal display (all lines, not filtered)
		if a.ctx != nil {
			timestamp := time.Now().Format("15:04:05")
			wailsRuntime.EventsEmit(a.ctx, "node-log", map[string]interface{}{
				"timestamp": timestamp,
				"level":     level,
				"message":   line,
				"source":    fmt.Sprintf("derod-%s", source),
			})
		}

		// Log to console - be more verbose for stderr (errors) and simulator mode
		shouldLog := false
		if source == "stderr" {
			// Always log stderr - it's usually errors
			shouldLog = true
		} else if strings.Contains(line, "Height") || strings.Contains(line, "Sync") ||
			strings.Contains(line, "Error") || strings.Contains(line, "Started") ||
			strings.Contains(lowerLine, "error") || strings.Contains(lowerLine, "fatal") ||
			strings.Contains(lowerLine, "panic") || strings.Contains(lowerLine, "failed") {
			shouldLog = true
		}

		if shouldLog {
			a.logToConsole(fmt.Sprintf("[derod %s] %s", source, line))
		}

		// Parse sync progress from output
		a.parseSyncProgress(line)
	}

	// If scanner encountered an error, log it
	if err := scanner.Err(); err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Error reading derod %s: %v", source, err))
	}
}

// parseSyncProgress extracts sync information from derod output
func (a *App) parseSyncProgress(line string) {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	// Check for syncing progress (e.g., "Syncing 123456 / 500000")
	if matches := syncingRegex.FindStringSubmatch(line); len(matches) == 3 {
		if current, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
			nodeManager.syncHeight = current
		}
		if total, err := strconv.ParseInt(matches[2], 10, 64); err == nil {
			nodeManager.chainHeight = total
		}
		nodeManager.isSyncing = true
		return
	}

	// Check for height info
	if matches := heightRegex.FindStringSubmatch(line); len(matches) == 2 {
		if height, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
			nodeManager.chainHeight = height
		}
	}

	// Check for topo height
	if matches := topoHeightRegex.FindStringSubmatch(line); len(matches) == 2 {
		if topo, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
			nodeManager.syncHeight = topo
		}
	}

	// Check for block sync
	if matches := blockSyncRegex.FindStringSubmatch(line); len(matches) == 2 {
		if block, err := strconv.ParseInt(matches[1], 10, 64); err == nil {
			nodeManager.syncHeight = block
		}
	}

	// Check for peer count
	if matches := peerRegex.FindStringSubmatch(line); len(matches) == 2 {
		if peers, err := strconv.Atoi(matches[1]); err == nil {
			nodeManager.peerCount = peers
		}
	}

	// Check for synced status
	if syncedRegex.MatchString(line) {
		nodeManager.isSyncing = false
	} else if strings.Contains(strings.ToLower(line), "syncing") {
		nodeManager.isSyncing = true
	}
}

func (a *App) monitorNode() {
	if nodeManager.process == nil {
		return
	}

	// Capture network mode before waiting
	networkMode := nodeManager.networkMode

	// Wait for process to exit
	err := nodeManager.process.Wait()

	nodeManager.Lock()
	wasRunning := nodeManager.isRunning
	nodeManager.isRunning = false
	nodeManager.process = nil

	// Get last few lines of output for debugging
	lastLines := make([]string, 0)
	if len(nodeManager.logBuffer) > 0 {
		// Get last 10 lines, prioritizing stderr
		recentLines := nodeManager.logBuffer
		if len(recentLines) > 10 {
			recentLines = recentLines[len(recentLines)-10:]
		}

		// Filter for error-related lines
		for _, line := range recentLines {
			if strings.Contains(strings.ToLower(line), "error") ||
				strings.Contains(strings.ToLower(line), "fatal") ||
				strings.Contains(strings.ToLower(line), "panic") ||
				strings.Contains(strings.ToLower(line), "failed") ||
				strings.Contains(line, "[stderr]") {
				lastLines = append(lastLines, line)
			}
		}

		// If no error lines found, just take last 5 lines
		if len(lastLines) == 0 && len(recentLines) > 0 {
			start := len(recentLines) - 5
			if start < 0 {
				start = 0
			}
			lastLines = recentLines[start:]
		}
	}
	nodeManager.Unlock()

	// Determine if this was an unexpected crash
	unexpectedExit := wasRunning && err != nil

	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Node process exited with error: %v", err))
		if len(lastLines) > 0 {
			a.logToConsole("[Node] Last output from derod:")
			for _, line := range lastLines {
				a.logToConsole(fmt.Sprintf("   %s", line))
			}
		}
	} else {
		a.logToConsole("[INFO] Node process exited normally")
	}

	// Emit event to frontend about the crash
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "node:stopped", map[string]interface{}{
			"unexpected": unexpectedExit,
			"error":      err != nil,
			"network":    string(networkMode),
			"lastLines":  lastLines,
		})

		// If this was a simulator crash, emit a specific event
		if networkMode == NetworkSimulator && unexpectedExit {
			a.logToConsole("[CRASH] Simulator daemon crashed unexpectedly!")
			wailsRuntime.EventsEmit(a.ctx, "simulator:crashed", map[string]interface{}{
				"error":     fmt.Sprintf("%v", err),
				"lastLines": lastLines,
			})
		}
	}
}

// SetNodeAdvancedConfig configures advanced node options like fast sync, pruning, and sync node
// These settings take effect on the next node start
func (a *App) SetNodeAdvancedConfig(fastSync bool, pruneHistory int, syncNodeEndpoint string) map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if nodeManager.isRunning {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot change advanced settings while node is running. Stop the node first.",
		}
	}

	// Validate prune history (0 = disabled, or a reasonable block count)
	if pruneHistory < 0 {
		pruneHistory = 0
	}
	if pruneHistory > 0 && pruneHistory < 1000 {
		pruneHistory = 1000 // Minimum 1000 blocks if pruning enabled
	}

	// Validate sync node endpoint (basic URL format check)
	syncNodeEndpoint = strings.TrimSpace(syncNodeEndpoint)

	nodeManager.fastSyncEnabled = fastSync
	nodeManager.pruneHistory = pruneHistory
	nodeManager.syncNodeEndpoint = syncNodeEndpoint

	a.logToConsole(fmt.Sprintf("[Node] Advanced config: fastSync=%v, pruneHistory=%d, syncNode=%s", fastSync, pruneHistory, syncNodeEndpoint))

	return map[string]interface{}{
		"success":          true,
		"fastSync":         nodeManager.fastSyncEnabled,
		"pruneHistory":     nodeManager.pruneHistory,
		"syncNodeEndpoint": nodeManager.syncNodeEndpoint,
	}
}

// GetNodeAdvancedConfig returns the current advanced node configuration
func (a *App) GetNodeAdvancedConfig() map[string]interface{} {
	nodeManager.RLock()
	defer nodeManager.RUnlock()

	return map[string]interface{}{
		"success":          true,
		"fastSync":         nodeManager.fastSyncEnabled,
		"pruneHistory":     nodeManager.pruneHistory,
		"syncNodeEndpoint": nodeManager.syncNodeEndpoint,
		"isRunning":        nodeManager.isRunning,
	}
}

// ================== Network Mode Management ==================

func daemonInfoHeight(info map[string]interface{}) (int64, bool) {
	if info == nil {
		return 0, false
	}
	v, ok := info["height"]
	if !ok {
		return 0, false
	}
	switch val := v.(type) {
	case float64:
		return int64(val), true
	case int64:
		return val, true
	case int:
		return int64(val), true
	default:
		return 0, false
	}
}

// inferRPCPortFromEndpoint returns the port from an http(s) URL, or host:port strings.
func inferRPCPortFromEndpoint(endpoint string) int {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return 0
	}
	if !strings.Contains(endpoint, "://") {
		if _, portStr, err := net.SplitHostPort(endpoint); err == nil {
			if p, err := strconv.Atoi(portStr); err == nil {
				return p
			}
		}
		return 0
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return 0
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			return n
		}
	}
	return 0
}

// inferNetworkModeFromDaemonInfo maps DERO.GetInfo to HOLOGRAM's NetworkMode.
// Prefer the daemon-reported "network" field so long-lived simulator chains (>10k blocks)
// are not misclassified as mainnet by height heuristics (which would repoint RPC to :10102).
// connectedEndpoint is the URL the client is actually using (e.g. settings daemon_endpoint);
// when the JSON omits "network", localhost :20000 / :10102 disambiguates before height fallback.
func inferNetworkModeFromDaemonInfo(info map[string]interface{}, connectedEndpoint string) (NetworkMode, bool) {
	if info == nil {
		return "", false
	}
	if n, ok := info["network"].(string); ok {
		n = strings.TrimSpace(n)
		if n != "" {
			switch strings.ToLower(n) {
			case "simulator":
				return NetworkSimulator, true
			case "mainnet":
				return NetworkMainnet, true
			}
		}
	}
	if connectedEndpoint != "" && isLocalhostEndpoint(connectedEndpoint) {
		switch inferRPCPortFromEndpoint(connectedEndpoint) {
		case 20000:
			return NetworkSimulator, true
		case 10102:
			return NetworkMainnet, true
		}
	}
	if h, ok := daemonInfoHeight(info); ok {
		if h > 10000 {
			return NetworkMainnet, true
		}
		if h > 0 {
			return NetworkSimulator, true
		}
	}
	return "", false
}

// SetNetworkMode sets the network mode for the next node start
// This must be called BEFORE starting the node
func (a *App) SetNetworkMode(network string) map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if nodeManager.isRunning {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot change network mode while node is running. Stop the node first.",
		}
	}

	mode := NetworkMode(network)
	if mode != NetworkMainnet && mode != NetworkSimulator {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid network mode. Must be mainnet or simulator.",
		}
	}

	nodeManager.networkMode = mode

	// Update ports to match new network
	netConfig := GetNetworkConfig(mode)
	nodeManager.rpcPort = netConfig.RPCPort
	nodeManager.p2pPort = netConfig.P2PPort
	nodeManager.getworkPort = netConfig.GetWorkPort

	a.logToConsole(fmt.Sprintf("[NET] Network mode set to: %s (RPC: %d, P2P: %d)", mode, netConfig.RPCPort, netConfig.P2PPort))

	// Update daemon client endpoint to match new network
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", netConfig.RPCPort)
	a.daemonClient = NewDaemonClient(endpoint)

	// Update settings (used by Gnomon and other services) and persist immediately
	// so the status broadcaster and reconcileDaemonEndpoint see the new network.
	a.settings["network"] = string(mode)
	a.settings["daemon_endpoint"] = endpoint
	a.saveSettings()

	// If Gnomon is running on a different network, stop it and inform user
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		a.logToConsole("[WARN] Stopping Gnomon - network changed. Please restart Gnomon for the new network.")
		a.gnomonClient.Stop()
		a.settings["gnomon_enabled"] = false
	}

	// Emit event to frontend to sync network mode
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "network-mode-changed", map[string]interface{}{
			"network":     string(mode),
			"endpoint":    endpoint,
			"rpcPort":     netConfig.RPCPort,
			"p2pPort":     netConfig.P2PPort,
			"getworkPort": netConfig.GetWorkPort,
			"dataDir":     netConfig.DataDir,
		})
	}

	return map[string]interface{}{
		"success":     true,
		"network":     string(mode),
		"endpoint":    endpoint,
		"rpcPort":     netConfig.RPCPort,
		"p2pPort":     netConfig.P2PPort,
		"getworkPort": netConfig.GetWorkPort,
		"dataDir":     netConfig.DataDir,
	}
}

// GetNetworkMode returns the current network mode.
// When daemon is connected, reconciles with GetInfo(): prefers the daemon "network" field,
// then falls back to height heuristics only if that field is missing.
// If a mismatch is detected, persists the corrected settings so they survive the next restart.
func (a *App) GetNetworkMode() map[string]interface{} {
	nodeManager.RLock()
	mode := nodeManager.networkMode
	nodeManager.RUnlock()

	netConfig := GetNetworkConfig(mode)

	// Use the actual stored endpoint as the base — not a constructed localhost URL.
	// This ensures remote/LAN endpoints survive the round-trip to the frontend.
	endpoint, _ := a.settings["daemon_endpoint"].(string)
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://127.0.0.1:%d", netConfig.RPCPort)
	}

	inferEndpoint := endpoint
	if a.daemonClient != nil {
		if ep := a.daemonClient.GetEndpoint(); ep != "" {
			inferEndpoint = ep
		}
	}

	// Reconcile with actual daemon connection
	if info, err := a.daemonClient.GetInfo(); err == nil {
		if inferred, hasInference := inferNetworkModeFromDaemonInfo(info, inferEndpoint); hasInference && inferred != mode {
			mode = inferred
			netConfig = GetNetworkConfig(inferred)
			// For localhost endpoints only, correct the port to match the
			// detected network. Remote endpoints are left untouched.
			if isLocalhostEndpoint(endpoint) {
				endpoint = fmt.Sprintf("http://127.0.0.1:%d", netConfig.RPCPort)
			}

			nodeManager.Lock()
			nodeManager.networkMode = inferred
			nodeManager.rpcPort = netConfig.RPCPort
			nodeManager.p2pPort = netConfig.P2PPort
			nodeManager.getworkPort = netConfig.GetWorkPort
			nodeManager.Unlock()

			a.settings["network"] = string(inferred)
			a.settings["daemon_endpoint"] = endpoint
			a.daemonClient.SetEndpoint(endpoint)
			a.saveSettings()
		} else if hasInference {
			netConfig = GetNetworkConfig(inferred)
		}
	}

	return map[string]interface{}{
		"success":     true,
		"network":     string(mode),
		"endpoint":    endpoint,
		"isSimulator": mode == NetworkSimulator,
		"isMainnet":   mode == NetworkMainnet,
		"rpcPort":     netConfig.RPCPort,
		"p2pPort":     netConfig.P2PPort,
		"getworkPort": netConfig.GetWorkPort,
		"dataDir":     netConfig.DataDir,
		"isRunning":   nodeManager.isRunning,
	}
}

// GetAvailableNetworks returns all available network modes and their configurations
func (a *App) GetAvailableNetworks() map[string]interface{} {
	networks := []map[string]interface{}{
		{
			"id":          "mainnet",
			"name":        "Mainnet",
			"description": "Live DERO network with real value",
			"rpcPort":     10102,
			"p2pPort":     10101,
			"getworkPort": 10100,
			"color":       "ok", // Green
		},
		{
			"id":          "simulator",
			"name":        "Simulator",
			"description": "Local simulation for TELA app development",
			"rpcPort":     20000,
			"p2pPort":     20001,
			"getworkPort": 20002,
			"color":       "err", // Red
		},
	}

	return map[string]interface{}{
		"success":  true,
		"networks": networks,
		"current":  string(nodeManager.networkMode),
	}
}

// min helper for older Go versions
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// GetNetworkStats returns network-specific statistics from the daemon
func (a *App) GetNetworkStats() map[string]interface{} {
	info, err := a.daemonClient.GetInfo()
	if err != nil {
		return ErrorResponse(err)
	}

	// Extract available stats
	stats := map[string]interface{}{
		"success": true,
	}

	// Get difficulty and block time for hashrate calculation
	var difficulty float64 = 0
	var blockTime float64 = 0

	// Common daemon info fields
	if v, ok := info["difficulty"].(float64); ok {
		difficulty = v
		stats["difficulty"] = int64(v)
	}
	// Try both field name variations for block time
	if v, ok := info["averageblocktime50"].(float64); ok {
		blockTime = v
		stats["blockTime"] = v
	} else if v, ok := info["average_block_time50"].(float64); ok {
		blockTime = v
		stats["blockTime"] = v
	}

	// Calculate network hashrate from difficulty and block time
	// This is more reliable than relying on daemon hashrate fields
	var calculatedHashrate int64 = 0
	if blockTime > 0 && difficulty > 0 {
		calculatedHashrate = int64(difficulty / blockTime)
	}

	if v, ok := info["tx_pool_size"].(float64); ok {
		stats["txPoolSize"] = int64(v)
	}
	if v, ok := info["total_supply"].(float64); ok {
		stats["totalSupply"] = int64(v)
	}
	if v, ok := info["dynamic_fee_per_kb"].(float64); ok {
		stats["feePerKb"] = int64(v)
	}
	if v, ok := info["miniblocks_accepted"].(float64); ok {
		stats["miniblocksAccepted"] = int64(v)
	}
	if v, ok := info["miniblocks_rejected"].(float64); ok {
		stats["miniblocksRejected"] = int64(v)
	}

	// Try to get explicit hashrate fields, fall back to calculated
	if v, ok := info["hashrate_1hr"].(float64); ok && v > 0 {
		stats["hashrate1hr"] = int64(v)
	} else {
		stats["hashrate1hr"] = calculatedHashrate
	}
	if v, ok := info["hashrate_1d"].(float64); ok && v > 0 {
		stats["hashrate1d"] = int64(v)
	} else {
		stats["hashrate1d"] = calculatedHashrate
	}
	if v, ok := info["hashrate_7d"].(float64); ok && v > 0 {
		stats["hashrate7d"] = int64(v)
	} else {
		stats["hashrate7d"] = calculatedHashrate
	}
	if v, ok := info["stableheight"].(float64); ok {
		stats["stableHeight"] = int64(v)
	}

	// Registration pool (Netrunner feature)
	if v, ok := info["reg_pool_size"].(float64); ok {
		stats["regPoolSize"] = int64(v)
	}

	// Connected miners count
	if v, ok := info["miners"].(float64); ok {
		stats["minersConnected"] = int64(v)
	}

	// NTP and P2P offsets (timing sync)
	if v, ok := info["offset_ntp"].(string); ok {
		stats["offsetNtp"] = v
	}
	if v, ok := info["offset_p2p"].(string); ok {
		stats["offsetP2p"] = v
	}
	// Also try numeric offset values
	if v, ok := info["median_block_time"].(float64); ok {
		stats["medianBlockTime"] = v
	}

	// Mining hashrate estimates
	if v, ok := info["hashrate_1hr_estimate"].(float64); ok {
		stats["hashrateEstimate1hr"] = v
	}
	if v, ok := info["hashrate_1d_estimate"].(float64); ok {
		stats["hashrateEstimate1d"] = v
	}
	if v, ok := info["hashrate_7d_estimate"].(float64); ok {
		stats["hashrateEstimate7d"] = v
	}

	// Total blocks mined on network
	if v, ok := info["total_blocks"].(float64); ok {
		stats["totalBlocks"] = int64(v)
	}

	return stats
}

// GetNodeConfig returns the current node configuration
func (a *App) GetNodeConfig() map[string]interface{} {
	nodeManager.RLock()
	defer nodeManager.RUnlock()

	homeDir, _ := os.UserHomeDir()
	defaultDataDir := filepath.Join(homeDir, ".dero")

	dataDir := nodeManager.dataDir
	if dataDir == "" {
		dataDir = defaultDataDir
	}

	return map[string]interface{}{
		"success":      true,
		"dataDir":      dataDir,
		"rpcPort":      nodeManager.rpcPort,
		"p2pPort":      nodeManager.p2pPort,
		"getworkPort":  nodeManager.getworkPort,
		"network":      string(nodeManager.networkMode),
		"fastSync":     nodeManager.fastSyncEnabled,
		"pruneHistory": nodeManager.pruneHistory,
		"isRunning":    nodeManager.isRunning,
	}
}

// SetNodeConfig updates the node configuration (requires node restart)
func (a *App) SetNodeConfig(config map[string]interface{}) map[string]interface{} {
	nodeManager.Lock()
	defer nodeManager.Unlock()

	if nodeManager.isRunning {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot change configuration while node is running. Stop the node first.",
		}
	}

	// Apply configuration values
	if v, ok := config["rpcPort"].(float64); ok && v > 1024 && v < 65535 {
		nodeManager.rpcPort = int(v)
	}
	if v, ok := config["p2pPort"].(float64); ok && v > 1024 && v < 65535 {
		nodeManager.p2pPort = int(v)
	}
	if v, ok := config["getworkPort"].(float64); ok && v > 1024 && v < 65535 {
		nodeManager.getworkPort = int(v)
	}
	if v, ok := config["fastSync"].(bool); ok {
		nodeManager.fastSyncEnabled = v
	}
	if v, ok := config["pruneHistory"].(float64); ok {
		nodeManager.pruneHistory = int(v)
	}
	if v, ok := config["network"].(string); ok {
		mode := NetworkMode(v)
		if mode == NetworkMainnet || mode == NetworkSimulator {
			nodeManager.networkMode = mode
		}
	}

	a.logToConsole("[Node] Configuration updated")

	return map[string]interface{}{
		"success": true,
		"message": "Configuration updated. Start node to apply.",
	}
}

// EstimateSyncTime estimates remaining sync time based on current progress
func (a *App) EstimateSyncTime() map[string]interface{} {
	// Get current sync status
	status := a.GetSyncProgress()
	if !status["success"].(bool) {
		return status
	}

	progress := status["progress"].(float64)
	if progress >= 99.9 {
		return map[string]interface{}{
			"success":       true,
			"estimatedTime": "Synced",
			"progress":      100,
		}
	}

	// Rough estimate: assume 1000 blocks per minute average
	height := status["height"].(int64)
	topoHeight := status["topoHeight"].(int64)
	remaining := height - topoHeight

	// Estimate time based on blocks remaining
	minutesRemaining := float64(remaining) / 1000.0

	var estimate string
	if minutesRemaining < 1 {
		estimate = "Less than 1 minute"
	} else if minutesRemaining < 60 {
		estimate = fmt.Sprintf("About %d minutes", int(minutesRemaining))
	} else {
		hours := int(minutesRemaining / 60)
		mins := int(minutesRemaining) % 60
		estimate = fmt.Sprintf("About %d hours %d minutes", hours, mins)
	}

	return map[string]interface{}{
		"success":         true,
		"estimatedTime":   estimate,
		"blocksRemaining": remaining,
		"progress":        progress,
	}
}
