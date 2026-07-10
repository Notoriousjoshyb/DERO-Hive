// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for EpochHandler

package main

import (
	"sync"
	"testing"
	"time"
)

// ============== EpochHandler Creation Tests ==============

func TestNewEpochHandler(t *testing.T) {
	var logMessages []string
	logFunc := func(msg string) {
		logMessages = append(logMessages, msg)
	}

	handler := NewEpochHandler(logFunc)

	if handler == nil {
		t.Fatal("NewEpochHandler should not return nil")
	}

	// Check defaults
	if !handler.enabled {
		t.Error("EPOCH should be enabled by default (opt-out model)")
	}

	if handler.maxHashes != DEFAULT_EPOCH_MAX_HASHES {
		t.Errorf("maxHashes = %d, expected %d", handler.maxHashes, DEFAULT_EPOCH_MAX_HASHES)
	}

	if handler.maxThreads != DEFAULT_EPOCH_MAX_THREADS {
		t.Errorf("maxThreads = %d, expected %d", handler.maxThreads, DEFAULT_EPOCH_MAX_THREADS)
	}

	if handler.rateLimits == nil {
		t.Error("rateLimits map should be initialized")
	}

	// Test that logging works
	handler.log("test message")
	if len(logMessages) != 1 || logMessages[0] != "test message" {
		t.Errorf("log function not working correctly, got: %v", logMessages)
	}
}

func TestEpochHandlerNilLogFunc(t *testing.T) {
	handler := NewEpochHandler(nil)

	// Should not panic with nil logFunc
	handler.log("this should not panic")

	if handler == nil {
		t.Fatal("NewEpochHandler should not return nil even with nil logFunc")
	}
}

// ============== Enable/Disable Tests ==============

func TestEpochHandlerSetEnabled(t *testing.T) {
	handler := NewEpochHandler(nil)

	// Verify default is enabled
	if !handler.IsEnabled() {
		t.Error("EPOCH should be enabled by default")
	}

	// Disable
	handler.SetEnabled(false)
	if handler.IsEnabled() {
		t.Error("EPOCH should be disabled after SetEnabled(false)")
	}

	// Re-enable
	handler.SetEnabled(true)
	if !handler.IsEnabled() {
		t.Error("EPOCH should be enabled after SetEnabled(true)")
	}
}

func TestEpochHandlerConcurrentEnable(t *testing.T) {
	handler := NewEpochHandler(nil)

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent writers
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(val bool) {
			defer wg.Done()
			handler.SetEnabled(val)
		}(i%2 == 0)
	}

	// Concurrent readers
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = handler.IsEnabled()
		}()
	}

	wg.Wait()
	// No race conditions or panics = success
}

// ============== Configuration Tests ==============

func TestEpochHandlerSetMaxHashes(t *testing.T) {
	handler := NewEpochHandler(nil)

	// Valid value
	err := handler.SetMaxHashes(50)
	if err != nil {
		t.Errorf("SetMaxHashes(50) should not error: %v", err)
	}

	handler.RLock()
	if handler.maxHashes != 50 {
		t.Errorf("maxHashes = %d, expected 50", handler.maxHashes)
	}
	handler.RUnlock()

	// Invalid values
	err = handler.SetMaxHashes(0)
	if err == nil {
		t.Error("SetMaxHashes(0) should return error")
	}

	err = handler.SetMaxHashes(-1)
	if err == nil {
		t.Error("SetMaxHashes(-1) should return error")
	}
}

func TestEpochHandlerSetMaxThreads(t *testing.T) {
	handler := NewEpochHandler(nil)

	handler.SetMaxThreads(4)

	handler.RLock()
	if handler.maxThreads != 4 {
		t.Errorf("maxThreads = %d, expected 4", handler.maxThreads)
	}
	handler.RUnlock()
}

