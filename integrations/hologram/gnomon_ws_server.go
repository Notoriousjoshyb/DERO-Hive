// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Gnomon WebSocket Query API Server
// Ported from simple-gnomon for external app integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Default WebSocket server configuration
const (
	DefaultWSPort    = 9190
	MaxWSPort        = 9199
	WSReadTimeout    = 60 * time.Second
	WSWriteTimeout   = 10 * time.Second
	WSPingPeriod     = 30 * time.Second
	WSMaxMessageSize = 1024 * 1024 // 1MB
)

// GnomonWSRequest represents an incoming WebSocket request
type GnomonWSRequest struct {
	ID     any            `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params,omitempty"`
}

// GnomonWSResponse represents an outgoing WebSocket response
type GnomonWSResponse struct {
	ID     any      `json:"id"`
	Result any      `json:"result,omitempty"`
	Error  *WSError `json:"error,omitempty"`
}

// WSError represents a WebSocket error
type WSError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// GnomonWSServer manages the WebSocket API server
type GnomonWSServer struct {
	app       *App
	server    *http.Server
	address   string
	port      int
	running   bool
	clients   map[*websocket.Conn]bool
	clientsMu sync.RWMutex
	upgrader  websocket.Upgrader
}

// NewGnomonWSServer creates a new WebSocket API server
func NewGnomonWSServer(app *App, address string) *GnomonWSServer {
	if address == "" {
		address = fmt.Sprintf("127.0.0.1:%d", DefaultWSPort)
	}

	return &GnomonWSServer{
		app:     app,
		address: address,
		clients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins (local API)
			},
		},
	}
}

// Start starts the WebSocket server
func (s *GnomonWSServer) Start(ctx context.Context) error {
	if s.running {
		return fmt.Errorf("WebSocket server already running")
	}

	var listener net.Listener
	var err error

	// If address was provided, try to use it directly first
	if s.address != "" && s.address != fmt.Sprintf("127.0.0.1:%d", DefaultWSPort) {
		listener, err = net.Listen("tcp", s.address)
		if err == nil {
			// Parse port from address for tracking
			if parts := strings.Split(s.address, ":"); len(parts) == 2 {
				if p, parseErr := strconv.Atoi(parts[1]); parseErr == nil {
					s.port = p
				}
			}
		}
	}

	// Fall back to auto-port scanning if no address or listen failed
	if listener == nil {
		port := DefaultWSPort
		for port <= MaxWSPort {
			addr := fmt.Sprintf("127.0.0.1:%d", port)
			listener, err = net.Listen("tcp", addr)
			if err == nil {
				s.address = addr
				s.port = port
				break
			}
			port++
		}
	}

	if listener == nil {
		return fmt.Errorf("no available port in range %d-%d", DefaultWSPort, MaxWSPort)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", s.handleHealth)

	s.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  WSReadTimeout,
		WriteTimeout: WSWriteTimeout,
	}

	s.running = true
	log.Printf("[GNOMON-WS] WebSocket API server starting on ws://%s/ws", s.address)

	go func() {
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("[GNOMON-WS] Server error: %v", err)
			s.running = false
		}
	}()

	// Wait for context cancellation
	go func() {
		<-ctx.Done()
		s.Stop()
	}()

	return nil
}

// Stop stops the WebSocket server
func (s *GnomonWSServer) Stop() {
	if !s.running {
		return
	}

	s.running = false

	// Close all client connections
	s.clientsMu.Lock()
	for conn := range s.clients {
		conn.Close()
		delete(s.clients, conn)
	}
	s.clientsMu.Unlock()

	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.server.Shutdown(ctx)
	}

	log.Printf("[GNOMON-WS] WebSocket API server stopped")
}

// IsRunning returns whether the server is running
func (s *GnomonWSServer) IsRunning() bool {
	return s.running
}

// GetAddress returns the server address
func (s *GnomonWSServer) GetAddress() string {
	return s.address
}

// GetPort returns the server port
func (s *GnomonWSServer) GetPort() int {
	return s.port
}

