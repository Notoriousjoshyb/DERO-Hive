// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Navigation & History - Extracted from app.go for organization
// Session 87: Domain splitting

package main

import (
	"fmt"
	"log"
	"strings"
)

// Navigation Functions

func (a *App) Navigate(scid string) map[string]interface{} {
	// Accepts raw SCID or dero://name and resolves via Gnomon when needed
	input := scid
	resolved := input

	// If input looks like dero://<identifier>, strip scheme and try dURL first
	if len(input) > 7 && (input[:7] == "dero://") {
		name := input[7:]
		// Prefer live Gnomon resolution first so stale cache entries do not win.
		if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
			if sc, ok := a.gnomonClient.ResolveDURL(name); ok {
				resolved = sc
				a.cacheDURLMapping(name, sc)
				a.logToConsole(fmt.Sprintf("[Search] Resolved dero://%s → %s", name, sc))
			} else if sc, ok := a.gnomonClient.ResolveName(name); ok {
				resolved = sc
				a.cacheDURLMapping(name, sc)
				a.logToConsole(fmt.Sprintf("[Search] Resolved name dero://%s → %s", name, sc))
			} else if cached, ok := a.getCachedDURLMapping(name); ok {
				resolved = cached
				a.logToConsole(fmt.Sprintf("[Search] Resolved dero://%s → %s (cache fallback)", name, cached))
			} else {
				a.logToConsole(fmt.Sprintf("[WARN]  Could not resolve dero://%s via Gnomon (name or dURL)", name))
			}
		} else if cached, ok := a.getCachedDURLMapping(name); ok {
			resolved = cached
			a.logToConsole(fmt.Sprintf("[Search] Resolved dero://%s → %s (cache)", name, cached))
		} else {
			a.logToConsole("[WARN]  Gnomon not running and no cached dURL mapping available")
		}
	}

	log.Printf("[LINK] Navigating to: %s", resolved)

	// Add to history (store user input and resolved target)
	a.history = append(a.history, resolved)

	return map[string]interface{}{
		"success": true,
		"scid":    resolved,
		"input":   input,
		"message": "Navigation initiated",
	}
}

func (a *App) captureLaunchURLFromArgs(args []string) {
	for _, raw := range args {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(trimmed), "dero://") {
			a.launchURLMu.Lock()
			a.launchURL = trimmed
			a.launchURLMu.Unlock()
			a.logToConsole(fmt.Sprintf("[LINK] Startup deep link captured: %s", trimmed))
			return
		}
	}
}

func (a *App) ConsumeLaunchURL() string {
	a.launchURLMu.Lock()
	defer a.launchURLMu.Unlock()

	url := strings.TrimSpace(a.launchURL)
	a.launchURL = ""
	return url
}

func (a *App) GoBack() map[string]interface{} {
	log.Println("⬅️ Go back")
	return map[string]interface{}{"success": true, "message": "Back navigation"}
}

func (a *App) GoForward() map[string]interface{} {
	log.Println("[Nav] Go forward")
	return map[string]interface{}{"success": true, "message": "Forward navigation"}
}

func (a *App) Reload() map[string]interface{} {
	log.Println("[SYNC] Reload page")
	return map[string]interface{}{"success": true, "message": "Page reload"}
}

// History Functions

func (a *App) GetHistory() []string {
	return a.history
}

func (a *App) ClearHistory() map[string]interface{} {
	a.history = make([]string, 0)
	return map[string]interface{}{
		"success": true,
		"message": "History cleared",
	}
}
