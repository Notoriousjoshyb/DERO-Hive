package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"
)

// BlockchainClient defines the interface for blockchain RPC operations.
// This enables dependency injection and mocking in tests.
type BlockchainClient interface {
	Call(method string, params interface{}) (interface{}, error)
	GetInfo() (map[string]interface{}, error)
	GetSC(scid string, code, variables bool) (map[string]interface{}, error)
	GetSCVariables(scid string, code, variables bool) (map[string]interface{}, error)
	TestConnection() error
	GetEndpoint() string
	SetEndpoint(endpoint string)
}

// DaemonClient handles direct RPC connection to DERO daemon
type DaemonClient struct {
	endpoint  string
	client    *http.Client
	requestID uint64
}

// NewDaemonClient creates a new daemon RPC client.
// The HTTP client is gated by Privacy Mode at the dialer (privacy_transport.go).
func NewDaemonClient(endpoint string) *DaemonClient {
	return &DaemonClient{
		endpoint:  endpoint,
		client:    newPrivacyHTTPClient(30 * time.Second), // Reasonable timeout for blockchain queries
		requestID: 0,
	}
}

// NewDaemonClientWithTimeout creates a daemon client with a custom timeout.
// The HTTP client is gated by Privacy Mode at the dialer (privacy_transport.go).
func NewDaemonClientWithTimeout(endpoint string, timeout time.Duration) *DaemonClient {
	return &DaemonClient{
		endpoint:  endpoint,
		client:    newPrivacyHTTPClient(timeout),
		requestID: 0,
	}
}

// GetEndpoint returns the daemon endpoint URL
func (d *DaemonClient) GetEndpoint() string {
	return d.endpoint
}

// SetEndpoint updates the daemon endpoint URL
func (d *DaemonClient) SetEndpoint(endpoint string) {
	d.endpoint = endpoint
}

// RPCRequest represents a JSON-RPC 2.0 request
type RPCRequest struct {
	JSONRPC string       `json:"jsonrpc"`
	ID      string       `json:"id"`
	Method  string       `json:"method"`
	Params  interface{}  `json:"params,omitempty"`
}

// RPCResponse represents a JSON-RPC 2.0 response
type RPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError represents a JSON-RPC error
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Call makes a JSON-RPC call to the daemon
func (d *DaemonClient) Call(method string, params interface{}) (interface{}, error) {
	// Generate unique request ID
	id := atomic.AddUint64(&d.requestID, 1)

	// Create request - only include Params if not nil
	req := RPCRequest{
		JSONRPC: "2.0",
		ID:      fmt.Sprintf("%d", id),
		Method:  method,
	}
	
	// Only set Params if provided
	if params != nil {
		req.Params = params
	}

	// Marshal request
	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Send HTTP POST request
	resp, err := d.client.Post(
		d.endpoint+"/json_rpc",
		"application/json",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Parse response
	var rpcResp RPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Check for error
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	// Parse result
	var result interface{}
	if err := json.Unmarshal(rpcResp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to parse result: %w", err)
	}

	return result, nil
}

// GetInfo calls DERO.GetInfo
func (d *DaemonClient) GetInfo() (map[string]interface{}, error) {
	// DERO.GetInfo accepts no parameters (send nil, not empty map)
	result, err := d.Call("DERO.GetInfo", nil)
	if err != nil {
		return nil, err
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return resultMap, nil
}

// GetSC calls DERO.GetSC
func (d *DaemonClient) GetSC(scid string, code, variables bool) (map[string]interface{}, error) {
	params := map[string]interface{}{
		"scid": scid,
	}

	if code {
		params["code"] = true
	}
	if variables {
		params["variables"] = true
	}

	result, err := d.Call("DERO.GetSC", params)
	if err != nil {
		return nil, err
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	return resultMap, nil
}

// GetSCVariables is a convenience method that calls GetSC with variables=true
func (d *DaemonClient) GetSCVariables(scid string, code, variables bool) (map[string]interface{}, error) {
	return d.GetSC(scid, code, variables)
}

// TestConnection tests if daemon is responding
func (d *DaemonClient) TestConnection() error {
	_, err := d.GetInfo()
	return err
}

