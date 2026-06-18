package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/civilware/tela"
)

// ServerManager handles TELA server lifecycle

// ServerInfo represents an active TELA server
type ActiveServer struct {
	Name      string `json:"name"`
	SCID      string `json:"scid"`
	Port      int    `json:"port"`
	URL       string `json:"url"`
	IsLocal   bool   `json:"isLocal"`
	Directory string `json:"directory,omitempty"`
}

// Global server registry
var serverRegistry = struct {
	sync.RWMutex
	servers map[string]*ActiveServer
}{
	servers: make(map[string]*ActiveServer),
}

// Proxy server registry - maps SCID to proxy server
var proxyRegistry = struct {
	sync.RWMutex
	proxies map[string]*http.Server // SCID -> proxy server
	ports   map[string]int          // SCID -> proxy port
}{
	proxies: make(map[string]*http.Server),
	ports:   make(map[string]int),
}

// In-memory server registry - for serving DocShards content assembled by HOLOGRAM
var memoryServerRegistry = struct {
	sync.RWMutex
	servers map[string]*http.Server // SCID -> in-memory server
	ports   map[string]int          // SCID -> port
	content map[string]*TELAContent // SCID -> assembled content
}{
	servers: make(map[string]*http.Server),
	ports:   make(map[string]int),
	content: make(map[string]*TELAContent),
}

// findAvailableProxyPort finds an available port for the proxy server
func findAvailableProxyPort() (int, error) {
	// Use port range 50000-60000 for proxy servers (separate from tela servers)
	for port := 50000; port < 60000; port++ {
		addr := fmt.Sprintf("127.0.0.1:%d", port)
		listener, err := net.Listen("tcp", addr)
		if err == nil {
			listener.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available ports in range 50000-60000")
}

// createProxyServer creates a reverse proxy that strips CSP headers
//
// SECURITY CONSIDERATIONS:
// =======================
// This proxy removes Content-Security-Policy (CSP) headers to allow TELA apps
// like dero-explorer to function properly. While removing CSP reduces one
// security layer, Hologram maintains security through multiple other layers:
//
// 1. Blockchain Immutability: TELA content is stored on-chain and cannot be
//    modified after deployment. The content served is cryptographically verified.
//
// 2. Iframe Sandboxing: All TELA apps run in a sandboxed iframe with restricted
//    permissions (allow-scripts, allow-same-origin, allow-forms, allow-modals).
//
// 3. Controlled API Access: The telaHost API requires explicit user approval for
//    sensitive operations (transactions, wallet access). Apps cannot access
//    wallet functions without user interaction.
//
// 4. Local Execution: Content runs locally on the user's machine, not on a
//    remote server that could be compromised.
//
// 5. Source Verification: Content is fetched directly from the DERO blockchain
//    daemon, not from arbitrary web servers.
//
// The risk of removing CSP is mitigated by these layers. A malicious TELA app
// would need to:
// - Be deployed to the blockchain (permanent, verifiable)
// - Bypass iframe sandbox restrictions
// - Get user approval for any wallet operations
// - Operate within the constraints of local execution
//
// This defense-in-depth approach provides security while enabling TELA apps
// that require CSP relaxation to function.
func createProxyServer(targetURL, scid string) (string, error) {
	// Parse target URL
	target, err := url.Parse(targetURL)
	if err != nil {
		return "", fmt.Errorf("invalid target URL: %w", err)
	}

	// Extract the base URL (scheme + host) for the proxy target
	// The reverse proxy needs just the base, not the full path
	baseTarget := &url.URL{
		Scheme: target.Scheme,
		Host:   target.Host,
	}

	// Find available port
	port, err := findAvailableProxyPort()
	if err != nil {
		return "", err
	}

	// Create reverse proxy pointing to base URL
	proxy := httputil.NewSingleHostReverseProxy(baseTarget)
	
	// Get XSWD bridge script (same as in Browser.svelte)
	xswdBridgeScript := getXSWDBridgeScript()
	
	// Modify response to strip CSP headers and inject XSWD bridge
	// The bridge is needed because iframe sandbox restrictions may block direct WebSocket connections
	proxy.ModifyResponse = func(r *http.Response) error {
		// Remove Content-Security-Policy header to allow apps that need it
		r.Header.Del("Content-Security-Policy")
		r.Header.Del("Content-Security-Policy-Report-Only")
		
		// Add security headers for defense-in-depth
		// X-Frame-Options is not needed since we control the iframe
		// X-Content-Type-Options prevents MIME sniffing
		r.Header.Set("X-Content-Type-Options", "nosniff")
		
		// Inject XSWD bridge script into HTML responses
		contentType := r.Header.Get("Content-Type")
		if strings.Contains(contentType, "text/html") {
			// Read the response body
			body, err := io.ReadAll(r.Body)
			if err != nil {
				return err
			}
			r.Body.Close()
			
			// Inject bridge scripts at the beginning of HTML (before any other scripts)
			bodyStr := string(body)
			modifiedBody := xswdBridgeScript + getHologramClipboardBridgeScript() + bodyStr
			
			// Update content length
			r.ContentLength = int64(len(modifiedBody))
			r.Header.Set("Content-Length", fmt.Sprintf("%d", len(modifiedBody)))
			
			// Create new body reader
			r.Body = io.NopCloser(strings.NewReader(modifiedBody))
		}
		
		return nil
	}

	// Create HTTP server
	server := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", port),
		Handler: proxy,
	}

	// Start server in goroutine
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			// Log error but don't fail - proxy server error
			fmt.Printf("[PROXY] Error serving proxy for %s: %v\n", scid, err)
		}
	}()

	// Register proxy
	proxyRegistry.Lock()
	proxyRegistry.proxies[scid] = server
	proxyRegistry.ports[scid] = port
	proxyRegistry.Unlock()

	// Return proxy URL at root - the reverse proxy handles all paths
	// The tela server URL may include a path (e.g. entry point), but the proxy
	// should serve the entire site from root
	proxyURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	return proxyURL, nil
}

