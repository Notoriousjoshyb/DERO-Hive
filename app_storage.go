// Copyright 2026 HOLOGRAM Project. All rights reserved.
// Storage Management - Unified Data & Storage section backend.
// Enumerates on-disk artifacts, reports sizes, dispatches clears by category/tier.

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// === Public types — Wails marshals these to the frontend ===

// StorageCategory describes one clearable artifact.
type StorageCategory struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Tier        string `json:"tier"`        // "cache" | "appdata" | "settings" | "infra"
	Color       string `json:"color"`       // legend swatch hint for the UI
	Path        string `json:"path"`        // absolute filesystem path; "" for non-file-backed
	SizeBytes   int64  `json:"size_bytes"`
	ItemLabel   string `json:"item_label"`  // "6 apps", "3 filters" — for non-byte categories
	LastWrite   int64  `json:"last_write"`  // unix seconds; 0 if unknown
	Recovery    string `json:"recovery"`    // one-line recovery hint
	Clearable   bool   `json:"clearable"`
	BlockedBy   string `json:"blocked_by"`  // why if !Clearable
	InUse       bool   `json:"in_use"`      // service is actively writing
	Managed     bool   `json:"managed"`     // false for wallet row
}

// StorageUsage is the full payload returned by GetStorageUsage.
type StorageUsage struct {
	BasePath   string            `json:"base_path"`
	TotalBytes int64             `json:"total_bytes"`
	Categories []StorageCategory `json:"categories"`
}

// === Category identifiers ===
// Keeping these as constants so the dispatcher and the frontend stay in sync.

const (
	StorageGnomonIndex      = "gnomon_index"
	StorageOfflineCache     = "offline_cache"
	StoragederodBinary      = "derod_binary"
	StorageTELAClones       = "tela_clones"
	StorageSimulatorData    = "simulator_data"
	StorageContentFilter    = "content_filter"
	StorageNRSCache         = "nrs_cache"
	StorageSearchExclusions = "search_exclusions"
	StorageWatchedSCs       = "watched_scs"
	StorageXSWDPermissions  = "xswd_permissions"
	StorageSettings         = "settings"
	StorageConsoleLogs      = "console_logs"
	StorageConnectionLog    = "connection_log"
	StorageWalletFiles      = "wallet_files"

	TierCache    = "cache"
	TierAppData  = "appdata"
	TierSettings = "settings"
	TierInfra    = "infra"

	// The literal string the user must type to arm a full reset.
	resetConfirmToken = "RESET"
)

// === Wails-bound API ===

// GetStorageUsage enumerates every category with size and status.
func (a *App) GetStorageUsage() StorageUsage {
	base := getHologramDataDir()
	cats := a.collectCategories()

	var total int64
	for _, c := range cats {
		if c.Managed {
			total += c.SizeBytes
		}
	}

	return StorageUsage{
		BasePath:   base,
		TotalBytes: total,
		Categories: cats,
	}
}

// ClearStorageCategory clears a single category by ID.
func (a *App) ClearStorageCategory(id string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Storage] Clearing category: %s", id))

	freed, err := a.clearOne(id)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Storage clear failed (%s): %v", id, err))
		return map[string]interface{}{
			"success":     false,
			"id":          id,
			"error":       err.Error(),
			"freed_bytes": int64(0),
		}
	}

	a.emitStorageCleared(id, freed)
	return map[string]interface{}{
		"success":     true,
		"id":          id,
		"freed_bytes": freed,
	}
}

// ClearStorageTier clears every clearable category in the given tier.
func (a *App) ClearStorageTier(tier string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Storage] Clearing tier: %s", tier))

	ids := tierMembers(tier)
	if len(ids) == 0 {
		return map[string]interface{}{
			"success": false,
			"tier":    tier,
			"error":   fmt.Sprintf("unknown tier: %s", tier),
		}
	}

	var (
		freed   int64
		cleared []string
		skipped []map[string]interface{}
	)

	for _, id := range ids {
		n, err := a.clearOne(id)
		if err != nil {
			skipped = append(skipped, map[string]interface{}{
				"id":    id,
				"error": err.Error(),
			})
			continue
		}
		freed += n
		cleared = append(cleared, id)
	}

	a.emitStorageTierCleared(tier, freed, cleared)
	return map[string]interface{}{
		"success":     true,
		"tier":        tier,
		"freed_bytes": freed,
		"cleared":     cleared,
		"skipped":     skipped,
	}
}

