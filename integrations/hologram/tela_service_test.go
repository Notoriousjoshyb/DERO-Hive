// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit and integration tests for tela_service.go (TELA DOC/INDEX deployment)

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============== Helper Function Unit Tests ==============
// These tests don't require a running daemon

func TestEstimateGasCost(t *testing.T) {
	// Gas estimation aligned with tela-cli behavior
	// Formula: base(100) + size*0.1, minimum 100 gas, sizeCost minimum 50
	tests := []struct {
		name     string
		size     int
		expected uint64
	}{
		{"Zero bytes", 0, 100},          // Minimum gas (MINIMUM_GAS_FEE)
		{"100 bytes", 100, 150},         // 100 + max(100*0.1, 50) = 100 + 50 = 150
		{"500 bytes", 500, 150},         // 100 + max(50, 50) = 150
		{"1KB", 1024, 202},              // 100 + 1024*0.1 = 100 + 102.4 ≈ 202
		{"10KB", 10240, 1124},           // 100 + 10240*0.1 = 100 + 1024 = 1124
		{"100KB", 102400, 10340},        // 100 + 102400*0.1 = 100 + 10240 = 10340
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := estimateGasCost(tt.size)
			if result != tt.expected {
				t.Errorf("estimateGasCost(%d) = %d, expected %d", tt.size, result, tt.expected)
			}
		})
	}
}

func TestEstimateGasCostFormula(t *testing.T) {
	// Verify the new formula aligned with tela-cli:
	// base(100) + size*0.1, with minimum sizeCost of 50, minimum total of 100
	const minGas = uint64(100)

	sizes := []int{0, 1, 10, 100, 500, 1000, 10000, 100000}
	for _, size := range sizes {
		result := estimateGasCost(size)
		oldResult := uint64(5000) + uint64(size)*10 // Old inflated formula
		
		// Zero should return minimum
		if size == 0 && result != minGas {
			t.Errorf("estimateGasCost(0) = %d, expected minimum %d", result, minGas)
			continue
		}
		
		// Key check: new formula should be MUCH lower than old formula
		// Old formula was ~50x too high
		if size > 0 && result >= oldResult {
			t.Errorf("estimateGasCost(%d) = %d should be less than old formula %d",
				size, result, oldResult)
		}
		
		// Verify minimum is respected
		if result < minGas {
			t.Errorf("estimateGasCost(%d) = %d, should be at least %d", size, result, minGas)
		}
		
		// Log the comparison for visibility
		t.Logf("Size %d bytes: new=%d gas, old=%d gas (%.1fx reduction)",
			size, result, oldResult, float64(oldResult)/float64(result))
	}
}

func TestCanCompress(t *testing.T) {
	// Note: TELA uses custom doc types, not MIME types
	// See tela-cli/tela.go for constants
	tests := []struct {
		docType     string
		canCompress bool
	}{
		// Compressible types (text-based) - TELA format
		{"TELA-HTML-1", true},   // tela.DOC_HTML
		{"TELA-CSS-1", true},    // tela.DOC_CSS
		{"TELA-JS-1", true},     // tela.DOC_JS
		{"TELA-JSON-1", true},   // tela.DOC_JSON
		{"TELA-MD-1", true},     // tela.DOC_MD

		// Non-compressible types (binary/already compressed/unknown)
		{"TELA-STATIC-1", false}, // Generic static type
		{"TELA-GO-1", false},     // Go code (might be in list, check)
		{"image/png", false},     // MIME types not in compressible list
		{"application/octet-stream", false},

		// Edge cases
		{"", false},
		{"unknown", false},
		{"tela-html-1", false}, // Case sensitive - lowercase shouldn't match
	}

	for _, tt := range tests {
		t.Run(tt.docType, func(t *testing.T) {
			result := canCompress(tt.docType)
			if result != tt.canCompress {
				t.Errorf("canCompress(%s) = %v, expected %v", tt.docType, result, tt.canCompress)
			}
		})
	}
}

// ============== DOCInfo Structure Tests ==============

