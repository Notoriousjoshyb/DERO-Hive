package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/civilware/tela"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// validateFileContent checks file content for issues that would crash the DVM
// Returns a warning string if issues found, empty string if OK
func validateFileContent(data []byte, fileName string) string {
	for i, r := range string(data) {
		if r > unicode.MaxASCII {
			// Find the position for helpful error message
			line := 1
			col := 1
			for j := 0; j < i; j++ {
				if data[j] == '\n' {
					line++
					col = 1
				} else {
					col++
				}
			}
			return fmt.Sprintf("Non-ASCII character '%c' at line %d, col %d - will fail deployment", r, line, col)
		}
	}
	
	// Check size
	contentSize := float64(len(data)+strings.Count(string(data), "\n")) / 1024
	if contentSize > 18 { // MAX_DOC_CODE_SIZE
		return fmt.Sprintf("File too large (%.2fKB > 18KB max)", contentSize)
	}
	
	return ""
}

// FileService handles file operations

// GetFileInfo returns detailed information about a file
func (a *App) GetFileInfo(filePath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DOC] Getting file info: %s", filePath))

	info, err := os.Stat(filePath)
	if err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "File not found. Check the path.",
			"technicalError": err.Error(),
		}
	}

	// Get absolute path
	absPath, _ := filepath.Abs(filePath)

	// Detect MIME type
	ext := strings.ToLower(filepath.Ext(filePath))
	docType := tela.ParseDocType(filepath.Base(filePath))

	// Read first few bytes to detect content type
	contentPreview := ""
	if !info.IsDir() && info.Size() > 0 && info.Size() < 10*1024*1024 { // < 10MB
		data, err := os.ReadFile(filePath)
		if err == nil && len(data) > 0 {
			// Show first 500 bytes as preview for text files
			if strings.HasPrefix(docType, "text/") || docType == "application/javascript" || docType == "application/json" {
				previewLen := 500
				if len(data) < previewLen {
					previewLen = len(data)
				}
				contentPreview = string(data[:previewLen])
			}
		}
	}

	return map[string]interface{}{
		"success":      true,
		"name":         info.Name(),
		"path":         absPath,
		"size":         info.Size(),
		"isDir":        info.IsDir(),
		"modTime":      info.ModTime().Unix(),
		"extension":    ext,
		"docType":      docType,
		"preview":      contentPreview,
		"canCompress":  canCompress(docType),
		"gasEstimate":  estimateGasCost(int(info.Size())),
	}
}

// ShardFile splits a file into DocShards for TELA deployment
func (a *App) ShardFile(filePath string, compress bool) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[File] Sharding file: %s (compress: %v)", filePath, compress))

	// Check file exists
	info, err := os.Stat(filePath)
	if err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "File not found. Check the path.",
			"technicalError": err.Error(),
		}
	}

	if info.IsDir() {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot shard a directory",
		}
	}

	// Read file content
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ErrorResponse(err)
	}

	// tela.CreateShardFiles writes output files into filepath.Dir(filePath) — the
	// source file's own directory. Report this as the actual outputDir so the UI
	// shows the real location instead of a phantom relative path.
	outputDir := filepath.Dir(filePath)

	compression := ""
	if compress {
		compression = tela.COMPRESSION_GZIP
		// Compress BEFORE sharding: tela.Compress returns a base64-encoded gzip string.
		// If we pass raw data with compression set, CreateShardFiles checks content != nil
		// and skips its own compression step — the output would be named .gz but contain
		// uncompressed bytes, causing ConstructFromShards to fail with "unexpected EOF"
		// when it tries to base64-decode raw content. We compress here so each shard
		// file is a fragment of the base64 gzip stream, exactly what ConstructFromShards
		// expects when it concatenates and decompresses.
		compressed, compErr := tela.Compress(data, compression)
		if compErr != nil {
			return map[string]interface{}{
				"success":        false,
				"error":          "Failed to compress file before sharding",
				"technicalError": compErr.Error(),
			}
		}
		data = []byte(compressed)
	}

	err = tela.CreateShardFiles(filePath, compression, data)
	if err != nil {
		return ErrorResponse(err)
	}

	// Count shard files created using the (possibly compressed) data size
	totalShards, _ := tela.GetTotalShards(data)

	a.logToConsole(fmt.Sprintf("[OK] Created shard files in %s", outputDir))

	return map[string]interface{}{
		"success":     true,
		"shardCount":  totalShards,
		"outputDir":   outputDir,
		"compressed":  compress,
		"message":     fmt.Sprintf("File sharded into %d parts", totalShards),
	}
}