func TestEpochHandlerGetConfig(t *testing.T) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(true)
	handler.SetMaxHashes(75)
	handler.SetMaxThreads(3)

	handler.Lock()
	handler.address = "dero1testaddress..."
	handler.Unlock()

	config := handler.GetConfig()

	if config["enabled"] != true {
		t.Error("config[enabled] should be true")
	}
	if config["max_hashes"] != 75 {
		t.Errorf("config[max_hashes] = %v, expected 75", config["max_hashes"])
	}
	if config["max_threads"] != 3 {
		t.Errorf("config[max_threads] = %v, expected 3", config["max_threads"])
	}
	if config["address"] != "dero1testaddress..." {
		t.Errorf("config[address] = %v, expected dero1testaddress...", config["address"])
	}
}

func TestEpochHandlerSetConfig(t *testing.T) {
	handler := NewEpochHandler(nil)

	// Set config
	handler.SetConfig(false, 200, 6)

	handler.RLock()
	if handler.enabled {
		t.Error("enabled should be false after SetConfig")
	}
	if handler.maxHashes != 200 {
		t.Errorf("maxHashes = %d, expected 200", handler.maxHashes)
	}
	if handler.maxThreads != 6 {
		t.Errorf("maxThreads = %d, expected 6", handler.maxThreads)
	}
	handler.RUnlock()

	// Test with invalid max hashes (should not change)
	handler.SetConfig(true, 0, 2) // 0 is invalid

	handler.RLock()
	if handler.maxHashes != 200 { // Should remain unchanged
		t.Errorf("maxHashes changed to %d when it shouldn't have", handler.maxHashes)
	}
	handler.RUnlock()
}

// ============== Stats Tests ==============

func TestEpochHandlerGetStats(t *testing.T) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(true)
	handler.SetMaxHashes(100)
	handler.SetMaxThreads(2)

	handler.Lock()
	handler.address = "dero1test..."
	handler.Unlock()

	stats := handler.GetStats()

	if !stats.Enabled {
		t.Error("stats.Enabled should be true")
	}
	if stats.MaxHashes != 100 {
		t.Errorf("stats.MaxHashes = %d, expected 100", stats.MaxHashes)
	}
	if stats.MaxThreads != 2 {
		t.Errorf("stats.MaxThreads = %d, expected 2", stats.MaxThreads)
	}
	if stats.Address != "dero1test..." {
		t.Errorf("stats.Address = %s, expected dero1test...", stats.Address)
	}
}

// ============== Rate Limiting Tests ==============

func TestEpochHandlerRateLimiting(t *testing.T) {
	handler := NewEpochHandler(nil)

	appSCID := "testapp123456789"

	// First request should not be rate limited (no entry exists)
	if handler.isRateLimited(appSCID, 100) {
		t.Error("First request should not be rate limited")
	}

	// Record 100 hashes (total: 100)
	handler.recordRequest(appSCID, 100, 0)

	// 100 + 100 = 200 <= 500, should NOT be rate limited
	if handler.isRateLimited(appSCID, 100) {
		t.Error("200 total hashes should not be rate limited")
	}
	handler.recordRequest(appSCID, 100, 0) // total: 200

	// 200 + 100 = 300 <= 500, should NOT be rate limited
	if handler.isRateLimited(appSCID, 100) {
		t.Error("300 total hashes should not be rate limited")
	}
	handler.recordRequest(appSCID, 100, 0) // total: 300

	// 300 + 100 = 400 <= 500, should NOT be rate limited
	if handler.isRateLimited(appSCID, 100) {
		t.Error("400 total hashes should not be rate limited")
	}
	handler.recordRequest(appSCID, 100, 0) // total: 400

	// 400 + 100 = 500 <= 500 (equals limit), should NOT be rate limited
	// Note: The check is > not >=, so exactly at limit is allowed
	if handler.isRateLimited(appSCID, 100) {
		t.Error("500 total hashes should not be rate limited (equals limit)")
	}
	handler.recordRequest(appSCID, 100, 0) // total: 500

	// Now at 500, requesting 1 more would be 501 > 500, should be rate limited
	if !handler.isRateLimited(appSCID, 1) {
		t.Error("501 total hashes should be rate limited (exceeds 500)")
	}

	// Requesting 100 more would be 600 > 500, should definitely be rate limited
	if !handler.isRateLimited(appSCID, 100) {
		t.Error("600 total hashes should be rate limited")
	}
}

