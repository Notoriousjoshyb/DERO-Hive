package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TELAContent represents assembled TELA application content
type TELAContent struct {
	HTML         string
	CSS          []string
	JS           []string
	CSSByName    map[string]string // filename -> CSS content for external reference replacement
	JSByName     map[string]string // filename -> JS content for external reference replacement
	StaticByName map[string]string // filename -> static file content (SVG, images as data URIs, etc.)
	Meta         map[string]interface{}
	SCIDs        map[string]string // filename -> SCID mapping
	Files        []DocFile         // raw files extracted from DOCs
}

// DocFile represents a single extracted file from a DOC contract
type DocFile struct {
	Name    string
	Content string
	DocType string
}

// FetchTELAContent fetches and assembles TELA content from the blockchain
// It auto-detects whether the SCID is a DOC (single file) or INDEX (multi-file bundle)
func (a *App) FetchTELAContent(scid string) (*TELAContent, error) {
	a.logToConsole(fmt.Sprintf("[PKG] Fetching smart contract: %s", scid))

	// Fetch the smart contract
	scData, err := a.fetchSmartContract(scid, true, true)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch SC: %w", err)
	}

	a.logToConsole("[OK] Smart contract fetched successfully")

	// Detect if this is a DOC or INDEX by checking for docType vs DOC1.
	// Simulator GetSC can omit DOC stringkeys while still returning valid code.
	stringKeys, hasStringKeys := scData["stringkeys"].(map[string]interface{})
	if !hasStringKeys {
		if code, ok := scData["code"].(string); ok {
			fallbackMeta := extractDOCMetadataFromCode(code)
			if fallbackMeta.FileName != "" && fallbackMeta.DocType != "" {
				a.logToConsole("[FALLBACK] No stringkeys on root contract; treating as standalone DOC from code metadata")
				return a.fetchSingleDOC(scid, scData)
			}
		}
		return nil, fmt.Errorf("invalid TELA contract: no stringkeys")
	}

	// Check for DOC indicators (docType key means it's a DOC)
	_, hasDocType := stringKeys["docType"]
	// Check for INDEX indicators (DOC1 key means it's an INDEX)
	_, hasDOC1 := stringKeys["DOC1"]

	// If it has docType but no DOC1, it's a standalone DOC - render directly
	if hasDocType && !hasDOC1 {
		a.logToConsole("[DOC] Detected standalone DOC contract - rendering directly")
		return a.fetchSingleDOC(scid, scData)
	}

	// Otherwise, treat as INDEX and fetch referenced DOCs
	a.logToConsole("[INDEX] Detected INDEX contract - fetching DOCs")

	// Parse INDEX to get DOC SCIDs
	docSCIDs := extractDOCsSCIDs(scData)
	if len(docSCIDs) == 0 {
		// Maybe it's a DOC after all (some contracts may have weird structures)
		if hasDocType {
			a.logToConsole("[FALLBACK] No DOC refs found but has docType - trying as DOC")
			return a.fetchSingleDOC(scid, scData)
		}
		a.logToConsole("  [WARN]  No DOC contracts found - check the response structure above")
		return nil, fmt.Errorf("no DOC contracts found in INDEX")
	}

	a.logToConsole(fmt.Sprintf("[INDEX] Found %d DOC contracts", len(docSCIDs)))

	// Fetch all DOC contracts
	content := &TELAContent{
		CSS:   make([]string, 0),
		JS:    make([]string, 0),
		Meta:  make(map[string]interface{}),
		SCIDs: make(map[string]string),
		Files: make([]DocFile, 0),
	}

	// Extract INDEX metadata from stringkeys (hex-encoded)
	// Note: stringKeys was already extracted above for DOC/INDEX detection
	// TELA V2 uses "var_header_*" keys, V1 uses "*Hdr" keys
	if nameHex, ok := stringKeys["var_header_name"].(string); ok {
		content.Meta["name"] = decodeHexString(nameHex)
	} else if nameHex, ok := stringKeys["nameHdr"].(string); ok {
		content.Meta["name"] = decodeHexString(nameHex)
	}
	if descrHex, ok := stringKeys["var_header_description"].(string); ok {
		content.Meta["description"] = decodeHexString(descrHex)
	} else if descrHex, ok := stringKeys["descrHdr"].(string); ok {
		content.Meta["description"] = decodeHexString(descrHex)
	}
	if durlHex, ok := stringKeys["dURL"].(string); ok {
		content.Meta["durl"] = decodeHexString(durlHex)
	}

	// Fetch all DOCs in parallel for better performance
	type docResult struct {
		index int
		scid  string
		data  map[string]interface{}
		err   error
	}

	a.logToConsole(fmt.Sprintf("[DOC] Fetching %d DOCs in parallel...", len(docSCIDs)))

	results := make(chan docResult, len(docSCIDs))
	for i, docSCID := range docSCIDs {
		go func(idx int, scid string) {
			data, err := a.fetchSmartContract(scid, true, true)
			results <- docResult{index: idx, scid: scid, data: data, err: err}
		}(i, docSCID)
	}

	// Collect results and process in order
	docDataList := make([]map[string]interface{}, len(docSCIDs))
	for range docSCIDs {
		r := <-results
		if r.err != nil {
			a.logToConsole(fmt.Sprintf("  [WARN]  Failed to fetch DOC %d (%s...): %v", r.index+1, r.scid[:16], r.err))
			continue
		}
		docDataList[r.index] = r.data
		a.logToConsole(fmt.Sprintf("  OK Fetched DOC %d/%d: %s...", r.index+1, len(docSCIDs), r.scid[:16]))
	}

	// Process DOCs in order, with retry for failed ones
	failedDOCs := make([]int, 0)
	for i, docData := range docDataList {
		if docData == nil {
			continue // Skip failed fetches
		}
		// Add SCID to docData so processDOC can access it
		docData["scid"] = docSCIDs[i]
		if err := a.processDOC(docData, content); err != nil {
			a.logToConsole(fmt.Sprintf("  [WARN]  Failed to process DOC %d: %v", i+1, err))
			failedDOCs = append(failedDOCs, i)
			continue
		}
	}

	// Retry failed DOCs with a delay (blockchain propagation issue)
	if len(failedDOCs) > 0 {
		a.logToConsole(fmt.Sprintf("[RETRY] %d DOCs failed, retrying after 2s delay (blockchain propagation)...", len(failedDOCs)))
		time.Sleep(2 * time.Second)

		for _, i := range failedDOCs {
			scid := docSCIDs[i]
			a.logToConsole(fmt.Sprintf("  [RETRY] Re-fetching DOC %d: %s...", i+1, truncateSCID(scid, 16)))

			// Re-fetch the DOC
			data, err := a.fetchSmartContract(scid, true, true)
			if err != nil {
				a.logToConsole(fmt.Sprintf("  [ERR] Retry fetch failed for DOC %d: %v", i+1, err))
				continue
			}

			// Add SCID to data so processDOC can access it
			data["scid"] = scid

			// Try to process again
			if err := a.processDOC(data, content); err != nil {
				a.logToConsole(fmt.Sprintf("  [ERR] Retry process failed for DOC %d: %v", i+1, err))
			} else {
				a.logToConsole(fmt.Sprintf("  [OK] DOC %d processed successfully on retry", i+1))
			}
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Processed %d DOCs total", len(docSCIDs)))

	// Reassemble shard chunks before HTML assembly.
	// Shard chunks (e.g., img.png-1.gz, img.png-2.gz) are raw slices of a larger
	// gzip stream. They must be concatenated in order, then decompressed as one.
	a.reassembleShardChunks(content)

	// Check if we got at least HTML
	if content.HTML == "" {
		// Attempt shard assembly if this is a shard index dURL
		if du, ok := content.Meta["durl"].(string); ok && isEmbeddedShardsINDEX(du) {
			a.logToConsole("[LINK] Shard index detected; assembling shard files")
			assembled := assembleShardFiles(content)
			if assembled != "" {
				content.HTML = assembled
			}
		}

		// Fallback: if we have static text files but no HTML, render them as a document
		if content.HTML == "" && len(content.StaticByName) > 0 {
			for fileName, fileContent := range content.StaticByName {
				if isTextBasedFile(fileName) {
					scid := content.SCIDs[fileName]
					a.logToConsole(fmt.Sprintf("[FALLBACK] Rendering static text file %s as document", fileName))
					content.HTML = renderTextViewer(fileName, fileContent, scid)
					break // Use the first text file found
				}
			}
		}

		if content.HTML == "" {
			a.logToConsole("[ERR] No HTML content found in any DOC")
			return nil, fmt.Errorf("no HTML content found")
		}
	}

	// Assemble final HTML (except library view).
	// IMPORTANT: DocShards still require final assembly so external references like
	// <link href="styles.css"> and <img src="img/img.png"> are inlined for srcdoc mode.
	duStr, hasDU := content.Meta["durl"].(string)
	if hasDU && isLibraryDURL(duStr) {
		a.logToConsole("[TELA] Library dURL detected; rendering library info view")
		content.HTML = renderLibraryInfo(content)
	} else {
		a.logToConsole("[TELA] Assembling final HTML...")
		if err := a.assembleFinalHTML(content); err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Assembly failed: %v", err))
			return nil, err
		}
	}

	a.logToConsole("[OK] HTML assembly complete!")
	return content, nil
}

