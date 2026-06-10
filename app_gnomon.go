// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Gnomon & App Discovery - Extracted from app.go for organization
// Session 87: Domain splitting

package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"
)

// Gnomon Functions

// isValidSCID checks if a string looks like a valid SCID (64 hex characters)
func isValidSCID(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) != 64 {
		return false
	}
	// Check if it's all hex characters
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// isURL checks if a string looks like a URL (with or without protocol)
func isURL(s string) bool {
	s = strings.TrimSpace(s)
	// Check for explicit protocols
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "ipfs://") {
		return true
	}
	// Check for URLs without protocol (www. or contains common TLDs with path)
	if strings.HasPrefix(s, "www.") {
		return true
	}
	// Check for domain patterns like example.com/path
	if strings.Contains(s, ".") && strings.Contains(s, "/") && !strings.Contains(s, " ") {
		parts := strings.Split(s, ".")
		if len(parts) >= 2 {
			// Likely a domain
			return true
		}
	}
	return false
}

// tryConvertRawBytesToSCID attempts to convert 32 raw bytes to a 64-char hex SCID
func tryConvertRawBytesToSCID(s string) string {
	// If the string is exactly 32 bytes and contains non-printable characters,
	// it might be raw SCID bytes that need to be converted to hex
	if len(s) == 32 {
		hasNonPrintable := false
		for _, c := range s {
			if c < 32 || c > 126 {
				hasNonPrintable = true
				break
			}
		}
		if hasNonPrintable {
			// Convert raw bytes to hex string
			return hex.EncodeToString([]byte(s))
		}
	}
	return s
}