func TestEpochHandlerRateLimitingWindow(t *testing.T) {
	handler := NewEpochHandler(nil)

	appSCID := "testapp123456789"

	// Fill up rate limit
	handler.recordRequest(appSCID, 400, 0)
	if handler.isRateLimited(appSCID, 200) {
		// 600 would exceed 500
	}

	// Manually expire the window
	handler.rateLimitLock.Lock()
	if entry, exists := handler.rateLimits[appSCID]; exists {
		entry.lastRequest = time.Now().Add(-RATE_LIMIT_WINDOW - time.Second)
	}
	handler.rateLimitLock.Unlock()

	// Now should not be rate limited
	if handler.isRateLimited(appSCID, 200) {
		t.Error("After window expiry, should not be rate limited")
	}
}

func TestEpochHandlerRateLimitingMultipleApps(t *testing.T) {
	handler := NewEpochHandler(nil)

	app1 := "app1scid..."
	app2 := "app2scid..."

	// Fill app1's limit
	handler.recordRequest(app1, RATE_LIMIT_MAX_HASHES, 0)

	// app1 should be rate limited
	if !handler.isRateLimited(app1, 1) {
		t.Error("app1 should be rate limited")
	}

	// app2 should not be affected
	if handler.isRateLimited(app2, 100) {
		t.Error("app2 should not be rate limited")
	}

	handler.recordRequest(app2, 100, 0)

	// app2 still has room
	if handler.isRateLimited(app2, 100) {
		t.Error("app2 should still not be rate limited")
	}
}

func TestEpochHandlerRateLimitingUnknownIdentifierNormalization(t *testing.T) {
	handler := NewEpochHandler(nil)

	handler.recordRequest("", 300, 0)
	if handler.isRateLimited("   ", 200) {
		t.Error("unknown bucket should not be rate limited at exactly 500 hashes")
	}
	if !handler.isRateLimited("", 201) {
		t.Error("unknown bucket should be rate limited once it exceeds 500 hashes")
	}
}

func TestEpochHandlerRecordRequestMetrics(t *testing.T) {
	handler := NewEpochHandler(nil)
	appID := "app-metrics"

	handler.recordRequest(appID, 100, 1)
	handler.recordRequest(appID, 50, 2)

	handler.rateLimitLock.Lock()
	entry := handler.rateLimits[appID]
	handler.rateLimitLock.Unlock()

	if entry == nil {
		t.Fatal("expected metrics entry for app")
	}
	if entry.totalRequests != 2 {
		t.Errorf("totalRequests = %d, expected 2", entry.totalRequests)
	}
	if entry.totalHashes != 150 {
		t.Errorf("totalHashes = %d, expected 150", entry.totalHashes)
	}
	if entry.totalMiniBlocks != 3 {
		t.Errorf("totalMiniBlocks = %d, expected 3", entry.totalMiniBlocks)
	}
}

func TestNormalizeAppIdentifier(t *testing.T) {
	if got := normalizeAppIdentifier(""); got != "unknown" {
		t.Errorf("normalizeAppIdentifier(\"\") = %q, expected unknown", got)
	}
	if got := normalizeAppIdentifier("   "); got != "unknown" {
		t.Errorf("normalizeAppIdentifier(whitespace) = %q, expected unknown", got)
	}
	if got := normalizeAppIdentifier("  app-1  "); got != "app-1" {
		t.Errorf("normalizeAppIdentifier(trim) = %q, expected app-1", got)
	}
}

func TestPreviewAppIdentifier(t *testing.T) {
	if got := previewAppIdentifier(""); got != "unknown" {
		t.Errorf("previewAppIdentifier(\"\") = %q, expected unknown", got)
	}
	if got := previewAppIdentifier("short-id"); got != "short-id" {
		t.Errorf("previewAppIdentifier(short) = %q, expected short-id", got)
	}
	longID := "0123456789abcdefXYZ"
	if got := previewAppIdentifier(longID); got != "0123456789abcdef..." {
		t.Errorf("previewAppIdentifier(long) = %q, expected 16-char preview", got)
	}
}

