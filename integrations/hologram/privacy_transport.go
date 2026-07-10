package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// privacy_transport.go installs Privacy Mode at the transport layer.
//
// The old "Privacy Mode" was advisory: it only blocked URLs that voluntarily called
// the filter, so every programmatic client (daemon RPC, gnomon, XSWD, transitive libs)
// dialed out unchecked. This moves enforcement down to the dialer — the chokepoint every
// TCP connection must pass through — so code *cannot* forget to ask. isAddrAllowed sees
// the resolved host:port (post-DNS), closing the DNS-rebinding gap a URL check misses.
//
// When Privacy Mode is OFF, isAddrAllowed returns allow immediately, so this path is a
// no-op for the majority who never enable it — the base dialer behaves exactly as the Go
// default would.
//
// IMPORTANT: this file is the ONLY place permitted to construct a bare net dialer for
// outbound HTTP/WS clients. A CI guard (forbidden-symbols) fails the build if a raw HTTP
// client literal or the gorilla default WS dialer reappears elsewhere, so the chokepoint
// can't silently regress. Use newPrivacyHTTPClient / privacyWSDialer instead.

// privacyBaseDialer is the underlying dialer used once a connection is allowed. Values
// mirror Go's http.DefaultTransport so OFF-mode behavior is unchanged.
var privacyBaseDialer = &net.Dialer{
	Timeout:   30 * time.Second,
	KeepAlive: 30 * time.Second,
}

// blockedConnError signals a connection refused by Privacy Mode. It satisfies the
// error interface and carries the policy reason for logging/UX.
type blockedConnError struct {
	addr   string
	reason string
}

func (e *blockedConnError) Error() string {
	return fmt.Sprintf("blocked by Privacy Mode: %s (%s)", e.addr, e.reason)
}

// privacyDialContext is the enforcement point. It runs the resolved address through
// isAddrAllowed before any socket is opened; on deny it logs, surfaces a deduped toast,
// and returns an error so the connection never happens.
func privacyDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// Couldn't parse — treat the whole addr as host with no port.
		host, port = addr, ""
	}

	// Read the mode once; only log while armed. With the mode OFF this path must be a
	// true no-op — no exclusive lock, no log append — so the default-config dial cost
	// is unchanged for users who never enable it.
	enabled := privacyModeEnabled()
	allowed, reason := isAddrAllowed(host, port)
	if !allowed {
		logConnection(addr, false, reason)
		emitPrivacyBlockedConn(addr, host, reason)
		return nil, &blockedConnError{addr: addr, reason: reason}
	}
	if enabled {
		logConnection(addr, true, reason)
	}

	return privacyBaseDialer.DialContext(ctx, network, addr)
}

// newPrivacyTransport returns an *http.Transport whose DialContext is gated by Privacy
// Mode. It otherwise matches http.DefaultTransport's tunables so OFF behavior is identical.
func newPrivacyTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           privacyDialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

// newPrivacyHTTPClient builds an *http.Client whose every connection is gated by the
// Privacy Mode dialer. Use this in place of a bare &http.Client{...}.
func newPrivacyHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: newPrivacyTransport(),
	}
}

// privacyWSDialer returns a gorilla/websocket dialer gated by Privacy Mode. Use this
// for outbound WS connections in place of the package default dialer.
func privacyWSDialer() *websocket.Dialer {
	return &websocket.Dialer{
		NetDialContext:   privacyDialContext,
		HandshakeTimeout: 45 * time.Second,
	}
}

// privacyApp is a package-level handle to the running App, set once in startup. It is
// used only to surface blocked-connection toasts from the dialer (which has no App
// receiver). Read-only after startup; nil before the UI exists.
var privacyApp *App

// installPrivacyTransport routes Go's shared http.DefaultClient / DefaultTransport through
// the Privacy Mode dialer so transitive libraries that use the default client are captured
// too, and records the App handle for blocked-connection toasts. Call once at startup.
func installPrivacyTransport(a *App) {
	privacyApp = a
	t := newPrivacyTransport()
	http.DefaultTransport = t
	http.DefaultClient.Transport = t

	// Gate gorilla's shared default WS dialer the same way: walletapi (daemon sync,
	// 5 dial sites) and Gnomon (indexer, 6 sites) dial through this package var inside
	// their libraries — including walletapi's Keep_Connectivity reconnect loop — so this
	// one assignment is the socket-level chokepoint for all of them. Go links a single
	// gorilla/websocket instance into the binary, and Dial derefs the var at call time,
	// so the gate also covers connections initiated long after startup.
	websocket.DefaultDialer.NetDialContext = privacyDialContext
}

// emitPrivacyBlockedConn surfaces a blocked programmatic connection to the UI, reusing the
// dedup logic from network_filter.go's browser-path toast. Safe before the UI exists.
func emitPrivacyBlockedConn(addr, host, reason string) {
	if privacyApp == nil {
		return
	}
	emitPrivacyBlockedToast(privacyApp.ctx, addr, host, reason)
}
