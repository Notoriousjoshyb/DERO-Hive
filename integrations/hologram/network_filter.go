package main

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// NetworkFilter implements Privacy Mode - blocking non-DERO network connections

type NetworkFilter struct {
	sync.RWMutex
	enabled      bool
	allowedHosts []string
	blockedCount int64
	allowedCount int64
	connectionLog []ConnectionLogEntry
}

type ConnectionLogEntry struct {
	Timestamp int64  `json:"timestamp"`
	URL       string `json:"url"`
	Host      string `json:"host"`
	Allowed   bool   `json:"allowed"`
	Reason    string `json:"reason"`
}

// Global network filter instance
var networkFilter = &NetworkFilter{
	enabled: false,
	allowedHosts: []string{
		"127.0.0.1",
		"localhost",
		"0.0.0.0",
		"::1",
	},
	connectionLog: make([]ConnectionLogEntry, 0, 1000),
}

// deroPorts is the set of ports that carry legitimate DERO/local traffic, used by
// the address-level allowlist (isAddrAllowed). A connection to one of these ports on
// an allowed host is permitted in Privacy Mode; everything else is blocked.
//   10101 P2P · 10102 daemon RPC · 20000/20001 simulator RPC/P2P · 44326 XSWD · 9190-9199 Gnomon WS
var deroPorts = map[string]bool{
	"10101": true,
	"10102": true,
	"20000": true,
	"20001": true,
	"44326": true,
}

// isDEROPort reports whether port is a known DERO/local service port (including the
// 9190-9199 Gnomon WS query range).
func isDEROPort(port string) bool {
	if deroPorts[port] {
		return true
	}
	// Gnomon WS query server auto-scans 9190-9199.
	if len(port) == 4 && strings.HasPrefix(port, "919") {
		return true
	}
	return false
}

// isAddrAllowed is the address-level policy decision used by the transport-layer
// chokepoint (privacyDialContext). host is a resolved hostname/IP, port is numeric.
//
// This is the OFF fast-path: when Privacy Mode is disabled it returns allow
// immediately, before any allowlist work — guaranteeing zero behavior change for the
// majority who never enable it.
//
// When enabled, the gate is the HOST: only an allowlisted host passes (exact match,
// no substring spoofing — the old isDEROConnection let https://dero.evil.com through).
// The allowlist holds the localhost defaults plus any remote host the user explicitly
// opted into via AddAllowedHost.
//
// Loopback hosts are unrestricted by port (a connection to 127.0.0.1 can't leave the
// machine). For an opted-in REMOTE host, we additionally require a known DERO service
// port — so allowlisting your remote node's host doesn't also open it on :443 or any
// arbitrary port. This keeps the opt-in scoped to DERO traffic.
func isAddrAllowed(host, port string) (bool, string) {
	networkFilter.RLock()
	enabled := networkFilter.enabled
	allowedHosts := networkFilter.allowedHosts
	networkFilter.RUnlock()

	if !enabled {
		return true, "Privacy Mode disabled"
	}

	host = canonicalHost(host)

	allowlisted := false
	for _, allowed := range allowedHosts {
		if host == canonicalHost(allowed) {
			allowlisted = true
			break
		}
	}
	if !allowlisted {
		return false, "Blocked by Privacy Mode"
	}

	// Loopback can't leave the machine — allow any port.
	if isLoopbackHost(host) {
		return true, "Loopback host"
	}

	// Opted-in remote host: confine to DERO service ports.
	if isDEROPort(port) {
		return true, "Allowlisted host on DERO port"
	}
	return false, "Allowlisted host but non-DERO port blocked in Privacy Mode"
}

// canonicalHost lowercases/trims a host and collapses IP literals to their canonical
// form so equivalent spellings compare equal — e.g. the expanded "0:0:0:0:0:0:0:1",
// bracketed "[::1]", and IPv4-mapped "::ffff:127.0.0.1" all become "::1"/"127.0.0.1".
// Without this, legitimate local IPv6 connections fail closed against the "::1"
// allowlist entry. Non-IP hostnames pass through unchanged.
func canonicalHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.Trim(host, "[]")
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
}

// privacyModeEnabled reports whether Privacy Mode is currently armed.
func privacyModeEnabled() bool {
	networkFilter.RLock()
	defer networkFilter.RUnlock()
	return networkFilter.enabled
}

// isLoopbackHost reports whether host is a loopback address that cannot egress.
func isLoopbackHost(host string) bool {
	switch host {
	case "127.0.0.1", "localhost", "::1", "0.0.0.0":
		return true
	}
	return strings.HasPrefix(host, "127.")
}