// ResetHologram wipes every managed category. Requires the literal
// string "RESET" as token — same pattern as the typed-confirm modal.
func (a *App) ResetHologram(confirmToken string) map[string]interface{} {
	if strings.TrimSpace(confirmToken) != resetConfirmToken {
		return map[string]interface{}{
			"success": false,
			"error":   "Confirmation token mismatch. Type RESET to confirm.",
		}
	}

	a.logToConsole("[Storage] Resetting HOLOGRAM — clearing all managed categories")

	var (
		freed   int64
		cleared []string
		skipped []map[string]interface{}
	)

	// Order matters: appdata first (stops services), then cache, settings, infra.
	for _, tier := range []string{TierAppData, TierCache, TierSettings, TierInfra} {
		for _, id := range tierMembers(tier) {
			n, err := a.clearOne(id)
			if err != nil {
				skipped = append(skipped, map[string]interface{}{
					"id":    id,
					"error": err.Error(),
				})
				continue
			}
			freed += n
			cleared = append(cleared, id)
		}
	}

	a.logToConsole(fmt.Sprintf("[Storage] Reset complete — %d categories cleared, %d skipped", len(cleared), len(skipped)))
	wailsRuntime.EventsEmit(a.ctx, "storage:reset", map[string]interface{}{
		"freed_bytes": freed,
		"cleared":     cleared,
		"skipped":     skipped,
	})

	return map[string]interface{}{
		"success":     true,
		"freed_bytes": freed,
		"cleared":     cleared,
		"skipped":     skipped,
	}
}

// === Category enumeration ===