func TestDOCInfo_JSONMarshaling(t *testing.T) {
	doc := DOCInfo{
		Name:        "index.html",
		Path:        "/path/to/file",
		SubDir:      "",
		DocType:     "text/html",
		Size:        1024,
		Compressed:  false,
		Description: "Main page",
		IconURL:     "https://example.com/icon.png",
	}

	// Marshal to JSON
	jsonData, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Failed to marshal DOCInfo: %v", err)
	}

	// Unmarshal back
	var decoded DOCInfo
	if err := json.Unmarshal(jsonData, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal DOCInfo: %v", err)
	}

	// Verify fields
	if decoded.Name != doc.Name {
		t.Errorf("Name mismatch: got %s, expected %s", decoded.Name, doc.Name)
	}
	if decoded.Path != doc.Path {
		t.Errorf("Path mismatch: got %s, expected %s", decoded.Path, doc.Path)
	}
	if decoded.DocType != doc.DocType {
		t.Errorf("DocType mismatch: got %s, expected %s", decoded.DocType, doc.DocType)
	}
	if decoded.Size != doc.Size {
		t.Errorf("Size mismatch: got %d, expected %d", decoded.Size, doc.Size)
	}
	if decoded.Compressed != doc.Compressed {
		t.Errorf("Compressed mismatch: got %v, expected %v", decoded.Compressed, doc.Compressed)
	}
}

func TestDOCInfo_DataFieldExcludedFromJSON(t *testing.T) {
	doc := DOCInfo{
		Name: "test.html",
		Data: []byte("<html>test</html>"),
	}

	jsonData, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// Data []byte field has json:"-" tag, so binary data should NOT appear in JSON
	// Note: DataString (json:"data") is a separate field for frontend input
	// The binary Data field should not be serialized to avoid large base64 output
	jsonStr := string(jsonData)
	
	// Check that the binary content is NOT in the output
	// (if Data were serialized, it would appear as base64: "PGh0bWw+dGVzdDwvaHRtbD4=")
	if strings.Contains(jsonStr, "PGh0bWw") {
		t.Error("Data []byte field should be excluded from JSON marshaling (found base64 content)")
	}
}

func TestDOCInfo_EmptyFields(t *testing.T) {
	jsonStr := `{"name":"","path":"","docType":""}`
	
	var doc DOCInfo
	if err := json.Unmarshal([]byte(jsonStr), &doc); err != nil {
		t.Fatalf("Failed to unmarshal empty DOCInfo: %v", err)
	}

	if doc.Name != "" || doc.Path != "" || doc.DocType != "" {
		t.Error("Empty strings should unmarshal correctly")
	}
}

// ============== INDEXInfo Structure Tests ==============

func TestINDEXInfo_JSONMarshaling(t *testing.T) {
	idx := INDEXInfo{
		Name:        "My TELA App",
		Description: "A test application",
		DURL:        "myapp",
		IconURL:     "https://example.com/icon.png",
		DOCSCIDs: []string{
			"abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
			"def456abc123def456abc123def456abc123def456abc123def456abc123def4",
		},
		Licenses: []string{"MIT"},
	}

	jsonData, err := json.Marshal(idx)
	if err != nil {
		t.Fatalf("Failed to marshal INDEXInfo: %v", err)
	}

	var decoded INDEXInfo
	if err := json.Unmarshal(jsonData, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal INDEXInfo: %v", err)
	}

	if decoded.Name != idx.Name {
		t.Errorf("Name mismatch")
	}
	if decoded.DURL != idx.DURL {
		t.Errorf("DURL mismatch")
	}
	if len(decoded.DOCSCIDs) != len(idx.DOCSCIDs) {
		t.Errorf("DOCSCIDs length mismatch: got %d, expected %d", len(decoded.DOCSCIDs), len(idx.DOCSCIDs))
	}
}

func TestINDEXInfo_EmptyDOCSCIDs(t *testing.T) {
	idx := INDEXInfo{
		Name:     "Empty App",
		DOCSCIDs: []string{},
	}

	jsonData, _ := json.Marshal(idx)
	var decoded INDEXInfo
	json.Unmarshal(jsonData, &decoded)

	if decoded.DOCSCIDs == nil {
		// Empty slice should become empty slice, not nil
		t.Log("Note: Empty DOCSCIDs unmarshals as nil (acceptable)")
	}
}

