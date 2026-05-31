package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// LocalDevServer manages local TELA development preview
type LocalDevServer struct {
	app       *App
	server    *http.Server
	watcher   *fsnotify.Watcher
	directory string
	port      int
	url       string
	mu        sync.Mutex
	running   bool
}

// localDevServer singleton
var localDevServer *LocalDevServer
var localDevServerMu sync.Mutex

// getLocalDevServer returns the singleton instance
func getLocalDevServer(app *App) *LocalDevServer {
	localDevServerMu.Lock()
	defer localDevServerMu.Unlock()

	if localDevServer == nil {
		localDevServer = &LocalDevServer{app: app}
	}
	return localDevServer
}

// StartLocalDevServer starts serving files from a local directory
func (a *App) StartLocalDevServer(directory string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[START] Starting local dev server for: %s", directory))

	// Validate directory exists
	info, err := os.Stat(directory)
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Directory not found: %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Directory not found: %v", err),
		}
	}
	if !info.IsDir() {
		a.logToConsole("[ERR] Path is not a directory")
		return map[string]interface{}{
			"success": false,
			"error":   "Path is not a directory",
		}
	}

	// Check for index.html
	indexPath := filepath.Join(directory, "index.html")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		a.logToConsole("[ERR] No index.html found in directory")
		return map[string]interface{}{
			"success": false,
			"error":   "No index.html found in directory. TELA apps must have an index.html file.",
		}
	}

	lds := getLocalDevServer(a)
	lds.mu.Lock()
	defer lds.mu.Unlock()

	// Stop existing server if running
	if lds.running {
		a.logToConsole("[SYNC] Stopping existing local dev server...")
		lds.stopInternal()
	}

	// Find available port
	port, err := findAvailablePort()
	if err != nil {
		a.logToConsole(fmt.Sprintf("[ERR] Could not find available port: %v", err))
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Could not find available port: %v", err),
		}
	}

	// Create file server with CORS headers and XSWD bridge injection
	fs := http.FileServer(http.Dir(directory))
	handler := localDevCORSMiddleware(fs, directory)

	// Create server
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	lds.server = &http.Server{
		Addr:    addr,
		Handler: handler,
	}
	lds.directory = directory
	lds.port = port
	lds.url = fmt.Sprintf("http://%s", addr)
	lds.app = a

	// Start server in goroutine
	go func() {
		a.logToConsole(fmt.Sprintf("[NET] Local dev server listening on %s", lds.url))
		if err := lds.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			a.logToConsole(fmt.Sprintf("[ERR] Local dev server error: %v", err))
		}
	}()

	// Give server a moment to start
	time.Sleep(100 * time.Millisecond)

	lds.running = true

	// Start file watcher in background (non-blocking)
	go func() {
		if err := lds.startWatcher(); err != nil {
			a.logToConsole(fmt.Sprintf("[WARN] File watcher failed to start: %v (hot reload disabled)", err))
		}
	}()

	// Register in server registry
	serverRegistry.Lock()
	serverRegistry.servers["local-dev"] = &ActiveServer{
		Name:      "local-dev",
		Port:      port,
		URL:       lds.url,
		IsLocal:   true,
		Directory: directory,
	}
	serverRegistry.Unlock()

	a.logToConsole(fmt.Sprintf("[OK] Local dev server started at %s", lds.url))

	return map[string]interface{}{
		"success":   true,
		"url":       lds.url,
		"port":      port,
		"directory": directory,
		"message":   "Local dev server started",
	}
}

// StopLocalDevServer stops the local dev server
func (a *App) StopLocalDevServer() map[string]interface{} {
	lds := getLocalDevServer(a)
	lds.mu.Lock()
	defer lds.mu.Unlock()

	if !lds.running {
		return map[string]interface{}{
			"success": true,
			"message": "Server was not running",
		}
	}

	lds.stopInternal()
	a.logToConsole("[OK] Local dev server stopped")

	return map[string]interface{}{
		"success": true,
		"message": "Local dev server stopped",
	}
}

// stopInternal stops the server without locking (caller must hold lock)
func (lds *LocalDevServer) stopInternal() {
	// Stop file watcher
	if lds.watcher != nil {
		lds.watcher.Close()
		lds.watcher = nil
	}

	// Shutdown HTTP server
	if lds.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		lds.server.Shutdown(ctx)
		lds.server = nil
	}

	// Remove from registry
	serverRegistry.Lock()
	delete(serverRegistry.servers, "local-dev")
	serverRegistry.Unlock()

	lds.running = false
	lds.url = ""
	lds.port = 0
	lds.directory = ""
}