// discoverShardFiles finds DocShard files, parses indices, sorts by index, and returns
// ordered shard bytes plus recreate filename and compression. Matches tela-cli findDocShardFiles behavior.
// entrypointPath can be a directory (we find the first shard set) or a shard file (e.g. file-1.go).
func discoverShardFiles(entrypointPath string) (docShards [][]byte, recreate, compression string, err error) {
	info, err := os.Stat(entrypointPath)
	if err != nil {
		return nil, "", "", err
	}

	shardDir := entrypointPath
	fileName := ""
	if !info.IsDir() {
		shardDir = filepath.Dir(entrypointPath)
		fileName = filepath.Base(entrypointPath)
	}

	// If directory, find first file matching name-N.ext or name-N.ext.gz
	if fileName == "" {
		entries, e := os.ReadDir(shardDir)
		if e != nil {
			return nil, "", "", e
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			base := name
			// Strip compression extension first (e.g. .gz), then the original extension
			// so that name-1.js.gz correctly yields "name-1" for the numeric check.
			if tela.IsCompressedExt(filepath.Ext(base)) {
				base = strings.TrimSuffix(base, filepath.Ext(base))
			}
			base = strings.TrimSuffix(base, filepath.Ext(base))
			parts := strings.Split(base, "-")
			if len(parts) >= 2 {
				if n, pe := strconv.Atoi(parts[len(parts)-1]); pe == nil && n >= 1 {
					fileName = name
					break
				}
			}
		}
		if fileName == "" {
			return nil, "", "", fmt.Errorf("no shard files found in %s (expected name-1.ext or name-1.ext.gz)", shardDir)
		}
	}

	split := strings.Split(fileName, "-")
	if len(split) < 2 {
		return nil, "", "", fmt.Errorf("%q is not a DocShard file", entrypointPath)
	}

	ext := filepath.Ext(fileName) // used for matching (e.g. .gz for compressed)
	prefix := fmt.Sprintf("%s-", split[0])

	if tela.IsCompressedExt(ext) {
		compression = ext
		origExt := filepath.Ext(strings.TrimSuffix(fileName, ext))
		recreate = fmt.Sprintf("%s%s", split[0], origExt)
	} else {
		recreate = fmt.Sprintf("%s%s", split[0], ext)
	}

	type shardEntry struct {
		index int
		data  []byte
	}
	var shards []shardEntry

	files, err := os.ReadDir(shardDir)
	if err != nil {
		return nil, "", "", err
	}

	for _, file := range files {
		if file.IsDir() {
			continue
		}
		shardFileName := file.Name()
		if !strings.HasPrefix(shardFileName, prefix) || filepath.Ext(shardFileName) != ext {
			continue
		}

		baseName := strings.TrimSuffix(shardFileName, ext)
		if compression != "" {
			baseName = strings.TrimSuffix(baseName, filepath.Ext(baseName))
		}
		idxParts := strings.Split(baseName, "-")
		if len(idxParts) < 2 {
			continue
		}
		idx, parseErr := strconv.Atoi(idxParts[len(idxParts)-1])
		if parseErr != nil {
			continue
		}

		data, errr := os.ReadFile(filepath.Join(shardDir, shardFileName))
		if errr != nil {
			return nil, "", "", fmt.Errorf("could not read shard file %q: %w", shardFileName, errr)
		}
		shards = append(shards, shardEntry{index: idx, data: data})
	}

	if len(shards) == 0 {
		return nil, "", "", fmt.Errorf("no shard files found in %s", shardDir)
	}

	sort.Slice(shards, func(i, j int) bool { return shards[i].index < shards[j].index })
	for _, s := range shards {
		docShards = append(docShards, s.data)
	}
	return docShards, recreate, compression, nil
}

// ConstructFromShards reconstructs a file from DocShards
func (a *App) ConstructFromShards(shardPath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Shards] Constructing file from shards: %s", shardPath))

	shardFiles, recreate, compression, err := discoverShardFiles(shardPath)
	if err != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          "Failed to discover shard files",
			"technicalError": err.Error(),
		}
	}

	shardDir := shardPath
	if info, e := os.Stat(shardPath); e == nil && !info.IsDir() {
		shardDir = filepath.Dir(shardPath)
	}

	err = tela.ConstructFromShards(shardFiles, recreate, shardDir, compression)
	if err != nil {
		return ErrorResponse(err)
	}

	outputPath := filepath.Join(shardDir, recreate)
	outputInfo, _ := os.Stat(outputPath)
	size := int64(0)
	if outputInfo != nil {
		size = outputInfo.Size()
	}

	a.logToConsole(fmt.Sprintf("[OK] File reconstructed: %s (%d bytes)", outputPath, size))

	return map[string]interface{}{
		"success":    true,
		"outputPath": outputPath,
		"size":       size,
		"message":    "File reconstructed successfully",
	}
}