// serveDocShardsContent creates an in-memory HTTP server for assembled DocShards content.
// This bypasses the tela library (which doesn't support DocShards) and serves content
// directly from memory, including binary files like WASM that can't be inlined into HTML.
func (a *App) serveDocShardsContent(scid string, content *TELAContent) (string, error) {
	a.logToConsole("[MEM] Creating in-memory server for DocShards content")

	// Check if server already exists for this SCID
	memoryServerRegistry.RLock()
	if existingServer := memoryServerRegistry.servers[scid]; existingServer != nil {
		port := memoryServerRegistry.ports[scid]
		memoryServerRegistry.RUnlock()
		serverURL := fmt.Sprintf("http://127.0.0.1:%d", port)
		a.logToConsole(fmt.Sprintf("[MEM] Reusing existing in-memory server: %s", serverURL))
		return serverURL, nil
	}
	memoryServerRegistry.RUnlock()

	// Find available port
	port, err := findAvailableProxyPort()
	if err != nil {
		return "", fmt.Errorf("failed to find available port: %w", err)
	}

	// Create HTTP handler that serves content from memory
	mux := http.NewServeMux()

	// Serve HTML at root
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" || path == "/index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			// Inject XSWD bridge script for wallet connectivity
			html := content.HTML
			bridgeScript := getXSWDBridgeScript()
			html = injectScriptIntoHTML(html, bridgeScript)
			html = injectScriptIntoHTML(html, getHologramClipboardBridgeScript())
			w.Write([]byte(html))
			return
		}

		// Strip leading slash for filename lookup
		filename := strings.TrimPrefix(path, "/")

		// Try to serve from JSByName
		if js, ok := content.JSByName[filename]; ok {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Write([]byte(js))
			return
		}

		// Try to serve from CSSByName
		if css, ok := content.CSSByName[filename]; ok {
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Write([]byte(css))
			return
		}

		// Try to serve from StaticByName (WASM, RIV, images, etc.)
		if static, ok := content.StaticByName[filename]; ok {
			ext := strings.ToLower(filepath.Ext(filename))
			var contentType string
			switch ext {
			case ".wasm":
				contentType = "application/wasm"
			case ".riv":
				contentType = "application/octet-stream"
			case ".json":
				contentType = "application/json"
			case ".svg":
				contentType = "image/svg+xml"
			case ".png":
				contentType = "image/png"
			case ".jpg", ".jpeg":
				contentType = "image/jpeg"
			case ".gif":
				contentType = "image/gif"
			case ".webp":
				contentType = "image/webp"
			case ".ico":
				contentType = "image/x-icon"
			default:
				contentType = "application/octet-stream"
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Write([]byte(static))
			return
		}

		// File not found
		http.NotFound(w, r)
	})

	// Create and start server
	server := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", port),
		Handler: mux,
	}

	// Start server in goroutine
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.logToConsole(fmt.Sprintf("[MEM] Server error for %s: %v", scid, err))
		}
	}()

	// Register server
	memoryServerRegistry.Lock()
	memoryServerRegistry.servers[scid] = server
	memoryServerRegistry.ports[scid] = port
	memoryServerRegistry.content[scid] = content
	memoryServerRegistry.Unlock()

	serverURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	a.logToConsole(fmt.Sprintf("[MEM] In-memory server started: %s", serverURL))

	// Log what files are available
	if len(content.JSByName) > 0 {
		for name := range content.JSByName {
			a.logToConsole(fmt.Sprintf("  [MEM] Serving JS: /%s", name))
		}
	}
	if len(content.StaticByName) > 0 {
		for name := range content.StaticByName {
			a.logToConsole(fmt.Sprintf("  [MEM] Serving static: /%s", name))
		}
	}

	return serverURL, nil
}

// injectScriptIntoHTML injects a script into HTML, preferably into <head>
func injectScriptIntoHTML(html, script string) string {
	// Try to inject after <head>
	if idx := strings.Index(strings.ToLower(html), "<head>"); idx != -1 {
		insertPos := idx + 6
		return html[:insertPos] + "\n" + script + "\n" + html[insertPos:]
	}
	// Try to inject after <!DOCTYPE html>
	if idx := strings.Index(strings.ToLower(html), "<!doctype html>"); idx != -1 {
		insertPos := idx + 15
		return html[:insertPos] + "\n" + script + "\n" + html[insertPos:]
	}
	// Prepend to HTML
	return script + "\n" + html
}

// getHologramClipboardBridgeScript wraps navigator.clipboard WRITE inside the TELA iframe.
// WKWebKit/WebKitGTK often rejects the Clipboard API in embedded frames even with sandbox flags;
// the parent resolves writes via Wails ClipboardSetText (see Browser.svelte).
//
// READ is deliberately NOT bridged. Bridging readText would let untrusted TELA content read the
// host OS clipboard — including a recovery seed/secret key the user just copied from the reveal
// modal (a ~30s window before auto-clear) — which is total, irreversible key exposure. TELA apps
// have no legitimate need to read the host clipboard; only their copy buttons (write) do. We leave
// the native readText in place (WebKit may reject it in-frame, which is the correct posture).
func getHologramClipboardBridgeScript() string {
	return `<script>
(function() {
  'use strict';
  try {
    if (!navigator || !navigator.clipboard || window.parent === window) return;
    var clip = navigator.clipboard;
    var ow = clip.writeText && clip.writeText.bind(clip);

    function viaBridgeWrite(text) {
      return new Promise(function(resolve, reject) {
        var id = 'hcb_' + Math.random().toString(36).slice(2) + '_' + Date.now();
        function onMsg(ev) {
          var d = ev.data;
          if (!d || d.type !== 'hologram-clipboard-response' || d.id !== id) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(tmo);
          if (d.ok) resolve();
          else reject(new Error(d.error || 'Clipboard operation failed'));
        }
        window.addEventListener('message', onMsg);
        var tmo = setTimeout(function() {
          window.removeEventListener('message', onMsg);
          reject(new Error('Clipboard bridge timeout'));
        }, 15000);
        try {
          window.parent.postMessage({ type: 'hologram-clipboard-request', id: id, op: 'write', text: text === undefined || text === null ? '' : String(text) }, '*');
        } catch (e) {
          window.removeEventListener('message', onMsg);
          clearTimeout(tmo);
          reject(e);
        }
      });
    }

    clip.writeText = function(txt) {
      if (!ow) return viaBridgeWrite(txt);
      return ow(txt).catch(function() { return viaBridgeWrite(txt); });
    };
    // readText intentionally left as the native implementation — never bridged.
  } catch (e) {}
})();
</script>`
}

