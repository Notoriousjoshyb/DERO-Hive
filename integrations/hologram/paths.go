package main

import (
	"os"
	"path/filepath"
)

// testDataDirOverride allows tests to override the data directory.
// When set to a non-empty string, it will be used instead of the default path.
// This should only be set in test code, never in production.
var testDataDirOverride string

// getHologramDataDir returns the base data directory for HOLOGRAM.
// Defaults to ~/.dero/hologram and falls back to the current working directory.
// If testDataDirOverride is set (for testing), it uses that instead.
func getHologramDataDir() string {
	// Allow tests to override the data directory
	if testDataDirOverride != "" {
		_ = os.MkdirAll(testDataDirOverride, 0755)
		return testDataDirOverride
	}

	homeDir, err := os.UserHomeDir()
	if err == nil {
		base := filepath.Join(homeDir, ".dero", "hologram")
		if err := os.MkdirAll(base, 0755); err == nil {
			return base
		}
	}

	wd, err := os.Getwd()
	if err == nil {
		return wd
	}

	return "."
}

// getDatashardsDir returns the datashards directory, creating it if needed.
func getDatashardsDir() string {
	dir := filepath.Join(getHologramDataDir(), "datashards")
	_ = os.MkdirAll(dir, 0755)
	return dir
}
