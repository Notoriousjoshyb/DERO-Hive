package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/rpc"
	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type XSWDPendingRequest struct {
	Method   string
	Params   map[string]interface{}
	RespChan chan interface{}
	Conn     *websocket.Conn // Track which connection owns this request
}

// Subscription event types
type SubscriptionType string

const (
	SubNewTopoheight SubscriptionType = "new_topoheight"
	SubNewBalance    SubscriptionType = "new_balance"
	SubNewEntry      SubscriptionType = "new_entry"
)

// ClientSubscriptions tracks what events a client is subscribed to
type ClientSubscriptions struct {
	NewTopoheight bool
	NewBalance    bool
	NewEntry      bool
}

type XSWDServer struct {
	app      *App
	server   *http.Server
	upgrader websocket.Upgrader
	clients  map[*websocket.Conn]bool
	lock     sync.RWMutex

	pendingRequests map[string]*XSWDPendingRequest
	pendingLock     sync.Mutex

	// Track client origins for permission checking
	clientOrigins map[*websocket.Conn]string

	// Track client app names for display in wallet modal
	clientAppNames map[*websocket.Conn]string

	// Track subscriptions per client
	clientSubscriptions map[*websocket.Conn]*ClientSubscriptions

	// Track last known values for change detection
	lastTopoheight int64
	lastBalance    uint64

	// Subscription event pusher
	stopPusher    chan struct{}
	pusherRunning bool
}

func NewXSWDServer(app *App) *XSWDServer {
	return &XSWDServer{
		app:     app,
		clients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		pendingRequests:     make(map[string]*XSWDPendingRequest),
		clientOrigins:       make(map[*websocket.Conn]string),
		clientAppNames:      make(map[*websocket.Conn]string),
		clientSubscriptions: make(map[*websocket.Conn]*ClientSubscriptions),
		stopPusher:          make(chan struct{}),
	}
}

func (s *XSWDServer) Start() {
	mux := http.NewServeMux()
	mux.HandleFunc("/xswd", s.handleWebSocket)
	mux.HandleFunc("/auth", s.handleAuthPage)
	mux.HandleFunc("/auth/complete", s.handleAuthComplete)

	s.server = &http.Server{
		Addr:    "127.0.0.1:44326",
		Handler: mux,
	}

	go func() {
		log.Println("[START] Starting internal XSWD server on 127.0.0.1:44326")
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[ERR] XSWD server error: %v", err)
			// Notify frontend of XSWD server failure
			if s.app != nil && s.app.ctx != nil {
				runtime.EventsEmit(s.app.ctx, "xswd:server_error", map[string]interface{}{
					"error":   err.Error(),
					"message": "XSWD server encountered an error. dApp connections may not work.",
				})
			}
		}
	}()

	// Start subscription event pusher
	go s.startSubscriptionPusher()
}

func (s *XSWDServer) Stop() {
	// Stop subscription pusher
	if s.pusherRunning {
		close(s.stopPusher)
		s.pusherRunning = false
	}

	if s.server != nil {
		s.server.Close()
		s.server = nil
	}
}

func (s *XSWDServer) IsRunning() bool {
	return s.server != nil
}

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      interface{}     `json:"id"`
}

type JSONRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
	ID      interface{}   `json:"id"`
}

type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *XSWDServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ERR] Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	s.lock.Lock()
	s.clients[conn] = true
	s.lock.Unlock()

	defer func() {
		s.lock.Lock()
		// Clean up client tracking
		origin := s.clientOrigins[conn]
		delete(s.clients, conn)
		delete(s.clientOrigins, conn)
		delete(s.clientAppNames, conn)
		delete(s.clientSubscriptions, conn)
		s.lock.Unlock()

		// Clean up any pending signing requests for this connection
		// This prevents goroutine leaks when a dApp disconnects while a request is pending
		s.pendingLock.Lock()
		for reqID, req := range s.pendingRequests {
			if req.Conn == conn {
				log.Printf("[XSWD] Cleaning up pending request %s for disconnected client", reqID)
				// Send error to unblock the waiting goroutine
				select {
				case req.RespChan <- fmt.Errorf("dApp disconnected"):
				default:
					// Channel already has a value or is closed, skip
				}
				delete(s.pendingRequests, reqID)
				// Notify frontend to dismiss the modal
				runtime.EventsEmit(s.app.ctx, "xswd:request_cancelled", map[string]interface{}{
					"id":     reqID,
					"reason": "dApp disconnected",
				})
			}
		}
		s.pendingLock.Unlock()

		// Mark client as inactive
		if pm := GetPermissionManager(); pm != nil && origin != "" {
			pm.SetActiveClient(origin, false)
		}
	}()

	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		if messageType != websocket.TextMessage {
			continue
		}

		log.Printf("[XSWD] Raw Message: %s", string(message))

		var req JSONRPCRequest
		if err := json.Unmarshal(message, &req); err != nil {
			log.Printf("[ERR] JSON Unmarshal error: %v", err)
			// Send error response to client
			errResp := JSONRPCResponse{
				JSONRPC: "2.0",
				Error:   &JSONRPCError{Code: -32700, Message: "Failed to parse JSON request. Check message format."},
				ID:      nil,
			}
			if respBytes, marshalErr := json.Marshal(errResp); marshalErr == nil {
				conn.WriteMessage(websocket.TextMessage, respBytes)
			}
			continue
		}

		go s.handleRequest(conn, req, message)
	}
}

