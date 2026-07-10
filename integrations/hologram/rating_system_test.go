package main

import (
	"testing"
)

// ============================================================================
// ParseRating Tests
// ============================================================================

// TestParseRatingValidRatings tests valid rating parsing
func TestParseRatingValidRatings(t *testing.T) {
	tests := []struct {
		name            string
		rating          uint64
		expectedCat     string
		expectedDetail  string
		expectedCatNum  uint64
	}{
		{"00 - Do not use, Nothing", 0, "Do not use", "Nothing", 0},
		{"09 - Do not use, Malicious", 9, "Do not use", "Malicious", 0},
		{"10 - Broken, Nothing", 10, "Broken", "Nothing", 1},
		{"19 - Broken, Malicious", 19, "Broken", "Malicious", 1},
		{"25 - Major issues, Inappropriate", 25, "Major issues", "Inappropriate", 2},
		{"37 - Minor issues, Corrupted", 37, "Minor issues", "Corrupted", 3},
		{"42 - Should be improved, Needs improvement", 42, "Should be improved", "Needs improvement", 4},
		{"50 - Could be improved, Nothing", 50, "Could be improved", "Nothing", 5}, // Detail 0 = Nothing
		{"60 - Average, Nothing", 60, "Average", "Nothing", 6},
		{"67 - Average, Works well", 67, "Average", "Works well", 6},
		{"70 - Good, Nothing", 70, "Good", "Nothing", 7},
		{"78 - Good, Unique", 78, "Good", "Unique", 7},
		{"85 - Very good, Visually appealing", 85, "Very good", "Visually appealing", 8},
		{"90 - Exceptional, Nothing", 90, "Exceptional", "Nothing", 9},
		{"99 - Exceptional, Benevolent", 99, "Exceptional", "Benevolent", 9},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cat, detail, catNum, err := ParseRating(tt.rating)
			if err != nil {
				t.Errorf("ParseRating(%d) returned error: %v", tt.rating, err)
				return
			}
			if cat != tt.expectedCat {
				t.Errorf("category = %q, want %q", cat, tt.expectedCat)
			}
			if detail != tt.expectedDetail {
				t.Errorf("detail = %q, want %q", detail, tt.expectedDetail)
			}
			if catNum != tt.expectedCatNum {
				t.Errorf("categoryNum = %d, want %d", catNum, tt.expectedCatNum)
			}
		})
	}
}

// TestParseRatingInvalidRatings tests invalid rating handling
func TestParseRatingInvalidRatings(t *testing.T) {
	tests := []struct {
		name   string
		rating uint64
	}{
		{"100 - Out of range", 100},
		{"150 - Way out of range", 150},
		{"999 - Very high", 999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, err := ParseRating(tt.rating)
			if err == nil {
				t.Errorf("ParseRating(%d) should return error for out-of-range rating", tt.rating)
			}
		})
	}
}

// TestParseRatingBoundaries tests rating boundary conditions
func TestParseRatingBoundaries(t *testing.T) {
	// Test all category boundaries
	for catNum := uint64(0); catNum <= 9; catNum++ {
		rating := catNum * 10
		cat, _, resultCatNum, err := ParseRating(rating)
		if err != nil {
			t.Errorf("ParseRating(%d) returned error: %v", rating, err)
			continue
		}
		if resultCatNum != catNum {
			t.Errorf("ParseRating(%d) categoryNum = %d, want %d", rating, resultCatNum, catNum)
		}
		if cat == "" {
			t.Errorf("ParseRating(%d) returned empty category", rating)
		}
	}
}

// ============================================================================
// ParseRatingString Tests
// ============================================================================

// TestParseRatingString tests human-readable rating string generation
func TestParseRatingString(t *testing.T) {
	tests := []struct {
		rating   uint64
		expected string
	}{
		{0, "Do not use"},                         // Nothing detail is omitted
		{9, "Do not use (Malicious)"},
		{60, "Average"},                           // Nothing detail is omitted
		{67, "Average (Works well)"},
		{99, "Exceptional (Benevolent)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := ParseRatingString(tt.rating)
			if result != tt.expected {
				t.Errorf("ParseRatingString(%d) = %q, want %q", tt.rating, result, tt.expected)
			}
		})
	}
}

