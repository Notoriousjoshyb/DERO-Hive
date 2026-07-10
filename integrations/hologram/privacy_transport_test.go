// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Tests for the transport-layer chokepoint installation (privacy_transport.go).

package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// TestInstallPrivacyTransport_GatesGorillaDefaultDialer locks in the socket-level gate
// for library-internal WebSocket dials: walletapi and Gnomon both dial the daemon through
// gorilla's shared DefaultDialer (including walletapi's Keep_Connectivity reconnect loop),
// so after installPrivacyTransport a blocked remote must fail at the dialer without a
// socket ever opening.
func TestInstallPrivacyTransport_GatesGorillaDefaultDialer(t *testing.T) {
	prevTransport := http.DefaultTransport
	prevClientTransport := http.DefaultClient.Transport
	prevNetDial := websocket.DefaultDialer.NetDialContext
	prevApp := privacyApp
	defer func() {
		http.DefaultTransport = prevTransport
		http.DefaultClient.Transport = prevClientTransport
		websocket.DefaultDialer.NetDialContext = prevNetDial
		privacyApp = prevApp
	}()

	installPrivacyTransport(&App{settings: map[string]interface{}{}})

	if websocket.DefaultDialer.NetDialContext == nil {
		t.Fatal("installPrivacyTransport must gate websocket.DefaultDialer.NetDialContext")
	}

	withPrivacyMode(true, defaultAllowed, func() {
		_, _, err := websocket.DefaultDialer.Dial("ws://203.0.113.7:10102/ws", nil)
		if err == nil {
			t.Fatal("gorilla DefaultDialer should refuse a remote host in Privacy Mode")
		}
		if !strings.Contains(err.Error(), "blocked by Privacy Mode") {
			t.Errorf("expected Privacy Mode block error from the gated dialer, got: %v", err)
		}
	})
}