// GetLocalDevServerStatus returns the current status of the local dev server
func (a *App) GetLocalDevServerStatus() map[string]interface{} {
	lds := getLocalDevServer(a)
	lds.mu.Lock()
	defer lds.mu.Unlock()

	watcherActive := lds.watcher != nil

	return map[string]interface{}{
		"running":       lds.running,
		"url":           lds.url,
		"port":          lds.port,
		"directory":     lds.directory,
		"watcherActive": watcherActive,
	}
}

// RefreshLocalDevServer triggers a manual refresh event for the local dev server
func (a *App) RefreshLocalDevServer() map[string]interface{} {
	lds := getLocalDevServer(a)
	lds.mu.Lock()
	defer lds.mu.Unlock()

	if !lds.running {
		return map[string]interface{}{
			"success": false,
			"error":   "Local dev server is not running",
		}
	}

	// Emit reload event
	runtime.EventsEmit(a.ctx, "localdev:reload", map[string]interface{}{
		"file":      "manual",
		"timestamp": time.Now().Unix(),
	})

	a.logToConsole("[SYNC] Manual refresh triggered")

	return map[string]interface{}{
		"success": true,
		"message": "Refresh triggered",
	}
}

// ================== Helper Functions ==================

// findAvailablePort finds an available port starting from 50080
// Note: Avoids ports 8080-9000 which conflict with DERO services:
//   - 8080: Block explorer (derod)
//   - 10102/20000/40402: RPC ports (mainnet/simulator/testnet)
func findAvailablePort() (int, error) {
	// Try ports in the 50080-51000 range (avoids DERO reserved ports)
	for port := 50080; port < 51000; port++ {
		addr := fmt.Sprintf("127.0.0.1:%d", port)
		listener, err := net.Listen("tcp", addr)
		if err == nil {
			listener.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available ports in range 50080-51000")
}

// localDevCORSMiddleware adds CORS headers and proper MIME types for local development
func localDevCORSMiddleware(next http.Handler, directory string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers for development
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Ensure proper MIME types for common web files
		ext := filepath.Ext(r.URL.Path)
		urlPath := r.URL.Path
		
		// Handle root path or paths ending with / as index.html requests
		if urlPath == "" || urlPath == "/" || strings.HasSuffix(urlPath, "/") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			serveHTMLWithBridge(w, r, directory)
			return
		}
		
		switch ext {
		case ".css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case ".js", ".mjs":
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		case ".json":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		case ".svg":
			w.Header().Set("Content-Type", "image/svg+xml")
		case ".html", ".htm":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			// For HTML files, inject the XSWD bridge script
			serveHTMLWithBridge(w, r, directory)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// serveHTMLWithBridge reads an HTML file and injects the XSWD bridge script at the beginning
func serveHTMLWithBridge(w http.ResponseWriter, r *http.Request, directory string) {
	// Determine file path
	urlPath := r.URL.Path
	if urlPath == "" || urlPath == "/" {
		urlPath = "/index.html"
	}
	
	filePath := filepath.Join(directory, urlPath)
	
	// Read the HTML file
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	
	// Inject bridge scripts at the very beginning (XSWD + clipboard fallback for Browser iframe)
	bridgeScript := getLocalDevXSWDBridgeScript()
	clipboardScript := getHologramClipboardBridgeScript()
	injectedContent := bridgeScript + clipboardScript + string(content)
	
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(injectedContent)))
	w.Write([]byte(injectedContent))
}

// getLocalDevXSWDBridgeScript returns the XSWD bridge script that intercepts WebSocket connections
func getLocalDevXSWDBridgeScript() string {
	return `<script>
(function() {
  'use strict';
  
  // Simple log to parent
  function log(msg) {
    try { window.parent.postMessage({ type: 'xswd-request', id: 0, action: 'log', payload: msg }, '*'); } catch(e) {}
  }
  
  log('[Bridge] Initializing...');
  
  // Store original WebSocket
  var OriginalWebSocket = window.WebSocket;
  
  // Request ID for parent communication
  var reqId = 0;
  var pending = {};
  var proxies = [];
  
  // Listen for parent responses
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'xswd-response' && pending[e.data.id]) {
      var p = pending[e.data.id];
      delete pending[e.data.id];
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    }
  });
  
  // Listen for subscription events from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'xswd-event' && proxies.length) {
      proxies.forEach(function(p) {
        if (p && typeof p._notify === 'function') {
          p._notify(e.data.method, e.data.params);
        }
      });
    }
  });
  
  // Send to parent and wait
  function request(action, payload) {
    return new Promise(function(resolve, reject) {
      var id = ++reqId;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ type: 'xswd-request', id: id, action: action, payload: payload }, '*');
      setTimeout(function() { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, 60000);
    });
  }
  
  // XSWD WebSocket Proxy
  function XSWDProxy(url) {
    var self = this;
    self.url = url;
    self.readyState = 0;
    self.onopen = null;
    self.onmessage = null;
    self.onerror = null;
    self.onclose = null;
    self._auth = 'pending';
    self._queue = [];
    proxies.push(self);
    
    log('[XSWD] Connection intercepted: ' + url);
    
    // Simulate connection open
    setTimeout(function() {
      self.readyState = 1;
      log('[XSWD] WebSocket opened');
      if (self.onopen) self.onopen({ type: 'open', target: self });
      while (self._queue.length) self._handle(self._queue.shift());
    }, 5);
  }
  
  XSWDProxy.prototype.send = function(data) {
    if (this.readyState === 0) { this._queue.push(data); return; }
    if (this.readyState !== 1) throw new Error('WebSocket closed');
    this._handle(data);
  };
  
  XSWDProxy.prototype._handle = function(data) {
    var self = this;
    try {
      var msg = typeof data === 'string' ? JSON.parse(data) : data;
      log('[XSWD] ' + (msg.method || 'handshake'));
      
      // Handshake (has name/description, no method)
      if (!msg.method && (msg.name || msg.description)) {
        request('connect', { appInfo: msg }).then(function(ok) {
          self._auth = ok ? 'ok' : 'denied';
          log(ok ? '[OK] Connection approved' : '[Denied] Connection denied');
          self._respond({ accepted: !!ok });
        }).catch(function(e) {
          self._auth = 'denied';
          self._respond({ accepted: false, message: e.message });
        });
        return;
      }
      
      // RPC call
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
  // commonly mix the two styles.
  XSWDProxy.prototype._dispatchMessage = function(payload) {
    var self = this;
    var ev = { type: 'message', data: JSON.stringify(payload), target: self };
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

  XSWDProxy.prototype._respond = function(r) {
    this._dispatchMessage(r);
  };

  XSWDProxy.prototype._notify = function(method, params) {
    this._dispatchMessage({ jsonrpc: '2.0', method: method, params: params });
  };

  XSWDProxy.prototype.addEventListener = function(event, handler) {
    var self = this;
    if (event === 'message') {
      if (!self._messageHandlers) self._messageHandlers = [];
      self._messageHandlers.push(handler);
    } else if (event === 'open') {
      if (self.readyState === 1) {
        setTimeout(function() {
          try { handler({ type: 'open', target: self }); } catch(e) { log('[Error] open listener: ' + e.message); }
        }, 0);
      } else {
        if (!self._openHandlers) self._openHandlers = [];
        self._openHandlers.push(handler);
        var prevOnopen = self.onopen;
        self.onopen = function(e) {
          if (prevOnopen) { try { prevOnopen(e); } catch(err) { log('[Error] onopen: ' + err.message); } }
          (self._openHandlers || []).forEach(function(h) {
            try { h(e); } catch(err) { log('[Error] open listener: ' + err.message); }
          });
        };
      }
    } else if (event === 'close') {
      if (!self._closeHandlers) self._closeHandlers = [];
      self._closeHandlers.push(handler);
    } else if (event === 'error') {
      if (!self._errorHandlers) self._errorHandlers = [];
      self._errorHandlers.push(handler);
    }
  };

  XSWDProxy.prototype.removeEventListener = function(event, handler) {
    var bucket = event === 'message' ? this._messageHandlers
               : event === 'open'    ? this._openHandlers
               : event === 'close'   ? this._closeHandlers
               : event === 'error'   ? this._errorHandlers
               : null;
    if (bucket) {
      var idx = bucket.indexOf(handler);
      if (idx >= 0) bucket.splice(idx, 1);
    }
  };
  
  XSWDProxy.prototype.close = function() {
    var self = this;
    self.readyState = 3;
    var idx = proxies.indexOf(self);
    if (idx > -1) proxies.splice(idx, 1);
    var ev = { type: 'close', code: 1000 };
    if (self.onclose) { try { self.onclose(ev); } catch(e) { log('[Error] onclose: ' + e.message); } }
    if (self._closeHandlers) {
      self._closeHandlers.forEach(function(h) {
        try { h(ev); } catch(e) { log('[Error] close listener: ' + e.message); }
      });
    }
  };
  
  XSWDProxy.CONNECTING = 0;
  XSWDProxy.OPEN = 1;
  XSWDProxy.CLOSING = 2;
  XSWDProxy.CLOSED = 3;
  
  // Override WebSocket
  window.WebSocket = function(url, protocols) {
    // XSWD port: 44326 (mainnet)
    if (url && (url.indexOf('44326') !== -1 || url.indexOf('44325') !== -1 || url.indexOf('xswd') !== -1)) {
      return new XSWDProxy(url);
    }
    return protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
  };
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  
  log('[Bridge] Ready - WebSocket interception active');

  // ── Blob download interceptor ─────────────────────────────────────────────
  // Apps (e.g. Villager) call URL.revokeObjectURL() synchronously immediately
  // after a.click(), so we must cache the Blob at createObjectURL() time rather
  // than fetching it asynchronously later.
  (function() {
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

    var _origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.hasAttribute('download') && this.href && this.href.indexOf('blob:') === 0) {
        var href = this.href;
        var filename = this.download || 'download';
        var cached = _blobCache[href];
        log('[Download] Intercepting: ' + filename);
        _saveBlobDownload(href, filename, cached);
        return;
      }
      return _origAnchorClick.call(this);
    };

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
})();
</script>`
}

// ================== File Watcher (Hot Reload) ==================

// startWatcher initializes the file watcher for hot reload
func (lds *LocalDevServer) startWatcher() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create watcher: %w", err)
	}

	lds.watcher = watcher

	// Watch the directory recursively
	watchCount := 0
	err = filepath.Walk(lds.directory, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors, continue walking
		}
		if info.IsDir() {
			// Skip hidden directories
			name := info.Name()
			if len(name) > 0 && name[0] == '.' {
				return filepath.SkipDir
			}
			// Skip common non-source directories
			if name == "node_modules" || name == "vendor" || name == "__pycache__" {
				return filepath.SkipDir
			}
			if err := watcher.Add(path); err == nil {
				watchCount++
			}
		}
		return nil
	})
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to setup watcher: %w", err)
	}

	// Start watching goroutine
	go lds.watchLoop()

	lds.app.logToConsole(fmt.Sprintf("[Dev] File watcher active - watching %d directories", watchCount))
	return nil
}