// isShardIndexDURL returns true if the dURL ends with .tela.shards (embedded shard INDEX)
func isShardIndexDURL(durl string) bool {
	s := strings.ToLower(strings.TrimSpace(durl))
	return strings.HasSuffix(s, ".tela.shards")
}

// isEmbeddedINDEX returns true if the contract is an INDEX (not a DOC)
// by checking for telaVersion or DOC1 keys in stringkeys
func isEmbeddedINDEX(stringKeys map[string]interface{}) bool {
	if stringKeys == nil {
		return false
	}
	_, hasTelaVersion := stringKeys["telaVersion"]
	_, hasDOC1 := stringKeys["DOC1"]
	return hasTelaVersion || hasDOC1
}

// truncateSCID safely truncates a SCID for logging (prevents slice bounds panic)
func truncateSCID(scid string, maxLen int) string {
	if len(scid) <= maxLen {
		return scid
	}
	return scid[:maxLen]
}

// isShardChunkName returns true if the filename matches the shard naming pattern
// (e.g., "img.png-1.gz", "rive.js-3.gz") produced by expandFileToShards.
var shardChunkRe = regexp.MustCompile(`^(.+)-(\d+)(\.\w+)$`)

func isShardChunkName(fileName string) bool {
	return shardChunkRe.MatchString(fileName)
}

// parseShardChunkName extracts the original base+ext, shard index, and outer extension.
// For "img.png-2.gz" it returns ("img.png", 2, ".gz", true).
func parseShardChunkName(fileName string) (baseName string, index int, ext string, ok bool) {
	m := shardChunkRe.FindStringSubmatch(fileName)
	if m == nil {
		return "", 0, "", false
	}
	idx, err := strconv.Atoi(m[2])
	if err != nil {
		return "", 0, "", false
	}
	return m[1], idx, m[3], true
}

// reassembleShardChunks scans StaticByName for shard chunks, concatenates them
// in order, decompresses the result, and stores the reassembled file under the
// original filename. Individual chunk entries are removed.
func (a *App) reassembleShardChunks(content *TELAContent) {
	if content.StaticByName == nil {
		return
	}

	type chunk struct {
		index   int
		content string
	}
	groups := map[string][]chunk{}

	for name, data := range content.StaticByName {
		baseName, idx, ext, ok := parseShardChunkName(name)
		if !ok {
			continue
		}
		// Auto-shard chunks are expected to be gzip/base64 payload parts (*.gz).
		// Skip non-gz names so we don't attempt gzip reassembly on plain-text shards.
		if ext != ".gz" {
			continue
		}
		groups[baseName] = append(groups[baseName], chunk{index: idx, content: data})
	}

	if len(groups) == 0 {
		return
	}

	for baseName, chunks := range groups {
		sort.Slice(chunks, func(i, j int) bool { return chunks[i].index < chunks[j].index })

		var combinedBase64 strings.Builder
		for _, c := range chunks {
			combinedBase64.WriteString(c.content)
		}

		combinedRaw, err := base64.StdEncoding.DecodeString(combinedBase64.String())
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Shard reassembly base64 decode failed for %s: %v — storing raw", baseName, err))
			content.StaticByName[baseName] = combinedBase64.String()
			continue
		}

		reader, err := gzip.NewReader(bytes.NewReader(combinedRaw))
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Shard reassembly gzip open failed for %s: %v — storing raw", baseName, err))
			content.StaticByName[baseName] = base64.StdEncoding.EncodeToString(combinedRaw)
		} else {
			decompressed, err := io.ReadAll(reader)
			reader.Close()
			if err != nil {
				a.logToConsole(fmt.Sprintf("[WARN] Shard reassembly gzip read failed for %s: %v — storing raw", baseName, err))
				content.StaticByName[baseName] = base64.StdEncoding.EncodeToString(combinedRaw)
			} else {
				content.StaticByName[baseName] = string(decompressed)
				a.logToConsole(fmt.Sprintf("[OK] Reassembled %d shard chunks → %s (%d bytes)", len(chunks), baseName, len(decompressed)))
			}
		}

		// Remove individual chunk entries
		for _, c := range chunks {
			for name := range content.StaticByName {
				bn, idx, _, ok := parseShardChunkName(name)
				if ok && bn == baseName && idx == c.index {
					delete(content.StaticByName, name)
				}
			}
		}
	}
}

// isLibraryDURL returns true if the dURL ends with .tela.lib (TELA library INDEX)
func isLibraryDURL(durl string) bool {
	s := strings.ToLower(strings.TrimSpace(durl))
	return strings.HasSuffix(s, ".tela.lib")
}

// isEmbeddedShardsINDEX returns true if the dURL ends with .shards (embedded shard INDEX)
// This is used for detecting embedded INDEX contracts like rive.wasm-2.35.3.shards
func isEmbeddedShardsINDEX(durl string) bool {
	s := strings.ToLower(strings.TrimSpace(durl))
	return strings.HasSuffix(s, ".shards")
}