// DiffFiles compares two files and returns the differences
func (a *App) DiffFiles(file1, file2 string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STATS] Diffing files: %s vs %s", file1, file2))

	// Read file 1
	data1, err := os.ReadFile(file1)
	if err != nil {
		return ErrorResponse(err)
	}

	// Read file 2
	data2, err := os.ReadFile(file2)
	if err != nil {
		return ErrorResponse(err)
	}

	// Split into lines
	lines1 := strings.Split(string(data1), "\n")
	lines2 := strings.Split(string(data2), "\n")

	// Simple line-by-line diff
	diffs := computeLineDiff(lines1, lines2)

	return map[string]interface{}{
		"success":    true,
		"file1":      file1,
		"file2":      file2,
		"file1Lines": len(lines1),
		"file2Lines": len(lines2),
		"diffs":      diffs,
		"identical":  len(diffs) == 0,
	}
}

// DiffSCIDs compares the code of two smart contracts
func (a *App) DiffSCIDs(scid1, scid2 string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STATS] Diffing SCIDs: %s vs %s", scid1[:16]+"...", scid2[:16]+"..."))

	// Get code for first SCID
	result1, err := a.daemonClient.Call("DERO.GetSC", map[string]interface{}{
		"scid": scid1,
		"code": true,
	})
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to get first SC: %v", err),
		}
	}

	// Get code for second SCID
	result2, err := a.daemonClient.Call("DERO.GetSC", map[string]interface{}{
		"scid": scid2,
		"code": true,
	})
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to get second SC: %v", err),
		}
	}

	// Extract code strings
	code1 := extractCode(result1)
	code2 := extractCode(result2)

	// Compute diff
	lines1 := strings.Split(code1, "\n")
	lines2 := strings.Split(code2, "\n")
	diffs := computeLineDiff(lines1, lines2)

	return map[string]interface{}{
		"success":    true,
		"scid1":      scid1,
		"scid2":      scid2,
		"code1Lines": len(lines1),
		"code2Lines": len(lines2),
		"diffs":      diffs,
		"identical":  len(diffs) == 0,
	}
}

// MoveFile moves a file or directory
func (a *App) MoveFile(source, destination string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DIR] Moving: %s → %s", source, destination))

	// Check source exists
	if _, err := os.Stat(source); os.IsNotExist(err) {
		return map[string]interface{}{
			"success": false,
			"error":   "Source file not found",
		}
	}

	// Create destination directory if needed
	destDir := filepath.Dir(destination)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to create destination directory: %v", err),
		}
	}

	// Move the file
	if err := os.Rename(source, destination); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to move file: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] File moved to: %s", destination))

	return map[string]interface{}{
		"success":     true,
		"source":      source,
		"destination": destination,
		"message":     "File moved successfully",
	}
}

// RemoveFile removes a file or directory (only from datashards/clone)
func (a *App) RemoveFile(path string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[File] Removing: %s", path))

	// Security check: only allow removal from datashards directory
	absPath, _ := filepath.Abs(path)
	shardsDir, _ := filepath.Abs(filepath.Join(".", "datashards"))
	
	if !strings.HasPrefix(absPath, shardsDir) {
		return map[string]interface{}{
			"success": false,
			"error":   "Can only remove files from datashards directory",
		}
	}

	// Check file exists
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return map[string]interface{}{
			"success": false,
			"error":   "File not found",
		}
	}

	// Remove file or directory
	if info.IsDir() {
		if err := os.RemoveAll(path); err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to remove directory: %v", err),
			}
		}
	} else {
		if err := os.Remove(path); err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to remove file: %v", err),
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Removed: %s", path))

	return map[string]interface{}{
		"success": true,
		"path":    path,
		"message": "File removed successfully",
	}
}

// ListDirectory lists contents of a directory
func (a *App) ListDirectory(dirPath string) map[string]interface{} {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to read directory: %v", err),
		}
	}

	items := []map[string]interface{}{}
	for _, entry := range entries {
		info, _ := entry.Info()
		items = append(items, map[string]interface{}{
			"name":    entry.Name(),
			"isDir":   entry.IsDir(),
			"size":    info.Size(),
			"modTime": info.ModTime().Unix(),
		})
	}

	return map[string]interface{}{
		"success": true,
		"path":    dirPath,
		"items":   items,
		"count":   len(items),
	}
}

// ================== FOLDER SELECTION ==================

// SelectFolder opens a native directory picker dialog
func (a *App) SelectFolder() string {
	selection, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Select Folder for TELA Deployment",
		CanCreateDirectories: false,
	})
	if err != nil {
		log.Printf("Error opening directory dialog: %v", err)
		return ""
	}
	return selection
}

// SelectFile opens a native file picker dialog
func (a *App) SelectFile() string {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select File",
	})
	if err != nil {
		log.Printf("Error opening file dialog: %v", err)
		return ""
	}
	return selection
}

