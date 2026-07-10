package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// SearchResult represents a unified search result
type SearchResult struct {
	Success bool                   `json:"success"`
	Type    string                 `json:"type"` // block, tx, scid, durl, address
	Query   string                 `json:"query"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Error   string                 `json:"error,omitempty"`
	Message string                 `json:"message,omitempty"` // Helpful context message (e.g., "This hash is a block hash")
}

// OmniSearch performs a smart search that auto-detects the query type
// and fetches appropriate data
func (a *App) OmniSearch(query string) SearchResult {
	query = strings.TrimSpace(query)
	if query == "" {
		return SearchResult{
			Success: false,
			Error:   "Empty search query",
		}
	}

	// Detect query type
	queryType := detectQueryType(query)
	a.logToConsole(fmt.Sprintf("[...] OmniSearch: query=%s, detected_type=%s", truncateQuery(query), queryType))

	switch queryType {
	case "block":
		return a.searchBlock(query)
	case "tx":
		return a.searchTransaction(query)
	case "scid":
		return a.searchSmartContract(query)
	case "hash":
		// 64-char hex - could be TX or SCID, try both
		return a.searchHashAmbiguous(query)
	case "durl":
		return a.searchDURL(query)
	case "address":
		return a.searchAddress(query)
	case "key":
		return a.searchByKeyWrapper(query)
	case "value":
		return a.searchByValueWrapper(query)
	case "code":
		return a.searchCodeLineWrapper(query)
	default:
		// Before giving up, check if this might be a TELA app name in Gnomon
		// This handles cases like "explorer" (without .tela suffix)
		if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
			lowerQuery := strings.ToLower(query)
			apps := a.gnomonClient.GetTELAApps()
			for _, app := range apps {
				durl, _ := app["durl"].(string)
				name, _ := app["name"].(string)
				displayName, _ := app["display_name"].(string)
				// Check if query matches durl, name, or display_name (case-insensitive)
				if strings.EqualFold(durl, lowerQuery) ||
					strings.EqualFold(name, lowerQuery) ||
					strings.EqualFold(displayName, lowerQuery) {
					a.logToConsole(fmt.Sprintf("[...] OmniSearch: Found TELA app match for '%s' -> treating as durl", query))
					return a.searchDURL("dero://" + durl)
				}
			}
		}
		return SearchResult{
			Success: false,
			Type:    "unknown",
			Query:   query,
			Error:   "Unable to detect search type. Try a block height, transaction hash, SCID, dero://name, dero1... address, key:<key>, value:<value>, or code:<text>.",
		}
	}
}

// detectQueryType determines what type of query the input is
func detectQueryType(query string) string {
	trimmed := strings.TrimSpace(query)
	lowerQuery := strings.ToLower(trimmed)

	// IMPORTANT: Check 64-char hex FIRST - before block height!
	// This prevents SCIDs like "0000...0001" (all digits) from being misidentified as block heights
	if regexp.MustCompile(`^[a-fA-F0-9]{64}$`).MatchString(trimmed) {
		return "hash"
	}

	// Block height: pure numeric (but not 64 chars - those are hashes)
	// Realistic block heights are under 20 digits
	if regexp.MustCompile(`^\d+$`).MatchString(trimmed) && len(trimmed) < 20 {
		return "block"
	}

	// dURL: starts with dero://
	if strings.HasPrefix(lowerQuery, "dero://") {
		return "durl"
	}

	// dURL: ends with .tela (TELA app domain pattern)
	// Matches: explorer.tela, my-app.tela, test123.tela, sub.domain.tela
	if regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*\.tela$`).MatchString(lowerQuery) {
		return "durl"
	}

	// Address: starts with dero1
	if strings.HasPrefix(lowerQuery, "dero1") {
		return "address"
	}

	// Key search: starts with key:
	if strings.HasPrefix(lowerQuery, "key:") {
		return "key"
	}

	// Value search: starts with value:
	if strings.HasPrefix(lowerQuery, "value:") {
		return "value"
	}

	// Code line search: starts with code: or line:
	if strings.HasPrefix(lowerQuery, "code:") || strings.HasPrefix(lowerQuery, "line:") {
		return "code"
	}

	return "unknown"
}