// getXSWDBridgeScript returns the XSWD bridge script to inject into TELA apps
// This script intercepts WebSocket connections to localhost:44326 and routes them
// through Hologram's XSWD server via postMessage
func getXSWDBridgeScript() string {
	return `<script>
(function() {
  'use strict';
  
  // Simple log to parent
  function log(msg) {
    try { window.parent.postMessage({ type: 'xswd-request', id: 0, action: 'log', payload: msg }, '*'); } catch(e) {}
    // Also log to console for debugging
    try { console.log('[XSWD Bridge]', msg); } catch(e) {}
  }
  
  log('[Bridge] Initializing...');
  
  // CRITICAL: Override WebSocket IMMEDIATELY before any other scripts can use it
  // Store original WebSocket FIRST, before anything else
  var OriginalWebSocket = window.WebSocket;
  log('[Bridge] Original WebSocket stored');
  
  // Request ID for parent communication
  var reqId = 0;
  var pending = {};
  
  // Listen for parent responses
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'xswd-response' && pending[e.data.id]) {
      var p = pending[e.data.id];
      delete pending[e.data.id];
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    }
  });
  
  // Send to parent and wait
  function request(action, payload) {
    return new Promise(function(resolve, reject) {
      var id = ++reqId;
      pending[id] = { resolve: resolve, reject: reject };
      var message = { type: 'xswd-request', id: id, action: action, payload: payload };
      log('[Bridge] Sending postMessage to parent: ' + JSON.stringify({ id: id, action: action, payloadKeys: Object.keys(payload || {}) }));
      window.parent.postMessage(message, '*');
      setTimeout(function() { 
        if (pending[id]) { 
          log('[Bridge] Request ' + id + ' timed out after 60s');
          delete pending[id]; 
          reject(new Error('timeout')); 
        } 
      }, 60000);
    });
  }
  
  // XSWD WebSocket Proxy
  // Don't inherit from WebSocket.prototype - it has readonly properties that break in Wails
  // Instead, create a plain object and manually implement WebSocket interface
  function XSWDProxy(url) {
    var self = this;
    
    // Use Object.defineProperty to set writable properties (avoids readonly errors)
    Object.defineProperty(self, 'url', { value: url, writable: true, enumerable: true });
    Object.defineProperty(self, 'readyState', { value: 0, writable: true, enumerable: true }); // CONNECTING
    
    // Monitor onopen handler being set
    var originalOnopen = null;
    Object.defineProperty(self, 'onopen', {
      get: function() { return originalOnopen; },
      set: function(value) {
        log('[Bridge] onopen handler being set by dApp');
        originalOnopen = value;
        // If connection is already open and handler is being set, trigger it
        if (self.readyState === 1 && value && !self._handshakeSent) {
          setTimeout(function() {
            log('[Bridge] Triggering onopen handler (set after connection opened)');
            try {
              value({ type: 'open', target: self });
            } catch(e) {
              log('[Error] onopen error (late set): ' + e.message);
            }
          }, 0);
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(self, 'onmessage', { value: null, writable: true, enumerable: true });
    Object.defineProperty(self, 'onerror', { value: null, writable: true, enumerable: true });
    Object.defineProperty(self, 'onclose', { value: null, writable: true, enumerable: true });
    
    // Internal state
    self._auth = 'pending';
    self._queue = [];
    self._handshakeSent = false;
    
    log('[XSWD] Connection intercepted: ' + url);
    
    // Simulate connection open - use setTimeout to give dApp time to set handlers
    // Real WebSocket takes a moment to connect, so this delay is realistic
    setTimeout(function() {
      self.readyState = 1; // OPEN
      log('[XSWD] WebSocket opened (readyState = OPEN)');
      if (self.onopen) {
        log('[OK] onopen handler is set, calling it');
        try {
          self.onopen({ type: 'open', target: self });
        } catch(e) {
          log('[Error] onopen error: ' + e.message);
        }
      } else {
        log('[Warn] No onopen handler set yet - dApp may set it later');
      }
      // Process queued messages
      var queuedCount = self._queue.length;
      if (queuedCount > 0) {
        log('[Queue] Processing ' + queuedCount + ' queued message(s)');
      }
      while (self._queue.length) {
        var msg = self._queue.shift();
        log('[Queue] Processing queued message:', typeof msg === 'string' ? msg.substring(0, 200) : JSON.stringify(msg).substring(0, 200));
        self._handle(msg);
      }
    }, 10);
    
    // Also check for onopen handler after delays in case dApp sets it asynchronously
    // Some dApps set onopen handler in setTimeout or after other initialization
    [50, 100, 200, 500, 1000].forEach(function(delay) {
      setTimeout(function() {
        if (self.onopen && !self._handshakeSent && self.readyState === 1) {
          log('[Bridge] onopen handler now set (delayed ' + delay + 'ms), triggering manually');
          try {
            self.onopen({ type: 'open', target: self });
          } catch(e) {
            log('[Error] onopen error (delayed ' + delay + 'ms): ' + e.message);
          }
        }
      }, delay);
    });
  }
  
  // Don't inherit from WebSocket.prototype - it has readonly properties
  // Instead, create a plain prototype and manually implement the interface
  // This avoids "readonly property" errors in Wails WebView
  // MUST set prototype BEFORE defining methods, otherwise methods get wiped out!
  XSWDProxy.prototype = {};
  XSWDProxy.prototype.constructor = XSWDProxy;
  
  // Now define all methods on the prototype
  XSWDProxy.prototype.send = function(data) {
    log('[Bridge] WebSocket.send() called with data:', typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200));
    if (this.readyState === 0) { 
      log('[Bridge] Queueing message (connection not open yet)');
      this._queue.push(data); 
      return; 
    }
    if (this.readyState !== 1) throw new Error('WebSocket closed');
    this._handle(data);
  };
  
  XSWDProxy.prototype._handle = function(data) {
    var self = this;
    try {
      var msg = typeof data === 'string' ? JSON.parse(data) : data;
      log('[XSWD] ' + (msg.method || 'handshake') + ' | Full message: ' + JSON.stringify(msg).substring(0, 200));
      
      // Handshake detection - multiple patterns
      // Pattern 1: Plain object with name/description (no method)
      var isHandshake1 = !msg.method && (msg.name || msg.description || msg.appName || msg.app_name);
      // Pattern 2: JSON-RPC with method "handshake"
      var isHandshake2 = msg.method === 'handshake' || msg.method === 'Handshake';
      // Pattern 3: First message after connection (if no auth yet)
      var isHandshake3 = self._auth === 'pending' && !msg.method && Object.keys(msg).length > 0;
      
      if (isHandshake1 || isHandshake2 || isHandshake3) {
        log('[Bridge] Detected handshake message (pattern: ' + (isHandshake1 ? '1' : isHandshake2 ? '2' : '3') + ')');
        self._handshakeSent = true;
        // Normalize handshake data
        var handshakeData = msg.params || msg;
        var appInfo = {
          name: handshakeData.name || msg.name || handshakeData.appName || msg.appName || handshakeData.app_name || msg.app_name || 'Unknown App',
          description: handshakeData.description || msg.description || handshakeData.desc || msg.desc || '',
          url: handshakeData.url || msg.url || handshakeData.origin || msg.origin || window.location.href
        };
        log('[Bridge] Sending connect request with appInfo:', JSON.stringify(appInfo));
        request('connect', { appInfo: appInfo }).then(function(ok) {
          self._auth = ok ? 'accepted' : 'denied';
          log(ok ? '[OK] Connection approved' : '[Denied] Connection denied');
          // Match real XSWD server response format exactly - dApp checks for both 'accepted' and 'message'
          if (ok) {
            self._respond({ accepted: true, message: 'Wallet connection approved' });
          } else {
            self._respond({ accepted: false, message: 'Connection denied' });
          }
        }).catch(function(e) {
          self._auth = 'denied';
          log('[Error] Handshake error: ' + e.message);
          self._respond({ accepted: false, message: e.message || 'Connection failed' });
        });
        return;
      }
      
      // RPC call - but check if we need to authenticate first
      if (!self._handshakeSent && self._auth === 'pending') {
        log('[Bridge] RPC call received before handshake - triggering connection request');
        log('[Bridge] Method: ' + msg.method + ', will request connection approval');
        // Treat this as a handshake attempt - trigger connection modal
        var appInfo = {
          name: msg.method ? (msg.method.replace('DERO.', '').replace('Gnomon.', '') + ' App') : 'Unknown App',
          description: 'Connection request for ' + (msg.method || 'wallet access'),
          url: window.location.href
        };
        self._handshakeSent = true;
        log('[Bridge] Requesting connection with appInfo:', JSON.stringify(appInfo));
        request('connect', { appInfo: appInfo }).then(function(ok) {
          log('[Bridge] Connection request resolved:', ok);
          self._auth = ok ? 'accepted' : 'denied';
          if (ok) {
            log('[OK] Connection approved, processing original RPC call');
            // Now process the original RPC call
            request('call', { method: msg.method, params: msg.params, authState: self._auth }).then(function(r) {
              self._respond({ jsonrpc: '2.0', id: msg.id, result: r });
            }).catch(function(e) {
              log('[Error] RPC call failed:', e.message);
              self._respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
            });
          } else {
            log('[Denied] Connection denied');
            self._respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32003, message: 'Connection denied' } });
          }
        }).catch(function(e) {
          log('[Error] Connection request error:', e.message);
          self._auth = 'denied';
          self._respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
        });
        return;
      }
      
      // Normal RPC call (after handshake)
      request('call', { method: msg.method, params: msg.params, authState: self._auth }).then(function(r) {
        self._respond({ jsonrpc: '2.0', id: msg.id, result: r });
      }).catch(function(e) {
        self._respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
      });
    } catch(e) {
      log('[Error] XSWD error: ' + e.message);
    }
  };
  
  // Dispatch to BOTH onmessage and every addEventListener('message') handler — the
  // native WebSocket fires the 'message' event on all registered listeners, and dApps
  // commonly mix the two styles (e.g. ws.onmessage = receive then ws.addEventListener
  // ('message', checkHandshake) for a one-shot handshake observer).
  XSWDProxy.prototype._respond = function(r) {
    var self = this;
    var ev = { type: 'message', data: JSON.stringify(r), target: self };
    setTimeout(function() {
      if (self.onmessage) {
        try { self.onmessage(ev); } catch(e) { log('[Error] onmessage: ' + e.message); }
      }
      if (self._messageHandlers) {
        self._messageHandlers.forEach(function(h) {
          try { h(ev); } catch(e) { log('[Error] message listener: ' + e.message); }
        });
      }
    }, 0);
  };

  XSWDProxy.prototype.addEventListener = function(event, handler) {
    var self = this;
    if (event === 'open') {
      log('[Bridge] addEventListener("open") called');
      if (self.readyState === 1) {
        // Connection already open, trigger immediately
        setTimeout(function() {
          log('[Bridge] Triggering addEventListener("open") handler (connection already open)');
          try {
            handler({ type: 'open', target: self });
          } catch(e) {
            log('[Error] addEventListener("open") error: ' + e.message);
          }
        }, 0);
      } else {
        // Store handler to call when connection opens
        self.onopen = handler;
      }
    } else if (event === 'message') {
      if (!self._messageHandlers) self._messageHandlers = [];
      self._messageHandlers.push(handler);
      // _respond fans out to onmessage AND _messageHandlers, so no dispatcher shim here.
    } else if (event === 'error') {
      if (!self._errorHandlers) self._errorHandlers = [];
      self._errorHandlers.push(handler);
      if (!self.onerror) {
        self.onerror = function(e) {
          if (self._errorHandlers) {
            self._errorHandlers.forEach(function(h) { h(e); });
          }
        };
      }
    } else if (event === 'close') {
      if (!self._closeHandlers) self._closeHandlers = [];
      self._closeHandlers.push(handler);
      if (!self.onclose) {
        self.onclose = function(e) {
          if (self._closeHandlers) {
            self._closeHandlers.forEach(function(h) { h(e); });
          }
        };
      }
    }
  };
  
  XSWDProxy.prototype.removeEventListener = function(event, handler) {
    // Basic implementation - could be improved
    if (event === 'message' && this._messageHandlers) {
      var idx = this._messageHandlers.indexOf(handler);
      if (idx >= 0) this._messageHandlers.splice(idx, 1);
    }
    // Similar for other events...
  };
  
  XSWDProxy.prototype.close = function() {
    this.readyState = 3;
    if (this.onclose) this.onclose({ type: 'close', code: 1000 });
    if (this._closeHandlers) {
      this._closeHandlers.forEach(function(h) { h({ type: 'close', code: 1000 }); });
    }
  };
  
  XSWDProxy.CONNECTING = 0;
  XSWDProxy.OPEN = 1;
  XSWDProxy.CLOSING = 2;
  XSWDProxy.CLOSED = 3;
  
  // Override WebSocket IMMEDIATELY - must happen before any dApp code runs
  window.WebSocket = function(url, protocols) {
    log('[Bridge] WebSocket constructor called: ' + (url || 'no url'));
    // XSWD port: 44326 (mainnet)
    if (url && (url.indexOf('44326') !== -1 || url.indexOf('44325') !== -1 || url.indexOf('xswd') !== -1)) {
      log('[Bridge] Intercepting XSWD connection: ' + url);
      try {
        // Create proxy - it already has the right prototype from XSWDProxy.prototype
        var proxy = new XSWDProxy(url);
        log('[Bridge] XSWDProxy created successfully');
        return proxy;
      } catch(e) {
        log('[Error] Error creating XSWDProxy: ' + e.message);
        log('[Error] Error stack: ' + (e.stack || 'no stack'));
        // Fallback to original WebSocket
        return protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
      }
    }
    // Not an XSWD connection, use original WebSocket
    return protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
  };
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  
  log('[Bridge] Ready - WebSocket interception active');
  
  // NOTE: We do NOT inject telaHost here because:
  // 1. The real telaHost is injected by Browser.svelte's injectTelaHostAPI() after iframe loads
  // 2. If we inject an incomplete telaHost here, dApps find it but can't use it, causing silent failures
  // 3. By not providing telaHost, dApps will fall back to WebSocket, which our bridge intercepts
  // 4. Once the real telaHost is injected, dApps can use it if they prefer

  // ── Blob download interceptor ────────────────────────────────────────────
  // HTTP-served TELA apps run cross-origin from the parent Wails window, so the
  // parent cannot inject JavaScript into this iframe's context directly.  The
  // bridge script runs here (in the iframe's own origin) and is therefore the
  // right place to intercept downloads and forward them via postMessage so the
  // parent can open a native save-file dialog.
  (function() {
    // Cache blobs at createObjectURL time so we still have the data even after
    // the app calls revokeObjectURL synchronously (e.g. Villager does this
    // immediately after a.click(), which races against any async fetch).
    var _blobCache = {};

    var _origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
      var url = _origCreate(obj);
      if (obj && typeof obj === 'object') _blobCache[url] = obj;
      return url;
    };

    var _origRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function(url) {
      delete _blobCache[url];
      return _origRevoke(url);
    };

    function _saveBlobDownload(href, filename, cachedBlob) {
      var blob = cachedBlob || _blobCache[href];
      if (!blob) {
        // Last-resort fetch (may fail if already revoked, but worth trying)
        fetch(href).then(function(r) { return r.blob(); }).then(function(b) {
          _saveBlobDownload(href, filename, b);
        }).catch(function(e) {
          log('[Download] Blob unavailable: ' + e.message);
        });
        return;
      }
      var reader = new FileReader();
      reader.onloadend = function() {
        request('saveFile', {
          filename: filename,
          base64: reader.result,
          mimeType: blob.type || 'application/octet-stream'
        }).then(function(result) {
          if (result && result.success) {
            log('[OK] File saved: ' + (result.path || filename));
          } else if (result && result.cancelled) {
            log('[Info] Download cancelled');
          } else {
            log('[Download] Save failed: ' + (result && result.error));
          }
        }).catch(function(e) {
          log('[Download] Save request error: ' + e.message);
        });
      };
      reader.readAsDataURL(blob);
    }

    // Intercept programmatic .click() on <a download blob:...> elements.
    // Must be synchronous so the blob reference is captured before revokeObjectURL fires.
    var _origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.hasAttribute('download') && this.href && this.href.indexOf('blob:') === 0) {
        var href = this.href;
        var filename = this.download || 'download';
        var cached = _blobCache[href]; // capture sync
        log('[Download] Intercepting: ' + filename);
        _saveBlobDownload(href, filename, cached);
        return;
      }
      return _origAnchorClick.call(this);
    };

    // Intercept declarative clicks on <a download> in markup.
    document.addEventListener('click', function(e) {
      var el = e.target;
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (!el || !el.hasAttribute('download')) return;
      var href = el.href;
      if (!href || href.indexOf('blob:') !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var filename = el.download || 'download';
      var cached = _blobCache[href];
      log('[Download] Intercepting click: ' + filename);
      _saveBlobDownload(href, filename, cached);
    }, true);

    log('[Bridge] Download interceptor installed');
  })();

  // ── File input interceptor ────────────────────────────────────────────────
  // Intercepts file input elements so dApps can select files through HOLOGRAM's
  // native file dialog. This works around iframe sandbox restrictions that
  // prevent file inputs from working in Wails WebView.
  (function() {
    // Override click on file inputs to route through parent
    function interceptFileInputClick(input) {
      var accept = input.getAttribute('accept') || '';
      var title = input.getAttribute('title') || input.getAttribute('data-title') || 'Select File';
      
      log('[File] Intercepting file input click: accept=' + accept);
      
      request('selectFile', { title: title, accept: accept }).then(function(result) {
        if (result && result.success && result.base64) {
          log('[OK] File selected: ' + result.filename + ' (' + result.size + ' bytes)');
          
          // Convert base64 to Blob and create a File object
          var byteString = atob(result.base64);
          var ab = new ArrayBuffer(byteString.length);
          var ia = new Uint8Array(ab);
          for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          var blob = new Blob([ab], { type: result.mimeType || 'application/octet-stream' });
          
          // Create a File object (for browser compatibility)
          var file;
          try {
            file = new File([blob], result.filename, { type: result.mimeType || 'application/octet-stream' });
          } catch(e) {
            // Safari workaround - File constructor may not work in some contexts
            file = blob;
            file.name = result.filename;
            file.lastModified = Date.now();
          }
          
          // Create a synthetic FileList-like object
          var dt = new DataTransfer();
          dt.items.add(file);
          
          // Set the files on the input (this triggers any onchange handlers)
          try {
            input.files = dt.files;
          } catch(e) {
            log('[Warn] Could not set input.files: ' + e.message);
          }
          
          // Dispatch change event so dApp knows a file was selected
          var changeEvent = new Event('change', { bubbles: true, cancelable: false });
          input.dispatchEvent(changeEvent);
          
          // Also dispatch input event for completeness
          var inputEvent = new Event('input', { bubbles: true, cancelable: false });
          input.dispatchEvent(inputEvent);
          
          log('[File] File data injected and events dispatched');
        } else if (result && result.cancelled) {
          log('[File] User cancelled file selection');
        } else {
          log('[File] Selection failed: ' + (result && result.error || 'unknown'));
        }
      }).catch(function(e) {
        log('[Error] File selection error: ' + e.message);
      });
    }
    
    // Method 1: Intercept programmatic .click() calls on file inputs
    var _origInputClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {
      if (this.type === 'file') {
        interceptFileInputClick(this);
        return;
      }
      return _origInputClick.call(this);
    };
    
    // Method 2: Intercept direct click events on file inputs
    document.addEventListener('click', function(e) {
      var el = e.target;
      if (el && el.tagName === 'INPUT' && el.type === 'file') {
        e.preventDefault();
        e.stopPropagation();
        interceptFileInputClick(el);
      }
    }, true);
    
    // Method 3: Override showOpenFilePicker if it exists (modern File System Access API)
    if (window.showOpenFilePicker) {
      var _origShowOpenFilePicker = window.showOpenFilePicker;
      window.showOpenFilePicker = function(options) {
        log('[File] showOpenFilePicker intercepted');
        options = options || {};
        var accept = '';
        if (options.types && options.types.length > 0) {
          var exts = [];
          options.types.forEach(function(t) {
            if (t.accept) {
              Object.keys(t.accept).forEach(function(mime) {
                t.accept[mime].forEach(function(ext) {
                  exts.push(ext);
                });
              });
            }
          });
          accept = exts.join(',');
        }
        
        return new Promise(function(resolve, reject) {
          request('selectFile', { title: 'Select File', accept: accept }).then(function(result) {
            if (result && result.success && result.base64) {
              var byteString = atob(result.base64);
              var ab = new ArrayBuffer(byteString.length);
              var ia = new Uint8Array(ab);
              for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
              }
              var blob = new Blob([ab], { type: result.mimeType || 'application/octet-stream' });
              
              // Create a mock FileSystemFileHandle
              var mockHandle = {
                kind: 'file',
                name: result.filename,
                getFile: function() {
                  return Promise.resolve(new File([blob], result.filename, { type: result.mimeType }));
                }
              };
              resolve([mockHandle]);
            } else if (result && result.cancelled) {
              reject(new DOMException('The user aborted a request.', 'AbortError'));
            } else {
              reject(new Error(result && result.error || 'File selection failed'));
            }
          }).catch(reject);
        });
      };
    }
    
    log('[Bridge] File input interceptor installed');
  })();
})();
</script>`
}