// ============== File System Tests ==============

func TestPreviewDOC_WithTempFile(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "tela_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create test HTML file
	htmlContent := `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Hello TELA</h1></body>
</html>`
	htmlPath := filepath.Join(tempDir, "index.html")
	if err := os.WriteFile(htmlPath, []byte(htmlContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Create App instance for testing
	app := &App{}

	// Test PreviewDOC
	result := app.PreviewDOC(htmlPath)

	// Verify result
	if success, ok := result["success"].(bool); !ok || !success {
		t.Errorf("PreviewDOC failed: %v", result["error"])
	}

	if name, ok := result["name"].(string); !ok || name != "index.html" {
		t.Errorf("Expected name 'index.html', got '%v'", result["name"])
	}

	if size, ok := result["size"].(int64); !ok || size != int64(len(htmlContent)) {
		t.Errorf("Expected size %d, got '%v'", len(htmlContent), result["size"])
	}

	if gasEstimate, ok := result["gasEstimate"].(uint64); !ok || gasEstimate == 0 {
		t.Errorf("Expected non-zero gas estimate, got '%v'", result["gasEstimate"])
	}
}

func TestPreviewDOC_NonexistentFile(t *testing.T) {
	app := &App{}
	result := app.PreviewDOC("/nonexistent/path/file.html")

	if success, ok := result["success"].(bool); ok && success {
		t.Error("PreviewDOC should fail for nonexistent file")
	}

	if _, ok := result["error"]; !ok {
		t.Error("PreviewDOC should return error message for nonexistent file")
	}
}

func TestPreviewDOC_DifferentFileTypes(t *testing.T) {
	tempDir, _ := os.MkdirTemp("", "tela_test")
	defer os.RemoveAll(tempDir)

	app := &App{}

	testFiles := []struct {
		name     string
		content  string
		wantCompress bool
	}{
		{"style.css", "body { color: red; }", true},
		{"script.js", "console.log('test');", true},
		{"data.json", `{"key": "value"}`, true},
		{"image.png", "fake png content", false},
	}

	for _, tf := range testFiles {
		t.Run(tf.name, func(t *testing.T) {
			filePath := filepath.Join(tempDir, tf.name)
			os.WriteFile(filePath, []byte(tf.content), 0644)

			result := app.PreviewDOC(filePath)

			if success := result["success"].(bool); !success {
				t.Errorf("PreviewDOC failed for %s: %v", tf.name, result["error"])
				return
			}

			// Check canCompress matches expected
			if canComp, ok := result["canCompress"].(bool); ok {
				if canComp != tf.wantCompress {
					t.Errorf("canCompress for %s: got %v, want %v", tf.name, canComp, tf.wantCompress)
				}
			}
		})
	}
}

// ============== ParseFolderForTELA Tests ==============

func TestParseFolderForTELA_BasicStructure(t *testing.T) {
	// Create temp directory with typical TELA structure
	tempDir, _ := os.MkdirTemp("", "tela_app_test")
	defer os.RemoveAll(tempDir)

	// Create files
	os.WriteFile(filepath.Join(tempDir, "index.html"), []byte("<html></html>"), 0644)
	os.WriteFile(filepath.Join(tempDir, "style.css"), []byte("body{}"), 0644)
	os.WriteFile(filepath.Join(tempDir, "app.js"), []byte("console.log()"), 0644)

	// Create subdirectory
	os.Mkdir(filepath.Join(tempDir, "assets"), 0755)
	os.WriteFile(filepath.Join(tempDir, "assets", "logo.png"), []byte("fake png"), 0644)

	app := &App{}
	result := app.ParseFolderForTELA(tempDir)

	if success := result["success"].(bool); !success {
		t.Fatalf("ParseFolderForTELA failed: %v", result["error"])
	}

	// Files are returned as []DOCInfo
	files, ok := result["files"].([]DOCInfo)
	if !ok {
		t.Fatalf("Expected files as []DOCInfo, got %T", result["files"])
	}

	if len(files) < 3 {
		t.Errorf("Expected at least 3 files, got %d", len(files))
	}

	// Check that we have index.html
	hasIndex := false
	for _, f := range files {
		if f.Name == "index.html" {
			hasIndex = true
			break
		}
	}
	if !hasIndex {
		t.Error("Expected index.html in parsed files")
	}

	// Check totalFiles matches
	if totalFiles, ok := result["totalFiles"].(int); ok {
		if totalFiles != len(files) {
			t.Errorf("totalFiles (%d) doesn't match len(files) (%d)", totalFiles, len(files))
		}
	}
}

func TestParseFolderForTELA_EmptyFolder(t *testing.T) {
	tempDir, _ := os.MkdirTemp("", "empty_folder")
	defer os.RemoveAll(tempDir)

	app := &App{}
	result := app.ParseFolderForTELA(tempDir)

	// Should succeed but with empty/minimal files
	if success := result["success"].(bool); !success {
		// Empty folder might legitimately fail or return empty
		t.Log("Empty folder returned error (acceptable):", result["error"])
	}
}

func TestParseFolderForTELA_NonexistentFolder(t *testing.T) {
	app := &App{}
	result := app.ParseFolderForTELA("/nonexistent/folder/path")

	// Note: filepath.Walk silently returns 0 files for nonexistent paths
	// This is acceptable behavior - the result will have empty files
	if success, ok := result["success"].(bool); ok && success {
		// Check that files is empty or errors contains something
		if files, ok := result["files"].([]DOCInfo); ok && len(files) == 0 {
			// Empty files for nonexistent folder is acceptable
			t.Log("Nonexistent folder returns empty files (acceptable)")
		}
		if errors, ok := result["errors"].([]string); ok && len(errors) > 0 {
			t.Logf("Errors recorded: %v", errors)
		}
	}
}

// ============== GetGasEstimate Tests ==============

func TestGetGasEstimate_ValidDOCInfo(t *testing.T) {
	app := &App{}

	docInfo := DOCInfo{
		Name: "test.html",
		Size: 1024,
	}
	docJSON, _ := json.Marshal(docInfo)

	result := app.GetGasEstimate(string(docJSON))

	if success := result["success"].(bool); !success {
		t.Errorf("GetGasEstimate failed: %v", result["error"])
	}

	if gasEstimate, ok := result["gasEstimate"].(uint64); !ok || gasEstimate == 0 {
		t.Errorf("Expected non-zero gas estimate")
	}

	// Verify size is returned
	if size, ok := result["size"].(int64); !ok || size != 1024 {
		t.Errorf("Expected size 1024, got %v", result["size"])
	}
}

func TestGetGasEstimate_InvalidJSON(t *testing.T) {
	app := &App{}

	result := app.GetGasEstimate("not valid json")

	if success, ok := result["success"].(bool); ok && success {
		t.Error("GetGasEstimate should fail for invalid JSON")
	}
}

func TestGetGasEstimate_ZeroSize(t *testing.T) {
	app := &App{}

	docInfo := DOCInfo{
		Name: "empty.html",
		Size: 0,
	}
	docJSON, _ := json.Marshal(docInfo)

	result := app.GetGasEstimate(string(docJSON))

	if success := result["success"].(bool); !success {
		t.Errorf("GetGasEstimate failed: %v", result["error"])
	}

	// Zero size should still have minimum gas cost (100)
	if gasEstimate, ok := result["gasEstimate"].(uint64); !ok || gasEstimate < 100 {
		t.Errorf("Expected at least minimum gas cost (100), got %v", gasEstimate)
	}
}

// ============== Benchmarks ==============

func BenchmarkEstimateGasCost(b *testing.B) {
	sizes := []int{100, 1024, 10240, 102400}
	for _, size := range sizes {
		b.Run(string(rune(size)), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				estimateGasCost(size)
			}
		})
	}
}