// SelectFileWithContent opens a native file picker dialog and returns the file content as base64.
// This is used by TELA dApps that need to select files (e.g., importing images).
// The accept parameter is a comma-separated list of MIME types (e.g., "image/png,image/jpeg")
// or file extensions (e.g., ".png,.jpg"). If empty, all files are shown.
func (a *App) SelectFileWithContent(title string, accept string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[FILE] SelectFileWithContent: title=%s, accept=%s", title, accept))

	// Build file filters from accept parameter
	filters := []runtime.FileFilter{}
	if accept != "" {
		// Parse accept string to build filters
		parts := strings.Split(accept, ",")
		patterns := []string{}
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, ".") {
				// Extension like ".png"
				patterns = append(patterns, "*"+part)
			} else if strings.Contains(part, "/") {
				// MIME type like "image/png"
				switch part {
				case "image/png":
					patterns = append(patterns, "*.png")
				case "image/jpeg":
					patterns = append(patterns, "*.jpg", "*.jpeg")
				case "image/gif":
					patterns = append(patterns, "*.gif")
				case "image/svg+xml":
					patterns = append(patterns, "*.svg")
				case "image/*":
					patterns = append(patterns, "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.webp")
				case "text/plain":
					patterns = append(patterns, "*.txt")
				case "text/html":
					patterns = append(patterns, "*.html", "*.htm")
				case "text/css":
					patterns = append(patterns, "*.css")
				case "application/javascript", "text/javascript":
					patterns = append(patterns, "*.js")
				case "application/json":
					patterns = append(patterns, "*.json")
				}
			}
		}
		if len(patterns) > 0 {
			filters = append(filters, runtime.FileFilter{
				DisplayName: "Allowed Files",
				Pattern:     strings.Join(patterns, ";"),
			})
		}
	}
	// Always add "All Files" as fallback
	filters = append(filters, runtime.FileFilter{
		DisplayName: "All Files",
		Pattern:     "*.*",
	})

	dialogTitle := title
	if dialogTitle == "" {
		dialogTitle = "Select File"
	}

	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   dialogTitle,
		Filters: filters,
	})
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SelectFileWithContent: Dialog error - %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("File dialog error: %v", err),
		}
	}

	// User cancelled
	if selection == "" {
		a.logToConsole("[FILE] SelectFileWithContent: User cancelled")
		return map[string]interface{}{
			"success":   false,
			"cancelled": true,
		}
	}

	// Read the file
	info, err := os.Stat(selection)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SelectFileWithContent: Stat error - %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Cannot read file: %v", err),
		}
	}

	// Limit file size to 50MB for safety
	const maxSize = 50 * 1024 * 1024
	if info.Size() > maxSize {
		a.logToConsole(fmt.Sprintf("[ERR] SelectFileWithContent: File too large (%d bytes)", info.Size()))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("File too large (%d bytes). Maximum is 50MB.", info.Size()),
		}
	}

	data, err := os.ReadFile(selection)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SelectFileWithContent: Read error - %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to read file: %v", err),
		}
	}

	// Detect MIME type from extension
	ext := strings.ToLower(filepath.Ext(selection))
	mimeType := "application/octet-stream"
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".gif":
		mimeType = "image/gif"
	case ".svg":
		mimeType = "image/svg+xml"
	case ".webp":
		mimeType = "image/webp"
	case ".txt":
		mimeType = "text/plain"
	case ".html", ".htm":
		mimeType = "text/html"
	case ".css":
		mimeType = "text/css"
	case ".js":
		mimeType = "application/javascript"
	case ".json":
		mimeType = "application/json"
	}

	// Encode as base64
	base64Data := base64.StdEncoding.EncodeToString(data)

	a.logToConsole(fmt.Sprintf("[OK] SelectFileWithContent: Selected %s (%d bytes)", info.Name(), info.Size()))

	return map[string]interface{}{
		"success":  true,
		"filename": info.Name(),
		"path":     selection,
		"size":     info.Size(),
		"mimeType": mimeType,
		"base64":   base64Data,
	}
}

// ReadTextFile reads a text file and returns its content.
// Used by the Deploy SC flow to load .bas files from disk.
func (a *App) ReadTextFile(filePath string) map[string]interface{} {
	if filePath == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "No file path provided",
		}
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "File not found: " + err.Error(),
		}
	}

	const maxSize = 1 * 1024 * 1024 // 1MB
	if info.Size() > maxSize {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("File too large (%d bytes). Maximum is 1MB.", info.Size()),
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Failed to read file: " + err.Error(),
		}
	}

	return map[string]interface{}{
		"success":  true,
		"content":  string(data),
		"size":     len(data),
		"filename": info.Name(),
	}
}