// isEndpointAllowed is the boundary check for library-internal connects (walletapi,
// Gnomon) that don't expose a dialer hook. endpoint is "host:port" or a URL; we extract
// host+port and run the same policy as the transport chokepoint. Used to refuse a
// non-allowlisted remote daemon before the library opens its own socket.
func isEndpointAllowed(endpoint string) (bool, string) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		// Empty resolves to the localhost default (127.0.0.1:10102) downstream — evaluate
		// it as loopback so it's allowed in both ON and OFF states.
		return isAddrAllowed("127.0.0.1", "10102")
	}

	// Accept either a bare host:port or a scheme://host:port/path URL.
	host, port := "", ""
	if strings.Contains(endpoint, "://") {
		if parsed, err := url.Parse(endpoint); err == nil {
			host = parsed.Hostname()
			port = parsed.Port()
			if port == "" {
				port = defaultPortForScheme(parsed.Scheme)
			}
		}
	}
	if host == "" {
		if h, p, err := net.SplitHostPort(endpoint); err == nil {
			host, port = h, p
		} else {
			host = endpoint // host with no port
		}
	}

	return isAddrAllowed(host, port)
}

// SetPrivacyMode enables or disables Privacy Mode
func (a *App) SetPrivacyMode(enabled bool) map[string]interface{} {
	networkFilter.Lock()
	networkFilter.enabled = enabled
	networkFilter.Unlock()

	// Persist so the mode survives restart — an armed kill switch must not silently
	// disarm (fail open) on relaunch. Saved after releasing the filter lock.
	a.settings["privacy_mode"] = enabled
	a.saveSettings()

	if enabled {
		a.logToConsole("[SHIELD] Privacy Mode ENABLED - Only DERO/localhost connections allowed")
	} else {
		a.logToConsole("[NET] Privacy Mode DISABLED - All connections allowed")
	}

	return map[string]interface{}{
		"success": true,
		"enabled": enabled,
		"message": func() string {
			if enabled {
				return "Privacy Mode enabled - non-DERO connections will be blocked"
			}
			return "Privacy Mode disabled - all connections allowed"
		}(),
	}
}

// restorePrivacyModeFromSettings re-arms the network filter from the persisted
// privacy_mode setting. Must run during startup AFTER loadSettings() and BEFORE
// anything dials out (reconcileDaemonEndpoint tests the daemon connection), so a
// kill switch armed last session gates the very first connections of this one.
func (a *App) restorePrivacyModeFromSettings() {
	enabled, _ := a.settings["privacy_mode"].(bool)
	if !enabled {
		return
	}
	networkFilter.Lock()
	networkFilter.enabled = true
	networkFilter.Unlock()
	a.logToConsole("[SHIELD] Privacy Mode restored from saved settings - non-DERO connections blocked")
}

// GetPrivacyMode returns the current Privacy Mode status
func (a *App) GetPrivacyMode() bool {
	networkFilter.RLock()
	defer networkFilter.RUnlock()
	return networkFilter.enabled
}

// GetNetworkFilterStatus returns detailed network filter status
func (a *App) GetNetworkFilterStatus() map[string]interface{} {
	networkFilter.RLock()
	defer networkFilter.RUnlock()

	return map[string]interface{}{
		"success":      true,
		"enabled":      networkFilter.enabled,
		"allowedHosts": networkFilter.allowedHosts,
		"blockedCount": networkFilter.blockedCount,
		"allowedCount": networkFilter.allowedCount,
	}
}

// IsRequestAllowed checks if a request URL is allowed under current settings
func (a *App) IsRequestAllowed(urlStr string) map[string]interface{} {
	allowed, reason := checkRequestAllowed(urlStr)

	return map[string]interface{}{
		"success": true,
		"url":     urlStr,
		"allowed": allowed,
		"reason":  reason,
	}
}

// AddAllowedHost adds a host to the allowed list
func (a *App) AddAllowedHost(host string) map[string]interface{} {
	networkFilter.Lock()
	defer networkFilter.Unlock()

	// Check if already exists
	for _, h := range networkFilter.allowedHosts {
		if h == host {
			return map[string]interface{}{
				"success": true,
				"message": "Host already in allowed list",
			}
		}
	}

	networkFilter.allowedHosts = append(networkFilter.allowedHosts, host)
	a.logToConsole("[OK] Added to allowed hosts: " + host)

	return map[string]interface{}{
		"success": true,
		"host":    host,
		"message": "Host added to allowed list",
	}
}

