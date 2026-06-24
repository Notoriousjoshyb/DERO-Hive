package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var nativeStdout *os.File
var nodeDisconnected bool

// readMsg reads a length-prefixed JSON message from stdin.
// The Chrome Native Messaging protocol sends a 4-byte little-endian
// length header followed by that many bytes of JSON.
func readMsg() ([]byte, error) {
	h := make([]byte, 4)
	if _, err := io.ReadFull(os.Stdin, h); err != nil {
		return nil, err
	}
	l := binary.LittleEndian.Uint32(h)
	msg := make([]byte, l)
	_, err := io.ReadFull(os.Stdin, msg)
	return msg, err
}

// sendMsg encodes v as JSON and writes it to the native messaging stdout
// with the required 4-byte little-endian length prefix.
func sendMsg(v any) {
	b, _ := json.Marshal(v)
	h := make([]byte, 4)
	binary.LittleEndian.PutUint32(h, uint32(len(b)))
	nativeStdout.Write(h)
	nativeStdout.Write(b)
}

func sendInitSCIDs() {
	mu.RLock()
	scids := make([]string, 0, len(proxies))
	for scid := range proxies {
		scids = append(scids, scid)
	}
	mu.RUnlock()

	sendMsg(map[string]any{
		"ok":     true,
		"id":     "init_scids",
		"result": map[string]any{"scids": scids},
	})
}