// resolveIconSCID fetches an SVG icon from a DOC SCID and returns a data URL
// If the icon is already a URL, returns it as-is
// If the icon is a SCID but can't be resolved, returns empty string to trigger fallback
func (a *App) resolveIconSCID(iconValue string) string {
	iconValue = strings.TrimSpace(iconValue)
	if iconValue == "" {
		return ""
	}

	// Try to convert raw bytes to SCID if needed
	iconValue = tryConvertRawBytesToSCID(iconValue)

	// If it's a URL with protocol, return as-is
	if strings.HasPrefix(iconValue, "http://") || strings.HasPrefix(iconValue, "https://") || strings.HasPrefix(iconValue, "ipfs://") {
		return iconValue
	}

	// If it's a URL without protocol (www. or domain/path), add https://
	if isURL(iconValue) {
		return "https://" + iconValue
	}

	// If it doesn't look like a SCID (64 hex chars), return empty to use fallback
	if !isValidSCID(iconValue) {
		// Only log if it's not empty and not too short (avoid logging noise)
		if len(iconValue) > 3 {
			// Truncate for logging to avoid binary spam
			logVal := iconValue
			if len(logVal) > 20 {
				logVal = logVal[:20] + "..."
			}
			// Check if it's printable
			isPrintable := true
			for _, c := range logVal {
				if c < 32 || c > 126 {
					isPrintable = false
					break
				}
			}
			if isPrintable {
				a.logToConsole(fmt.Sprintf("[ICON] Value is not a valid SCID or URL: %s", logVal))
			} else {
				a.logToConsole(fmt.Sprintf("[ICON] Value is binary data (len=%d), cannot use as icon", len(iconValue)))
			}
		}
		return "" // Return empty to trigger fallback
	}

	a.logToConsole(fmt.Sprintf("[ICON] Resolving icon SCID: %s...", iconValue[:16]))

	// Try to fetch the DOC content
	scData, err := a.fetchSmartContract(iconValue, true, true)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ICON] Failed to fetch icon SCID %s: %v", iconValue[:16], err))
		return "" // Return empty to trigger fallback icon
	}

	stringKeys, ok := scData["stringkeys"].(map[string]interface{})
	if !ok {
		a.logToConsole(fmt.Sprintf("[ICON] No stringkeys in SCID %s", iconValue[:16]))
		return ""
	}

	// Verify it's an image DOC type
	docTypeHex, _ := stringKeys["docType"].(string)
	docType := ""
	if docTypeHex != "" {
		if decoded, err := hex.DecodeString(docTypeHex); err == nil {
			docType = string(decoded)
		} else {
			docType = docTypeHex // Maybe it's not hex-encoded
		}
	}

	a.logToConsole(fmt.Sprintf("[ICON] SCID %s docType: %s", iconValue[:16], docType))

	// Only process SVG/STATIC types (be more lenient)
	isImageType := strings.Contains(strings.ToUpper(docType), "STATIC") ||
		strings.Contains(strings.ToLower(docType), "svg") ||
		strings.Contains(strings.ToLower(docType), "image")

	if docType != "" && !isImageType {
		a.logToConsole(fmt.Sprintf("[ICON] SCID %s is not an image type: %s", iconValue[:16], docType))
		return ""
	}

	// Get the code (actual file content)
	code, ok := scData["code"].(string)
	if !ok {
		a.logToConsole(fmt.Sprintf("[ICON] No code in SCID %s", iconValue[:16]))
		return ""
	}

	// Extract file content from smart contract comment block
	fileContent := extractFileContentFromCode(code)
	if fileContent == "" {
		a.logToConsole(fmt.Sprintf("[ICON] Could not extract file content from SCID %s", iconValue[:16]))
		return ""
	}

	a.logToConsole(fmt.Sprintf("[ICON] Extracted %d bytes from SCID %s", len(fileContent), iconValue[:16]))

	// Check for gzip compression by looking at filename
	fileNameHex, _ := stringKeys["var_header_name"].(string)
	if fileNameHex == "" {
		fileNameHex, _ = stringKeys["nameHdr"].(string)
	}
	fileName := ""
	if fileNameHex != "" {
		if decoded, err := hex.DecodeString(fileNameHex); err == nil {
			fileName = string(decoded)
		} else {
			fileName = fileNameHex
		}
	}

	// Decompress if needed
	if strings.HasSuffix(fileName, ".gz") {
		a.logToConsole(fmt.Sprintf("[ICON] Decompressing gzipped content from %s", iconValue[:16]))
		decompressed, err := decompressGzip(fileContent)
		if err == nil {
			fileContent = decompressed
		} else {
			a.logToConsole(fmt.Sprintf("[ICON] Decompression failed for %s: %v", iconValue[:16], err))
		}
	}

	// Validate it looks like SVG
	trimmed := strings.TrimSpace(fileContent)
	if !strings.HasPrefix(trimmed, "<?xml") && !strings.HasPrefix(trimmed, "<svg") {
		a.logToConsole(fmt.Sprintf("[ICON] SCID %s content is not valid SVG (starts with: %.50s...)", iconValue[:16], trimmed))
		return ""
	}

	// Validate SVG has required attributes
	if !strings.Contains(trimmed, "xmlns") {
		a.logToConsole(fmt.Sprintf("[ICON] SCID %s SVG missing xmlns attribute", iconValue[:16]))
		return ""
	}

	// Success! Return as data URL
	// Use URL-safe base64 and properly encode SVG
	svgContent := strings.TrimSpace(fileContent)
	encoded := base64.StdEncoding.EncodeToString([]byte(svgContent))
	dataURL := fmt.Sprintf("data:image/svg+xml;base64,%s", encoded)
	a.logToConsole(fmt.Sprintf("[ICON] Successfully resolved SCID %s to data URL (%d bytes encoded)", iconValue[:16], len(encoded)))
	return dataURL
}

func (a *App) StartGnomon() map[string]interface{} {
	a.logToConsole("[START] Starting Gnomon indexer...")

	endpoint := "http://127.0.0.1:10102"
	if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpoint = ep
	}

	network := "mainnet"
	if net, ok := a.settings["network"].(string); ok && net != "" {
		network = net
	}

	a.logToConsole(fmt.Sprintf("[Gnomon] Connecting to daemon: %s (network: %s)", endpoint, network))

	err := a.gnomonClient.Start(endpoint, network)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Gnomon start failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole("[OK] Gnomon indexer started successfully")
	a.settings["gnomon_enabled"] = true

	// Start a connection monitor goroutine to provide feedback
	go a.monitorGnomonConnection(endpoint)

	return map[string]interface{}{
		"success": true,
		"message": "Gnomon indexer started",
	}
}