// RemoveAllowedHost removes a host from the allowed list
func (a *App) RemoveAllowedHost(host string) map[string]interface{} {
	networkFilter.Lock()
	defer networkFilter.Unlock()

	// Don't allow removing localhost entries
	if host == "127.0.0.1" || host == "localhost" || host == "::1" {
		return map[string]interface{}{
			"success": false,
			"error":   "Cannot remove localhost entries",
		}
	}

	newList := []string{}
	removed := false
	for _, h := range networkFilter.allowedHosts {
		if h != host {
			newList = append(newList, h)
		} else {
			removed = true
		}
	}

	if removed {
		networkFilter.allowedHosts = newList
		a.logToConsole("[OK] Removed from allowed hosts: " + host)
		return map[string]interface{}{
			"success": true,
			"host":    host,
			"message": "Host removed from allowed list",
		}
	}

	return map[string]interface{}{
		"success": false,
		"error":   "Host not found in allowed list",
	}
}

// GetConnectionLog returns recent connection log entries
func (a *App) GetConnectionLog(limit int) map[string]interface{} {
	networkFilter.RLock()
	defer networkFilter.RUnlock()

	if limit <= 0 {
		limit = 100
	}

	log := networkFilter.connectionLog
	if len(log) > limit {
		log = log[len(log)-limit:]
	}

	return map[string]interface{}{
		"success": true,
		"log":     log,
		"count":   len(log),
	}
}

// ClearConnectionLog clears the connection log
func (a *App) ClearConnectionLog() map[string]interface{} {
	networkFilter.Lock()
	defer networkFilter.Unlock()

	networkFilter.connectionLog = make([]ConnectionLogEntry, 0, 1000)
	networkFilter.blockedCount = 0
	networkFilter.allowedCount = 0

	return map[string]interface{}{
		"success": true,
		"message": "Connection log cleared",
	}
}

// Internal helper functions

// checkRequestAllowed is the URL-level policy gate (used by the browser-open path).
// It parses host+port out of the URL and delegates the decision to isAddrAllowed, so
// the URL path and the transport-layer dialer share one hardened policy. The OFF
// fast-path lives in isAddrAllowed.
func checkRequestAllowed(urlStr string) (bool, string) {
	parsed, err := url.Parse(urlStr)
	if err != nil {
		// Can't parse — only allow if the mode is off (let isAddrAllowed decide).
		if allowed, reason := isAddrAllowed("", ""); allowed {
			return true, reason
		}
		return false, "Invalid URL"
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = defaultPortForScheme(parsed.Scheme)
	}

	return isAddrAllowed(host, port)
}

// defaultPortForScheme returns the conventional port for a URL scheme when the URL
// omits one, so the port-aware checks have a value to reason about.
func defaultPortForScheme(scheme string) string {
	switch strings.ToLower(scheme) {
	case "https", "wss":
		return "443"
	case "http", "ws":
		return "80"
	default:
		return ""
	}
}

// LogConnection logs a connection attempt (called from request interceptor)
func logConnection(urlStr string, allowed bool, reason string) {
	networkFilter.Lock()
	defer networkFilter.Unlock()

	parsed, _ := url.Parse(urlStr)
	host := ""
	if parsed != nil {
		host = parsed.Hostname()
	}

	entry := ConnectionLogEntry{
		Timestamp: getCurrentTimestamp(),
		URL:       urlStr,
		Host:      host,
		Allowed:   allowed,
		Reason:    reason,
	}

	networkFilter.connectionLog = append(networkFilter.connectionLog, entry)

	// Keep only last 1000 entries
	if len(networkFilter.connectionLog) > 1000 {
		networkFilter.connectionLog = networkFilter.connectionLog[len(networkFilter.connectionLog)-1000:]
	}

	if allowed {
		networkFilter.allowedCount++
	} else {
		networkFilter.blockedCount++
	}
}

func getCurrentTimestamp() int64 {
	return time.Now().Unix()
}

// Dedupe rapid identical host toasts (e.g. many assets from one domain).
var (
	blockToastMu       sync.Mutex
	blockToastLastHost string
	blockToastLastTime time.Time
)

func emitPrivacyBlockedToast(ctx context.Context, urlStr, host, reason string) {
	if ctx == nil {
		return
	}
	displayHost := host
	if displayHost == "" {
		displayHost = urlStr
		if len(displayHost) > 64 {
			displayHost = displayHost[:61] + "…"
		}
	}

	blockToastMu.Lock()
	now := time.Now()
	if displayHost == blockToastLastHost && now.Sub(blockToastLastTime) < 3*time.Second {
		blockToastMu.Unlock()
		return
	}
	blockToastLastHost, blockToastLastTime = displayHost, now
	blockToastMu.Unlock()

	msg := fmt.Sprintf("Privacy Mode blocked a connection to %s.", displayHost)
	if reason != "" && reason != "Blocked by Privacy Mode" {
		msg = fmt.Sprintf("Privacy Mode blocked %s (%s).", displayHost, reason)
	}

	runtime.EventsEmit(ctx, "toast:show", map[string]interface{}{
		"type":    "warning",
		"message": msg,
	})
}

