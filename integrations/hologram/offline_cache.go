// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Offline-First TELA Browser - Cache apps for local-first browsing

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/deroproject/graviton"
)

const (
	TreeCachedApps     = "cached_apps"      // App metadata
	TreeCachedContent  = "cached_content"   // Actual content
	TreeCacheManifest  = "cache_manifest"   // Manifest for each cached app
	TreeCacheStats     = "cache_stats"      // Cache usage statistics
)

// CachedApp represents a fully cached TELA app
type CachedApp struct {
	SCID          string            `json:"scid"`
	Name          string            `json:"name"`
	Author        string            `json:"author"`
	Description   string            `json:"description"`
	IconURL       string            `json:"icon_url,omitempty"`
	Category      string            `json:"category,omitempty"`
	Version       int               `json:"version"`
	CachedAt      time.Time         `json:"cached_at"`
	LastAccessed  time.Time         `json:"last_accessed"`
	LastUpdated   time.Time         `json:"last_updated"`
	TotalSize     int64             `json:"total_size"`       // Total bytes cached
	FileCount     int               `json:"file_count"`       // Number of files
	IsComplete    bool              `json:"is_complete"`      // All files cached
	SupportsEpoch bool              `json:"supports_epoch"`
	Files         []CachedFile      `json:"files,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`

	// Sync/Update tracking
	OnChainVersion    int       `json:"onchain_version,omitempty"`    // Latest version on blockchain
	HasUpdate         bool      `json:"has_update,omitempty"`         // True if on-chain > cached
	LastSyncCheck     time.Time `json:"last_sync_check,omitempty"`    // When we last checked for updates
	ContentHash       string    `json:"content_hash,omitempty"`       // Hash of cached content for diff detection
	Rating            int       `json:"rating,omitempty"`             // Community rating (0-99)
	DURL              string    `json:"durl,omitempty"`               // dero:// URL if available
}

// SyncStatus represents the result of checking an app for updates
type SyncStatus struct {
	SCID            string    `json:"scid"`
	Name            string    `json:"name"`
	CachedVersion   int       `json:"cached_version"`
	OnChainVersion  int       `json:"onchain_version"`
	HasUpdate       bool      `json:"has_update"`
	BytesDiff       int64     `json:"bytes_diff,omitempty"`       // Size difference if known
	FilesChanged    int       `json:"files_changed,omitempty"`    // Number of files with changes
	LastChecked     time.Time `json:"last_checked"`
	Error           string    `json:"error,omitempty"`
}

// BatchSyncResult represents the result of a batch sync operation
type BatchSyncResult struct {
	TotalChecked    int           `json:"total_checked"`
	UpdatesFound    int           `json:"updates_found"`
	FailedChecks    int           `json:"failed_checks"`
	Apps            []SyncStatus  `json:"apps"`
	Duration        time.Duration `json:"duration"`
}