// watchLoop handles file system events
func (lds *LocalDevServer) watchLoop() {
	// Debounce timer to prevent rapid-fire events
	var debounceTimer *time.Timer
	debounceDelay := 300 * time.Millisecond

	for {
		select {
		case event, ok := <-lds.watcher.Events:
			if !ok {
				return // Watcher closed
			}

			// Only trigger on write/create events
			if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
				// Check if it's a relevant file type
				ext := filepath.Ext(event.Name)
				if isWatchedExtension(ext) {
					// Debounce: reset timer on each event
					if debounceTimer != nil {
						debounceTimer.Stop()
					}

					// Capture file name for closure
					fileName := event.Name

					debounceTimer = time.AfterFunc(debounceDelay, func() {
						lds.mu.Lock()
						running := lds.running
						app := lds.app
						lds.mu.Unlock()

						if running && app != nil && app.ctx != nil {
							baseName := filepath.Base(fileName)
							app.logToConsole(fmt.Sprintf("[SYNC] File changed: %s", baseName))

							// Emit reload event to frontend
							runtime.EventsEmit(app.ctx, "localdev:reload", map[string]interface{}{
								"file":      baseName,
								"fullPath":  fileName,
								"timestamp": time.Now().Unix(),
							})
						}
					})
				}
			}

		case err, ok := <-lds.watcher.Errors:
			if !ok {
				return // Watcher closed
			}
			if lds.app != nil {
				lds.app.logToConsole(fmt.Sprintf("[WARN] File watcher error: %v", err))
			}
		}
	}
}

// isWatchedExtension checks if a file extension should trigger reload
func isWatchedExtension(ext string) bool {
	watched := map[string]bool{
		".html": true,
		".htm":  true,
		".css":  true,
		".js":   true,
		".mjs":  true,
		".json": true,
		".svg":  true,
		".png":  true,
		".jpg":  true,
		".jpeg": true,
		".gif":  true,
		".webp": true,
		".ico":  true,
		".woff": true,
		".woff2": true,
		".ttf":  true,
	}
	return watched[ext]
}
