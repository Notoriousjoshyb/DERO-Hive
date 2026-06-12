package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/civilware/Gnomon/indexer"
	"github.com/civilware/Gnomon/storage"
	"github.com/civilware/Gnomon/structures"
	"github.com/deroproject/derohe/globals"
)

const gnomonSCID = "bb43c3eb626ee767c9f305772a6666f7c7300441a0ad8538a0799eb4f12ebcd2"

// GnomonClient manages the Gnomon indexer for TELA content discovery
type GnomonClient struct {
	Indexer         *indexer.Indexer
	fastsync        bool
	parallelBlocks  int
	dbPath          string
	dbType          string
	running         bool
	disableFastsync bool  // Temporary flag to disable fastsync for next start (used after resync)
	startFromHeight int64 // If > 0, start indexing from this height instead of 0 or current
	appsLoaded      bool  // True when GetDiscoveredApps() has completed at least once
}

const maxParallelBlocks = 10

// TELA search filter - matches the canonical TELA-INDEX-1/TELA-DOC-1 init() snippet
// verbatim, so TELA app discovery only indexes those contracts.
const gnomonSearchFilter = `Function init() Uint64
10 IF EXISTS("owner") == 0 THEN GOTO 30
20 RETURN 1
30 STORE("owner", address())`

// tokenSearchFilter is the broader entry that lets the token auto-scan discover
// held tokens/NFAs. Gnomon OR-matches every filter substring (strings.Contains),
// so adding "Function Initialize" indexes the standard token + Artificer NFA
// (ART-NFA-MS1) families, whose initializer is "Function InitializePrivate()" —
// the strict TELA snippet above never matches them. This is the same substring
// Engram filters on. Curated TELA consumers re-filter at query time (isIndex), so
// the wider index does not pollute app discovery.
const tokenSearchFilter = `Function Initialize`

// gnomonFilters is the active filter set passed to the indexer. Changing this set
// requires a one-time resync (see migrateGnomonFilterVersionIfNeeded) because
// Gnomon never re-examines already-indexed blocks against a new filter — only a
// fresh fastsync applies it to the full SC snapshot.
var gnomonFilters = []string{gnomonSearchFilter, tokenSearchFilter}

// NewGnomonClient creates a new Gnomon client
func NewGnomonClient(dbType string) *GnomonClient {
	if dbType == "" {
		dbType = "gravdb" // Default to GravDB
	}

	return &GnomonClient{
		fastsync:       true,
		parallelBlocks: 5,
		dbType:         dbType,
		running:        false,
	}
}