// SelectFiles opens a native multiple file picker dialog for TELA DOC uploads
func (a *App) SelectFiles() map[string]interface{} {
	a.logToConsole("[FILE] SelectFiles: Opening native file dialog...")
	
	selections, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Files for TELA Upload",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Web Files",
				Pattern:     "*.html;*.htm;*.css;*.js;*.json;*.svg;*.png;*.jpg;*.jpeg;*.gif;*.webp;*.ico;*.woff;*.woff2;*.ttf",
			},
			{
				DisplayName: "All Files",
				Pattern:     "*.*",
			},
		},
	})
	
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] SelectFiles: Dialog error - %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
	}

	a.logToConsole(fmt.Sprintf("[FILE] SelectFiles: Dialog returned %d selections", len(selections)))
	
	if len(selections) == 0 {
		a.logToConsole("[FILE] SelectFiles: No files selected (user cancelled)")
		return map[string]interface{}{
			"success": false,
			"error":   "No files selected",
		}
	}

	// Process selected files
	a.logToConsole("[FILE] SelectFiles: Processing selected files...")
	var files []map[string]interface{}
	for _, filePath := range selections {
		info, err := os.Stat(filePath)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] SelectFiles: Could not stat %s - %v", filePath, err))
			continue
		}

		// Read file content
		content, err := os.ReadFile(filePath)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] SelectFiles: Could not read %s - %v", filePath, err))
			continue
		}

		files = append(files, map[string]interface{}{
			"name":    info.Name(),
			"path":    filePath,
			"subDir":  "/",
			"size":    info.Size(),
			"type":    detectMimeType(info.Name()),
			"data":    string(content),
		})
		a.logToConsole(fmt.Sprintf("[FILE] SelectFiles: Loaded %s (%d bytes)", info.Name(), info.Size()))
	}

	a.logToConsole(fmt.Sprintf("[OK] SelectFiles: Returning %d files", len(files)))
	return map[string]interface{}{
		"success": true,
		"files":   files,
	}
}

// LoadFilesFromPaths reads dropped or resolved filesystem paths into the same shape as SelectFiles.
func (a *App) LoadFilesFromPaths(paths []string) map[string]interface{} {
	if len(paths) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No paths provided",
		}
	}

	var files []map[string]interface{}
	for _, filePath := range paths {
		info, err := os.Stat(filePath)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] LoadFilesFromPaths: Could not stat %s - %v", filePath, err))
			continue
		}
		if info.IsDir() {
			continue
		}

		content, err := os.ReadFile(filePath)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] LoadFilesFromPaths: Could not read %s - %v", filePath, err))
			continue
		}

		files = append(files, map[string]interface{}{
			"name":   info.Name(),
			"path":   filePath,
			"subDir": "/",
			"size":   info.Size(),
			"type":   detectMimeType(info.Name()),
			"data":   string(content),
		})
	}

	if len(files) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No readable files in drop",
		}
	}

	return map[string]interface{}{
		"success": true,
		"files":   files,
	}
}

// ResolveDropPaths picks a folder path suitable for batch upload from native file-drop paths.
func (a *App) ResolveDropPaths(paths []string) map[string]interface{} {
	if len(paths) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No paths provided",
		}
	}

	absPaths := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		absPaths = append(absPaths, abs)
	}

	if len(absPaths) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No valid paths in drop",
		}
	}

	if len(absPaths) == 1 {
		info, err := os.Stat(absPaths[0])
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Cannot access path: %v", err),
			}
		}
		folder := absPaths[0]
		if !info.IsDir() {
			folder = filepath.Dir(absPaths[0])
		}
		return map[string]interface{}{
			"success":    true,
			"folderPath": folder,
			"paths":      paths,
		}
	}

	dirs := make([]string, len(absPaths))
	for i, p := range absPaths {
		info, err := os.Stat(p)
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Cannot access %s: %v", p, err),
			}
		}
		if info.IsDir() {
			dirs[i] = p
		} else {
			dirs[i] = filepath.Dir(p)
		}
	}

	folder := dirs[0]
	for _, d := range dirs[1:] {
		folder = longestCommonPathPrefix(folder, d)
		if folder == "" {
			break
		}
	}
	if folder == "" {
		folder = dirs[0]
	}

	return map[string]interface{}{
		"success":    true,
		"folderPath": folder,
		"paths":      paths,
	}
}

// longestCommonPathPrefix returns the longest shared directory prefix for two absolute paths.
func longestCommonPathPrefix(a, b string) string {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if a == b {
		return a
	}

	sep := string(filepath.Separator)
	aParts := strings.Split(a, sep)
	bParts := strings.Split(b, sep)
	common := make([]string, 0, len(aParts))
	for i := 0; i < len(aParts) && i < len(bParts); i++ {
		if aParts[i] != bParts[i] {
			break
		}
		common = append(common, aParts[i])
	}
	if len(common) == 0 {
		return ""
	}
	prefix := filepath.Join(common...)
	if strings.HasPrefix(a, sep) && !strings.HasPrefix(prefix, sep) {
		prefix = sep + prefix
	}
	return prefix
}

// detectMimeType returns the MIME type based on file extension
func detectMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	mimeTypes := map[string]string{
		".html":  "text/html",
		".htm":   "text/html",
		".css":   "text/css",
		".js":    "application/javascript",
		".json":  "application/json",
		".svg":   "image/svg+xml",
		".png":   "image/png",
		".jpg":   "image/jpeg",
		".jpeg":  "image/jpeg",
		".gif":   "image/gif",
		".webp":  "image/webp",
		".woff":  "font/woff",
		".woff2": "font/woff2",
		".ttf":   "font/ttf",
		".ico":   "image/x-icon",
	}
	if mime, ok := mimeTypes[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}

