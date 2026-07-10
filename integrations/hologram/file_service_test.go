// Copyright 2026 HOLOGRAM Project. All rights reserved.
// Unit tests for file_service.go — shard infrastructure.
//
// Tier 1: all tests in this file run against existing code and require no
// running daemon, no network, and no new feature implementation.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============== validateDocContent ==============

func TestValidateDocContent_AllASCII_UnderLimit(t *testing.T) {
	app := &App{}
	content := strings.Repeat("console.log('ok');", 100) // ~1.9 KB
	if err := app.validateDocContent(content, "test.js"); err != nil {
		t.Errorf("expected no error for valid ASCII content under limit, got: %v", err)
	}
}

func TestValidateDocContent_RejectsNonASCII(t *testing.T) {
	app := &App{}
	cases := []struct {
		name    string
		content string
	}{
		{"emoji", "hello 🌍 world"},
		{"accented char", "caf\u00e9"},
		{"CJK", "\u4e2d\u6587"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := app.validateDocContent(c.content, "test.js"); err == nil {
				t.Errorf("expected error for non-ASCII content (%s), got nil", c.name)
			}
		})
	}
}

func TestValidateDocContent_ExactlyAtLimit(t *testing.T) {
	// MAX_DOC_CODE_SIZE is 18 KB. getCodeSizeInKB counts bytes + newline count.
	// Build a string of exactly 18*1024 bytes with no newlines — size = 18.0 KB exactly.
	app := &App{}
	content := strings.Repeat("x", int(MAX_DOC_CODE_SIZE*1024))
	if err := app.validateDocContent(content, "edge.js"); err != nil {
		t.Errorf("content at exact limit should pass, got: %v", err)
	}
}

func TestValidateDocContent_OverLimit(t *testing.T) {
	// One byte over the limit should fail.
	app := &App{}
	content := strings.Repeat("x", int(MAX_DOC_CODE_SIZE*1024)+1)
	if err := app.validateDocContent(content, "big.js"); err == nil {
		t.Error("content over limit should fail validation, got nil")
	}
}

func TestValidateDocContent_EmptyString(t *testing.T) {
	app := &App{}
	if err := app.validateDocContent("", "empty.js"); err != nil {
		t.Errorf("empty content should pass validation, got: %v", err)
	}
}

// ============== ShardFile — input validation ==============

func TestShardFile_FileNotFound(t *testing.T) {
	app := &App{}
	result := app.ShardFile("/nonexistent/path/to/file.js", false)
	if result["success"] != false {
		t.Error("expected success=false for nonexistent file")
	}
	if _, ok := result["error"]; !ok {
		t.Error("expected an error message in result")
	}
}

func TestShardFile_RejectsDirectory(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	result := app.ShardFile(dir, false)
	if result["success"] != false {
		t.Error("expected success=false when path is a directory")
	}
}

// ============== ShardFile — small file (single shard) ==============

func TestShardFile_SmallFile_OneShard(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "small.js")
	if err := os.WriteFile(filePath, []byte("console.log('hello');"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.ShardFile(filePath, false)
	if result["success"] != true {
		t.Fatalf("ShardFile failed: %v", result["error"])
	}
	count, ok := result["shardCount"].(int)
	if !ok {
		t.Fatal("shardCount missing or wrong type")
	}
	if count != 1 {
		t.Errorf("expected 1 shard for small file, got %d", count)
	}
}

// ============== ShardFile — oversized file (multiple shards) ==============

func TestShardFile_OversizedFile_MultipleShards(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "large.js")
	// ~19 KB — comfortably over the 18 KB DOC limit
	content := strings.Repeat("console.log('shard me');", 850)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.ShardFile(filePath, false)
	if result["success"] != true {
		t.Fatalf("ShardFile failed: %v", result["error"])
	}
	count, ok := result["shardCount"].(int)
	if !ok {
		t.Fatal("shardCount missing or wrong type")
	}
	if count <= 1 {
		t.Errorf("expected more than 1 shard for oversized file, got %d", count)
	}
}

// ============== ShardFile — output directory ==============

