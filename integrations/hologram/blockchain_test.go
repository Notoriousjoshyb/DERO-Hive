// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for blockchain.go (TELA content assembly)

package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
)

// ============== Helper Function Tests ==============

func TestDecodeHexString_Valid(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"Simple ASCII", "48656c6c6f", "Hello"},
		{"With spaces", "48656c6c6f20576f726c64", "Hello World"},
		{"Numbers", "313233", "123"},
		{"Empty", "", ""},
		{"Special chars", "3c68746d6c3e", "<html>"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := decodeHexString(tt.input)
			if result != tt.expected {
				t.Errorf("decodeHexString(%s) = %s, expected %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestDecodeHexString_Invalid(t *testing.T) {
	// Invalid hex should return original string
	tests := []string{
		"not-hex",
		"xyz123",
		"48656c6c6g", // Invalid hex char 'g'
		"123",        // Odd length
	}

	for _, input := range tests {
		t.Run(input, func(t *testing.T) {
			result := decodeHexString(input)
			if result != input {
				t.Errorf("decodeHexString(%s) = %s, expected original string on invalid hex", input, result)
			}
		})
	}
}

func TestHtmlEscape(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"No escaping needed", "hello world", "hello world"},
		{"Ampersand", "Tom & Jerry", "Tom &amp; Jerry"},
		{"Less than", "a < b", "a &lt; b"},
		{"Greater than", "a > b", "a &gt; b"},
		{"Quote", `say "hello"`, "say &quot;hello&quot;"},
		{"All special", `<script>"alert('&')"</script>`, "&lt;script&gt;&quot;alert('&amp;')&quot;&lt;/script&gt;"},
		{"Empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := htmlEscape(tt.input)
			if result != tt.expected {
				t.Errorf("htmlEscape(%s) = %s, expected %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsShardIndexDURL(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"app.tela.shards", true},
		{"myapp.TELA.SHARDS", true},
		{"test.tela.shards", true},
		{" myapp.tela.shards ", true}, // With whitespace
		{"app.tela", false},
		{"app.tela.lib", false},
		{"app.shards", false},
		{"", false},
		{".tela.shards", true}, // Just the extension (with dot)
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := isShardIndexDURL(tt.input)
			if result != tt.expected {
				t.Errorf("isShardIndexDURL(%s) = %v, expected %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsLibraryDURL(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"mylib.tela.lib", true},
		{"library.TELA.LIB", true},
		{"utils.tela.lib", true},
		{" mylib.tela.lib ", true}, // With whitespace
		{"app.tela", false},
		{"app.tela.shards", false},
		{"app.lib", false},
		{"", false},
		{".tela.lib", true}, // Just the extension (with dot)
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := isLibraryDURL(tt.input)
			if result != tt.expected {
				t.Errorf("isLibraryDURL(%s) = %v, expected %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestCurrentTimeStamp(t *testing.T) {
	result := currentTimeStamp()

	// Should be in HH:MM:SS format
	if len(result) != 8 {
		t.Errorf("currentTimeStamp() = %s, expected 8 characters (HH:MM:SS)", result)
	}

	// Should contain two colons
	if strings.Count(result, ":") != 2 {
		t.Errorf("currentTimeStamp() = %s, expected two colons", result)
	}
}

// ============== File Content Extraction Tests ==============

func TestExtractFileContentFromCode_Valid(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		expected string
	}{
		{
			"Simple content",
			`Function init() { } /* Hello World */`,
			"Hello World",
		},
		{
			"HTML content",
			`Function init() { } /* <html><body>Test</body></html> */`,
			"<html><body>Test</body></html>",
		},
		{
			"Multiline content",
			`Function init() { }
/* 
Line 1
Line 2
Line 3
*/`,
			"Line 1\nLine 2\nLine 3",
		},
		{
			"With leading/trailing whitespace",
			`/* 
   content with spaces   
*/`,
			"content with spaces",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFileContentFromCode(tt.code)
			if result != tt.expected {
				t.Errorf("extractFileContentFromCode() = %q, expected %q", result, tt.expected)
			}
		})
	}
}

func TestExtractFileContentFromCode_NoComment(t *testing.T) {
	tests := []string{
		"Function init() { }",
		"No comment block here",
		"",
		"/* unclosed comment",
	}

	for _, code := range tests {
		t.Run(code[:min(20, len(code))], func(t *testing.T) {
			result := extractFileContentFromCode(code)
			if result != "" {
				t.Errorf("extractFileContentFromCode(%s) = %s, expected empty string", code, result)
			}
		})
	}
}

func TestExtractFileContentFromCode_MultipleComments(t *testing.T) {
	// Should extract the first comment block
	code := `/* First */ Function() {} /* Second */`
	result := extractFileContentFromCode(code)
	if result != "First" {
		t.Errorf("extractFileContentFromCode() = %s, expected 'First'", result)
	}
}

// ============== DOC SCID Extraction Tests ==============

func TestExtractDOCsSCIDs_FromCode(t *testing.T) {
	// Test extraction from CODE (primary method - matches tela.Clone behavior)
	scid1 := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	scid2 := "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

	// Create INDEX code with STORE statements
	code := fmt.Sprintf(`Function InitializePrivate() Uint64
30 STORE("DOC1", "%s")
40 STORE("DOC2", "%s")
1000 RETURN 0
End Function`, scid1, scid2)

	indexData := map[string]interface{}{
		"code": code,
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 2 {
		t.Errorf("Expected 2 SCIDs from code, got %d", len(scids))
	}

	if len(scids) > 0 && scids[0] != scid1 {
		t.Errorf("First SCID = %s, expected %s", scids[0], scid1)
	}
	if len(scids) > 1 && scids[1] != scid2 {
		t.Errorf("Second SCID = %s, expected %s", scids[1], scid2)
	}
}

func TestExtractDOCsSCIDs_CodePreferredOverStringkeys(t *testing.T) {
	// When INDEX is updated, CODE has new SCIDs but stringkeys has old ones
	// We should prefer CODE (this is what tela.Clone does)
	newSCID := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	oldSCID := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	// Hex encode the old SCID (as daemon stores in stringkeys)
	oldSCIDHex := ""
	for _, c := range oldSCID {
		oldSCIDHex += fmt.Sprintf("%02x", c)
	}

	code := fmt.Sprintf(`STORE("DOC1", "%s")`, newSCID)

	indexData := map[string]interface{}{
		"code": code,
		"stringkeys": map[string]interface{}{
			"DOC1": oldSCIDHex, // Old SCID in stringkeys
		},
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 1 {
		t.Errorf("Expected 1 SCID, got %d", len(scids))
	}

	// Should get the NEW SCID from code, not old one from stringkeys
	if len(scids) > 0 && scids[0] != newSCID {
		t.Errorf("SCID = %s, expected %s (from code, not stringkeys)", scids[0], newSCID)
	}
}

func TestExtractDOCsSCIDs_FallbackToStringkeys(t *testing.T) {
	// If code has no STORE("DOCx") patterns, fall back to stringkeys
	scid1 := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	// Hex encode the SCID (as daemon stores it)
	scid1Hex := ""
	for _, c := range scid1 {
		scid1Hex += fmt.Sprintf("%02x", c)
	}

	indexData := map[string]interface{}{
		"code": "Function SomeOtherFunction() Uint64\n10 RETURN 0\nEnd Function", // No DOC stores
		"stringkeys": map[string]interface{}{
			"DOC1": scid1Hex,
		},
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 1 {
		t.Errorf("Expected 1 SCID from stringkeys fallback, got %d", len(scids))
	}

	if len(scids) > 0 && scids[0] != scid1 {
		t.Errorf("First SCID = %s, expected %s", scids[0], scid1)
	}
}

func TestExtractDOCsSCIDs_NoCodeNoStringkeys(t *testing.T) {
	indexData := map[string]interface{}{
		"balance": 0,
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 0 {
		t.Errorf("Expected 0 SCIDs without code or stringkeys, got %d", len(scids))
	}
}

func TestExtractDOCsSCIDs_EmptyCode(t *testing.T) {
	indexData := map[string]interface{}{
		"code":       "",
		"stringkeys": map[string]interface{}{},
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 0 {
		t.Errorf("Expected 0 SCIDs with empty code and stringkeys, got %d", len(scids))
	}
}

func TestExtractDOCsSCIDs_StringkeysFallbackStopsAtGap(t *testing.T) {
	// When falling back to stringkeys, should stop when DOC<n> is missing
	scid := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	scidHex := ""
	for _, c := range scid {
		scidHex += fmt.Sprintf("%02x", c)
	}

	indexData := map[string]interface{}{
		"code": "", // Empty code forces fallback
		"stringkeys": map[string]interface{}{
			"DOC1": scidHex,
			// DOC2 missing
			"DOC3": scidHex, // Should not be reached
		},
	}

	scids := extractDOCsSCIDs(indexData)

	if len(scids) != 1 {
		t.Errorf("Expected 1 SCID (stops at DOC2 gap), got %d", len(scids))
	}
}

// ============== Gzip Decompression Tests ==============

func TestDecompressGzip_Valid(t *testing.T) {
	// Create valid gzip content
	original := "Hello, this is compressed content!"
	
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte(original))
	gz.Close()
	
	compressed := base64.StdEncoding.EncodeToString(buf.Bytes())

	result, err := decompressGzip(compressed)
	if err != nil {
		t.Fatalf("decompressGzip failed: %v", err)
	}

	if result != original {
		t.Errorf("decompressGzip() = %s, expected %s", result, original)
	}
}

func TestDecompressGzip_InvalidBase64(t *testing.T) {
	_, err := decompressGzip("not-valid-base64!!!")
	if err == nil {
		t.Error("Expected error for invalid base64")
	}
}

func TestDecompressGzip_InvalidGzip(t *testing.T) {
	// Valid base64 but not gzip data
	notGzip := base64.StdEncoding.EncodeToString([]byte("not gzip data"))
	
	_, err := decompressGzip(notGzip)
	if err == nil {
		t.Error("Expected error for invalid gzip data")
	}
}

// ============== TELAContent Struct Tests ==============

func TestTELAContent_EmptyInit(t *testing.T) {
	content := &TELAContent{
		CSS:       make([]string, 0),
		JS:        make([]string, 0),
		Meta:      make(map[string]interface{}),
		SCIDs:     make(map[string]string),
		Files:     make([]DocFile, 0),
		CSSByName: make(map[string]string),
		JSByName:  make(map[string]string),
	}

	if content.HTML != "" {
		t.Error("HTML should be empty initially")
	}
	if len(content.CSS) != 0 {
		t.Error("CSS should be empty initially")
	}
	if len(content.JS) != 0 {
		t.Error("JS should be empty initially")
	}
	if len(content.Files) != 0 {
		t.Error("Files should be empty initially")
	}
}

// ============== Shard/Library Assembly Tests ==============

func TestAssembleShardFiles_Empty(t *testing.T) {
	result := assembleShardFiles(nil)
	if result != "" {
		t.Error("assembleShardFiles(nil) should return empty string")
	}

	content := &TELAContent{Files: make([]DocFile, 0)}
	result = assembleShardFiles(content)
	if result != "" {
		t.Error("assembleShardFiles with no files should return empty string")
	}
}

func TestAssembleShardFiles_WithFiles(t *testing.T) {
	content := &TELAContent{
		Files: []DocFile{
			{Name: "part1.html", Content: "<h1>Part 1</h1>", DocType: "TELA-HTML-1"},
			{Name: "part2.html", Content: "<h2>Part 2</h2>", DocType: "TELA-HTML-1"},
		},
		CSS: []string{},
		JS:  []string{},
	}

	result := assembleShardFiles(content)

	if !strings.Contains(result, "<h1>Part 1</h1>") {
		t.Error("Result should contain Part 1 content")
	}
	if !strings.Contains(result, "<h2>Part 2</h2>") {
		t.Error("Result should contain Part 2 content")
	}
	if !strings.Contains(result, "<html>") {
		t.Error("Result should have html wrapper")
	}
	if !strings.Contains(result, "</html>") {
		t.Error("Result should have closing html tag")
	}
}

func TestAssembleShardFiles_InjectsCSS(t *testing.T) {
	content := &TELAContent{
		Files: []DocFile{
			{Name: "index.html", Content: "<div>Test</div>", DocType: "TELA-HTML-1"},
		},
		CSS: []string{"body { color: red; }"},
		JS:  []string{},
	}

	result := assembleShardFiles(content)

	if !strings.Contains(result, "<style>") {
		t.Error("Result should contain style tag")
	}
	if !strings.Contains(result, "body { color: red; }") {
		t.Error("Result should contain CSS content")
	}
}

func TestAssembleShardFiles_InjectsJS(t *testing.T) {
	content := &TELAContent{
		Files: []DocFile{
			{Name: "index.html", Content: "<div>Test</div>", DocType: "TELA-HTML-1"},
		},
		CSS: []string{},
		JS:  []string{"console.log('hello');"},
	}

	result := assembleShardFiles(content)

	if !strings.Contains(result, "<script>") {
		t.Error("Result should contain script tag")
	}
	if !strings.Contains(result, "console.log('hello');") {
		t.Error("Result should contain JS content")
	}
}

func TestRenderLibraryInfo(t *testing.T) {
	content := &TELAContent{
		Meta: map[string]interface{}{
			"name":        "My Library",
			"durl":        "mylib.tela.lib",
			"description": "A test library",
		},
		Files: []DocFile{
			{Name: "utils.js", DocType: "TELA-JS-1"},
			{Name: "styles.css", DocType: "TELA-CSS-1"},
		},
		SCIDs: map[string]string{
			"utils.js":   "abc123...",
			"styles.css": "def456...",
		},
	}

	result := renderLibraryInfo(content)

	if !strings.Contains(result, "My Library") {
		t.Error("Result should contain library name")
	}
	if !strings.Contains(result, "mylib.tela.lib") {
		t.Error("Result should contain dURL")
	}
	if !strings.Contains(result, "utils.js") {
		t.Error("Result should contain file name")
	}
	if !strings.Contains(result, "<table>") {
		t.Error("Result should contain table")
	}
	if !strings.Contains(result, "TELA-JS-1") {
		t.Error("Result should contain doc type")
	}
}

// ============== Console Logging Tests ==============

func TestConsoleLog_Structure(t *testing.T) {
	log := ConsoleLog{
		Timestamp: "12:34:56",
		Level:     "info",
		Message:   "Test message",
	}

	if log.Timestamp != "12:34:56" {
		t.Errorf("Timestamp = %s, expected 12:34:56", log.Timestamp)
	}
	if log.Level != "info" {
		t.Errorf("Level = %s, expected info", log.Level)
	}
	if log.Message != "Test message" {
		t.Errorf("Message = %s, expected 'Test message'", log.Message)
	}
}

// ============== DocFile Tests ==============

func TestDocFile_Structure(t *testing.T) {
	doc := DocFile{
		Name:    "app.js",
		Content: "console.log('hello');",
		DocType: "TELA-JS-1",
	}

	if doc.Name != "app.js" {
		t.Errorf("Name = %s, expected app.js", doc.Name)
	}
	if doc.Content != "console.log('hello');" {
		t.Errorf("Content mismatch")
	}
	if doc.DocType != "TELA-JS-1" {
		t.Errorf("DocType = %s, expected TELA-JS-1", doc.DocType)
	}
}

// ============== Benchmark Tests ==============

func BenchmarkDecodeHexString(b *testing.B) {
	hexStr := "48656c6c6f20576f726c6421" // "Hello World!"
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		decodeHexString(hexStr)
	}
}

func BenchmarkHtmlEscape(b *testing.B) {
	input := `<script>alert("xss & danger")</script>`
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		htmlEscape(input)
	}
}

func BenchmarkExtractFileContentFromCode(b *testing.B) {
	code := `
Function init() Uint64
10 RETURN 0
End Function
/* 
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Hello World</h1></body>
</html>
*/
`
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		extractFileContentFromCode(code)
	}
}

func BenchmarkIsShardIndexDURL(b *testing.B) {
	urls := []string{"app.tela.shards", "myapp.tela", "lib.tela.lib", "test.tela.shards"}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isShardIndexDURL(urls[i%len(urls)])
	}
}

func BenchmarkAssembleShardFiles(b *testing.B) {
	content := &TELAContent{
		Files: []DocFile{
			{Name: "p1.html", Content: "<div>Part 1</div>", DocType: "TELA-HTML-1"},
			{Name: "p2.html", Content: "<div>Part 2</div>", DocType: "TELA-HTML-1"},
			{Name: "p3.html", Content: "<div>Part 3</div>", DocType: "TELA-HTML-1"},
		},
		CSS: []string{"body { margin: 0; }", ".container { padding: 20px; }"},
		JS:  []string{"console.log('init');", "function setup() {}"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		assembleShardFiles(content)
	}
}

func BenchmarkDecompressGzip(b *testing.B) {
	// Create compressed content once
	original := strings.Repeat("Hello World! This is test content. ", 100)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte(original))
	gz.Close()
	compressed := base64.StdEncoding.EncodeToString(buf.Bytes())

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		decompressGzip(compressed)
	}
}

// Note: min() is already defined in node_manager.go