// monitorGnomonConnection provides user feedback when Gnomon is stuck connecting
func (a *App) monitorGnomonConnection(endpoint string) {
	connectionWarned := false
	connectedLogged := false
	checkInterval := 5 * time.Second
	warningThreshold := 15 * time.Second
	startTime := time.Now()

	for {
		time.Sleep(checkInterval)

		// Check if Gnomon is still running
		if !a.gnomonClient.IsRunning() {
			return // Gnomon was stopped, exit monitor
		}

		status := a.gnomonClient.GetStatus()
		chainHeight, _ := status["chain_height"].(int64)
		connecting, _ := status["connecting"].(bool)

		if connecting || chainHeight == 0 {
			elapsed := time.Since(startTime)
			if elapsed > warningThreshold && !connectionWarned {
				a.logToConsole(fmt.Sprintf("[Gnomon] Still connecting to %s... (waiting %.0fs)", endpoint, elapsed.Seconds()))
				connectionWarned = true
			}
		} else {
			// Connected! Log once and exit monitor
			if !connectedLogged {
				a.logToConsole(fmt.Sprintf("[Gnomon] Connected to daemon, chain height: %d", chainHeight))
				connectedLogged = true
			}
			return // Successfully connected, exit monitor
		}

		// Safety timeout - stop monitoring after 5 minutes
		if time.Since(startTime) > 5*time.Minute {
			if !connectedLogged {
				a.logToConsole("[Gnomon] Connection monitor timeout - check if daemon endpoint is correct")
			}
			return
		}
	}
}

func (a *App) StopGnomon() map[string]interface{} {
	a.logToConsole("[STOP] Stopping Gnomon indexer...")

	a.gnomonClient.Stop()
	a.settings["gnomon_enabled"] = false

	a.logToConsole("[OK] Gnomon indexer stopped")

	return map[string]interface{}{
		"success": true,
		"message": "Gnomon indexer stopped",
	}
}

func (a *App) GetGnomonStatus() map[string]interface{} {
	status := a.gnomonClient.GetStatus()
	return map[string]interface{}{
		"success": true,
		"status":  status,
	}
}

// SetGnomonAutostart enables or disables automatic Gnomon startup
func (a *App) SetGnomonAutostart(enabled bool) map[string]interface{} {
	a.settings["gnomon_autostart"] = enabled

	if enabled {
		a.logToConsole("[GNOMON] Auto-start enabled - Gnomon will start automatically on app launch")
	} else {
		a.logToConsole("[GNOMON] Auto-start disabled")
	}

	return map[string]interface{}{
		"success": true,
		"enabled": enabled,
		"message": fmt.Sprintf("Gnomon auto-start %s", map[bool]string{true: "enabled", false: "disabled"}[enabled]),
	}
}

// GetGnomonAutostart returns the current auto-start setting
func (a *App) GetGnomonAutostart() bool {
	if autostart, ok := a.settings["gnomon_autostart"].(bool); ok {
		return autostart
	}
	return false
}

// AddSCIDToIndex is the Wails-bound frontend entry point for Bug #1 resolution.
// Manually indexes a SCID that the default search filter didn't catch.
//
// This implements civilware's feat-addscidtoindex-wsserver feature. Typical flow:
// a developer deploys a TELA app, HOLOGRAM's fastsync misses it (deployed before
// Gnomon started), the dev pastes the SCID into Studio > Add SCID and hits
// "Add to Index" — this method fetches the SC via RPC, stores its variables,
// and makes it discoverable.
func (a *App) AddSCIDToIndex(scid string) map[string]interface{} {
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running — start it first",
		}
	}

	scid = strings.TrimSpace(scid)
	if !isValidSCID(scid) {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid SCID: expected 64 hex characters",
		}
	}

	// varstoreonly=true is load-bearing: the indexer only stores a SCID's variables
	// if its code matches the search filter OR varstoreonly is set. This button's
	// whole purpose is indexing contracts the TELA filter didn't catch (NFAs, older
	// deploys), and those fail the filter re-check too — with varstoreonly=false the
	// add "succeeds" but stores zero variables. true bypasses the filter and stores
	// vars directly, matching Engram's getContractHeader and the wallet add path.
	// skipfsrecheck=false still fetches code+vars via RPC for validation.
	err := a.gnomonClient.AddSCIDToIndex(scid, true, false)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[GNOMON] AddSCIDToIndex failed: %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[GNOMON] AddSCIDToIndex %s... success", scid[:16]))

	// Fetch the newly indexed data to return useful info to the UI
	vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)
	varCount := len(vars)

	// Extract basic metadata from variables
	result := map[string]interface{}{
		"success":    true,
		"scid":       scid,
		"vars_count": varCount,
	}

	// Parse TELA metadata if available
	data := map[string]any{"scid": scid}
	app, isIndex, isDOC, _ := allocateData(vars, data)

	if name, ok := app["name"].(string); ok && name != "" {
		result["name"] = name
	}
	if desc, ok := app["description"].(string); ok && desc != "" {
		result["description"] = desc
	}
	if durl, ok := app["durl"].(string); ok && durl != "" {
		result["durl"] = durl
	}
	if owner, ok := app["owner"].(string); ok && owner != "" {
		result["owner"] = owner
	}

	// Determine class/type
	if isIndex {
		result["class"] = "INDEX"
	} else if isDOC {
		result["class"] = "DOC"
	} else {
		result["class"] = "SC"
	}

	return result
}

