// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for Cache Optimizer

package main

import (
	"sync"
	"testing"
	"time"
)

// ============== LRUCache Tests ==============

func TestNewLRUCache(t *testing.T) {
	cache := NewLRUCache(100)

	if cache == nil {
		t.Fatal("NewLRUCache should not return nil")
	}

	if cache.capacity != 100 {
		t.Errorf("Capacity = %d, expected 100", cache.capacity)
	}

	// Test default capacity
	cacheDefault := NewLRUCache(0)
	if cacheDefault.capacity != 1000 {
		t.Errorf("Default capacity = %d, expected 1000", cacheDefault.capacity)
	}
}

func TestLRUCacheGetSet(t *testing.T) {
	cache := NewLRUCache(10)

	// Test set and get
	cache.Set("key1", "value1")

	val, ok := cache.Get("key1")
	if !ok {
		t.Error("Get should return true for existing key")
	}
	if val != "value1" {
		t.Errorf("Get returned %v, expected value1", val)
	}

	// Test missing key
	_, ok = cache.Get("missing")
	if ok {
		t.Error("Get should return false for missing key")
	}
}

func TestLRUCacheGetString(t *testing.T) {
	cache := NewLRUCache(10)

	cache.Set("str", "hello")
	cache.Set("int", 42)

	// Test string retrieval
	str, ok := cache.GetString("str")
	if !ok || str != "hello" {
		t.Errorf("GetString returned %s, %v, expected hello, true", str, ok)
	}

	// Test non-string value
	_, ok = cache.GetString("int")
	if ok {
		t.Error("GetString should return false for non-string value")
	}
}

func TestLRUCacheDelete(t *testing.T) {
	cache := NewLRUCache(10)

	cache.Set("key", "value")
	cache.Delete("key")

	_, ok := cache.Get("key")
	if ok {
		t.Error("Deleted key should not exist")
	}
}

func TestLRUCacheClear(t *testing.T) {
	cache := NewLRUCache(10)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Clear()

	_, ok1 := cache.Get("key1")
	_, ok2 := cache.Get("key2")

	if ok1 || ok2 {
		t.Error("Clear should remove all entries")
	}
}

func TestLRUCacheEviction(t *testing.T) {
	cache := NewLRUCache(3)

	// Fill cache
	cache.Set("a", "1")
	time.Sleep(1 * time.Millisecond)
	cache.Set("b", "2")
	time.Sleep(1 * time.Millisecond)
	cache.Set("c", "3")

	// Access "a" to make it more recent
	cache.Get("a")
	time.Sleep(1 * time.Millisecond)

	// Add new item - should evict "b" (least recently used)
	cache.Set("d", "4")

	// "b" should be evicted
	_, okB := cache.Get("b")
	if okB {
		t.Error("'b' should have been evicted (LRU)")
	}

	// "a", "c", "d" should still exist
	_, okA := cache.Get("a")
	_, okC := cache.Get("c")
	_, okD := cache.Get("d")

	if !okA || !okC || !okD {
		t.Errorf("Expected a, c, d to exist: a=%v, c=%v, d=%v", okA, okC, okD)
	}
}

func TestLRUCacheStats(t *testing.T) {
	cache := NewLRUCache(10)

	cache.Set("key1", "value1")
	cache.Get("key1") // Hit
	cache.Get("key2") // Miss

	stats := cache.Stats()

	if stats["hits"].(int64) != 1 {
		t.Errorf("Hits = %v, expected 1", stats["hits"])
	}
	if stats["misses"].(int64) != 1 {
		t.Errorf("Misses = %v, expected 1", stats["misses"])
	}
	if stats["size"].(int) != 1 {
		t.Errorf("Size = %v, expected 1", stats["size"])
	}
	if stats["hitRatio"].(float64) != 0.5 {
		t.Errorf("HitRatio = %v, expected 0.5", stats["hitRatio"])
	}
}

func TestLRUCacheConcurrent(t *testing.T) {
	cache := NewLRUCache(100)

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent writers
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			key := string(rune('a' + id%26))
			cache.Set(key, id)
		}(i)
	}

	// Concurrent readers
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			key := string(rune('a' + id%26))
			cache.Get(key)
		}(i)
	}

	wg.Wait()
	// No race conditions or panics = success
}

// ============== QueryCache Tests ==============

func TestNewQueryCache(t *testing.T) {
	qc := NewQueryCache()

	if qc == nil {
		t.Fatal("NewQueryCache should not return nil")
	}

	if qc.nrsNames == nil {
		t.Error("nrsNames cache should be initialized")
	}
	if qc.scStates == nil {
		t.Error("scStates cache should be initialized")
	}
	if qc.telApps == nil {
		t.Error("telApps cache should be initialized")
	}
}

func TestQueryCacheNRSNames(t *testing.T) {
	qc := NewQueryCache()

	qc.SetNameForAddr("dero1abc...", "myname")
	qc.SetAddrForName("myname", "dero1abc...")

	name, ok := qc.GetNameForAddr("dero1abc...")
	if !ok || name != "myname" {
		t.Errorf("GetNameForAddr = %s, %v, expected myname, true", name, ok)
	}

	addr, ok := qc.GetAddrForName("myname")
	if !ok || addr != "dero1abc..." {
		t.Errorf("GetAddrForName = %s, %v, expected dero1abc..., true", addr, ok)
	}
}