// searchBlock searches for a block by height or hash
// Uses GetBlockExtended for comprehensive block data
func (a *App) searchBlock(query string) SearchResult {
	// Use GetBlockExtended for full block data (handles both height and hash)
	result := a.GetBlockExtended(query)

	if !result["success"].(bool) {
		errMsg := "Block not found"
		if e, ok := result["error"].(string); ok {
			errMsg = e
		}
		return SearchResult{
			Success: false,
			Type:    "block",
			Query:   query,
			Error:   errMsg,
		}
	}

	return SearchResult{
		Success: true,
		Type:    "block",
		Query:   query,
		Data:    result,
	}
}

// searchTransaction searches for a transaction by hash
func (a *App) searchTransaction(query string) SearchResult {
	// Use the existing GetTransactionExtended method
	txResult := a.GetTransactionExtended(query)

	if !txResult["success"].(bool) {
		errMsg := "Transaction not found"
		if e, ok := txResult["error"].(string); ok {
			errMsg = e
		}
		return SearchResult{
			Success: false,
			Type:    "tx",
			Query:   query,
			Error:   errMsg,
		}
	}

	return SearchResult{
		Success: true,
		Type:    "tx",
		Query:   query,
		Data:    txResult,
	}
}

// searchSmartContract searches for a smart contract by SCID
func (a *App) searchSmartContract(query string) SearchResult {
	// Normalize SCID to lowercase (DERO requires lowercase hex)
	normalizedSCID := strings.ToLower(strings.TrimSpace(query))
	
	a.logToConsole(fmt.Sprintf("[SC] Searching smart contract: %s", truncateQuery(normalizedSCID)))

	result, err := a.daemonClient.GetSC(normalizedSCID, true, true)
	if err != nil {
		// Log the actual error for debugging
		a.logToConsole(fmt.Sprintf("[ERR] GetSC failed for %s: %v", truncateQuery(normalizedSCID), err))
		return SearchResult{
			Success: false,
			Type:    "sc",
			Query:   query,
			Error:   fmt.Sprintf("Smart contract lookup failed: %v", err),
		}
	}
	if normalized, ok := normalizeDEROGetSCResult(result).(map[string]interface{}); ok {
		result = normalized
	}

	// Log what we got back from daemon
	a.logToConsole(fmt.Sprintf("[SC] Result keys: %v", getMapKeys(result)))

	// The daemon returns:
	// - "code": the smart contract code
	// - "balance": the contract's DERO balance
	// - "stringkeys": map of string variable names to values
	// - "uint64keys": map of uint64 variable names to values
	// Map this to what the Explorer expects
	scData := map[string]interface{}{
		"code":       result["code"],
		"balance":    result["balance"],
		"stringkeys": result["stringkeys"],
		"uint64keys": result["uint64keys"],
	}

	// Log code length for debugging
	code, _ := result["code"].(string)
	if code == "" {
		// Fallback: extract from deployment TX (simulator may not populate GetSC code)
		txResult, err := a.daemonClient.Call("DERO.GetTransaction", map[string]interface{}{
			"txs_hashes": []string{normalizedSCID},
		})
		if err == nil {
			if txMap, ok := txResult.(map[string]interface{}); ok {
				if txsHex, ok := txMap["txs_as_hex"].([]interface{}); ok && len(txsHex) > 0 {
					if hexStr, ok := txsHex[0].(string); ok {
						code = ExtractSCCodeFromDeploymentTx(hexStr)
						if code != "" {
							a.logToConsole(fmt.Sprintf("[SC] Extracted code from deployment TX (%d chars)", len(code)))
							result["code"] = code
							scData["code"] = code
						}
					}
				}
			}
		}
	}
	if code != "" {
		a.logToConsole(fmt.Sprintf("[SC] Code length: %d chars", len(code)))
	} else {
		a.logToConsole("[WARN] SC code not found or not a string (likely a normal TX)")
		return SearchResult{
			Success: false,
			Type:    "sc",
			Query:   query,
			Error:   "Not a valid smart contract (no code found)",
		}
	}

	return SearchResult{
		Success: true,
		Type:    "sc",
		Query:   query,
		Data:    scData,
	}
}