// nativeLoop is the main command dispatcher. It reads messages from stdin
// in a tight loop and dispatches to the appropriate handler.
// Returns only when stdin is closed (extension unloaded / browser exit).
func nativeLoop() {
	for {
		raw, err := readMsg()
		if err != nil {
			return
		}

		var msg map[string]any
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}

		cmd, _ := msg["cmd"].(string)
		id := msg["id"]

		switch cmd {

		case "set_node":
			node := strings.TrimSpace(msg["params"].(map[string]any)["node"].(string))
			if !strings.HasPrefix(node, "http://") {
				node = "http://" + node
			}

			if node == currentNode {
				sendMsg(map[string]any{"ok": true, "id": id})
				sendInitSCIDs()
				break
			}

			// Cancel previous sync attempt if any
			if syncCancel != nil {
				close(syncCancel)
				syncCancel = nil
			}

			currentNode = node
			nodeDisconnected = true
			startTELA()
			time.Sleep(100 * time.Millisecond)
			go startSync(node)

			sendMsg(map[string]any{"ok": true, "id": id})
			sendInitSCIDs()

		case "disconnect_node":
			nodeDisconnected = true
			stopSync()
			resetProxies()
			currentNode = ""
			sendMsg(map[string]any{"ok": true, "id": id})
				
		case "load_scid":
			if currentNode == "" {
				sendMsg(map[string]any{"ok": false, "id": id, "error": "node not set"})
				break
			}

			scid, _ := msg["params"].(map[string]any)["scid"].(string)
			addURL := fmt.Sprintf("http://127.0.0.1:%d/add/%s", *telaPort, scid)

			resp, err := http.Get(addURL)
			if err != nil {
				sendMsg(map[string]any{"ok": false, "id": id, "error": err.Error()})
				break
			}
			defer resp.Body.Close()

			var res map[string]any
			json.NewDecoder(resp.Body).Decode(&res)

			result, _ := res["result"].(map[string]any)

			// Non-blocking: run indexer operation in background so the native
			// message loop never stalls (multiple load_scid calls in sequence
			// or AddSCIDToIndex lock contention would otherwise queue up).
			if indexerRunning {
				go indexSCIDNow(scid)
			} else {
				log.Printf("load_scid: indexer not ready yet, skipping SCID indexing for %s", scid)
			}

			sendMsg(map[string]any{
				"ok": true,
				"id": id,
				"result": map[string]any{
					"url": result["url"],
				},
			})

		case "server_status":
			// Check TELA proxy
			telaOk := false
			if resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", *telaPort)); err == nil {
				resp.Body.Close()
				telaOk = true
			}
			if nodeDisconnected {
				telaOk = false
			}

			// Check Gnomon API
			gnomonOk := false
			if resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/getinfo", *gnomonPort)); err == nil {
				resp.Body.Close()
				gnomonOk = true
			}
			// Override: API may be up but indexer not connected to any node
			if !indexerRunning || nodeDisconnected {
				gnomonOk = false
			}

			dbHeight := int64(0)
			if myIndexer != nil {
				dbHeight = myIndexer.LastIndexedHeight
			} else {
				dbHeight, _ = boltDB.GetLastIndexHeight()
			}
			scidCount := 0
			var daemonInfo *DaemonInfo
			if currentNode != "" {
				daemonInfo = getDaemonInfo(currentNode)
			}
			if myIndexer != nil {
				myIndexer.Lock()
				scidCount = len(myIndexer.ValidatedSCs)
				myIndexer.Unlock()
			}

			state := loadScannerState()

			chainHeight := int64(0)
			stableHeight := int64(0)
			difficulty := int64(0)
			daemonVersion := ""
			daemonNetwork := ""
			mempoolSize := 0
			if daemonInfo != nil {
				chainHeight = daemonInfo.TopoHeight
				stableHeight = daemonInfo.StableHeight
				difficulty = daemonInfo.Difficulty
				daemonVersion = daemonInfo.Version
				daemonNetwork = daemonInfo.Network
				mempoolSize = daemonInfo.MempoolSize
			}

			sendMsg(map[string]any{
				"ok": true,
				"id": id,
				"result": map[string]any{
					"tela":               telaOk,
					"gnomon":             gnomonOk,
					"connected":          telaOk && gnomonOk,
					"node":               currentNode,
					"scid_count":         scidCount,
					"scanner_live":       state.LastLiveHeight,
					"scanner_historical": state.LastHistoricalHeight,
					"daemon": map[string]any{
						"version":      daemonVersion,
						"network":      daemonNetwork,
						"mempool_size": mempoolSize,
					},
					"heights": map[string]any{
						"indexed":    dbHeight,
						"chain":      chainHeight,
						"stable":     stableHeight,
						"difficulty": difficulty,
					},
				},
			})

		case "get_config":
			sendMsg(map[string]any{
				"ok": true,
				"id": id,
				"result": map[string]any{
					"gnomon_api_port": *gnomonPort,
					"tela_port":       *telaPort,
				},
			})

		case "discover_tela":
			if currentNode == "" {
				sendMsg(map[string]any{"ok": false, "id": id, "error": "node not set"})
				break
			}
			apps := discoverTelaApps(currentNode)
			sendMsg(map[string]any{"ok": true, "id": id, "result": map[string]any{"apps": apps}})

		case "get_scid_vars":
			if currentNode == "" {
				sendMsg(map[string]any{"ok": false, "id": id, "error": "node not set"})
				break
			}
			params, _ := msg["params"].(map[string]any)
			rawSCIDs, _ := params["scids"].([]any)
			scids := make([]string, 0, len(rawSCIDs))
			for _, s := range rawSCIDs {
				if str, ok := s.(string); ok && len(str) == 64 {
					scids = append(scids, str)
				}
			}
			if len(scids) == 0 {
				sendMsg(map[string]any{"ok": false, "id": id, "error": "no valid SCIDs"})
				break
			}
			results := fetchSCIDVariables(currentNode, scids)
			sendMsg(map[string]any{"ok": true, "id": id, "result": map[string]any{"vars": results}})

		case "shutdown":
			log.Printf("Shutdown requested")
			closeStorage()
			ShutdownTELA()
			sendMsg(map[string]any{"ok": true, "id": id})
			os.Exit(0)

		case "list_scids":
			// Return all currently proxied SCIDs
			mu.RLock()
			loadedSCIDs := make([]string, 0, len(proxies))
			for scid := range proxies {
				loadedSCIDs = append(loadedSCIDs, scid)
			}
			mu.RUnlock()

			sendMsg(map[string]any{
				"ok":     true,
				"id":     id,
				"result": map[string]any{"scids": loadedSCIDs},
			})

		default:
			log.Printf("Unknown command: %s", cmd)
			sendMsg(map[string]any{"ok": false, "id": id, "error": "unknown command"})
		}
	}
}