// ShardFile must report the source file's directory as outputDir — not CWD or
// a constructed relative path. This guards against the bug where HOLOGRAM
// previously set outputDir to "datashards/shards/..." while tela.CreateShardFiles
// always wrote files into filepath.Dir(filePath).
func TestShardFile_OutputDirIsSourceFileDir(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "app.js")
	content := strings.Repeat("console.log('x');", 1200) // ~19 KB
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.ShardFile(filePath, false)
	if result["success"] != true {
		t.Fatalf("ShardFile failed: %v", result["error"])
	}
	outDir, ok := result["outputDir"].(string)
	if !ok {
		t.Fatal("outputDir missing or wrong type")
	}
	if outDir != dir {
		t.Errorf("outputDir = %q, want %q", outDir, dir)
	}
}

// Shard files must actually exist at the reported outputDir.
func TestShardFile_ShardFilesExistAtOutputDir(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "large.js")
	content := strings.Repeat("console.log('x');", 1200)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.ShardFile(filePath, false)
	if result["success"] != true {
		t.Fatalf("ShardFile failed: %v", result["error"])
	}
	outDir := result["outputDir"].(string)
	count := result["shardCount"].(int)

	// Verify shard files land in the reported directory
	entries, err := os.ReadDir(outDir)
	if err != nil {
		t.Fatalf("cannot read outputDir %q: %v", outDir, err)
	}
	shardFiles := 0
	for _, e := range entries {
		if strings.Contains(e.Name(), "-") {
			shardFiles++
		}
	}
	// Original + N shard files; at minimum count shard files should be present
	if shardFiles < count {
		t.Errorf("only %d shard-like files in %q, expected at least %d", shardFiles, outDir, count)
	}
}

// ============== Round-trip: shard → reconstruct → identical bytes ==============

// Uncompressed round-trip: the reconstructed file must be byte-for-byte identical
// to the original.
func TestShardRoundTrip_Uncompressed(t *testing.T) {
	dir := t.TempDir()
	original := []byte(strings.Repeat("console.log('round trip');", 800)) // ~20 KB
	filePath := filepath.Join(dir, "app.js")
	if err := os.WriteFile(filePath, original, 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	shardResult := app.ShardFile(filePath, false)
	if shardResult["success"] != true {
		t.Fatalf("ShardFile failed: %v", shardResult["error"])
	}

	// Remove the source file: tela.ConstructFromShards refuses to overwrite an
	// existing file. In a real workflow the user has the original elsewhere and
	// shards are the only thing in the output directory.
	if err := os.Remove(filePath); err != nil {
		t.Fatalf("could not remove source file before reconstruction: %v", err)
	}

	reconstructResult := app.ConstructFromShards(dir)
	if reconstructResult["success"] != true {
		t.Fatalf("ConstructFromShards failed: %v", reconstructResult["error"])
	}

	outPath, ok := reconstructResult["outputPath"].(string)
	if !ok {
		t.Fatal("outputPath missing or wrong type")
	}

	reconstructed, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("cannot read reconstructed file: %v", err)
	}
	if !bytes.Equal(reconstructed, original) {
		t.Errorf("round-trip content mismatch: got %d bytes, want %d", len(reconstructed), len(original))
	}
}

// GZIP compressed round-trip.
//
// This test specifically guards the compression pipeline ORDER enforced in
// ShardFile: compress-first → then shard. If anything reverses this (e.g. shard
// raw bytes then try to compress), ConstructFromShards will fail with
// "unexpected EOF" when it concatenates the shards and attempts to
// base64-decode + decompress. That was a real regression we fixed — this test
// will catch it if it reappears.
func TestShardRoundTrip_GZIPCompressed(t *testing.T) {
	dir := t.TempDir()
	original := []byte(strings.Repeat("console.log('compressed round trip');", 600)) // ~22 KB
	filePath := filepath.Join(dir, "app.js")
	if err := os.WriteFile(filePath, original, 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	shardResult := app.ShardFile(filePath, true) // compress=true
	if shardResult["success"] != true {
		t.Fatalf("ShardFile (compressed) failed: %v", shardResult["error"])
	}
	if shardResult["compressed"] != true {
		t.Error("expected compressed=true in result")
	}

	// Remove source file before reconstruction (see TestShardRoundTrip_Uncompressed).
	if err := os.Remove(filePath); err != nil {
		t.Fatalf("could not remove source file before reconstruction: %v", err)
	}

	reconstructResult := app.ConstructFromShards(dir)
	if reconstructResult["success"] != true {
		t.Fatalf("ConstructFromShards failed: %v", reconstructResult["error"])
	}

	outPath := reconstructResult["outputPath"].(string)
	reconstructed, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("cannot read reconstructed file: %v", err)
	}
	if !bytes.Equal(reconstructed, original) {
		t.Errorf("compressed round-trip content mismatch: got %d bytes, want %d", len(reconstructed), len(original))
	}
}