// checkDaemonEndpointPolicy validates a daemon endpoint before a library-internal connect
// (walletapi/Gnomon) opens its own socket. When Privacy Mode blocks a remote endpoint,
// it emits a "privacy:remote_endpoint_blocked" event so the UI can offer a one-click
// "allow this host" opt-in. Returns whether the connect should proceed.
func (a *App) checkDaemonEndpointPolicy(endpoint string) bool {
	allowed, reason := isEndpointAllowed(endpoint)
	if allowed {
		return true
	}

	host := endpoint
	if h, _, err := net.SplitHostPort(endpoint); err == nil {
		host = h
	}
	a.logToConsole("[SHIELD] Privacy Mode blocked daemon endpoint: " + endpoint + " (" + reason + ")")
	logConnection(endpoint, false, reason)

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "privacy:remote_endpoint_blocked", map[string]interface{}{
			"endpoint": endpoint,
			"host":     host,
			"reason":   reason,
		})
	}
	return false
}

// RequestInterceptor evaluates Privacy Mode for a URL, logs it, and notifies the UI when blocked.
// Call from the frontend before opening external URLs (and eventually from native request hooks).
func (a *App) RequestInterceptor(urlStr string) map[string]interface{} {
	allowed, reason := checkRequestAllowed(urlStr)

	parsed, _ := url.Parse(urlStr)
	host := ""
	if parsed != nil {
		host = parsed.Hostname()
	}

	// Log the connection
	logConnection(urlStr, allowed, reason)

	if !allowed {
		a.logToConsole("[SHIELD] Blocked: " + urlStr + " (" + reason + ")")
		emitPrivacyBlockedToast(a.ctx, urlStr, host, reason)
	}

	return map[string]interface{}{
		"allowed": allowed,
		"reason":  reason,
	}
}

// OpenURLInBrowserIfAllowed runs Privacy Mode for remote URLs, then opens the system browser when allowed.
// file:// and wails:// skip the network policy (no outbound HTTP).
func (a *App) OpenURLInBrowserIfAllowed(urlStr string) map[string]interface{} {
	trimmed := strings.TrimSpace(urlStr)
	if trimmed == "" {
		return map[string]interface{}{"success": false, "error": "empty URL"}
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "invalid URL"}
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme == "file" || scheme == "wails" {
		runtime.BrowserOpenURL(a.ctx, trimmed)
		return map[string]interface{}{"success": true, "allowed": true, "reason": "local scheme"}
	}

	res := a.RequestInterceptor(trimmed)
	allowed, _ := res["allowed"].(bool)
	if !allowed {
		reason, _ := res["reason"].(string)
		return map[string]interface{}{"success": false, "allowed": false, "reason": reason}
	}
	runtime.BrowserOpenURL(a.ctx, trimmed)
	reason, _ := res["reason"].(string)
	return map[string]interface{}{"success": true, "allowed": true, "reason": reason}
}

// GetActiveConnections returns information about active network connections
func (a *App) GetActiveConnections() map[string]interface{} {
	connections := []map[string]interface{}{}

	// XSWD connection
	connections = append(connections, map[string]interface{}{
		"name":      "XSWD (Wallet)",
		"type":      "websocket",
		"endpoint":  "ws://127.0.0.1:44326/xswd",
		"connected": a.xswdClient.IsConnected(),
		"direction": "outbound",
	})

	// Daemon RPC connection
	daemonEndpoint := "http://127.0.0.1:10102"
	if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		daemonEndpoint = ep
	}
	connections = append(connections, map[string]interface{}{
		"name":      "Daemon RPC",
		"type":      "http",
		"endpoint":  daemonEndpoint,
		"connected": a.daemonClient != nil,
		"direction": "outbound",
	})

	// Gnomon indexer
	connections = append(connections, map[string]interface{}{
		"name":      "Gnomon Indexer",
		"type":      "local",
		"endpoint":  "local",
		"connected": a.gnomonClient.IsRunning(),
		"direction": "internal",
	})

	// Node P2P (if embedded node is running)
	nodeManager.RLock()
	nodeRunning := nodeManager.isRunning
	nodeManager.RUnlock()

	if nodeRunning {
		connections = append(connections, map[string]interface{}{
			"name":      "Node P2P",
			"type":      "p2p",
			"endpoint":  "0.0.0.0:10101",
			"connected": true,
			"direction": "bidirectional",
		})
	}

	return map[string]interface{}{
		"success":     true,
		"connections": connections,
		"count":       len(connections),
	}
}