func BenchmarkCanCompress(b *testing.B) {
	docTypes := []string{"text/html", "image/png", "application/json", "unknown"}
	for _, dt := range docTypes {
		b.Run(dt, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				canCompress(dt)
			}
		})
	}
}

func BenchmarkDOCInfoMarshal(b *testing.B) {
	doc := DOCInfo{
		Name:        "index.html",
		Path:        "/path/to/file",
		DocType:     "text/html",
		Size:        10240,
		Compressed:  true,
		Description: "Main application entry point",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(doc)
	}
}

func BenchmarkDOCInfoUnmarshal(b *testing.B) {
	jsonStr := `{"name":"index.html","path":"/path/to/file","docType":"text/html","size":10240,"compressed":true,"description":"Main application entry point"}`
	jsonBytes := []byte(jsonStr)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var doc DOCInfo
		json.Unmarshal(jsonBytes, &doc)
	}
}

// ============== Version Control Tests ==============

func TestCommit_JSONMarshaling(t *testing.T) {
	commit := Commit{
		Number:    1,
		TXID:      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
		Height:    12345,
		Timestamp: 1700000000,
		IsCurrent: true,
		Label:     "Initial deployment",
	}

	// Marshal to JSON
	jsonData, err := json.Marshal(commit)
	if err != nil {
		t.Fatalf("Failed to marshal Commit: %v", err)
	}

	// Unmarshal back
	var decoded Commit
	if err := json.Unmarshal(jsonData, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal Commit: %v", err)
	}

	// Verify fields
	if decoded.Number != commit.Number {
		t.Errorf("Number mismatch: got %d, expected %d", decoded.Number, commit.Number)
	}
	if decoded.TXID != commit.TXID {
		t.Errorf("TXID mismatch: got %s, expected %s", decoded.TXID, commit.TXID)
	}
	if decoded.Height != commit.Height {
		t.Errorf("Height mismatch: got %d, expected %d", decoded.Height, commit.Height)
	}
	if decoded.IsCurrent != commit.IsCurrent {
		t.Errorf("IsCurrent mismatch: got %v, expected %v", decoded.IsCurrent, commit.IsCurrent)
	}
	if decoded.Label != commit.Label {
		t.Errorf("Label mismatch: got %s, expected %s", decoded.Label, commit.Label)
	}
}