func (s *XSWDServer) handleRequest(conn *websocket.Conn, req JSONRPCRequest, raw []byte) {
	var result interface{}
	var errRes *JSONRPCError

	// Log request method
	log.Printf("[XSWD] Request: %s", req.Method)

	// Some dApps send a handshake payload (application metadata) before JSON-RPC calls.
	if req.Method == "" {
		s.handleHandshake(conn, req, raw)
		return
	}

	// Normalize method to canonical form for the switch statement.
	// The official derohe WalletHandler registers both CamelCase and lowercase aliases.
	method := req.Method
	switch method {
	case "login":
		method = "Login"
	case "ping":
		method = "Ping"
	case "echo":
		method = "Echo"
	case "getaddress":
		method = "GetAddress"
	case "getbalance":
		method = "GetBalance"
	case "getheight":
		method = "GetHeight"
	case "get_transfers":
		method = "GetTransfers"
	case "get_transfer_by_txid":
		method = "GetTransferbyTXID"
	case "make_integrated_address":
		method = "MakeIntegratedAddress"
	case "split_integrated_address":
		method = "SplitIntegratedAddress"
	case "transfer_split":
		method = "Transfer"
	case "getdaemon":
		method = "GetDaemon"
	case "subscribe":
		method = "Subscribe"
	case "unsubscribe":
		method = "Unsubscribe"
	case "gettrackedassets":
		method = "GetTrackedAssets"
	}

	if method == "Login" || method == "DERO.Login" {
		result = "Logged in"
		s.sendResponse(conn, req.ID, result, nil)
		return
	}

	if method == "Ping" || method == "DERO.Ping" {
		result = "Pong"
		s.sendResponse(conn, req.ID, result, nil)
		return
	}
	if method == "Echo" || method == "DERO.Echo" {
		params := []interface{}{}
		json.Unmarshal(req.Params, &params)
		result = params
		s.sendResponse(conn, req.ID, result, nil)
		return
	}

	// Get client origin for permission checking
	s.lock.RLock()
	origin := s.clientOrigins[conn]
	s.lock.RUnlock()

	// Check permissions for methods that require them
	pm := GetPermissionManager()
	requiredPerm := GetRequiredPermission(method)

	// Handle permission-gated methods
	switch method {
	case "GetAddress", "DERO.GetAddress":
		// Check if permission granted
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewAddress) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Wallet Address permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}

		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			addr := walletManager.wallet.GetAddress().String()
			result = map[string]string{"address": addr}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	// GetPublicKey returns the wallet's compressed bn256 G1 public key as hex.
	// Required permission: view_address (same as GetAddress — this is public data).
	// Primary use case: server-side encryption of Dead Drop documents before storage,
	// so only the wallet holder can decrypt them via DecryptPayload.
	case "GetPublicKey":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewAddress) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Wallet Address permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			keys := walletManager.wallet.Get_Keys()
			result = map[string]string{"public_key": keys.Public.StringHex()}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetBalance", "DERO.GetBalance":
		// Check if permission granted
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewBalance) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Balance permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}

		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			m, l := walletManager.wallet.Get_Balance()
			result = map[string]uint64{"balance": m, "locked_balance": l}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetHeight", "DERO.GetHeight":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewBalance) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Balance permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			result = map[string]uint64{"height": walletManager.wallet.Get_Height()}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetTransfers":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewBalance) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Balance permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			var params map[string]interface{}
			json.Unmarshal(req.Params, &params)
			coinbase, _ := params["coinbase"].(bool)
			in, _ := params["in"].(bool)
			out, _ := params["out"].(bool)
			if !coinbase && !in && !out {
				coinbase, in, out = true, true, true
			}
			minH := uint64(0)
			maxH := uint64(0)
			if v, ok := params["min_height"].(float64); ok {
				minH = uint64(v)
			}
			if v, ok := params["max_height"].(float64); ok {
				maxH = uint64(v)
			}
			var scid crypto.Hash
			entries := walletManager.wallet.Show_Transfers(scid, coinbase, in, out, minH, maxH, "", "", 0, 0)
			result = map[string]interface{}{"entries": entries}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetTransferbyTXID":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewBalance) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Balance permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			var params map[string]interface{}
			json.Unmarshal(req.Params, &params)
			txid, _ := params["txid"].(string)
			if len(txid) != 64 {
				errRes = &JSONRPCError{Code: -32602, Message: "txid must be 64 hex characters"}
			} else {
				var scid crypto.Hash
				foundSCID, entry := walletManager.wallet.Get_Payments_TXID(scid, txid)
				if entry.Height == 0 {
					errRes = &JSONRPCError{Code: -32000, Message: fmt.Sprintf("Transaction not found: %s", txid)}
				} else {
					result = map[string]interface{}{"entry": entry, "scid": foundSCID.String()}
				}
			}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "MakeIntegratedAddress":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewAddress) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Wallet Address permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			var params map[string]interface{}
			json.Unmarshal(req.Params, &params)
			addr := walletManager.wallet.GetAddress()
			addrCopy := addr.Clone()
			var payload rpc.Arguments
			if payloadRaw, ok := params["payload_rpc"].([]interface{}); ok {
				for _, item := range payloadRaw {
					if a, ok := item.(map[string]interface{}); ok {
						name, _ := a["name"].(string)
						dtype, _ := a["datatype"].(string)
						val := a["value"]
						if name == "" {
							continue
						}
						switch dtype {
						case "S":
							if v, ok := val.(string); ok {
								payload = append(payload, rpc.Argument{Name: name, DataType: "S", Value: v})
							}
						case "U":
							if v, ok := val.(float64); ok {
								payload = append(payload, rpc.Argument{Name: name, DataType: "U", Value: uint64(v)})
							}
						case "H":
							if v, ok := val.(string); ok {
								payload = append(payload, rpc.Argument{Name: name, DataType: "H", Value: crypto.HashHexToHash(v)})
							}
						}
					}
				}
			}
			addrCopy.Arguments = payload
			if _, err := addrCopy.MarshalText(); err != nil {
				errRes = &JSONRPCError{Code: -32000, Message: fmt.Sprintf("Failed to create integrated address: %v", err)}
			} else {
				result = map[string]interface{}{"integrated_address": addrCopy.String(), "payload_rpc": payload}
			}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "SplitIntegratedAddress":
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewAddress) {
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Wallet Address permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)
		intAddr, _ := params["integrated_address"].(string)
		if intAddr == "" {
			errRes = &JSONRPCError{Code: -32602, Message: "integrated_address parameter required"}
		} else {
			addr, err := rpc.NewAddress(intAddr)
			if err != nil {
				errRes = &JSONRPCError{Code: -32000, Message: fmt.Sprintf("Invalid address: %v", err)}
			} else if !addr.IsIntegratedAddress() {
				errRes = &JSONRPCError{Code: -32000, Message: "Address is not an integrated address"}
			} else {
				result = map[string]interface{}{"address": addr.BaseAddress().String(), "payload_rpc": addr.Arguments}
			}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "SignData", "DecryptPayload":
		// Check if base permission granted (still requires per-request approval)
		if pm != nil && origin != "" {
			if !pm.HasPermission(origin, requiredPerm) {
				permInfo := GetPermissionInfo(requiredPerm)
				errRes = &JSONRPCError{Code: -32003, Message: fmt.Sprintf("Permission denied: %s permission not granted", permInfo.Name)}
				s.sendResponse(conn, req.ID, nil, errRes)
				return
			}
		}
		s.handleSigningRequest(conn, req)

	case "CheckSignature":
		if !walletManager.isOpen {
			errRes = &JSONRPCError{Code: -32000, Message: "Wallet not open"}
		} else {
			var rawData []byte
			json.Unmarshal(req.Params, &rawData)
			if len(rawData) == 0 {
				var strData string
				json.Unmarshal(req.Params, &strData)
				rawData = []byte(strData)
			}
			if len(rawData) == 0 {
				errRes = &JSONRPCError{Code: -32602, Message: "Signature data required"}
			} else {
				signer, message, err := walletManager.wallet.CheckSignature(rawData)
				if err != nil {
					errRes = &JSONRPCError{Code: -32000, Message: fmt.Sprintf("Verification failed: %v", err)}
				} else {
					result = map[string]interface{}{"signer": signer.String(), "message": strings.TrimSpace(string(message))}
				}
			}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "HasMethod":
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)
		name, _ := params["name"].(string)
		known := map[string]bool{
			"GetAddress": true, "GetBalance": true, "GetHeight": true,
			"GetPublicKey": true,
			"Transfer":     true, "transfer": true, "scinvoke": true, "SC_Invoke": true,
			"GetTransfers": true, "GetTransferbyTXID": true, "MakeIntegratedAddress": true,
			"SplitIntegratedAddress": true, "SignData": true,
			"CheckSignature": true, "DecryptPayload": true, "Subscribe": true, "Unsubscribe": true,
			"GetDaemon": true, "HasMethod": true, "Echo": true, "Ping": true,
		}
		result = known[name]
		s.sendResponse(conn, req.ID, result, errRes)

	case "transfer", "Transfer", "DERO.Transfer", "scinvoke", "SC_Invoke", "DERO.SC_Invoke":
		// Check if base permission granted (still requires per-TX approval)
		if pm != nil && origin != "" {
			if !pm.HasPermission(origin, requiredPerm) {
				permInfo := GetPermissionInfo(requiredPerm)
				errRes = &JSONRPCError{Code: -32003, Message: fmt.Sprintf("Permission denied: %s permission not granted", permInfo.Name)}
				s.sendResponse(conn, req.ID, nil, errRes)
				return
			}
		}
		// Handle signing request (always requires user approval)
		s.handleSigningRequest(conn, req)

	// EPOCH Methods - Developer Support (no permission required, always allowed if enabled)
	case "AttemptEPOCH", "AttemptEPOCHWithAddr":
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)

		// Delegate to the router which handles both variants correctly,
		// including the address-switch logic for AttemptEPOCHWithAddr.
		epochResp := s.app.routeEpochCall(method, params, origin)
		if errMsg, ok := epochResp["error"].(string); ok && errMsg != "" {
			errRes = &JSONRPCError{Code: -32000, Message: errMsg}
		} else {
			result = epochResp["result"]
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetMaxHashesEPOCH":
		stats := s.app.GetEpochStats()
		result = map[string]interface{}{
			"maxHashes": stats["max_hashes"],
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetSessionEPOCH":
		stats := s.app.GetEpochStats()
		if stats["active"] == true {
			result = map[string]interface{}{
				"sessionHashes":  stats["hashes"],
				"sessionMinis":   stats["miniblocks"],
				"sessionVersion": stats["version"],
			}
		} else {
			errRes = &JSONRPCError{Code: -32000, Message: "EPOCH is not active"}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	case "GetAddressEPOCH":
		stats := s.app.GetEpochStats()
		if stats["active"] == true {
			result = map[string]interface{}{
				"epochAddress": stats["address"],
			}
		} else {
			errRes = &JSONRPCError{Code: -32000, Message: "EPOCH is not active"}
		}
		s.sendResponse(conn, req.ID, result, errRes)

	// Subscription support for real-time events
	case "Subscribe":
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)

		eventType, _ := params["event"].(string)
		if eventType == "" {
			errRes = &JSONRPCError{Code: -32602, Message: "Subscription event type is required. Valid types: new_topoheight, new_balance, new_entry"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}

		// Initialize subscriptions for this client if not exists
		s.lock.Lock()
		if s.clientSubscriptions[conn] == nil {
			s.clientSubscriptions[conn] = &ClientSubscriptions{}
		}
		subs := s.clientSubscriptions[conn]

		switch SubscriptionType(eventType) {
		case SubNewTopoheight:
			subs.NewTopoheight = true
			log.Printf("[NET] Client subscribed to new_topoheight")
		case SubNewBalance:
			subs.NewBalance = true
			log.Printf("[NET] Client subscribed to new_balance")
		case SubNewEntry:
			subs.NewEntry = true
			log.Printf("[NET] Client subscribed to new_entry")
		default:
			s.lock.Unlock()
			errRes = &JSONRPCError{Code: -32602, Message: fmt.Sprintf("Unknown subscription event type: %s. Valid types: new_topoheight, new_balance, new_entry", eventType)}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}
		s.lock.Unlock()

		// Return success
		result = map[string]interface{}{
			"event":      eventType,
			"subscribed": true,
		}
		s.sendResponse(conn, req.ID, result, nil)

	case "Unsubscribe":
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)

		eventType, _ := params["event"].(string)
		if eventType == "" {
			errRes = &JSONRPCError{Code: -32602, Message: "Subscription event type is required"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}

		s.lock.Lock()
		subs := s.clientSubscriptions[conn]
		if subs != nil {
			switch SubscriptionType(eventType) {
			case SubNewTopoheight:
				subs.NewTopoheight = false
			case SubNewBalance:
				subs.NewBalance = false
			case SubNewEntry:
				subs.NewEntry = false
			}
		}
		s.lock.Unlock()

		result = map[string]interface{}{
			"event":        eventType,
			"unsubscribed": true,
		}
		s.sendResponse(conn, req.ID, result, nil)

	case "GetDaemon", "DERO.GetDaemon":
		// Check if permission granted (requires view_address like other read methods)
		if pm != nil && origin != "" && !pm.HasPermission(origin, PermissionViewAddress) {
			log.Printf("[XSWD] GetDaemon: DENIED - origin=%q does not have view_address permission", origin)
			errRes = &JSONRPCError{Code: -32003, Message: "Permission denied: View Wallet Address permission not granted"}
			s.sendResponse(conn, req.ID, nil, errRes)
			return
		}

		// Determine endpoint based on mode:
		// 1. If simulator mode is active, use simulator daemon (port 20000)
		// 2. Otherwise, use configured daemon endpoint or default mainnet (port 10102)
		var endpoint string

		if s.app != nil && s.app.simulatorManager != nil && s.app.simulatorManager.isInitialized {
			// Simulator mode active - use simulator daemon endpoint
			endpoint = "127.0.0.1:20000"
		} else {
			// Normal mode - use configured endpoint or default
			endpoint = "127.0.0.1:10102"
			if s.app != nil {
				if ep, ok := s.app.settings["daemon_endpoint"].(string); ok && ep != "" {
					endpoint = ep
				}
			}
		}

		// Strip http:// or https:// prefix if present - return just host:port
		if len(endpoint) > 7 && endpoint[:7] == "http://" {
			endpoint = endpoint[7:]
		} else if len(endpoint) > 8 && endpoint[:8] == "https://" {
			endpoint = endpoint[8:]
		}
		result = map[string]interface{}{"endpoint": endpoint}
		s.sendResponse(conn, req.ID, result, nil)

	default:
		// Route daemon RPC (DERO.*) and Gnomon (Gnomon.*) methods through the router
		// so external WebSocket dApps can call them (e.g. DERO.GetSC, DERO.GetInfo, Gnomon.GetSCIDValuesByKey).
		var params map[string]interface{}
		json.Unmarshal(req.Params, &params)

		if strings.HasPrefix(method, "DERO.") {
			resp := s.app.routeDaemonCall(method, params)
			if errMsg, ok := resp["error"].(string); ok && errMsg != "" {
				errRes = &JSONRPCError{Code: -32000, Message: errMsg}
			} else {
				result = resp["result"]
			}
			s.sendResponse(conn, req.ID, result, errRes)
		} else if strings.HasPrefix(method, "Gnomon.") {
			resp := s.app.routeGnomonCall(method, params)
			if errMsg, ok := resp["error"].(string); ok && errMsg != "" {
				errRes = &JSONRPCError{Code: -32000, Message: errMsg}
			} else {
				result = resp["result"]
			}
			s.sendResponse(conn, req.ID, result, errRes)
		} else {
			log.Printf("[ERR] XSWD Method not found: %s", method)
			errRes = &JSONRPCError{Code: -32601, Message: fmt.Sprintf("Unknown method: %s. Check XSWD documentation for supported methods.", method)}
			s.sendResponse(conn, req.ID, nil, errRes)
		}
	}
}

func (s *XSWDServer) handleHandshake(conn *websocket.Conn, req JSONRPCRequest, raw []byte) {
	reqID := fmt.Sprintf("%v", req.ID)
	if reqID == "" {
		reqID = fmt.Sprintf("handshake_%d", time.Now().UnixNano())
	}

	// Parse handshake info
	info := map[string]interface{}{}
	if err := json.Unmarshal(raw, &info); err != nil {
		log.Printf("[WARN] Failed to parse handshake info: %v", err)
	}

	resChan := make(chan interface{})
	s.pendingLock.Lock()
	s.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "handshake",
		Params:   info,
		RespChan: resChan,
	}
	s.pendingLock.Unlock()

	appName, _ := info["name"].(string)
	origin, _ := info["url"].(string)
	description, _ := info["description"].(string)

	// Parse requested permissions from handshake (if provided by dApp)
	// Format: {"permissions": ["view_address", "view_balance", ...]}
	requestedPerms := DefaultRequestedPermissions()
	if permsRaw, ok := info["permissions"].([]interface{}); ok {
		requestedPerms = []XSWDPermission{}
		for _, p := range permsRaw {
			if pStr, ok := p.(string); ok {
				requestedPerms = append(requestedPerms, XSWDPermission(pStr))
			}
		}
	}

	// Build permission info for frontend display
	permInfos := make([]map[string]interface{}, 0, len(requestedPerms))
	for _, p := range requestedPerms {
		pi := GetPermissionInfo(p)
		permInfos = append(permInfos, map[string]interface{}{
			"id":          string(pi.ID),
			"name":        pi.Name,
			"description": pi.Description,
			"alwaysAsk":   pi.AlwaysAsk,
		})
	}

	// Check if we already have stored permissions for this origin
	pm := GetPermissionManager()
	var existingPerms map[string]bool
	if pm != nil {
		if app := pm.GetApp(origin); app != nil {
			existingPerms = make(map[string]bool)
			for p, granted := range app.Permissions {
				existingPerms[string(p)] = granted
			}
		}
	}

	// Check if this is a read-only request (no wallet permissions needed)
	isReadOnly := !HasAnyWalletPermission(requestedPerms)

	// Emit toast warning if no wallet is open AND app needs wallet access
	if !walletManager.isOpen && !isReadOnly {
		runtime.EventsEmit(s.app.ctx, "toast:show", map[string]interface{}{
			"type":    "warning",
			"message": "Connect a wallet to interact with " + appName,
		})
	}

	runtime.EventsEmit(s.app.ctx, "xswd:request", map[string]interface{}{
		"id":                   reqID,
		"type":                 "connect",
		"appName":              appName,
		"origin":               origin,
		"description":          description,
		"requestedPermissions": permInfos,
		"existingPermissions":  existingPerms,
		"isReadOnly":           isReadOnly,
	})

	resp := <-resChan

	s.pendingLock.Lock()
	delete(s.pendingRequests, reqID)
	s.pendingLock.Unlock()

	if err, ok := resp.(error); ok {
		s.sendRawJSON(conn, map[string]interface{}{
			"accepted": false,
			"error":    err.Error(),
		})
		return
	}

	message := "Wallet connection approved"
	var grantedPerms []XSWDPermission

	if respMap, ok := resp.(map[string]interface{}); ok {
		if msg, ok2 := respMap["message"].(string); ok2 {
			message = msg
		}
		// Extract granted permissions from response
		if perms, ok2 := respMap["permissions"].([]interface{}); ok2 {
			for _, p := range perms {
				if pStr, ok3 := p.(string); ok3 {
					grantedPerms = append(grantedPerms, XSWDPermission(pStr))
				}
			}
		}
	}

	// If no permissions explicitly granted, use requested permissions (backward compat)
	if len(grantedPerms) == 0 {
		grantedPerms = requestedPerms
	}

	// Store granted permissions
	if pm != nil && origin != "" {
		pm.GrantPermissions(origin, appName, description, grantedPerms)
		pm.SetActiveClient(origin, true)
	}

	// Store origin and app name for this connection
	s.lock.Lock()
	s.clientOrigins[conn] = origin
	s.clientAppNames[conn] = appName
	s.lock.Unlock()

	s.sendRawJSON(conn, map[string]interface{}{
		"accepted": true,
		"message":  message,
	})
}