// Start initializes and starts the Gnomon indexer
func (g *GnomonClient) Start(endpoint string, network string) error {
	if g.running {
		return fmt.Errorf("gnomon already running")
	}

	// Strip http:// or https:// prefix - Gnomon's indexer.Connect() adds "ws://" internally
	// So we need to pass just "host:port" to avoid "ws://http://host:port/ws"
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	// Determine data path based on network
	// Use UserHomeDir instead of Getwd for packaged macOS apps
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	// Create network-specific path in ~/.dero/hologram/datashards/
	baseDir := filepath.Join(homeDir, ".dero", "hologram", "datashards")
	basePath := filepath.Join(baseDir, "gnomon")
	switch network {
	case "simulator":
		basePath = filepath.Join(baseDir, "gnomon_simulator")
	case "mainnet":
		basePath = filepath.Join(baseDir, "gnomon_mainnet")
	}

	g.dbPath = basePath

	// Ensure directory exists
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return fmt.Errorf("failed to create gnomon directory: %w", err)
	}

	// Initialize storage backends
	boltDB, boltErr := storage.NewBBoltDB(basePath, "gnomon")
	gravDB, gravErr := storage.NewGravDB(basePath, "25ms")

	var height int64
	switch g.dbType {
	case "boltdb":
		if boltErr != nil {
			if !strings.HasPrefix(boltErr.Error(), "[") {
				boltErr = fmt.Errorf("[NewBBoltDB] %s", boltErr)
			}
			return boltErr
		}

		height, err = boltDB.GetLastIndexHeight()
		if err != nil {
			// Gnomon DB is a rebuildable cache; if it is unreadable, reset it now to
			// avoid StartDaemonMode hitting logger.Fatalf() on the same path.
			g.log(fmt.Sprintf("[Gnomon] BoltDB read failed (%v). Resetting cache at %s", err, basePath))
			g.cleanDBPath(basePath)
			boltDB, boltErr = storage.NewBBoltDB(basePath, "gnomon")
			if boltErr != nil {
				if !strings.HasPrefix(boltErr.Error(), "[") {
					boltErr = fmt.Errorf("[NewBBoltDB] %s", boltErr)
				}
				return boltErr
			}
			height, err = boltDB.GetLastIndexHeight()
			if err != nil {
				return fmt.Errorf("[Gnomon] BoltDB recovery failed: %w", err)
			}
		}
	default: // gravdb
		if gravErr != nil {
			return fmt.Errorf("[NewGravDB] %s", gravErr)
		}

		height, err = gravDB.GetLastIndexHeight()
		if err != nil {
			// Gnomon DB is a rebuildable cache; if it is unreadable, reset it now to
			// avoid StartDaemonMode hitting logger.Fatalf() on the same path.
			g.log(fmt.Sprintf("[Gnomon] GravDB read failed (%v). Resetting cache at %s", err, basePath))
			g.cleanDBPath(basePath)
			gravDB, gravErr = storage.NewGravDB(basePath, "25ms")
			if gravErr != nil {
				return fmt.Errorf("[NewGravDB] %s", gravErr)
			}
			height, err = gravDB.GetLastIndexHeight()
			if err != nil {
				return fmt.Errorf("[Gnomon] GravDB recovery failed: %w", err)
			}
		}
	}

	// Sanity check: if the stored height is beyond the daemon's chain height
	// the chain was reset (e.g. simulator restart).  Clean the DB and start
	// from 0 so Gnomon doesn't sit idle waiting for blocks that will never come.
	if height > 0 {
		if chainHeight := queryDaemonHeight(endpoint); chainHeight >= 0 && height > chainHeight {
			g.log(fmt.Sprintf("[Gnomon] Stored height %d exceeds chain height %d — resetting DB", height, chainHeight))
			g.cleanDBPath(basePath)
			height = 0
			// Re-open storage after clean
			switch g.dbType {
			case "boltdb":
				boltDB, boltErr = storage.NewBBoltDB(basePath, "gnomon")
				if boltErr != nil {
					return fmt.Errorf("[NewBBoltDB] %s", boltErr)
				}
			default:
				gravDB, gravErr = storage.NewGravDB(basePath, "25ms")
				if gravErr != nil {
					return fmt.Errorf("[NewGravDB] %s", gravErr)
				}
			}
		}
	}

	// Known exclusions (if any)
	exclusions := []string{gnomonSCID}

	// Search filter set: the strict TELA snippet (app discovery) plus the broader
	// token/NFA entry (auto-scan discovery). See gnomonFilters.
	filter := gnomonFilters

	// Fastsync configuration
	// For simulator mode, disable fastsync to ensure we index from block 0
	// This is important because simulator chains are small and we need to find
	// all deployed contracts, not just new ones
	useFastsync := g.fastsync
	forceFastsync := true
	if network == "simulator" {
		useFastsync = false
		forceFastsync = false
	}

	// If disableFastsync flag is set (e.g., after a resync), disable fastsync
	// This ensures we index from the stored height (or 0 if DB was cleaned)
	if g.disableFastsync {
		useFastsync = false
		forceFastsync = false
		g.disableFastsync = false // Reset the flag after use
	}

	// If a specific start height is set, use it instead of the stored height
	if g.startFromHeight > 0 {
		height = g.startFromHeight
		g.startFromHeight = 0 // Reset after use
	}

	config := &structures.FastSyncConfig{
		Enabled:           useFastsync,
		SkipFSRecheck:     false,
		ForceFastSync:     forceFastsync,
		ForceFastSyncDiff: 100,
		NoCode:            false,
	}

	// Create indexer
	g.Indexer = indexer.NewIndexer(
		gravDB,
		boltDB,
		g.dbType,
		filter,
		height,
		endpoint,
		"daemon",
		false, // mbllookup
		false, // closeondisconnect
		config,
		exclusions,
		false, // storeintegrators (new in feat-addscidtoindex-wsserver)
	)

	// Initialize logging
	indexer.InitLog(globals.Arguments, os.Stdout)

	// Start indexer in background
	go g.Indexer.StartDaemonMode(g.parallelBlocks)

	g.running = true

	return nil
}

// Stop closes the Gnomon indexer
func (g *GnomonClient) Stop() {
	if g.Indexer != nil {
		g.Indexer.Close()
		g.Indexer = nil
		g.running = false
		g.appsLoaded = false // Reset apps loaded state
	}
}

// SetDisableFastsync sets a flag to disable fastsync on the next start
// This is used after a resync to ensure we index from block 0
func (g *GnomonClient) SetDisableFastsync(disable bool) { g.disableFastsync = disable }

// SetStartFromHeight sets a specific height to start indexing from
// This is useful for resyncing recent contracts without indexing the entire chain
func (g *GnomonClient) SetStartFromHeight(height int64) { g.startFromHeight = height }

// SetAppsLoaded sets the appsLoaded flag (called by App.GetDiscoveredApps)
func (g *GnomonClient) SetAppsLoaded(loaded bool) { g.appsLoaded = loaded }

// IsAppsLoaded returns whether apps have been loaded at least once
func (g *GnomonClient) IsAppsLoaded() bool { return g.appsLoaded }

// IsRunning returns whether Gnomon is running
func (g *GnomonClient) IsRunning() bool { return g.running && g.Indexer != nil }