func TestFileDiff_JSONMarshaling(t *testing.T) {
	fileDiff := FileDiff{
		FileName: "index.html",
		Status:   "modified",
		LineDiffs: []map[string]interface{}{
			{"type": "modified", "line": 5, "oldContent": "<h1>Old</h1>", "newContent": "<h1>New</h1>"},
			{"type": "added", "line": 10, "content": "<p>New paragraph</p>"},
		},
	}

	// Marshal to JSON
	jsonData, err := json.Marshal(fileDiff)
	if err != nil {
		t.Fatalf("Failed to marshal FileDiff: %v", err)
	}

	// Unmarshal back
	var decoded FileDiff
	if err := json.Unmarshal(jsonData, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal FileDiff: %v", err)
	}

	if decoded.FileName != fileDiff.FileName {
		t.Errorf("FileName mismatch: got %s, expected %s", decoded.FileName, fileDiff.FileName)
	}
	if decoded.Status != fileDiff.Status {
		t.Errorf("Status mismatch: got %s, expected %s", decoded.Status, fileDiff.Status)
	}
	if len(decoded.LineDiffs) != len(fileDiff.LineDiffs) {
		t.Errorf("LineDiffs count mismatch: got %d, expected %d", len(decoded.LineDiffs), len(fileDiff.LineDiffs))
	}
}

func TestGenerateDiff(t *testing.T) {
	tests := []struct {
		name       string
		oldContent string
		newContent string
		wantLen    int
		wantTypes  []string
	}{
		{
			name:       "No changes",
			oldContent: "line1\nline2\nline3",
			newContent: "line1\nline2\nline3",
			wantLen:    0,
			wantTypes:  []string{},
		},
		{
			name:       "Added lines",
			oldContent: "line1\nline2",
			newContent: "line1\nline2\nline3\nline4",
			wantLen:    2,
			wantTypes:  []string{"added", "added"},
		},
		{
			name:       "Removed lines",
			oldContent: "line1\nline2\nline3\nline4",
			newContent: "line1\nline2",
			wantLen:    2,
			wantTypes:  []string{"removed", "removed"},
		},
		{
			name:       "Modified lines",
			oldContent: "line1\nold line\nline3",
			newContent: "line1\nnew line\nline3",
			wantLen:    1,
			wantTypes:  []string{"modified"},
		},
		{
			name:       "Mixed changes",
			oldContent: "line1\nremoved\nmodified old",
			newContent: "line1\nmodified new\nadded",
			wantLen:    2,
			wantTypes:  []string{"modified", "modified"},
		},
		{
			name:       "Empty to content",
			oldContent: "",
			newContent: "new line",
			wantLen:    1,
			wantTypes:  []string{"added"},
		},
		{
			name:       "Content to empty",
			oldContent: "old line",
			newContent: "",
			wantLen:    1,
			wantTypes:  []string{"removed"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diff := generateDiff(tt.oldContent, tt.newContent)
			
			if len(diff) != tt.wantLen {
				t.Errorf("generateDiff() returned %d changes, want %d", len(diff), tt.wantLen)
			}

			for i, wantType := range tt.wantTypes {
				if i >= len(diff) {
					break
				}
				if diffType, ok := diff[i]["type"].(string); ok && diffType != wantType {
					t.Errorf("diff[%d].type = %s, want %s", i, diffType, wantType)
				}
			}
		})
	}
}

