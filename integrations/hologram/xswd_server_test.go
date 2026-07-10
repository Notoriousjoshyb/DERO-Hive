// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Unit tests for xswd_server.go (XSWD WebSocket Server)

package main

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// ============== Constructor Tests ==============

func TestNewXSWDServer(t *testing.T) {
	app := &App{}
	server := NewXSWDServer(app)

	if server == nil {
		t.Fatal("NewXSWDServer should not return nil")
	}

	if server.app != app {
		t.Error("Server app reference should match")
	}

	if server.clients == nil {
		t.Error("clients map should be initialized")
	}

	if server.pendingRequests == nil {
		t.Error("pendingRequests map should be initialized")
	}

	if server.clientOrigins == nil {
		t.Error("clientOrigins map should be initialized")
	}
}

func TestNewXSWDServer_NilApp(t *testing.T) {
	server := NewXSWDServer(nil)

	if server == nil {
		t.Fatal("NewXSWDServer should not return nil even with nil app")
	}

	if server.app != nil {
		t.Error("Server app should be nil when created with nil")
	}
}

// ============== Server State Tests ==============

func TestXSWDServer_IsRunning_NotStarted(t *testing.T) {
	server := NewXSWDServer(&App{})

	if server.IsRunning() {
		t.Error("IsRunning should return false before Start()")
	}
}

func TestXSWDServer_StopWithoutStart(t *testing.T) {
	server := NewXSWDServer(&App{})

	// Should not panic
	server.Stop()

	if server.IsRunning() {
		t.Error("IsRunning should return false after Stop()")
	}
}

// ============== Wallet Proxy Tests ==============

func TestXSWDServer_IsWalletOpen_NilApp(t *testing.T) {
	server := NewXSWDServer(nil)

	if server.IsWalletOpen() {
		t.Error("IsWalletOpen should return false when app is nil")
	}
}

func TestXSWDServer_IsWalletOpen_NoWallet(t *testing.T) {
	// Ensure wallet is closed
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	app := &App{}
	server := NewXSWDServer(app)

	if server.IsWalletOpen() {
		t.Error("IsWalletOpen should return false when no wallet is open")
	}
}

func TestXSWDServer_GetWalletAddress_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	server := NewXSWDServer(&App{})

	addr := server.GetWalletAddress()
	if addr != "" {
		t.Errorf("GetWalletAddress should return empty string when no wallet, got: %s", addr)
	}
}

func TestXSWDServer_GetWalletBalance_NoWallet(t *testing.T) {
	walletManager.Lock()
	walletManager.isOpen = false
	walletManager.wallet = nil
	walletManager.Unlock()

	server := NewXSWDServer(&App{})

	balance, err := server.GetWalletBalance()

	if err == nil {
		t.Error("GetWalletBalance should return error when no wallet")
	}

	if balance != 0 {
		t.Errorf("GetWalletBalance should return 0 when no wallet, got: %d", balance)
	}
}

// ============== JSON-RPC Structure Tests ==============

func TestJSONRPCRequest_Unmarshal(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		method  string
		id      interface{}
	}{
		{
			"Simple request",
			`{"jsonrpc":"2.0","method":"Ping","id":1}`,
			"Ping",
			float64(1), // JSON numbers unmarshal to float64
		},
		{
			"String ID",
			`{"jsonrpc":"2.0","method":"GetAddress","id":"abc123"}`,
			"GetAddress",
			"abc123",
		},
		{
			"With params",
			`{"jsonrpc":"2.0","method":"Transfer","params":{"amount":100},"id":2}`,
			"Transfer",
			float64(2),
		},
		{
			"Null ID (notification)",
			`{"jsonrpc":"2.0","method":"Notify","id":null}`,
			"Notify",
			nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req JSONRPCRequest
			if err := json.Unmarshal([]byte(tt.json), &req); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}

			if req.Method != tt.method {
				t.Errorf("Method = %s, expected %s", req.Method, tt.method)
			}

			if req.ID != tt.id {
				t.Errorf("ID = %v (%T), expected %v (%T)", req.ID, req.ID, tt.id, tt.id)
			}

			if req.JSONRPC != "2.0" {
				t.Errorf("JSONRPC = %s, expected 2.0", req.JSONRPC)
			}
		})
	}
}

func TestJSONRPCResponse_Marshal(t *testing.T) {
	tests := []struct {
		name     string
		resp     JSONRPCResponse
		contains []string
	}{
		{
			"Success response",
			JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      1,
				Result:  map[string]string{"status": "ok"},
			},
			[]string{`"jsonrpc":"2.0"`, `"result"`, `"status":"ok"`},
		},
		{
			"Error response",
			JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      2,
				Error:   &JSONRPCError{Code: -32600, Message: "Invalid Request"},
			},
			[]string{`"error"`, `"code":-32600`, `"Invalid Request"`},
		},
		{
			"Null result",
			JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      3,
				Result:  nil,
			},
			[]string{`"jsonrpc":"2.0"`, `"id":3`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.resp)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}

			jsonStr := string(data)
			for _, substr := range tt.contains {
				if !containsString(jsonStr, substr) {
					t.Errorf("Expected JSON to contain %q, got: %s", substr, jsonStr)
				}
			}
		})
	}
}

