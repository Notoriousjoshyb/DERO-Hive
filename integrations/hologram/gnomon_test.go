package main

import (
	"strings"
	"testing"
)

// ============================================================================
// Search-filter / token-discovery tests
// ============================================================================

// TestTokenFilterMatchesArtificerNFA locks in the reason the token auto-scan can
// discover held NFAs: the Artificer ART-NFA-MS1 initializer contains the broad
// tokenSearchFilter substring but NOT the strict TELA snippet. If a future edit
// narrows tokenSearchFilter past this, NFAs silently stop auto-detecting.
func TestTokenFilterMatchesArtificerNFA(t *testing.T) {
	// Representative ART-NFA-MS1 header (as seen on-chain for Desperado/Gun NFAs).
	artificerInit := "Function InitializePrivate() Uint64\n10 IF EXISTS(\"owner\") == 0 THEN GOTO 20 ELSE GOTO 999\n20 STORE(\"owner\", SIGNER())"

	if !strings.Contains(artificerInit, tokenSearchFilter) {
		t.Errorf("tokenSearchFilter %q must match the Artificer NFA initializer — NFAs would not auto-detect", tokenSearchFilter)
	}
	if strings.Contains(artificerInit, gnomonSearchFilter) {
		t.Error("strict gnomonSearchFilter must NOT match the Artificer NFA initializer (it's why the wider filter was needed)")
	}
}

// TestGnomonFiltersContainsBoth ensures the active filter set keeps both the
// strict TELA filter (app discovery) and the broad token filter (auto-scan).
func TestGnomonFiltersContainsBoth(t *testing.T) {
	var hasStrict, hasToken bool
	for _, f := range gnomonFilters {
		if f == gnomonSearchFilter {
			hasStrict = true
		}
		if f == tokenSearchFilter {
			hasToken = true
		}
	}
	if !hasStrict {
		t.Error("gnomonFilters must include gnomonSearchFilter for TELA app discovery")
	}
	if !hasToken {
		t.Error("gnomonFilters must include tokenSearchFilter for token/NFA auto-detect")
	}
}

// TestFilterVersionStable verifies the version is non-empty and deterministic for
// a given filter set (so the migration fires on change, not spuriously).
func TestFilterVersionStable(t *testing.T) {
	v1 := currentFilterVersion()
	v2 := currentFilterVersion()
	if v1 == "" {
		t.Error("currentFilterVersion must be non-empty")
	}
	if v1 != v2 {
		t.Errorf("currentFilterVersion must be deterministic: %q != %q", v1, v2)
	}
}

// ============================================================================
// GnomonClient Constructor Tests
// ============================================================================

// TestNewGnomonClient verifies default constructor initialization
func TestNewGnomonClient(t *testing.T) {
	client := NewGnomonClient("")

	if client == nil {
		t.Fatal("NewGnomonClient returned nil")
	}
	if client.dbType != "gravdb" {
		t.Errorf("dbType = %s, want gravdb (default)", client.dbType)
	}
	if client.running {
		t.Error("running should be false initially")
	}
	if client.fastsync != true {
		t.Error("fastsync should default to true")
	}
	if client.parallelBlocks != 5 {
		t.Errorf("parallelBlocks = %d, want 5", client.parallelBlocks)
	}
}

// TestNewGnomonClientWithDBType verifies custom db type
func TestNewGnomonClientWithDBType(t *testing.T) {
	tests := []struct {
		name     string
		dbType   string
		expected string
	}{
		{"empty defaults to gravdb", "", "gravdb"},
		{"explicit gravdb", "gravdb", "gravdb"},
		{"boltdb", "boltdb", "boltdb"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewGnomonClient(tt.dbType)
			if client.dbType != tt.expected {
				t.Errorf("dbType = %s, want %s", client.dbType, tt.expected)
			}
		})
	}
}

// ============================================================================
// IsRunning / GetStatus Tests (Nil Guard Paths)
// ============================================================================

// TestIsRunningFalseWhenNotStarted verifies IsRunning returns false when not started
func TestIsRunningFalseWhenNotStarted(t *testing.T) {
	client := NewGnomonClient("")

	if client.IsRunning() {
		t.Error("IsRunning should return false when not started")
	}
}

// TestIsRunningFalseWithNilIndexer verifies IsRunning returns false with nil indexer
func TestIsRunningFalseWithNilIndexer(t *testing.T) {
	client := NewGnomonClient("")
	client.running = true // Force running flag
	client.Indexer = nil  // But indexer is nil

	if client.IsRunning() {
		t.Error("IsRunning should return false when Indexer is nil")
	}
}