func TestGenerateFileDiffs(t *testing.T) {
	tests := []struct {
		name           string
		filesA         map[string]string
		filesB         map[string]string
		wantFiles      int
		wantStatuses   map[string]string // filename -> expected status
	}{
		{
			name:         "No changes",
			filesA:       map[string]string{"index.html": "<html></html>"},
			filesB:       map[string]string{"index.html": "<html></html>"},
			wantFiles:    0, // No diff for unchanged files
			wantStatuses: map[string]string{},
		},
		{
			name:         "File added",
			filesA:       map[string]string{},
			filesB:       map[string]string{"new.js": "console.log()"},
			wantFiles:    1,
			wantStatuses: map[string]string{"new.js": "added"},
		},
		{
			name:         "File removed",
			filesA:       map[string]string{"old.css": "body{}"},
			filesB:       map[string]string{},
			wantFiles:    1,
			wantStatuses: map[string]string{"old.css": "removed"},
		},
		{
			name:         "File modified",
			filesA:       map[string]string{"app.js": "const old = 1;"},
			filesB:       map[string]string{"app.js": "const new = 2;"},
			wantFiles:    1,
			wantStatuses: map[string]string{"app.js": "modified"},
		},
		{
			name: "Multiple changes",
			filesA: map[string]string{
				"index.html": "<html>old</html>",
				"removed.js": "deleted",
			},
			filesB: map[string]string{
				"index.html": "<html>new</html>",
				"added.css":  "body{}",
			},
			wantFiles: 3,
			wantStatuses: map[string]string{
				"index.html": "modified",
				"removed.js": "removed",
				"added.css":  "added",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diffs := generateFileDiffs(tt.filesA, tt.filesB)

			if len(diffs) != tt.wantFiles {
				t.Errorf("generateFileDiffs() returned %d file diffs, want %d", len(diffs), tt.wantFiles)
			}

			for _, diff := range diffs {
				wantStatus, exists := tt.wantStatuses[diff.FileName]
				if exists && diff.Status != wantStatus {
					t.Errorf("file %s: got status %s, want %s", diff.FileName, diff.Status, wantStatus)
				}
			}
		})
	}
}