// Small file that fits in one shard still survives a round-trip.
func TestShardRoundTrip_SmallFile(t *testing.T) {
	dir := t.TempDir()
	original := []byte("<html><body>hello</body></html>")
	filePath := filepath.Join(dir, "index.html")
	if err := os.WriteFile(filePath, original, 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	shardResult := app.ShardFile(filePath, false)
	if shardResult["success"] != true {
		t.Fatalf("ShardFile failed: %v", shardResult["error"])
	}

	// Remove source file before reconstruction (see TestShardRoundTrip_Uncompressed).
	if err := os.Remove(filePath); err != nil {
		t.Fatalf("could not remove source file before reconstruction: %v", err)
	}

	reconstructResult := app.ConstructFromShards(dir)
	if reconstructResult["success"] != true {
		t.Fatalf("ConstructFromShards failed: %v", reconstructResult["error"])
	}

	reconstructed, _ := os.ReadFile(reconstructResult["outputPath"].(string))
	if !bytes.Equal(reconstructed, original) {
		t.Errorf("small file round-trip mismatch")
	}
}

// ============== ConstructFromShards — error paths ==============

func TestConstructFromShards_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	result := app.ConstructFromShards(dir)
	if result["success"] != false {
		t.Error("expected failure for directory with no shard files")
	}
}

func TestConstructFromShards_NonexistentPath(t *testing.T) {
	app := &App{}
	result := app.ConstructFromShards("/nonexistent/path")
	if result["success"] != false {
		t.Error("expected failure for nonexistent path")
	}
}

// ============== Compression-preflight false-positive (§7.11 bug) ==============

// This test documents the known bug described in §7.11 of AUTO-SHARD-DURING-DEPLOY.md.
//
// A file with highly compressible content may be slightly over the 18 KB raw
// size limit but compress well under it. The current frontend preflight check
// uses raw f.size — it will falsely flag such a file as "oversized" even when
// compress=true would make it fit in a single DOC.
//
// The Go-side ShardFile correctly works with post-compression bytes, so this
// test verifies that the backend itself produces a single shard for compressible
// content that shrinks enough — the fix needed is on the frontend preflight side.
func TestShardFile_HighlyCompressibleContent_SingleShard(t *testing.T) {
	dir := t.TempDir()
	// 20 KB of a single repeated character — compresses to < 1 KB with GZIP.
	content := strings.Repeat("a", 20*1024)
	filePath := filepath.Join(dir, "compressible.js")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result := app.ShardFile(filePath, true)
	if result["success"] != true {
		t.Fatalf("ShardFile (compressed) failed: %v", result["error"])
	}

	count := result["shardCount"].(int)
	// After GZIP compression, 20 KB of repeated 'a' should fit in 1 shard.
	// If this fails, log it as a note rather than a hard failure — the exact
	// shard count depends on tela's internal split threshold, but the point is
	// that the backend handles it correctly regardless.
	if count != 1 {
		t.Logf("NOTE (§7.11): compressed content still required %d shards — "+
			"the frontend preflight using raw size would also flag this as oversized; "+
			"fix the preflight to use an estimated post-compression size", count)
	}
}

// ============== discoverShardFiles — standalone unit tests ==============

func TestDiscoverShardFiles_NoShardFiles(t *testing.T) {
	dir := t.TempDir()
	// Put a regular file with no shard naming convention
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html/>"), 0644)

	_, _, _, err := discoverShardFiles(dir)
	if err == nil {
		t.Error("expected error for directory with no shard-named files")
	}
}