// ================== BATCH UPLOAD (Folder Scanner) ==================

// FolderScanResult represents the result of scanning a folder
type FolderScanResult struct {
	Files       []ScannedFile `json:"files"`
	TotalFiles  int           `json:"totalFiles"`
	TotalSize   int64         `json:"totalSize"`
	TotalGas    uint64        `json:"totalGas"`
	FolderPath  string        `json:"folderPath"`
	Errors      []string      `json:"errors"`
}

// ScannedFile represents a file found during folder scanning
type ScannedFile struct {
	Name           string `json:"name"`
	Path           string `json:"path"`
	RelPath        string `json:"relPath"`
	SubDir         string `json:"subDir"`
	DocType        string `json:"docType"`
	Size           int64  `json:"size"`
	IsEntryPoint   bool   `json:"isEntryPoint"` // e.g., index.html
	CanCompress    bool   `json:"canCompress"`
	GasEstimate    uint64 `json:"gasEstimate"`
	ValidationWarn string `json:"validationWarn,omitempty"` // Warning about content issues
}

// ScanFolder recursively scans a folder for TELA deployment
func (a *App) ScanFolder(folderPath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DIR] Scanning folder for TELA deployment: %s", folderPath))

	// Validate folder exists
	info, err := os.Stat(folderPath)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Folder not found: %v", err),
		}
	}
	if !info.IsDir() {
		return map[string]interface{}{
			"success": false,
			"error":   "Path is not a directory",
		}
	}

	result := FolderScanResult{
		Files:      []ScannedFile{},
		FolderPath: folderPath,
		Errors:     []string{},
	}

	// Walk the folder
	err = filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Error accessing %s: %v", path, err))
			return nil // Continue walking
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Skip hidden files and common exclusions
		name := info.Name()
		if strings.HasPrefix(name, ".") || name == "Thumbs.db" || name == ".DS_Store" {
			return nil
		}

		// Calculate relative path and subDir
		relPath, _ := filepath.Rel(folderPath, path)
		subDir := filepath.Dir(relPath)
		if subDir == "." {
			subDir = "/"
		} else {
			subDir = "/" + filepath.ToSlash(subDir)
		}

		// Detect document type
		docType := tela.ParseDocType(name)

		// Check if this is an entry point
		isEntry := strings.ToLower(name) == "index.html" && (subDir == "/" || subDir == "")

		// Validate content for DVM compatibility (read file to check)
		var validationWarn string
		if data, readErr := os.ReadFile(path); readErr == nil {
			validationWarn = validateFileContent(data, name)
			if validationWarn != "" {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %s", name, validationWarn))
			}
		}

		file := ScannedFile{
			Name:           name,
			Path:           path,
			RelPath:        relPath,
			SubDir:         subDir,
			DocType:        docType,
			Size:           info.Size(),
			IsEntryPoint:   isEntry,
			CanCompress:    canCompress(docType),
			GasEstimate:    estimateGasCost(int(info.Size())),
			ValidationWarn: validationWarn,
		}

		result.Files = append(result.Files, file)
		result.TotalSize += info.Size()
		result.TotalGas += file.GasEstimate

		return nil
	})

	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("Walk error: %v", err))
	}

	result.TotalFiles = len(result.Files)

	a.logToConsole(fmt.Sprintf("[OK] Scanned %d files (%.2f KB, ~%d gas)", 
		result.TotalFiles, 
		float64(result.TotalSize)/1024, 
		result.TotalGas))

	return map[string]interface{}{
		"success":    true,
		"files":      result.Files,
		"totalFiles": result.TotalFiles,
		"totalSize":  result.TotalSize,
		"totalGas":   result.TotalGas,
		"folderPath": result.FolderPath,
		"errors":     result.Errors,
	}
}