// Helper to get map keys for logging
func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// Known hardcoded SCIDs that should be checked before block hash lookup
var hardcodedSCIDs = map[string]bool{
	"0000000000000000000000000000000000000000000000000000000000000001": true, // Genesis/Name Service SC
}

// searchHashAmbiguous handles 64-char hex strings that could be TX, Block Hash, or SCID
// For known hardcoded SCIDs, tries SCID first. Otherwise: TX -> Block -> SCID
// IMPORTANT: In DERO, SC deployment TX hash = SCID, so we check for both!
func (a *App) searchHashAmbiguous(query string) SearchResult {
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	
	// Check if this is a known hardcoded SCID - try SCID FIRST for these
	if hardcodedSCIDs[normalizedQuery] {
		a.logToConsole("[...] Known hardcoded SCID detected - trying SCID first...")
		scResult := a.searchSmartContract(normalizedQuery)
		if scResult.Success {
			a.logToConsole("[OK] Found as smart contract (hardcoded SCID)")
			scResult.Type = "sc"
			return scResult
		}
		// If SCID lookup failed, continue with normal search order
		a.logToConsole("[WARN] Hardcoded SCID lookup failed, trying other types...")
	}
	
	a.logToConsole("[...] Ambiguous 64-char hash - checking SC first (deployment TX = SCID)...")

	// NEW: Try as smart contract FIRST
	// In DERO, when you deploy an SC, the TX hash becomes the SCID
	// So if this hash is a valid SC, show it as SC (more useful view)
	scResult := a.searchSmartContract(normalizedQuery)
	if scResult.Success {
		a.logToConsole("[OK] Found as smart contract (SCID)")
		scResult.Type = "sc"
		
		// Also check if there's a corresponding TX (the deployment transaction)
		txResult := a.searchTransaction(query)
		if txResult.Success {
			// Add deployment TX info to SC result for reference
			scResult.Data["hasDeploymentTx"] = true
			scResult.Data["deploymentTxHash"] = query
			scResult.Message = "This is a Smart Contract. The same hash is also the deployment transaction."
			a.logToConsole("[OK] SC also has deployment TX - added reference")
		}
		
		return scResult
	}

	// Try as transaction (if not an SC)
	txResult := a.searchTransaction(query)
	if txResult.Success {
		a.logToConsole("[OK] Found as transaction (not an SC)")
		return txResult
	}

	// Try as block hash (common case - user copied block hash thinking it was TX hash)
	blockResult := a.searchBlock(query)
	if blockResult.Success {
		a.logToConsole("[OK] Found as block hash")
		// Add helpful message for user
		blockResult.Message = "This hash is a block hash. Showing block details."
		return blockResult
	}

	// None found
	return SearchResult{
		Success: false,
		Type:    "hash",
		Query:   query,
		Error:   "No transaction, block, or smart contract found with this hash",
	}
}

// searchDURL searches for a dApp by dURL (dero://name or just name.tela)
// Uses graceful degradation: validates with Gnomon if available, but always navigates
func (a *App) searchDURL(query string) SearchResult {
	// Extract name - handle both dero://name and bare name.tela formats
	name := strings.TrimPrefix(strings.ToLower(query), "dero://")
	name = strings.TrimSpace(name)

	if name == "" {
		return SearchResult{
			Success: false,
			Type:    "durl",
			Query:   query,
			Error:   "Invalid dURL format",
		}
	}

	normalizedDURL := "dero://" + name
	
	// Try to get rich metadata from Gnomon if available
	result := a.FetchByDURL(name)

	if result["success"].(bool) {
		// Gnomon found the app - return rich metadata
		result["durl"] = normalizedDURL
		result["validated"] = true
		return SearchResult{
			Success: true,
			Type:    "durl",
			Query:   query,
			Data:    result,
		}
	}
	
	// Gnomon unavailable or app not indexed yet - still allow navigation
	// Browser will handle the actual resolution
	a.logToConsole(fmt.Sprintf("[...] dURL search: Gnomon unavailable, allowing navigation to %s", name))

	return SearchResult{
		Success: true,
		Type:    "durl",
		Query:   query,
		Data: map[string]interface{}{
			"durl":      normalizedDURL,
			"name":      name,
			"success":   true,
			"validated": false, // Indicates Gnomon didn't validate, but navigation is allowed
		},
	}
}