// GetClientCount returns the number of connected clients
func (s *GnomonWSServer) GetClientCount() int {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return len(s.clients)
}

// handleHealth handles health check requests
func (s *GnomonWSServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"gnomon":  s.app.gnomonClient != nil && s.app.gnomonClient.IsRunning(),
		"clients": s.GetClientCount(),
	})
}

// handleWebSocket handles WebSocket connections
func (s *GnomonWSServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[GNOMON-WS] Upgrade failed: %v", err)
		return
	}

	// Register client
	s.clientsMu.Lock()
	s.clients[conn] = true
	s.clientsMu.Unlock()

	log.Printf("[GNOMON-WS] Client connected from %s", conn.RemoteAddr())

	// Cleanup on disconnect
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, conn)
		s.clientsMu.Unlock()
		conn.Close()
		log.Printf("[GNOMON-WS] Client disconnected from %s", conn.RemoteAddr())
	}()

	// Set read limit
	conn.SetReadLimit(WSMaxMessageSize)

	// Handle messages
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[GNOMON-WS] Read error: %v", err)
			}
			break
		}

		// Parse request
		var req GnomonWSRequest
		if err := json.Unmarshal(message, &req); err != nil {
			s.sendError(conn, nil, -32700, "Parse error")
			continue
		}

		// Handle request
		response := s.handleRequest(req)

		// Send response
		if err := conn.WriteJSON(response); err != nil {
			log.Printf("[GNOMON-WS] Write error: %v", err)
			break
		}
	}
}

// sendError sends an error response
func (s *GnomonWSServer) sendError(conn *websocket.Conn, id any, code int, message string) {
	response := GnomonWSResponse{
		ID: id,
		Error: &WSError{
			Code:    code,
			Message: message,
		},
	}
	conn.WriteJSON(response)
}