// fetchSingleDOC renders a standalone DOC contract directly (not part of an INDEX)
// This is used when a user pastes a DOC SCID directly into the browser
func (a *App) fetchSingleDOC(scid string, docData map[string]interface{}) (*TELAContent, error) {
	content := &TELAContent{
		CSS:       make([]string, 0),
		JS:        make([]string, 0),
		Meta:      make(map[string]interface{}),
		SCIDs:     make(map[string]string),
		Files:     make([]DocFile, 0),
		CSSByName: make(map[string]string),
		JSByName:  make(map[string]string),
	}

	code, ok := docData["code"].(string)
	if !ok {
		return nil, fmt.Errorf("no code in DOC contract")
	}
	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("empty code in DOC contract")
	}

	stringKeys, ok := docData["stringkeys"].(map[string]interface{})
	fallbackMeta := extractDOCMetadataFromCode(code)
	if !ok && (fallbackMeta.FileName == "" || fallbackMeta.DocType == "") {
		return nil, fmt.Errorf("no stringkeys in DOC contract")
	}

	// Extract DOC metadata
	// TELA V2 uses "var_header_*" keys, V1 uses "*Hdr" keys
	docType := fallbackMeta.DocType
	if docTypeHex, ok := stringKeys["docType"].(string); ok {
		docType = decodeHexString(docTypeHex)
	}

	fileName := fallbackMeta.FileName
	if fileName == "" {
		fileName = "document"
	}
	if fileNameHex, ok := stringKeys["var_header_name"].(string); ok {
		fileName = decodeHexString(fileNameHex)
	} else if fileNameHex, ok := stringKeys["nameHdr"].(string); ok {
		fileName = decodeHexString(fileNameHex)
	}

	// Extract optional metadata
	if descrHex, ok := stringKeys["var_header_description"].(string); ok {
		content.Meta["description"] = decodeHexString(descrHex)
	} else if descrHex, ok := stringKeys["descrHdr"].(string); ok {
		content.Meta["description"] = decodeHexString(descrHex)
	}
	if durlHex, ok := stringKeys["dURL"].(string); ok {
		content.Meta["durl"] = decodeHexString(durlHex)
	} else if fallbackMeta.DURL != "" {
		content.Meta["durl"] = fallbackMeta.DURL
	}
	content.Meta["name"] = fileName
	content.Meta["docType"] = docType
	content.Meta["scid"] = scid

	// Extract file content from smart contract comment block
	fileContent := extractFileContentFromCode(code)
	if fileContent == "" {
		return nil, fmt.Errorf("could not extract file content from DOC")
	}

	// Handle gzip compression if filename ends with .gz
	if strings.HasSuffix(fileName, ".gz") {
		a.logToConsole(fmt.Sprintf("[DOC] Decompressing %s (%d bytes compressed)", fileName, len(fileContent)))
		decompressed, err := decompressGzip(fileContent)
		if err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] Gzip decompression failed: %v - using raw content", err))
		} else {
			fileContent = decompressed
			fileName = strings.TrimSuffix(fileName, ".gz")
			a.logToConsole(fmt.Sprintf("[DOC] Decompressed to %s (%d bytes)", fileName, len(fileContent)))
		}
	}

	a.logToConsole(fmt.Sprintf("[DOC] Extracted: %s (%s, %d bytes)", fileName, docType, len(fileContent)))

	// Store the file
	content.Files = append(content.Files, DocFile{
		Name:    fileName,
		Content: fileContent,
		DocType: docType,
	})
	content.SCIDs[fileName] = scid

	// Route content based on docType
	switch {
	case strings.HasPrefix(docType, "TELA-HTML"):
		// HTML document - render directly
		content.HTML = fileContent
		a.logToConsole("[DOC] Rendering HTML document directly")

	case strings.HasPrefix(docType, "TELA-CSS"):
		// CSS file - wrap in simple HTML viewer
		content.HTML = renderCSSViewer(fileName, fileContent, scid)
		a.logToConsole("[DOC] Rendering CSS viewer")

	case strings.HasPrefix(docType, "TELA-JS"):
		// JS file - wrap in simple HTML viewer
		content.HTML = renderJSViewer(fileName, fileContent, scid)
		a.logToConsole("[DOC] Rendering JS viewer")

	case strings.HasPrefix(docType, "TELA-MD"):
		// Markdown - render as preformatted text (could enhance with MD parser later)
		content.HTML = renderMarkdownViewer(fileName, fileContent, scid)
		a.logToConsole("[DOC] Rendering Markdown viewer")

	default:
		// Unknown type - try to render as HTML, or show as code
		if strings.Contains(strings.ToLower(fileName), ".html") || strings.Contains(strings.ToLower(fileName), ".htm") {
			content.HTML = fileContent
			a.logToConsole("[DOC] Assuming HTML based on filename")
		} else {
			// Show as code viewer
			content.HTML = renderCodeViewer(fileName, docType, fileContent, scid)
			a.logToConsole("[DOC] Rendering code viewer for unknown type")
		}
	}

	a.logToConsole("[OK] Single DOC rendered successfully!")
	return content, nil
}

