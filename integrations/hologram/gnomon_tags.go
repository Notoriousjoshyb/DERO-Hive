// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Gnomon Tagging & Classification System
// Ported from simple-gnomon for enhanced SCID discovery

package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SCIDMetadata stores enriched metadata for indexed smart contracts
type SCIDMetadata struct {
	SCID         string   `json:"scid"`
	Owner        string   `json:"owner"`
	Class        string   `json:"class"`   // Primary classification: TELA-DOC-1, TELA-INDEX-1, G45-NFT, NFA, etc.
	Tags         []string `json:"tags"`    // Multiple tags: ["all", "tela", "g45"]
	Headers      string   `json:"headers"` // "name;description;iconURL"
	DeployHeight int64    `json:"deploy_height"`
}

// TagFilter defines a search filter with terms
type TagFilter struct {
	Name  string   `json:"name"`
	Terms []string `json:"terms"`
}

// SCIDTagStore manages SCID metadata persistence
type SCIDTagStore struct {
	Metadata map[string]*SCIDMetadata `json:"metadata"` // SCID -> metadata
	Filters  []TagFilter              `json:"filters"`
	mu       sync.RWMutex
	filePath string
}

var scidTagStore *SCIDTagStore
var scidTagStoreOnce sync.Once

// Default tag filters (matches simple-gnomon's config/search.json)
var defaultTagFilters = []TagFilter{
	{Name: "g45", Terms: []string{"G45-NFT", "G45-AT", "G45-C", "G45-FAT", "G45-NAME", "T345"}},
	{Name: "nfa", Terms: []string{"ART-NFA-MS1"}},
	{Name: "tela", Terms: []string{"docVersion", "telaVersion"}},
	{Name: "epoch", Terms: []string{"EPOCH", "epochEnabled", "crowd_mining"}},
}

// InitSCIDTagStore initializes the tag store (singleton)
func InitSCIDTagStore() *SCIDTagStore {
	scidTagStoreOnce.Do(func() {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[TAGS] Failed to get home directory: %v", err)
			homeDir = "."
		}

		basePath := filepath.Join(homeDir, ".dero", "hologram", "datashards")

		scidTagStore = &SCIDTagStore{
			Metadata: make(map[string]*SCIDMetadata),
			Filters:  defaultTagFilters,
			filePath: filepath.Join(basePath, "scid_tags.json"),
		}

		scidTagStore.load()
		log.Printf("[TAGS] Tag store initialized with %d SCIDs", len(scidTagStore.Metadata))
	})

	return scidTagStore
}

// ClassifyContract determines class and tags for a smart contract
func (s *SCIDTagStore) ClassifyContract(scid, code string, vars map[string]any, owner string, deployHeight int64) *SCIDMetadata {
	s.mu.Lock()
	defer s.mu.Unlock()

	meta := &SCIDMetadata{
		SCID:         scid,
		Owner:        owner,
		Tags:         []string{"all"}, // Catch-all tag
		DeployHeight: deployHeight,
	}

	// Determine class based on code content
	has := strings.Contains
	switch {
	case has(code, "docVersion"):
		meta.Class = "TELA-DOC-1"
	case has(code, "telaVersion"):
		meta.Class = "TELA-INDEX-1"
	case has(code, "G45-NFT"):
		meta.Class = "G45-NFT"
	case has(code, "G45-AT"):
		meta.Class = "G45-AT"
	case has(code, "G45-FAT"):
		meta.Class = "G45-FAT"
	case has(code, "ART-NFA-MS1"):
		meta.Class = "NFA"
	case scid == "0000000000000000000000000000000000000000000000000000000000000001":
		meta.Class = "NAMESERVICE"
	default:
		meta.Class = "SC" // Generic smart contract
	}

	// Apply tag filters
	for _, filter := range s.Filters {
		for _, term := range filter.Terms {
			if has(code, term) {
				// Avoid duplicate tags
				hasTag := false
				for _, t := range meta.Tags {
					if t == filter.Name {
						hasTag = true
						break
					}
				}
				if !hasTag {
					meta.Tags = append(meta.Tags, filter.Name)
				}
				break
			}
		}
	}

	// Extract headers from variables
	meta.Headers = extractHeaders(vars)

	s.Metadata[scid] = meta

	// Save asynchronously
	go s.save()

	return meta
}

// extractHeaders extracts name;description;iconURL from SC variables
func extractHeaders(vars map[string]any) string {
	name := getVarString(vars, "nameHdr", "name")
	desc := getVarString(vars, "descrHdr", "description")
	icon := getVarString(vars, "iconURLHdr", "icon")

	if name == "" {
		name = "null"
	}
	if desc == "" {
		desc = "null"
	}
	if icon == "" {
		icon = "null"
	}

	return name + ";" + desc + ";" + icon
}

// getVarString tries multiple keys to get a string value
func getVarString(vars map[string]any, keys ...string) string {
	for _, key := range keys {
		if val, ok := vars[key]; ok {
			switch v := val.(type) {
			case string:
				return v
			default:
				// Try to decode if it's hex-encoded
				decoded := decodeHexString(stringifyValue(val))
				if decoded != "" {
					return decoded
				}
			}
		}
	}
	return ""
}

// stringifyValue converts an any to string
func stringifyValue(val any) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return ""
	}
}

// GetSCIDsByTag returns all SCIDs with a specific tag
func (s *SCIDTagStore) GetSCIDsByTag(tag string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	results := make([]string, 0)
	tagLower := strings.ToLower(tag)

	for scid, meta := range s.Metadata {
		for _, t := range meta.Tags {
			if strings.ToLower(t) == tagLower {
				results = append(results, scid)
				break
			}
		}
	}
	return results
}