// shutdownProxyServer shuts down the proxy server for a given SCID
func shutdownProxyServer(scid string) {
	proxyRegistry.Lock()
	defer proxyRegistry.Unlock()

	server, exists := proxyRegistry.proxies[scid]
	if exists {
		server.Close()
		delete(proxyRegistry.proxies, scid)
		delete(proxyRegistry.ports, scid)
	}
}

// shutdownMemoryServer shuts down an in-memory DocShards server by SCID
func shutdownMemoryServer(scid string) {
	memoryServerRegistry.Lock()
	defer memoryServerRegistry.Unlock()

	server, exists := memoryServerRegistry.servers[scid]
	if exists {
		server.Close()
		delete(memoryServerRegistry.servers, scid)
		delete(memoryServerRegistry.ports, scid)
		delete(memoryServerRegistry.content, scid)
	}
}

// ListActiveServers returns all currently running TELA servers
func (a *App) ListActiveServers() map[string]interface{} {
	a.logToConsole("[Server] Listing active servers...")

	serverRegistry.RLock()
	defer serverRegistry.RUnlock()

	serverList := []map[string]interface{}{}
	for _, server := range serverRegistry.servers {
		serverList = append(serverList, map[string]interface{}{
			"name":      server.Name,
			"scid":      server.SCID,
			"port":      server.Port,
			"url":       server.URL,
			"isLocal":   server.IsLocal,
			"directory": server.Directory,
		})
	}

	// Also get TELA library's active servers
	telaServers := tela.GetServerInfo()
	for _, ts := range telaServers {
		// Check if already in our registry
		found := false
		for _, existing := range serverRegistry.servers {
			if existing.Name == ts.Name {
				found = true
				break
			}
		}
		if !found {
			serverList = append(serverList, map[string]interface{}{
				"name":    ts.Name,
				"scid":    ts.SCID,
				"address": ts.Address,
				"isLocal": ts.SCID == "",
			})
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d active servers", len(serverList)))

	return map[string]interface{}{
		"success": true,
		"servers": serverList,
		"count":   len(serverList),
	}
}

// ShutdownServer shuts down a specific server by name
func (a *App) ShutdownServer(name string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[STOP] Shutting down server: %s", name))

	// Find SCID from server name
	serverRegistry.RLock()
	var scid string
	for _, server := range serverRegistry.servers {
		if server.Name == name {
			scid = server.SCID
			break
		}
	}
	serverRegistry.RUnlock()

	// Shutdown proxy server if exists
	if scid != "" {
		shutdownProxyServer(scid)
	}

	// Try to shutdown via tela library
	tela.ShutdownServer(name)

	// Remove from our registry
	serverRegistry.Lock()
	delete(serverRegistry.servers, name)
	serverRegistry.Unlock()

	a.logToConsole(fmt.Sprintf("[OK] Server %s shutdown", name))

	return map[string]interface{}{
		"success": true,
		"name":    name,
		"message": "Server shutdown successfully",
	}
}

// ShutdownAllServers shuts down all running servers
func (a *App) ShutdownAllServers() map[string]interface{} {
	a.logToConsole("[STOP] Shutting down all servers...")

	// Shutdown all proxy servers
	proxyRegistry.Lock()
	for scid := range proxyRegistry.proxies {
		if server, exists := proxyRegistry.proxies[scid]; exists {
			server.Close()
		}
	}
	proxyRegistry.proxies = make(map[string]*http.Server)
	proxyRegistry.ports = make(map[string]int)
	proxyRegistry.Unlock()

	// Shutdown all in-memory DocShards servers
	memoryServerRegistry.Lock()
	for scid := range memoryServerRegistry.servers {
		if server, exists := memoryServerRegistry.servers[scid]; exists {
			server.Close()
		}
	}
	memoryServerRegistry.servers = make(map[string]*http.Server)
	memoryServerRegistry.ports = make(map[string]int)
	memoryServerRegistry.content = make(map[string]*TELAContent)
	memoryServerRegistry.Unlock()

	// Shutdown via tela library - get all servers and shut each down
	telaServers := tela.GetServerInfo()
	for _, ts := range telaServers {
		tela.ShutdownServer(ts.Name)
	}

	// Clear our registry
	serverRegistry.Lock()
	count := len(serverRegistry.servers)
	for name := range serverRegistry.servers {
		tela.ShutdownServer(name)
	}
	serverRegistry.servers = make(map[string]*ActiveServer)
	serverRegistry.Unlock()

	a.logToConsole(fmt.Sprintf("[OK] Shutdown %d servers", count))

	return map[string]interface{}{
		"success": true,
		"count":   count,
		"message": fmt.Sprintf("Shutdown %d servers", count),
	}
}

// ShutdownTELAServers shuts down only TELA (blockchain) servers, not local ones
func (a *App) ShutdownTELAServers() map[string]interface{} {
	a.logToConsole("[STOP] Shutting down TELA servers...")

	serverRegistry.Lock()
	shutdownCount := 0
	for name, server := range serverRegistry.servers {
		if !server.IsLocal {
			// Shutdown proxy for this SCID
			shutdownProxyServer(server.SCID)
			// Shutdown in-memory server for this SCID (if any)
			shutdownMemoryServer(server.SCID)
			tela.ShutdownServer(name)
			delete(serverRegistry.servers, name)
			shutdownCount++
		}
	}
	serverRegistry.Unlock()

	a.logToConsole(fmt.Sprintf("[OK] Shutdown %d TELA servers", shutdownCount))

	return map[string]interface{}{
		"success": true,
		"count":   shutdownCount,
		"message": fmt.Sprintf("Shutdown %d TELA servers", shutdownCount),
	}
}

// ShutdownLocalServers shuts down only local directory servers
func (a *App) ShutdownLocalServers() map[string]interface{} {
	a.logToConsole("[STOP] Shutting down local servers...")

	serverRegistry.Lock()
	shutdownCount := 0
	for name, server := range serverRegistry.servers {
		if server.IsLocal {
			tela.ShutdownServer(name)
			delete(serverRegistry.servers, name)
			shutdownCount++
		}
	}
	serverRegistry.Unlock()

	a.logToConsole(fmt.Sprintf("[OK] Shutdown %d local servers", shutdownCount))

	return map[string]interface{}{
		"success": true,
		"count":   shutdownCount,
		"message": fmt.Sprintf("Shutdown %d local servers", shutdownCount),
	}
}

// ServeTELAContent starts serving TELA content from a SCID
func (a *App) ServeTELAContent(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[NET] Starting TELA server for: %s", scid))

	// Check if proxy already exists for this SCID
	proxyRegistry.RLock()
	if _, exists := proxyRegistry.proxies[scid]; exists {
		port := proxyRegistry.ports[scid]
		proxyRegistry.RUnlock()
		
		// Proxy already exists, return its URL
		proxyURL := fmt.Sprintf("http://127.0.0.1:%d", port)
		
		// Get server name from registry
		serverRegistry.RLock()
		var name string
		for _, server := range serverRegistry.servers {
			if server.SCID == scid {
				name = server.Name
				break
			}
		}
		serverRegistry.RUnlock()
		
		if name == "" {
			// Try to get from tela library
			servers := tela.GetServerInfo()
			for _, s := range servers {
				if s.SCID == scid {
					name = s.Name
					break
				}
			}
		}
		
		a.logToConsole(fmt.Sprintf("[OK] Using existing proxy: %s", proxyURL))
		return map[string]interface{}{
			"success": true,
			"name":    name,
			"scid":    scid,
			"url":     proxyURL,
			"message": "TELA server proxy already running",
		}
	}
	proxyRegistry.RUnlock()

	// Get daemon endpoint
	endpoint := "127.0.0.1:10102"
	if ep, ok := a.settings["daemon_endpoint"].(string); ok && ep != "" {
		endpoint = ep
		if len(endpoint) > 7 && endpoint[:7] == "http://" {
			endpoint = endpoint[7:]
		}
	}

	// Allow updated content to be served (default is false which blocks updated TELA apps)
	// This is the "Browse Latest" behavior - users want to see the latest version
	tela.AllowUpdates(true)

	// Start server using tela library
	telaLink, err := tela.ServeTELA(scid, endpoint)
	if err != nil {
		// DocShards INDEX contracts are assembled by HOLOGRAM, not the tela library.
		// Since the tela library doesn't support serving DocShards, HOLOGRAM serves
		// the assembled content via its own HTTP server. This is necessary because
		// WASM files cannot be inlined into HTML and must be fetched via HTTP.
		if strings.Contains(err.Error(), "DocShards") {
			a.logToConsole("[MEM] DocShards detected — fetching and assembling content")
			
			// Fetch and assemble the content (same as FetchSCID does)
			content, fetchErr := a.FetchTELAContent(scid)
			if fetchErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] Failed to fetch DocShards content: %v", fetchErr))
				return map[string]interface{}{
					"success": false,
					"error":   fmt.Sprintf("Failed to fetch DocShards content: %v", fetchErr),
				}
			}
			
			// Create in-memory HTTP server to serve the assembled content
			memURL, memErr := a.serveDocShardsContent(scid, content)
			if memErr != nil {
				a.logToConsole(fmt.Sprintf("[ERR] Failed to create in-memory server: %v", memErr))
				return map[string]interface{}{
					"success": false,
					"error":   fmt.Sprintf("Failed to serve DocShards: %v", memErr),
				}
			}
			
			// Register the in-memory server as the active server
			durl := ""
			if du, ok := content.Meta["durl"].(string); ok {
				durl = du
			}
			serverName := durl
			if serverName == "" {
				serverName = scid[:16]
			}
			
			serverRegistry.Lock()
			serverRegistry.servers[serverName] = &ActiveServer{
				Name:    serverName,
				SCID:    scid,
				URL:     memURL,
				IsLocal: false,
			}
			serverRegistry.Unlock()
			
			a.logToConsole(fmt.Sprintf("[OK] DocShards content served via in-memory HTTP: %s", memURL))
			return map[string]interface{}{
				"success": true,
				"name":    serverName,
				"scid":    scid,
				"url":     memURL,
				"message": "DocShards content served via in-memory HTTP server",
			}
		}
		// Retry once if a stale clone already exists
		if cleanupTelaCloneFromError(err, a.logToConsole) {
			telaLink, err = tela.ServeTELA(scid, endpoint)
		}
		if err != nil {
			a.logToConsole(fmt.Sprintf("[ERR] Failed to start server: %v", err))
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("Failed to start server: %v", err),
			}
		}
	}

	// Get server info to find the address
	servers := tela.GetServerInfo()
	var address string
	var name string
	for _, s := range servers {
		if s.SCID == scid {
			address = s.Address
			name = s.Name
			break
		}
	}

	// Create reverse proxy that strips CSP headers
	// This allows TELA apps like dero-explorer to work properly
	proxyURL, err := createProxyServer(telaLink, scid)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[WARN] Failed to create proxy, using direct URL: %v", err))
		// Fallback to direct URL if proxy creation fails
		proxyURL = telaLink
	} else {
		a.logToConsole(fmt.Sprintf("[PROXY] Created proxy server: %s -> %s", proxyURL, telaLink))
	}

	// Register server
	serverRegistry.Lock()
	serverRegistry.servers[name] = &ActiveServer{
		Name:    name,
		SCID:    scid,
		URL:     proxyURL, // Store proxy URL, not direct tela URL
		IsLocal: false,
	}
	serverRegistry.Unlock()

	_ = address // suppress unused warning

	a.logToConsole(fmt.Sprintf("[OK] TELA server started at: %s (proxied)", proxyURL))

	return map[string]interface{}{
		"success": true,
		"name":    name,
		"scid":    scid,
		"url":     proxyURL, // Return proxy URL
		"message": "TELA server started with CSP header removal",
	}
}

