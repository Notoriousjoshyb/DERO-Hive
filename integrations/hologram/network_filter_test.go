// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for the Privacy Mode policy oracle (network_filter.go) and the
// transport-layer chokepoint helpers (privacy_transport.go).

package main

import (
	"context"
	"testing"
)

// withPrivacyMode runs fn with the network filter set to the given enabled state and
// allowlist, restoring the prior global state afterward so tests don't leak.
func withPrivacyMode(enabled bool, allowed []string, fn func()) {
	networkFilter.Lock()
	prevEnabled := networkFilter.enabled
	prevAllowed := networkFilter.allowedHosts
	networkFilter.enabled = enabled
	if allowed != nil {
		networkFilter.allowedHosts = allowed
	}
	networkFilter.Unlock()

	defer func() {
		networkFilter.Lock()
		networkFilter.enabled = prevEnabled
		networkFilter.allowedHosts = prevAllowed
		networkFilter.Unlock()
	}()

	fn()
}

var defaultAllowed = []string{"127.0.0.1", "localhost", "0.0.0.0", "::1"}

func TestIsAddrAllowed_OffIsNoOp(t *testing.T) {
	// The core OFF guarantee: with Privacy Mode off, EVERYTHING is allowed —
	// arbitrary remote hosts included — so the default path is unchanged.
	withPrivacyMode(false, defaultAllowed, func() {
		cases := []struct{ host, port string }{
			{"127.0.0.1", "10102"},
			{"evil.com", "443"},
			{"203.0.113.7", "8080"},
			{"dero.evil.com", "10102"},
		}
		for _, c := range cases {
			if allowed, reason := isAddrAllowed(c.host, c.port); !allowed {
				t.Errorf("OFF: isAddrAllowed(%q,%q) = false (%s); want true (no-op)", c.host, c.port, reason)
			}
		}
	})
}

func TestIsAddrAllowed_OnAllowsLoopback(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		// Loopback is allowed on any port (can't egress).
		cases := []struct{ host, port string }{
			{"127.0.0.1", "10102"}, // daemon RPC
			{"127.0.0.1", "44326"}, // XSWD
			{"127.0.0.1", "9190"},  // gnomon WS
			{"localhost", "20000"}, // simulator
			{"127.0.0.1", "65000"}, // arbitrary local port — still fine, loopback
			{"::1", "10102"},
		}
		for _, c := range cases {
			if allowed, reason := isAddrAllowed(c.host, c.port); !allowed {
				t.Errorf("ON: isAddrAllowed(%q,%q) = false (%s); want true (loopback)", c.host, c.port, reason)
			}
		}
	})
}

func TestIsAddrAllowed_OnBlocksRemote(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		// The whole point: arbitrary remotes are cut, and substring spoofing of the old
		// isDEROConnection no longer works.
		cases := []struct{ host, port string }{
			{"evil.com", "443"},
			{"dero.evil.com", "10102"},  // substring "dero" must NOT pass
			{"evil.com", "44326"},       // DERO port on a remote host must NOT pass
			{"203.0.113.7", "10102"},    // remote daemon must NOT pass
			{"xswd.attacker.net", "80"}, // substring "xswd" must NOT pass
		}
		for _, c := range cases {
			if allowed, reason := isAddrAllowed(c.host, c.port); allowed {
				t.Errorf("ON: isAddrAllowed(%q,%q) = true (%s); want false (remote blocked)", c.host, c.port, reason)
			}
		}
	})
}

func TestIsAddrAllowed_OptedInRemoteConfinedToDEROPorts(t *testing.T) {
	// A user who allowlists their remote node host should reach it only on DERO ports,
	// not on arbitrary ports — opting in a host shouldn't open it on :443.
	allowed := append(append([]string{}, defaultAllowed...), "node.example.com")
	withPrivacyMode(true, allowed, func() {
		if ok, reason := isAddrAllowed("node.example.com", "10102"); !ok {
			t.Errorf("opted-in remote on DERO port should pass; got false (%s)", reason)
		}
		if ok, _ := isAddrAllowed("node.example.com", "443"); ok {
			t.Error("opted-in remote on non-DERO port :443 should be blocked")
		}
	})
}

func TestIsAddrAllowed_IPv6FormsCanonicalized(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		// Equivalent spellings of local addresses must be allowed — expanded IPv6
		// previously failed closed against the canonical "::1" allowlist entry.
		pass := []struct{ host, port string }{
			{"0:0:0:0:0:0:0:1", "10102"},
			{"0000:0000:0000:0000:0000:0000:0000:0001", "10102"},
			{"[::1]", "10102"},
			{"::ffff:127.0.0.1", "10102"}, // IPv4-mapped loopback
		}
		for _, c := range pass {
			if allowed, reason := isAddrAllowed(c.host, c.port); !allowed {
				t.Errorf("ON: isAddrAllowed(%q,%q) = false (%s); want true (canonical loopback)", c.host, c.port, reason)
			}
		}
		// Canonicalization must not open remote IPv6.
		for _, host := range []string{"2001:db8::1", "::ffff:203.0.113.7"} {
			if allowed, _ := isAddrAllowed(host, "10102"); allowed {
				t.Errorf("ON: isAddrAllowed(%q,10102) = true; want false (remote IPv6 blocked)", host)
			}
		}
	})

	// Allowlist entries are normalized too: an expanded-form entry matches the
	// canonical host arriving at the dialer.
	expanded := append(append([]string{}, defaultAllowed...), "0:0:0:0:0:0:0:1")
	withPrivacyMode(true, expanded[4:], func() { // allowlist = only the expanded entry
		if allowed, reason := isAddrAllowed("::1", "10102"); !allowed {
			t.Errorf("expanded allowlist entry should match canonical ::1; got false (%s)", reason)
		}
	})
}

