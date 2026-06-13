// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Node Manager Helpers - Extracted from node_manager.go for maintainability
// Session 87: Code restructuring

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ExternalNodeResult represents the result of checking for an external node
type ExternalNodeResult struct {
	Found       bool
	Connected   bool
	IsConflict  bool
	Endpoint    string
	Network     string
	Height      int64
	Version     string
	Error       error
	ErrorDetail string
}

// checkForExternalNode checks if an external node is running at the expected port
// Returns the result including whether to connect or if there's a conflict
func (a *App) checkForExternalNode(expectedEndpoint string, networkMode NetworkMode) ExternalNodeResult {
	a.logToConsole(fmt.Sprintf("[...] Checking for existing node at %s...", expectedEndpoint))

	// Create a temporary client with longer timeout
	checkClient := NewDaemonClientWithTimeout(expectedEndpoint, 5*time.Second)
	info, err := checkClient.GetInfo()

	// Log the result
	if err != nil {
		a.logToConsole(fmt.Sprintf("  [WARN] No response from %s: %v", expectedEndpoint, err))
		return ExternalNodeResult{Found: false}
	}
	if info == nil {
		a.logToConsole(fmt.Sprintf("  [WARN] No node found at %s (empty response)", expectedEndpoint))
		return ExternalNodeResult{Found: false}
	}

	a.logToConsole(fmt.Sprintf("  [OK] Node response received from %s", expectedEndpoint))

	// Parse node info
	network := ""
	height := int64(0)
	version := ""
	if n, ok := info["network"].(string); ok {
		network = n
	}
	if h, ok := info["height"].(float64); ok {
		height = int64(h)
	}
	if v, ok := info["version"].(string); ok {
		version = v
	}

	// Check if networks match
	networkMatch := false
	switch networkMode {
	case NetworkMainnet:
		networkMatch = (network == "mainnet" || network == "")
	case NetworkSimulator:
		networkMatch = (network == "Simulator" || strings.ToLower(network) == "simulator")
	}

	result := ExternalNodeResult{
		Found:    true,
		Endpoint: expectedEndpoint,
		Network:  network,
		Height:   height,
		Version:  version,
	}

	if networkMatch {
		// External node on same network - connect to it
		a.logToConsole(fmt.Sprintf("[OK] External node detected at %s (v%s, height: %d, network: %s)",
			expectedEndpoint, version, height, network))
		a.logToConsole("[LINK] Connecting to external node instead of starting embedded node")
		result.Connected = true
	} else {
		// Network conflict
		a.logToConsole(fmt.Sprintf("[WARN] Port conflict: Port is in use by a %s node, but we need %s",
			network, networkMode))
		result.IsConflict = true
		result.Error = fmt.Errorf("port is in use by %s node", network)
	}

	return result
}

// connectToExternalNode updates the daemon client to use an external node
func (a *App) connectToExternalNode(endpoint string) error {
	oldClient := a.daemonClient
	a.daemonClient = NewDaemonClient(endpoint)

	if err := a.daemonClient.TestConnection(); err != nil {
		// Restore old client on failure
		a.daemonClient = oldClient
		return fmt.Errorf("connection test failed: %w", err)
	}

	return nil
}