// ClearAppCache purges cached state for a single TELA app at varying
// depths. Designed as the backend for the browser tab's reload dropdown:
//
//   mode = "normal"  : no-op; caller should just navigate again
//   mode = "hard"    : drop Graviton HTML + dURL mapping so next load
//                       refetches from the daemon, but keep the on-disk
//                       clone under datashards/tela/<durl>.tela/
//   mode = "empty"   : everything in "hard" + remove the on-disk clone +
//                       shut down the running TELA proxy server for this
//                       SCID. When clearOffline is true, also remove the
//                       offline prefetch entry.
//
// The scid is always required; durl is optional but recommended because
// some cache keys are indexed by normalized dURL.
//
// Safety: on-disk removal only targets paths that sit directly under
// datashards/tela/, matching the invariant enforced by
// cleanupTelaCloneFromError.
func (a *App) ClearAppCache(scid, durl, mode string, clearOffline bool) map[string]interface{} {
	result := map[string]interface{}{
		"success": true,
		"mode":    mode,
		"scid":    scid,
		"durl":    durl,
		"cleared": []string{},
	}
	cleared := []string{}

	if scid == "" && durl == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "ClearAppCache requires scid or durl",
		}
	}

	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "normal":
		// Nothing to clear for a normal reload; caller re-navigates.
		return result

	case "hard", "empty":
		// Drop Graviton HTML + dURL mapping entries so the next serve
		// is forced to re-fetch from the daemon.
		if gc, ok := a.cache.(*GravitonCache); ok && gc != nil {
			if scid != "" {
				if err := gc.InvalidateSCID(scid); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Invalidate SCID cache failed: %v", err))
				} else {
					cleared = append(cleared, "tela_cache:scid")
				}
			}
			if durl != "" {
				if err := gc.InvalidateDURL(durl); err != nil {
					a.logToConsole(fmt.Sprintf("[WARN] Invalidate dURL cache failed: %v", err))
				} else {
					cleared = append(cleared, "tela_cache:durl", "nrs_cache")
				}
			}
		}

		if mode == "empty" || mode == "EMPTY" {
			// Shut down the running TELA proxy server for this SCID so
			// the clone folder is released before we try to remove it.
			if scid != "" {
				serverRegistry.RLock()
				var serverName string
				for name, server := range serverRegistry.servers {
					if server.SCID == scid {
						serverName = name
						break
					}
				}
				serverRegistry.RUnlock()
				if serverName != "" {
					shutdownProxyServer(scid)
					tela.ShutdownServer(serverName)
					serverRegistry.Lock()
					delete(serverRegistry.servers, serverName)
					serverRegistry.Unlock()
					cleared = append(cleared, "tela_server")
				}
			}

			// Remove the on-disk clone under datashards/tela/<durl>.tela/
			// Only act if we can resolve a real dURL so we don't wipe the
			// wrong folder.
			if durl != "" {
				cloneDir := filepath.Join(getDatashardsDir(), "tela", durl)
				telaRootSuffix := string(filepath.Separator) + "datashards" + string(filepath.Separator) + "tela" + string(filepath.Separator)
				if strings.Contains(cloneDir, telaRootSuffix) {
					if _, err := os.Stat(cloneDir); err == nil {
						if rmErr := os.RemoveAll(cloneDir); rmErr != nil {
							a.logToConsole(fmt.Sprintf("[WARN] Remove clone dir failed: %v", rmErr))
						} else {
							a.logToConsole(fmt.Sprintf("[OK] Removed TELA clone: %s", cloneDir))
							cleared = append(cleared, "clone_dir")
						}
					}
				}
			}

			if clearOffline && a.offlineCache != nil && scid != "" {
				if err := a.offlineCache.RemoveCachedApp(scid); err == nil {
					cleared = append(cleared, "offline_cache")
				}
			}
		}

	default:
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("unknown mode %q (expected normal, hard, or empty)", mode),
		}
	}

	result["cleared"] = cleared
	return result
}