// searchAddress searches for address-related data
// Returns owned TELA apps when Gnomon is available
func (a *App) searchAddress(query string) SearchResult {
	// Basic DERO address validation
	if !strings.HasPrefix(strings.ToLower(query), "dero1") {
		return SearchResult{
			Success: false,
			Type:    "address",
			Query:   query,
			Error:   "Invalid DERO address format",
		}
	}

	// Build base response data
	data := map[string]interface{}{
		"address":   query,
		"valid":     true,
		"network":   "mainnet",
		"hasGnomon": a.gnomonClient != nil && a.gnomonClient.IsRunning(),
	}

	// If Gnomon is running, find TELA apps owned by this address
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		a.logToConsole("[NET] Gnomon available - searching for owned TELA apps...")

		// Get all SCID → owner mappings
		scidOwners := a.gnomonClient.GetAllOwnersAndSCIDs()

		// Find SCIDs owned by this address
		ownedSCIDs := make([]string, 0)
		for scid, owner := range scidOwners {
			if strings.EqualFold(owner, query) {
				ownedSCIDs = append(ownedSCIDs, scid)
			}
		}

		// Get full app details for owned SCIDs
		ownedApps := make([]map[string]interface{}, 0)
		if len(ownedSCIDs) > 0 {
			allApps := a.gnomonClient.GetTELAApps()
			for _, app := range allApps {
				if scid, ok := app["scid"].(string); ok {
					for _, owned := range ownedSCIDs {
						if scid == owned {
							ownedApps = append(ownedApps, app)
							break
						}
					}
				}
			}
		}

		data["gnomonData"] = "available"
		data["owned_apps"] = ownedApps
		data["owned_count"] = len(ownedApps)
		data["total_scids_owned"] = len(ownedSCIDs)

		a.logToConsole(fmt.Sprintf("[Search] Found %d TELA apps owned by address", len(ownedApps)))
	} else {
		data["gnomonData"] = "unavailable"
		data["owned_apps"] = []map[string]interface{}{}
		data["owned_count"] = 0
		data["note"] = "Enable Gnomon in settings for address lookup"
	}

	return SearchResult{
		Success: true,
		Type:    "address",
		Query:   query,
		Data:    data,
	}
}

// searchByKeyWrapper wraps SearchByKey for OmniSearch
func (a *App) searchByKeyWrapper(query string) SearchResult {
	// Extract key from "key:<key>"
	key := strings.TrimPrefix(strings.ToLower(query), "key:")
	key = strings.TrimSpace(key)

	if key == "" {
		return SearchResult{
			Success: false,
			Type:    "key",
			Query:   query,
			Error:   "Key cannot be empty. Use format: key:<keyname>",
		}
	}

	// Check if Gnomon is running
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return SearchResult{
			Success: false,
			Type:    "key",
			Query:   query,
			Error:   "Gnomon indexer is not running. Enable it in Settings to search by key.",
		}
	}

	results := a.gnomonClient.SearchByKey(key)
	a.logToConsole(fmt.Sprintf("[OK] Key search '%s' found %d results", key, len(results)))

	return SearchResult{
		Success: true,
		Type:    "key",
		Query:   query,
		Data: map[string]interface{}{
			"key":     key,
			"results": results,
			"count":   len(results),
		},
	}
}

