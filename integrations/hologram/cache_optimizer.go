// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Cache Optimizer - In-memory LRU cache layer for frequently accessed Graviton data

package main

import (
	"fmt"
	"sync"
	"time"
)

// CacheEntry represents a cached item with metadata
type CacheEntry struct {
	Value      interface{}
	LastAccess time.Time
	AccessCount int64
}

// LRUCache provides an in-memory LRU cache with configurable size
type LRUCache struct {
	mu       sync.RWMutex
	capacity int
	entries  map[string]*CacheEntry
	hits     int64
	misses   int64
}

// NewLRUCache creates a new LRU cache with the specified capacity
func NewLRUCache(capacity int) *LRUCache {
	if capacity <= 0 {
		capacity = 1000 // Default to 1000 entries
	}
	return &LRUCache{
		capacity: capacity,
		entries:  make(map[string]*CacheEntry),
	}
}

// Get retrieves a value from the cache
func (c *LRUCache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	entry, exists := c.entries[key]
	c.mu.RUnlock()

	if !exists {
		c.mu.Lock()
		c.misses++
		c.mu.Unlock()
		return nil, false
	}

	// Update access info
	c.mu.Lock()
	entry.LastAccess = time.Now()
	entry.AccessCount++
	c.hits++
	c.mu.Unlock()

	return entry.Value, true
}

// GetString is a convenience method for string values
func (c *LRUCache) GetString(key string) (string, bool) {
	val, ok := c.Get(key)
	if !ok {
		return "", false
	}
	str, ok := val.(string)
	return str, ok
}

// Set stores a value in the cache
func (c *LRUCache) Set(key string, value interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we need to evict
	if len(c.entries) >= c.capacity {
		c.evictLRU()
	}

	c.entries[key] = &CacheEntry{
		Value:       value,
		LastAccess:  time.Now(),
		AccessCount: 1,
	}
}

// SetWithTTL stores a value with a TTL (not enforced, for info only)
func (c *LRUCache) SetWithTTL(key string, value interface{}, ttl time.Duration) {
	// Basic implementation - TTL is informational
	c.Set(key, value)
}

// Delete removes a value from the cache
func (c *LRUCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

// Clear removes all entries from the cache
func (c *LRUCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]*CacheEntry)
}

// evictLRU removes the least recently used entry (must hold write lock)
func (c *LRUCache) evictLRU() {
	var lruKey string
	var lruTime time.Time

	for key, entry := range c.entries {
		if lruKey == "" || entry.LastAccess.Before(lruTime) {
			lruKey = key
			lruTime = entry.LastAccess
		}
	}

	if lruKey != "" {
		delete(c.entries, lruKey)
	}
}

// Stats returns cache statistics
func (c *LRUCache) Stats() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	total := c.hits + c.misses
	ratio := float64(0)
	if total > 0 {
		ratio = float64(c.hits) / float64(total)
	}

	return map[string]interface{}{
		"hits":     c.hits,
		"misses":   c.misses,
		"size":     len(c.entries),
		"capacity": c.capacity,
		"hitRatio": ratio,
	}
}

// ============== Optimized Query Cache ==============

// QueryCache provides caching for expensive Graviton queries
type QueryCache struct {
	// Separate caches for different data types with appropriate sizes
	nrsNames    *LRUCache // NRS name lookups (frequently queried)
	scStates    *LRUCache // SC state snapshots (can be large)
	telApps     *LRUCache // TELA app metadata
}

// NewQueryCache creates a new optimized query cache
func NewQueryCache() *QueryCache {
	return &QueryCache{
		nrsNames:    NewLRUCache(500),  // 500 names
		scStates:    NewLRUCache(50),   // 50 SC states (can be large)
		telApps:     NewLRUCache(200),  // 200 app metadata entries
	}
}

// NRS name cache helpers
func (q *QueryCache) GetNameForAddr(addr string) (string, bool) {
	return q.nrsNames.GetString("addr:" + addr)
}

func (q *QueryCache) SetNameForAddr(addr, name string) {
	q.nrsNames.Set("addr:"+addr, name)
}

func (q *QueryCache) GetAddrForName(name string) (string, bool) {
	return q.nrsNames.GetString("name:" + name)
}