// GetStatus returns the current indexing status
func (g *GnomonClient) GetStatus() map[string]any {
	if !g.IsRunning() {
		return map[string]any{
			"running":        false,
			"connecting":     false,
			"indexed_height": 0,
			"chain_height":   0,
			"progress":       0.0,
		}
	}

	var (
		indexed, chain = g.Indexer.LastIndexedHeight, g.Indexer.ChainHeight

		// If chain height is 0, Gnomon is still trying to connect to the daemon
		// This happens when the connection loop in StartDaemonMode is retrying
		connecting = chain == 0

		progress = 0.0
	)

	if chain > 0 {
		progress = (float64(indexed) / float64(chain)) * 100.0
	}

	return map[string]any{
		"running":        true,
		"connecting":     connecting,
		"indexed_height": indexed,
		"chain_height":   chain,
		"progress":       progress,
		"db_type":        g.dbType,
		"db_path":        g.dbPath,
		"apps_loaded":    g.appsLoaded,
	}
}

// GetAllOwnersAndSCIDs returns all indexed smart contracts
func (g *GnomonClient) GetAllOwnersAndSCIDs() map[string]string {
	if !g.IsRunning() {
		return make(map[string]string)
	}

	switch g.Indexer.DBType {
	case "gravdb":
		return g.Indexer.GravDBBackend.GetAllOwnersAndSCIDs()
	case "boltdb":
		return g.Indexer.BBSBackend.GetAllOwnersAndSCIDs()
	default:
		return make(map[string]string)
	}
}

// GetAllSCIDVariableDetails returns all variables for a smart contract
func (g *GnomonClient) GetAllSCIDVariableDetails(scid string) []*structures.SCIDVariable {
	if !g.IsRunning() {
		return nil
	}

	switch g.Indexer.DBType {
	case "gravdb":
		return g.Indexer.GravDBBackend.GetAllSCIDVariableDetails(scid)
	case "boltdb":
		return g.Indexer.BBSBackend.GetAllSCIDVariableDetails(scid)
	default:
		return nil
	}
}

// GetSCIDValuesByKey returns values for a specific key in a smart contract
func (g *GnomonClient) GetSCIDValuesByKey(scid string, key any) (valuesstring []string, valuesuint64 []uint64) {
	if !g.IsRunning() {
		return nil, nil
	}

	switch g.Indexer.DBType {
	case "gravdb":
		return g.Indexer.GravDBBackend.GetSCIDValuesByKey(scid, key, g.Indexer.ChainHeight, true)
	case "boltdb":
		return g.Indexer.BBSBackend.GetSCIDValuesByKey(scid, key, g.Indexer.ChainHeight, true)
	default:
		return nil, nil
	}
}

// GetSCIDKeysByValue returns keys for a specific value in a smart contract
func (g *GnomonClient) GetSCIDKeysByValue(scid string, value any) (valuesstring []string, valuesuint64 []uint64) {
	if !g.IsRunning() {
		return nil, nil
	}

	switch g.Indexer.DBType {
	case "gravdb":
		return g.Indexer.GravDBBackend.GetSCIDKeysByValue(scid, value, g.Indexer.ChainHeight, true)
	case "boltdb":
		return g.Indexer.BBSBackend.GetSCIDKeysByValue(scid, value, g.Indexer.ChainHeight, true)
	default:
		return nil, nil
	}
}