// SearchByKey searches all indexed SCIDs for those containing a specific key
func (a *App) SearchByKey(key string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Searching by key: %s", key))

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running. Start it in Settings to search.",
			"results": []map[string]interface{}{},
		}
	}

	if key == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Key cannot be empty",
			"results": []map[string]interface{}{},
		}
	}

	results := a.gnomonClient.SearchByKey(key)
	a.logToConsole(fmt.Sprintf("[OK] Found %d SCIDs containing key '%s'", len(results), key))

	return map[string]interface{}{
		"success": true,
		"key":     key,
		"results": results,
		"count":   len(results),
	}
}

// SearchByValue searches all indexed SCIDs for those containing a specific value
func (a *App) SearchByValue(value string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[...] Searching by value: %s", value))

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running. Start it in Settings to search.",
			"results": []map[string]interface{}{},
		}
	}

	if value == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Value cannot be empty",
			"results": []map[string]interface{}{},
		}
	}

	results := a.gnomonClient.SearchByValue(value)
	a.logToConsole(fmt.Sprintf("[OK] Found %d SCIDs containing value '%s'", len(results), value))

	return map[string]interface{}{
		"success": true,
		"value":   value,
		"results": results,
		"count":   len(results),
	}
}

// SearchCodeLine searches all indexed smart contracts for a specific line of code
func (a *App) SearchCodeLine(line string) map[string]interface{} {
	result := a.searchCodeLineWrapper("code:" + line)

	if result.Success {
		return map[string]interface{}{
			"success": true,
			"line":    line,
			"results": result.Data["results"],
			"count":   result.Data["count"],
		}
	}

	return map[string]interface{}{
		"success": false,
		"error":   result.Error,
		"results": []map[string]interface{}{},
	}
}

// CleanGnomonDB deletes the Gnomon database for a specific network
func (a *App) CleanGnomonDB(network string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Gnomon] Cleaning DB for network: %s", network))

	if a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon must be stopped before cleaning the database. Stop it first.",
		}
	}

	if network == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Network must be specified (mainnet or simulator)",
		}
	}

	validNetworks := []string{"mainnet", "simulator"}
	isValid := false
	for _, n := range validNetworks {
		if n == network {
			isValid = true
			break
		}
	}
	if !isValid {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid network. Must be mainnet or simulator",
		}
	}

	err := a.gnomonClient.CleanDB(network)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] CleanGnomonDB failed: %v", err))
		return ErrorResponse(err)
	}

	a.logToConsole(fmt.Sprintf("[OK] Gnomon DB cleaned for %s", network))

	return map[string]interface{}{
		"success": true,
		"network": network,
		"message": fmt.Sprintf("Gnomon database for %s has been deleted. Restart Gnomon to re-sync.", network),
	}
}

// ResyncGnomon stops Gnomon, cleans the DB, and restarts it
// By default, uses fastsync to start from near the current height (fast)
// Use ResyncGnomonFromHeight for a specific starting block
func (a *App) ResyncGnomon() map[string]interface{} {
	network := a.getNetworkName()
	a.logToConsole(fmt.Sprintf("[Gnomon] Resyncing for %s...", network))

	if a.gnomonClient.IsRunning() {
		a.StopGnomon()
	}

	err := a.gnomonClient.CleanDB(network)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Could not clean DB: %v", err))
	}

	// Use fastsync by default for quick resync
	// This starts from near the current chain height
	a.logToConsole("[Gnomon] Using fastsync for quick resync")

	result := a.StartGnomon()
	if success, ok := result["success"].(bool); ok && success {
		return map[string]interface{}{
			"success": true,
			"network": network,
			"message": fmt.Sprintf("Gnomon resync started for %s (fastsync)", network),
		}
	}

	return result
}

