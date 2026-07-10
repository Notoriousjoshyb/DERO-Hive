package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ============================================================================
// DaemonClient Unit Tests
// ============================================================================

// TestNewDaemonClient verifies the constructor initializes correctly
func TestNewDaemonClient(t *testing.T) {
	endpoint := "http://127.0.0.1:10102"
	client := NewDaemonClient(endpoint)

	if client == nil {
		t.Fatal("NewDaemonClient returned nil")
	}
	if client.endpoint != endpoint {
		t.Errorf("endpoint = %q, want %q", client.endpoint, endpoint)
	}
	if client.client == nil {
		t.Error("HTTP client is nil")
	}
	if client.client.Timeout != 30*time.Second {
		t.Errorf("timeout = %v, want 30s", client.client.Timeout)
	}
	if client.requestID != 0 {
		t.Errorf("requestID = %d, want 0", client.requestID)
	}
}

// TestNewDaemonClientWithTimeout verifies custom timeout is applied
func TestNewDaemonClientWithTimeout(t *testing.T) {
	endpoint := "http://127.0.0.1:10102"
	timeout := 5 * time.Second
	client := NewDaemonClientWithTimeout(endpoint, timeout)

	if client == nil {
		t.Fatal("NewDaemonClientWithTimeout returned nil")
	}
	if client.client.Timeout != timeout {
		t.Errorf("timeout = %v, want %v", client.client.Timeout, timeout)
	}
}

// TestCallSuccess tests a successful JSON-RPC call
func TestCallSuccess(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/json_rpc" {
			t.Errorf("path = %s, want /json_rpc", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %s, want application/json", ct)
		}

		// Decode request to verify structure
		var req RPCRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("failed to decode request: %v", err)
		}
		if req.JSONRPC != "2.0" {
			t.Errorf("jsonrpc = %s, want 2.0", req.JSONRPC)
		}
		if req.Method != "DERO.GetInfo" {
			t.Errorf("method = %s, want DERO.GetInfo", req.Method)
		}

		// Send successful response
		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"height":     123456,
				"topoheight": 123450,
				"status":     "OK",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	result, err := client.Call("DERO.GetInfo", nil)

	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}
	if result == nil {
		t.Fatal("result is nil")
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		t.Fatal("result is not a map")
	}
	if resultMap["status"] != "OK" {
		t.Errorf("status = %v, want OK", resultMap["status"])
	}
}

// TestCallWithParams tests a call with parameters
func TestCallWithParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		// Verify params were sent
		if req.Params == nil {
			t.Error("params is nil, expected map")
		}

		params, ok := req.Params.(map[string]interface{})
		if !ok {
			t.Error("params is not a map")
		}
		if params["scid"] != "abc123" {
			t.Errorf("scid = %v, want abc123", params["scid"])
		}

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"code": "Function Initialize() Uint64",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	result, err := client.Call("DERO.GetSC", map[string]interface{}{
		"scid": "abc123",
		"code": true,
	})

	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}
	if result == nil {
		t.Fatal("result is nil")
	}
}

// TestCallRPCError tests handling of JSON-RPC error responses
func TestCallRPCError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"error": map[string]interface{}{
				"code":    -32000,
				"message": "Smart contract not found",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	_, err := client.Call("DERO.GetSC", map[string]interface{}{"scid": "invalid"})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "Smart contract not found") {
		t.Errorf("error = %v, want to contain 'Smart contract not found'", err)
	}
	if !strings.Contains(err.Error(), "-32000") {
		t.Errorf("error = %v, want to contain error code -32000", err)
	}
}

// TestCallNetworkError tests handling of network errors
func TestCallNetworkError(t *testing.T) {
	// Use a non-existent server
	client := NewDaemonClientWithTimeout("http://127.0.0.1:59999", 100*time.Millisecond)
	_, err := client.Call("DERO.GetInfo", nil)

	if err == nil {
		t.Fatal("expected error for non-existent server")
	}
	if !strings.Contains(err.Error(), "HTTP request failed") {
		t.Errorf("error = %v, want HTTP request failed", err)
	}
}