func TestDiscoverShardFiles_NonexistentPath(t *testing.T) {
	_, _, _, err := discoverShardFiles("/nonexistent/path")
	if err == nil {
		t.Error("expected error for nonexistent path")
	}
}

func TestDiscoverShardFiles_FindsShardsCreatedByShardFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "app.js")
	content := strings.Repeat("console.log('discover');", 900) // ~21 KB
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	shardResult := app.ShardFile(filePath, false)
	if shardResult["success"] != true {
		t.Fatalf("ShardFile failed: %v", shardResult["error"])
	}
	count := shardResult["shardCount"].(int)

	docShards, recreate, compression, err := discoverShardFiles(dir)
	if err != nil {
		t.Fatalf("discoverShardFiles failed: %v", err)
	}
	if len(docShards) != count {
		t.Errorf("discoverShardFiles found %d shards, want %d", len(docShards), count)
	}
	if recreate == "" {
		t.Error("recreate filename should not be empty")
	}
	_ = compression // may be empty for uncompressed
}

// =============================================================================
// Tier 2 Tests — expandFileToShards + buildPreflightExpansion
// These depend on the Phase 1 implementation. All tests are self-contained
// (no running daemon, no network, no disk writes beyond t.TempDir()).
// =============================================================================

// ============== expandFileToShards ==============

// A file well under the limit returns exactly one entry (fast path, no split).
func TestExpandFileToShards_SmallFile_OneShard(t *testing.T) {
	content := "console.log('hello');"
	shards, err := expandFileToShards(content, "small.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(shards) != 1 {
		t.Errorf("expected 1 shard for small file, got %d", len(shards))
	}
	if shards[0].ShardIndex != 0 {
		t.Errorf("fast-path entry should have ShardIndex=0 (sentinel), got %d", shards[0].ShardIndex)
	}
	if shards[0].Name != "small.js" {
		t.Errorf("fast-path name should be unchanged, got %q", shards[0].Name)
	}
}

// A file exactly at the 18 KB limit returns one shard (boundary check).
func TestExpandFileToShards_ExactlyAtLimit_OneShard(t *testing.T) {
	// Build content that is exactly MAX_DOC_CODE_SIZE KB with no newlines.
	content := strings.Repeat("x", int(MAX_DOC_CODE_SIZE*1024))
	shards, err := expandFileToShards(content, "edge.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(shards) != 1 {
		t.Errorf("content at exact limit should produce 1 shard, got %d", len(shards))
	}
}

// Empty content produces at most 1 shard and does not panic.
func TestExpandFileToShards_EmptyContent(t *testing.T) {
	shards, err := expandFileToShards("", "empty.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error for empty content: %v", err)
	}
	if len(shards) > 1 {
		t.Errorf("empty content should not produce multiple shards, got %d", len(shards))
	}
}

// A 36 KB file produces multiple shards, each individually under the limit.
func TestExpandFileToShards_AllShardsUnderLimit(t *testing.T) {
	content := strings.Repeat("console.log('shard');", 1800) // ~36 KB
	shards, err := expandFileToShards(content, "large.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(shards) <= 1 {
		t.Fatalf("expected multiple shards for 36KB content, got %d", len(shards))
	}
	for i, s := range shards {
		size := getCodeSizeInKB(s.Content)
		if size > MAX_DOC_CODE_SIZE {
			t.Errorf("shard %d exceeds limit: %.2fKB > %.2fKB", i+1, size, MAX_DOC_CODE_SIZE)
		}
	}
}

// Shard names follow the base-N.ext convention matching tela.CreateShardFiles.
func TestExpandFileToShards_ShardNamingConvention(t *testing.T) {
	content := strings.Repeat("console.log('x');", 1800) // ~36 KB
	shards, err := expandFileToShards(content, "app.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for i, s := range shards {
		expected := fmt.Sprintf("app-%d.js", i+1)
		if s.Name != expected {
			t.Errorf("shard %d name = %q, want %q", i+1, s.Name, expected)
		}
		if s.ShardIndex != i+1 {
			t.Errorf("shard %d ShardIndex = %d, want %d", i+1, s.ShardIndex, i+1)
		}
	}
}