// ResyncGnomonFromHeight stops Gnomon, cleans the DB, and restarts from a specific block height
// This is useful for finding recently deployed contracts without indexing the entire chain
func (a *App) ResyncGnomonFromHeight(height int64) map[string]interface{} {
	network := a.getNetworkName()
	a.logToConsole(fmt.Sprintf("[Gnomon] Resyncing for %s from height %d...", network, height))

	if a.gnomonClient.IsRunning() {
		a.StopGnomon()
	}

	err := a.gnomonClient.CleanDB(network)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Could not clean DB: %v", err))
	}

	// Disable fastsync and set the specific start height
	a.gnomonClient.SetDisableFastsync(true)
	a.gnomonClient.SetStartFromHeight(height)
	a.logToConsole(fmt.Sprintf("[Gnomon] Will start indexing from block %d", height))

	result := a.StartGnomon()
	if success, ok := result["success"].(bool); ok && success {
		return map[string]interface{}{
			"success":     true,
			"network":     network,
			"startHeight": height,
			"message":     fmt.Sprintf("Gnomon resync started for %s from block %d", network, height),
		}
	}

	return result
}

// getNetworkName returns the current network name
func (a *App) getNetworkName() string {
	if a.IsInSimulatorMode() {
		return "simulator"
	}
	if networkMode, ok := a.settings["network_mode"].(string); ok {
		if networkMode == "simulator" {
			return "simulator"
		}
	}
	return "mainnet"
}

// EnsureGnomonRunning starts Gnomon if not already running
func (a *App) EnsureGnomonRunning() map[string]interface{} {
	if a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success":        true,
			"alreadyRunning": true,
			"message":        "Gnomon is already running",
		}
	}

	a.logToConsole("[NET] Lazy-starting Gnomon indexer (on demand)...")
	return a.StartGnomon()
}

func (a *App) GetDiscoveredApps() map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
			"apps":    []map[string]interface{}{},
		}
	}

	apps := a.gnomonClient.GetTELAApps()
	tagStore := InitSCIDTagStore()

	epochCount := 0

	for i, app := range apps {
		if scid, ok := app["scid"].(string); ok && scid != "" {
			rating, err := a.gnomonClient.GetRating(scid)
			if err == nil && rating != nil {
				apps[i]["rating"] = map[string]interface{}{
					"average":  rating.Average,
					"count":    rating.Count,
					"likes":    rating.Likes,
					"dislikes": rating.Dislikes,
				}
			}

			supportsEpoch := a.gnomonClient.CheckAppSupportsEpoch(scid)
			apps[i]["supports_epoch"] = supportsEpoch
			if supportsEpoch {
				apps[i]["epoch_badge"] = "EPOCH Enabled"
				epochCount++
			}

			// Resolve SCID icons to data URLs
			if icon, ok := app["icon"].(string); ok && icon != "" {
				resolved := a.resolveIconSCID(icon)
				apps[i]["icon"] = resolved
			}

			// Attach tag/class metadata from tag store (Simple-Gnomon feature)
			if meta := tagStore.GetMetadata(scid); meta != nil {
				apps[i]["class"] = meta.Class
				apps[i]["tags"] = meta.Tags
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[Gnomon] Found %d TELA apps (%d with EPOCH support)", len(apps), epochCount))

	// Mark apps as loaded - this signals to the frontend that the expensive
	// GetDiscoveredApps operation has completed at least once
	a.gnomonClient.SetAppsLoaded(true)

	return map[string]interface{}{
		"success": true,
		"apps":    apps,
		"count":   len(apps),
	}
}

// GetTELALibraries returns all TELA content tagged as libraries
func (a *App) GetTELALibraries() map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success":   false,
			"error":     "Gnomon is not running. Start it in Settings to discover libraries.",
			"libraries": []map[string]interface{}{},
		}
	}

	libs := a.gnomonClient.GetTELALibraries()

	for i, lib := range libs {
		if scid, ok := lib["scid"].(string); ok && scid != "" {
			rating, err := a.gnomonClient.GetRating(scid)
			if err == nil && rating != nil {
				libs[i]["rating"] = map[string]interface{}{
					"average":  rating.Average,
					"count":    rating.Count,
					"likes":    rating.Likes,
					"dislikes": rating.Dislikes,
				}
			}

			// Resolve SCID icons to data URLs
			if icon, ok := lib["icon"].(string); ok && icon != "" {
				resolved := a.resolveIconSCID(icon)
				libs[i]["icon"] = resolved
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[Gnomon] Found %d TELA libraries", len(libs)))

	return map[string]interface{}{
		"success":   true,
		"libraries": libs,
		"count":     len(libs),
	}
}

// GetRandomSmartContracts returns a random sample of smart contracts
func (a *App) GetRandomSmartContracts(limit int) map[string]interface{} {
	if limit <= 0 {
		limit = 10
	}

	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running. Start it in Settings to discover contracts.",
		}
	}

	allSCs := a.gnomonClient.GetAllOwnersAndSCIDs()

	if len(allSCs) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No smart contracts found in index.",
		}
	}

	type scInfo struct {
		scid  string
		owner string
	}

	scs := make([]scInfo, 0, len(allSCs))
	for scid, owner := range allSCs {
		scs = append(scs, scInfo{scid, owner})
	}

	rand.Seed(time.Now().UnixNano())
	for i := len(scs) - 1; i > 0; i-- {
		j := rand.Intn(i + 1)
		scs[i], scs[j] = scs[j], scs[i]
	}

	if len(scs) > limit {
		scs = scs[:limit]
	}

	results := make([]map[string]interface{}, len(scs))
	for i, sc := range scs {
		results[i] = map[string]interface{}{
			"scid":  sc.scid,
			"owner": sc.owner,
		}
	}

	a.logToConsole(fmt.Sprintf("[Gnomon] Random SC discovery: Found %d contracts (from %d total)", len(results), len(allSCs)))

	return map[string]interface{}{
		"success":   true,
		"contracts": results,
		"total":     len(allSCs),
	}
}