// renderCSSViewer creates an HTML page displaying CSS content
func renderCSSViewer(fileName, content, scid string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a12; color: #e8e8f0; padding: 24px; margin: 0; }
.header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
h1 { font-size: 1.5rem; margin: 0 0 8px 0; color: #22d3ee; }
.meta { font-size: 12px; color: #707088; font-family: monospace; }
.scid { color: #a78bfa; }
pre { background: #12121c; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
code { color: #34d399; }
</style>
</head><body>
<div class="header">
<h1>[File] %s</h1>
<div class="meta">Type: CSS Stylesheet</div>
<div class="meta">SCID: <span class="scid">%s</span></div>
</div>
<pre><code>%s</code></pre>
</body></html>`, htmlEscape(fileName), htmlEscape(scid), htmlEscape(content))
}

// renderJSViewer creates an HTML page displaying JavaScript content
func renderJSViewer(fileName, content, scid string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a12; color: #e8e8f0; padding: 24px; margin: 0; }
.header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
h1 { font-size: 1.5rem; margin: 0 0 8px 0; color: #fbbf24; }
.meta { font-size: 12px; color: #707088; font-family: monospace; }
.scid { color: #a78bfa; }
pre { background: #12121c; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
code { color: #fbbf24; }
</style>
</head><body>
<div class="header">
<h1>%s</h1>
<div class="meta">Type: JavaScript</div>
<div class="meta">SCID: <span class="scid">%s</span></div>
</div>
<pre><code>%s</code></pre>
</body></html>`, htmlEscape(fileName), htmlEscape(scid), htmlEscape(content))
}

// renderMarkdownViewer creates an HTML page displaying Markdown content
func renderMarkdownViewer(fileName, content, scid string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a12; color: #e8e8f0; padding: 24px; margin: 0; }
.header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
h1 { font-size: 1.5rem; margin: 0 0 8px 0; color: #a78bfa; }
.meta { font-size: 12px; color: #707088; font-family: monospace; }
.scid { color: #a78bfa; }
pre { background: #12121c; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
</style>
</head><body>
<div class="header">
<h1>%s</h1>
<div class="meta">Type: Markdown</div>
<div class="meta">SCID: <span class="scid">%s</span></div>
</div>
<pre>%s</pre>
</body></html>`, htmlEscape(fileName), htmlEscape(scid), htmlEscape(content))
}

// renderCodeViewer creates an HTML page displaying generic code content
func renderCodeViewer(fileName, docType, content, scid string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a12; color: #e8e8f0; padding: 24px; margin: 0; }
.header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
h1 { font-size: 1.5rem; margin: 0 0 8px 0; color: #22d3ee; }
.meta { font-size: 12px; color: #707088; font-family: monospace; }
.scid { color: #a78bfa; }
pre { background: #12121c; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
code { color: #e8e8f0; }
</style>
</head><body>
<div class="header">
<h1>%s</h1>
<div class="meta">Type: %s</div>
<div class="meta">SCID: <span class="scid">%s</span></div>
</div>
<pre><code>%s</code></pre>
</body></html>`, htmlEscape(fileName), htmlEscape(docType), htmlEscape(scid), htmlEscape(content))
}

// renderTextViewer creates an HTML page displaying plain text content (like .txt files)
// This provides a clean reading experience for text documents stored on the blockchain
func renderTextViewer(fileName, content, scid string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { box-sizing: border-box; }
body { 
  font-family: 'Georgia', 'Times New Roman', serif; 
  background: #0a0a12; 
  color: #e8e8f0; 
  padding: 32px; 
  margin: 0; 
  line-height: 1.8;
  max-width: 800px;
  margin: 0 auto;
}
.header { 
  margin-bottom: 32px; 
  padding-bottom: 20px; 
  border-bottom: 1px solid rgba(255,255,255,0.1); 
}
h1 { 
  font-size: 1.5rem; 
  margin: 0 0 12px 0; 
  color: #22d3ee; 
  font-family: system-ui, -apple-system, sans-serif;
}
.meta { 
  font-size: 11px; 
  color: #707088; 
  font-family: monospace; 
}
.scid { color: #a78bfa; }
.content { 
  white-space: pre-wrap; 
  word-wrap: break-word;
  font-size: 15px;
  color: #d8d8e8;
  background: transparent;
}
</style>
</head><body>
<div class="header">
<h1>%s</h1>
<div class="meta">SCID: <span class="scid">%s</span></div>
</div>
<div class="content">%s</div>
</body></html>`, htmlEscape(fileName), htmlEscape(scid), htmlEscape(content))
}

// isTextBasedFile returns true if the filename suggests a text-based (non-binary) file
// This is used to determine if TELA-STATIC files should be rendered as readable text
func isTextBasedFile(fileName string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	textExtensions := map[string]bool{
		".txt":          true,
		".text":         true,
		".log":          true,
		".csv":          true,
		".xml":          true,
		".yaml":         true,
		".yml":          true,
		".toml":         true,
		".ini":          true,
		".cfg":          true,
		".conf":         true,
		".sh":           true,
		".bash":         true,
		".zsh":          true,
		".bat":          true,
		".ps1":          true,
		".sql":          true,
		".env":          true,
		".gitignore":    true,
		".editorconfig": true,
	}
	// Also check for files without extensions that are commonly text
	if ext == "" {
		baseName := strings.ToLower(filepath.Base(fileName))
		textFiles := map[string]bool{
			"readme":       true,
			"license":      true,
			"changelog":    true,
			"authors":      true,
			"contributing": true,
			"makefile":     true,
			"dockerfile":   true,
		}
		return textFiles[baseName]
	}
	return textExtensions[ext]
}

// isHTMLFile returns true if the filename suggests an HTML file
// This is used to detect HTML files that are stored with TELA-STATIC docType
func isHTMLFile(fileName string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	htmlExtensions := map[string]bool{
		".html":  true,
		".htm":   true,
		".xhtml": true,
	}
	return htmlExtensions[ext]
}

// assembleShardFiles concatenates shard file contents in DOC order into a simple HTML wrapper
func assembleShardFiles(content *TELAContent) string {
	if content == nil || len(content.Files) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("<html><head>")
	// inject any CSS gathered
	if len(content.CSS) > 0 {
		b.WriteString("<style>\n")
		for _, c := range content.CSS {
			b.WriteString(c)
			b.WriteString("\n")
		}
		b.WriteString("</style>")
	}
	b.WriteString("</head><body>")
	// naive concatenation in fetched order
	for _, f := range content.Files {
		if f.DocType == "TELA-HTML-1" || strings.HasPrefix(f.DocType, "TELA-HTML") || f.DocType == "" {
			b.WriteString(f.Content)
			b.WriteString("\n")
		}
	}
	// inject any JS at bottom
	if len(content.JS) > 0 {
		b.WriteString("<script>\n")
		for _, j := range content.JS {
			b.WriteString(j)
			b.WriteString("\n")
		}
		b.WriteString("</script>")
	}
	b.WriteString("</body></html>")
	return b.String()
}

// renderLibraryInfo returns a simple HTML describing the library contents
func renderLibraryInfo(content *TELAContent) string {
	var b strings.Builder
	b.WriteString("<html><head><style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b0b0b;color:#ddd;padding:24px} table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border:1px solid #333;padding:8px;text-align:left} th{background:#131313} code{color:#9cd} h1{margin:0 0 6px 0} .meta{color:#aaa;margin-top:4px}</style></head><body>")
	name := "Library"
	if v, ok := content.Meta["name"].(string); ok && v != "" {
		name = v
	}
	durl := ""
	if v, ok := content.Meta["durl"].(string); ok {
		durl = v
	}
	descr := ""
	if v, ok := content.Meta["description"].(string); ok {
		descr = v
	}
	b.WriteString("<h1>" + htmlEscape(name) + "</h1>")
	if durl != "" {
		b.WriteString("<div class=\"meta\"><strong>dURL:</strong> <code>" + htmlEscape(durl) + "</code></div>")
	}
	if descr != "" {
		b.WriteString("<div class=\"meta\">" + htmlEscape(descr) + "</div>")
	}
	b.WriteString("<table><thead><tr><th>File</th><th>Type</th><th>SCID</th></tr></thead><tbody>")
	for _, f := range content.Files {
		sc := content.SCIDs[f.Name]
		b.WriteString("<tr><td>" + htmlEscape(f.Name) + "</td><td><code>" + htmlEscape(f.DocType) + "</code></td><td><code>" + htmlEscape(sc) + "</code></td></tr>")
	}
	b.WriteString("</tbody></table>")
	b.WriteString("</body></html>")
	return b.String()
}

// htmlEscape minimal escape
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

// fetchSmartContract fetches a smart contract from the blockchain
func (a *App) fetchSmartContract(scid string, code, variables bool) (map[string]interface{}, error) {
	a.logToConsole(fmt.Sprintf("  [NET] Calling DERO.GetSC (direct daemon): scid=%s..., code=%v, variables=%v", scid[:16], code, variables))

	// Use direct daemon connection instead of XSWD
	result, err := a.daemonClient.GetSC(scid, code, variables)
	if err != nil {
		a.logToConsole(fmt.Sprintf("  [ERR] DERO.GetSC failed: %v", err))
		return nil, fmt.Errorf("GetSC failed: %w", err)
	}

	a.logToConsole("  [OK] DERO.GetSC returned data successfully")

	return result, nil
}

// extractDOCsSCIDs extracts DOC SCIDs from INDEX contract CODE (not variables).
// IMPORTANT: When an INDEX is updated via UpdateCode(), the CODE contains the new DOC SCIDs,
// but the stored variables (stringkeys) retain the OLD values from initial deployment.
// The TELA library's Clone function parses the CODE, so we must do the same.
func extractDOCsSCIDs(indexData map[string]interface{}) []string {
	scids := make([]string, 0)

	// First, try to extract from CODE (this is what tela.Clone does)
	code, hasCode := indexData["code"].(string)
	if hasCode && code != "" {
		log.Println("  [TELA] Extracting DOC SCIDs from smart contract CODE...")

		// Parse STORE("DOCx", "scid") patterns from the code
		// Pattern: STORE("DOC1", "64-char-hex-scid")
		docPattern := regexp.MustCompile(`STORE\("(DOC\d+)",\s*"([a-f0-9]{64})"\)`)
		matches := docPattern.FindAllStringSubmatch(code, -1)

		// Build a map to handle DOC ordering (DOC1, DOC2, etc.)
		docMap := make(map[int]string)
		maxDoc := 0

		for _, match := range matches {
			if len(match) == 3 {
				key := match[1]  // e.g., "DOC1"
				scid := match[2] // 64-char hex SCID

				// Extract the number from DOCx
				var docNum int
				fmt.Sscanf(key, "DOC%d", &docNum)
				if docNum > 0 {
					docMap[docNum] = scid
					if docNum > maxDoc {
						maxDoc = docNum
					}
					log.Printf("  OK Found %s (from code): %s...", key, scid[:16])
				}
			}
		}

		// Build ordered slice from DOC1 to DOCn
		for i := 1; i <= maxDoc; i++ {
			if scid, ok := docMap[i]; ok {
				scids = append(scids, scid)
			}
		}

		if len(scids) > 0 {
			return scids
		}
		log.Println("  [WARN] No DOC SCIDs found in code, falling back to stringkeys...")
	}

	// Fallback: try stringkeys (for older contracts or if code parsing fails)
	stringKeys, ok := indexData["stringkeys"].(map[string]interface{})
	if !ok {
		log.Println("  [WARN]  No stringkeys field in INDEX response")
		return scids
	}

	log.Println("  [TELA] Extracting DOC SCIDs from stringkeys (fallback)...")

	// Look for DOC1, DOC2, DOC3, etc.
	for i := 1; i <= 100; i++ { // Max 100 DOCs
		key := fmt.Sprintf("DOC%d", i)
		if hexSCID, ok := stringKeys[key].(string); ok && hexSCID != "" {
			// Hex-decode the SCID
			scid := decodeHexString(hexSCID)
			if len(scid) == 64 { // Valid SCID length
				scids = append(scids, scid)
				log.Printf("  OK Found %s (from stringkeys): %s...", key, scid[:16])
			}
		} else {
			break // No more DOCs
		}
	}

	return scids
}

// decodeHexString decodes a hex string, returns original if decode fails.
// Trailing null bytes and whitespace are stripped -- DERO SC storage
// sometimes pads values with \x00 that breaks key lookups.
func decodeHexString(hexStr string) string {
	decoded, err := hex.DecodeString(hexStr)
	if err != nil {
		return hexStr
	}
	return strings.TrimRight(string(decoded), "\x00 \t\n\r")
}

func extractStoredStringValue(code string, key string) string {
	pattern := regexp.MustCompile(fmt.Sprintf(`STORE\("%s",\s*"((?:[^"\\]|\\.)*)"\)`, regexp.QuoteMeta(key)))
	match := pattern.FindStringSubmatch(code)
	if len(match) < 2 {
		return ""
	}

	unquoted, err := strconv.Unquote(`"` + match[1] + `"`)
	if err != nil {
		return match[1]
	}

	return unquoted
}

type docMetadata struct {
	FileName string
	DocType  string
	DURL     string
	SubDir   string
}

func extractDOCMetadataFromCode(code string) docMetadata {
	return docMetadata{
		FileName: extractStoredStringValue(code, "var_header_name"),
		DocType:  extractStoredStringValue(code, "docType"),
		DURL:     extractStoredStringValue(code, "dURL"),
		SubDir:   extractStoredStringValue(code, "subDir"),
	}
}

// processDOC processes a DOC contract and extracts its content
func (a *App) processDOC(docData map[string]interface{}, content *TELAContent) error {
	code, ok := docData["code"].(string)
	if !ok {
		return fmt.Errorf("no code in DOC contract")
	}
	if strings.TrimSpace(code) == "" {
		return fmt.Errorf("empty code in DOC contract")
	}

	stringKeys, ok := docData["stringkeys"].(map[string]interface{})
	fallbackMeta := extractDOCMetadataFromCode(code)
	if !ok {
		// Simulator GetSC can return DOC code without stringkeys.
		// Fall back to parsing metadata directly from the contract code.
		if fallbackMeta.FileName != "" && fallbackMeta.DocType != "" {
			a.logToConsole(fmt.Sprintf("  [FALLBACK] DOC metadata recovered from code: %s (%s)", fallbackMeta.FileName, fallbackMeta.DocType))
		} else {
			a.logToConsole("  [WARN] DOC contract response missing usable stringkeys metadata")
			return fmt.Errorf("no stringkeys in DOC contract")
		}
	}

	// Check if this is actually an embedded INDEX (not a DOC)
	// Embedded INDEXes have telaVersion or DOC1 keys but no docType
	if isEmbeddedINDEX(stringKeys) {
		dURL := fallbackMeta.DURL
		if durlHex, ok := stringKeys["dURL"].(string); ok {
			dURL = decodeHexString(durlHex)
		}

		// Handle embedded .shards INDEX (e.g., rive.js-2.35.3.shards)
		if isEmbeddedShardsINDEX(dURL) {
			scid := ""
			if scidStr, ok := docData["scid"].(string); ok {
				scid = scidStr
			}
			a.logToConsole(fmt.Sprintf("  [EMBED] Detected embedded .shards INDEX: %s (%s...)", dURL, truncateSCID(scid, 16)))
			return a.processEmbeddedShardsINDEX(docData, content)
		}

		// For other embedded INDEXes (.lib), we can add support later
		a.logToConsole(fmt.Sprintf("  [WARN] Embedded INDEX detected but not .shards: %s (skipping)", dURL))
		return nil
	}

	// Get docType (hex-encoded) - with nil check
	docType := fallbackMeta.DocType
	if docTypeHex, ok := stringKeys["docType"].(string); ok {
		docType = decodeHexString(docTypeHex)
	}

	// Get fileName (hex-encoded) - with nil check
	// TELA V2 uses "var_header_name", V1 uses "nameHdr"
	fileName := fallbackMeta.FileName
	if fileName == "" {
		fileName = "unknown"
	}
	if fileNameHex, ok := stringKeys["var_header_name"].(string); ok {
		fileName = decodeHexString(fileNameHex)
	} else if fileNameHex, ok := stringKeys["nameHdr"].(string); ok {
		fileName = decodeHexString(fileNameHex)
	}

	// Extract the actual file content from the smart contract
	// The file content is in a comment block after the contract code
	fileContent := extractFileContentFromCode(code)

	if fileContent == "" {
		return fmt.Errorf("could not extract file content")
	}

	// Check if file is gzip-compressed (ends with .gz)
	if strings.HasSuffix(fileName, ".gz") {
		if isShardChunkName(fileName) {
			// Shard chunk — raw slice of a larger gzip stream. Don't try to
			// decompress individually; reassembly happens after all DOCs are collected.
			a.logToConsole(fmt.Sprintf("  OK Extracted %s (%d bytes, shard chunk)", fileName, len(fileContent)))
		} else {
			a.logToConsole(fmt.Sprintf("  OK Extracted %s (%d bytes, compressed)", fileName, len(fileContent)))
			decompressed, err := decompressGzip(fileContent)
			if err != nil {
				a.logToConsole(fmt.Sprintf("  [WARN]  Gzip decompression failed: %v", err))
			} else {
				fileContent = decompressed
				fileName = strings.TrimSuffix(fileName, ".gz")
				a.logToConsole(fmt.Sprintf("  OK Decompressed to %s (%d bytes)", fileName, len(fileContent)))
			}
		}
	} else {
		a.logToConsole(fmt.Sprintf("  OK Extracted %s (%d bytes)", fileName, len(fileContent)))
	}

	// Get SCID for tracking - with nil check
	scid := ""
	if scidStr, ok := docData["scid"].(string); ok {
		scid = scidStr
	}

	// Store by type
	switch {
	case strings.HasPrefix(docType, "TELA-HTML"):
		content.HTML = fileContent
		if scid != "" {
			content.SCIDs[fileName] = scid
		}

	case strings.HasPrefix(docType, "TELA-CSS"):
		content.CSS = append(content.CSS, fileContent)
		// Track CSS content by filename for external reference replacement
		if content.CSSByName == nil {
			content.CSSByName = make(map[string]string)
		}
		content.CSSByName[fileName] = fileContent
		if scid != "" {
			content.SCIDs[fileName] = scid
		}

	case strings.HasPrefix(docType, "TELA-JS"):
		content.JS = append(content.JS, fileContent)
		// Track JS content by filename for external reference replacement
		if content.JSByName == nil {
			content.JSByName = make(map[string]string)
		}
		content.JSByName[fileName] = fileContent
		if scid != "" {
			content.SCIDs[fileName] = scid
		}

	case strings.HasPrefix(docType, "TELA-STATIC"):
		// Static files - could be images, SVGs, or text files like .txt
		// Track by filename for embedding/replacement in HTML
		if content.StaticByName == nil {
			content.StaticByName = make(map[string]string)
		}
		content.StaticByName[fileName] = fileContent
		if scid != "" {
			content.SCIDs[fileName] = scid
		}

		// IMPORTANT: If this is an HTML file (like index.html), treat it as the main HTML content
		// Some TELA apps use TELA-STATIC for HTML files instead of TELA-HTML
		if content.HTML == "" && isHTMLFile(fileName) {
			a.logToConsole(fmt.Sprintf("  [STATIC] Detected HTML file %s - using as main content", fileName))
			content.HTML = fileContent
		} else if content.HTML == "" && isTextBasedFile(fileName) {
			// If this is a text-based file and we don't have HTML yet, render it as readable text
			// This allows standalone text documents (like .txt files) to be displayed properly
			a.logToConsole(fmt.Sprintf("  [STATIC] Rendering text file %s as readable document", fileName))
			content.HTML = renderTextViewer(fileName, fileContent, scid)
		} else {
			a.logToConsole(fmt.Sprintf("  [STATIC] Stored %s for inline embedding", fileName))
		}

	default:
		a.logToConsole(fmt.Sprintf("  [INFO]  Unknown docType: %s (treating as HTML)", docType))
		// If docType is unknown, try to detect by content or use as HTML
		if content.HTML == "" {
			content.HTML = fileContent
		}
	}

	// Record raw file for shard/library handling
	content.Files = append(content.Files, DocFile{
		Name:    fileName,
		Content: fileContent,
		DocType: docType,
	})

	return nil
}

// processEmbeddedShardsINDEX handles an embedded INDEX with .shards dURL
// This is used for sharded libraries like rive.js that are split across multiple DOC contracts
// The function fetches all DOCs from the embedded INDEX, concatenates them, and decompresses
func (a *App) processEmbeddedShardsINDEX(indexData map[string]interface{}, content *TELAContent) error {
	// Get the embedded INDEX's dURL to derive the output filename
	stringKeys, _ := indexData["stringkeys"].(map[string]interface{})
	code, _ := indexData["code"].(string)
	fallbackMeta := extractDOCMetadataFromCode(code)

	dURL := fallbackMeta.DURL
	if durlHex, ok := stringKeys["dURL"].(string); ok {
		dURL = decodeHexString(durlHex)
	}

	// For HTTP serving, the browser requests the full path: /rive.wasm-2.35.3.shards/rive.wasm
	// - Directory name: dURL (e.g., "rive.wasm-2.35.3.shards")
	// - Filename: base name without version (e.g., "rive.wasm")
	// We need BOTH:
	// - Full path for HTTP serving: "rive.wasm-2.35.3.shards/rive.wasm"
	// - Simple name for HTML inlining: "rive.wasm"

	// Get base name by stripping .shards and version
	baseName := strings.TrimSuffix(dURL, ".shards")
	versionRe := regexp.MustCompile(`^(.+)-\d+\.\d+\.\d+$`)
	if m := versionRe.FindStringSubmatch(baseName); len(m) > 1 {
		baseName = m[1]
	}

	// Full path for HTTP serving: "dURL/baseName"
	fullPath := dURL + "/" + baseName

	// We'll store under both names
	outputName := baseName

	a.logToConsole(fmt.Sprintf("  [EMBED] Processing embedded shards: %s -> %s (HTTP: %s)", dURL, outputName, fullPath))

	// Extract DOC SCIDs from the embedded INDEX
	docSCIDs := extractDOCsSCIDs(indexData)
	if len(docSCIDs) == 0 {
		return fmt.Errorf("no DOC SCIDs found in embedded INDEX %s", dURL)
	}

	a.logToConsole(fmt.Sprintf("  [EMBED] Found %d shard DOCs in %s", len(docSCIDs), dURL))

	// Fetch all DOC contracts and extract their content in order
	var shardContents []string
	var compression string

	for i, docSCID := range docSCIDs {
		docData, err := a.fetchSmartContract(docSCID, true, false)
		if err != nil {
			a.logToConsole(fmt.Sprintf("  [EMBED] Failed to fetch shard DOC %d (%s...): %v", i+1, truncateSCID(docSCID, 16), err))
			continue
		}

		docCode, ok := docData["code"].(string)
		if !ok || docCode == "" {
			a.logToConsole(fmt.Sprintf("  [EMBED] Shard DOC %d has no code", i+1))
			continue
		}

		// Extract shard content from the DOC's comment block
		shardContent := extractFileContentFromCode(docCode)
		if shardContent == "" {
			a.logToConsole(fmt.Sprintf("  [EMBED] Failed to extract content from shard DOC %d", i+1))
			continue
		}

		// Detect compression from first shard's filename
		if i == 0 {
			docStringKeys, _ := docData["stringkeys"].(map[string]interface{})
			docMeta := extractDOCMetadataFromCode(docCode)
			docFileName := docMeta.FileName
			if fnHex, ok := docStringKeys["var_header_name"].(string); ok {
				docFileName = decodeHexString(fnHex)
			} else if fnHex, ok := docStringKeys["nameHdr"].(string); ok {
				docFileName = decodeHexString(fnHex)
			}
			if strings.HasSuffix(docFileName, ".gz") {
				compression = ".gz"
			}
		}

		shardContents = append(shardContents, shardContent)
	}

	if len(shardContents) == 0 {
		return fmt.Errorf("no shard content extracted from embedded INDEX %s", dURL)
	}

	a.logToConsole(fmt.Sprintf("  [EMBED] Extracted %d shard chunks for %s", len(shardContents), outputName))

	// Concatenate all shard contents
	concatenated := strings.Join(shardContents, "")

	// Decompress if shards were compressed
	var finalContent string
	if compression == ".gz" {
		decompressed, err := decompressGzip(concatenated)
		if err != nil {
			a.logToConsole(fmt.Sprintf("  [EMBED] Decompression failed for %s: %v", outputName, err))
			return fmt.Errorf("failed to decompress shards for %s: %w", outputName, err)
		}
		finalContent = decompressed
		a.logToConsole(fmt.Sprintf("  [EMBED] Decompressed %s: %d bytes -> %d bytes", outputName, len(concatenated), len(finalContent)))
	} else {
		finalContent = concatenated
		a.logToConsole(fmt.Sprintf("  [EMBED] Assembled %s: %d bytes (uncompressed)", outputName, len(finalContent)))
	}

	// Determine docType based on file extension
	docType := "TELA-STATIC-1"
	ext := strings.ToLower(filepath.Ext(outputName))
	switch ext {
	case ".js":
		docType = "TELA-JS-1"
	case ".css":
		docType = "TELA-CSS-1"
	case ".html", ".htm":
		docType = "TELA-HTML-1"
	case ".wasm":
		docType = "TELA-STATIC-1"
	}

	// Store by type (similar to regular DOC processing)
	// Store under BOTH:
	// - Simple name (for HTML inlining): "rive.wasm"
	// - Full path (for HTTP serving): "rive.wasm-2.35.3.shards/rive.wasm"
	switch {
	case strings.HasPrefix(docType, "TELA-JS"):
		content.JS = append(content.JS, finalContent)
		if content.JSByName == nil {
			content.JSByName = make(map[string]string)
		}
		content.JSByName[outputName] = finalContent
		content.JSByName[fullPath] = finalContent
		a.logToConsole(fmt.Sprintf("  [EMBED] Stored %s as JS (%d bytes)", outputName, len(finalContent)))

	case strings.HasPrefix(docType, "TELA-CSS"):
		content.CSS = append(content.CSS, finalContent)
		if content.CSSByName == nil {
			content.CSSByName = make(map[string]string)
		}
		content.CSSByName[outputName] = finalContent
		content.CSSByName[fullPath] = finalContent
		a.logToConsole(fmt.Sprintf("  [EMBED] Stored %s as CSS (%d bytes)", outputName, len(finalContent)))

	default:
		if content.StaticByName == nil {
			content.StaticByName = make(map[string]string)
		}
		content.StaticByName[outputName] = finalContent
		content.StaticByName[fullPath] = finalContent
		a.logToConsole(fmt.Sprintf("  [EMBED] Stored %s as static (%d bytes)", outputName, len(finalContent)))
	}

	// Record raw file
	content.Files = append(content.Files, DocFile{
		Name:    outputName,
		Content: finalContent,
		DocType: docType,
	})

	return nil
}

// extractFileContentFromCode extracts file content from smart contract code
// The actual file content is in a comment block (/* ... */)
func extractFileContentFromCode(code string) string {
	// Look for content in /* ... */ block
	re := regexp.MustCompile(`/\*\s*([\s\S]*?)\s*\*/`)
	matches := re.FindStringSubmatch(code)

	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}

// decompressGzip decompresses gzip-compressed content (stored as base64 in smart contract)
func decompressGzip(compressedBase64 string) (string, error) {
	// First, decode from base64 (gzip data is stored as base64 text in SC)
	compressed, err := base64.StdEncoding.DecodeString(compressedBase64)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Then decompress the gzip data
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return "", fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer reader.Close()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("failed to decompress: %w", err)
	}

	return string(decompressed), nil
}

// assembleFinalHTML assembles the final HTML document with CSS and JS
// It replaces external <script src="..."> and <link href="..."> references with inlined content
func (a *App) assembleFinalHTML(content *TELAContent) error {
	if content.HTML == "" {
		return fmt.Errorf("no HTML content found")
	}

	a.logToConsole("[TELA] Assembling final HTML...")

	// Track which files were inlined (so we don't double-add them)
	inlinedCSS := make(map[string]bool)
	inlinedJS := make(map[string]bool)

	// Replace external CSS references: <link rel="stylesheet" href="filename.css">
	if len(content.CSSByName) > 0 {
		cssLinkRegex := regexp.MustCompile(`<link[^>]*href=["']([^"']+\.css)["'][^>]*>`)
		content.HTML = cssLinkRegex.ReplaceAllStringFunc(content.HTML, func(match string) string {
			// Extract the href value
			hrefMatch := regexp.MustCompile(`href=["']([^"']+)["']`).FindStringSubmatch(match)
			if len(hrefMatch) > 1 {
				href := hrefMatch[1]
				// Try to find the CSS content by filename (with and without path)
				filename := filepath.Base(href)
				if cssContent, ok := content.CSSByName[filename]; ok {
					a.logToConsole(fmt.Sprintf("  OK Inlined CSS: %s", filename))
					inlinedCSS[filename] = true
					return "<style>\n" + cssContent + "\n</style>"
				}
				// Also try with full path
				if cssContent, ok := content.CSSByName[href]; ok {
					a.logToConsole(fmt.Sprintf("  OK Inlined CSS: %s", href))
					inlinedCSS[href] = true
					return "<style>\n" + cssContent + "\n</style>"
				}
			}
			return match // Keep original if not found
		})
	}

	// Replace external JS references: <script src="filename.js"></script>
	if len(content.JSByName) > 0 {
		jsScriptRegex := regexp.MustCompile(`<script[^>]*src=["']([^"']+\.js)["'][^>]*>\s*</script>`)
		content.HTML = jsScriptRegex.ReplaceAllStringFunc(content.HTML, func(match string) string {
			// Extract the src value
			srcMatch := regexp.MustCompile(`src=["']([^"']+)["']`).FindStringSubmatch(match)
			if len(srcMatch) > 1 {
				src := srcMatch[1]
				// Try to find the JS content by filename (with and without path)
				filename := filepath.Base(src)
				if jsContent, ok := content.JSByName[filename]; ok {
					a.logToConsole(fmt.Sprintf("  OK Inlined JS: %s", filename))
					inlinedJS[filename] = true
					return "<script>\n" + jsContent + "\n</script>"
				}
				// Also try with full path
				if jsContent, ok := content.JSByName[src]; ok {
					a.logToConsole(fmt.Sprintf("  OK Inlined JS: %s", src))
					inlinedJS[src] = true
					return "<script>\n" + jsContent + "\n</script>"
				}
			}
			return match // Keep original if not found
		})
	}

	// Inject remaining CSS that wasn't referenced externally
	remainingCSS := []string{}
	for filename, cssContent := range content.CSSByName {
		if !inlinedCSS[filename] {
			remainingCSS = append(remainingCSS, cssContent)
		}
	}
	if len(remainingCSS) > 0 {
		cssBlock := "<style>\n"
		for _, css := range remainingCSS {
			cssBlock += css + "\n"
		}
		cssBlock += "</style>"

		// Insert before </head> or at start of HTML
		if strings.Contains(content.HTML, "</head>") {
			content.HTML = strings.Replace(content.HTML, "</head>", cssBlock+"\n</head>", 1)
		} else {
			content.HTML = cssBlock + "\n" + content.HTML
		}
		a.logToConsole(fmt.Sprintf("  OK Injected %d additional CSS files", len(remainingCSS)))
	}

	// Inject remaining JS that wasn't referenced externally
	remainingJS := []string{}
	for filename, jsContent := range content.JSByName {
		if !inlinedJS[filename] {
			remainingJS = append(remainingJS, jsContent)
		}
	}
	if len(remainingJS) > 0 {
		jsBlock := "<script>\n"
		for _, js := range remainingJS {
			jsBlock += js + "\n"
		}
		jsBlock += "</script>"

		// Insert before </body> or at end of HTML
		if strings.Contains(content.HTML, "</body>") {
			content.HTML = strings.Replace(content.HTML, "</body>", jsBlock+"\n</body>", 1)
		} else {
			content.HTML = content.HTML + "\n" + jsBlock
		}
		a.logToConsole(fmt.Sprintf("  OK Injected %d additional JS files", len(remainingJS)))
	}

	// Replace static file references (images, SVGs) with inline content or data URIs
	if len(content.StaticByName) > 0 {
		// Replace <img src="..."> references
		imgRegex := regexp.MustCompile(`<img[^>]*src=["']([^"']+)["'][^>]*>`)
		content.HTML = imgRegex.ReplaceAllStringFunc(content.HTML, func(match string) string {
			srcMatch := regexp.MustCompile(`src=["']([^"']+)["']`).FindStringSubmatch(match)
			if len(srcMatch) > 1 {
				src := srcMatch[1]
				filename := filepath.Base(src)
				if staticContent, ok := content.StaticByName[filename]; ok {
					// Determine MIME type and create data URI
					ext := strings.ToLower(filepath.Ext(filename))
					var mimeType string
					switch ext {
					case ".svg":
						mimeType = "image/svg+xml"
					case ".png":
						mimeType = "image/png"
					case ".jpg", ".jpeg":
						mimeType = "image/jpeg"
					case ".gif":
						mimeType = "image/gif"
					case ".webp":
						mimeType = "image/webp"
					case ".ico":
						mimeType = "image/x-icon"
					default:
						mimeType = "application/octet-stream"
					}

					// For SVG, we can inline directly; for binary, use base64
					if ext == ".svg" {
						// SVG can be inlined directly as data URI
						dataURI := "data:" + mimeType + "," + url.PathEscape(staticContent)
						a.logToConsole(fmt.Sprintf("  OK Inlined static: %s (SVG)", filename))
						return strings.Replace(match, src, dataURI, 1)
					} else {
						// Binary images would need base64 encoding
						// For now, just inline as data URI if small enough
						dataURI := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString([]byte(staticContent))
						a.logToConsole(fmt.Sprintf("  OK Inlined static: %s (base64)", filename))
						return strings.Replace(match, src, dataURI, 1)
					}
				}
			}
			return match
		})
	}

	a.logToConsole("[OK] HTML assembly complete")

	return nil
}

// ConsoleLog represents a log entry for the browser console
type ConsoleLog struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

// logToConsole sends a log message to the browser console
func (a *App) logToConsole(message string) {
	log.Println(message) // Also log to Go console

	// Determine log level from message content
	level := "info"
	lowerMsg := strings.ToLower(message)
	if strings.Contains(lowerMsg, "error") || strings.Contains(lowerMsg, "failed") || strings.Contains(lowerMsg, "[ERR]") {
		level = "error"
	} else if strings.Contains(lowerMsg, "warn") || strings.Contains(lowerMsg, "[WARN]") {
		level = "warn"
	} else if strings.Contains(lowerMsg, "[OK]") || strings.Contains(lowerMsg, "success") {
		level = "success"
	}

	// Store in console history
	logEntry := ConsoleLog{
		Timestamp: fmt.Sprintf("%s", currentTimeStamp()),
		Level:     level,
		Message:   message,
	}
	a.consoleLogsMu.Lock()
	a.consoleLogs = append(a.consoleLogs, logEntry)
	// Limit console history
	if len(a.consoleLogs) > 1000 {
		a.consoleLogs = a.consoleLogs[len(a.consoleLogs)-1000:]
	}
	a.consoleLogsMu.Unlock()

	// Emit real-time event for terminal display
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "node-log", map[string]interface{}{
			"timestamp": logEntry.Timestamp,
			"level":     logEntry.Level,
			"message":   logEntry.Message,
			"source":    "hologram",
		})
	}
}

// GetConsoleLogs returns recent console logs
func (a *App) GetConsoleLogs() []ConsoleLog {
	a.consoleLogsMu.Lock()
	defer a.consoleLogsMu.Unlock()
	// Return a copy so the caller can't observe a concurrent append/trim.
	out := make([]ConsoleLog, len(a.consoleLogs))
	copy(out, a.consoleLogs)
	return out
}

// ClearConsoleLogs clears the console history
func (a *App) ClearConsoleLogs() map[string]interface{} {
	a.consoleLogsMu.Lock()
	a.consoleLogs = make([]ConsoleLog, 0)
	a.consoleLogsMu.Unlock()
	return map[string]interface{}{
		"success": true,
		"message": "Console cleared",
	}
}

func currentTimeStamp() string {
	now := time.Now()
	return now.Format("15:04:05")
}