// handleRequest processes a WebSocket request
func (s *GnomonWSServer) handleRequest(req GnomonWSRequest) GnomonWSResponse {
	// Check if Gnomon is running
	if s.app.gnomonClient == nil || !s.app.gnomonClient.IsRunning() {
		return GnomonWSResponse{
			ID: req.ID,
			Error: &WSError{
				Code:    -32603,
				Message: "Gnomon is not running",
			},
		}
	}

	// Route method
	method := strings.ToLower(req.Method)
	var result any

	switch method {
	// === SCID Queries ===
	case "getallscids", "get_all_scids":
		// Return list of SCIDs (keys from scid->owner map)
		ownersMap := s.app.gnomonClient.GetAllOwnersAndSCIDs()
		scidList := make([]string, 0, len(ownersMap))
		for scid := range ownersMap {
			scidList = append(scidList, scid)
		}
		result = scidList

	case "getallownersandscids", "get_all_owners_and_scids":
		// Return full map for clients that need owner info
		result = s.app.gnomonClient.GetAllOwnersAndSCIDs()

	case "getscidvariables", "get_scid_variables":
		scid := getStringParam(req.Params, "scid")
		if scid == "" {
			return errorResponse(req.ID, -32602, "Missing 'scid' parameter")
		}
		result = s.app.gnomonClient.GetAllSCIDVariableDetails(scid)

	case "getscidvaluesbykey", "get_scid_values_by_key":
		scid := getStringParam(req.Params, "scid")
		key := getStringParam(req.Params, "key")
		if scid == "" || key == "" {
			return errorResponse(req.ID, -32602, "Missing 'scid' or 'key' parameter")
		}
		valStr, valUint := s.app.gnomonClient.GetSCIDValuesByKey(scid, key)
		result = map[string]any{
			"values_string": valStr,
			"values_uint64": valUint,
		}

	case "getscidkeysbyvalue", "get_scid_keys_by_value":
		scid := getStringParam(req.Params, "scid")
		value := req.Params["value"]
		if scid == "" || value == nil {
			return errorResponse(req.ID, -32602, "Missing 'scid' or 'value' parameter")
		}
		keyStr, keyUint := s.app.gnomonClient.GetSCIDKeysByValue(scid, value)
		result = map[string]any{
			"keys_string": keyStr,
			"keys_uint64": keyUint,
		}

	// === TELA Queries ===
	case "gettelaapps", "get_tela_apps":
		result = s.app.gnomonClient.GetTELAApps()

	case "gettelalibraries", "get_tela_libraries":
		result = s.app.gnomonClient.GetTELALibraries()

	case "searchtelaapps", "search_tela_apps":
		query := getStringParam(req.Params, "query")
		result = s.app.gnomonClient.SearchTELApps(query)

	case "resolvedurl", "resolve_durl":
		durl := getStringParam(req.Params, "durl")
		if scid, ok := s.app.gnomonClient.ResolveDURL(durl); ok {
			result = map[string]any{"scid": scid, "found": true}
		} else {
			result = map[string]any{"found": false}
		}

	case "resolvename", "resolve_name":
		name := getStringParam(req.Params, "name")
		if scid, ok := s.app.gnomonClient.ResolveName(name); ok {
			result = map[string]any{"scid": scid, "found": true}
		} else {
			result = map[string]any{"found": false}
		}

	// === Tag System ===
	case "getscidsbytag", "get_scids_by_tag":
		tag := getStringParam(req.Params, "tag")
		store := InitSCIDTagStore()
		result = store.GetSCIDsByTag(tag)

	case "getscidsbyclass", "get_scids_by_class":
		class := getStringParam(req.Params, "class")
		store := InitSCIDTagStore()
		result = store.GetSCIDsByClass(class)

	case "getalltags", "get_all_tags":
		store := InitSCIDTagStore()
		result = store.GetAllTags()

	case "getallclasses", "get_all_classes":
		store := InitSCIDTagStore()
		result = store.GetAllClasses()

	case "getscidmetadata", "get_scid_metadata":
		scid := getStringParam(req.Params, "scid")
		store := InitSCIDTagStore()
		result = store.GetMetadata(scid)

	case "gettagstats", "get_tag_stats":
		store := InitSCIDTagStore()
		result = store.GetStats()

	// === Status ===
	case "getstatus", "get_status":
		result = s.app.gnomonClient.GetStatus()

	case "getindexheight", "get_index_height":
		status := s.app.gnomonClient.GetStatus()
		result = map[string]any{
			"indexed_height": status["indexed_height"],
			"chain_height":   status["chain_height"],
			"progress":       status["progress"],
		}

	// === AddSCIDToIndex (Bug #1 fix) ===
	// Manually index a SCID that fastsync missed. Compatible with civilware's
	// feat-addscidtoindex-wsserver WS API so dApps following that pattern just work.
	case "addscidtoindex", "addscid_toindex", "add_scid_to_index":
		scid := getStringParam(req.Params, "scid")
		if scid == "" {
			return errorResponse(req.ID, -32602, "Missing 'scid' parameter")
		}
		varstoreonly := getBoolParam(req.Params, "varstoreonly")
		skipfsrecheck := getBoolParam(req.Params, "skipfsrecheck")

		err := s.app.gnomonClient.AddSCIDToIndex(scid, varstoreonly, skipfsrecheck)
		if err != nil {
			result = map[string]any{
				"success": false,
				"result":  fmt.Sprintf("Err - %v", err),
			}
		} else {
			result = map[string]any{
				"success": true,
				"result":  "Success",
				"scid":    scid,
			}
		}

	default:
		return errorResponse(req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method))
	}

	return GnomonWSResponse{
		ID:     req.ID,
		Result: result,
	}
}

// Helper functions

func errorResponse(id any, code int, message string) GnomonWSResponse {
	return GnomonWSResponse{
		ID: id,
		Error: &WSError{
			Code:    code,
			Message: message,
		},
	}
}

func getStringParam(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	if val, ok := params[key].(string); ok {
		return val
	}
	return ""
}

func getInt64Param(params map[string]any, key string) int64 {
	if params == nil {
		return 0
	}
	switch v := params[key].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	}
	return 0
}

func getBoolParam(params map[string]any, key string) bool {
	if params == nil {
		return false
	}
	if v, ok := params[key].(bool); ok {
		return v
	}
	return false
}