func (s *XSWDServer) handleSigningRequest(conn *websocket.Conn, req JSONRPCRequest) {
	// Create channel for response
	resChan := make(chan interface{})
	reqID := fmt.Sprintf("%v", req.ID) // Use ID from request as key (simplification)
	if req.ID == nil {
		// Notification? Skip
		return
	}

	// Parse params
	var paramsMap map[string]interface{}
	if err := json.Unmarshal(req.Params, &paramsMap); err != nil {
		s.sendResponse(conn, req.ID, nil, &JSONRPCError{Code: -32700, Message: "Failed to parse request parameters. Check JSON format."})
		return
	}

	// Get app name and origin for this connection
	s.lock.RLock()
	appName := s.clientAppNames[conn]
	origin := s.clientOrigins[conn]
	s.lock.RUnlock()

	if appName == "" {
		appName = "External dApp"
	}
	if origin == "" {
		origin = "Websocket"
	}

	// Store request with connection reference for cleanup on disconnect
	s.pendingLock.Lock()
	s.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   req.Method,
		Params:   paramsMap,
		RespChan: resChan,
		Conn:     conn,
	}
	s.pendingLock.Unlock()

	// Notify frontend
	log.Printf("[XSWD] Emitting xswd:request for %s from %s", req.Method, appName)
	runtime.EventsEmit(s.app.ctx, "xswd:request", map[string]interface{}{
		"id":      reqID,
		"method":  req.Method,
		"params":  paramsMap,
		"appName": appName,
		"origin":  origin,
	})

	// Wait for response with timeout (prevents goroutine leak if user never responds or frontend crashes)
	var resp interface{}
	select {
	case resp = <-resChan:
		// Got response from user approval/denial
	case <-time.After(120 * time.Second):
		// Timeout — clean up and send error to dApp
		s.pendingLock.Lock()
		delete(s.pendingRequests, reqID)
		s.pendingLock.Unlock()
		log.Printf("[XSWD] Signing request %s timed out after 120s", reqID)
		// Notify frontend to dismiss the modal for this request
		runtime.EventsEmit(s.app.ctx, "xswd:request_timeout", map[string]interface{}{
			"id": reqID,
		})
		s.sendResponse(conn, req.ID, nil, &JSONRPCError{Code: -32000, Message: "Transaction approval timed out. Please try again."})
		return
	}

	// Clean up
	s.pendingLock.Lock()
	delete(s.pendingRequests, reqID)
	s.pendingLock.Unlock()

	// Send response
	if err, ok := resp.(error); ok {
		s.sendResponse(conn, req.ID, nil, &JSONRPCError{Code: -32000, Message: err.Error()})
	} else {
		// If result is map with error
		if rMap, ok := resp.(map[string]interface{}); ok && rMap["error"] != nil {
			s.sendResponse(conn, req.ID, nil, &JSONRPCError{Code: -32000, Message: fmt.Sprint(rMap["error"])})
		} else {
			s.sendResponse(conn, req.ID, resp, nil)
		}
	}
}