// CachedFile represents a single cached file within an app
type CachedFile struct {
	Path        string    `json:"path"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	Hash        string    `json:"hash"`       // Content hash for verification
	CachedAt    time.Time `json:"cached_at"`
	SCID        string    `json:"scid,omitempty"` // Source SCID for the content
}

// CacheManifest tracks what files are cached for an app
type CacheManifest struct {
	AppSCID      string                 `json:"app_scid"`
	Files        map[string]CachedFile  `json:"files"` // path -> file info
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
	TotalSize    int64                  `json:"total_size"`
	IsComplete   bool                   `json:"is_complete"`
}

// CacheStats tracks overall cache usage
type CacheStats struct {
	TotalApps       int       `json:"total_apps"`
	TotalFiles      int       `json:"total_files"`
	TotalSize       int64     `json:"total_size"`
	LastCleanup     time.Time `json:"last_cleanup"`
	CacheHits       int64     `json:"cache_hits"`
	CacheMisses     int64     `json:"cache_misses"`
	BytesSaved      int64     `json:"bytes_saved"` // Estimated network savings
}

// OfflineCache provides local-first content caching using Graviton
type OfflineCache struct {
	sync.RWMutex
	store     *graviton.Store
	logFn     func(string)
	basePath  string
	maxSize   int64  // Maximum cache size in bytes
	isEnabled bool
}

// NewOfflineCache creates a new offline cache service
func NewOfflineCache(logFn func(string)) (*OfflineCache, error) {
	cachePath := filepath.Join(getDatashardsDir(), "offline_cache")
	_ = os.MkdirAll(cachePath, 0755)

	store, err := graviton.NewDiskStore(cachePath)
	if err != nil {
		store, err = graviton.NewMemStore()
		if err != nil {
			return nil, fmt.Errorf("failed to create offline cache store: %v", err)
		}
		if logFn != nil {
			logFn("[WARN] Offline cache using in-memory store (data will not persist)")
		}
	}

	cache := &OfflineCache{
		store:     store,
		logFn:     logFn,
		basePath:  cachePath,
		maxSize:   500 * 1024 * 1024, // 500MB default limit
		isEnabled: true,
	}

	if logFn != nil {
		logFn("[PKG] Offline cache service initialized")
	}

	return cache, nil
}

// Close closes the cache store
func (c *OfflineCache) Close() {
	if c.store != nil {
		c.store.Close()
	}
}

func (c *OfflineCache) log(msg string) {
	if c.logFn != nil {
		c.logFn(msg)
	}
}

// IsEnabled returns whether offline caching is enabled
func (c *OfflineCache) IsEnabled() bool {
	c.RLock()
	defer c.RUnlock()
	return c.isEnabled
}

// SetEnabled enables or disables offline caching
func (c *OfflineCache) SetEnabled(enabled bool) {
	c.Lock()
	c.isEnabled = enabled
	c.Unlock()
}

// SetMaxSize sets the maximum cache size
func (c *OfflineCache) SetMaxSize(bytes int64) {
	c.Lock()
	c.maxSize = bytes
	c.Unlock()
}

// ==================== App Caching ====================

// CacheApp downloads and caches a complete TELA app
func (c *OfflineCache) CacheApp(scid string, appData *CachedApp, files map[string][]byte) error {
	c.Lock()
	defer c.Unlock()

	if !c.isEnabled {
		return fmt.Errorf("offline cache is disabled")
	}

	// Check if we have space
	stats, _ := c.getStats()
	totalNewSize := int64(0)
	for _, content := range files {
		totalNewSize += int64(len(content))
	}

	if stats.TotalSize+totalNewSize > c.maxSize {
		// Try to free space
		if err := c.evictOldest(totalNewSize); err != nil {
			return fmt.Errorf("insufficient cache space: %v", err)
		}
	}

	// Store app metadata
	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	// Update app metadata
	appData.CachedAt = time.Now()
	appData.LastUpdated = time.Now()
	appData.TotalSize = totalNewSize
	appData.FileCount = len(files)
	appData.IsComplete = true

	// Store files
	contentTree, _ := ss.GetTree(TreeCachedContent)
	manifest := CacheManifest{
		AppSCID:   scid,
		Files:     make(map[string]CachedFile),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	for path, content := range files {
		// Store content
		key := fmt.Sprintf("%s:%s", scid, path)
		if err := contentTree.Put([]byte(key), content); err != nil {
			return err
		}

		// Record in manifest
		cachedFile := CachedFile{
			Path:     path,
			Size:     int64(len(content)),
			CachedAt: time.Now(),
		}
		manifest.Files[path] = cachedFile
		manifest.TotalSize += int64(len(content))
		appData.Files = append(appData.Files, cachedFile)
	}

	manifest.IsComplete = true

	// Store manifest
	manifestTree, _ := ss.GetTree(TreeCacheManifest)
	manifestData, _ := json.Marshal(manifest)
	if err := manifestTree.Put([]byte(scid), manifestData); err != nil {
		return err
	}

	// Store app metadata
	appsTree, _ := ss.GetTree(TreeCachedApps)
	appDataBytes, _ := json.Marshal(appData)
	if err := appsTree.Put([]byte(scid), appDataBytes); err != nil {
		return err
	}

	// Commit all changes
	_, err = graviton.Commit(contentTree, manifestTree, appsTree)
	if err != nil {
		return err
	}

	c.log(fmt.Sprintf("[PKG] Cached app %s (%d files, %s)", scid[:16], len(files), formatBytes(totalNewSize)))
	return nil
}

// GetCachedContent retrieves content from cache
func (c *OfflineCache) GetCachedContent(scid, path string) ([]byte, bool, error) {
	c.RLock()
	defer c.RUnlock()

	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return nil, false, err
	}

	contentTree, _ := ss.GetTree(TreeCachedContent)
	key := fmt.Sprintf("%s:%s", scid, path)
	content, err := contentTree.Get([]byte(key))
	if err != nil || content == nil {
		c.incrementMiss()
		return nil, false, nil
	}

	c.incrementHit()
	c.updateLastAccessed(scid)

	return content, true, nil
}

// IsAppCached checks if an app is fully cached
func (c *OfflineCache) IsAppCached(scid string) (bool, *CachedApp, error) {
	c.RLock()
	defer c.RUnlock()

	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return false, nil, err
	}

	appsTree, _ := ss.GetTree(TreeCachedApps)
	data, err := appsTree.Get([]byte(scid))
	if err != nil || data == nil {
		return false, nil, nil
	}

	var app CachedApp
	if err := json.Unmarshal(data, &app); err != nil {
		return false, nil, err
	}

	return app.IsComplete, &app, nil
}

// GetCachedApps returns all cached apps
func (c *OfflineCache) GetCachedApps() ([]CachedApp, error) {
	c.RLock()
	defer c.RUnlock()

	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	appsTree, _ := ss.GetTree(TreeCachedApps)
	cursor := appsTree.Cursor()

	apps := []CachedApp{}
	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		var app CachedApp
		if json.Unmarshal(v, &app) == nil {
			apps = append(apps, app)
		}
	}

	return apps, nil
}

// RemoveCachedApp removes an app from cache
func (c *OfflineCache) RemoveCachedApp(scid string) error {
	c.Lock()
	defer c.Unlock()

	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	// Get manifest to know which files to delete
	manifestTree, _ := ss.GetTree(TreeCacheManifest)
	manifestData, err := manifestTree.Get([]byte(scid))

	if err == nil && manifestData != nil {
		var manifest CacheManifest
		if json.Unmarshal(manifestData, &manifest) == nil {
			// Delete all cached files
			contentTree, _ := ss.GetTree(TreeCachedContent)
			for path := range manifest.Files {
				key := fmt.Sprintf("%s:%s", scid, path)
				contentTree.Delete([]byte(key))
			}
			graviton.Commit(contentTree)
		}
	}

	// Delete manifest
	manifestTree.Delete([]byte(scid))

	// Delete app metadata
	appsTree, _ := ss.GetTree(TreeCachedApps)
	appsTree.Delete([]byte(scid))

	_, err = graviton.Commit(manifestTree, appsTree)
	if err != nil {
		return err
	}

	c.log(fmt.Sprintf("[Cache] Removed app %s", scid[:16]))
	return nil
}

// ==================== Cache Statistics ====================

// GetCacheStats returns cache statistics
func (c *OfflineCache) GetCacheStats() (*CacheStats, error) {
	c.RLock()
	defer c.RUnlock()
	return c.getStats()
}

func (c *OfflineCache) getStats() (*CacheStats, error) {
	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	// Try to load existing stats
	statsTree, _ := ss.GetTree(TreeCacheStats)
	data, _ := statsTree.Get([]byte("global"))

	stats := &CacheStats{}
	if data != nil {
		json.Unmarshal(data, stats)
	}

	// Recalculate from actual data
	appsTree, _ := ss.GetTree(TreeCachedApps)
	cursor := appsTree.Cursor()

	stats.TotalApps = 0
	stats.TotalFiles = 0
	stats.TotalSize = 0

	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		var app CachedApp
		if json.Unmarshal(v, &app) == nil {
			stats.TotalApps++
			stats.TotalFiles += app.FileCount
			stats.TotalSize += app.TotalSize
		}
	}

	return stats, nil
}

func (c *OfflineCache) updateStats(stats *CacheStats) error {
	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	statsTree, _ := ss.GetTree(TreeCacheStats)
	data, _ := json.Marshal(stats)
	if err := statsTree.Put([]byte("global"), data); err != nil {
		return err
	}

	_, err = graviton.Commit(statsTree)
	return err
}

func (c *OfflineCache) incrementHit() {
	stats, _ := c.getStats()
	if stats != nil {
		stats.CacheHits++
		c.updateStats(stats)
	}
}

func (c *OfflineCache) incrementMiss() {
	stats, _ := c.getStats()
	if stats != nil {
		stats.CacheMisses++
		c.updateStats(stats)
	}
}

func (c *OfflineCache) updateLastAccessed(scid string) {
	ss, _ := c.store.LoadSnapshot(0)
	appsTree, _ := ss.GetTree(TreeCachedApps)

	data, err := appsTree.Get([]byte(scid))
	if err != nil || data == nil {
		return
	}

	var app CachedApp
	if json.Unmarshal(data, &app) == nil {
		app.LastAccessed = time.Now()
		newData, _ := json.Marshal(app)
		appsTree.Put([]byte(scid), newData)
		graviton.Commit(appsTree)
	}
}

// ==================== Cache Maintenance ====================

// evictOldest removes oldest cached apps to free space
func (c *OfflineCache) evictOldest(bytesNeeded int64) error {
	apps, err := c.GetCachedApps()
	if err != nil {
		return err
	}

	// Sort by last accessed (oldest first)
	for i := 0; i < len(apps); i++ {
		for j := i + 1; j < len(apps); j++ {
			if apps[j].LastAccessed.Before(apps[i].LastAccessed) {
				apps[i], apps[j] = apps[j], apps[i]
			}
		}
	}

	bytesFreed := int64(0)
	for _, app := range apps {
		if bytesFreed >= bytesNeeded {
			break
		}
		c.RemoveCachedApp(app.SCID)
		bytesFreed += app.TotalSize
		c.log(fmt.Sprintf("[Cache] Evicted %s to free %s", app.SCID[:16], formatBytes(app.TotalSize)))
	}

	if bytesFreed < bytesNeeded {
		return fmt.Errorf("could only free %s of %s needed", formatBytes(bytesFreed), formatBytes(bytesNeeded))
	}

	return nil
}

// CleanupOldApps removes apps not accessed within the specified duration
func (c *OfflineCache) CleanupOldApps(maxAge time.Duration) (int, int64, error) {
	c.Lock()
	defer c.Unlock()

	apps, err := c.GetCachedApps()
	if err != nil {
		return 0, 0, err
	}

	cutoff := time.Now().Add(-maxAge)
	removedCount := 0
	bytesFreed := int64(0)

	for _, app := range apps {
		if app.LastAccessed.Before(cutoff) {
			if err := c.RemoveCachedApp(app.SCID); err == nil {
				removedCount++
				bytesFreed += app.TotalSize
			}
		}
	}

	// Update stats
	stats, _ := c.getStats()
	if stats != nil {
		stats.LastCleanup = time.Now()
		c.updateStats(stats)
	}

	c.log(fmt.Sprintf("[Cache] Cleanup: removed %d apps, freed %s", removedCount, formatBytes(bytesFreed)))
	return removedCount, bytesFreed, nil
}

// ClearCache removes all cached content
func (c *OfflineCache) ClearCache() error {
	c.Lock()
	defer c.Unlock()

	apps, err := c.GetCachedApps()
	if err != nil {
		return err
	}

	for _, app := range apps {
		c.RemoveCachedApp(app.SCID)
	}

	c.log("[Cache] Cleared")
	return nil
}

// ==================== Helper Functions ====================

// formatBytes formats bytes to human-readable string
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// ==================== App Bindings ====================

// PrefetchApp downloads and caches a TELA app for offline use
func (a *App) PrefetchApp(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	// Check if already cached
	isCached, cachedApp, _ := a.offlineCache.IsAppCached(scid)
	if isCached {
		return map[string]interface{}{
			"success":       true,
			"already_cached": true,
			"app":           cachedApp,
		}
	}

	// Get app from blockchain
	telaContent, err := a.FetchTELAContent(scid)
	if err != nil {
		return ErrorResponse(err)
	}

	// Extract files from content
	files := make(map[string][]byte)
	if telaContent.HTML != "" {
		files["index.html"] = []byte(telaContent.HTML)
	}
	// Add CSS and JS files
	for name, css := range telaContent.CSSByName {
		files[name] = []byte(css)
	}
	for name, js := range telaContent.JSByName {
		files[name] = []byte(js)
	}

	// Create app metadata from Meta field
	appData := &CachedApp{
		SCID: scid,
	}
	if meta := telaContent.Meta; meta != nil {
		if name, ok := meta["name"].(string); ok {
			appData.Name = name
		}
		if author, ok := meta["author"].(string); ok {
			appData.Author = author
		}
		if desc, ok := meta["description"].(string); ok {
			appData.Description = desc
		}
	}

	// Check if app supports EPOCH
	epochCheck := a.CheckAppSupportsEpoch(scid)
	if supports, ok := epochCheck["supports_epoch"].(bool); ok {
		appData.SupportsEpoch = supports
	}

	// Cache the app
	if err := a.offlineCache.CacheApp(scid, appData, files); err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"app":     appData,
		"message": fmt.Sprintf("Cached %s for offline use", appData.Name),
	}
}

// GetCachedApps returns all apps available offline
func (a *App) GetCachedApps() map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	apps, err := a.offlineCache.GetCachedApps()
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"apps":    apps,
		"count":   len(apps),
	}
}

// IsAppCachedOffline checks if an app is available offline
func (a *App) IsAppCachedOffline(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"cached":  false,
		}
	}

	isCached, app, _ := a.offlineCache.IsAppCached(scid)
	return map[string]interface{}{
		"success": true,
		"cached":  isCached,
		"app":     app,
	}
}

// RemoveCachedApp removes an app from offline cache
func (a *App) RemoveCachedApp(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	if err := a.offlineCache.RemoveCachedApp(scid); err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
	}
}

// GetOfflineCacheStats returns cache statistics
func (a *App) GetOfflineCacheStats() map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	stats, err := a.offlineCache.GetCacheStats()
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":       true,
		"stats":         stats,
		"max_size":      a.offlineCache.maxSize,
		"max_size_str":  formatBytes(a.offlineCache.maxSize),
		"used_size_str": formatBytes(stats.TotalSize),
		"usage_percent": float64(stats.TotalSize) / float64(a.offlineCache.maxSize) * 100,
	}
}

// SetOfflineCacheEnabled enables or disables offline caching
func (a *App) SetOfflineCacheEnabled(enabled bool) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	a.offlineCache.SetEnabled(enabled)
	return map[string]interface{}{
		"success": true,
		"enabled": enabled,
	}
}

// ClearOfflineCache removes all cached content
func (a *App) ClearOfflineCache() map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	if err := a.offlineCache.ClearCache(); err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"message": "Cache cleared",
	}
}

// ==================== Batch Sync Operations ====================

// BatchPrefetchFavorites caches all favorite apps that meet the rating threshold
// favorites: list of SCIDs or dURLs to prefetch
// minRating: minimum rating (0-99) - apps below this are skipped
func (a *App) BatchPrefetchFavorites(favorites []map[string]interface{}, minRating int) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	startTime := time.Now()
	a.logToConsole(fmt.Sprintf("[Cache] Batch prefetch starting: %d favorites, min rating: %d", len(favorites), minRating))

	results := []map[string]interface{}{}
	prefetched := 0
	skipped := 0
	failed := 0
	alreadyCached := 0

	for _, fav := range favorites {
		scid, _ := fav["scid"].(string)
		durl, _ := fav["durl"].(string)
		name, _ := fav["name"].(string)

		if scid == "" && durl == "" {
			continue
		}

		// Resolve dURL to SCID if needed
		targetSCID := scid
		if targetSCID == "" && durl != "" {
			if a.gnomonClient != nil {
				if resolvedSCID, found := a.gnomonClient.ResolveDURL(durl); found {
					targetSCID = resolvedSCID
				}
			}
			if targetSCID == "" {
				results = append(results, map[string]interface{}{
					"scid":    durl,
					"name":    name,
					"status":  "failed",
					"error":   "Could not resolve dURL",
				})
				failed++
				continue
			}
		}

		// Check if already cached
		isCached, cachedApp, _ := a.offlineCache.IsAppCached(targetSCID)
		if isCached {
			results = append(results, map[string]interface{}{
				"scid":    targetSCID,
				"name":    cachedApp.Name,
				"status":  "already_cached",
				"version": cachedApp.Version,
			})
			alreadyCached++
			continue
		}

		// Check rating if content filter is available
		if a.contentFilter != nil && minRating > 0 {
			rating := a.getAppRating(targetSCID)
			if rating < minRating && rating >= 0 {
				results = append(results, map[string]interface{}{
					"scid":   targetSCID,
					"name":   name,
					"status": "skipped",
					"reason": fmt.Sprintf("Rating %d below threshold %d", rating, minRating),
					"rating": rating,
				})
				skipped++
				continue
			}
		}

		// Prefetch the app
		prefetchResult := a.PrefetchApp(targetSCID)
		if success, ok := prefetchResult["success"].(bool); ok && success {
			results = append(results, map[string]interface{}{
				"scid":   targetSCID,
				"name":   name,
				"status": "prefetched",
			})
			prefetched++
		} else {
			errMsg := "Unknown error"
			if e, ok := prefetchResult["error"].(string); ok {
				errMsg = e
			}
			results = append(results, map[string]interface{}{
				"scid":   targetSCID,
				"name":   name,
				"status": "failed",
				"error":  errMsg,
			})
			failed++
		}
	}

	duration := time.Since(startTime)
	a.logToConsole(fmt.Sprintf("[Cache] Batch prefetch complete: %d prefetched, %d already cached, %d skipped, %d failed (took %v)",
		prefetched, alreadyCached, skipped, failed, duration.Round(time.Millisecond)))

	return map[string]interface{}{
		"success":        true,
		"total":          len(favorites),
		"prefetched":     prefetched,
		"already_cached": alreadyCached,
		"skipped":        skipped,
		"failed":         failed,
		"duration_ms":    duration.Milliseconds(),
		"results":        results,
	}
}

// CheckAllForUpdates checks all cached apps against their on-chain versions
func (a *App) CheckAllForUpdates() map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	startTime := time.Now()
	a.logToConsole("[Cache] Checking all cached apps for updates...")

	cachedApps, err := a.offlineCache.GetCachedApps()
	if err != nil {
		return ErrorResponse(err)
	}

	if len(cachedApps) == 0 {
		return map[string]interface{}{
			"success":       true,
			"message":       "No cached apps to check",
			"total_checked": 0,
			"updates_found": 0,
			"apps":          []SyncStatus{},
		}
	}

	statuses := []SyncStatus{}
	updatesFound := 0
	failedChecks := 0

	for _, app := range cachedApps {
		status := a.checkAppForUpdate(&app)
		statuses = append(statuses, status)

		if status.HasUpdate {
			updatesFound++
			a.logToConsole(fmt.Sprintf("[Cache] Update available: %s (v%d -> v%d)", app.Name, app.Version, status.OnChainVersion))
		}
		if status.Error != "" {
			failedChecks++
		}
	}

	duration := time.Since(startTime)
	a.logToConsole(fmt.Sprintf("[Cache] Update check complete: %d apps, %d updates available (took %v)",
		len(cachedApps), updatesFound, duration.Round(time.Millisecond)))

	return map[string]interface{}{
		"success":       true,
		"total_checked": len(cachedApps),
		"updates_found": updatesFound,
		"failed_checks": failedChecks,
		"duration_ms":   duration.Milliseconds(),
		"apps":          statuses,
	}
}

// CheckAppForUpdate checks a single app for updates
func (a *App) CheckAppForUpdate(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	isCached, cachedApp, _ := a.offlineCache.IsAppCached(scid)
	if !isCached {
		return map[string]interface{}{
			"success":    false,
			"error":      "App not in cache",
			"has_update": false,
		}
	}

	status := a.checkAppForUpdate(cachedApp)
	return map[string]interface{}{
		"success":          true,
		"scid":             scid,
		"name":             cachedApp.Name,
		"cached_version":   status.CachedVersion,
		"onchain_version":  status.OnChainVersion,
		"has_update":       status.HasUpdate,
		"files_changed":    status.FilesChanged,
		"error":            status.Error,
	}
}

// UpdateCachedApp updates a cached app to the latest on-chain version
func (a *App) UpdateCachedApp(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	a.logToConsole(fmt.Sprintf("[Cache] Updating cached app: %s", scid[:16]+"..."))

	// Remove old cached version
	_ = a.offlineCache.RemoveCachedApp(scid)

	// Re-prefetch (gets latest version)
	result := a.PrefetchApp(scid)
	if success, ok := result["success"].(bool); !ok || !success {
		return result
	}

	a.logToConsole(fmt.Sprintf("[Cache] Updated: %s", scid[:16]+"..."))
	result["updated"] = true
	return result
}

// DiffCachedVsOnChain compares cached content with current on-chain content
func (a *App) DiffCachedVsOnChain(scid string) map[string]interface{} {
	if a.offlineCache == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Offline cache not initialized",
		}
	}

	a.logToConsole(fmt.Sprintf("[Cache] Diffing cached vs on-chain: %s", scid[:16]+"..."))

	// Get cached content
	cachedHTML, hasCached, _ := a.offlineCache.GetCachedContent(scid, "index.html")
	if !hasCached {
		return map[string]interface{}{
			"success": false,
			"error":   "App not in cache or no index.html",
		}
	}

	// Get on-chain content
	telaContent, err := a.FetchTELAContent(scid)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to fetch on-chain content: %v", err),
		}
	}

	// Generate diff
	cachedStr := string(cachedHTML)
	onChainStr := telaContent.HTML
	diff := generateDiff(cachedStr, onChainStr)

	// Summary stats
	linesAdded := 0
	linesRemoved := 0
	linesModified := 0
	for _, d := range diff {
		switch d["type"] {
		case "added":
			linesAdded++
		case "removed":
			linesRemoved++
		case "modified":
			linesModified++
		}
	}

	return map[string]interface{}{
		"success":        true,
		"has_changes":    len(diff) > 0,
		"lines_added":    linesAdded,
		"lines_removed":  linesRemoved,
		"lines_modified": linesModified,
		"diff":           diff,
		"cached_size":    len(cachedHTML),
		"onchain_size":   len(onChainStr),
	}
}

// checkAppForUpdate is the internal helper for checking a single app
func (a *App) checkAppForUpdate(cachedApp *CachedApp) SyncStatus {
	status := SyncStatus{
		SCID:           cachedApp.SCID,
		Name:           cachedApp.Name,
		CachedVersion:  cachedApp.Version,
		OnChainVersion: cachedApp.Version, // Default same
		HasUpdate:      false,
		LastChecked:    time.Now(),
	}

	// Get on-chain version from SC variables
	vars, err := a.daemonClient.GetSCVariables(cachedApp.SCID, true, true)
	if err != nil {
		status.Error = fmt.Sprintf("Failed to fetch SC: %v", err)
		return status
	}

	// Look for "C" (commit counter) in string keys - this is the version
	if stringKeys, ok := vars["stringkeys"].(map[string]interface{}); ok {
		if cVal, exists := stringKeys["C"]; exists {
			version := parseVersionFromVal(cVal)
			status.OnChainVersion = version
			status.HasUpdate = version > cachedApp.Version
		}
	}

	// Also check content hash if we have both
	if status.OnChainVersion == cachedApp.Version {
		// Same version number but content might still differ (edge case)
		// Quick check by comparing HTML size
		cachedHTML, hasCached, _ := a.offlineCache.GetCachedContent(cachedApp.SCID, "index.html")
		if hasCached {
			telaContent, err := a.FetchTELAContent(cachedApp.SCID)
			if err == nil && len(telaContent.HTML) != len(cachedHTML) {
				status.HasUpdate = true
				status.BytesDiff = int64(len(telaContent.HTML) - len(cachedHTML))
			}
		}
	}

	// Update the cached app metadata with sync info
	cachedApp.OnChainVersion = status.OnChainVersion
	cachedApp.HasUpdate = status.HasUpdate
	cachedApp.LastSyncCheck = status.LastChecked
	_ = a.offlineCache.updateAppMetadata(cachedApp)

	return status
}

// getAppRating retrieves the community rating for an app
func (a *App) getAppRating(scid string) int {
	if a.contentFilter == nil {
		return -1 // Unknown
	}

	// Try to get rating from filter/rating system
	// This integrates with the rating system if available
	vars, err := a.daemonClient.GetSCVariables(scid, true, true)
	if err != nil {
		return -1
	}

	// Look for rating in metadata (simplified - actual implementation depends on rating SC)
	if stringKeys, ok := vars["stringkeys"].(map[string]interface{}); ok {
		if ratingVal, exists := stringKeys["rating"]; exists {
			rating := parseVersionFromVal(ratingVal)
			if rating >= 0 && rating <= 99 {
				return rating
			}
		}
	}

	return -1 // Not rated
}

// parseVersionFromVal parses a version/count from SC variable value
func parseVersionFromVal(val interface{}) int {
	switch v := val.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		var n int
		fmt.Sscanf(v, "%d", &n)
		return n
	}
	return 0
}

// updateAppMetadata updates just the metadata for a cached app
func (c *OfflineCache) updateAppMetadata(app *CachedApp) error {
	c.Lock()
	defer c.Unlock()

	ss, err := c.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	appTree, _ := ss.GetTree(TreeCachedApps)

	appBytes, err := json.Marshal(app)
	if err != nil {
		return err
	}

	if err := appTree.Put([]byte(app.SCID), appBytes); err != nil {
		return err
	}

	_, err = graviton.Commit(appTree)
	return err
}

