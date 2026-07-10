// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Time-Travel SC Explorer - View Smart Contract state at different heights

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
	TreeSCStateCache   = "sc_state_cache"   // Cached SC state snapshots
	TreeSCStateHistory = "sc_state_history" // State change history
	TreeSCWatched      = "sc_watched"       // Watched SC list
)

// SCStateSnapshot represents a captured SC state at a specific height
type SCStateSnapshot struct {
	SCID        string                 `json:"scid"`
	Height      uint64                 `json:"height"`
	Topoheight  uint64                 `json:"topoheight"`
	Balance     uint64                 `json:"balance"`
	Code        string                 `json:"code,omitempty"`
	Variables   map[string]interface{} `json:"variables"`
	CapturedAt  time.Time              `json:"captured_at"`
	ChangeCount int                    `json:"change_count"` // Variables changed since previous
}

// SCStateChange represents a single variable change between heights
type SCStateChange struct {
	SCID        string      `json:"scid"`
	FromHeight  uint64      `json:"from_height"`
	ToHeight    uint64      `json:"to_height"`
	Key         string      `json:"key"`
	OldValue    interface{} `json:"old_value"`
	NewValue    interface{} `json:"new_value"`
	ChangeType  string      `json:"change_type"` // "added", "modified", "removed"
	DetectedAt  time.Time   `json:"detected_at"`
}

// SCStateDiff represents the difference between two SC states
type SCStateDiff struct {
	SCID         string          `json:"scid"`
	FromHeight   uint64          `json:"from_height"`
	ToHeight     uint64          `json:"to_height"`
	BalanceDiff  int64           `json:"balance_diff"`
	Changes      []SCStateChange `json:"changes"`
	TotalAdded   int             `json:"total_added"`
	TotalModified int            `json:"total_modified"`
	TotalRemoved  int            `json:"total_removed"`
	CodeChanged   bool           `json:"code_changed"`
}

// WatchedSC represents a Smart Contract being watched for changes
type WatchedSC struct {
	SCID         string    `json:"scid"`
	Name         string    `json:"name,omitempty"`
	WatchedSince time.Time `json:"watched_since"`
	LastChecked  time.Time `json:"last_checked"`
	LastChange   time.Time `json:"last_change"`
	ChangeCount  int       `json:"change_count"`
}

// TimeTravelExplorer provides SC state history and comparison
type TimeTravelExplorer struct {
	sync.RWMutex
	store     *graviton.Store
	logFn     func(string)
	app       *App // Reference to main app for daemon calls
}

// NewTimeTravelExplorer creates a new time-travel explorer service
func NewTimeTravelExplorer(app *App, logFn func(string)) (*TimeTravelExplorer, error) {
	wd, _ := os.Getwd()
	explorePath := filepath.Join(wd, "datashards", "time_travel")
	_ = os.MkdirAll(explorePath, 0755)

	store, err := graviton.NewDiskStore(explorePath)
	if err != nil {
		store, err = graviton.NewMemStore()
		if err != nil {
			return nil, fmt.Errorf("failed to create time travel store: %v", err)
		}
	}

	explorer := &TimeTravelExplorer{
		store: store,
		logFn: logFn,
		app:   app,
	}

	if logFn != nil {
		logFn("[TIME] Time-travel explorer service initialized")
	}

	return explorer, nil
}

// Close closes the explorer store
func (t *TimeTravelExplorer) Close() {
	if t.store != nil {
		t.store.Close()
	}
}

func (t *TimeTravelExplorer) log(msg string) {
	if t.logFn != nil {
		t.logFn(msg)
	}
}

// ==================== SC State Capture ====================

