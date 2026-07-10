package main

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// EventCallback type for event handlers
type EventCallback func(event string, data interface{})

// XSWDClient manages the WebSocket connection to XSWD (wallet/Engram)
type XSWDClient struct {
	conn             *websocket.Conn
	connected        bool
	endpoint         string
	pendingRequests  map[string]*PendingRequest
	eventCallbacks   map[string]EventCallback // Event subscription callbacks
	requestMutex     sync.RWMutex
	eventMutex       sync.RWMutex // Protects eventCallbacks
	writeMutex       sync.Mutex
	reconnectAttempt int
	maxReconnect     int
	ctx              context.Context
	cancel           context.CancelFunc
}

// PendingRequest tracks requests waiting for responses
type PendingRequest struct {
	ID       string
	Method   string
	Result   chan interface{}
	Error    chan error
	SentAt   time.Time
	Timeout  time.Duration
}

// XSWDMessage represents a JSON-RPC 2.0 message
type XSWDMessage struct {
	JSONRPC string                 `json:"jsonrpc"`
	ID      string                 `json:"id,omitempty"`
	Method  string                 `json:"method,omitempty"`
	Params  map[string]interface{} `json:"params,omitempty"`
	Result  interface{}            `json:"result,omitempty"`
	Error   *XSWDError             `json:"error,omitempty"`
}

// XSWDError represents a JSON-RPC error
type XSWDError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// AuthorizationResponse from XSWD
type AuthorizationResponse struct {
	Message  string `json:"message"`
	Accepted bool   `json:"accepted"`
}

// NewXSWDClient creates a new XSWD client instance
func NewXSWDClient() *XSWDClient {
	ctx, cancel := context.WithCancel(context.Background())

	return &XSWDClient{
		endpoint:        "ws://127.0.0.1:44326/xswd",
		pendingRequests: make(map[string]*PendingRequest),
		eventCallbacks:  make(map[string]EventCallback),
		maxReconnect:    3,
		ctx:             ctx,
		cancel:          cancel,
	}
}

// Connect establishes a WebSocket connection to XSWD
func (c *XSWDClient) Connect() error {
	if c.connected {
		return nil
	}

    // If previous Disconnect() canceled the context, recreate it so
    // the reader loop and pending-call waits don't immediately exit.
    if c.ctx == nil || c.ctx.Err() != nil {
        ctx, cancel := context.WithCancel(context.Background())
        c.ctx = ctx
        c.cancel = cancel
    }

	// Create WebSocket connection (gated by Privacy Mode at the dialer; see privacy_transport.go)
	conn, _, err := privacyWSDialer().Dial(c.endpoint, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to XSWD: %w", err)
	}

    c.conn = conn

	// Send application identification
	appData := map[string]interface{}{
		"id":          c.generateID(),
		"name":        "HOLOGRAM",
		"description": "DERO Decentralized Web Browser",
		"url":         "http://localhost:8080", // Browser's local context
		"version":     "0.1.0-POC",
		"features":    []string{"browser", "gnomon", "epoch"},
	}

	if err := conn.WriteJSON(appData); err != nil {
		c.connected = false
		conn.Close()
		return fmt.Errorf("failed to send app data: %w", err)
	}

	// Set a long timeout for user to approve connection (120 seconds = 2 minutes)
	conn.SetReadDeadline(time.Now().Add(120 * time.Second))

	// Wait for authorization response
	var authResp AuthorizationResponse
	if err := conn.ReadJSON(&authResp); err != nil {
		c.connected = false
		conn.Close()
		return fmt.Errorf("failed to read authorization: %w", err)
	}
	
	// Clear the read deadline after authorization
	conn.SetReadDeadline(time.Time{})

    if !authResp.Accepted {
		c.connected = false
		conn.Close()
		return fmt.Errorf("XSWD connection rejected: %s", authResp.Message)
	}

    // Only mark connected AFTER authorization accepted
    c.connected = true

    // Heartbeat: keep connection alive and detect drops (start after accept)
    conn.SetPongHandler(func(appData string) error {
        _ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
        return nil
    })

    go func(ctx context.Context, cc *websocket.Conn) {
        ticker := time.NewTicker(30 * time.Second)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                c.writeMutex.Lock()
                _ = cc.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
                c.writeMutex.Unlock()
            }
        }
    }(c.ctx, conn)

	// Start message handler
	go c.handleMessages()

	return nil
}

// Disconnect closes the XSWD connection
func (c *XSWDClient) Disconnect() {
	if !c.connected {
		return
	}

    if c.cancel != nil {
        c.cancel()
    }

	if c.conn != nil {
		c.conn.Close()
	}

	c.connected = false
    // Leave ctx canceled; it will be recreated on next Connect()
}

// IsConnected returns the connection status
func (c *XSWDClient) IsConnected() bool {
	return c.connected
}