// TestGetStatusWhenNotRunning verifies GetStatus returns correct state when not running
func TestGetStatusWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	status := client.GetStatus()

	if status["running"] != false {
		t.Errorf("running = %v, want false", status["running"])
	}
	if status["indexed_height"] != 0 {
		t.Errorf("indexed_height = %v, want 0", status["indexed_height"])
	}
	if status["chain_height"] != 0 {
		t.Errorf("chain_height = %v, want 0", status["chain_height"])
	}
	if status["progress"] != 0.0 {
		t.Errorf("progress = %v, want 0.0", status["progress"])
	}
}

// ============================================================================
// Method Nil Guards (Return Empty Results When Not Running)
// ============================================================================

// TestGetAllOwnersAndSCIDsWhenNotRunning verifies empty map when not running
func TestGetAllOwnersAndSCIDsWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.GetAllOwnersAndSCIDs()

	if result == nil {
		t.Error("result should not be nil, should be empty map")
	}
	if len(result) != 0 {
		t.Errorf("len(result) = %d, want 0", len(result))
	}
}

// TestGetAllSCIDVariableDetailsWhenNotRunning verifies nil when not running
func TestGetAllSCIDVariableDetailsWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.GetAllSCIDVariableDetails("test-scid")

	if result != nil {
		t.Errorf("result = %v, want nil", result)
	}
}

// TestGetSCIDValuesByKeyWhenNotRunning verifies nil when not running
func TestGetSCIDValuesByKeyWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	strings, uint64s := client.GetSCIDValuesByKey("test-scid", "test-key")

	if strings != nil {
		t.Errorf("strings = %v, want nil", strings)
	}
	if uint64s != nil {
		t.Errorf("uint64s = %v, want nil", uint64s)
	}
}

// TestGetSCIDKeysByValueWhenNotRunning verifies nil when not running
func TestGetSCIDKeysByValueWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	strings, uint64s := client.GetSCIDKeysByValue("test-scid", "test-value")

	if strings != nil {
		t.Errorf("strings = %v, want nil", strings)
	}
	if uint64s != nil {
		t.Errorf("uint64s = %v, want nil", uint64s)
	}
}

// TestGetTELAAppsWhenNotRunning verifies empty slice when not running
func TestGetTELAAppsWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.GetTELAApps()

	if result == nil {
		t.Error("result should not be nil, should be empty slice")
	}
	if len(result) != 0 {
		t.Errorf("len(result) = %d, want 0", len(result))
	}
}

// TestSearchTELAppsWhenNotRunning verifies empty results when not running
func TestSearchTELAppsWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.SearchTELApps("test query")

	if result == nil {
		t.Error("result should not be nil, should be empty slice")
	}
	if len(result) != 0 {
		t.Errorf("len(result) = %d, want 0", len(result))
	}
}

// TestLatestInteractionHeightWhenNotRunning verifies 0 when not running
func TestLatestInteractionHeightWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.LatestInteractionHeight("test-scid")

	if result != 0 {
		t.Errorf("result = %d, want 0", result)
	}
}

// TestCheckAppSupportsEpochWhenNotRunning verifies false when not running
func TestCheckAppSupportsEpochWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.CheckAppSupportsEpoch("test-scid")

	if result != false {
		t.Errorf("result = %v, want false", result)
	}
}

// TestGetTELAAppsWithEpochInfoWhenNotRunning verifies empty when not running
func TestGetTELAAppsWithEpochInfoWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	result := client.GetTELAAppsWithEpochInfo()

	if result == nil {
		t.Error("result should not be nil")
	}
	if len(result) != 0 {
		t.Errorf("len(result) = %d, want 0", len(result))
	}
}

// TestResolveNameWhenNotRunning verifies false when not running
func TestResolveNameWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	scid, found := client.ResolveName("test-name")

	if found {
		t.Error("found should be false")
	}
	if scid != "" {
		t.Errorf("scid = %s, want empty string", scid)
	}
}

// TestResolveDURLWhenNotRunning verifies false when not running
func TestResolveDURLWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	scid, found := client.ResolveDURL("test-durl")

	if found {
		t.Error("found should be false")
	}
	if scid != "" {
		t.Errorf("scid = %s, want empty string", scid)
	}
}

// TestGetRatingWhenNotRunning verifies error when not running
func TestGetRatingWhenNotRunning(t *testing.T) {
	client := NewGnomonClient("")

	_, err := client.GetRating("test-scid")

	if err == nil {
		t.Error("expected error when not running")
	}
}