// PreflightExpand scans a folder and returns an expanded deploy plan.
// When config.AutoShard is true, files exceeding the DOC size limit are split
// in-memory into shard DOCInfos. No files are written to disk.
//
// This endpoint is called by BatchUpload.svelte when the auto-shard toggle is on.
// It does NOT replace or modify ScanFolder — that path remains unchanged.
//
// configJSON must be a JSON string matching PreflightConfig:
//   {"autoShard": true, "compress": true, "indexDurl": "my-app.tela"}
func (a *App) PreflightExpand(folderPath, configJSON string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[DIR] PreflightExpand: scanning %s", folderPath))

	var config PreflightConfig
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return map[string]interface{}{"success": false, "error": "Invalid config JSON: " + err.Error()}
	}

	// Validate folder exists
	info, err := os.Stat(folderPath)
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("Folder not found: %v", err)}
	}
	if !info.IsDir() {
		return map[string]interface{}{"success": false, "error": "Path is not a directory"}
	}

	// Walk the folder and build DOCInfo slice — same filtering logic as ScanFolder.
	var files []DOCInfo
	var scanErrors []string

	err = filepath.Walk(folderPath, func(path string, fi os.FileInfo, walkErr error) error {
		if walkErr != nil {
			scanErrors = append(scanErrors, fmt.Sprintf("Error accessing %s: %v", path, walkErr))
			return nil
		}
		if fi.IsDir() {
			return nil
		}
		name := fi.Name()
		// Skip hidden files, build artifacts, and shard output directories
		if strings.HasPrefix(name, ".") || name == "Thumbs.db" || name == ".DS_Store" {
			return nil
		}
		// Skip hidden directories (e.g. .git, .doc-shards)
		rel, _ := filepath.Rel(folderPath, path)
		for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
			if strings.HasPrefix(part, ".") {
				return nil
			}
		}

		relPath, _ := filepath.Rel(folderPath, path)
		subDir := filepath.Dir(relPath)
		if subDir == "." {
			subDir = "/"
		} else {
			subDir = "/" + filepath.ToSlash(subDir)
		}

		docType := tela.ParseDocType(name)
		files = append(files, DOCInfo{
			Name:    name,
			Path:    path,
			SubDir:  subDir,
			DocType: docType,
			Size:    fi.Size(),
		})
		return nil
	})
	if err != nil {
		scanErrors = append(scanErrors, fmt.Sprintf("Walk error: %v", err))
	}

	if len(files) == 0 {
		return map[string]interface{}{
			"success": false,
			"error":   "No deployable files found in folder",
			"errors":  scanErrors,
		}
	}

	expansion, err := a.buildPreflightExpansion(files, config)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error(), "errors": scanErrors}
	}

	a.logToConsole(fmt.Sprintf("[OK] PreflightExpand: %d source files → %d deploy DOCs (%d shards, ~%d gas)",
		expansion.Summary.SourceFileCount,
		expansion.Summary.DeployDocCount,
		expansion.Summary.ShardCount,
		expansion.Summary.EstimatedGas,
	))

	return map[string]interface{}{
		"success":     true,
		"deployFiles": expansion.DeployFiles,
		"shardGroups": expansion.ShardGroups,
		"warnings":    expansion.Warnings,
		"summary":     expansion.Summary,
		"errors":      scanErrors,
	}
}

// GenerateSubDirs generates subDir paths from a list of files
func (a *App) GenerateSubDirs(folderPath string, filesJSON string) map[string]interface{} {
	// Parse files array
	var files []map[string]interface{}
	if err := json.Unmarshal([]byte(filesJSON), &files); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid files JSON",
		}
	}

	// Generate subDirs
	result := []map[string]interface{}{}
	for _, f := range files {
		path, ok := f["path"].(string)
		if !ok {
			continue
		}

		relPath, _ := filepath.Rel(folderPath, path)
		subDir := filepath.Dir(relPath)
		if subDir == "." {
			subDir = "/"
		} else {
			subDir = "/" + filepath.ToSlash(subDir)
		}

		f["subDir"] = subDir
		result = append(result, f)
	}

	return map[string]interface{}{
		"success": true,
		"files":   result,
	}
}

// DetectDocTypes updates doc types for a list of files
func (a *App) DetectDocTypes(filesJSON string) map[string]interface{} {
	var files []map[string]interface{}
	if err := json.Unmarshal([]byte(filesJSON), &files); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid files JSON",
		}
	}

	for i := range files {
		if name, ok := files[i]["name"].(string); ok {
			files[i]["docType"] = tela.ParseDocType(name)
		}
	}

	return map[string]interface{}{
		"success": true,
		"files":   files,
	}
}

// EstimateBatchGas calculates total gas for a batch of files
func (a *App) EstimateBatchGas(filesJSON string) map[string]interface{} {
	var files []map[string]interface{}
	if err := json.Unmarshal([]byte(filesJSON), &files); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Invalid files JSON",
		}
	}

	var totalGas uint64
	var totalSize int64

	for _, f := range files {
		size, ok := f["size"].(float64)
		if ok {
			totalSize += int64(size)
			totalGas += estimateGasCost(int(size))
		}
	}

	// Add INDEX creation cost
	indexGas := uint64(10000) // Base cost for INDEX

	return map[string]interface{}{
		"success":   true,
		"docsGas":   totalGas,
		"indexGas":  indexGas,
		"totalGas":  totalGas + indexGas,
		"totalSize": totalSize,
		"fileCount": len(files),
	}
}

// Helper functions

func extractCode(result interface{}) string {
	if resultMap, ok := result.(map[string]interface{}); ok {
		if code, ok := resultMap["code"].(string); ok {
			return code
		}
	}
	return ""
}

// DiffLine represents a single line difference
type DiffLine struct {
	LineNum int    `json:"lineNum"`
	Type    string `json:"type"` // "add", "remove", "change"
	Old     string `json:"old,omitempty"`
	New     string `json:"new,omitempty"`
}