func (a *App) SearchApps(query string) map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
			"apps":    []map[string]interface{}{},
		}
	}

	results := a.gnomonClient.SearchTELApps(query)

	a.logToConsole(fmt.Sprintf("[...] Search for '%s' returned %d results", query, len(results)))

	return map[string]interface{}{
		"success": true,
		"query":   query,
		"results": results,
		"count":   len(results),
	}
}

func (a *App) GetAppDetails(scid string) map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
		}
	}

	vars := a.gnomonClient.GetAllSCIDVariableDetails(scid)

	details := map[string]interface{}{
		"scid": scid,
	}

	for _, v := range vars {
		key := fmt.Sprintf("%v", v.Key)
		value := fmt.Sprintf("%v", v.Value)

		switch key {
		// V2 headers (TELA standard) - check first
		case "var_header_name":
			details["name"] = decodeHexString(value)
		case "var_header_description":
			details["description"] = decodeHexString(value)
		case "var_header_icon":
			details["icon"] = decodeHexString(value)
		// V1 headers (ART-NFA standard) - fallback if V2 not set
		case "nameHdr":
			if details["name"] == nil {
				details["name"] = decodeHexString(value)
			}
		case "descrHdr":
			if details["description"] == nil {
				details["description"] = decodeHexString(value)
			}
		case "iconURLHdr":
			if details["icon"] == nil {
				details["icon"] = decodeHexString(value)
			}
		case "dURL":
			du := decodeHexString(value)
			details["url"] = du
			details["durl"] = du
		case "owner":
			details["owner"] = value
		}
	}

	return map[string]interface{}{
		"success": true,
		"details": details,
	}
}

// GetAppRating fetches rating data for a SCID
func (a *App) GetAppRating(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STATS] Fetching rating for: %s", scid[:16]+"..."))

	result, err := a.GetRatingResultForSCID(scid)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN]  Rating fetch failed: %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	badge := GetRatingBadgeHTML(result)

	category := ""
	color := "#6b7280"
	categoryNum := uint64(0)

	if result.Count > 0 {
		category, _, categoryNum, _ = ParseRating(uint64(result.Average * 10))
		color = GetRatingColor(categoryNum)
	}

	a.logToConsole(fmt.Sprintf("[OK] Rating: %.1f/10 (%d ratings)", result.Average, result.Count))

	return map[string]interface{}{
		"success":     true,
		"scid":        scid,
		"average":     result.Average,
		"count":       result.Count,
		"likes":       result.Likes,
		"dislikes":    result.Dislikes,
		"badge":       badge,
		"category":    category,
		"categoryNum": categoryNum,
		"color":       color,
		"hasRatings":  result.Count > 0,
	}
}