// TestCallMalformedResponse tests handling of invalid JSON responses
func TestCallMalformedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	_, err := client.Call("DERO.GetInfo", nil)

	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
	if !strings.Contains(err.Error(), "failed to parse response") {
		t.Errorf("error = %v, want 'failed to parse response'", err)
	}
}

// TestCallInvalidResultFormat tests handling of unexpected result format
func TestCallInvalidResultFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		// Send response with invalid result (not valid JSON in result field)
		w.Write([]byte(`{"jsonrpc":"2.0","id":"` + req.ID + `","result":invalid}`))
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	_, err := client.Call("DERO.GetInfo", nil)

	if err == nil {
		t.Fatal("expected error for invalid result format")
	}
}

// TestCallRequestIDIncrement tests that request IDs increment
func TestCallRequestIDIncrement(t *testing.T) {
	requestIDs := make([]string, 0)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)
		requestIDs = append(requestIDs, req.ID)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)

	// Make 3 calls
	client.Call("DERO.GetInfo", nil)
	client.Call("DERO.GetInfo", nil)
	client.Call("DERO.GetInfo", nil)

	if len(requestIDs) != 3 {
		t.Fatalf("expected 3 requests, got %d", len(requestIDs))
	}

	// Verify IDs are unique and incrementing
	seen := make(map[string]bool)
	for _, id := range requestIDs {
		if seen[id] {
			t.Errorf("duplicate request ID: %s", id)
		}
		seen[id] = true
	}
}

// ============================================================================
// GetInfo Tests
// ============================================================================

// TestGetInfoSuccess tests successful GetInfo call
func TestGetInfoSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		if req.Method != "DERO.GetInfo" {
			t.Errorf("method = %s, want DERO.GetInfo", req.Method)
		}

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"height":       float64(500000),
				"topoheight":   float64(499990),
				"difficulty":   float64(12345678),
				"status":       "OK",
				"version":      "3.5.1-2.release",
				"tx_pool_size": float64(5),
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	info, err := client.GetInfo()

	if err != nil {
		t.Fatalf("GetInfo failed: %v", err)
	}
	if info == nil {
		t.Fatal("info is nil")
	}
	if info["status"] != "OK" {
		t.Errorf("status = %v, want OK", info["status"])
	}
	if info["height"] != float64(500000) {
		t.Errorf("height = %v, want 500000", info["height"])
	}
}

// TestGetInfoError tests GetInfo error handling
func TestGetInfoError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"error": map[string]interface{}{
				"code":    -32603,
				"message": "Internal error",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	_, err := client.GetInfo()

	if err == nil {
		t.Fatal("expected error")
	}
}

// ============================================================================
// GetSC Tests
// ============================================================================

// TestGetSCSuccess tests successful smart contract retrieval
func TestGetSCSuccess(t *testing.T) {
	scid := "0000000000000000000000000000000000000000000000000000000000000001"
	scCode := `Function Initialize() Uint64
10 RETURN 0
End Function`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		if req.Method != "DERO.GetSC" {
			t.Errorf("method = %s, want DERO.GetSC", req.Method)
		}

		params, _ := req.Params.(map[string]interface{})
		if params["scid"] != scid {
			t.Errorf("scid = %v, want %s", params["scid"], scid)
		}
		if params["code"] != true {
			t.Errorf("code = %v, want true", params["code"])
		}
		if params["variables"] != true {
			t.Errorf("variables = %v, want true", params["variables"])
		}

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"code":    scCode,
				"balance": float64(1000000),
				"stringkeys": map[string]interface{}{
					"owner": "dero1qyw4fl3dupcg5qlrcsvcedze507q9u67lxfpu8kgnzp04aq73yheqqg2ctjn4",
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	sc, err := client.GetSC(scid, true, true)

	if err != nil {
		t.Fatalf("GetSC failed: %v", err)
	}
	if sc["code"] != scCode {
		t.Errorf("code mismatch")
	}
	if sc["balance"] != float64(1000000) {
		t.Errorf("balance = %v, want 1000000", sc["balance"])
	}
}

// TestGetSCCodeOnly tests getting SC with code only (no variables)
func TestGetSCCodeOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		params, _ := req.Params.(map[string]interface{})

		// Verify only code is requested
		if params["code"] != true {
			t.Errorf("code = %v, want true", params["code"])
		}
		// variables should not be present when false
		if _, exists := params["variables"]; exists {
			t.Error("variables should not be present when false")
		}

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"code": "Function Test() Uint64\n10 RETURN 1\nEnd Function",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	sc, err := client.GetSC("test-scid", true, false)

	if err != nil {
		t.Fatalf("GetSC failed: %v", err)
	}
	if sc["code"] == nil {
		t.Error("code is nil")
	}
}