func cleanupTelaCloneFromError(err error, logFn func(string)) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if !strings.Contains(msg, "already exists") {
		return false
	}

	const filePrefix = "file "
	idx := strings.Index(msg, filePrefix)
	if idx < 0 {
		return false
	}
	rest := msg[idx+len(filePrefix):]
	end := strings.Index(rest, " already exists")
	if end < 0 {
		return false
	}
	filePath := strings.TrimSpace(rest[:end])
	if filePath == "" {
		return false
	}

	// Walk up from the offending file to find the clone root, which is the
	// directory whose parent is ".../datashards/tela". This ensures we remove
	// the entire <durl>.tela folder (including sibling files like upload.html)
	// instead of only the immediate subdirectory of the offending file.
	telaRootSuffix := string(filepath.Separator) + "datashards" + string(filepath.Separator) + "tela"
	cloneRoot := filepath.Dir(filePath)
	for {
		parent := filepath.Dir(cloneRoot)
		if parent == cloneRoot {
			// Reached filesystem root without finding datashards/tela — bail out safely.
			return false
		}
		if strings.HasSuffix(parent, telaRootSuffix) {
			// cloneRoot is now the <durl>.tela folder directly under datashards/tela/
			break
		}
		cloneRoot = parent
	}

	// Safety check: only remove paths that live under datashards/tela/
	if !strings.Contains(cloneRoot, telaRootSuffix+string(filepath.Separator)) {
		return false
	}

	if rmErr := os.RemoveAll(cloneRoot); rmErr != nil {
		if logFn != nil {
			logFn(fmt.Sprintf("[WARN] Failed to remove stale TELA clone: %v", rmErr))
		}
		return false
	}

	if logFn != nil {
		logFn(fmt.Sprintf("[OK] Removed stale TELA clone: %s", cloneRoot))
	}
	return true
}

