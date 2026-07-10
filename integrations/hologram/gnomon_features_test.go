package main

import (
	"testing"
)

// TestTagStoreInitialization tests the tag store singleton
func TestTagStoreInitialization(t *testing.T) {
	store := InitSCIDTagStore()
	if store == nil {
		t.Fatal("Tag store should not be nil")
	}

	// Verify default filters are loaded
	filters := store.GetTagFilters()
	if len(filters) == 0 {
		t.Error("Default filters should be loaded")
	}

	t.Logf("Tag store initialized with %d filters", len(filters))

	// Check default filter names
	expectedFilters := []string{"g45", "nfa", "tela", "epoch"}
	for _, expected := range expectedFilters {
		found := false
		for _, f := range filters {
			if f.Name == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected filter '%s' not found", expected)
		}
	}
}

// TestTagStoreClassification tests SCID classification
func TestTagStoreClassification(t *testing.T) {
	store := InitSCIDTagStore()

	// Test TELA-DOC classification
	testCases := []struct {
		name          string
		code          string
		expectedClass string
		expectedTags  []string
	}{
		{
			name:          "TELA DOC",
			code:          `Function init() docVersion = 1`,
			expectedClass: "TELA-DOC-1",
			expectedTags:  []string{"all", "tela"},
		},
		{
			name:          "TELA INDEX",
			code:          `Function init() telaVersion = 1`,
			expectedClass: "TELA-INDEX-1",
			expectedTags:  []string{"all", "tela"},
		},
		{
			name:          "G45 NFT",
			code:          `// G45-NFT Standard`,
			expectedClass: "G45-NFT",
			expectedTags:  []string{"all", "g45"},
		},
		{
			name:          "NFA",
			code:          `// ART-NFA-MS1`,
			expectedClass: "NFA",
			expectedTags:  []string{"all", "nfa"},
		},
		{
			name:          "Generic SC",
			code:          `Function init() STORE("owner", address())`,
			expectedClass: "SC",
			expectedTags:  []string{"all"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			scid := "test_" + tc.name
			meta := store.ClassifyContract(scid, tc.code, nil, "dero1owner", 12345)

			if meta.Class != tc.expectedClass {
				t.Errorf("Expected class '%s', got '%s'", tc.expectedClass, meta.Class)
			}

			// Check tags
			for _, expectedTag := range tc.expectedTags {
				found := false
				for _, tag := range meta.Tags {
					if tag == expectedTag {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected tag '%s' not found in %v", expectedTag, meta.Tags)
				}
			}
		})
	}
}

// TestTagStoreQueries tests tag-based queries
func TestTagStoreQueries(t *testing.T) {
	store := InitSCIDTagStore()

	// Classify some test SCIDs
	store.ClassifyContract("scid_tela_1", "docVersion", nil, "owner1", 100)
	store.ClassifyContract("scid_tela_2", "telaVersion", nil, "owner2", 200)
	store.ClassifyContract("scid_g45", "G45-NFT", nil, "owner3", 300)

	// Query by tag
	telaSCIDs := store.GetSCIDsByTag("tela")
	if len(telaSCIDs) < 2 {
		t.Errorf("Expected at least 2 TELA SCIDs, got %d", len(telaSCIDs))
	}

	// Query by class
	docSCIDs := store.GetSCIDsByClass("TELA-DOC-1")
	if len(docSCIDs) < 1 {
		t.Errorf("Expected at least 1 TELA-DOC-1 SCID, got %d", len(docSCIDs))
	}

	// Get all tags
	allTags := store.GetAllTags()
	if len(allTags) == 0 {
		t.Error("Expected at least one tag")
	}
	t.Logf("All tags: %v", allTags)

	// Get all classes
	allClasses := store.GetAllClasses()
	if len(allClasses) == 0 {
		t.Error("Expected at least one class")
	}
	t.Logf("All classes: %v", allClasses)
}

// TestWSServerTypes tests WebSocket request/response types
func TestWSServerTypes(t *testing.T) {
	// Test request parsing
	req := GnomonWSRequest{
		ID:     1,
		Method: "GetSCIDsByTag",
		Params: map[string]any{
			"tag": "tela",
		},
	}

	if req.Method != "GetSCIDsByTag" {
		t.Errorf("Expected method 'GetSCIDsByTag', got '%s'", req.Method)
	}

	// Test success response
	resp := GnomonWSResponse{
		ID:     1,
		Result: []string{"scid1", "scid2"},
	}

	if resp.Error != nil {
		t.Error("Success response should not have error")
	}

	// Test error response
	errResp := GnomonWSResponse{
		ID: 2,
		Error: &WSError{
			Code:    -32601,
			Message: "Method not found",
		},
	}

	if errResp.Error == nil {
		t.Error("Error response should have error")
	}
	if errResp.Error.Code != -32601 {
		t.Errorf("Expected error code -32601, got %d", errResp.Error.Code)
	}
}

// TestWSServerCreation tests WebSocket server creation
func TestWSServerCreation(t *testing.T) {
	// Create a mock app (nil is fine for this test)
	server := NewGnomonWSServer(nil, "")

	if server == nil {
		t.Fatal("Server should not be nil")
	}

	// Check default address
	if server.GetAddress() == "" {
		t.Error("Server should have default address")
	}

	// Server should not be running yet
	if server.IsRunning() {
		t.Error("Server should not be running before Start()")
	}

	t.Logf("Server default address: %s", server.GetAddress())
}

// TestTagStoreStats tests statistics
func TestTagStoreStats(t *testing.T) {
	store := InitSCIDTagStore()

	stats := store.GetStats()

	if _, ok := stats["total_scids"]; !ok {
		t.Error("Stats should include 'total_scids'")
	}
	if _, ok := stats["class_counts"]; !ok {
		t.Error("Stats should include 'class_counts'")
	}
	if _, ok := stats["tag_counts"]; !ok {
		t.Error("Stats should include 'tag_counts'")
	}

	t.Logf("Tag store stats: %v", stats)
}