func (s *XSWDServer) sendResponse(conn *websocket.Conn, id interface{}, result interface{}, err *JSONRPCError) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
		Error:   err,
	}
	respBytes, _ := json.Marshal(resp)
	s.lock.Lock()
	conn.WriteMessage(websocket.TextMessage, respBytes)
	s.lock.Unlock()
}

func (s *XSWDServer) sendRawJSON(conn *websocket.Conn, payload interface{}) {
	respBytes, _ := json.Marshal(payload)
	s.lock.Lock()
	conn.WriteMessage(websocket.TextMessage, respBytes)
	s.lock.Unlock()
}

// ProcessApproval is called from App (legacy, no permissions)
func (s *XSWDServer) ProcessApproval(reqID string, approved bool, password string) {
	s.ProcessApprovalWithPermissions(reqID, approved, password, nil)
}

// ProcessApprovalWithPermissions is called from App with explicit permissions
func (s *XSWDServer) ProcessApprovalWithPermissions(reqID string, approved bool, password string, permissions []string) {
	s.pendingLock.Lock()
	req, ok := s.pendingRequests[reqID]
	s.pendingLock.Unlock()

	if !ok {
		log.Printf("[WARN] Unknown request ID approved: %s", reqID)
		return
	}

	if req.Method == "handshake" {
		if !approved {
			req.RespChan <- fmt.Errorf("User denied wallet connection")
		} else {
			// Include permissions in the response
			resp := map[string]interface{}{
				"message": "Wallet connection approved",
			}
			if permissions != nil {
				// Convert string slice to interface slice for JSON
				permInterface := make([]interface{}, len(permissions))
				for i, p := range permissions {
					permInterface[i] = p
				}
				resp["permissions"] = permInterface
			}
			req.RespChan <- resp
		}
		return
	}

	if !approved {
		req.RespChan <- fmt.Errorf("User denied request")
		return
	}

	// Execute wallet call
	// Use the App's InternalWalletCall
	res := s.app.InternalWalletCall(req.Method, req.Params, password)
	req.RespChan <- res
}