// GetTELAApps returns all discovered TELA INDEX applications (filters out DOCs)
func (g *GnomonClient) GetTELAApps() []map[string]any {
	apps := make([]map[string]any, 0)

	if !g.IsRunning() {
		return apps
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {

		var (
			// Get variables for this SCID
			vars = g.GetAllSCIDVariableDetails(scid)

			data = map[string]any{"scid": scid, "owner": owner, "is_index": false}

			// Extract TELA-specific variables
			app, isIndex, _, _ = allocateData(vars, data)
		)

		// Only include INDEX contracts (apps with DOC references)
		// This filters out individual DOC files which can't be rendered standalone
		if isIndex {

			var (
				// Generate clean display name (prefer dURL when present)
				displayName = ""

				// Get fields
				name, hasName        = app["name"].(string)
				description, hasDesc = app["description"].(string)
				url, hasURL          = app["url"].(string)

				// Helper function to check if a string is a URL/file path
				isURLFunc = func(s string) bool {
					if s == "" {
						return false
					}
					for _, substr := range []string{
						"http",
						"://",
						".png",
						".jpg",
						".jpeg",
						".svg",
						".gif",
						".ico",
						"/ipfs/",
						"/images/",
						"/icons/",
						"/assets/",
						"gateway.",
						"blob/",
						"i.ibb.",
						"bafybeih",
						"avatars.",
						"raw.github",
						".world/",
						".com/",
						".org/",
						".io/",
					} {
						if strings.Contains(strings.ToLower(s), substr) {
							return true
						}
					}
					return false
				}

				// Check both description and name for URLs
				isDescURL = hasDesc && isURLFunc(description)
				isNameURL = hasName && isURLFunc(name)
			)

			// Decision tree - prefer dURL if present
			if du, hasDU := app["durl"].(string); hasDU && du != "" {
				displayName = du
			} else if hasDesc && description != "" && !isDescURL {
				// Use description if it's NOT a URL
				displayName = description
			} else if hasName && name != "" && !isNameURL {
				// Use name if description was URL/empty and name is clean
				displayName = name
			} else if hasURL && url != "" {
				// Use cleaned dURL domain
				displayName = cleanupAppName(url)
			} else {
				// Nothing usable - generic name
				displayName = "TELA App"
			}

			// Limit to 40 characters for uniformity
			displayName = strings.TrimSpace(displayName)
			if len(displayName) > 40 {
				displayName = displayName[:37] + "..."
			}

			// Final paranoid safety check - if result still looks like URL, replace it
			if isURLFunc(displayName) {
				// It's STILL a URL after all that - use generic name
				if hasURL && url != "" {
					cleaned := cleanupAppName(url)
					// Triple-check the cleaned version
					if !isURLFunc(cleaned) && !strings.Contains(cleaned, "/") {
						displayName = cleaned
					} else {
						displayName = "TELA App"
					}
				} else {
					displayName = "TELA App"
				}
			}

			app["display_name"] = displayName
			apps = append(apps, app)
		}
	}

	return apps
}

// GetTELALibraries returns all TELA content tagged as libraries (.lib suffix in dURL)
func (g *GnomonClient) GetTELALibraries() []map[string]any {
	libs := make([]map[string]any, 0)

	if !g.IsRunning() {
		return libs
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {

		var (
			vars                 = g.GetAllSCIDVariableDetails(scid)
			params               = map[string]any{"scid": scid, "owner": owner, "is_index": false, "doc_count": 0}
			lib, _, _, hasLibTag = allocateData(vars, params)
		)

		// Only include content tagged as library
		if hasLibTag {
			libs = append(libs, lib)
		}
	}

	return libs
}

// SearchTELApps searches for TELA apps by name or description
func (g *GnomonClient) SearchTELApps(query string) []map[string]any {

	var (
		allApps = g.GetTELAApps()
		results = make([]map[string]any, 0)
		q       = strings.ToLower(query)
		has     = strings.Contains
	)

	for _, app := range allApps {
		name := ""
		if n, ok := app["name"].(string); ok {
			name = strings.ToLower(n)
		}

		description := ""
		if d, ok := app["description"].(string); ok {
			description = strings.ToLower(d)
		}

		if has(name, q) || has(description, q) {
			results = append(results, app)
		}
	}

	return results
}

// LatestInteractionHeight returns the most recent interaction height for a SCID
func (g *GnomonClient) LatestInteractionHeight(scid string) int64 {
	if !g.IsRunning() {
		return 0
	}
	heights := g.Indexer.GravDBBackend.GetSCIDInteractionHeight(scid)
	var max int64 = 0
	for _, h := range heights {
		if h > max {
			max = h
		}
	}
	return max
}

// AddSCIDToIndex manually indexes a SCID that doesn't match the default search filter.
// Implements civilware's feat-addscidtoindex-wsserver feature — the official fix for
// Bug #1 (Gnomon fastsync: historical SCID data missing).
//
// Parameters:
//   - scid: 64-char hex SCID to index
//   - varstoreonly: if true, skips SC-code fetch (faster, but less classifier signal)
//   - skipfsrecheck: if true, short-circuits if SCID is already indexed
//
// Returns error on failure, nil on success. After success, the SCID's current
// variable state is stored and it becomes discoverable via GetAllOwnersAndSCIDs.
func (g *GnomonClient) AddSCIDToIndex(scid string, varstoreonly, skipfsrecheck bool) error {
	if !g.IsRunning() {
		return fmt.Errorf("gnomon not running")
	}
	if len(strings.TrimSpace(scid)) != 64 {
		return fmt.Errorf("invalid scid: expected 64 hex chars")
	}

	// Pre-fill the existing owner row: the indexer unconditionally stages
	// StoreOwner(scid, fsi.Owner) on this path, so an empty FastSyncImport would
	// blank a previously-stored owner on every re-index (varstoreonly bypasses
	// the already-validated early-return). Passing the current value through
	// makes re-indexing owner-preserving; a first-time index writes "" as before.
	owner := ""
	switch g.Indexer.DBType {
	case "gravdb":
		owner = g.Indexer.GravDBBackend.GetOwner(scid)
	case "boltdb":
		owner = g.Indexer.BBSBackend.GetOwner(scid)
	}

	scidsToAdd := make(map[string]*structures.FastSyncImport)
	scidsToAdd[scid] = &structures.FastSyncImport{Owner: owner}

	return g.Indexer.AddSCIDToIndex(scidsToAdd, skipfsrecheck, varstoreonly)
}

// CheckAppSupportsEpoch determines if a TELA app supports EPOCH crowd mining
// Looks for EPOCH-related variables or functions in the smart contract
func (g *GnomonClient) CheckAppSupportsEpoch(scid string) bool {
	if !g.IsRunning() {
		return false
	}

	vars := g.GetAllSCIDVariableDetails(scid)
	if vars == nil {
		return false
	}

	// Check for EPOCH-related variables
	epochKeywords := []string{
		"epoch",
		"EPOCH",
		"epochEnabled",
		"epoch_enabled",
		"epochSupport",
		"crowd_mining",
		"crowdMining",
	}

	for _, v := range vars {
		key := fmt.Sprintf("%v", v.Key)
		keyLower := strings.ToLower(key)

		for _, keyword := range epochKeywords {
			if strings.Contains(keyLower, strings.ToLower(keyword)) {
				return true
			}
		}
	}

	return false
}

// GetTELAAppsWithEpochInfo returns all TELA apps with EPOCH support information
func (g *GnomonClient) GetTELAAppsWithEpochInfo() []map[string]any {
	apps := g.GetTELAApps()

	for i, app := range apps {
		if scid, ok := app["scid"].(string); ok {
			supportsEpoch := g.CheckAppSupportsEpoch(scid)
			apps[i]["supports_epoch"] = supportsEpoch
			if supportsEpoch {
				apps[i]["epoch_badge"] = "EPOCH Enabled"
			}
		}
	}

	return apps
}

// ResolveName tries to resolve a human-friendly TELA app name to a SCID using the Gnomon index.
// Matching strategy (strict first, then relaxed):
// 1) Exact match on display_name (case-insensitive)
// 2) Exact match on name (case-insensitive)
// 3) Prefix match on display_name/name if unique
func (g *GnomonClient) ResolveName(name string) (string, bool) {
	if !g.IsRunning() {
		return "", false
	}

	target := strings.ToLower(strings.TrimSpace(name))
	if target == "" {
		return "", false
	}

	apps := g.GetTELAApps()

	// exact matches first (pick newest if multiple)
	exactCandidates := make([]string, 0)
	for _, app := range apps {
		if dn, ok := app["display_name"].(string); ok && strings.ToLower(dn) == target {
			if scid, ok := app["scid"].(string); ok && scid != "" {
				exactCandidates = append(exactCandidates, scid)
			}
		}
		if n, ok := app["name"].(string); ok && strings.ToLower(n) == target {
			if scid, ok := app["scid"].(string); ok && scid != "" {
				exactCandidates = append(exactCandidates, scid)
			}
		}
	}
	if scid, ok := g.pickNewestSCID(exactCandidates); ok {
		return scid, true
	}

	// prefix match (collect candidates and pick newest)
	candidates := make([]string, 0)
	for _, app := range apps {
		if dn, ok := app["display_name"].(string); ok && strings.HasPrefix(strings.ToLower(dn), target) {
			if scid, ok := app["scid"].(string); ok && scid != "" {
				candidates = append(candidates, scid)
			}
		} else if n, ok := app["name"].(string); ok && strings.HasPrefix(strings.ToLower(n), target) {
			if scid, ok := app["scid"].(string); ok && scid != "" {
				candidates = append(candidates, scid)
			}
		}
	}
	if scid, ok := g.pickNewestSCID(candidates); ok {
		return scid, true
	}
	return "", false
}

// ResolveDURL resolves an exact dURL (case-insensitive) to a SCID, or returns false
// Handles both with and without "dero://" prefix
func (g *GnomonClient) ResolveDURL(durl string) (string, bool) {
	if !g.IsRunning() {
		return "", false
	}
	target := strings.ToLower(strings.TrimSpace(durl))
	if target == "" {
		return "", false
	}

	// Normalize: remove dero:// prefix if present
	targetNorm := target
	targetNorm = strings.TrimPrefix(targetNorm, "dero://")

	apps := g.GetTELAApps()
	candidates := make([]string, 0)
	for _, app := range apps {
		if du, ok := app["durl"].(string); ok {
			// Normalize stored dURL too
			duNorm := strings.ToLower(strings.TrimSpace(du))
			duNorm = strings.TrimPrefix(duNorm, "dero://")

			if duNorm == targetNorm {
				if scid, ok := app["scid"].(string); ok && scid != "" {
					candidates = append(candidates, scid)
				}
			}
		}
	}
	if scid, ok := g.pickNewestSCID(candidates); ok {
		return scid, true
	}
	return "", false
}

// pickNewestSCID returns the candidate with the highest interaction height.
// Ties fall back to lexicographical SCID order for deterministic results.
func (g *GnomonClient) pickNewestSCID(candidates []string) (string, bool) {
	if len(candidates) == 0 {
		return "", false
	}

	best := candidates[0]
	bestHeight := g.LatestInteractionHeight(best)

	for _, scid := range candidates[1:] {
		h := g.LatestInteractionHeight(scid)
		if h > bestHeight || (h == bestHeight && scid > best) {
			best = scid
			bestHeight = h
		}
	}

	return best, true
}

// GetRating fetches rating data for a SCID from Gnomon indexed data
func (g *GnomonClient) GetRating(scid string) (*RatingResult, error) {
	if !g.IsRunning() {
		return nil, fmt.Errorf("gnomon is not running")
	}

	// Get all variables for this SCID
	vars := g.GetAllSCIDVariableDetails(scid)
	if len(vars) == 0 {
		// No data indexed yet, return empty result
		return &RatingResult{
			SCID:     scid,
			Ratings:  make([]Rating, 0),
			Likes:    0,
			Dislikes: 0,
			Average:  0.0,
			Count:    0,
		}, nil
	}

	result := &RatingResult{
		SCID:     scid,
		Ratings:  make([]Rating, 0),
		Likes:    0,
		Dislikes: 0,
		Average:  0.0,
		Count:    0,
	}

	// Parse variables
	for _, v := range vars {
		var (
			key, _, value = parseVars(v)
			decoded       = decodeHexIfNeeded(value)
		)

		switch key {
		case "likes":
			// Parse likes count
			if val, err := parseUint64Safe(decoded); err == nil {
				result.Likes = val
			}

		case "dislikes":
			// Parse dislikes count
			if val, err := parseUint64Safe(decoded); err == nil {
				result.Dislikes = val
			}

		default:
			// Check if this is a rating (key is a DERO address)
			if strings.HasPrefix(strings.ToLower(key), "dero") {
				// Parse rating string (format: "rating_height")

				parts := strings.Split(decoded, "_")
				if len(parts) < 2 {
					continue
				}

				ratingNum, err := parseUint64Safe(parts[0])
				if err != nil || ratingNum > 99 {
					continue
				}

				heightNum, err := parseUint64Safe(parts[1])
				if err != nil {
					continue
				}

				result.Ratings = append(result.Ratings, Rating{
					Address: key,
					Rating:  ratingNum,
					Height:  heightNum,
				})
			}
		}
	}

	// Calculate average from categories (first digit of rating)
	if len(result.Ratings) > 0 {
		var sum uint64
		for _, r := range result.Ratings {
			category := r.Rating / 10 // Extract category (0-9)
			sum += category
		}
		result.Average = float64(sum) / float64(len(result.Ratings))
		result.Count = len(result.Ratings)
	}

	return result, nil
}

// decodeHexIfNeeded decodes a hex string if it looks like hex, otherwise returns as-is
func decodeHexIfNeeded(s string) string {
	// If already a number string, return it
	if _, err := parseUint64Safe(s); err == nil {
		return s
	}
	// Try hex decoding
	return decodeHexString(s)
}

// parseUint64Safe safely parses a string to uint64
func parseUint64Safe(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty string")
	}
	return strconv.ParseUint(s, 10, 64)
}

// SearchByKey searches all indexed SCIDs for those containing a specific key store
// Returns SCIDs with the key's values
func (g *GnomonClient) SearchByKey(key string) []map[string]any {
	results := make([]map[string]any, 0)

	if !g.IsRunning() {
		return results
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {
		// Check if this SCID has the key
		valuesString, valuesUint64 := g.GetSCIDValuesByKey(scid, key)

		if len(valuesString) > 0 || len(valuesUint64) > 0 {
			var (
				// Get additional info (dURL, name)
				vars            = g.GetAllSCIDVariableDetails(scid)
				params          = map[string]any{"scid": scid, "owner": owner, "key": key}
				result, _, _, _ = allocateData(vars, params)
			)

			// Add found values
			if len(valuesString) > 0 {
				result["values_string"] = valuesString
			}
			if len(valuesUint64) > 0 {
				result["values_uint64"] = valuesUint64
			}

			results = append(results, result)
		}
	}

	return results
}

// SearchByValue searches all indexed SCIDs for those containing a specific value store
// Returns SCIDs with the value's keys
func (g *GnomonClient) SearchByValue(value any) []map[string]any {
	results := make([]map[string]any, 0)

	if !g.IsRunning() {
		return results
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {
		// Check if this SCID has the value
		keysString, keysUint64 := g.GetSCIDKeysByValue(scid, value)

		if len(keysString) > 0 || len(keysUint64) > 0 {
			var (
				params = map[string]any{"scid": scid, "owner": owner, "value": value}

				// Get additional info (dURL, name)
				vars = g.GetAllSCIDVariableDetails(scid)

				result, _, _, _ = allocateData(vars, params)
			)
			// Add found keys
			if len(keysString) > 0 {
				result["keys_string"] = keysString
			}
			if len(keysUint64) > 0 {
				result["keys_uint64"] = keysUint64
			}

			results = append(results, result)
		}
	}

	return results
}

// SearchCodeLine returns all indexed SCIDs for code searching
// Note: Code search requires daemon calls - this just returns SCIDs for the caller to check
// The actual code fetching/searching is done by the App layer which has daemon access
func (g *GnomonClient) SearchCodeLine(line string) []map[string]any {
	results := make([]map[string]any, 0)

	if !g.IsRunning() || line == "" {
		return results
	}

	// Get all SCIDs with metadata
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {
		var (
			vars            = g.GetAllSCIDVariableDetails(scid)
			params          = map[string]any{"scid": scid, "owner": owner}
			result, _, _, _ = allocateData(vars, params)
		)
		results = append(results, result)
	}

	return results
}

// CleanDB deletes the Gnomon database for a specific network
// Must stop Gnomon first before calling this
// queryDaemonHeight does a quick JSON-RPC call to get the daemon's chain height.
// The endpoint is in "host:port" form (no scheme).  Returns -1 on any error.
func queryDaemonHeight(endpoint string) int64 {
	url := fmt.Sprintf("http://%s/json_rpc", endpoint)
	body := []byte(`{"jsonrpc":"2.0","id":"1","method":"DERO.GetInfo"}`)
	client := newPrivacyHTTPClient(3 * time.Second) // gated by Privacy Mode (privacy_transport.go)
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return -1
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result struct {
		Result struct {
			TopoHeight int64 `json:"topoheight"`
		} `json:"result"`
	}
	if json.Unmarshal(data, &result) != nil {
		return -1
	}
	return result.Result.TopoHeight
}

// cleanDBPath removes all files in a gnomon DB directory.
func (g *GnomonClient) cleanDBPath(dbPath string) {
	if err := os.RemoveAll(dbPath); err != nil {
		log.Printf("[Gnomon] Failed to clean DB at %s: %v", dbPath, err)
	}
	os.MkdirAll(dbPath, 0755)
}

// log prints a message to the standard logger with a [Gnomon] prefix.
func (g *GnomonClient) log(msg string) {
	log.Println(msg)
}

func (g *GnomonClient) CleanDB(network string) error {
	if g.IsRunning() {
		return fmt.Errorf("gnomon must be stopped before cleaning database")
	}

	// Determine data path based on network
	// Use UserHomeDir instead of Getwd for packaged macOS apps
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	baseDir := filepath.Join(homeDir, ".dero", "hologram", "datashards")
	var dbPath string
	switch strings.ToLower(network) {
	case "mainnet":
		dbPath = filepath.Join(baseDir, "gnomon_mainnet")
	case "simulator":
		dbPath = filepath.Join(baseDir, "gnomon_simulator")
	default:
		// Legacy path (just "gnomon" folder)
		dbPath = filepath.Join(baseDir, "gnomon")
	}

	// Check if path exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return fmt.Errorf("database path does not exist: %s", dbPath)
	}

	// Remove the directory
	if err := os.RemoveAll(dbPath); err != nil {
		return fmt.Errorf("failed to remove database: %w", err)
	}

	return nil
}

// gnomonDBDir returns the on-disk Gnomon DB directory for a network, matching the
// paths used by Start/CleanDB.
func gnomonDBDir(network string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	baseDir := filepath.Join(homeDir, ".dero", "hologram", "datashards")
	switch strings.ToLower(network) {
	case "mainnet":
		return filepath.Join(baseDir, "gnomon_mainnet"), nil
	case "simulator":
		return filepath.Join(baseDir, "gnomon_simulator"), nil
	default:
		return filepath.Join(baseDir, "gnomon"), nil
	}
}

// currentFilterVersion is a stable fingerprint of the active filter set. If the
// filter set changes in a future build, this hash changes, which is what triggers
// the one-time resync so the new filter applies to already-indexed history.
func currentFilterVersion() string {
	sum := sha256.Sum256([]byte(strings.Join(gnomonFilters, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// readStoredFilterVersion returns the filter version recorded for a network's
// existing index, or "" if none (fresh DB or pre-versioning build).
func readStoredFilterVersion(network string) string {
	dir, err := gnomonDBDir(network)
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(dir, "filter_version"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// writeFilterVersion records the active filter version next to a network's index
// so a later start can detect a filter change. Best-effort; failure is non-fatal.
func writeFilterVersion(network string) {
	dir, err := gnomonDBDir(network)
	if err != nil {
		return
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(dir, "filter_version"), []byte(currentFilterVersion()), 0600)
}

// GetMyDOCs returns all DOCs owned by the specified wallet address
// If docType is non-empty, filters by that specific document type
func (g *GnomonClient) GetMyDOCs(walletAddress string, docType string) []map[string]any {
	results := make([]map[string]any, 0)

	if !g.IsRunning() || walletAddress == "" {
		return results
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {
		// Filter by owner
		if !strings.EqualFold(owner, walletAddress) {
			continue
		}
		var (
			vars = g.GetAllSCIDVariableDetails(scid)

			// Check if this is a DOC (has docType variable)
			params           = map[string]any{"scid": scid, "owner": owner, "type": "DOC"}
			doc, _, isDOC, _ = allocateData(vars, params)
		)

		// Skip if not a DOC
		if !isDOC {
			continue
		}

		// Filter by docType if specified
		scidDocType := doc["docType"].(string)
		if docType != "" && scidDocType != docType {
			continue
		}

		// Generate display name
		results = append(results, doc)
	}

	return results
}

// GetMyINDEXes returns all INDEXes owned by the specified wallet address
func (g *GnomonClient) GetMyINDEXes(walletAddress string) []map[string]any {
	results := make([]map[string]any, 0)

	if !g.IsRunning() || walletAddress == "" {
		return results
	}

	// Get all SCIDs
	scids := g.GetAllOwnersAndSCIDs()

	for scid, owner := range scids {
		// Filter by owner
		if !strings.EqualFold(owner, walletAddress) {
			continue
		}

		var (
			vars = g.GetAllSCIDVariableDetails(scid)
			// Check if this is an INDEX (has DOC1 or more DOC references)
			params               = map[string]any{"scid": scid, "owner": owner, "type": "INDEX"}
			index, isINDEX, _, _ = allocateData(vars, params)
		)

		// Skip if not an INDEX
		if !isINDEX {
			continue
		}

		results = append(results, index)
	}

	return results
}

// GetAllDOCTypes returns all unique docType values from indexed DOCs
func (g *GnomonClient) GetAllDOCTypes() []string {
	types := make(map[string]bool)

	if !g.IsRunning() {
		return []string{}
	}

	scids := g.GetAllOwnersAndSCIDs()

	for scid := range scids {
		vars := g.GetAllSCIDVariableDetails(scid)
		for _, v := range vars {
			var (
				key, present, value = parseVars(v)
				isDoc               = key == "docType"
			)
			if isDoc && present {
				docType := value
				if docType != "" {
					types[docType] = true
				}
			}
		}
	}

	result := make([]string, 0, len(types))
	for t := range types {
		result = append(result, t)
	}
	return result
}

// cleanupAppName cleans up app names for better display
func cleanupAppName(name string) string {
	has := strings.Contains

	original := name

	// Remove common URL prefixes
	trim := strings.TrimPrefix
	name = trim(name, "https://")
	name = trim(name, "http://")
	name = trim(name, "www.")

	// If it looks like a URL or long path, extract domain name only
	if has(name, "/") || has(name, ".") {
		parts := strings.Split(name, "/")

		// Get domain (first part before /)
		domain := parts[0]

		// Extract main domain name (remove subdomains and TLD for cleaner look)
		domainParts := strings.Split(domain, ".")
		if len(domainParts) >= 2 {
			// For things like "gateway.pinata.cloud" -> "Pinata"
			// For "raw.githubusercontent.com" -> "Github"
			// For "avatars.githubusercontent.com" -> "Github"

			mainPart := ""
			if len(domainParts) >= 3 {
				// Use second-to-last part (before TLD)
				mainPart = domainParts[len(domainParts)-2]
			} else {
				// Use first part
				mainPart = domainParts[0]
			}

			// Special handling for known services
			switch {
			case has(domain, "github"):
				mainPart = "GitHub"
			case has(domain, "pinata"):
				mainPart = "Pinata"
			case has(domain, "dero"):
				mainPart = "DERO"
			case has(domain, "loc.gov"):
				mainPart = "Library of Congress"
			default:
				// Capitalize first letter
				if len(mainPart) > 0 {
					mainPart = strings.ToUpper(string(mainPart[0])) + mainPart[1:]
				}
			}

			return mainPart
		}
	}

	// If not a URL, just clean it up
	name = strings.TrimSpace(name)

	// Limit length to 40 characters for uniformity
	if len(name) > 40 {
		return name[:37] + "..."
	}

	// If we couldn't clean it up, return first 40 chars of original
	if name == "" && len(original) > 0 {
		if len(original) > 40 {
			return original[:37] + "..."
		}
		return original
	}

	return name
}

func parseVars(v *structures.SCIDVariable) (key string, present bool, val string) {
	return fmt.Sprintf("%v", v.Key), v.Value != nil, fmt.Sprintf("%v", v.Value)
}

func allocateData(
	vars []*structures.SCIDVariable,
	params map[string]any,
) (
	data map[string]any, isIndex, isDOC, hasLibTag bool,
) {

	data = params

	var (
		docSCIDs = make([]string, 0)
		docCount = 0
	)

	for _, v := range vars {
		var (
			key, present, value = parseVars(v)
			decodedValue        = decodeHexString(value)
		)

		switch {
		// V2 headers (TELA standard) - check first
		case key == "var_header_name":
			if present {
				data["name"] = decodedValue
			}
		case key == "var_header_description":
			if present {
				data["description"] = decodedValue
			}
		case key == "var_header_icon":
			if present {
				data["icon"] = decodedValue
			}
		// V1 headers (ART-NFA standard) - fallback if V2 not set
		case key == "nameHdr":
			if present && data["name"] == nil {
				data["name"] = decodedValue
			}
		case key == "descrHdr":
			if present && data["description"] == nil {
				data["description"] = decodedValue
			}
		case key == "iconURLHdr":
			if present && data["icon"] == nil {
				data["icon"] = decodedValue
			}
		case key == "dURL":
			if present {
				du := decodedValue
				data["url"] = du
				data["durl"] = du
				// Check for .lib suffix
				if strings.HasSuffix(du, ".lib") {
					hasLibTag = true
				}
			}
		case key == "subDir":
			if present {
				data["subDir"] = decodedValue
			}
		case key == "docType":
			// This is a DOC (single file library)
			data["type"] = "DOC"
			isDOC = true
			if present {
				data["docType"] = value
			}
		case strings.HasPrefix(key, "DOC") && len(key) <= 5:
			// Mark as TELA INDEX if it has DOC references
			data["is_index"] = true
			data["type"] = "INDEX"
			isIndex = true
			docCount++
			if docCount > 0 {
				docSCIDs = append(docSCIDs, value)
				data["doc_count"] = docCount
				data["doc_scids"] = docSCIDs
			}
		}
	}

	// Set type if not already set
	if _, hasType := data["type"]; !hasType {
		if _, hasDocType := data["docType"]; hasDocType {
			data["type"] = "DOC"
		} else {
			data["type"] = "SC"
		}
	}

	displayName := ""
	if durl, ok := data["durl"].(string); ok && durl != "" {
		displayName = durl
	} else if name, ok := data["name"].(string); ok && name != "" {
		displayName = name
	} else if isIndex {
		displayName = "INDEX"
	} else if isDOC {
		displayName = "DOC"
	} else if hasLibTag {
		displayName = "TELA Library"
	}

	data["display_name"] = displayName

	return data, isIndex, isDOC, hasLibTag
}