func computeLineDiff(lines1, lines2 []string) []DiffLine {
	diffs := []DiffLine{}

	// Simple line-by-line comparison
	// For more sophisticated diff, use a proper diff library
	maxLen := len(lines1)
	if len(lines2) > maxLen {
		maxLen = len(lines2)
	}

	for i := 0; i < maxLen; i++ {
		var line1, line2 string
		
		if i < len(lines1) {
			line1 = lines1[i]
		}
		if i < len(lines2) {
			line2 = lines2[i]
		}

		if line1 != line2 {
			diff := DiffLine{
				LineNum: i + 1,
			}
			
			if line1 == "" {
				diff.Type = "add"
				diff.New = line2
			} else if line2 == "" {
				diff.Type = "remove"
				diff.Old = line1
			} else {
				diff.Type = "change"
				diff.Old = line1
				diff.New = line2
			}
			
			diffs = append(diffs, diff)
		}
	}

	return diffs
}

// SaveBinaryFileWithDialog opens a native save dialog and writes binary content (base64 encoded) to the selected file
// This is used for saving images, PDFs, and other binary files from TELA apps
// The content parameter should be base64-encoded binary data
func (a *App) SaveBinaryFileWithDialog(defaultFilename string, base64Content string, filterName string, filterPattern string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[FILE] SaveBinaryFileWithDialog: %s", defaultFilename))
	
	// Decode base64 content
	// Handle data URL format (e.g., "data:image/png;base64,...")
	content := base64Content
	if strings.Contains(content, ",") {
		parts := strings.SplitN(content, ",", 2)
		if len(parts) == 2 {
			content = parts[1]
		}
	}
	
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to decode base64 content: %v", err),
		}
	}

	// Open native save dialog
	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Save File",
		Filters: []runtime.FileFilter{
			{
				DisplayName: filterName,
				Pattern:     filterPattern,
			},
		},
	})

	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Save dialog error: %v", err),
		}
	}

	// User cancelled
	if savePath == "" {
		return map[string]interface{}{
			"success":   false,
			"cancelled": true,
			"error":     "Save cancelled by user",
		}
	}

	// Write the binary file
	err = os.WriteFile(savePath, data, 0644)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to write file: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Saved binary file to: %s (%d bytes)", savePath, len(data)))

	return map[string]interface{}{
		"success": true,
		"path":    savePath,
		"size":    len(data),
	}
}

// SaveFileWithDialog opens a native save dialog and writes content to the selected file
// Returns the path where the file was saved, or an error
func (a *App) SaveFileWithDialog(defaultFilename string, content string, filterName string, filterPattern string) map[string]interface{} {
	// Open native save dialog
	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Save File",
		Filters: []runtime.FileFilter{
			{
				DisplayName: filterName,
				Pattern:     filterPattern,
			},
		},
	})

	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Save dialog error: %v", err),
		}
	}

	// User cancelled
	if savePath == "" {
		return map[string]interface{}{
			"success":   false,
			"cancelled": true,
			"error":     "Save cancelled by user",
		}
	}

	// Write the file
	err = os.WriteFile(savePath, []byte(content), 0644)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to write file: %v", err),
		}
	}

	a.logToConsole(fmt.Sprintf("[FILE] Saved file to: %s", savePath))

	return map[string]interface{}{
		"success": true,
		"path":    savePath,
	}
}

// GetMetadataFiles reads metadata files from a folder for auto-inference of TELA app properties.
// Returns content of package.json, index.html, and README.md (if they exist) for frontend parsing.
func (a *App) GetMetadataFiles(folderPath string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[META] Reading metadata files from: %s", folderPath))

	result := map[string]interface{}{
		"success":     true,
		"folderPath":  folderPath,
		"packageJson": "",
		"indexHtml":   "",
		"readme":      "",
	}

	// Read package.json if it exists
	packagePath := filepath.Join(folderPath, "package.json")
	if data, err := os.ReadFile(packagePath); err == nil {
		result["packageJson"] = string(data)
		a.logToConsole("[META] Found package.json")
	}

	// Read index.html if it exists
	indexPath := filepath.Join(folderPath, "index.html")
	if data, err := os.ReadFile(indexPath); err == nil {
		result["indexHtml"] = string(data)
		a.logToConsole("[META] Found index.html")
	}

	// Read README.md or README.txt if they exist (try .md first)
	readmePath := filepath.Join(folderPath, "README.md")
	if data, err := os.ReadFile(readmePath); err == nil {
		result["readme"] = string(data)
		a.logToConsole("[META] Found README.md")
	} else {
		// Fallback to README.txt
		readmePath = filepath.Join(folderPath, "README.txt")
		if data, err := os.ReadFile(readmePath); err == nil {
			result["readme"] = string(data)
			a.logToConsole("[META] Found README.txt")
		}
	}

	return result
}