// IsWalletOpen returns whether a wallet is currently open (proxy to App)
func (s *XSWDServer) IsWalletOpen() bool {
	if s.app == nil {
		return false
	}
	return s.app.IsWalletOpen()
}

// GetWalletAddress returns the current wallet address (proxy to walletManager)
func (s *XSWDServer) GetWalletAddress() string {
	walletManager.RLock()
	defer walletManager.RUnlock()
	if !walletManager.isOpen || walletManager.wallet == nil {
		return ""
	}
	return walletManager.wallet.GetAddress().String()
}

// GetWalletBalance returns the current wallet balance (proxy to walletManager)
func (s *XSWDServer) GetWalletBalance() (uint64, error) {
	walletManager.RLock()
	defer walletManager.RUnlock()
	if !walletManager.isOpen || walletManager.wallet == nil {
		return 0, fmt.Errorf("wallet not open")
	}
	matureBalance, _ := walletManager.wallet.Get_Balance()
	return matureBalance, nil
}

// ==================== Subscription System ====================

// startSubscriptionPusher runs a background loop to push events to subscribed clients
func (s *XSWDServer) startSubscriptionPusher() {
	s.pusherRunning = true
	ticker := time.NewTicker(2 * time.Second) // Check every 2 seconds
	defer ticker.Stop()

	log.Println("[NET] Starting XSWD subscription pusher")

	for {
		select {
		case <-s.stopPusher:
			log.Println("[NET] Stopping XSWD subscription pusher")
			return
		case <-ticker.C:
			s.checkAndPushEvents()
		}
	}
}