// GetSCIDsByClass returns all SCIDs with a specific class
func (s *SCIDTagStore) GetSCIDsByClass(class string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	results := make([]string, 0)
	classLower := strings.ToLower(class)

	for scid, meta := range s.Metadata {
		if strings.ToLower(meta.Class) == classLower {
			results = append(results, scid)
		}
	}
	return results
}

// GetAllTags returns all unique tags in use
func (s *SCIDTagStore) GetAllTags() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tagSet := make(map[string]bool)
	for _, meta := range s.Metadata {
		for _, tag := range meta.Tags {
			tagSet[tag] = true
		}
	}

	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}
	return tags
}

// GetAllClasses returns all unique classes in use
func (s *SCIDTagStore) GetAllClasses() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	classSet := make(map[string]bool)
	for _, meta := range s.Metadata {
		if meta.Class != "" {
			classSet[meta.Class] = true
		}
	}

	classes := make([]string, 0, len(classSet))
	for class := range classSet {
		classes = append(classes, class)
	}
	return classes
}

// GetMetadata returns metadata for a specific SCID
func (s *SCIDTagStore) GetMetadata(scid string) *SCIDMetadata {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Metadata[scid]
}

// HasMetadata checks if a SCID has been classified
func (s *SCIDTagStore) HasMetadata(scid string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, exists := s.Metadata[scid]
	return exists
}

// AddTagFilter adds a custom tag filter
func (s *SCIDTagStore) AddTagFilter(name string, terms []string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if filter already exists
	for i, f := range s.Filters {
		if f.Name == name {
			s.Filters[i].Terms = terms
			go s.save()
			return
		}
	}

	s.Filters = append(s.Filters, TagFilter{Name: name, Terms: terms})
	go s.save()
}

// RemoveTagFilter removes a tag filter by name
func (s *SCIDTagStore) RemoveTagFilter(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, f := range s.Filters {
		if f.Name == name {
			s.Filters = append(s.Filters[:i], s.Filters[i+1:]...)
			go s.save()
			return
		}
	}
}

// GetTagFilters returns all tag filters
func (s *SCIDTagStore) GetTagFilters() []TagFilter {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Return a copy to avoid race conditions
	filters := make([]TagFilter, len(s.Filters))
	copy(filters, s.Filters)
	return filters
}

// GetStats returns statistics about the tag store
func (s *SCIDTagStore) GetStats() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Count by class
	classCounts := make(map[string]int)
	for _, meta := range s.Metadata {
		classCounts[meta.Class]++
	}

	// Count by tag
	tagCounts := make(map[string]int)
	for _, meta := range s.Metadata {
		for _, tag := range meta.Tags {
			tagCounts[tag]++
		}
	}

	return map[string]any{
		"total_scids":  len(s.Metadata),
		"class_counts": classCounts,
		"tag_counts":   tagCounts,
		"filter_count": len(s.Filters),
	}
}

// ClearAll clears all metadata (for rebuild)
func (s *SCIDTagStore) ClearAll() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Metadata = make(map[string]*SCIDMetadata)
	go s.save()

	log.Printf("[TAGS] Tag store cleared")
}

// load reads metadata from disk
func (s *SCIDTagStore) load() {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[TAGS] Failed to load tag store: %v", err)
		}
		return
	}

	if err := json.Unmarshal(data, s); err != nil {
		log.Printf("[TAGS] Failed to parse tag store: %v", err)
	}
}

// save writes metadata to disk
func (s *SCIDTagStore) save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("[TAGS] Failed to create directory: %v", err)
		return err
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		log.Printf("[TAGS] Failed to marshal tag store: %v", err)
		return err
	}

	if err := os.WriteFile(s.filePath, data, 0644); err != nil {
		log.Printf("[TAGS] Failed to write tag store: %v", err)
		return err
	}

	return nil
}

// RebuildFromGnomon rebuilds the tag store by scanning all indexed SCIDs
// This is called when the user clicks "Rebuild Index" in settings
func (s *SCIDTagStore) RebuildFromGnomon(g *GnomonClient, daemonClient BlockchainClient) int {
	if g == nil || !g.IsRunning() {
		log.Printf("[TAGS] Cannot rebuild: Gnomon not running")
		return 0
	}

	// Clear existing metadata
	s.ClearAll()

	// Get all SCIDs from Gnomon
	scids := g.GetAllOwnersAndSCIDs()
	log.Printf("[TAGS] Rebuilding tag store for %d SCIDs...", len(scids))

	classified := 0
	for scid, owner := range scids {
		// Get SC code from daemon
		result, err := daemonClient.Call("DERO.GetSC", map[string]any{
			"scid": scid,
			"code": true,
		})
		if err != nil {
			continue
		}

		code := ""
		if resultMap, ok := result.(map[string]any); ok {
			if c, ok := resultMap["code"].(string); ok {
				code = c
			}
		}

		// Get variables from Gnomon
		vars := g.GetAllSCIDVariableDetails(scid)
		varMap := make(map[string]any)
		for _, v := range vars {
			if key, ok := v.Key.(string); ok {
				varMap[key] = v.Value
			}
		}

		// Get deploy height
		deployHeight := g.LatestInteractionHeight(scid)

		// Classify
		s.ClassifyContract(scid, code, varMap, owner, deployHeight)
		classified++
	}

	log.Printf("[TAGS] Rebuild complete: classified %d SCIDs", classified)
	return classified
}