func (a *App) collectCategories() []StorageCategory {
	network := a.getNetworkName()
	gnomonRunning := a.gnomonClient != nil && a.gnomonClient.IsRunning()

	gnomonPath := filepath.Join(getDatashardsDir(), fmt.Sprintf("gravdb-%s", network))
	offlinePath := filepath.Join(getDatashardsDir(), "offline_cache")
	derodPath := filepath.Join(getHologramDataDir(), "derod")
	telaPath := filepath.Join(getDatashardsDir(), "tela")
	contentPath := filepath.Join(getDatashardsDir(), "content_filter")
	nrsPath := filepath.Join(getDatashardsDir(), "nrs_cache")
	exclusionsPath := filepath.Join(getDatashardsDir(), "search_exclusions.json")
	settingsPath := filepath.Join(getDatashardsDir(), "settings", "settings.json")

	// Simulator data lives in its own datashards subdir managed by SimulatorManager.
	simulatorPath := filepath.Join(getDatashardsDir(), "simulator")

	cats := []StorageCategory{
		{
			ID:          StorageGnomonIndex,
			Label:       "Gnomon Index",
			Description: "On-chain SC index built from the daemon.",
			Tier:        TierAppData,
			Color:       "cyan",
			Path:        gnomonPath,
			SizeBytes:   walkDirSize(gnomonPath),
			LastWrite:   lastModified(gnomonPath),
			Recovery:    "Fastsync ≈ 8 min · Full Resync hours to days",
			Clearable:   !gnomonRunning,
			BlockedBy:   ifThen(gnomonRunning, "Stop Gnomon before clearing — or use Fastsync to rebuild in place."),
			InUse:       gnomonRunning,
			Managed:     true,
		},
		{
			ID:          StorageOfflineCache,
			Label:       "Offline App Cache",
			Description: "Locally cached TELA apps for offline browsing.",
			Tier:        TierCache,
			Color:       "emerald",
			Path:        offlinePath,
			SizeBytes:   walkDirSize(offlinePath),
			LastWrite:   lastModified(offlinePath),
			Recovery:    "Re-downloads automatically on next visit",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StoragederodBinary,
			Label:       "derod Binary",
			Description: "Downloaded DERO node executable.",
			Tier:        TierInfra,
			Color:       "violet",
			Path:        derodPath,
			SizeBytes:   walkDirSize(derodPath),
			LastWrite:   lastModified(derodPath),
			Recovery:    "Re-downloads automatically on next embedded-node start",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageTELAClones,
			Label:       "TELA App Clones",
			Description: "Locally served TELA app folders.",
			Tier:        TierAppData,
			Color:       "amber",
			Path:        telaPath,
			SizeBytes:   walkDirSize(telaPath),
			LastWrite:   lastModified(telaPath),
			Recovery:    "Re-clones from chain on next install or open",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageSimulatorData,
			Label:       "Simulator Data",
			Description: "Local test blockchain and wallet for simulator mode.",
			Tier:        TierAppData,
			Color:       "rose",
			Path:        simulatorPath,
			SizeBytes:   walkDirSize(simulatorPath),
			LastWrite:   lastModified(simulatorPath),
			Recovery:    "Starts fresh on next simulator launch",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageContentFilter,
			Label:       "Content Filter",
			Description: "Safe Browsing rules and decision history.",
			Tier:        TierCache,
			Color:       "muted",
			Path:        contentPath,
			SizeBytes:   walkDirSize(contentPath),
			LastWrite:   lastModified(contentPath),
			Recovery:    "Rebuilds defaults on next launch",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageNRSCache,
			Label:       "NRS Cache",
			Description: "DERO Name Service lookups.",
			Tier:        TierCache,
			Color:       "muted",
			Path:        nrsPath,
			SizeBytes:   walkDirSize(nrsPath),
			LastWrite:   lastModified(nrsPath),
			Recovery:    "Regenerates per lookup",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageSearchExclusions,
			Label:       "Search Exclusions",
			Description: "User-defined Gnomon search filters.",
			Tier:        TierAppData,
			Color:       "dim",
			Path:        exclusionsPath,
			SizeBytes:   fileSize(exclusionsPath),
			ItemLabel:   exclusionsCount(),
			LastWrite:   lastModified(exclusionsPath),
			Recovery:    "User must re-add filters manually",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageWatchedSCs,
			Label:       "Watched SCs",
			Description: "Smart contracts watched via Time Machine.",
			Tier:        TierAppData,
			Color:       "dim",
			Path:        "",
			ItemLabel:   watchedSCsCount(a),
			Recovery:    "User must re-add via Explorer",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageXSWDPermissions,
			Label:       "XSWD Permissions",
			Description: "Connected dApps and granted wallet permissions.",
			Tier:        TierAppData,
			Color:       "dim",
			Path:        "",
			ItemLabel:   xswdAppCount(),
			Recovery:    "dApps must re-request access on next visit",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageSettings,
			Label:       "Settings",
			Description: "Persisted preferences (Restore defaults).",
			Tier:        TierSettings,
			Color:       "dim",
			Path:        settingsPath,
			SizeBytes:   fileSize(settingsPath),
			LastWrite:   lastModified(settingsPath),
			Recovery:    "Restores compile-time defaults",
			Clearable:   true,
			Managed:     true,
		},
		{
			ID:          StorageWalletFiles,
			Label:       "Wallet Files",
			Description: "Wallet files live outside the app directory and are not managed here.",
			Tier:        "",
			Color:       "dim",
			Path:        "",
			Clearable:   false,
			BlockedBy:   "Not managed here",
			Managed:     false,
		},
	}

	return cats
}

// === Dispatch table ===

func (a *App) clearOne(id string) (int64, error) {
	switch id {
	case StorageGnomonIndex:
		return a.clearGnomonIndex()
	case StorageOfflineCache:
		return a.clearOfflineCache()
	case StoragederodBinary:
		return a.clearderodBinary()
	case StorageTELAClones:
		return a.clearTELAClones()
	case StorageSimulatorData:
		return a.clearSimulatorData()
	case StorageContentFilter:
		return a.clearContentFilter()
	case StorageNRSCache:
		return a.clearNRSCache()
	case StorageSearchExclusions:
		return a.clearSearchExclusions()
	case StorageWatchedSCs:
		return a.clearWatchedSCs()
	case StorageXSWDPermissions:
		return a.clearXSWDPermissions()
	case StorageSettings:
		return a.restoreSettings()
	case StorageConsoleLogs:
		return 0, a.clearConsoleLogsAdapter()
	case StorageConnectionLog:
		return 0, a.clearConnectionLogAdapter()
	case StorageWalletFiles:
		return 0, fmt.Errorf("wallet files are not managed by HOLOGRAM")
	default:
		return 0, fmt.Errorf("unknown category: %s", id)
	}
}