// checkAndPushEvents checks for state changes and pushes events to subscribers
func (s *XSWDServer) checkAndPushEvents() {
	s.lock.RLock()
	clientCount := len(s.clients)
	s.lock.RUnlock()

	if clientCount == 0 {
		return // No clients connected
	}

	// Check for new_topoheight (block height change)
	if s.app != nil {
		currentHeight := s.getCurrentTopoheight()
		if currentHeight > 0 && currentHeight != s.lastTopoheight {
			s.lastTopoheight = currentHeight
			s.pushEvent(SubNewTopoheight, map[string]interface{}{
				"topoheight": currentHeight,
			})
		}
	}

	// Check for new_balance (wallet balance change)
	if walletManager.isOpen && walletManager.wallet != nil {
		currentBalance, _ := walletManager.wallet.Get_Balance()
		if currentBalance != s.lastBalance {
			s.lastBalance = currentBalance
			s.pushEvent(SubNewBalance, map[string]interface{}{
				"balance": currentBalance,
			})
		}
	}

	// Note: new_entry would require tracking transaction history
	// This is more complex and would need wallet tx monitoring
}

// getCurrentTopoheight gets the current blockchain height
func (s *XSWDServer) getCurrentTopoheight() int64 {
	if s.app == nil {
		return 0
	}

	// Try to get from cached stats first
	stats := s.app.GetLiveStats()
	if stats == nil {
		return 0
	}

	if height, ok := stats["topoheight"].(int64); ok {
		return height
	}
	if height, ok := stats["topoheight"].(float64); ok {
		return int64(height)
	}
	return 0
}