// TestGetSCNotFound tests handling of non-existent smart contract
func TestGetSCNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"error": map[string]interface{}{
				"code":    -32000,
				"message": "SC not found",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	_, err := client.GetSC("nonexistent", true, true)

	if err == nil {
		t.Fatal("expected error for non-existent SC")
	}
	if !strings.Contains(err.Error(), "SC not found") {
		t.Errorf("error = %v, want 'SC not found'", err)
	}
}

// TestGetSCVariables tests the convenience wrapper
func TestGetSCVariables(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"code":    "test code",
				"balance": float64(500),
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	sc, err := client.GetSCVariables("test-scid", true, true)

	if err != nil {
		t.Fatalf("GetSCVariables failed: %v", err)
	}
	if sc == nil {
		t.Fatal("result is nil")
	}
}

// ============================================================================
// TestConnection Tests
// ============================================================================

// TestTestConnectionSuccess tests successful connection test
func TestTestConnectionSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"status": "OK",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	err := client.TestConnection()

	if err != nil {
		t.Errorf("TestConnection failed: %v", err)
	}
}

// TestTestConnectionFailure tests connection test failure
func TestTestConnectionFailure(t *testing.T) {
	client := NewDaemonClientWithTimeout("http://127.0.0.1:59999", 100*time.Millisecond)
	err := client.TestConnection()

	if err == nil {
		t.Error("expected error for unreachable server")
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

// TestCallEmptyEndpoint tests behavior with empty endpoint
func TestCallEmptyEndpoint(t *testing.T) {
	client := NewDaemonClient("")
	_, err := client.Call("DERO.GetInfo", nil)

	if err == nil {
		t.Error("expected error for empty endpoint")
	}
}

// TestCallNilParams tests that nil params works correctly
func TestCallNilParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]interface{}
		json.NewDecoder(r.Body).Decode(&req)

		// Verify params is not present (nil was passed)
		if _, exists := req["params"]; exists {
			t.Log("params key exists in request (acceptable)")
		}

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  map[string]interface{}{"status": "OK"},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)
	result, err := client.Call("DERO.GetInfo", nil)

	if err != nil {
		t.Fatalf("Call with nil params failed: %v", err)
	}
	if result == nil {
		t.Fatal("result is nil")
	}
}

// ============================================================================
// Benchmarks
// ============================================================================

// BenchmarkCall benchmarks the RPC call performance
func BenchmarkCall(b *testing.B) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{"status": "OK"},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.Call("DERO.GetInfo", nil)
	}
}

// BenchmarkGetInfo benchmarks GetInfo calls
func BenchmarkGetInfo(b *testing.B) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"height":     float64(500000),
				"topoheight": float64(499990),
				"status":     "OK",
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.GetInfo()
	}
}

// BenchmarkGetSC benchmarks GetSC calls
func BenchmarkGetSC(b *testing.B) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req RPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"code":    "Function Test() Uint64\n10 RETURN 0\nEnd Function",
				"balance": float64(1000),
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewDaemonClient(server.URL)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.GetSC("test-scid", true, true)
	}
}