// searchByValueWrapper wraps SearchByValue for OmniSearch
func (a *App) searchByValueWrapper(query string) SearchResult {
	// Extract value from "value:<value>"
	value := strings.TrimPrefix(strings.ToLower(query), "value:")
	value = strings.TrimSpace(value)

	if value == "" {
		return SearchResult{
			Success: false,
			Type:    "value",
			Query:   query,
			Error:   "Value cannot be empty. Use format: value:<searchvalue>",
		}
	}

	// Check if Gnomon is running
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return SearchResult{
			Success: false,
			Type:    "value",
			Query:   query,
			Error:   "Gnomon indexer is not running. Enable it in Settings to search by value.",
		}
	}

	results := a.gnomonClient.SearchByValue(value)
	a.logToConsole(fmt.Sprintf("[OK] Value search '%s' found %d results", value, len(results)))

	return SearchResult{
		Success: true,
		Type:    "value",
		Query:   query,
		Data: map[string]interface{}{
			"value":   value,
			"results": results,
			"count":   len(results),
		},
	}
}

// searchCodeLineWrapper wraps SearchCodeLine for OmniSearch
// This performs actual code searching by fetching code from the daemon
func (a *App) searchCodeLineWrapper(query string) SearchResult {
	// Extract code line from "code:<line>" or "line:<line>"
	line := query
	if strings.HasPrefix(strings.ToLower(query), "code:") {
		line = strings.TrimPrefix(query, "code:")
		line = strings.TrimPrefix(line, "CODE:")
	} else if strings.HasPrefix(strings.ToLower(query), "line:") {
		line = strings.TrimPrefix(query, "line:")
		line = strings.TrimPrefix(line, "LINE:")
	}
	line = strings.TrimSpace(line)

	if line == "" {
		return SearchResult{
			Success: false,
			Type:    "code",
			Query:   query,
			Error:   "Code line cannot be empty. Use format: code:<text>",
		}
	}

	// Check if Gnomon is running
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return SearchResult{
			Success: false,
			Type:    "code",
			Query:   query,
			Error:   "Gnomon indexer is not running. Enable it in Settings to search code.",
		}
	}

	// Get all indexed SCIDs with metadata
	scids := a.gnomonClient.SearchCodeLine(line) // Returns all SCIDs with metadata
	a.logToConsole(fmt.Sprintf("[...] Code search: checking %d SCIDs for '%s'", len(scids), line))

	lineLower := strings.ToLower(line)
	matchedResults := make([]map[string]interface{}, 0)

	// Limit to first 100 SCIDs to avoid overwhelming the daemon
	maxToCheck := 100
	if len(scids) > maxToCheck {
		scids = scids[:maxToCheck]
	}

	// Fetch code from daemon for each SCID and search
	for _, scidInfo := range scids {
		scid, ok := scidInfo["scid"].(string)
		if !ok || scid == "" {
			continue
		}

		// Get SC code from daemon
		scResult, err := a.daemonClient.GetSC(scid, false, false) // code only, no variables
		if err != nil {
			continue
		}

		code, ok := scResult["code"].(string)
		if !ok || code == "" {
			continue
		}

		// Check if code contains the search term
		if !strings.Contains(strings.ToLower(code), lineLower) {
			continue
		}

		// Found a match - extract matching lines
		codeLines := strings.Split(code, "\n")
		matchingLines := make([]map[string]interface{}, 0)
		
		for lineNum, codeLine := range codeLines {
			if strings.Contains(strings.ToLower(codeLine), lineLower) {
				matchingLines = append(matchingLines, map[string]interface{}{
					"lineNum": lineNum + 1,
					"content": strings.TrimSpace(codeLine),
				})
				// Limit to 5 matches per contract
				if len(matchingLines) >= 5 {
					break
				}
			}
		}

		result := map[string]interface{}{
			"scid":       scid,
			"owner":      scidInfo["owner"],
			"name":       scidInfo["name"],
			"durl":       scidInfo["durl"],
			"type":       scidInfo["type"],
			"matches":    matchingLines,
			"matchCount": len(matchingLines),
		}

		matchedResults = append(matchedResults, result)

		// Limit total results to 50
		if len(matchedResults) >= 50 {
			break
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Code search '%s' found %d contracts", line, len(matchedResults)))

	return SearchResult{
		Success: true,
		Type:    "code",
		Query:   query,
		Data: map[string]interface{}{
			"line":    line,
			"results": matchedResults,
			"count":   len(matchedResults),
		},
	}
}

// Helper function to truncate long queries for logging
func truncateQuery(query string) string {
	if len(query) > 20 {
		return query[:10] + "..." + query[len(query)-10:]
	}
	return query
}

// =============================================
// Search Exclusions Filter System
// =============================================

// SearchExclusions manages the search filter/exclusion list
type SearchExclusions struct {
	Exclusions []string `json:"exclusions"`
	MinLikes   int      `json:"minLikes"` // Minimum likes percentage (0-100)
	mu         sync.RWMutex
	filePath   string
}

var searchExclusions *SearchExclusions

// initSearchExclusions initializes the search exclusions system
func initSearchExclusions() *SearchExclusions {
	if searchExclusions != nil {
		return searchExclusions
	}

	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}

	searchExclusions = &SearchExclusions{
		Exclusions: make([]string, 0),
		MinLikes:   0, // Default: don't filter by likes
		filePath:   filepath.Join(dir, "datashards", "search_exclusions.json"),
	}

	// Load existing exclusions
	searchExclusions.load()

	return searchExclusions
}