func tierMembers(tier string) []string {
	switch tier {
	case TierCache:
		return []string{
			StorageOfflineCache,
			StorageContentFilter,
			StorageNRSCache,
			StorageConsoleLogs,
			StorageConnectionLog,
		}
	case TierAppData:
		return []string{
			StorageGnomonIndex,
			StorageTELAClones,
			StorageSimulatorData,
			StorageSearchExclusions,
			StorageWatchedSCs,
			StorageXSWDPermissions,
		}
	case TierSettings:
		return []string{StorageSettings}
	case TierInfra:
		return []string{StoragederodBinary}
	default:
		return nil
	}
}

// === Per-category clear implementations ===

func (a *App) clearGnomonIndex() (int64, error) {
	network := a.getNetworkName()
	path := filepath.Join(getDatashardsDir(), fmt.Sprintf("gravdb-%s", network))

	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		return 0, fmt.Errorf("Gnomon is running — stop it first")
	}

	before := walkDirSize(path)
	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearOfflineCache() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "offline_cache")
	before := walkDirSize(path)
	if a.offlineCache != nil {
		if err := a.offlineCache.ClearCache(); err != nil {
			return 0, err
		}
		return before, nil
	}
	// No live cache instance — wipe the directory directly.
	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearderodBinary() (int64, error) {
	path := filepath.Join(getHologramDataDir(), "derod")
	before := walkDirSize(path)
	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearTELAClones() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "tela")
	before := walkDirSize(path)

	// Stop any TELA servers serving from this directory before wiping it.
	if _, err := a.tryShutdownTELAServers(); err != nil {
		a.logToConsole(fmt.Sprintf("[Storage] TELA shutdown reported: %v", err))
	}

	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearSimulatorData() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "simulator")
	before := walkDirSize(path)

	if a.simulatorManager != nil && a.simulatorManager.IsReady() {
		a.simulatorManager.StopSimulatorMode()
	}

	// ResetSimulator handles the wipe via the SimulatorManager when available.
	if a.simulatorManager != nil {
		_ = a.simulatorManager.ResetSimulator()
		return before, nil
	}

	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearContentFilter() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "content_filter")
	before := walkDirSize(path)
	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearNRSCache() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "nrs_cache")
	before := walkDirSize(path)
	if err := safeRemoveAll(path); err != nil {
		return 0, err
	}
	return before, nil
}

func (a *App) clearSearchExclusions() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "search_exclusions.json")
	before := fileSize(path)
	res := a.ClearSearchExclusions()
	if ok, _ := res["success"].(bool); !ok {
		if msg, _ := res["error"].(string); msg != "" {
			return 0, fmt.Errorf(msg)
		}
		return 0, fmt.Errorf("ClearSearchExclusions failed")
	}
	return before, nil
}

func (a *App) clearWatchedSCs() (int64, error) {
	// Watched SCs live inside the time-travel datastore. Iterate the current
	// list and unwatch each entry — this stays correct whether the indexer
	// is live or not and avoids reaching into private storage.
	res := a.GetWatchedSmartContracts()
	list, _ := res["watched"].([]WatchedSC)
	for _, w := range list {
		if w.SCID != "" {
			a.UnwatchSmartContract(w.SCID)
		}
	}
	return 0, nil
}

func (a *App) clearXSWDPermissions() (int64, error) {
	pm := GetPermissionManager()
	if pm == nil {
		return 0, fmt.Errorf("permission manager not initialized")
	}
	for _, app := range pm.GetAllApps() {
		if app == nil {
			continue
		}
		if err := pm.RevokeAllPermissions(app.Origin); err != nil {
			a.logToConsole(fmt.Sprintf("[Storage] Failed to revoke %s: %v", app.Origin, err))
		}
	}
	return 0, nil
}

// restoreSettings deletes the persisted settings file and resets in-memory
// settings to the same defaults app.go installs in NewApp().
func (a *App) restoreSettings() (int64, error) {
	path := filepath.Join(getDatashardsDir(), "settings", "settings.json")
	before := fileSize(path)
	if err := safeRemoveAll(path); err != nil && !os.IsNotExist(err) {
		return 0, err
	}

	a.settings["min_rating"] = 60
	a.settings["block_malware"] = true
	a.settings["show_nsfw"] = false
	a.settings["auto_connect_ws"] = true
	a.settings["gnomon_enabled"] = false
	a.settings["daemon_endpoint"] = "http://127.0.0.1:10102"
	a.settings["network"] = "mainnet"
	a.settings["integrated_wallet"] = true
	a.settings["allow_github_check"] = true
	a.settings["hide_balance"] = false
	a.settings["hide_address"] = false
	a.settings["avatar_hidden"] = false
	a.settings["privacy_mode"] = false

	wailsRuntime.EventsEmit(a.ctx, "settings:restored", nil)
	return before, nil
}