func TestQueryCacheSCStates(t *testing.T) {
	qc := NewQueryCache()

	state := map[string]interface{}{
		"owner":   "dero1...",
		"balance": uint64(1000000),
	}

	qc.SetSCState("scid123...", 5000000, state)

	cached, ok := qc.GetSCState("scid123...", 5000000)
	if !ok {
		t.Error("GetSCState should return true for cached entry")
	}
	if cached["owner"] != "dero1..." {
		t.Errorf("owner = %v, expected dero1...", cached["owner"])
	}

	// Different height should not match
	_, ok = qc.GetSCState("scid123...", 5000001)
	if ok {
		t.Error("GetSCState should return false for different height")
	}
}

func TestQueryCacheTELAApps(t *testing.T) {
	qc := NewQueryCache()

	app := map[string]interface{}{
		"name":        "TestApp",
		"description": "A test app",
		"rating":      4.5,
	}

	qc.SetTELAApp("appscid...", app)

	cached, ok := qc.GetTELAApp("appscid...")
	if !ok {
		t.Error("GetTELAApp should return true for cached entry")
	}
	if cached["name"] != "TestApp" {
		t.Errorf("name = %v, expected TestApp", cached["name"])
	}
}

func TestQueryCacheInvalidateApp(t *testing.T) {
	qc := NewQueryCache()

	qc.SetTELAApp("scid1", map[string]interface{}{"name": "App1"})

	qc.InvalidateApp("scid1")

	_, okApp := qc.GetTELAApp("scid1")

	if okApp {
		t.Error("InvalidateApp should remove app from all caches")
	}
}

func TestQueryCacheClearAll(t *testing.T) {
	qc := NewQueryCache()

	qc.SetNameForAddr("addr", "name")
	qc.SetSCState("scid", 0, map[string]interface{}{})
	qc.SetTELAApp("scid", map[string]interface{}{})

	qc.ClearAll()

	stats := qc.AllStats()

	for cacheName, cacheStats := range stats {
		cs := cacheStats.(map[string]interface{})
		if cs["size"].(int) != 0 {
			t.Errorf("%s should be empty after ClearAll, has %d entries", cacheName, cs["size"])
		}
	}
}

// ============== WriteBuffer Tests ==============

func TestNewWriteBuffer(t *testing.T) {
	buffer := NewWriteBuffer(50, nil)

	if buffer == nil {
		t.Fatal("NewWriteBuffer should not return nil")
	}

	if buffer.maxSize != 50 {
		t.Errorf("maxSize = %d, expected 50", buffer.maxSize)
	}

	// Test default size
	bufferDefault := NewWriteBuffer(0, nil)
	if bufferDefault.maxSize != 100 {
		t.Errorf("Default maxSize = %d, expected 100", bufferDefault.maxSize)
	}
}

func TestWriteBufferAdd(t *testing.T) {
	var flushed bool
	flushFn := func(tree string, entries map[string][]byte) error {
		flushed = true
		return nil
	}

	buffer := NewWriteBuffer(3, flushFn)

	// Add entries below threshold
	buffer.Add("tree1", "key1", []byte("value1"))
	buffer.Add("tree1", "key2", []byte("value2"))

	if flushed {
		t.Error("Should not flush before reaching max size")
	}

	// Add entry that triggers flush
	buffer.Add("tree1", "key3", []byte("value3"))

	if !flushed {
		t.Error("Should flush when reaching max size")
	}
}

func TestWriteBufferFlush(t *testing.T) {
	var flushedTrees []string
	var flushedEntries int

	flushFn := func(tree string, entries map[string][]byte) error {
		flushedTrees = append(flushedTrees, tree)
		flushedEntries += len(entries)
		return nil
	}

	buffer := NewWriteBuffer(100, flushFn)

	buffer.Add("tree1", "key1", []byte("value1"))
	buffer.Add("tree2", "key2", []byte("value2"))
	buffer.Add("tree1", "key3", []byte("value3"))

	buffer.Flush()

	if len(flushedTrees) != 2 {
		t.Errorf("Expected 2 trees to be flushed, got %d", len(flushedTrees))
	}

	if flushedEntries != 3 {
		t.Errorf("Expected 3 entries to be flushed, got %d", flushedEntries)
	}

	// Buffer should be empty after flush
	if buffer.Size() != 0 {
		t.Errorf("Buffer size after flush = %d, expected 0", buffer.Size())
	}
}

func TestWriteBufferSize(t *testing.T) {
	buffer := NewWriteBuffer(100, nil)

	if buffer.Size() != 0 {
		t.Error("New buffer should have size 0")
	}

	buffer.Add("tree1", "key1", []byte("value1"))
	buffer.Add("tree1", "key2", []byte("value2"))
	buffer.Add("tree2", "key3", []byte("value3"))

	if buffer.Size() != 3 {
		t.Errorf("Buffer size = %d, expected 3", buffer.Size())
	}
}

// ============== Benchmark Tests ==============

func BenchmarkLRUCacheGet(b *testing.B) {
	cache := NewLRUCache(1000)

	// Pre-populate
	for i := 0; i < 1000; i++ {
		cache.Set(string(rune(i)), i)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Get(string(rune(i % 1000)))
	}
}

func BenchmarkLRUCacheSet(b *testing.B) {
	cache := NewLRUCache(1000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Set(string(rune(i%1000)), i)
	}
}

func BenchmarkQueryCacheNRS(b *testing.B) {
	qc := NewQueryCache()

	// Pre-populate
	for i := 0; i < 100; i++ {
		qc.SetNameForAddr(string(rune('a'+i)), string(rune('A'+i)))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		qc.GetNameForAddr(string(rune('a' + i%100)))
	}
}