func (q *QueryCache) SetAddrForName(name, addr string) {
	q.nrsNames.Set("name:"+name, addr)
}

// SC state cache helpers
func (q *QueryCache) GetSCState(scid string, height int64) (map[string]interface{}, bool) {
	key := cacheKey("sc", scid, height)
	val, ok := q.scStates.Get(key)
	if !ok {
		return nil, false
	}
	state, ok := val.(map[string]interface{})
	return state, ok
}

func (q *QueryCache) SetSCState(scid string, height int64, state map[string]interface{}) {
	key := cacheKey("sc", scid, height)
	q.scStates.Set(key, state)
}

// TELA app metadata cache helpers
func (q *QueryCache) GetTELAApp(scid string) (map[string]interface{}, bool) {
	val, ok := q.telApps.Get("tela:" + scid)
	if !ok {
		return nil, false
	}
	app, ok := val.(map[string]interface{})
	return app, ok
}

func (q *QueryCache) SetTELAApp(scid string, app map[string]interface{}) {
	q.telApps.Set("tela:"+scid, app)
}

// InvalidateApp removes an app from all relevant caches
func (q *QueryCache) InvalidateApp(scid string) {
	q.telApps.Delete("tela:" + scid)
}

// ClearAll clears all caches
func (q *QueryCache) ClearAll() {
	q.nrsNames.Clear()
	q.scStates.Clear()
	q.telApps.Clear()
}

// AllStats returns statistics for all caches
func (q *QueryCache) AllStats() map[string]interface{} {
	return map[string]interface{}{
		"nrsNames":    q.nrsNames.Stats(),
		"scStates":    q.scStates.Stats(),
		"telApps":     q.telApps.Stats(),
	}
}

// cacheKey generates a compound cache key
func cacheKey(prefix string, id string, version int64) string {
	if version == 0 {
		return prefix + ":" + id
	}
	// Use fmt.Sprintf for proper int64 to string conversion
	return prefix + ":" + id + ":" + fmt.Sprintf("%d", version)
}

// ============== Batch Write Buffer ==============

// WriteBuffer batches Graviton writes for improved performance
type WriteBuffer struct {
	mu       sync.Mutex
	pending  map[string]map[string][]byte // tree -> key -> value
	maxSize  int
	flushFn  func(tree string, entries map[string][]byte) error
	lastFlush time.Time
	flushInterval time.Duration
}

// NewWriteBuffer creates a new write buffer
func NewWriteBuffer(maxSize int, flushFn func(tree string, entries map[string][]byte) error) *WriteBuffer {
	if maxSize <= 0 {
		maxSize = 100
	}
	return &WriteBuffer{
		pending:       make(map[string]map[string][]byte),
		maxSize:       maxSize,
		flushFn:       flushFn,
		lastFlush:     time.Now(),
		flushInterval: 5 * time.Second,
	}
}

// Add adds a write to the buffer
func (w *WriteBuffer) Add(tree, key string, value []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.pending[tree] == nil {
		w.pending[tree] = make(map[string][]byte)
	}
	w.pending[tree][key] = value

	// Check if we should flush
	totalSize := 0
	for _, m := range w.pending {
		totalSize += len(m)
	}

	shouldFlush := totalSize >= w.maxSize || time.Since(w.lastFlush) > w.flushInterval

	if shouldFlush {
		return w.flushLocked()
	}

	return nil
}

// Flush immediately writes all pending data
func (w *WriteBuffer) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flushLocked()
}

// flushLocked must be called with lock held
func (w *WriteBuffer) flushLocked() error {
	if w.flushFn == nil {
		return nil
	}

	for tree, entries := range w.pending {
		if len(entries) > 0 {
			if err := w.flushFn(tree, entries); err != nil {
				return err
			}
		}
	}

	w.pending = make(map[string]map[string][]byte)
	w.lastFlush = time.Now()
	return nil
}

// Size returns the current buffer size
func (w *WriteBuffer) Size() int {
	w.mu.Lock()
	defer w.mu.Unlock()

	total := 0
	for _, m := range w.pending {
		total += len(m)
	}
	return total
}