func (a *App) clearConsoleLogsAdapter() error {
	res := a.ClearConsoleLogs()
	if ok, _ := res["success"].(bool); !ok {
		if msg, _ := res["error"].(string); msg != "" {
			return fmt.Errorf(msg)
		}
	}
	return nil
}

func (a *App) clearConnectionLogAdapter() error {
	res := a.ClearConnectionLog()
	if ok, _ := res["success"].(bool); !ok {
		if msg, _ := res["error"].(string); msg != "" {
			return fmt.Errorf(msg)
		}
	}
	return nil
}

func (a *App) tryShutdownTELAServers() (map[string]interface{}, error) {
	res := a.ShutdownTELAServers()
	if ok, _ := res["success"].(bool); !ok {
		if msg, _ := res["error"].(string); msg != "" {
			return res, fmt.Errorf(msg)
		}
	}
	return res, nil
}

// === Helpers ===

// walkDirSize sums the bytes of every file under path. Returns 0 if the
// path does not exist or is not a directory. Symlinks are not followed.
func walkDirSize(path string) int64 {
	info, err := os.Lstat(path)
	if err != nil {
		return 0
	}
	if !info.IsDir() {
		return info.Size()
	}

	var total int64
	_ = filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		total += fi.Size()
		return nil
	})
	return total
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	if info.IsDir() {
		return walkDirSize(path)
	}
	return info.Size()
}

func lastModified(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.ModTime().Unix()
}

// safeRemoveAll only deletes paths that resolve under the HOLOGRAM data
// directory. Prevents misconfiguration or symlink trickery from wiping
// arbitrary parts of the filesystem.
func safeRemoveAll(path string) error {
	if path == "" {
		return fmt.Errorf("empty path")
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("abs: %w", err)
	}

	base, err := filepath.Abs(getHologramDataDir())
	if err != nil {
		return fmt.Errorf("base abs: %w", err)
	}

	if !strings.HasPrefix(abs+string(filepath.Separator), base+string(filepath.Separator)) {
		return fmt.Errorf("refusing to delete outside HOLOGRAM dir: %s", abs)
	}

	if abs == base {
		return fmt.Errorf("refusing to delete HOLOGRAM root: %s", abs)
	}

	if _, err := os.Stat(abs); os.IsNotExist(err) {
		return nil
	}

	log.Printf("[Storage] safeRemoveAll: %s", abs)
	return os.RemoveAll(abs)
}

func ifThen(cond bool, val string) string {
	if cond {
		return val
	}
	return ""
}

func exclusionsCount() string {
	path := filepath.Join(getDatashardsDir(), "search_exclusions.json")
	if _, err := os.Stat(path); err != nil {
		return "0 filters"
	}
	// Counting requires parsing the JSON; defer to the existing helper that
	// already does this work so we don't duplicate the schema here.
	// search_service.go exposes the list via the wallet helper but it is not
	// directly callable — fall back to "set" if the file is present.
	return "set"
}

func watchedSCsCount(a *App) string {
	res := a.GetWatchedSmartContracts()
	list, _ := res["watched"].([]WatchedSC)
	return fmt.Sprintf("%d entries", len(list))
}

func xswdAppCount() string {
	pm := GetPermissionManager()
	if pm == nil {
		return "0 apps"
	}
	return fmt.Sprintf("%d apps", len(pm.GetAllApps()))
}

func (a *App) emitStorageCleared(id string, freed int64) {
	wailsRuntime.EventsEmit(a.ctx, "storage:cleared", map[string]interface{}{
		"id":          id,
		"freed_bytes": freed,
		"at":          time.Now().Unix(),
	})
}

func (a *App) emitStorageTierCleared(tier string, freed int64, cleared []string) {
	wailsRuntime.EventsEmit(a.ctx, "storage:tier_cleared", map[string]interface{}{
		"tier":        tier,
		"freed_bytes": freed,
		"cleared":     cleared,
		"at":          time.Now().Unix(),
	})
}