// GetServerPortRange returns the current port range for TELA servers
func (a *App) GetServerPortRange() map[string]interface{} {
	startPort := tela.PortStart()
	maxServers := tela.MaxServers()

	return map[string]interface{}{
		"success":    true,
		"startPort":  startPort,
		"maxServers": maxServers,
		"endPort":    startPort + maxServers - 1,
	}
}

// SetServerPortStart sets the starting port for TELA servers
func (a *App) SetServerPortStart(port int) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Server] Setting port start: %d", port))

	if port < 1024 || port > 65535 {
		return map[string]interface{}{
			"success": false,
			"error":   "Port must be between 1024 and 65535",
		}
	}

	tela.SetPortStart(port)

	return map[string]interface{}{
		"success": true,
		"port":    port,
		"message": "Port start updated",
	}
}

// SetMaxServers sets the maximum number of active TELA servers
func (a *App) SetMaxServers(max int) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[Server] Setting max servers: %d", max))

	if max < 1 || max > 100 {
		return map[string]interface{}{
			"success": false,
			"error":   "Max servers must be between 1 and 100",
		}
	}

	tela.SetMaxServers(max)

	return map[string]interface{}{
		"success": true,
		"max":     max,
		"message": "Max servers updated",
	}
}

// GetServerInfo returns detailed info about a specific server
func (a *App) GetServerInfo(name string) map[string]interface{} {
	serverRegistry.RLock()
	server, exists := serverRegistry.servers[name]
	serverRegistry.RUnlock()

	if !exists {
		return map[string]interface{}{
			"success": false,
			"error":   "Server not found",
		}
	}

	return map[string]interface{}{
		"success":   true,
		"name":      server.Name,
		"scid":      server.SCID,
		"port":      server.Port,
		"url":       server.URL,
		"isLocal":   server.IsLocal,
		"directory": server.Directory,
	}
}