// TestParseRatingStringInvalid tests invalid rating string handling
func TestParseRatingStringInvalid(t *testing.T) {
	result := ParseRatingString(100) // Out of range
	if result != "Unknown rating" {
		t.Errorf("ParseRatingString(100) = %q, want 'Unknown rating'", result)
	}
}

// ============================================================================
// GetRatingColor Tests
// ============================================================================

// TestGetRatingColor tests color mapping for rating categories
func TestGetRatingColor(t *testing.T) {
	tests := []struct {
		categoryNum uint64
		expected    string
		description string
	}{
		{0, "#ef4444", "Do not use - Red"},
		{1, "#ef4444", "Broken - Red"},
		{2, "#f97316", "Major issues - Orange"},
		{3, "#f97316", "Minor issues - Orange"},
		{4, "#eab308", "Should improve - Yellow"},
		{5, "#eab308", "Could improve - Yellow"},
		{6, "#22c55e", "Average - Green"},
		{7, "#22c55e", "Good - Green"},
		{8, "#3b82f6", "Very good - Blue"},
		{9, "#3b82f6", "Exceptional - Blue"},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			result := GetRatingColor(tt.categoryNum)
			if result != tt.expected {
				t.Errorf("GetRatingColor(%d) = %q, want %q", tt.categoryNum, result, tt.expected)
			}
		})
	}
}

// TestGetRatingColorHighValues tests colors for out-of-range high values
func TestGetRatingColorHighValues(t *testing.T) {
	// Values > 9 should still return blue (exceptional)
	result := GetRatingColor(10)
	if result != "#3b82f6" {
		t.Errorf("GetRatingColor(10) = %q, want '#3b82f6'", result)
	}
}

// ============================================================================
// ShouldBlockContent Tests
// ============================================================================

// TestShouldBlockContentMalware tests malware blocking
func TestShouldBlockContentMalware(t *testing.T) {
	// Use min_rating 0 to isolate malware-only blocking behavior
	settings := map[string]interface{}{
		"min_rating":    0, // No quality threshold - only test malware blocking
		"block_malware": true,
	}

	tests := []struct {
		rating      float64
		shouldBlock bool
		description string
	}{
		{0.0, true, "Rating 0 - malware"},
		{0.5, true, "Rating 0.5 - malware"},
		{1.0, true, "Rating 1.0 - malware"},
		{1.9, true, "Rating 1.9 - malware"},
		{2.0, false, "Rating 2.0 - not malware"},
		{5.0, false, "Rating 5.0 - not malware"},
		{9.0, false, "Rating 9.0 - not malware"},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			blocked, _ := ShouldBlockContent(tt.rating, settings)
			if blocked != tt.shouldBlock {
				t.Errorf("ShouldBlockContent(%.1f) blocked = %v, want %v", tt.rating, blocked, tt.shouldBlock)
			}
		})
	}
}

// TestShouldBlockContentMinRating tests minimum rating threshold
func TestShouldBlockContentMinRating(t *testing.T) {
	settings := map[string]interface{}{
		"min_rating":    70,
		"block_malware": true,
	}

	tests := []struct {
		rating      float64
		shouldBlock bool
		description string
	}{
		{6.0, true, "Rating 6.0 (60/100) - below 70 threshold"},
		{6.9, true, "Rating 6.9 (69/100) - below 70 threshold"},
		{7.0, false, "Rating 7.0 (70/100) - at threshold"},
		{8.0, false, "Rating 8.0 (80/100) - above threshold"},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			blocked, _ := ShouldBlockContent(tt.rating, settings)
			if blocked != tt.shouldBlock {
				t.Errorf("ShouldBlockContent(%.1f) blocked = %v, want %v", tt.rating, blocked, tt.shouldBlock)
			}
		})
	}
}

// TestShouldBlockContentMalwareDisabled tests with malware blocking disabled
func TestShouldBlockContentMalwareDisabled(t *testing.T) {
	settings := map[string]interface{}{
		"min_rating":    0, // No minimum
		"block_malware": false,
	}

	// Even low ratings shouldn't be blocked when malware blocking is off
	blocked, _ := ShouldBlockContent(0.5, settings)
	if blocked {
		t.Error("ShouldBlockContent should not block when malware blocking is disabled and min_rating is 0")
	}
}