// load reads exclusions from disk
func (se *SearchExclusions) load() {
	se.mu.Lock()
	defer se.mu.Unlock()

	data, err := os.ReadFile(se.filePath)
	if err != nil {
		return // File doesn't exist yet
	}

	var loaded SearchExclusions
	if err := json.Unmarshal(data, &loaded); err != nil {
		return
	}

	se.Exclusions = loaded.Exclusions
	se.MinLikes = loaded.MinLikes
}

// save writes exclusions to disk
func (se *SearchExclusions) save() error {
	se.mu.RLock()
	defer se.mu.RUnlock()

	// Ensure directory exists
	dir := filepath.Dir(se.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(se, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(se.filePath, data, 0644)
}

// Add adds an exclusion filter
func (se *SearchExclusions) Add(filter string) bool {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return false
	}

	se.mu.Lock()
	defer se.mu.Unlock()

	// Check if already exists
	for _, ex := range se.Exclusions {
		if strings.EqualFold(ex, filter) {
			return false
		}
	}

	se.Exclusions = append(se.Exclusions, filter)
	go se.save()
	return true
}

// Remove removes an exclusion filter
func (se *SearchExclusions) Remove(filter string) bool {
	se.mu.Lock()
	defer se.mu.Unlock()

	for i, ex := range se.Exclusions {
		if strings.EqualFold(ex, filter) {
			se.Exclusions = append(se.Exclusions[:i], se.Exclusions[i+1:]...)
			go se.save()
			return true
		}
	}
	return false
}

// Clear removes all exclusion filters
func (se *SearchExclusions) Clear() {
	se.mu.Lock()
	defer se.mu.Unlock()

	se.Exclusions = make([]string, 0)
	go se.save()
}

// List returns all exclusion filters
func (se *SearchExclusions) List() []string {
	se.mu.RLock()
	defer se.mu.RUnlock()

	result := make([]string, len(se.Exclusions))
	copy(result, se.Exclusions)
	return result
}

// SetMinLikes sets the minimum likes percentage filter
func (se *SearchExclusions) SetMinLikes(minLikes int) {
	se.mu.Lock()
	defer se.mu.Unlock()

	if minLikes < 0 {
		minLikes = 0
	}
	if minLikes > 100 {
		minLikes = 100
	}
	se.MinLikes = minLikes
	go se.save()
}

// GetMinLikes returns the minimum likes percentage filter
func (se *SearchExclusions) GetMinLikes() int {
	se.mu.RLock()
	defer se.mu.RUnlock()
	return se.MinLikes
}

// ShouldExclude checks if a dURL should be excluded
func (se *SearchExclusions) ShouldExclude(durl string) bool {
	se.mu.RLock()
	defer se.mu.RUnlock()

	durlLower := strings.ToLower(durl)
	for _, ex := range se.Exclusions {
		if strings.Contains(durlLower, strings.ToLower(ex)) {
			return true
		}
	}
	return false
}

// =============================================
// App Methods for Search Exclusions
// =============================================

// GetSearchExclusions returns all current search exclusion filters
func (a *App) GetSearchExclusions() map[string]interface{} {
	se := initSearchExclusions()
	return map[string]interface{}{
		"success":    true,
		"exclusions": se.List(),
		"minLikes":   se.GetMinLikes(),
		"count":      len(se.List()),
	}
}

// AddSearchExclusion adds a new exclusion filter
func (a *App) AddSearchExclusion(filter string) map[string]interface{} {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "Filter cannot be empty",
		}
	}

	se := initSearchExclusions()
	if se.Add(filter) {
		a.logToConsole(fmt.Sprintf("[OK] Added search exclusion: %s", filter))
		return map[string]interface{}{
			"success":    true,
			"filter":     filter,
			"exclusions": se.List(),
		}
	}

	return map[string]interface{}{
		"success": false,
		"error":   "Filter already exists",
	}
}