// Call makes a JSON-RPC call to XSWD
func (c *XSWDClient) Call(method string, params map[string]interface{}) (interface{}, error) {
	if !c.connected {
		return nil, fmt.Errorf("XSWD not connected")
	}

	// Generate unique request ID
	requestID := c.generateID()

	// Create request message
	msg := XSWDMessage{
		JSONRPC: "2.0",
		ID:      requestID,
		Method:  method,
		Params:  params,
	}

	// Create pending request with timeout
	timeout := c.getTimeoutForMethod(method)
	pending := &PendingRequest{
		ID:      requestID,
		Method:  method,
		Result:  make(chan interface{}, 1),
		Error:   make(chan error, 1),
		SentAt:  time.Now(),
		Timeout: timeout,
	}

	// Store pending request
	c.requestMutex.Lock()
	c.pendingRequests[requestID] = pending
	c.requestMutex.Unlock()

	// Send request
    // Serialize writes to avoid concurrent websocket writes
    c.writeMutex.Lock()
    err := c.conn.WriteJSON(msg)
    c.writeMutex.Unlock()
    if err != nil {
		c.removePendingRequest(requestID)
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	// Wait for response with timeout
	select {
	case result := <-pending.Result:
		return result, nil
	case err := <-pending.Error:
		return nil, err
	case <-time.After(timeout):
		c.removePendingRequest(requestID)
		return nil, fmt.Errorf("request timeout after %v", timeout)
	case <-c.ctx.Done():
		return nil, fmt.Errorf("client disconnected")
	}
}

// handleMessages processes incoming WebSocket messages
func (c *XSWDClient) handleMessages() {
	defer func() {
		c.connected = false
		if c.conn != nil {
			c.conn.Close()
		}
	}()

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			var msg XSWDMessage
			if err := c.conn.ReadJSON(&msg); err != nil {
				if c.connected {
					// Connection lost, try to handle pending requests
					c.handleConnectionLoss()
				}
				return
			}

			// Handle response
			if msg.ID != "" {
				c.handleResponse(&msg)
			} else {
				// Handle notification/event
				c.handleNotification(&msg)
			}
		}
	}
}

// handleResponse processes a JSON-RPC response
func (c *XSWDClient) handleResponse(msg *XSWDMessage) {
	c.requestMutex.RLock()
	pending, exists := c.pendingRequests[msg.ID]
	c.requestMutex.RUnlock()

	if !exists {
		return
	}

	// Remove from pending
	c.removePendingRequest(msg.ID)

	// Send result or error
	if msg.Error != nil {
		select {
		case pending.Error <- fmt.Errorf("RPC error %d: %s", msg.Error.Code, msg.Error.Message):
		default:
		}
	} else {
		select {
		case pending.Result <- msg.Result:
		default:
		}
	}
}

// handleNotification processes push notifications from XSWD
func (c *XSWDClient) handleNotification(msg *XSWDMessage) {
	// Check if this is an event notification
	if msg.Result != nil {
		if result, ok := msg.Result.(map[string]interface{}); ok {
			// Check for event field
			if event, ok := result["event"].(string); ok {
				c.eventMutex.RLock()
				callback, exists := c.eventCallbacks[event]
				c.eventMutex.RUnlock()

				if exists && callback != nil {
					value := result["value"]
					// Run callback async to not block message handler
					go callback(event, value)
				}
				return
			}
		}
	}

	// Also check if the method field indicates an event (some wallets use this format)
	if msg.Method != "" {
		c.eventMutex.RLock()
		callback, exists := c.eventCallbacks[msg.Method]
		c.eventMutex.RUnlock()

		if exists && callback != nil {
			go callback(msg.Method, msg.Params)
			return
		}
	}

	// Unhandled notification (silently ignored)
}

// Subscribe to an XSWD event
func (c *XSWDClient) Subscribe(event string, callback EventCallback) error {
	if !c.connected {
		return fmt.Errorf("XSWD not connected")
	}

	// Register callback first
	c.eventMutex.Lock()
	c.eventCallbacks[event] = callback
	c.eventMutex.Unlock()

	// Send subscription request to XSWD
	requestID := c.generateID()
	msg := XSWDMessage{
		JSONRPC: "2.0",
		ID:      requestID,
		Method:  "Subscribe",
		Params:  map[string]interface{}{"event": event},
	}

	c.writeMutex.Lock()
	err := c.conn.WriteJSON(msg)
	c.writeMutex.Unlock()

	if err != nil {
		// Remove callback if subscription failed
		c.eventMutex.Lock()
		delete(c.eventCallbacks, event)
		c.eventMutex.Unlock()
		return fmt.Errorf("failed to subscribe to %s: %w", event, err)
	}

	return nil
}

// ClearAllSubscriptions removes all event callbacks
func (c *XSWDClient) ClearAllSubscriptions() {
	c.eventMutex.Lock()
	c.eventCallbacks = make(map[string]EventCallback)
	c.eventMutex.Unlock()
}

// handleConnectionLoss cleans up after connection is lost
func (c *XSWDClient) handleConnectionLoss() {
	c.requestMutex.Lock()
	defer c.requestMutex.Unlock()

	// Fail all pending requests
	for id, pending := range c.pendingRequests {
		select {
		case pending.Error <- fmt.Errorf("connection lost"):
		default:
		}
		delete(c.pendingRequests, id)
	}
}

// removePendingRequest safely removes a pending request
func (c *XSWDClient) removePendingRequest(id string) {
	c.requestMutex.Lock()
	defer c.requestMutex.Unlock()
	delete(c.pendingRequests, id)
}

// generateID generates a random 64-character hex ID
func (c *XSWDClient) generateID() string {
	const chars = "0123456789abcdef"
	b := make([]byte, 64)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// getTimeoutForMethod returns appropriate timeout for different RPC methods
func (c *XSWDClient) getTimeoutForMethod(method string) time.Duration {
	switch {
	case method == "DERO.GetInfo":
		return 30 * time.Second
    case method == "DERO.GetSC" || method == "DERO.GetBlock":
		return 90 * time.Second  // Increased for blockchain queries
    case method == "DERO.GetBlockHeaderByHeight" || method == "DERO.GetTxPool":
        return 60 * time.Second
	case method == "Transfer" || method == "transfer":
		return 120 * time.Second
	default:
		return 20 * time.Second
	}
}

