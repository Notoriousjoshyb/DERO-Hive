// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Regression tests for key/seed/credential exposure hardening:
//   1. The TELA clipboard bridge must never let untrusted content READ the host
//      clipboard (a just-copied recovery seed would be exfiltrable otherwise).
//   2. Idle auto-lock must drop the decrypted wallet from memory after the window.

package main

import (
	"os"
	"strings"
	"testing"
	"time"
)

// TestClipboardBridgeNoReadInjectedScript is a source-level sentinel: the bridge script
// injected into untrusted TELA iframes must NOT route clipboard read through the parent.
// If a future edit re-adds a read bridge, a malicious app could exfiltrate a seed the user
// just copied from the reveal modal. Fail the build if the injected script bridges read.
func TestClipboardBridgeNoReadInjectedScript(t *testing.T) {
	data, err := os.ReadFile("server_manager.go")
	if err != nil {
		t.Fatalf("read server_manager.go: %v", err)
	}
	src := string(data)

	// Isolate the injected bridge script so we only inspect what runs in the iframe.
	const marker = "getHologramClipboardBridgeScript"
	idx := strings.Index(src, marker)
	if idx < 0 {
		t.Fatalf("clipboard bridge script function not found — keep this sentinel in sync")
	}
	scriptRegion := src[idx:]

	banned := []string{"viaBridge('read')", "viaBridgeRead", "op: 'read'", "op:'read'"}
	for _, b := range banned {
		if strings.Contains(scriptRegion, b) {
			t.Fatalf("clipboard bridge re-introduced READ (%q): untrusted TELA content could exfiltrate "+
				"the host clipboard (e.g. a just-copied recovery seed). The bridge must be write-only.", b)
		}
	}
}

// TestClipboardHandlerRefusesRead is a source-level sentinel on the parent-side handler in
// Browser.svelte: it must NOT return host clipboard contents to a content-frame request.
// Defense in depth even though the injected script no longer asks for read.
func TestClipboardHandlerRefusesRead(t *testing.T) {
	data, err := os.ReadFile("frontend/src/routes/Browser.svelte")
	if err != nil {
		t.Fatalf("read Browser.svelte: %v", err)
	}
	src := string(data)

	// ClipboardGetText is the only way the handler could read the OS clipboard; it must
	// not be wired into the hologram-clipboard-request handler. Easiest robust check:
	// ClipboardGetText must not be used anywhere in the file (we removed the import).
	if strings.Contains(src, "ClipboardGetText") {
		t.Fatal("Browser.svelte references ClipboardGetText — the clipboard bridge must never return " +
			"host clipboard contents to untrusted TELA content (seed-exfiltration risk).")
	}
}

// TestAutoLockMinutesParsing locks in the idle auto-lock config parsing: a configured value
// (float64 from JSON or int) is honored, an absent setting falls back to the default, and 0
// disables. A regression that always returns 0 would silently disable auto-lock.
func TestAutoLockMinutesParsing(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]interface{}
		want     int
	}{
		{"absent -> default", map[string]interface{}{}, defaultAutoLockMinutes},
		{"json float64", map[string]interface{}{"auto_lock_minutes": float64(5)}, 5},
		{"int", map[string]interface{}{"auto_lock_minutes": 20}, 20},
		{"zero disables", map[string]interface{}{"auto_lock_minutes": float64(0)}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a := &App{settings: c.settings}
			if got := a.autoLockMinutes(); got != c.want {
				t.Fatalf("autoLockMinutes() = %d, want %d", got, c.want)
			}
		})
	}
	if defaultAutoLockMinutes <= 0 {
		t.Fatal("defaultAutoLockMinutes must be > 0 so auto-lock is on by default")
	}
}

// TestNoteWalletActivityStamps confirms noteWalletActivity advances lastActivity, which is
// what defers the idle auto-lock. If this stops updating, an active wallet would lock mid-use.
func TestNoteWalletActivityStamps(t *testing.T) {
	walletManager.Lock()
	walletManager.lastActivity = time.Time{} // zero
	walletManager.Unlock()

	noteWalletActivity()

	walletManager.RLock()
	got := walletManager.lastActivity
	walletManager.RUnlock()
	if got.IsZero() {
		t.Fatal("noteWalletActivity did not stamp lastActivity — idle auto-lock would mis-fire")
	}
}