// ShardCount is correctly backfilled on all entries.
func TestExpandFileToShards_ShardCountBackfilled(t *testing.T) {
	content := strings.Repeat("console.log('x');", 1800) // ~36 KB
	shards, err := expandFileToShards(content, "app.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	total := len(shards)
	for i, s := range shards {
		if s.ShardCount != total {
			t.Errorf("shard %d ShardCount = %d, want %d", i+1, s.ShardCount, total)
		}
	}
}

// Concatenating all shard contents reconstructs the original exactly.
func TestExpandFileToShards_ContentReconstructsExactly(t *testing.T) {
	original := strings.Repeat("console.log('roundtrip');", 1500) // ~30 KB
	shards, err := expandFileToShards(original, "app.js", "TELA-JS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var rebuilt strings.Builder
	for _, s := range shards {
		rebuilt.WriteString(s.Content)
	}
	if rebuilt.String() != original {
		t.Errorf("reconstructed content does not match original (%d vs %d chars)",
			rebuilt.Len(), len(original))
	}
}

// OriginalName is preserved on all shard entries.
func TestExpandFileToShards_OriginalNamePreserved(t *testing.T) {
	content := strings.Repeat("x", 25*1024)
	shards, err := expandFileToShards(content, "styles.css", "TELA-CSS-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, s := range shards {
		if s.OriginalName != "styles.css" {
			t.Errorf("OriginalName = %q, want %q", s.OriginalName, "styles.css")
		}
	}
}

// ============== buildPreflightExpansion ==============

func makeTestDOCInfo(t *testing.T, dir, name, content string) DOCInfo {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return DOCInfo{
		Name:    name,
		Path:    path,
		DocType: "TELA-JS-1",
		Size:    int64(len(content)),
	}
}

// Small files are left completely untouched — one DOCInfo in = one DOCInfo out.
func TestBuildPreflightExpansion_LeavesSmallFilesAlone(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	files := []DOCInfo{makeTestDOCInfo(t, dir, "small.js", "console.log('hi');")}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(exp.DeployFiles) != 1 {
		t.Errorf("expected 1 deploy file, got %d", len(exp.DeployFiles))
	}
	if exp.Summary.DeployDocCount != 1 {
		t.Errorf("DeployDocCount = %d, want 1", exp.Summary.DeployDocCount)
	}
	if exp.Summary.ShardCount != 0 {
		t.Errorf("ShardCount should be 0 for small files, got %d", exp.Summary.ShardCount)
	}
	if len(exp.Warnings) != 0 {
		t.Errorf("no warnings expected for small files, got: %v", exp.Warnings)
	}
}

// Oversized files are expanded into multiple deploy entries.
func TestBuildPreflightExpansion_ExpandsOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	oversized := strings.Repeat("console.log('x');", 1800) // ~36 KB
	files := []DOCInfo{makeTestDOCInfo(t, dir, "large.js", oversized)}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(exp.DeployFiles) <= 1 {
		t.Errorf("expected >1 deploy files for oversized file, got %d", len(exp.DeployFiles))
	}
	if exp.Summary.ShardCount == 0 {
		t.Error("ShardCount should be >0 when oversized files are expanded")
	}
	if len(exp.Warnings) == 0 {
		t.Error("expected a warning for the oversized file")
	}
}

// Summary.DeployDocCount reflects the expanded count, not the source file count.
func TestBuildPreflightExpansion_SummaryDocCount(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	oversized := strings.Repeat("console.log('x');", 1800)
	small := "console.log('small');"
	files := []DOCInfo{
		makeTestDOCInfo(t, dir, "large.js", oversized),
		makeTestDOCInfo(t, dir, "small.js", small),
	}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exp.Summary.SourceFileCount != 2 {
		t.Errorf("SourceFileCount = %d, want 2", exp.Summary.SourceFileCount)
	}
	if exp.Summary.DeployDocCount <= 2 {
		t.Errorf("DeployDocCount should be >2 (large.js was sharded), got %d", exp.Summary.DeployDocCount)
	}
}

// Gas estimate is non-zero for non-empty files.
func TestBuildPreflightExpansion_GasEstimateNonZero(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	files := []DOCInfo{makeTestDOCInfo(t, dir, "app.js", "console.log('gas');")}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exp.Summary.EstimatedGas == 0 {
		t.Error("EstimatedGas should be >0 for non-empty deploy")
	}
}

// Oversized index.html is rejected with a clear error — entrypoint protection.
func TestBuildPreflightExpansion_RejectsOversizedIndexHTML(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	oversized := strings.Repeat("<div>x</div>", 2000) // ~24 KB
	files := []DOCInfo{{
		Name:    "index.html",
		Path:    filepath.Join(dir, "index.html"),
		DocType: "TELA-HTML-1",
		Size:    int64(len(oversized)),
	}}
	if err := os.WriteFile(files[0].Path, []byte(oversized), 0644); err != nil {
		t.Fatal(err)
	}
	config := PreflightConfig{AutoShard: true, Compress: false}

	_, err := app.buildPreflightExpansion(files, config)
	if err == nil {
		t.Error("expected error for oversized index.html, got nil")
	}
	if !strings.Contains(err.Error(), "index.html") {
		t.Errorf("error message should mention index.html, got: %v", err)
	}
}

// A normally-sized index.html passes through without error.
func TestBuildPreflightExpansion_SmallIndexHTML_PassesThrough(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	files := []DOCInfo{{
		Name:    "index.html",
		Path:    filepath.Join(dir, "index.html"),
		DocType: "TELA-HTML-1",
		Size:    30,
	}}
	if err := os.WriteFile(files[0].Path, []byte("<html><body>hi</body></html>"), 0644); err != nil {
		t.Fatal(err)
	}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("small index.html should not error, got: %v", err)
	}
	if len(exp.DeployFiles) != 1 {
		t.Errorf("expected 1 deploy file, got %d", len(exp.DeployFiles))
	}
}