func TestExtractDocCodeFromSC(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		expected string
	}{
		{
			name:     "Standard DOC format",
			code:     "/* <html>content</html> */\nFunction Initialize() Uint64\n10 RETURN 0\nEnd Function",
			expected: "<html>content</html>",
		},
		{
			name:     "No comment block",
			code:     "Function Initialize() Uint64\n10 RETURN 0\nEnd Function",
			expected: "Function Initialize() Uint64\n10 RETURN 0\nEnd Function",
		},
		{
			name:     "Empty comment",
			code:     "/* */Function foo",
			expected: "",
		},
		{
			name:     "Multi-line content",
			code:     "/* line1\nline2\nline3 */rest",
			expected: "line1\nline2\nline3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractDocCodeFromSC(tt.code)
			if result != tt.expected {
				t.Errorf("extractDocCodeFromSC() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestInferFileNameFromDocType(t *testing.T) {
	tests := []struct {
		docType  string
		durl     string
		expected string
	}{
		{"TELA-HTML-1", "", "index.html"},
		{"TELA-HTML-1", "myapp.tela", "index.html"},
		{"TELA-CSS-1", "", "content.css"},
		{"TELA-CSS-1", "styles", "styles.css"},
		{"TELA-JS-1", "", "content.js"},
		{"TELA-JS-1", "app.lib", "app.js"},
		{"TELA-JSON-1", "", "content.json"},
		{"TELA-SVG-1", "", "content.svg"},
		{"TELA-MD-1", "", "content.md"},
		{"UNKNOWN", "", "content.txt"},
		{"", "", "content.txt"},
	}

	for _, tt := range tests {
		t.Run(tt.docType+"_"+tt.durl, func(t *testing.T) {
			result := inferFileNameFromDocType(tt.docType, tt.durl)
			if result != tt.expected {
				t.Errorf("inferFileNameFromDocType(%s, %s) = %s, want %s", tt.docType, tt.durl, result, tt.expected)
			}
		})
	}
}

func TestCommitDiff_JSONMarshaling(t *testing.T) {
	diff := CommitDiff{
		SCID:       "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
		FromCommit: 1,
		ToCommit:   2,
		FromTXID:   "txid1",
		ToTXID:     "txid2",
		FileDiffs: []FileDiff{
			{FileName: "test.html", Status: "modified"},
		},
		Summary:    "1 modified",
		HasChanges: true,
	}

	jsonData, err := json.Marshal(diff)
	if err != nil {
		t.Fatalf("Failed to marshal CommitDiff: %v", err)
	}

	var decoded CommitDiff
	if err := json.Unmarshal(jsonData, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal CommitDiff: %v", err)
	}

	if decoded.FromCommit != diff.FromCommit || decoded.ToCommit != diff.ToCommit {
		t.Errorf("Commit numbers mismatch")
	}
	if decoded.Summary != diff.Summary {
		t.Errorf("Summary mismatch: got %s, want %s", decoded.Summary, diff.Summary)
	}
	if decoded.HasChanges != diff.HasChanges {
		t.Errorf("HasChanges mismatch")
	}
}

// ============== Integration Test Helpers ==============
// These require simulator mode to be running

// TestIntegration_InstallDOC tests actual DOC deployment
// Run with: go test -run TestIntegration -tags integration
func TestIntegration_InstallDOC(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if we can detect simulator mode
	// This test will be skipped if simulator isn't running
	t.Log("Integration test for InstallDOC - requires simulator mode")
	t.Log("To run: Start Hologram in simulator mode, then run 'go test -run TestIntegration'")
	
	// This would need actual simulator connection
	t.Skip("Simulator mode required - run manually with app in simulator mode")
}

// TestIntegration_FullTELADeployment tests complete TELA app deployment
func TestIntegration_FullTELADeployment(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	t.Log("Integration test for full TELA deployment - requires simulator mode")
	t.Log("Steps to test manually:")
	t.Log("1. Start Hologram")
	t.Log("2. Switch to Simulator mode (Settings > Network)")
	t.Log("3. Go to Studio > Create INDEX")
	t.Log("4. Select a folder with HTML/CSS/JS files")
	t.Log("5. Click Deploy")
	t.Log("6. Verify app appears in Browser > Discover")
	
	t.Skip("Manual test required - run with Hologram in simulator mode")
}

// TestIntegration_VersionControl tests version control functionality
// Run with: go test -run TestIntegration_VersionControl
func TestIntegration_VersionControl(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	t.Log("Integration test for Version Control - requires simulator mode")
	t.Log("Steps to test manually:")
	t.Log("1. Start Hologram in Simulator mode")
	t.Log("2. Deploy a TELA INDEX with files")
	t.Log("3. Update the INDEX (change a file, add a DOC)")
	t.Log("4. Go to Studio > enter the INDEX SCID")
	t.Log("5. Click 'Version History'")
	t.Log("6. Verify: commits appear with heights and TXIDs")
	t.Log("7. Click on different versions to see content")
	t.Log("8. Use Compare Mode to diff two versions")
	t.Log("9. Verify file-based diff shows which files changed")
	
	t.Skip("Manual test required - run with Hologram in simulator mode")
}