// pushEvent sends an event to all clients subscribed to that event type
func (s *XSWDServer) pushEvent(eventType SubscriptionType, data map[string]interface{}) {
	s.lock.RLock()
	defer s.lock.RUnlock()

	for conn, subs := range s.clientSubscriptions {
		if subs == nil {
			continue
		}

		shouldPush := false
		switch eventType {
		case SubNewTopoheight:
			shouldPush = subs.NewTopoheight
		case SubNewBalance:
			shouldPush = subs.NewBalance
		case SubNewEntry:
			shouldPush = subs.NewEntry
		}

		if shouldPush {
			// Send event as JSON-RPC notification (no id)
			notification := map[string]interface{}{
				"jsonrpc": "2.0",
				"method":  string(eventType),
				"params":  data,
			}

			notifBytes, err := json.Marshal(notification)
			if err != nil {
				continue
			}

			// Don't hold the read lock while writing
			go func(c *websocket.Conn, msg []byte) {
				s.lock.Lock()
				c.WriteMessage(websocket.TextMessage, msg)
				s.lock.Unlock()
			}(conn, notifBytes)
		}
	}
}

// GetActiveConnections returns info about active XSWD connections (for UI)
func (s *XSWDServer) GetActiveConnections() []map[string]interface{} {
	s.lock.RLock()
	defer s.lock.RUnlock()

	connections := []map[string]interface{}{}
	pm := GetPermissionManager()

	for conn, origin := range s.clientOrigins {
		connInfo := map[string]interface{}{
			"origin": origin,
			"active": true,
		}

		// Add subscription info
		if subs := s.clientSubscriptions[conn]; subs != nil {
			connInfo["subscriptions"] = map[string]bool{
				"new_topoheight": subs.NewTopoheight,
				"new_balance":    subs.NewBalance,
				"new_entry":      subs.NewEntry,
			}
		}

		// Add permission info from permission manager
		if pm != nil && origin != "" {
			if app := pm.GetApp(origin); app != nil {
				connInfo["appName"] = app.Name
				connInfo["permissions"] = app.Permissions
			}
		}

		connections = append(connections, connInfo)
	}

	return connections
}

// ==================== HTTP Auth Endpoint (DeroAuth OAuth-style redirect flow) ====================
//
// Flow (like OAuth / SAML):
// 1. Website redirects browser to http://localhost:44326/auth?callback=<url>&nonce=<nonce>&domain=<domain>
// 2. HOLOGRAM shows its native wallet approval modal
// 3. User approves → HOLOGRAM constructs a challenge message, signs it
// 4. Browser redirects back to callback URL with signature + nonce in query params
// 5. Website verifies the signature server-side, creates session

// handleAuthPage serves the redirect auth waiting page.
// The page calls /auth/complete, then redirects back to the callback URL.
func (s *XSWDServer) handleAuthPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	callback := r.URL.Query().Get("callback")
	nonce := r.URL.Query().Get("nonce")
	domain := r.URL.Query().Get("domain")

	if callback == "" || nonce == "" || domain == "" {
		http.Error(w, "Missing required parameters: callback, nonce, domain", http.StatusBadRequest)
		return
	}

	authData := map[string]interface{}{
		"callback": callback,
		"nonce":    nonce,
		"domain":   domain,
	}
	authDataJSON, _ := json.Marshal(authData)

	html := strings.Replace(authPageHTML, "__AUTH_DATA__", string(authDataJSON), 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))

	log.Printf("[AUTH] Served auth page for domain=%s nonce=%s", domain, nonce)
}