// CaptureCurrentState fetches and stores the current state of an SC
func (t *TimeTravelExplorer) CaptureCurrentState(scid string) (*SCStateSnapshot, error) {
	t.Lock()
	defer t.Unlock()

	// Get SC data from daemon
	scData := t.app.GetSCInfo(scid)
	if scData["success"] != true {
		return nil, fmt.Errorf("failed to fetch SC: %v", scData["error"])
	}

	// Extract variables
	variables := make(map[string]interface{})
	if vars, ok := scData["variables"].(map[string]interface{}); ok {
		variables = vars
	}

	// Get chain info for height
	chainInfo := t.app.GetNetworkInfo()
	height := uint64(0)
	topoheight := uint64(0)
	if chainInfo["success"] == true {
		if h, ok := chainInfo["height"].(float64); ok {
			height = uint64(h)
		}
		if th, ok := chainInfo["topoheight"].(float64); ok {
			topoheight = uint64(th)
		}
	}

	snapshot := &SCStateSnapshot{
		SCID:       scid,
		Height:     height,
		Topoheight: topoheight,
		Variables:  variables,
		CapturedAt: time.Now(),
	}

	if balance, ok := scData["balance"].(float64); ok {
		snapshot.Balance = uint64(balance)
	}

	if code, ok := scData["code"].(string); ok {
		snapshot.Code = code
	}

	// Store snapshot
	if err := t.storeSnapshot(snapshot); err != nil {
		return nil, err
	}

	t.log(fmt.Sprintf("[TIME] Captured state for %s at height %d", scid[:16], height))
	return snapshot, nil
}

// storeSnapshot persists a state snapshot
func (t *TimeTravelExplorer) storeSnapshot(snapshot *SCStateSnapshot) error {
	ss, err := t.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree(TreeSCStateCache)

	// Key: scid:height
	key := fmt.Sprintf("%s:%012d", snapshot.SCID, snapshot.Height)
	data, _ := json.Marshal(snapshot)

	if err := tree.Put([]byte(key), data); err != nil {
		return err
	}

	_, err = graviton.Commit(tree)
	return err
}

// GetStateAtHeight retrieves the closest cached state at or before a height
func (t *TimeTravelExplorer) GetStateAtHeight(scid string, height uint64) (*SCStateSnapshot, error) {
	t.RLock()
	defer t.RUnlock()

	ss, err := t.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	tree, _ := ss.GetTree(TreeSCStateCache)
	cursor := tree.Cursor()

	// Search for the closest height at or below requested
	prefix := fmt.Sprintf("%s:", scid)
	targetKey := fmt.Sprintf("%s:%012d", scid, height)

	var bestSnapshot *SCStateSnapshot

	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		keyStr := string(k)
		if len(keyStr) >= len(prefix) && keyStr[:len(prefix)] == prefix {
			if keyStr <= targetKey {
				var snapshot SCStateSnapshot
				if json.Unmarshal(v, &snapshot) == nil {
					bestSnapshot = &snapshot
				}
			} else {
				break // Past the target
			}
		}
	}

	if bestSnapshot == nil {
		return nil, fmt.Errorf("no cached state found for %s at or before height %d", scid, height)
	}

	return bestSnapshot, nil
}

// ==================== State Comparison ====================

// CompareSCState compares SC state between two heights
func (t *TimeTravelExplorer) CompareSCState(scid string, fromHeight, toHeight uint64) (*SCStateDiff, error) {
	t.RLock()
	defer t.RUnlock()

	// Get states
	fromState, err := t.GetStateAtHeight(scid, fromHeight)
	if err != nil {
		return nil, fmt.Errorf("failed to get state at height %d: %v", fromHeight, err)
	}

	toState, err := t.GetStateAtHeight(scid, toHeight)
	if err != nil {
		return nil, fmt.Errorf("failed to get state at height %d: %v", toHeight, err)
	}

	diff := &SCStateDiff{
		SCID:        scid,
		FromHeight:  fromState.Height,
		ToHeight:    toState.Height,
		BalanceDiff: int64(toState.Balance) - int64(fromState.Balance),
		Changes:     []SCStateChange{},
		CodeChanged: fromState.Code != toState.Code,
	}

	// Compare variables
	// Check for added and modified
	for key, newValue := range toState.Variables {
		oldValue, exists := fromState.Variables[key]
		if !exists {
			// Added
			diff.Changes = append(diff.Changes, SCStateChange{
				SCID:       scid,
				FromHeight: fromState.Height,
				ToHeight:   toState.Height,
				Key:        key,
				OldValue:   nil,
				NewValue:   newValue,
				ChangeType: "added",
				DetectedAt: time.Now(),
			})
			diff.TotalAdded++
		} else if !isEqual(oldValue, newValue) {
			// Modified
			diff.Changes = append(diff.Changes, SCStateChange{
				SCID:       scid,
				FromHeight: fromState.Height,
				ToHeight:   toState.Height,
				Key:        key,
				OldValue:   oldValue,
				NewValue:   newValue,
				ChangeType: "modified",
				DetectedAt: time.Now(),
			})
			diff.TotalModified++
		}
	}

	// Check for removed
	for key, oldValue := range fromState.Variables {
		if _, exists := toState.Variables[key]; !exists {
			diff.Changes = append(diff.Changes, SCStateChange{
				SCID:       scid,
				FromHeight: fromState.Height,
				ToHeight:   toState.Height,
				Key:        key,
				OldValue:   oldValue,
				NewValue:   nil,
				ChangeType: "removed",
				DetectedAt: time.Now(),
			})
			diff.TotalRemoved++
		}
	}

	return diff, nil
}