func TestIsDEROPort(t *testing.T) {
	allow := []string{"10101", "10102", "20000", "20001", "44326", "9190", "9195", "9199"}
	for _, p := range allow {
		if !isDEROPort(p) {
			t.Errorf("isDEROPort(%q) = false; want true", p)
		}
	}
	deny := []string{"443", "80", "8080", "9189", "9200", "22", ""}
	for _, p := range deny {
		if isDEROPort(p) {
			t.Errorf("isDEROPort(%q) = true; want false", p)
		}
	}
}

func TestCheckRequestAllowed_DelegatesAndBlocksRemote(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		// Localhost URL allowed.
		if ok, reason := checkRequestAllowed("http://127.0.0.1:10102/json_rpc"); !ok {
			t.Errorf("localhost URL should pass; got false (%s)", reason)
		}
		// The old spoof: a remote host containing "dero" / "json_rpc" must now be blocked.
		for _, u := range []string{
			"https://dero.evil.com/",
			"https://evil.com/?x=json_rpc",
			"https://tracker.example.com/pixel.png",
		} {
			if ok, _ := checkRequestAllowed(u); ok {
				t.Errorf("remote URL %q should be blocked under Privacy Mode", u)
			}
		}
	})
}

func TestCheckRequestAllowed_OffAllowsAll(t *testing.T) {
	withPrivacyMode(false, defaultAllowed, func() {
		if ok, _ := checkRequestAllowed("https://anywhere.example.com/x"); !ok {
			t.Error("OFF: remote URL should be allowed (no-op)")
		}
	})
}

func TestIsEndpointAllowed(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		pass := []string{
			"127.0.0.1:10102",
			"http://127.0.0.1:10102",
			"localhost:20000",
			"", // empty resolves to localhost default downstream
		}
		for _, e := range pass {
			if ok, reason := isEndpointAllowed(e); !ok {
				t.Errorf("isEndpointAllowed(%q) = false (%s); want true", e, reason)
			}
		}
		block := []string{
			"203.0.113.7:10102",
			"http://node.evil.com:10102",
			"dero.evil.com:10102",
		}
		for _, e := range block {
			if ok, _ := isEndpointAllowed(e); ok {
				t.Errorf("isEndpointAllowed(%q) = true; want false (remote blocked)", e)
			}
		}
	})
}

func TestPrivacyDialContext_OffDoesNotLog(t *testing.T) {
	// OFF must be a true no-op on the dial hot path: no log append (which takes an
	// exclusive lock) for users who never enable the mode.
	withPrivacyMode(false, defaultAllowed, func() {
		networkFilter.Lock()
		prevLog := networkFilter.connectionLog
		networkFilter.connectionLog = make([]ConnectionLogEntry, 0, 4)
		networkFilter.Unlock()
		defer func() {
			networkFilter.Lock()
			networkFilter.connectionLog = prevLog
			networkFilter.Unlock()
		}()

		// Loopback dial to a closed port: passes policy, fails fast, no egress.
		conn, _ := privacyDialContext(context.Background(), "tcp", "127.0.0.1:1")
		if conn != nil {
			conn.Close()
		}

		networkFilter.RLock()
		n := len(networkFilter.connectionLog)
		networkFilter.RUnlock()
		if n != 0 {
			t.Errorf("OFF-mode dial appended %d connection-log entries; want 0 (true no-op)", n)
		}
	})
}

func TestPrivacyModeRestoredFromSettings(t *testing.T) {
	// Restart-disarm regression: a persisted privacy_mode=true must re-arm the filter
	// on startup. Simulates the post-loadSettings() state and runs the actual restore
	// path used by startup().
	withPrivacyMode(false, defaultAllowed, func() {
		a := &App{settings: map[string]interface{}{"privacy_mode": true}}
		a.restorePrivacyModeFromSettings()
		if !a.GetPrivacyMode() {
			t.Fatal("privacy_mode=true in settings should re-arm Privacy Mode on restore")
		}
	})

	// And the inverse: false (or missing) must NOT arm it.
	for _, settings := range []map[string]interface{}{
		{"privacy_mode": false},
		{},
	} {
		withPrivacyMode(false, defaultAllowed, func() {
			a := &App{settings: settings}
			a.restorePrivacyModeFromSettings()
			if a.GetPrivacyMode() {
				t.Errorf("settings %v should leave Privacy Mode disarmed", settings)
			}
		})
	}
}

func TestPrivacyDialContext_BlocksRemoteWhenOn(t *testing.T) {
	withPrivacyMode(true, defaultAllowed, func() {
		// A blocked remote must return an error WITHOUT dialing (no real connection).
		conn, err := privacyDialContext(context.Background(), "tcp", "203.0.113.7:10102")
		if err == nil {
			if conn != nil {
				conn.Close()
			}
			t.Fatal("privacyDialContext should refuse a remote host in Privacy Mode")
		}
		if _, ok := err.(*blockedConnError); !ok {
			t.Errorf("expected *blockedConnError, got %T: %v", err, err)
		}
	})
}