// ============================================================================
// cleanupAppName Tests (Pure Function)
// ============================================================================

// TestCleanupAppNameURLs tests URL cleanup behavior
func TestCleanupAppNameURLs(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// URL prefix removal
		{"https prefix", "https://example.com", "Example"},
		{"http prefix", "http://example.com", "Example"},
		{"www prefix", "www.example.com", "Example"},
		{"full URL with path", "https://www.example.com/path/to/file", "Example"},

		// Known services
		{"GitHub URL", "https://raw.githubusercontent.com/user/repo/main/file.html", "GitHub"},
		{"Pinata URL", "https://gateway.pinata.cloud/ipfs/Qm123abc", "Pinata"},
		{"DERO URL", "https://dero.io/something", "DERO"},

		// Domain extraction
		{"subdomain handling", "https://api.service.com/endpoint", "Service"},
		{"simple domain", "example.com", "Example"},

		// Edge cases
		{"already clean", "My App Name", "My App Name"},
		{"short name", "App", "App"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := cleanupAppName(tt.input)
			if result != tt.expected {
				t.Errorf("cleanupAppName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestCleanupAppNameTruncation tests length truncation
func TestCleanupAppNameTruncation(t *testing.T) {
	// Input longer than 40 chars should be truncated with "..."
	longName := "This is a very long application name that exceeds forty characters"
	result := cleanupAppName(longName)

	if len(result) > 40 {
		t.Errorf("result length = %d, want <= 40", len(result))
	}
	// Should end with "..." if truncated
	if len(longName) > 40 && result[len(result)-3:] != "..." {
		t.Errorf("truncated result should end with '...', got %q", result)
	}
}

// TestCleanupAppNameEmpty tests empty input handling
func TestCleanupAppNameEmpty(t *testing.T) {
	result := cleanupAppName("")

	// Empty input should return empty (not panic)
	if result != "" {
		t.Errorf("cleanupAppName('') = %q, want empty string", result)
	}
}

// TestCleanupAppNameSpecialChars tests special character handling
func TestCleanupAppNameSpecialChars(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://i.ibb.co/abc123/image.png", "Ibb"},
		{"avatars.githubusercontent.com/user", "GitHub"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := cleanupAppName(tt.input)
			if result != tt.expected {
				t.Errorf("cleanupAppName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// parseUint64Safe Tests (Pure Function)
// ============================================================================

// TestParseUint64SafeValid tests valid uint64 parsing
func TestParseUint64SafeValid(t *testing.T) {
	tests := []struct {
		input    string
		expected uint64
	}{
		{"0", 0},
		{"1", 1},
		{"123", 123},
		{"1000000", 1000000},
		{"18446744073709551615", 18446744073709551615}, // Max uint64
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result, err := parseUint64Safe(tt.input)
			if err != nil {
				t.Errorf("parseUint64Safe(%q) returned error: %v", tt.input, err)
			}
			if result != tt.expected {
				t.Errorf("parseUint64Safe(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

// TestParseUint64SafeInvalid tests invalid input handling
func TestParseUint64SafeInvalid(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"empty string", ""},
		{"whitespace only", "   "},
		{"negative number", "-1"},
		{"float", "1.5"},
		{"non-numeric", "abc"},
		{"mixed", "123abc"},
		{"overflow", "18446744073709551616"}, // Max uint64 + 1
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseUint64Safe(tt.input)
			if err == nil {
				t.Errorf("parseUint64Safe(%q) should return error", tt.input)
			}
		})
	}
}

// TestParseUint64SafeWhitespace tests whitespace trimming
func TestParseUint64SafeWhitespace(t *testing.T) {
	tests := []struct {
		input    string
		expected uint64
	}{
		{" 123", 123},
		{"123 ", 123},
		{" 123 ", 123},
		{"  456  ", 456},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result, err := parseUint64Safe(tt.input)
			if err != nil {
				t.Errorf("parseUint64Safe(%q) returned error: %v", tt.input, err)
			}
			if result != tt.expected {
				t.Errorf("parseUint64Safe(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// decodeHexIfNeeded Tests (Pure Function)
// ============================================================================

// TestDecodeHexIfNeededNumeric tests that numeric strings pass through
func TestDecodeHexIfNeededNumeric(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"0", "0"},
		{"123", "123"},
		{"999999", "999999"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := decodeHexIfNeeded(tt.input)
			if result != tt.expected {
				t.Errorf("decodeHexIfNeeded(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestDecodeHexIfNeededHex tests hex string decoding
// Note: The function first checks if input is a valid decimal number.
// Only hex strings with a-f characters (not valid decimals) get decoded.
func TestDecodeHexIfNeededHex(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"hex hello (has c,f)", "68656c6c6f", "hello"},
		{"hex HELLO (has c,f)", "48454c4c4f", "HELLO"},
		{"hex dero (has d,e)", "6465726f", "dero"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := decodeHexIfNeeded(tt.input)
			if result != tt.expected {
				t.Errorf("decodeHexIfNeeded(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// ResolveName / ResolveDURL Edge Cases
// ============================================================================

// TestResolveNameEmptyInput tests empty input handling
func TestResolveNameEmptyInput(t *testing.T) {
	client := NewGnomonClient("")
	client.running = true // Bypass the not-running guard
	// Still returns false because Indexer is nil

	tests := []string{"", "   ", "\t", "\n"}

	for _, input := range tests {
		scid, found := client.ResolveName(input)
		if found {
			t.Errorf("ResolveName(%q) should return found=false", input)
		}
		if scid != "" {
			t.Errorf("ResolveName(%q) scid = %q, want empty", input, scid)
		}
	}
}

// TestResolveDURLEmptyInput tests empty input handling
func TestResolveDURLEmptyInput(t *testing.T) {
	client := NewGnomonClient("")
	client.running = true // Bypass the not-running guard

	tests := []string{"", "   ", "\t"}

	for _, input := range tests {
		scid, found := client.ResolveDURL(input)
		if found {
			t.Errorf("ResolveDURL(%q) should return found=false", input)
		}
		if scid != "" {
			t.Errorf("ResolveDURL(%q) scid = %q, want empty", input, scid)
		}
	}
}

// TestResolveDURLPrefixHandling tests dero:// prefix handling
func TestResolveDURLPrefixHandling(t *testing.T) {
	// This tests the normalization logic (not actual resolution since Indexer is nil)
	client := NewGnomonClient("")

	// When not running, both should return false
	_, found1 := client.ResolveDURL("testapp")
	_, found2 := client.ResolveDURL("dero://testapp")

	// Both should consistently return false when not running
	if found1 || found2 {
		t.Error("ResolveDURL should return false when not running")
	}
}

// ============================================================================
// gnomonSearchFilter Constant Test
// ============================================================================

// TestGnomonSearchFilterDefined verifies the search filter is properly defined
func TestGnomonSearchFilterDefined(t *testing.T) {
	if gnomonSearchFilter == "" {
		t.Error("gnomonSearchFilter should not be empty")
	}
	// Should contain key DVM-BASIC patterns for TELA app detection
	if len(gnomonSearchFilter) < 50 {
		t.Error("gnomonSearchFilter seems too short")
	}
}

// ============================================================================
// maxParallelBlocks Constant Test
// ============================================================================

// TestMaxParallelBlocksConstant verifies the constant value
func TestMaxParallelBlocksConstant(t *testing.T) {
	if maxParallelBlocks != 10 {
		t.Errorf("maxParallelBlocks = %d, want 10", maxParallelBlocks)
	}
}

// ============================================================================
// Benchmarks
// ============================================================================

// BenchmarkCleanupAppName benchmarks the URL cleanup function
func BenchmarkCleanupAppName(b *testing.B) {
	inputs := []string{
		"https://raw.githubusercontent.com/user/repo/main/file.html",
		"My Simple App",
		"https://gateway.pinata.cloud/ipfs/Qm123abc",
		"example.com",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, input := range inputs {
			cleanupAppName(input)
		}
	}
}

// BenchmarkParseUint64Safe benchmarks uint64 parsing
func BenchmarkParseUint64Safe(b *testing.B) {
	inputs := []string{"0", "123", "1000000", "18446744073709551615"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, input := range inputs {
			parseUint64Safe(input)
		}
	}
}

// BenchmarkDecodeHexIfNeeded benchmarks hex decoding
func BenchmarkDecodeHexIfNeeded(b *testing.B) {
	inputs := []string{"123", "68656c6c6f", "999999", "48454c4c4f"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, input := range inputs {
			decodeHexIfNeeded(input)
		}
	}
}

// BenchmarkIsRunning benchmarks the IsRunning check
func BenchmarkIsRunning(b *testing.B) {
	client := NewGnomonClient("")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.IsRunning()
	}
}

// BenchmarkGetStatusNotRunning benchmarks GetStatus when not running
func BenchmarkGetStatusNotRunning(b *testing.B) {
	client := NewGnomonClient("")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.GetStatus()
	}
}