// TestShouldBlockContentDefaultSettings tests default settings behavior
func TestShouldBlockContentDefaultSettings(t *testing.T) {
	// Empty settings should use defaults
	settings := map[string]interface{}{}

	// Default min_rating is 60, default block_malware is true
	blocked, _ := ShouldBlockContent(1.0, settings) // Malware level
	if !blocked {
		t.Error("ShouldBlockContent should block malware by default")
	}

	blocked, _ = ShouldBlockContent(5.0, settings) // Below default 60
	if !blocked {
		t.Error("ShouldBlockContent should block below default min_rating of 60")
	}

	blocked, _ = ShouldBlockContent(7.0, settings) // Above default 60
	if blocked {
		t.Error("ShouldBlockContent should not block above default min_rating of 60")
	}
}

// ============================================================================
// CalculateAverageRating Tests
// ============================================================================

// TestCalculateAverageRatingNormal tests normal average calculation
func TestCalculateAverageRatingNormal(t *testing.T) {
	tests := []struct {
		name     string
		ratings  []Rating
		expected float64
	}{
		{
			"single rating 70",
			[]Rating{{Rating: 70}},
			7.0,
		},
		{
			"two ratings 60 and 80",
			[]Rating{{Rating: 60}, {Rating: 80}},
			7.0, // (6 + 8) / 2
		},
		{
			"three ratings 50, 70, 90",
			[]Rating{{Rating: 50}, {Rating: 70}, {Rating: 90}},
			7.0, // (5 + 7 + 9) / 3
		},
		{
			"all same rating 60",
			[]Rating{{Rating: 60}, {Rating: 60}, {Rating: 60}},
			6.0,
		},
		{
			"detail digits ignored",
			[]Rating{{Rating: 65}, {Rating: 67}, {Rating: 69}},
			6.0, // All category 6
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CalculateAverageRating(tt.ratings)
			if result != tt.expected {
				t.Errorf("CalculateAverageRating() = %f, want %f", result, tt.expected)
			}
		})
	}
}

// TestCalculateAverageRatingEmpty tests empty ratings slice
func TestCalculateAverageRatingEmpty(t *testing.T) {
	result := CalculateAverageRating([]Rating{})
	if result != 0.0 {
		t.Errorf("CalculateAverageRating([]) = %f, want 0.0", result)
	}
}

// TestCalculateAverageRatingNil tests nil ratings slice
func TestCalculateAverageRatingNil(t *testing.T) {
	result := CalculateAverageRating(nil)
	if result != 0.0 {
		t.Errorf("CalculateAverageRating(nil) = %f, want 0.0", result)
	}
}

// ============================================================================
// GetRatingBadgeHTML Tests
// ============================================================================

// TestGetRatingBadgeHTMLNil tests nil result handling
func TestGetRatingBadgeHTMLNil(t *testing.T) {
	result := GetRatingBadgeHTML(nil)
	if result != `<span style="color: #6b7280;">No ratings yet</span>` {
		t.Errorf("GetRatingBadgeHTML(nil) = %q, want 'No ratings yet' span", result)
	}
}

// TestGetRatingBadgeHTMLNoRatings tests zero count handling
func TestGetRatingBadgeHTMLNoRatings(t *testing.T) {
	rr := &RatingResult{Count: 0}
	result := GetRatingBadgeHTML(rr)
	if result != `<span style="color: #6b7280;">No ratings yet</span>` {
		t.Errorf("GetRatingBadgeHTML(count=0) = %q, want 'No ratings yet' span", result)
	}
}

// TestGetRatingBadgeHTMLWithRatings tests badge generation with ratings
func TestGetRatingBadgeHTMLWithRatings(t *testing.T) {
	rr := &RatingResult{
		Average: 7.5,
		Count:   10,
	}
	result := GetRatingBadgeHTML(rr)

	// Should contain the rating value
	if !ratingTestContains(result, "7.5/10") {
		t.Errorf("GetRatingBadgeHTML() should contain '7.5/10', got: %s", result)
	}
	// Should contain the count
	if !ratingTestContains(result, "10 ratings") {
		t.Errorf("GetRatingBadgeHTML() should contain '10 ratings', got: %s", result)
	}
	// Should contain a color
	if !ratingTestContains(result, "color:") {
		t.Errorf("GetRatingBadgeHTML() should contain color styling, got: %s", result)
	}
}