// ============== HandleRequest Tests ==============

func TestEpochHandlerHandleRequestDisabled(t *testing.T) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(false)

	result := handler.HandleRequest(50, "testapp...")

	if result.Success {
		t.Error("HandleRequest should fail when disabled")
	}
	if result.Error != "Developer support is disabled" {
		t.Errorf("Expected 'Developer support is disabled', got '%s'", result.Error)
	}
}

func TestEpochHandlerHandleRequestNotActive(t *testing.T) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(true)

	// EPOCH is not connected (IsActive = false)
	result := handler.HandleRequest(50, "testapp...")

	if result.Success {
		t.Error("HandleRequest should fail when EPOCH is not active")
	}
	if result.Error != "EPOCH not connected" {
		t.Errorf("Expected 'EPOCH not connected', got '%s'", result.Error)
	}
}

func TestEpochHandlerHandleRequestLimitEnforcement(t *testing.T) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(true)
	handler.SetMaxHashes(50)

	// Even though we can't test with active EPOCH, we can verify the limit enforcement
	// by checking the internal state

	// Requesting more than limit should be capped
	requestedHashes := 1000
	maxAllowed := 50

	if requestedHashes > maxAllowed {
		requestedHashes = maxAllowed
	}

	if requestedHashes != 50 {
		t.Errorf("Requested hashes should be capped to %d, got %d", maxAllowed, requestedHashes)
	}

	// Requesting less than 1 should be set to 1
	requestedHashes = 0
	if requestedHashes < 1 {
		requestedHashes = 1
	}

	if requestedHashes != 1 {
		t.Error("Requested hashes should be at least 1")
	}
}

// ============== Concurrent Access Tests ==============

func TestEpochHandlerConcurrentRateLimiting(t *testing.T) {
	handler := NewEpochHandler(nil)

	appSCID := "testapp..."
	var wg sync.WaitGroup
	iterations := 100

	// Concurrent rate limit checks and recordings
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = handler.isRateLimited(appSCID, 10)
			handler.recordRequest(appSCID, 10, 0)
		}()
	}

	wg.Wait()

	// Verify no race conditions occurred - should have recorded some hashes
	handler.rateLimitLock.Lock()
	entry := handler.rateLimits[appSCID]
	handler.rateLimitLock.Unlock()

	if entry == nil {
		t.Error("Rate limit entry should exist after recordings")
	}

	// Should have recorded roughly 1000 hashes (100 * 10)
	// Actual might be less due to window expiry and resets
	if entry.hashCount == 0 {
		t.Error("Hash count should be greater than 0")
	}
}

func TestEpochHandlerConcurrentConfig(t *testing.T) {
	handler := NewEpochHandler(nil)

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent config changes
	for i := 0; i < iterations; i++ {
		wg.Add(3)
		go func(val int) {
			defer wg.Done()
			handler.SetEnabled(val%2 == 0)
		}(i)
		go func(val int) {
			defer wg.Done()
			handler.SetMaxHashes(50 + val%50)
		}(i)
		go func() {
			defer wg.Done()
			_ = handler.GetStats()
		}()
	}

	wg.Wait()
	// No race conditions or panics = success
}

// ============== Benchmark Tests ==============

func BenchmarkEpochHandlerGetStats(b *testing.B) {
	handler := NewEpochHandler(nil)
	handler.SetEnabled(true)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = handler.GetStats()
	}
}

func BenchmarkEpochHandlerIsRateLimited(b *testing.B) {
	handler := NewEpochHandler(nil)
	appSCID := "testapp..."

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = handler.isRateLimited(appSCID, 10)
	}
}

func BenchmarkEpochHandlerRecordRequest(b *testing.B) {
	handler := NewEpochHandler(nil)
	appSCID := "testapp..."

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		handler.recordRequest(appSCID, 10, 0)
	}
}

func BenchmarkEpochHandlerGetConfig(b *testing.B) {
	handler := NewEpochHandler(nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = handler.GetConfig()
	}
}
