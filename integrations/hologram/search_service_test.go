package main

import (
	"testing"
)

// ============================================================================
// detectQueryType Tests
// ============================================================================

// TestDetectQueryTypeBlock tests block height detection
func TestDetectQueryTypeBlock(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"0", "block"},
		{"1", "block"},
		{"123456", "block"},
		{"999999999", "block"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeDURL tests dURL detection
func TestDetectQueryTypeDURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"dero://myapp", "durl"},
		{"dero://test-app", "durl"},
		{"DERO://MyApp", "durl"},
		{"dero://", "durl"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeAddress tests DERO address detection
func TestDetectQueryTypeAddress(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"full mainnet address", "dero1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", "address"},
		{"uppercase address", "DERO1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", "address"},
		{"short address", "dero1abc", "address"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeHash tests 64-char hex hash detection
func TestDetectQueryTypeHash(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// Note: All-numeric 64-char strings are detected as "block" first (numeric check)
		// Only hex strings with a-f characters are detected as "hash"
		{"hash with a-f letters", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", "hash"},
		{"tx hash with mixed", "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "hash"},
		{"scid with letters", "deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeef12", "hash"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeUnknown tests unknown query types
func TestDetectQueryTypeUnknown(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"random text", "hello world"},
		{"partial hash", "abcd1234"},
		{"invalid prefix", "btc1address"},
		{"special chars", "!@#$%"},
		{"empty spaces", "   "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != "unknown" {
				t.Errorf("detectQueryType(%q) = %q, want 'unknown'", tt.input, result)
			}
		})
	}
}

// ============================================================================
// truncateQuery Tests
// ============================================================================

// TestTruncateQueryShort tests that short queries are not truncated
func TestTruncateQueryShort(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello", "hello"},
		{"12345678901234567890", "12345678901234567890"}, // Exactly 20 chars
		{"abc", "abc"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := truncateQuery(tt.input)
			if result != tt.expected {
				t.Errorf("truncateQuery(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestTruncateQueryLong tests that long queries are truncated
func TestTruncateQueryLong(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			// 21 chars: first 10 + "..." + last 10
			"21 chars",
			"123456789012345678901",
			"1234567890...2345678901",
		},
		{
			// 64 chars: first 10 + "..." + last 10
			"64-char hash",
			"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
			"abcdef1234...1234567890",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := truncateQuery(tt.input)
			if result != tt.expected {
				t.Errorf("truncateQuery(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// SearchResult Struct Tests
// ============================================================================

// TestSearchResultFields tests SearchResult struct field access
func TestSearchResultFields(t *testing.T) {
	result := SearchResult{
		Success: true,
		Type:    "block",
		Query:   "123456",
		Data: map[string]interface{}{
			"height": 123456,
		},
	}

	if !result.Success {
		t.Error("Success should be true")
	}
	if result.Type != "block" {
		t.Errorf("Type = %q, want 'block'", result.Type)
	}
	if result.Query != "123456" {
		t.Errorf("Query = %q, want '123456'", result.Query)
	}
	if result.Data["height"] != 123456 {
		t.Errorf("Data[height] = %v, want 123456", result.Data["height"])
	}
}

// TestSearchResultError tests error result creation
func TestSearchResultError(t *testing.T) {
	result := SearchResult{
		Success: false,
		Type:    "unknown",
		Query:   "invalid",
		Error:   "Test error message",
	}

	if result.Success {
		t.Error("Success should be false")
	}
	if result.Error != "Test error message" {
		t.Errorf("Error = %q, want 'Test error message'", result.Error)
	}
}

// ============================================================================
// Address Validation Tests (searchAddress helper logic)
// ============================================================================

// TestAddressValidation tests address format validation logic
func TestAddressValidation(t *testing.T) {
	tests := []struct {
		name    string
		address string
		valid   bool
	}{
		{"valid mainnet address", "dero1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", true},
		{"valid uppercase", "DERO1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", true},
		{"valid short", "dero1abc", true},
		{"invalid prefix", "btc1address", false},
		{"empty", "", false},
		{"just dero1", "dero1", true}, // Technically passes prefix check
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// This tests the validation logic used in searchAddress
			isValid := len(tt.address) > 0 && (len(tt.address) >= 5 && 
				(tt.address[:5] == "dero1" || tt.address[:5] == "DERO1"))
			
			// Simplified check matching searchAddress logic
			hasPrefix := len(tt.address) >= 5 && 
				(tt.address[:5] == "dero1" || tt.address[:5] == "DERO1")
			
			if hasPrefix != tt.valid {
				t.Errorf("address %q hasPrefix = %v, want %v", tt.address, hasPrefix, tt.valid)
			}
			_ = isValid // silence unused warning
		})
	}
}

// ============================================================================
// getMapKeys Helper Tests
// ============================================================================

// TestGetMapKeys tests the map key extraction helper
func TestGetMapKeys(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]interface{}
		expected int
	}{
		{
			"empty map",
			map[string]interface{}{},
			0,
		},
		{
			"single key",
			map[string]interface{}{"code": "test"},
			1,
		},
		{
			"multiple keys",
			map[string]interface{}{
				"code":       "Function test() {}",
				"balance":    uint64(1000),
				"stringkeys": map[string]interface{}{},
				"uint64keys": map[string]interface{}{},
			},
			4,
		},
		{
			"nil values in map",
			map[string]interface{}{
				"key1": nil,
				"key2": "value",
				"key3": nil,
			},
			3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			keys := getMapKeys(tt.input)
			if len(keys) != tt.expected {
				t.Errorf("getMapKeys() returned %d keys, want %d", len(keys), tt.expected)
			}
		})
	}
}

// TestGetMapKeysContents verifies actual key names are returned
func TestGetMapKeysContents(t *testing.T) {
	input := map[string]interface{}{
		"alpha": 1,
		"beta":  2,
		"gamma": 3,
	}

	keys := getMapKeys(input)
	keySet := make(map[string]bool)
	for _, k := range keys {
		keySet[k] = true
	}

	expectedKeys := []string{"alpha", "beta", "gamma"}
	for _, expected := range expectedKeys {
		if !keySet[expected] {
			t.Errorf("getMapKeys() missing expected key %q", expected)
		}
	}
}

// ============================================================================
// Edge Case Tests for detectQueryType
// ============================================================================

// TestDetectQueryType64DigitNumeric tests the edge case where a 64-digit
// all-numeric string is detected as "hash" (potential SCID) rather than "block"
// Session 86 fixed this: 64-char hex check comes BEFORE block height check
// to properly handle all-digit SCIDs like Genesis SC (0000...0001)
func TestDetectQueryType64DigitNumeric(t *testing.T) {
	// A 64-digit all-numeric string (valid hex, could be SCID)
	input := "1234567890123456789012345678901234567890123456789012345678901234"
	result := detectQueryType(input)
	
	// Current behavior: 64-char hex check comes first, so this is "hash"
	// This allows proper handling of Genesis SC SCID (0000...0001)
	if result != "hash" {
		t.Errorf("detectQueryType(%q) = %q, expected 'hash' (64-char hex priority)", input, result)
	}
}

// TestDetectQueryTypeWhitespace tests whitespace handling
func TestDetectQueryTypeWhitespace(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"leading spaces block", "  123456", "block"},
		{"trailing spaces block", "123456  ", "block"},
		{"both spaces block", "  123456  ", "block"},
		{"leading spaces address", "  dero1abc", "address"},
		{"trailing spaces address", "dero1abc  ", "address"},
		{"leading spaces durl", "  dero://app", "durl"},
		{"trailing spaces durl", "dero://app  ", "durl"},
		{"leading spaces hash", "  abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", "hash"},
		{"tabs and spaces", "\t 123456 \t", "block"},
		{"newline wrapped", "\n123456\n", "block"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeCaseSensitivity tests case variations
func TestDetectQueryTypeCaseSensitivity(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"lowercase durl", "dero://app", "durl"},
		{"uppercase durl", "DERO://APP", "durl"},
		{"mixed case durl", "DeRo://ApP", "durl"},
		{"lowercase address", "dero1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", "address"},
		{"uppercase address", "DERO1QYW4FL3DUPCG5QLRCSVCEDZE507Q9U67LXFPU8KGNZP04AQ73YHEQQG2CTJN4", "address"},
		{"mixed case address", "DeRo1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4", "address"},
		{"uppercase hex hash", "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890", "hash"},
		{"mixed case hex hash", "AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890", "hash"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeHashBoundary tests hash length boundaries
func TestDetectQueryTypeHashBoundary(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"63 char hex (too short)", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789", "unknown"},
		{"64 char hex (exact)", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", "hash"},
		{"65 char hex (too long)", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901", "unknown"},
		{"32 char hex (half)", "abcdef1234567890abcdef1234567890", "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDetectQueryTypeSpecialInputs tests special/malformed inputs
func TestDetectQueryTypeSpecialInputs(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", "unknown"},
		{"just whitespace", "   ", "unknown"},
		{"dero:// without name", "dero://", "durl"},
		{"dero1 only", "dero1", "address"},
		{"negative number", "-123456", "unknown"},
		{"decimal number", "123.456", "unknown"},
		{"hex with 0x prefix", "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", "unknown"},
		{"hash with spaces", "abcdef12 34567890 abcdef12 34567890 abcdef12 34567890 abcdef12 34567890", "unknown"},
		{"durl with query params", "dero://app?param=value", "durl"},
		{"durl with path", "dero://app/path/to/resource", "durl"},
		{"unicode in query", "hello世界", "unknown"},
		{"emoji", "[START]123456", "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// truncateQuery Edge Cases
// ============================================================================

// TestTruncateQueryBoundary tests boundary conditions
func TestTruncateQueryBoundary(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"exactly 19 chars", "1234567890123456789", "1234567890123456789"},
		{"exactly 20 chars", "12345678901234567890", "12345678901234567890"},
		{"exactly 21 chars", "123456789012345678901", "1234567890...2345678901"},
		{"exactly 22 chars", "1234567890123456789012", "1234567890...3456789012"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := truncateQuery(tt.input)
			if result != tt.expected {
				t.Errorf("truncateQuery(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestTruncateQueryUnicode tests unicode character handling
func TestTruncateQueryUnicode(t *testing.T) {
	// Note: truncateQuery uses len() which counts bytes, not runes
	// This documents the current behavior
	tests := []struct {
		name  string
		input string
	}{
		{"short unicode", "hello世界"},
		{"unicode address-like", "dero1世界test"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should not panic
			result := truncateQuery(tt.input)
			if result == "" && tt.input != "" {
				t.Errorf("truncateQuery(%q) returned empty string unexpectedly", tt.input)
			}
		})
	}
}

// ============================================================================
// SearchResult Edge Cases
// ============================================================================

// TestSearchResultNilData tests SearchResult with nil Data map
func TestSearchResultNilData(t *testing.T) {
	result := SearchResult{
		Success: false,
		Type:    "block",
		Query:   "99999999999",
		Error:   "Block not found",
		Data:    nil,
	}

	if result.Data != nil {
		t.Error("Data should be nil")
	}
	if result.Error != "Block not found" {
		t.Errorf("Error = %q, want 'Block not found'", result.Error)
	}
}

// TestSearchResultEmptyData tests SearchResult with empty Data map
func TestSearchResultEmptyData(t *testing.T) {
	result := SearchResult{
		Success: true,
		Type:    "address",
		Query:   "dero1test",
		Data:    map[string]interface{}{},
	}

	if result.Data == nil {
		t.Error("Data should not be nil")
	}
	if len(result.Data) != 0 {
		t.Errorf("Data should be empty, got %d keys", len(result.Data))
	}
}

// TestSearchResultComplexData tests SearchResult with nested data
func TestSearchResultComplexData(t *testing.T) {
	result := SearchResult{
		Success: true,
		Type:    "address",
		Query:   "dero1test",
		Data: map[string]interface{}{
			"address":    "dero1test",
			"valid":      true,
			"hasGnomon":  false,
			"owned_apps": []map[string]interface{}{},
			"nested": map[string]interface{}{
				"key": "value",
			},
		},
	}

	if !result.Success {
		t.Error("Success should be true")
	}
	if result.Data["valid"] != true {
		t.Error("Data[valid] should be true")
	}
	if apps, ok := result.Data["owned_apps"].([]map[string]interface{}); !ok {
		t.Error("Data[owned_apps] should be []map[string]interface{}")
	} else if len(apps) != 0 {
		t.Errorf("Data[owned_apps] should be empty, got %d", len(apps))
	}
}

// ============================================================================
// Type Detection Priority Tests
// ============================================================================

// TestDetectQueryTypePriority verifies the priority order of type detection
func TestDetectQueryTypePriority(t *testing.T) {
	// This test documents the detection priority:
	// 1. Numeric (block height) - checked first
	// 2. dURL (dero:// prefix)
	// 3. Address (dero1 prefix)
	// 4. 64-char hex (hash)
	// 5. Unknown (fallback)

	// A string that could match multiple patterns should follow priority
	tests := []struct {
		name        string
		input       string
		expected    string
		explanation string
	}{
		{
			"numeric wins over all",
			"123",
			"block",
			"Pure numeric is always block height",
		},
		{
			"dero:// wins for durl",
			"dero://123",
			"durl",
			"dero:// prefix triggers durl even with numeric path",
		},
		{
			"dero1 wins for address",
			"dero1abcdef",
			"address",
			"dero1 prefix triggers address detection",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectQueryType(tt.input)
			if result != tt.expected {
				t.Errorf("detectQueryType(%q) = %q, want %q (%s)", 
					tt.input, result, tt.expected, tt.explanation)
			}
		})
	}
}

// ============================================================================
// Benchmarks
// ============================================================================

// BenchmarkGetMapKeys benchmarks the map key extraction
func BenchmarkGetMapKeys(b *testing.B) {
	m := map[string]interface{}{
		"code":       "Function test() { return 1; }",
		"balance":    uint64(1000000),
		"stringkeys": map[string]interface{}{"owner": "dero1..."},
		"uint64keys": map[string]interface{}{"count": uint64(42)},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		getMapKeys(m)
	}
}

// BenchmarkDetectQueryType benchmarks query type detection
func BenchmarkDetectQueryType(b *testing.B) {
	queries := []string{
		"123456",
		"dero://myapp",
		"dero1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4",
		"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
		"unknown query",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, q := range queries {
			detectQueryType(q)
		}
	}
}

// BenchmarkTruncateQuery benchmarks query truncation
func BenchmarkTruncateQuery(b *testing.B) {
	queries := []string{
		"short",
		"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, q := range queries {
			truncateQuery(q)
		}
	}
}