// buildNodeArgs builds command line arguments for derod based on network mode
func (a *App) buildNodeArgs(networkMode NetworkMode, fullDataDir string, netConfig NetworkConfig) []string {
	var args []string

	if networkMode == NetworkSimulator {
		// Simulator binary only supports limited flags.
		// Pass --testnet explicitly: newer simulator builds default the chain to
		// mainnet when the flag is absent, which mismatches HOLOGRAM's in-process
		// simulator globals. Passing it keeps the spawned daemon on the sim chain
		// regardless of the binary's internal default.
		args = []string{
			"--data-dir", fullDataDir,
			"--rpc-bind", fmt.Sprintf("127.0.0.1:%d", nodeManager.rpcPort),
			"--testnet",
		}
		a.logToConsole(fmt.Sprintf("[NET] Network mode: %s (using simulator binary)", networkMode))
	} else {
		// Regular derod binary
		args = []string{
			"--data-dir", fullDataDir,
			"--rpc-bind", fmt.Sprintf("127.0.0.1:%d", nodeManager.rpcPort),
			"--p2p-bind", fmt.Sprintf("0.0.0.0:%d", nodeManager.p2pPort),
		}

		a.logToConsole(fmt.Sprintf("[NET] Network mode: %s", networkMode))
	}

	// Add optional flags (not applicable for simulator)
	if networkMode != NetworkSimulator {
		if nodeManager.fastSyncEnabled {
			args = append(args, "--fastsync")
			a.logToConsole("[FAST] Fast sync enabled")
		}
		if nodeManager.pruneHistory > 0 {
			args = append(args, "--prune-history", fmt.Sprintf("%d", nodeManager.pruneHistory))
			a.logToConsole(fmt.Sprintf("[Node] Pruning history older than %d blocks", nodeManager.pruneHistory))
		}
		if nodeManager.syncNodeEndpoint != "" {
			// Privacy Mode: the node's P2P sync (--p2p-bind, above) is legitimate DERO
			// traffic and stays on. But a user-supplied remote --sync-node is a directed
			// outbound to a single chosen host — refuse it unless allowlisted, so the
			// shield can't be bypassed by pinning sync to an arbitrary remote.
			if allowed, reason := isEndpointAllowed(nodeManager.syncNodeEndpoint); allowed {
				args = append(args, "--sync-node", nodeManager.syncNodeEndpoint)
				a.logToConsole(fmt.Sprintf("[SYNC] Using trusted node for sync: %s", nodeManager.syncNodeEndpoint))
			} else {
				a.logToConsole(fmt.Sprintf("[SHIELD] Privacy Mode: ignoring remote --sync-node %s (%s); node will sync via the DERO P2P network", nodeManager.syncNodeEndpoint, reason))
			}
		}
	}

	return args
}

// getBinaryPath returns the appropriate binary path for the network mode
func getBinaryForNetwork(networkMode NetworkMode) (string, error) {
	if networkMode == NetworkSimulator {
		binaryPath := GetSimulatorBinaryPath()
		if binaryPath == "" {
			return "", fmt.Errorf("simulator binary not found")
		}
		// Ensure executable
		os.Chmod(binaryPath, 0755)
		return binaryPath, nil
	}

	binaryPath := GetBinaryPath()
	if binaryPath == "" {
		return "", fmt.Errorf("derod binary not found")
	}
	return binaryPath, nil
}

// startNodeProcess starts the derod process and sets up monitoring
func (a *App) startNodeProcess(binaryPath string, args []string, fullDataDir string, networkMode NetworkMode) error {
	cmd := exec.Command(binaryPath, args...)
	cmd.Dir = filepath.Dir(binaryPath)

	a.logToConsole(fmt.Sprintf("[Exec] %s %s", binaryPath, strings.Join(args, " ")))

	// Set up pipes
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	// Start process
	if err := cmd.Start(); err != nil {
		return err
	}

	// Update node manager state
	nodeManager.process = cmd
	nodeManager.dataDir = fullDataDir
	nodeManager.isRunning = true
	nodeManager.isSyncing = networkMode != NetworkSimulator
	nodeManager.stdout = stdout
	nodeManager.stderr = stderr

	// Start output readers and monitor
	go a.readNodeOutput(stdout, "stdout")
	go a.readNodeOutput(stderr, "stderr")
	go a.monitorNode()

	// Update daemon client
	a.daemonClient = NewDaemonClient(fmt.Sprintf("http://127.0.0.1:%d", nodeManager.rpcPort))

	a.logToConsole(fmt.Sprintf("[OK] %s node process started (PID: %d)", networkMode, cmd.Process.Pid))

	return nil
}

// isPortConflictError checks if an error is due to port already in use
func isPortConflictError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "address already in use") ||
		strings.Contains(errStr, "bind: address already in use") ||
		strings.Contains(errStr, "port is already allocated")
}