// RemoveSearchExclusion removes an exclusion filter
func (a *App) RemoveSearchExclusion(filter string) map[string]interface{} {
	se := initSearchExclusions()
	if se.Remove(filter) {
		a.logToConsole(fmt.Sprintf("[OK] Removed search exclusion: %s", filter))
		return map[string]interface{}{
			"success":    true,
			"filter":     filter,
			"exclusions": se.List(),
		}
	}

	return map[string]interface{}{
		"success": false,
		"error":   "Filter not found",
	}
}

// ClearSearchExclusions removes all exclusion filters
func (a *App) ClearSearchExclusions() map[string]interface{} {
	se := initSearchExclusions()
	se.Clear()
	a.logToConsole("[OK] Cleared all search exclusions")
	return map[string]interface{}{
		"success":    true,
		"exclusions": []string{},
	}
}

// SetSearchMinLikes sets the minimum likes percentage for search results
func (a *App) SetSearchMinLikes(minLikes int) map[string]interface{} {
	se := initSearchExclusions()
	se.SetMinLikes(minLikes)
	a.logToConsole(fmt.Sprintf("[OK] Set minimum likes filter to %d%%", minLikes))
	return map[string]interface{}{
		"success":  true,
		"minLikes": se.GetMinLikes(),
	}
}

// FilterSearchResults applies exclusion filters to search results
func (a *App) FilterSearchResults(results []map[string]interface{}) []map[string]interface{} {
	se := initSearchExclusions()

	filtered := make([]map[string]interface{}, 0)
	for _, result := range results {
		// Check dURL exclusion
		if durl, ok := result["durl"].(string); ok {
			if se.ShouldExclude(durl) {
				continue
			}
		}

		// Check min likes filter
		minLikes := se.GetMinLikes()
		if minLikes > 0 {
			likes, hasLikes := result["likes"].(uint64)
			dislikes, hasDislikes := result["dislikes"].(uint64)
			if hasLikes && hasDislikes {
				total := likes + dislikes
				if total > 0 {
					ratio := float64(likes) / float64(total) * 100
					if ratio < float64(minLikes) {
						continue
					}
				}
			}
		}

		filtered = append(filtered, result)
	}

	return filtered
}

// =============================================
// "My Content" Search Methods
// =============================================

// SearchMyDOCs returns all DOCs owned by the connected wallet
// docType can be empty to get all DOCs, or a specific type like "text/html"
func (a *App) SearchMyDOCs(docType string) map[string]interface{} {
	// Get wallet address
	walletAddress := a.getConnectedWalletAddress()
	if walletAddress == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet connected. Open a wallet to search your content.",
			"results": []map[string]interface{}{},
		}
	}

	// Check if Gnomon is running
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is not running. Enable it in Settings to search your content.",
			"results": []map[string]interface{}{},
		}
	}

	results := a.gnomonClient.GetMyDOCs(walletAddress, docType)
	a.logToConsole(fmt.Sprintf("[OK] Found %d DOCs owned by wallet", len(results)))

	return map[string]interface{}{
		"success":       true,
		"results":       results,
		"count":         len(results),
		"walletAddress": walletAddress,
		"docType":       docType,
	}
}