// isEqual compares two interface{} values
func isEqual(a, b interface{}) bool {
	aJSON, _ := json.Marshal(a)
	bJSON, _ := json.Marshal(b)
	return string(aJSON) == string(bJSON)
}

// ==================== SC Change History ====================

// GetSCHistory returns all cached states for an SC
func (t *TimeTravelExplorer) GetSCHistory(scid string) ([]SCStateSnapshot, error) {
	t.RLock()
	defer t.RUnlock()

	ss, err := t.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	tree, _ := ss.GetTree(TreeSCStateCache)
	cursor := tree.Cursor()

	prefix := fmt.Sprintf("%s:", scid)
	snapshots := []SCStateSnapshot{}

	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		keyStr := string(k)
		if len(keyStr) >= len(prefix) && keyStr[:len(prefix)] == prefix {
			var snapshot SCStateSnapshot
			if json.Unmarshal(v, &snapshot) == nil {
				snapshots = append(snapshots, snapshot)
			}
		}
	}

	return snapshots, nil
}

// GetSCChangeTimeline returns changes detected between captured states
func (t *TimeTravelExplorer) GetSCChangeTimeline(scid string) ([]SCStateDiff, error) {
	snapshots, err := t.GetSCHistory(scid)
	if err != nil {
		return nil, err
	}

	if len(snapshots) < 2 {
		return []SCStateDiff{}, nil
	}

	timeline := []SCStateDiff{}
	for i := 1; i < len(snapshots); i++ {
		diff, err := t.CompareSCState(scid, snapshots[i-1].Height, snapshots[i].Height)
		if err == nil && (diff.TotalAdded > 0 || diff.TotalModified > 0 || diff.TotalRemoved > 0 || diff.CodeChanged) {
			timeline = append(timeline, *diff)
		}
	}

	return timeline, nil
}

// ==================== SC Watching ====================

// WatchSC adds an SC to the watch list
func (t *TimeTravelExplorer) WatchSC(scid, name string) error {
	t.Lock()
	defer t.Unlock()

	watched := &WatchedSC{
		SCID:         scid,
		Name:         name,
		WatchedSince: time.Now(),
		LastChecked:  time.Now(),
	}

	ss, err := t.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree(TreeSCWatched)
	data, _ := json.Marshal(watched)

	if err := tree.Put([]byte(scid), data); err != nil {
		return err
	}

	_, err = graviton.Commit(tree)
	return err
}

// UnwatchSC removes an SC from the watch list
func (t *TimeTravelExplorer) UnwatchSC(scid string) error {
	t.Lock()
	defer t.Unlock()

	ss, _ := t.store.LoadSnapshot(0)
	tree, _ := ss.GetTree(TreeSCWatched)
	tree.Delete([]byte(scid))
	_, err := graviton.Commit(tree)
	return err
}

// GetWatchedSCs returns all watched SCs
func (t *TimeTravelExplorer) GetWatchedSCs() ([]WatchedSC, error) {
	t.RLock()
	defer t.RUnlock()

	ss, err := t.store.LoadSnapshot(0)
	if err != nil {
		return nil, err
	}

	tree, _ := ss.GetTree(TreeSCWatched)
	cursor := tree.Cursor()

	watched := []WatchedSC{}
	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		var w WatchedSC
		if json.Unmarshal(v, &w) == nil {
			watched = append(watched, w)
		}
	}

	return watched, nil
}