// GetNameSuggestions returns name suggestions for autocomplete
func (a *App) GetNameSuggestions(prefix string) map[string]interface{} {
	const maxSuggestions = 10
	out := make([]map[string]string, 0)

	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{"success": true, "suggestions": out}
	}

	p := prefix
	if len(p) > 7 && p[:7] == "dero://" {
		p = p[7:]
	}
	p = strings.TrimSpace(strings.ToLower(p))
	apps := a.gnomonClient.GetTELAApps()

	if p == "" {
		type entry struct {
			sc, du, dn, nm string
			h              int64
		}
		list := make([]entry, 0, len(apps))
		for _, app := range apps {
			scid, _ := app["scid"].(string)
			durl, _ := app["durl"].(string)
			dn, _ := app["display_name"].(string)
			nm, _ := app["name"].(string)
			h := a.gnomonClient.LatestInteractionHeight(scid)
			list = append(list, entry{sc: scid, du: durl, dn: dn, nm: nm, h: h})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].h > list[j].h })
		for i := 0; i < len(list) && len(out) < maxSuggestions; i++ {
			name := list[i].du
			if name == "" {
				if list[i].dn != "" {
					name = list[i].dn
				} else {
					name = list[i].nm
				}
			}
			if name == "" {
				continue
			}
			avg := ""
			if rr, err := a.gnomonClient.GetRating(list[i].sc); err == nil && rr != nil && rr.Count > 0 {
				avg = fmt.Sprintf("%.1f", rr.Average)
			}
			out = append(out, map[string]string{
				"name":   name,
				"scid":   list[i].sc,
				"avg":    avg,
				"height": fmt.Sprintf("%d", list[i].h),
			})
		}
		return map[string]interface{}{"success": true, "suggestions": out, "count": len(out)}
	}

	for _, app := range apps {
		scid, _ := app["scid"].(string)
		durl, _ := app["durl"].(string)
		dn, _ := app["display_name"].(string)
		n, _ := app["name"].(string)

		if durl != "" && strings.HasPrefix(strings.ToLower(durl), p) {
			avg := ""
			if rr, err := a.gnomonClient.GetRating(scid); err == nil && rr != nil && rr.Count > 0 {
				avg = fmt.Sprintf("%.1f", rr.Average)
			}
			out = append(out, map[string]string{
				"name":   durl,
				"scid":   scid,
				"avg":    avg,
				"height": fmt.Sprintf("%d", a.gnomonClient.LatestInteractionHeight(scid)),
			})
			if len(out) >= maxSuggestions {
				break
			}
			continue
		}

		cand := dn
		if cand == "" {
			cand = n
		}
		if cand == "" {
			continue
		}
		lower := strings.ToLower(cand)
		if strings.HasPrefix(lower, p) {
			avg := ""
			if rr, err := a.gnomonClient.GetRating(scid); err == nil && rr != nil && rr.Count > 0 {
				avg = fmt.Sprintf("%.1f", rr.Average)
			}
			out = append(out, map[string]string{
				"name":   cand,
				"scid":   scid,
				"avg":    avg,
				"height": fmt.Sprintf("%d", a.gnomonClient.LatestInteractionHeight(scid)),
			})
			if len(out) >= maxSuggestions {
				break
			}
		}
	}

	return map[string]interface{}{
		"success":     true,
		"suggestions": out,
		"count":       len(out),
	}
}

// ================== Simple-Gnomon Feature: Tag System ==================

// GetSCIDsByTag returns all SCIDs with a specific tag
func (a *App) GetSCIDsByTag(tag string) map[string]interface{} {
	store := InitSCIDTagStore()
	scids := store.GetSCIDsByTag(tag)
	return map[string]interface{}{
		"success": true,
		"tag":     tag,
		"scids":   scids,
		"count":   len(scids),
	}
}

// GetAllTags returns all unique tags in use
func (a *App) GetAllTags() map[string]interface{} {
	store := InitSCIDTagStore()
	tags := store.GetAllTags()
	return map[string]interface{}{
		"success": true,
		"tags":    tags,
		"count":   len(tags),
	}
}

// GetSCIDsByClass returns all SCIDs with a specific class
func (a *App) GetSCIDsByClass(class string) map[string]interface{} {
	store := InitSCIDTagStore()
	scids := store.GetSCIDsByClass(class)
	return map[string]interface{}{
		"success": true,
		"class":   class,
		"scids":   scids,
		"count":   len(scids),
	}
}