// handleAuthComplete triggers HOLOGRAM's wallet modal, constructs the challenge
// message, signs it, and returns everything in a single request.
// Called by the auth page JS after loading.
func (s *XSWDServer) handleAuthComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Nonce  string `json:"nonce"`
		Domain string `json:"domain"`
		URI    string `json:"uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request body"})
		return
	}

	if body.Nonce == "" || body.Domain == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "nonce and domain are required"})
		return
	}

	resChan := make(chan interface{})
	reqID := fmt.Sprintf("auth-%d", time.Now().UnixNano())

	s.pendingLock.Lock()
	s.pendingRequests[reqID] = &XSWDPendingRequest{
		Method:   "handshake",
		RespChan: resChan,
		Conn:     nil,
	}
	s.pendingLock.Unlock()

	if !s.IsWalletOpen() {
		runtime.EventsEmit(s.app.ctx, "toast:show", map[string]interface{}{
			"type":    "warning",
			"message": "Open a wallet to approve sign-in from " + body.Domain,
		})
	}

	runtime.EventsEmit(s.app.ctx, "xswd:request", map[string]interface{}{
		"id":                   reqID,
		"type":                 "connect",
		"appName":              "Sign In with DERO",
		"origin":               body.Domain,
		"description":          body.Domain + " wants to verify your identity",
		"requestedPermissions": []map[string]interface{}{},
		"existingPermissions":  map[string]bool{},
		"isReadOnly":           false,
	})

	log.Printf("[AUTH] Emitted xswd:request for auth, reqID=%s domain=%s", reqID, body.Domain)

	resp := <-resChan

	s.pendingLock.Lock()
	delete(s.pendingRequests, reqID)
	s.pendingLock.Unlock()

	w.Header().Set("Content-Type", "application/json")

	if err, ok := resp.(error); ok {
		log.Printf("[AUTH] Denied for domain=%s: %v", body.Domain, err)
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	walletManager.RLock()
	if !walletManager.isOpen || walletManager.wallet == nil {
		walletManager.RUnlock()
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "No wallet open"})
		return
	}

	address := walletManager.wallet.GetAddress().String()

	now := time.Now().UTC()
	expiry := now.Add(5 * time.Minute)
	uri := body.URI
	if uri == "" {
		uri = "https://" + body.Domain
	}

	challengeText := fmt.Sprintf("%s wants you to sign in with your DERO wallet:\n%s\n\nSign in to %s\n\nURI: %s\nVersion: 1\nChain ID: dero-mainnet\nNonce: %s\nIssued At: %s\nExpiration Time: %s",
		body.Domain,
		address,
		body.Domain,
		uri,
		body.Nonce,
		now.Format(time.RFC3339),
		expiry.Format(time.RFC3339),
	)

	signature := walletManager.wallet.SignData([]byte(challengeText))
	walletManager.RUnlock()

	if len(signature) == 0 {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to sign data"})
		return
	}

	log.Printf("[AUTH] Signed auth challenge for address=%s domain=%s", address, body.Domain)
	json.NewEncoder(w).Encode(map[string]string{
		"signature": string(signature),
		"address":   address,
		"nonce":     body.Nonce,
	})
}

// authPageHTML is the redirect auth waiting page.
// Calls /auth/complete (which triggers HOLOGRAM's wallet modal), then redirects
// back to the callback URL with signature and nonce in the query string.
// Uses the Void Hierarchy design system (#000/#0c0c14/#1e1e2a, cyan #22d3ee).
const authPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HOLOGRAM — Sign In</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#0c0c14;border:1px solid #1e1e2a;border-radius:12px;padding:32px;max-width:420px;width:100%}
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:24px}
h1{font-size:18px;font-weight:600;color:#fff}
.domain-box{background:#1e1e2a;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:14px;color:#22d3ee;word-break:break-all}
.status-area{text-align:center;padding:32px 0;color:#888}
.status-area .spinner{display:inline-block;width:24px;height:24px;border:2px solid #1e1e2a;border-top-color:#22d3ee;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
.status-msg{font-size:14px;line-height:1.5}
.status-sub{font-size:12px;color:#666;margin-top:8px}
.err-state{text-align:center;color:#f87171;padding:20px 0}
.success-state{text-align:center;color:#22d3ee;padding:20px 0}
.btns{display:flex;gap:12px;margin-top:20px}
.btn{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s}
.btn:hover{opacity:0.85}
.cancel{background:#1e1e2a;color:#e0e0e0;border:1px solid #2a2a3a}
</style>
</head>
<body>
<div class="card" id="card"></div>
<script>
var D = __AUTH_DATA__;

function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}

function iconSvg(){
  return '<svg width="36" height="36" viewBox="0 0 36 36" fill="none">'+
    '<circle cx="18" cy="18" r="16" stroke="#22d3ee" stroke-width="1.5" opacity="0.6"/>'+
    '<path d="M18 6l8 12-8 12-8-12z" stroke="#22d3ee" stroke-width="1.5" fill="none"/>'+
    '<path d="M18 10l5 8-5 8-5-8z" fill="#22d3ee" opacity="0.15"/></svg>';
}

function showStatus(msg,sub){
  var c=document.getElementById('card');
  c.innerHTML='<div class="hdr">'+iconSvg()+'<h1>Sign In with DERO</h1></div>'+
    '<div class="domain-box">'+esc(D.domain)+'</div>'+
    '<div class="status-area"><div class="spinner"></div>'+
    '<p class="status-msg">'+esc(msg)+'</p>'+
    (sub?'<p class="status-sub">'+esc(sub)+'</p>':'')+
    '</div>';
}

function showError(msg){
  var c=document.getElementById('card');
  c.innerHTML='<div class="hdr">'+iconSvg()+'<h1>Sign In with DERO</h1></div>'+
    '<div class="domain-box">'+esc(D.domain)+'</div>'+
    '<div class="err-state"><p>'+esc(msg)+'</p></div>'+
    '<div class="btns"><button class="btn cancel" onclick="goBack()">Go Back</button></div>';
}

function showSuccess(){
  var c=document.getElementById('card');
  c.innerHTML='<div class="hdr">'+iconSvg()+'<h1>Sign In with DERO</h1></div>'+
    '<div class="domain-box">'+esc(D.domain)+'</div>'+
    '<div class="success-state"><p>Approved! Redirecting...</p></div>';
}

function goBack(){
  var base=D.callback.split('?')[0].replace(/\/api\/auth\/callback\/?$/,'').replace(/\/$/,'');
  window.location.href=base||D.callback;
}

async function startAuth(){
  showStatus('Approve in HOLOGRAM','Switch to HOLOGRAM to approve this sign-in request');

  try{
    var res=await fetch('/auth/complete',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nonce:D.nonce,domain:D.domain,uri:D.callback.split('/api/')[0]||('https://'+D.domain)})
    });
    var data=await res.json();

    if(data.error){
      showError(data.error);
      return;
    }

    showSuccess();

    var sep=D.callback.indexOf('?')>=0?'&':'?';
    var url=D.callback+sep+'signature='+encodeURIComponent(data.signature)+'&nonce='+encodeURIComponent(data.nonce);
    setTimeout(function(){window.location.href=url},400);

  }catch(e){
    showError('Connection failed: '+e.message);
  }
}

startAuth();
</script>
</body>
</html>`