func TestJSONRPCError_Structure(t *testing.T) {
	err := JSONRPCError{
		Code:    -32601,
		Message: "Method not found",
	}

	data, _ := json.Marshal(err)
	jsonStr := string(data)

	if !containsString(jsonStr, "-32601") {
		t.Error("JSON should contain error code")
	}

	if !containsString(jsonStr, "Method not found") {
		t.Error("JSON should contain error message")
	}
}

// Standard JSON-RPC error codes
func TestJSONRPCErrorCodes(t *testing.T) {
	errorCodes := map[int]string{
		-32700: "Parse error",
		-32600: "Invalid Request",
		-32601: "Method not found",
		-32602: "Invalid params",
		-32603: "Internal error",
		-32000: "Server error (wallet not open, etc)",
		-32003: "Permission denied",
	}

	for code, desc := range errorCodes {
		t.Run(desc, func(t *testing.T) {
			err := JSONRPCError{Code: code, Message: desc}
			if err.Code != code {
				t.Errorf("Code = %d, expected %d", err.Code, code)
			}
		})
	}
}

// ============== Pending Request Tests ==============

func TestXSWDPendingRequest_Structure(t *testing.T) {
	resChan := make(chan interface{}, 1)

	req := XSWDPendingRequest{
		Method:   "transfer",
		Params:   map[string]interface{}{"amount": 100},
		RespChan: resChan,
	}

	if req.Method != "transfer" {
		t.Error("Method mismatch")
	}

	if req.Params["amount"] != 100 {
		t.Error("Params mismatch")
	}

	// Test channel communication
	go func() {
		req.RespChan <- map[string]interface{}{"success": true}
	}()

	select {
	case resp := <-req.RespChan:
		if respMap, ok := resp.(map[string]interface{}); ok {
			if respMap["success"] != true {
				t.Error("Response should contain success=true")
			}
		} else {
			t.Error("Response should be a map")
		}
	case <-time.After(time.Second):
		t.Error("Timeout waiting for response")
	}
}

func TestXSWDServer_PendingRequests_Add(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "test-req-1"
	resChan := make(chan interface{}, 1)

	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "GetAddress",
		Params:   map[string]interface{}{},
		RespChan: resChan,
	}
	server.pendingLock.Unlock()

	// Verify it was added
	server.pendingLock.Lock()
	req, exists := server.pendingRequests[reqID]
	server.pendingLock.Unlock()

	if !exists {
		t.Fatal("Request should exist in pendingRequests")
	}

	if req.Method != "GetAddress" {
		t.Errorf("Method = %s, expected GetAddress", req.Method)
	}
}

func TestXSWDServer_PendingRequests_Delete(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "test-req-delete"
	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "test",
		RespChan: make(chan interface{}, 1),
	}
	server.pendingLock.Unlock()

	// Delete it
	server.pendingLock.Lock()
	delete(server.pendingRequests, reqID)
	server.pendingLock.Unlock()

	// Verify deletion
	server.pendingLock.Lock()
	_, exists := server.pendingRequests[reqID]
	server.pendingLock.Unlock()

	if exists {
		t.Error("Request should be deleted")
	}
}

// ============== ProcessApproval Tests ==============

func TestProcessApproval_UnknownRequestID(t *testing.T) {
	server := NewXSWDServer(&App{})

	// Should not panic with unknown ID
	server.ProcessApproval("nonexistent-id", true, "password")
}

func TestProcessApprovalWithPermissions_UnknownRequestID(t *testing.T) {
	server := NewXSWDServer(&App{})

	// Should not panic with unknown ID
	server.ProcessApprovalWithPermissions("nonexistent-id", true, "password", []string{"view_address"})
}

func TestProcessApproval_HandshakeDenied(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "handshake-deny-test"
	resChan := make(chan interface{}, 1)

	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "handshake",
		Params:   map[string]interface{}{"name": "TestApp"},
		RespChan: resChan,
	}
	server.pendingLock.Unlock()

	// Process denial in goroutine
	go func() {
		server.ProcessApproval(reqID, false, "")
	}()

	// Wait for response
	select {
	case resp := <-resChan:
		if err, ok := resp.(error); ok {
			if err.Error() != "User denied wallet connection" {
				t.Errorf("Unexpected error message: %s", err.Error())
			}
		} else {
			t.Error("Expected error response for denied handshake")
		}
	case <-time.After(time.Second):
		t.Error("Timeout waiting for denial response")
	}
}

func TestProcessApproval_HandshakeApproved(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "handshake-approve-test"
	resChan := make(chan interface{}, 1)

	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "handshake",
		Params:   map[string]interface{}{"name": "TestApp"},
		RespChan: resChan,
	}
	server.pendingLock.Unlock()

	go func() {
		server.ProcessApproval(reqID, true, "")
	}()

	select {
	case resp := <-resChan:
		if respMap, ok := resp.(map[string]interface{}); ok {
			if respMap["message"] != "Wallet connection approved" {
				t.Errorf("Unexpected message: %v", respMap["message"])
			}
		} else {
			t.Error("Expected map response for approved handshake")
		}
	case <-time.After(time.Second):
		t.Error("Timeout waiting for approval response")
	}
}