// GetAllClasses returns all unique classes in use
func (a *App) GetAllClasses() map[string]interface{} {
	store := InitSCIDTagStore()
	classes := store.GetAllClasses()
	return map[string]interface{}{
		"success": true,
		"classes": classes,
		"count":   len(classes),
	}
}

// GetSCIDMetadata returns tag/class metadata for a specific SCID
func (a *App) GetSCIDMetadata(scid string) map[string]interface{} {
	store := InitSCIDTagStore()
	meta := store.GetMetadata(scid)
	if meta == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "SCID not found in tag store",
		}
	}
	return map[string]interface{}{
		"success":  true,
		"scid":     meta.SCID,
		"owner":    meta.Owner,
		"class":    meta.Class,
		"tags":     meta.Tags,
		"headers":  meta.Headers,
		"deployed": meta.DeployHeight,
	}
}

// GetTagStats returns statistics about the tag store
func (a *App) GetTagStats() map[string]interface{} {
	store := InitSCIDTagStore()
	stats := store.GetStats()
	stats["success"] = true
	return stats
}

// GetTELAAppsWithTags returns TELA apps with full tag/class metadata
func (a *App) GetTELAAppsWithTags() map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon is not running",
			"apps":    []map[string]interface{}{},
		}
	}

	apps := a.gnomonClient.GetTELAApps()
	store := InitSCIDTagStore()

	for i, app := range apps {
		if scid, ok := app["scid"].(string); ok {
			meta := store.GetMetadata(scid)
			if meta != nil {
				apps[i]["class"] = meta.Class
				apps[i]["tags"] = meta.Tags
			}
		}
	}

	return map[string]interface{}{
		"success": true,
		"apps":    apps,
		"count":   len(apps),
	}
}

// RebuildTagIndex rebuilds the tag store from Gnomon data
func (a *App) RebuildTagIndex() map[string]interface{} {
	if !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon must be running to rebuild tag index",
		}
	}

	a.logToConsole("[TAGS] Rebuilding tag index...")
	store := InitSCIDTagStore()
	count := store.RebuildFromGnomon(a.gnomonClient, a.daemonClient)

	a.logToConsole(fmt.Sprintf("[TAGS] Rebuild complete: classified %d SCIDs", count))

	return map[string]interface{}{
		"success": true,
		"count":   count,
		"message": fmt.Sprintf("Rebuilt tag index with %d SCIDs", count),
	}
}

// ================== Simple-Gnomon Feature: WebSocket API ==================

// StartGnomonWSServer starts the Gnomon WebSocket API
func (a *App) StartGnomonWSServer(address string) map[string]interface{} {
	if a.gnomonWSServer != nil && a.gnomonWSServer.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "WebSocket server already running",
			"address": a.gnomonWSServer.GetAddress(),
		}
	}

	a.gnomonWSServer = NewGnomonWSServer(a, address)

	go func() {
		if err := a.gnomonWSServer.Start(context.Background()); err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Gnomon WS server failed: %v", err))
		}
	}()

	// Wait a moment for the server to start
	time.Sleep(100 * time.Millisecond)

	a.logToConsole(fmt.Sprintf("[GNOMON-WS] WebSocket API started on ws://%s/ws", a.gnomonWSServer.GetAddress()))

	return map[string]interface{}{
		"success": true,
		"address": a.gnomonWSServer.GetAddress(),
		"port":    a.gnomonWSServer.GetPort(),
	}
}

// StopGnomonWSServer stops the Gnomon WebSocket API
func (a *App) StopGnomonWSServer() map[string]interface{} {
	if a.gnomonWSServer == nil || !a.gnomonWSServer.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "WebSocket server not running",
		}
	}

	a.gnomonWSServer.Stop()
	a.logToConsole("[GNOMON-WS] WebSocket API stopped")

	return map[string]interface{}{
		"success": true,
	}
}

// GetGnomonWSStatus returns the WebSocket server status
func (a *App) GetGnomonWSStatus() map[string]interface{} {
	if a.gnomonWSServer == nil {
		return map[string]interface{}{
			"running": false,
		}
	}

	return map[string]interface{}{
		"running": a.gnomonWSServer.IsRunning(),
		"address": a.gnomonWSServer.GetAddress(),
		"port":    a.gnomonWSServer.GetPort(),
		"clients": a.gnomonWSServer.GetClientCount(),
	}
}