// ============================================================================
// parseUint64FromHex Tests
// ============================================================================

// TestParseUint64FromHex tests hex string to uint64 parsing
func TestParseUint64FromHex(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected uint64
	}{
		{"simple number hex", "313233", 123}, // "123" in hex
		{"zero hex", "30", 0},                // "0" in hex
		{"invalid hex", "xyz", 0},
		{"empty string", "", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseUint64FromHex(tt.input)
			if result != tt.expected {
				t.Errorf("parseUint64FromHex(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// RatingResult Struct Tests
// ============================================================================

// TestRatingResultFields tests RatingResult struct field access
func TestRatingResultFields(t *testing.T) {
	rr := RatingResult{
		SCID:     "abc123",
		Likes:    100,
		Dislikes: 10,
		Average:  7.5,
		Count:    50,
		Ratings: []Rating{
			{Address: "dero1...", Rating: 75, Height: 1000},
		},
	}

	if rr.SCID != "abc123" {
		t.Errorf("SCID = %q, want 'abc123'", rr.SCID)
	}
	if rr.Likes != 100 {
		t.Errorf("Likes = %d, want 100", rr.Likes)
	}
	if rr.Dislikes != 10 {
		t.Errorf("Dislikes = %d, want 10", rr.Dislikes)
	}
	if rr.Average != 7.5 {
		t.Errorf("Average = %f, want 7.5", rr.Average)
	}
	if rr.Count != 50 {
		t.Errorf("Count = %d, want 50", rr.Count)
	}
	if len(rr.Ratings) != 1 {
		t.Errorf("len(Ratings) = %d, want 1", len(rr.Ratings))
	}
}

// ============================================================================
// Rating Constants Tests
// ============================================================================

// TestRatingConstants tests that rating constants are correctly defined
func TestRatingConstants(t *testing.T) {
	// Verify category constants
	if RatingDoNotUse != 0 {
		t.Errorf("RatingDoNotUse = %d, want 0", RatingDoNotUse)
	}
	if RatingExceptional != 9 {
		t.Errorf("RatingExceptional = %d, want 9", RatingExceptional)
	}

	// Verify all categories are mapped
	for i := uint64(0); i <= 9; i++ {
		if _, ok := RatingCategories[i]; !ok {
			t.Errorf("RatingCategories missing key %d", i)
		}
	}

	// Verify detail maps have all keys
	for i := uint64(0); i <= 9; i++ {
		if _, ok := NegativeDetails[i]; !ok {
			t.Errorf("NegativeDetails missing key %d", i)
		}
		if _, ok := PositiveDetails[i]; !ok {
			t.Errorf("PositiveDetails missing key %d", i)
		}
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

func ratingTestContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ============================================================================
// Benchmarks
// ============================================================================

// BenchmarkParseRating benchmarks rating parsing
func BenchmarkParseRating(b *testing.B) {
	ratings := []uint64{0, 25, 50, 75, 99}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, r := range ratings {
			ParseRating(r)
		}
	}
}

// BenchmarkParseRatingString benchmarks rating string generation
func BenchmarkParseRatingString(b *testing.B) {
	ratings := []uint64{0, 25, 50, 75, 99}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, r := range ratings {
			ParseRatingString(r)
		}
	}
}

// BenchmarkGetRatingColor benchmarks color lookup
func BenchmarkGetRatingColor(b *testing.B) {
	categories := []uint64{0, 2, 4, 6, 8}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, c := range categories {
			GetRatingColor(c)
		}
	}
}

// BenchmarkCalculateAverageRating benchmarks average calculation
func BenchmarkCalculateAverageRating(b *testing.B) {
	ratings := []Rating{
		{Rating: 60}, {Rating: 70}, {Rating: 75},
		{Rating: 80}, {Rating: 85}, {Rating: 90},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CalculateAverageRating(ratings)
	}
}

// BenchmarkShouldBlockContent benchmarks content blocking logic
func BenchmarkShouldBlockContent(b *testing.B) {
	settings := map[string]interface{}{
		"min_rating":    60,
		"block_malware": true,
	}
	ratings := []float64{1.0, 5.0, 6.0, 7.0, 9.0}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, r := range ratings {
			ShouldBlockContent(r, settings)
		}
	}
}