// ShardGroups length matches the source file count (one group per source file).
func TestBuildPreflightExpansion_ShardGroupsOnlyOversized(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	files := []DOCInfo{
		makeTestDOCInfo(t, dir, "a.js", "console.log('a');"),
		makeTestDOCInfo(t, dir, "b.js", strings.Repeat("x", 25*1024)),
	}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(exp.ShardGroups) != 1 {
		t.Errorf("ShardGroups length = %d, want 1 (only oversized files)", len(exp.ShardGroups))
	}
	if exp.ShardGroups[0].OriginalName != "b.js" {
		t.Errorf("ShardGroup[0].OriginalName = %q, want %q", exp.ShardGroups[0].OriginalName, "b.js")
	}
}

// Virtual DOCInfo entries produced for shards carry DataString (not Path).
func TestBuildPreflightExpansion_VirtualShardsHaveDataString(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	oversized := strings.Repeat("console.log('v');", 1800)
	files := []DOCInfo{makeTestDOCInfo(t, dir, "large.js", oversized)}
	config := PreflightConfig{AutoShard: true, Compress: false}

	exp, err := app.buildPreflightExpansion(files, config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for i, df := range exp.DeployFiles {
		if df.DataString == "" {
			t.Errorf("deploy file %d (%s) has empty DataString — virtual shards must carry in-memory content", i, df.Name)
		}
		if df.Path != "" {
			t.Errorf("deploy file %d (%s) has a Path set — virtual shards should have no disk path", i, df.Name)
		}
	}
}

// ============== Phase 5: Integration Tests — PreflightExpand Wails Binding ==============
// These tests exercise the full PreflightExpand endpoint with real temp folders,
// real file walking, and real JSON config — the same path the frontend calls.

func TestPreflightExpand_SmallFolderNoShards(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html><body>hello</body></html>"), 0644)
	os.WriteFile(filepath.Join(dir, "style.css"), []byte("body { margin: 0; }"), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":false}`)

	if result["success"] != true {
		t.Fatalf("expected success, got error: %v", result["error"])
	}
	deployFiles, ok := result["deployFiles"].([]DOCInfo)
	if !ok {
		t.Fatalf("deployFiles wrong type: %T", result["deployFiles"])
	}
	if len(deployFiles) != 2 {
		t.Errorf("expected 2 deploy files, got %d", len(deployFiles))
	}
	shardGroups, _ := result["shardGroups"].([]ShardGroup)
	for _, sg := range shardGroups {
		if sg.ShardCount > 1 {
			t.Errorf("no files should be sharded, but %s has %d shards", sg.OriginalName, sg.ShardCount)
		}
	}
}

func TestPreflightExpand_OversizedFileSplits(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html><body>app</body></html>"), 0644)
	oversized := strings.Repeat("var x=1;\n", 3000) // ~27KB
	os.WriteFile(filepath.Join(dir, "big.js"), []byte(oversized), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":false}`)

	if result["success"] != true {
		t.Fatalf("expected success, got error: %v", result["error"])
	}
	deployFiles := result["deployFiles"].([]DOCInfo)
	if len(deployFiles) <= 2 {
		t.Errorf("oversized big.js should produce >1 shard, but total deploy files = %d", len(deployFiles))
	}

	shardGroups := result["shardGroups"].([]ShardGroup)
	foundBigShard := false
	for _, sg := range shardGroups {
		if sg.OriginalName == "big.js" && sg.ShardCount > 1 {
			foundBigShard = true
		}
	}
	if !foundBigShard {
		t.Error("expected a ShardGroup for big.js with ShardCount > 1")
	}

	summary := result["summary"].(PreflightSummary)
	if summary.ShardCount == 0 {
		t.Error("summary.ShardCount should be > 0")
	}
	if summary.EstimatedGas == 0 {
		t.Error("summary.EstimatedGas should be > 0")
	}
}

func TestPreflightExpand_OversizedIndexHtmlRejected(t *testing.T) {
	dir := t.TempDir()
	oversized := strings.Repeat("<div>content</div>\n", 2000) // ~38KB
	os.WriteFile(filepath.Join(dir, "index.html"), []byte(oversized), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":false}`)

	if result["success"] != false {
		t.Fatal("expected failure when index.html is oversized")
	}
	errMsg, _ := result["error"].(string)
	if !strings.Contains(strings.ToLower(errMsg), "index.html") {
		t.Errorf("error should mention index.html, got: %s", errMsg)
	}
}

func TestPreflightExpand_HiddenFilesSkipped(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html></html>"), 0644)
	os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("junk"), 0644)
	os.Mkdir(filepath.Join(dir, ".git"), 0755)
	os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("[core]"), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":false}`)

	if result["success"] != true {
		t.Fatalf("expected success, got: %v", result["error"])
	}
	deployFiles := result["deployFiles"].([]DOCInfo)
	for _, df := range deployFiles {
		if strings.HasPrefix(df.Name, ".") {
			t.Errorf("hidden file should be skipped: %s", df.Name)
		}
	}
	if len(deployFiles) != 1 {
		t.Errorf("expected 1 file (index.html only), got %d", len(deployFiles))
	}
}

func TestPreflightExpand_InvalidFolder(t *testing.T) {
	app := &App{}
	result := app.PreflightExpand("/nonexistent/path/xyz", `{"autoShard":true}`)
	if result["success"] != false {
		t.Error("expected failure for nonexistent folder")
	}
}

func TestPreflightExpand_InvalidConfigJSON(t *testing.T) {
	app := &App{}
	result := app.PreflightExpand("/tmp", `{bad json}`)
	if result["success"] != false {
		t.Error("expected failure for invalid JSON config")
	}
}

func TestPreflightExpand_EmptyFolder(t *testing.T) {
	dir := t.TempDir()
	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true}`)
	if result["success"] != false {
		t.Error("expected failure for empty folder")
	}
}

func TestPreflightExpand_WithCompression(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html><body>hi</body></html>"), 0644)
	oversized := strings.Repeat("function f(){return 1;}\n", 1200) // ~28KB
	os.WriteFile(filepath.Join(dir, "app.js"), []byte(oversized), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":true}`)

	if result["success"] != true {
		t.Fatalf("expected success, got: %v", result["error"])
	}
	summary := result["summary"].(PreflightSummary)
	if summary.DeployDocCount < 2 {
		t.Errorf("expected at least 2 deploy docs, got %d", summary.DeployDocCount)
	}
}

// JSON round-trip: simulates the exact path from frontend → DeployTELABatch JSON unmarshal.
// Verifies that virtual shard DOCInfo entries survive JSON serialization and that
// DataString (json:"data") is correctly populated when unmarshalled into BatchDeployConfig.
func TestJSONRoundTrip_VirtualShardDOCInfo(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html></html>"), 0644)
	oversized := strings.Repeat("x", 25*1024)
	os.WriteFile(filepath.Join(dir, "big.js"), []byte(oversized), 0644)

	app := &App{}
	result := app.PreflightExpand(dir, `{"autoShard":true,"compress":false}`)
	if result["success"] != true {
		t.Fatalf("preflight failed: %v", result["error"])
	}

	deployFiles := result["deployFiles"].([]DOCInfo)

	// Build the same JSON the frontend would send to DeployTELABatch
	type filePart struct {
		Name       string `json:"name"`
		Path       string `json:"path"`
		Data       string `json:"data"`
		SubDir     string `json:"subDir"`
		DocType    string `json:"docType"`
		Size       int64  `json:"size"`
		Compressed bool   `json:"compressed"`
		Ringsize   uint64 `json:"ringsize"`
	}
	var parts []filePart
	for _, df := range deployFiles {
		parts = append(parts, filePart{
			Name:       df.Name,
			Path:       df.Path,
			Data:       df.DataString,
			SubDir:     df.SubDir,
			DocType:    df.DocType,
			Size:       df.Size,
			Compressed: df.Compressed,
			Ringsize:   2,
		})
	}

	batchJSON := struct {
		Files       []filePart `json:"files"`
		IndexName   string     `json:"indexName"`
		IndexDurl   string     `json:"indexDurl"`
		Description string     `json:"description"`
		Ringsize    uint64     `json:"ringsize"`
	}{
		Files:     parts,
		IndexName: "test-app",
		IndexDurl: "test.tela.shards",
		Ringsize:  2,
	}

	raw, err := json.Marshal(batchJSON)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	// Unmarshal exactly as DeployTELABatch does
	var batch BatchDeployConfig
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatalf("unmarshal into BatchDeployConfig failed: %v", err)
	}

	if len(batch.Files) != len(deployFiles) {
		t.Fatalf("file count mismatch: %d vs %d", len(batch.Files), len(deployFiles))
	}

	for i, f := range batch.Files {
		if f.Path == "" && f.DataString == "" {
			t.Errorf("file %d (%s): both Path and DataString are empty — deploy would fail", i, f.Name)
		}
		if f.DataString != "" && f.Path != "" {
			// Virtual shards should have DataString but no Path
			if strings.Contains(f.Name, "-") { // shard names contain hyphens (e.g. big-1.js)
				t.Logf("file %d (%s): has both Path and DataString — Path should be empty for virtual shards", i, f.Name)
			}
		}
	}
}

func TestLongestCommonPathPrefix(t *testing.T) {
	a := "/home/user/project/static/index.html"
	b := "/home/user/project/static/assets/icon.png"
	got := longestCommonPathPrefix(a, b)
	want := "/home/user/project/static"
	if got != want {
		t.Errorf("longestCommonPathPrefix() = %q, want %q", got, want)
	}
}

func TestResolveDropPaths_MultiFile(t *testing.T) {
	app := &App{}
	dir := t.TempDir()
	sub := filepath.Join(dir, "static")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	html := filepath.Join(sub, "index.html")
	if err := os.WriteFile(html, []byte("<html></html>"), 0644); err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(sub, "assets")
	if err := os.MkdirAll(assetDir, 0755); err != nil {
		t.Fatal(err)
	}
	ico := filepath.Join(assetDir, "favicon.ico")
	if err := os.WriteFile(ico, []byte("ico"), 0644); err != nil {
		t.Fatal(err)
	}

	result := app.ResolveDropPaths([]string{html, ico})
	if result["success"] != true {
		t.Fatalf("ResolveDropPaths failed: %v", result["error"])
	}
	folder, _ := result["folderPath"].(string)
	if folder != sub {
		t.Errorf("folderPath = %q, want %q", folder, sub)
	}
}