// CheckWatchedSCs checks all watched SCs for changes and captures state if changed
func (t *TimeTravelExplorer) CheckWatchedSCs() (int, error) {
	watched, err := t.GetWatchedSCs()
	if err != nil {
		return 0, err
	}

	changesDetected := 0
	for _, w := range watched {
		// Capture current state
		currentState, err := t.CaptureCurrentState(w.SCID)
		if err != nil {
			continue
		}

		// Get previous state
		history, _ := t.GetSCHistory(w.SCID)
		if len(history) >= 2 {
			// Compare with previous
			prevState := history[len(history)-2]
			diff, err := t.CompareSCState(w.SCID, prevState.Height, currentState.Height)
			if err == nil && (diff.TotalAdded > 0 || diff.TotalModified > 0 || diff.TotalRemoved > 0) {
				changesDetected++
				
				// Update watched entry
				t.Lock()
				w.ChangeCount++
				w.LastChange = time.Now()
				ss, _ := t.store.LoadSnapshot(0)
				tree, _ := ss.GetTree(TreeSCWatched)
				data, _ := json.Marshal(w)
				tree.Put([]byte(w.SCID), data)
				graviton.Commit(tree)
				t.Unlock()
			}
		}
	}

	return changesDetected, nil
}

// ==================== App Bindings ====================

// CaptureSCState captures the current state of an SC for time-travel
func (a *App) CaptureSCState(scid string) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	snapshot, err := a.timeTravelExplorer.CaptureCurrentState(scid)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":  true,
		"snapshot": snapshot,
	}
}

// GetSCStateAtHeight retrieves SC state at a specific height
func (a *App) GetSCStateAtHeight(scid string, height uint64) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	snapshot, err := a.timeTravelExplorer.GetStateAtHeight(scid, height)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":  true,
		"snapshot": snapshot,
	}
}

// CompareSCStateAtHeights compares SC state between two heights
func (a *App) CompareSCStateAtHeights(scid string, fromHeight, toHeight uint64) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	diff, err := a.timeTravelExplorer.CompareSCState(scid, fromHeight, toHeight)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"diff":    diff,
	}
}

// GetSCStateHistory returns all cached states for an SC
func (a *App) GetSCStateHistory(scid string) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	history, err := a.timeTravelExplorer.GetSCHistory(scid)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"history": history,
		"count":   len(history),
	}
}

// GetSCChangeTimeline returns the change timeline for an SC
func (a *App) GetSCChangeTimeline(scid string) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	timeline, err := a.timeTravelExplorer.GetSCChangeTimeline(scid)
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":  true,
		"timeline": timeline,
		"count":    len(timeline),
	}
}

// WatchSmartContract adds an SC to the watch list
func (a *App) WatchSmartContract(scid, name string) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	if err := a.timeTravelExplorer.WatchSC(scid, name); err != nil {
		return ErrorResponse(err)
	}

	// Capture initial state
	a.timeTravelExplorer.CaptureCurrentState(scid)

	return map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Now watching %s", scid[:16]),
	}
}

// UnwatchSmartContract removes an SC from the watch list
func (a *App) UnwatchSmartContract(scid string) map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	if err := a.timeTravelExplorer.UnwatchSC(scid); err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
	}
}

// GetWatchedSmartContracts returns all watched SCs
func (a *App) GetWatchedSmartContracts() map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	watched, err := a.timeTravelExplorer.GetWatchedSCs()
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success": true,
		"watched": watched,
		"count":   len(watched),
	}
}

// RefreshWatchedSCs checks all watched SCs for changes
func (a *App) RefreshWatchedSCs() map[string]interface{} {
	if a.timeTravelExplorer == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Time-travel explorer not initialized",
		}
	}

	changes, err := a.timeTravelExplorer.CheckWatchedSCs()
	if err != nil {
		return ErrorResponse(err)
	}

	return map[string]interface{}{
		"success":          true,
		"changes_detected": changes,
	}
}