// SearchMyINDEXes returns all INDEXes owned by the connected wallet
func (a *App) SearchMyINDEXes() map[string]interface{} {
	// Get wallet address
	walletAddress := a.getConnectedWalletAddress()
	if walletAddress == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet connected. Open a wallet to search your content.",
			"results": []map[string]interface{}{},
		}
	}

	// Check if Gnomon is running
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is not running. Enable it in Settings to search your content.",
			"results": []map[string]interface{}{},
		}
	}

	results := a.gnomonClient.GetMyINDEXes(walletAddress)
	a.logToConsole(fmt.Sprintf("[OK] Found %d INDEXes owned by wallet", len(results)))

	return map[string]interface{}{
		"success":       true,
		"results":       results,
		"count":         len(results),
		"walletAddress": walletAddress,
	}
}

// SearchMyContent returns all content (DOCs and INDEXes) owned by the connected wallet
func (a *App) SearchMyContent() map[string]interface{} {
	a.logToConsole("[SEARCH] Loading My Content...")
	
	// Get wallet address
	walletAddress := a.getConnectedWalletAddress()
	if walletAddress == "" {
		a.logToConsole("[WARN] My Content: No wallet connected")
		return map[string]interface{}{
			"success": false,
			"error":   "No wallet connected. Open a wallet to search your content.",
			"docs":    []map[string]interface{}{},
			"indexes": []map[string]interface{}{},
		}
	}
	a.logToConsole(fmt.Sprintf("[SEARCH] Wallet address: %s...", walletAddress[:20]))

	// Check if Gnomon is running
	if a.gnomonClient == nil {
		a.logToConsole("[WARN] My Content: Gnomon client is nil")
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is not available. Start Gnomon in Settings to index your deployed content.",
			"docs":    []map[string]interface{}{},
			"indexes": []map[string]interface{}{},
		}
	}
	
	if !a.gnomonClient.IsRunning() {
		a.logToConsole("[WARN] My Content: Gnomon is not running")
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is not running. Start Gnomon in Settings to index your deployed content, or use the SCID directly in the Browser.",
			"docs":    []map[string]interface{}{},
			"indexes": []map[string]interface{}{},
		}
	}

	a.logToConsole("[SEARCH] Querying Gnomon for owned contracts...")
	
	docs := a.gnomonClient.GetMyDOCs(walletAddress, "")
	indexes := a.gnomonClient.GetMyINDEXes(walletAddress)

	a.logToConsole(fmt.Sprintf("[OK] My Content: %d DOCs, %d INDEXes", len(docs), len(indexes)))

	return map[string]interface{}{
		"success":       true,
		"docs":          docs,
		"indexes":       indexes,
		"docsCount":     len(docs),
		"indexesCount":  len(indexes),
		"totalCount":    len(docs) + len(indexes),
		"walletAddress": walletAddress,
	}
}

// GetAvailableDOCTypes returns all unique docType values from indexed DOCs
func (a *App) GetAvailableDOCTypes() map[string]interface{} {
	if a.gnomonClient == nil || !a.gnomonClient.IsRunning() {
		return map[string]interface{}{
			"success": false,
			"error":   "Gnomon indexer is not running",
			"types":   []string{},
		}
	}

	types := a.gnomonClient.GetAllDOCTypes()

	return map[string]interface{}{
		"success": true,
		"types":   types,
		"count":   len(types),
	}
}

// getConnectedWalletAddress returns the address of the connected wallet
// Checks both local wallet and simulator wallet
func (a *App) getConnectedWalletAddress() string {
	// Check local wallet first
	walletManager.RLock()
	if walletManager.isOpen && walletManager.wallet != nil {
		addr := walletManager.wallet.GetAddress().String()
		walletManager.RUnlock()
		return addr
	}
	walletManager.RUnlock()

	// Check simulator wallet (primary wallet = wallet #0)
	if a.simulatorManager != nil && a.simulatorManager.walletManager != nil {
		if a.simulatorManager.walletManager.IsSetup() {
			return a.simulatorManager.walletManager.GetPrimaryAddress()
		}
	}

	return ""
}

