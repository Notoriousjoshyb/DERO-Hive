// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Intelligent Content Filtering - Rating-based safe browsing controls

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
	TreeFilterRules       = "filter_rules"       // User-defined filter rules
	TreeBlockedApps       = "blocked_apps"       // Manually blocked apps
	TreeAllowedApps       = "allowed_apps"       // Manually allowed apps
	TreeFilterHistory     = "filter_history"     // Filter decisions log
	TreeFilterStats       = "filter_stats"       // Filter statistics
)

// FilterRule represents a content filtering rule
type FilterRule struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Type        string    `json:"type"`        // "rating", "author", "category", "keyword"
	Operator    string    `json:"operator"`    // "gte", "lte", "eq", "contains", "not_contains"
	Value       string    `json:"value"`       // The value to compare against
	Action      string    `json:"action"`      // "allow", "block", "warn"
	Priority    int       `json:"priority"`    // Higher = checked first
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
}

// FilterDecision represents a filtering decision for an app
type FilterDecision struct {
	SCID        string    `json:"scid"`
	AppName     string    `json:"app_name"`
	Decision    string    `json:"decision"`     // "allow", "block", "warn"
	Reason      string    `json:"reason"`
	RuleID      string    `json:"rule_id,omitempty"`
	RuleName    string    `json:"rule_name,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
	UserOverride bool     `json:"user_override"` // User manually overrode the decision
}

// FilterConfig holds the global filter configuration
type FilterConfig struct {
	Enabled              bool    `json:"enabled"`
	MinimumRating        int     `json:"minimum_rating"`         // 0-99
	BlockMalware         bool    `json:"block_malware"`          // Block 0-9 rated
	BlockUnrated         bool    `json:"block_unrated"`          // Block apps without ratings
	RequireEpochSupport  bool    `json:"require_epoch_support"`  // Only show EPOCH-supporting apps
	ShowWarnings         bool    `json:"show_warnings"`          // Show warnings instead of blocking
	ParentalControlLevel string  `json:"parental_control_level"` // "off", "low", "medium", "high"
	EpochSupportBonus    int     `json:"epoch_support_bonus"`    // Rating bonus for EPOCH apps (0-10)
}

// FilterStats tracks filter usage statistics
type FilterStats struct {
	TotalChecks      int64     `json:"total_checks"`
	TotalBlocked     int64     `json:"total_blocked"`
	TotalWarnings    int64     `json:"total_warnings"`
	TotalAllowed     int64     `json:"total_allowed"`
	TotalOverrides   int64     `json:"total_overrides"`
	LastCheck        time.Time `json:"last_check"`
	UniqueAppsBlocked int      `json:"unique_apps_blocked"`
}

// ContentFilter provides intelligent content filtering
type ContentFilter struct {
	sync.RWMutex
	store  *graviton.Store
	config FilterConfig
	rules  []FilterRule
	logFn  func(string)
}

// NewContentFilter creates a new content filter service
func NewContentFilter(logFn func(string)) (*ContentFilter, error) {
	wd, _ := os.Getwd()
	filterPath := filepath.Join(wd, "datashards", "content_filter")
	_ = os.MkdirAll(filterPath, 0755)

	store, err := graviton.NewDiskStore(filterPath)
	if err != nil {
		store, err = graviton.NewMemStore()
		if err != nil {
			return nil, fmt.Errorf("failed to create content filter store: %v", err)
		}
	}

	filter := &ContentFilter{
		store: store,
		logFn: logFn,
		config: FilterConfig{
			Enabled:              true,
			MinimumRating:        0,
			BlockMalware:         true,
			BlockUnrated:         false,
			RequireEpochSupport:  false,
			ShowWarnings:         true,
			ParentalControlLevel: "off",
			EpochSupportBonus:    5,
		},
	}

	// Load saved config
	filter.loadConfig()

	// Initialize default rules
	filter.initializeDefaultRules()

	if logFn != nil {
		logFn("[SHIELD] Content filter service initialized")
	}

	return filter, nil
}

// Close closes the filter store
func (f *ContentFilter) Close() {
	if f.store != nil {
		f.store.Close()
	}
}

func (f *ContentFilter) log(msg string) {
	if f.logFn != nil {
		f.logFn(msg)
	}
}

// ==================== Configuration ====================

// loadConfig loads the filter configuration from storage
func (f *ContentFilter) loadConfig() {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return
	}

	tree, _ := ss.GetTree(TreeFilterStats)
	data, err := tree.Get([]byte("config"))
	if err == nil && data != nil {
		json.Unmarshal(data, &f.config)
	}
}

// saveConfig saves the filter configuration to storage
func (f *ContentFilter) saveConfig() error {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree(TreeFilterStats)
	data, _ := json.Marshal(f.config)
	if err := tree.Put([]byte("config"), data); err != nil {
		return err
	}

	_, err = graviton.Commit(tree)
	return err
}

// GetConfig returns the current filter configuration
func (f *ContentFilter) GetConfig() FilterConfig {
	f.RLock()
	defer f.RUnlock()
	return f.config
}

// SetConfig updates the filter configuration
func (f *ContentFilter) SetConfig(config FilterConfig) error {
	f.Lock()
	f.config = config
	f.Unlock()

	return f.saveConfig()
}

// ==================== Rule Management ====================

// initializeDefaultRules creates default filtering rules
func (f *ContentFilter) initializeDefaultRules() {
	defaultRules := []FilterRule{
		{
			ID:          "malware_block",
			Name:        "Block Malware",
			Description: "Block apps with ratings 0-9 (known malware)",
			Type:        "rating",
			Operator:    "lte",
			Value:       "9",
			Action:      "block",
			Priority:    100,
			Enabled:     true,
		},
		{
			ID:          "low_rating_warn",
			Name:        "Low Rating Warning",
			Description: "Warn for apps with ratings 10-30",
			Type:        "rating",
			Operator:    "lte",
			Value:       "30",
			Action:      "warn",
			Priority:    50,
			Enabled:     true,
		},
		{
			ID:          "epoch_bonus",
			Name:        "EPOCH Support Bonus",
			Description: "Boost apps that support EPOCH developer program",
			Type:        "epoch_support",
			Operator:    "eq",
			Value:       "true",
			Action:      "allow",
			Priority:    75,
			Enabled:     true,
		},
	}

	f.Lock()
	f.rules = defaultRules
	f.Unlock()

	// Save to storage
	f.saveRules()
}

// saveRules persists rules to storage
func (f *ContentFilter) saveRules() error {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree(TreeFilterRules)

	for _, rule := range f.rules {
		rule.CreatedAt = time.Now()
		data, _ := json.Marshal(rule)
		if err := tree.Put([]byte(rule.ID), data); err != nil {
			return err
		}
	}

	_, err = graviton.Commit(tree)
	return err
}

// GetRules returns all filter rules
func (f *ContentFilter) GetRules() []FilterRule {
	f.RLock()
	defer f.RUnlock()

	rules := make([]FilterRule, len(f.rules))
	copy(rules, f.rules)
	return rules
}

// AddRule adds a new filter rule
func (f *ContentFilter) AddRule(rule FilterRule) error {
	f.Lock()
	rule.CreatedAt = time.Now()
	f.rules = append(f.rules, rule)
	f.Unlock()

	return f.saveRules()
}

// RemoveRule removes a filter rule by ID
func (f *ContentFilter) RemoveRule(ruleID string) error {
	f.Lock()
	defer f.Unlock()

	newRules := []FilterRule{}
	for _, r := range f.rules {
		if r.ID != ruleID {
			newRules = append(newRules, r)
		}
	}
	f.rules = newRules

	// Remove from storage
	ss, _ := f.store.LoadSnapshot(0)
	tree, _ := ss.GetTree(TreeFilterRules)
	tree.Delete([]byte(ruleID))
	graviton.Commit(tree)

	return nil
}

// ==================== Filtering Logic ====================

// AppInfo represents app information for filtering
type AppInfo struct {
	SCID          string
	Name          string
	Author        string
	Category      string
	Rating        int
	RatingCount   int
	SupportsEpoch bool
	IsUnrated     bool
}

// CheckApp evaluates whether an app should be allowed, blocked, or warned
func (f *ContentFilter) CheckApp(app AppInfo) *FilterDecision {
	f.RLock()
	config := f.config
	rules := f.rules
	f.RUnlock()

	decision := &FilterDecision{
		SCID:      app.SCID,
		AppName:   app.Name,
		Decision:  "allow",
		Timestamp: time.Now(),
	}

	if !config.Enabled {
		return decision
	}

	// Check if manually allowed
	if f.isManuallyAllowed(app.SCID) {
		decision.Decision = "allow"
		decision.Reason = "Manually allowed by user"
		decision.UserOverride = true
		f.recordDecision(decision)
		return decision
	}

	// Check if manually blocked
	if f.isManuallyBlocked(app.SCID) {
		decision.Decision = "block"
		decision.Reason = "Manually blocked by user"
		decision.UserOverride = true
		f.recordDecision(decision)
		return decision
	}

	// Apply EPOCH bonus
	effectiveRating := app.Rating
	if app.SupportsEpoch {
		effectiveRating += config.EpochSupportBonus
		if effectiveRating > 99 {
			effectiveRating = 99
		}
	}

	// Check minimum rating
	if effectiveRating < config.MinimumRating {
		if config.ShowWarnings {
			decision.Decision = "warn"
		} else {
			decision.Decision = "block"
		}
		decision.Reason = fmt.Sprintf("Rating %d is below minimum %d", effectiveRating, config.MinimumRating)
		f.recordDecision(decision)
		return decision
	}

	// Check malware block
	if config.BlockMalware && app.Rating <= 9 {
		decision.Decision = "block"
		decision.Reason = "Blocked as potential malware (rating 0-9)"
		decision.RuleName = "Block Malware"
		f.recordDecision(decision)
		return decision
	}

	// Check unrated block
	if config.BlockUnrated && app.IsUnrated {
		if config.ShowWarnings {
			decision.Decision = "warn"
		} else {
			decision.Decision = "block"
		}
		decision.Reason = "App has no rating"
		f.recordDecision(decision)
		return decision
	}

	// Check EPOCH requirement
	if config.RequireEpochSupport && !app.SupportsEpoch {
		if config.ShowWarnings {
			decision.Decision = "warn"
		} else {
			decision.Decision = "block"
		}
		decision.Reason = "App does not support EPOCH developer program"
		f.recordDecision(decision)
		return decision
	}

	// Apply rules (sorted by priority)
	sortedRules := make([]FilterRule, len(rules))
	copy(sortedRules, rules)
	for i := 0; i < len(sortedRules); i++ {
		for j := i + 1; j < len(sortedRules); j++ {
			if sortedRules[j].Priority > sortedRules[i].Priority {
				sortedRules[i], sortedRules[j] = sortedRules[j], sortedRules[i]
			}
		}
	}

	for _, rule := range sortedRules {
		if !rule.Enabled {
			continue
		}

		matches := f.evaluateRule(rule, app, effectiveRating)
		if matches {
			decision.RuleID = rule.ID
			decision.RuleName = rule.Name

			switch rule.Action {
			case "block":
				decision.Decision = "block"
				decision.Reason = rule.Description
			case "warn":
				decision.Decision = "warn"
				decision.Reason = rule.Description
			case "allow":
				// Explicitly allow, skip further checks
				decision.Decision = "allow"
				decision.Reason = "Allowed by rule: " + rule.Name
			}

			if rule.Action == "block" || rule.Action == "warn" {
				f.recordDecision(decision)
				return decision
			}
		}
	}

	// Apply parental control level
	switch config.ParentalControlLevel {
	case "high":
		if app.Rating < 70 || app.Category == "adult" {
			decision.Decision = "block"
			decision.Reason = "Blocked by parental controls (high)"
			f.recordDecision(decision)
			return decision
		}
	case "medium":
		if app.Rating < 50 || app.Category == "adult" {
			if config.ShowWarnings {
				decision.Decision = "warn"
			} else {
				decision.Decision = "block"
			}
			decision.Reason = "Blocked by parental controls (medium)"
			f.recordDecision(decision)
			return decision
		}
	case "low":
		if app.Category == "adult" {
			if config.ShowWarnings {
				decision.Decision = "warn"
			} else {
				decision.Decision = "block"
			}
			decision.Reason = "Adult content blocked by parental controls"
			f.recordDecision(decision)
			return decision
		}
	}

	// Default: allow
	decision.Decision = "allow"
	f.recordDecision(decision)
	return decision
}

// evaluateRule checks if a rule matches an app
func (f *ContentFilter) evaluateRule(rule FilterRule, app AppInfo, effectiveRating int) bool {
	switch rule.Type {
	case "rating":
		var threshold int
		fmt.Sscanf(rule.Value, "%d", &threshold)

		switch rule.Operator {
		case "lte":
			return effectiveRating <= threshold
		case "gte":
			return effectiveRating >= threshold
		case "eq":
			return effectiveRating == threshold
		}

	case "epoch_support":
		return app.SupportsEpoch == (rule.Value == "true")

	case "category":
		switch rule.Operator {
		case "eq":
			return app.Category == rule.Value
		case "contains":
			return app.Category == rule.Value
		}

	case "author":
		switch rule.Operator {
		case "eq":
			return app.Author == rule.Value
		case "contains":
			return app.Author == rule.Value
		}
	}

	return false
}

// ==================== Manual Override ====================

// AllowApp manually allows an app, overriding filters
func (f *ContentFilter) AllowApp(scid string) error {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	// Remove from blocked if present
	blockedTree, _ := ss.GetTree(TreeBlockedApps)
	blockedTree.Delete([]byte(scid))

	// Add to allowed
	allowedTree, _ := ss.GetTree(TreeAllowedApps)
	data, _ := json.Marshal(map[string]interface{}{
		"scid":      scid,
		"timestamp": time.Now(),
	})
	if err := allowedTree.Put([]byte(scid), data); err != nil {
		return err
	}

	_, err = graviton.Commit(blockedTree, allowedTree)
	return err
}

// BlockApp manually blocks an app
func (f *ContentFilter) BlockApp(scid string) error {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	// Remove from allowed if present
	allowedTree, _ := ss.GetTree(TreeAllowedApps)
	allowedTree.Delete([]byte(scid))

	// Add to blocked
	blockedTree, _ := ss.GetTree(TreeBlockedApps)
	data, _ := json.Marshal(map[string]interface{}{
		"scid":      scid,
		"timestamp": time.Now(),
	})
	if err := blockedTree.Put([]byte(scid), data); err != nil {
		return err
	}

	_, err = graviton.Commit(allowedTree, blockedTree)
	return err
}

// ClearOverride removes manual allow/block for an app
func (f *ContentFilter) ClearOverride(scid string) error {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	allowedTree, _ := ss.GetTree(TreeAllowedApps)
	blockedTree, _ := ss.GetTree(TreeBlockedApps)

	allowedTree.Delete([]byte(scid))
	blockedTree.Delete([]byte(scid))

	_, err = graviton.Commit(allowedTree, blockedTree)
	return err
}

func (f *ContentFilter) isManuallyAllowed(scid string) bool {
	ss, _ := f.store.LoadSnapshot(0)
	tree, _ := ss.GetTree(TreeAllowedApps)
	data, _ := tree.Get([]byte(scid))
	return data != nil
}

func (f *ContentFilter) isManuallyBlocked(scid string) bool {
	ss, _ := f.store.LoadSnapshot(0)
	tree, _ := ss.GetTree(TreeBlockedApps)
	data, _ := tree.Get([]byte(scid))
	return data != nil
}

// ==================== History & Statistics ====================

// recordDecision records a filter decision
func (f *ContentFilter) recordDecision(decision *FilterDecision) {
	ss, _ := f.store.LoadSnapshot(0)
	histTree, _ := ss.GetTree(TreeFilterHistory)

	// Use timestamp as key for chronological order
	key := fmt.Sprintf("%d:%s", decision.Timestamp.UnixNano(), decision.SCID)
	data, _ := json.Marshal(decision)
	histTree.Put([]byte(key), data)

	// Update stats
	statsTree, _ := ss.GetTree(TreeFilterStats)
	statsData, _ := statsTree.Get([]byte("stats"))

	stats := &FilterStats{}
	if statsData != nil {
		json.Unmarshal(statsData, stats)
	}

	stats.TotalChecks++
	stats.LastCheck = decision.Timestamp

	switch decision.Decision {
	case "block":
		stats.TotalBlocked++
	case "warn":
		stats.TotalWarnings++
	case "allow":
		stats.TotalAllowed++
	}

	if decision.UserOverride {
		stats.TotalOverrides++
	}

	newStatsData, _ := json.Marshal(stats)
	statsTree.Put([]byte("stats"), newStatsData)

	graviton.Commit(histTree, statsTree)
}

// GetFilterStats returns filter statistics
func (f *ContentFilter) GetFilterStats() (*FilterStats, error) {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	statsTree, _ := ss.GetTree(TreeFilterStats)
	data, _ := statsTree.Get([]byte("stats"))

	stats := &FilterStats{}
	if data != nil {
		json.Unmarshal(data, stats)
	}

	return stats, nil
}

// GetFilterHistory returns recent filter decisions
func (f *ContentFilter) GetFilterHistory(limit int) ([]FilterDecision, error) {
	ss, err := f.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	histTree, _ := ss.GetTree(TreeFilterHistory)
	cursor := histTree.Cursor()

	decisions := []FilterDecision{}
	for k, v, err := cursor.Last(); err == nil && (limit <= 0 || len(decisions) < limit); k, v, err = cursor.Prev() {
		if k == nil {
			break
		}

		var decision FilterDecision
		if json.Unmarshal(v, &decision) == nil {
			decisions = append(decisions, decision)
		}
	}

	return decisions, nil
}

// ==================== App Bindings ====================

// GetContentFilterConfig returns the current filter configuration
func (a *App) GetContentFilterConfig() map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	config := a.contentFilter.GetConfig()
	return map[string]interface{}{
		"success": true,
		"config":  config,
	}
}

// SetContentFilterConfig updates the filter configuration
func (a *App) SetContentFilterConfig(enabled bool, minRating int, blockMalware, blockUnrated, requireEpoch, showWarnings bool, parentalLevel string, epochBonus int) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	config := FilterConfig{
		Enabled:              enabled,
		MinimumRating:        minRating,
		BlockMalware:         blockMalware,
		BlockUnrated:         blockUnrated,
		RequireEpochSupport:  requireEpoch,
		ShowWarnings:         showWarnings,
		ParentalControlLevel: parentalLevel,
		EpochSupportBonus:    epochBonus,
	}

	if err := a.contentFilter.SetConfig(config); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"config":  config,
	}
}

// CheckAppFilter checks if an app passes content filters
func (a *App) CheckAppFilter(scid, name, author, category string, rating, ratingCount int, supportsEpoch bool) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success":  true,
			"decision": "allow",
			"reason":   "Content filter not initialized",
		}
	}

	app := AppInfo{
		SCID:          scid,
		Name:          name,
		Author:        author,
		Category:      category,
		Rating:        rating,
		RatingCount:   ratingCount,
		SupportsEpoch: supportsEpoch,
		IsUnrated:     ratingCount == 0,
	}

	decision := a.contentFilter.CheckApp(app)

	return map[string]interface{}{
		"success":       true,
		"decision":      decision.Decision,
		"reason":        decision.Reason,
		"rule_name":     decision.RuleName,
		"user_override": decision.UserOverride,
	}
}

// ManuallyAllowApp allows an app regardless of filters
func (a *App) ManuallyAllowApp(scid string) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	if err := a.contentFilter.AllowApp(scid); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"message": "App manually allowed",
	}
}

// ManuallyBlockApp blocks an app regardless of filters
func (a *App) ManuallyBlockApp(scid string) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	if err := a.contentFilter.BlockApp(scid); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"message": "App manually blocked",
	}
}

// ClearAppFilterOverride removes manual allow/block for an app
func (a *App) ClearAppFilterOverride(scid string) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	if err := a.contentFilter.ClearOverride(scid); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
	}
}

// GetContentFilterStats returns filter statistics
func (a *App) GetContentFilterStats() map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	stats, err := a.contentFilter.GetFilterStats()
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"stats":   stats,
	}
}

// GetContentFilterHistory returns recent filter decisions
func (a *App) GetContentFilterHistory(limit int) map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	history, err := a.contentFilter.GetFilterHistory(limit)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"history": history,
	}
}

// GetContentFilterRules returns all filter rules
func (a *App) GetContentFilterRules() map[string]interface{} {
	if a.contentFilter == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Content filter not initialized",
		}
	}

	rules := a.contentFilter.GetRules()
	return map[string]interface{}{
		"success": true,
		"rules":   rules,
	}
}