func TestProcessApprovalWithPermissions_HandshakeWithPerms(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "handshake-perms-test"
	resChan := make(chan interface{}, 1)

	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "handshake",
		Params:   map[string]interface{}{"name": "TestApp"},
		RespChan: resChan,
	}
	server.pendingLock.Unlock()

	permissions := []string{"view_address", "view_balance"}

	go func() {
		server.ProcessApprovalWithPermissions(reqID, true, "", permissions)
	}()

	select {
	case resp := <-resChan:
		if respMap, ok := resp.(map[string]interface{}); ok {
			perms, ok := respMap["permissions"].([]interface{})
			if !ok {
				t.Fatal("Expected permissions in response")
			}
			if len(perms) != 2 {
				t.Errorf("Expected 2 permissions, got %d", len(perms))
			}
		} else {
			t.Error("Expected map response")
		}
	case <-time.After(time.Second):
		t.Error("Timeout")
	}
}

func TestProcessApproval_RequestDenied(t *testing.T) {
	server := NewXSWDServer(&App{})

	reqID := "request-deny-test"
	resChan := make(chan interface{}, 1)

	server.pendingLock.Lock()
	server.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "transfer",
		Params:   map[string]interface{}{"amount": 100},
		RespChan: resChan,
	}
	server.pendingLock.Unlock()

	go func() {
		server.ProcessApproval(reqID, false, "")
	}()

	select {
	case resp := <-resChan:
		if err, ok := resp.(error); ok {
			if err.Error() != "User denied request" {
				t.Errorf("Unexpected error: %s", err.Error())
			}
		} else {
			t.Error("Expected error for denied request")
		}
	case <-time.After(time.Second):
		t.Error("Timeout")
	}
}

// ============== Client Origin Tracking Tests ==============

func TestXSWDServer_ClientOrigins_Empty(t *testing.T) {
	server := NewXSWDServer(&App{})

	server.lock.RLock()
	count := len(server.clientOrigins)
	server.lock.RUnlock()

	if count != 0 {
		t.Errorf("Expected 0 client origins initially, got %d", count)
	}
}

// ============== Concurrent Access Tests ==============

func TestXSWDServer_ConcurrentPendingRequests(t *testing.T) {
	server := NewXSWDServer(&App{})

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent adds
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			reqID := string(rune('A' + id%26))
			server.pendingLock.Lock()
			server.pendingRequests[reqID] = &XSWDPendingRequest{
				Method:   "test",
				RespChan: make(chan interface{}, 1),
			}
			server.pendingLock.Unlock()
		}(i)
	}

	// Concurrent reads
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			server.pendingLock.Lock()
			_ = len(server.pendingRequests)
			server.pendingLock.Unlock()
		}(i)
	}

	// Concurrent deletes
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			reqID := string(rune('A' + id%26))
			server.pendingLock.Lock()
			delete(server.pendingRequests, reqID)
			server.pendingLock.Unlock()
		}(i)
	}

	wg.Wait()
	// No race conditions = success
}

func TestXSWDServer_ConcurrentClientTracking(t *testing.T) {
	server := NewXSWDServer(&App{})

	var wg sync.WaitGroup
	iterations := 50

	// Concurrent operations on clients map
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			server.lock.Lock()
			_ = len(server.clients)
			server.lock.Unlock()
		}()
	}

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			server.lock.RLock()
			_ = len(server.clientOrigins)
			server.lock.RUnlock()
		}()
	}

	wg.Wait()
	// No race conditions = success
}

// ============== Benchmark Tests ==============

func BenchmarkJSONRPCRequest_Unmarshal(b *testing.B) {
	jsonData := []byte(`{"jsonrpc":"2.0","method":"GetBalance","params":{},"id":1}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var req JSONRPCRequest
		json.Unmarshal(jsonData, &req)
	}
}

func BenchmarkJSONRPCResponse_Marshal(b *testing.B) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      1,
		Result:  map[string]interface{}{"balance": 1000000, "locked_balance": 0},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(resp)
	}
}

func BenchmarkNewXSWDServer(b *testing.B) {
	app := &App{}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewXSWDServer(app)
	}
}

func BenchmarkXSWDServer_IsRunning(b *testing.B) {
	server := NewXSWDServer(&App{})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		server.IsRunning()
	}
}

func BenchmarkXSWDServer_PendingRequestLookup(b *testing.B) {
	server := NewXSWDServer(&App{})

	// Pre-populate
	for i := 0; i < 100; i++ {
		reqID := string(rune('A'+i%26)) + string(rune('0'+i%10))
		server.pendingRequests[reqID] = &XSWDPendingRequest{
			Method:   "test",
			RespChan: make(chan interface{}, 1),
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		reqID := string(rune('A'+i%26)) + string(rune('0'+i%10))
		server.pendingLock.Lock()
		_ = server.pendingRequests[reqID]
		server.pendingLock.Unlock()
	}
}

// Helper function
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
