package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"

	hgapi "github.com/hypergnomon/hypergnomon/api"
	hgindexer "github.com/hypergnomon/hypergnomon/indexer"
	hgstructures "github.com/hypergnomon/hypergnomon/structures"
)

var (
	myAPIServer *hgapi.Server
	myIndexer   *hgindexer.Indexer
)

var (
	hgDBDir string // set once in initStorage
)

var syncCancel chan struct{}

var tipSyncedSent bool // only send tip_synced once to avoid 2s re-render loop

type TelaAppInfo struct {
	SCID          string `json:"scid"`
	DURL          string `json:"durl"`
	Name          string `json:"name"`
	DescrHdr      string `json:"descrHdr"`
	IconURL       string `json:"iconURL"`
	InstallHeight int64  `json:"install_height"`
	FromAPI       bool   `json:"from_api"`
}

// discoverTelaApps returns all known TELA apps from HyperGnomon's class
// bucket.  Metadata (name, durl, description, icon) is read directly from
// the Store's ClassMeta — written by IndexSingleSCID (preload) and
// probeTELA (FastSync).  Bundled SCIDs missing from the class bucket are
// returned as fallbacks so the UI always has something to show.
func discoverTelaApps(node string) []TelaAppInfo {
	if myIndexer == nil {
		out := make([]TelaAppInfo, len(bundledTelaSCIDs))
		for i, scid := range bundledTelaSCIDs {
			out[i] = TelaAppInfo{SCID: scid, DURL: scid, Name: scid, FromAPI: false}
		}
		return out
	}

	seen := make(map[string]bool, len(bundledTelaSCIDs))
	var apps []TelaAppInfo

	for _, class := range []string{"TELA-INDEX-1"} {
		installs, err := myIndexer.Store.GetClassInstalls(class, 0)
		if err != nil {
			log.Printf("discoverTelaApps: GetClassInstalls(%s): %v", class, err)
			continue
		}
		for _, inst := range installs {
			seen[inst.SCID] = true
			durl := inst.SCID
			name := inst.SCID
			desc := ""
			icon := ""
			installH := inst.InstallHeight
			if meta := inst.Meta; meta != nil {
				if meta.DURL != "" {
					durl = meta.DURL
				}
				if meta.Name != "" {
					name = meta.Name
				}
				desc = meta.Desc
				icon = meta.IconURL
			}
			apps = append(apps, TelaAppInfo{
				SCID: inst.SCID, DURL: durl, Name: name,
				DescrHdr: desc, IconURL: icon,
				InstallHeight: installH, FromAPI: true,
			})
		}
	}
	classBucketCount := len(apps)

	for _, scid := range bundledTelaSCIDs {
		if !seen[scid] {
			seen[scid] = true
			apps = append(apps, TelaAppInfo{SCID: scid, DURL: scid, Name: scid, InstallHeight: 0, FromAPI: false})
		}
	}

	log.Printf("discoverTelaApps: %d apps (%d from class bucket)", len(apps), classBucketCount)
	return apps
}

func watchDaemonHealth(node string, cancel chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	var lastKnownStatus bool = true

	for {
		select {
		case <-cancel:
			return
		case <-ticker.C:
			h := getChainTopoHeight(node)
			currentStatus := h > 0

			if currentStatus != lastKnownStatus {
				lastKnownStatus = currentStatus
				if !currentStatus {
					log.Printf("HealthWatch: daemon unreachable at %s", node)
					sendMsg(map[string]any{
						"event": "node_unreachable",
						"node":  node,
					})
				} else {
					log.Printf("HealthWatch: daemon recovered at %s", node)
					sendMsg(map[string]any{
						"event": "node_recovered",
						"node":  node,
					})
				}
			}
		}
	}
}

func initStorage() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not find home dir: %w", err)
	}
	hgDBDir = filepath.Join(home, ".purewolf", "gnomondb")
	if err := os.MkdirAll(hgDBDir, 0755); err != nil {
		return fmt.Errorf("mkdir db dir: %w", err)
	}
	log.Printf("Storage ready: %s (HyperGnomon opens its own store)", hgDBDir)
	return nil
}

func startSync(node string) {
	if !strings.HasPrefix(node, "http://") {
		node = "http://" + node
	}

	nodeForIndexer := strings.TrimPrefix(node, "http://")
	nodeForIndexer = strings.TrimPrefix(nodeForIndexer, "https://")

	if syncCancel != nil {
		close(syncCancel)
		time.Sleep(500 * time.Millisecond)
	}
	syncCancel = make(chan struct{})
	cancel := syncCancel

	go watchDaemonHealth(node, cancel)

	targetHeight := int64(0)
	retries := 0
	for targetHeight == 0 {
		select {
		case <-cancel:
			return
		default:
		}
		targetHeight = getChainTopoHeight(node)
		if targetHeight == 0 {
			retries++
			log.Printf("Sync: waiting for daemon at %s (attempt %d)...", node, retries)
			if retries == 2 {
				sendMsg(map[string]any{
					"event": "node_unreachable",
					"node":  node,
				})
			}
			select {
			case <-cancel:
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
	log.Printf("Sync: target locked at height %d", targetHeight)
	nodeDisconnected = false

	// Build HyperGnomon config (performance-tuned: RecentBlocks skips old history)
	home, _ := os.UserHomeDir()
	cfg := hgindexer.Config{
		Endpoint:       nodeForIndexer,
		DBDir:          filepath.Join(home, ".purewolf", "gnomondb"),
		SearchFilter:   nil,
		ParallelBlocks: 32,
		BatchSize:         1000,
		PoolSize:           16,
		TurboMode:          true,
		PostScanVarsMode:   "lazy",
		AdaptBatchSize:     true,
		RecentBlocks:       500,
		CodePolicy:       "none",
		FinalityDepth:    3,
	}
	log.Printf("HyperGnomon config: DBDir=%s Endpoint=%s", cfg.DBDir, cfg.Endpoint)

	activeIndexer, err := hgindexer.New(cfg)
	if err != nil {
		log.Printf("HyperGnomon indexer: %v", err)
		return
	}
	myIndexer = activeIndexer

	// Suppress HyperGnomon's chatty scan-loop logs so PureWolf's own
	// log lines stay readable during fastsync.
	hgstructures.Logger.SetLevel(logrus.WarnLevel)

	// Preload → FastSync → Scanner, sequential to avoid pool contention.
	// FastSync discovers ALL TELA apps from the GnomonSC registry via batch
	// RPC, so the scanner only needs to process new blocks after it.
	go func() {
		// Phase 1: Preload bundled SCIDs (instant, ~5s)
		{
			sem := make(chan struct{}, 8)
			var wg sync.WaitGroup
			for _, scid := range bundledTelaSCIDs {
				wg.Add(1)
				sem <- struct{}{}
				go func(s string) {
					defer wg.Done()
					defer func() { <-sem }()
					if _, err := activeIndexer.IndexSingleSCID(s, false, false); err != nil {
						log.Printf("Preload SCID %s: %v", s, err)
					}
				}(scid)
			}
			wg.Wait()
			log.Printf("Preloaded %d bundled SCIDs", len(bundledTelaSCIDs))
		}

		// Phase 2: FastSync — HyperGnomon queries the GnomonSC registry,
		// stores all SCIDs in Turbo mode (~1s), then runs probeTELA async
		// to classify TELA apps via jrpc2 batch.  No custom probing needed.
		log.Println("TELA discovery: FastSync starting...")
		if err := activeIndexer.FastSync(false); err != nil {
			log.Printf("FastSync error: %v", err)
		} else {
			log.Println("TELA discovery: FastSync complete, probeTELA running in background")
		}

		// Phase 3: Block scanner — only processes blocks since FastSync set
		// LastIndexedHeight to chain tip. Runs in a sub-goroutine.
		go activeIndexer.StartDaemonMode()
	}()

	lastHeight := activeIndexer.LastIndexedHeight.Load()
	chainHeight := activeIndexer.ChainHeight.Load()
	log.Printf("HyperGnomon started: chain=%d indexed=%d (fastsync running in background)", chainHeight, lastHeight)

	// API server starts immediately.  With PostScanVarsMode:"lazy" there
	// is no RPC pool contention from a post-scan sweep, so the server
	// can safely read from the store while FastSync fills it.
	{
		myAPIServer = hgapi.NewServer(
			activeIndexer.Store,
			activeIndexer.RPCPool,
			fmt.Sprintf("127.0.0.1:%d", *gnomonPort),
			&activeIndexer.SafeHeight,
			nil,
			activeIndexer,
			0,
		)
		go func() {
			if err := myAPIServer.Start(); err != nil {
				log.Printf("HyperGnomon API server exited: %v", err)
			}
		}()
		log.Printf("HyperGnomon API listening on :%d", *gnomonPort)
	}

	// Progressive SCID discovery — sends new_tela_app events as FastSync
	// populates ValidatedSCs.  The 2s ticker catches newly discovered SCIDs.
	go func() {
		known := knownSCIDs()
		if len(known) > 0 {
			filtered := validatedSCIDCount()
			sendMsg(map[string]any{
				"event":    "catalog_progress",
				"total":    len(known),
				"filtered": filtered,
			})
		}
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-cancel:
				return
			case <-ticker.C:
				indexed := activeIndexer.LastIndexedHeight.Load()
				chainH := activeIndexer.ChainHeight.Load()
				if indexed > 0 && chainH > 0 {
					sendMsg(map[string]any{
						"event":   "sync_progress",
						"indexed": indexed,
						"chain":   chainH,
					})
					if indexed >= chainH-20 && !tipSyncedSent {
						tipSyncedSent = true
						sendMsg(map[string]any{
							"event":  "tip_synced",
							"height": indexed,
						})
					}
				}

				current := knownSCIDs()
				filtered := validatedSCIDCount()
				sendMsg(map[string]any{
					"event":    "catalog_progress",
					"total":    len(current),
					"filtered": filtered,
				})

				if len(current) > len(known) {
					existing := make(map[string]struct{}, len(known))
					for _, scid := range known {
						existing[scid] = struct{}{}
					}
					for _, scid := range current {
						if _, ok := existing[scid]; !ok {
							sendMsg(map[string]any{
								"event": "new_tela_app",
								"scid":  scid,
							})
						}
					}
					log.Printf("Progressive: %d SCIDs (%d new)", len(current), len(current)-len(known))
					known = current
				}
			}
		}
	}()
}

// validatedSCIDCount returns the number of TELA-classified SCIDs in the Store.
func validatedSCIDCount() int {
	if myIndexer == nil {
		return 0
	}
	n := 0
	for _, class := range []string{"TELA-INDEX-1"} {
		installs, err := myIndexer.Store.GetClassInstalls(class, 0)
		if err == nil {
			n += len(installs)
		}
	}
	return n
}

func knownSCIDs() []string {
	if myIndexer == nil {
		out := make([]string, len(bundledTelaSCIDs))
		copy(out, bundledTelaSCIDs)
		return out
	}

	seen := make(map[string]bool)
	for _, class := range []string{"TELA-INDEX-1"} {
		installs, err := myIndexer.Store.GetClassInstalls(class, 0)
		if err != nil {
			log.Printf("knownSCIDs: GetClassInstalls(%s): %v", class, err)
			continue
		}
		for _, inst := range installs {
			seen[inst.SCID] = true
		}
	}
	out := make([]string, 0, len(seen))
	for scid := range seen {
		out = append(out, scid)
	}
	return out
}
// indexSCIDNow imports a single SCID for immediate indexing via HyperGnomon.
func indexSCIDNow(scid string) {
	scid = strings.TrimSpace(scid)
	if myIndexer == nil || len(scid) != 64 {
		return
	}
	// IndexSingleSCID with skipfsrecheck=false forces a fresh daemon GetSC
	if _, err := myIndexer.IndexSingleSCID(scid, false, false); err != nil {
		log.Printf("indexSCIDNow: %v", err)
		return
	}
	log.Printf("indexSCIDNow: indexed %s", scid)
}

type SCIDVarData struct {
	SCID          string `json:"scid"`
	DURL          string `json:"dURL"`
	NameHdr       string `json:"nameHdr"`
	DescrHdr      string `json:"descrHdr"`
	IconURL       string `json:"iconURL"`
	Likes         int    `json:"likes"`
	Dislikes      int    `json:"dislikes"`
	Average       int    `json:"average"`
	CreatedHeight int64  `json:"createdHeight"`
}

// fetchSCIDVariables queries each SCID's stored variables directly from the
// daemon RPC (DERO.GetSC with variables:true). Used as a fallback when no
// local Gnomon API is available (remote node).
func fetchSCIDVariables(node string, scids []string) []SCIDVarData {
	type jobResult struct {
		scid string
		ok   bool
	}
	type scVar struct {
		Key   string `json:"Key"`
		Value string `json:"Value"`
	}

	type daemonResp struct {
		Result *struct {
			StringKeys map[string]any            `json:"stringkeys"`
			Uint64Keys map[string]uint64          `json:"uint64keys"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}

	const workers = 8
	jobs := make(chan string, len(scids))
	results := make(chan *SCIDVarData, len(scids))
	var wg sync.WaitGroup
	var failCount atomic.Int64

	client := &http.Client{Timeout: 15 * time.Second}

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for scid := range jobs {
				reqBody := fmt.Sprintf(
					`{"jsonrpc":"2.0","id":"1","method":"DERO.GetSC","params":{"scid":%q,"code":false,"variables":true}}`,
					scid,
				)
				resp, err := client.Post(node+"/json_rpc", "application/json", strings.NewReader(reqBody))
				if err != nil {
					failCount.Add(1)
					continue
				}
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil {
					failCount.Add(1)
					continue
				}

				var rpc daemonResp
				if err := json.Unmarshal(body, &rpc); err != nil {
					failCount.Add(1)
					continue
				}
				if rpc.Result == nil {
					if rpc.Error != nil {
						log.Printf("fetchSCIDVariables daemon error for %.16s: code=%d msg=%s", scid, rpc.Error.Code, rpc.Error.Message)
					}
					failCount.Add(1)
					continue
				}

				out := &SCIDVarData{SCID: scid}
				ratings := []struct {
					rating float64
					height int64
				}{}

				for key, raw := range rpc.Result.StringKeys {
					val, _ := raw.(string)
					// Daemon returns stringkey values hex-encoded; decode for plain-text parsing
					if d, err := hex.DecodeString(val); err == nil {
						val = string(d)
					}

			switch key {
			case "dURL":
				out.DURL = val
			case "nameHdr", "var_header_name":
				out.NameHdr = val
			case "descrHdr", "var_header_description":
				out.DescrHdr = val
			case "iconURLHdr", "var_header_icon":
				out.IconURL = val
			default:
						if (strings.HasPrefix(key, "dero1") || strings.HasPrefix(key, "deto1")) && len(key) > 64 {
							parts := strings.SplitN(val, "_", 2)
							if len(parts) == 2 {
								r, _ := strconv.ParseFloat(parts[0], 64)
								h, _ := strconv.ParseInt(parts[1], 10, 64)
								ratings = append(ratings, struct {
									rating float64
									height int64
								}{r, h})
								if h > 0 && (out.CreatedHeight == 0 || h < out.CreatedHeight) {
									out.CreatedHeight = h
								}
							}
						}
					}
				}

				for _, r := range ratings {
					if r.rating >= 50 {
						out.Likes++
					} else {
						out.Dislikes++
					}
				}
				if len(ratings) > 0 {
					var sum float64
					for _, r := range ratings {
						sum += r.rating
					}
					out.Average = int(math.Round(sum / float64(len(ratings))))
				}

				if out.DURL == "" {
					out.DURL = scid
				}
				if out.NameHdr == "" {
					out.NameHdr = scid
				}

				results <- out
			}
		}()
	}

	for _, scid := range scids {
		jobs <- scid
	}
	close(jobs)
	wg.Wait()
	close(results)

	var all []SCIDVarData
	for r := range results {
		all = append(all, *r)
	}
	fails := failCount.Load()
	if fails > 0 {
		log.Printf("fetchSCIDVariables: %d/%d SCIDs failed", fails, len(scids))
	}
	return all
}

func stopSync() {
	if syncCancel != nil {
		close(syncCancel)
		syncCancel = nil
	}
	stopIndexer()
}

type DaemonInfo struct {
	TopoHeight   int64  `json:"topoheight"`
	StableHeight int64  `json:"stableheight"`
	Difficulty   int64  `json:"difficulty"`
	Version      string `json:"version"`
	Network      string `json:"network"`
	MempoolSize  int    `json:"tx_pool_size"`
}

// getChainTopoHeight returns the daemon's topoheight, or 0 on error.
// Thin wrapper around getDaemonInfo for callers that only need the height.
func getChainTopoHeight(node string) int64 {
	di := getDaemonInfo(node)
	if di == nil {
		return 0
	}
	return di.TopoHeight
}

func getDaemonInfo(node string) *DaemonInfo {
	return getDaemonInfoFromDaemon(node)
}

func getDaemonInfoFromDaemon(node string) *DaemonInfo {
	client := &http.Client{Timeout: 5 * time.Second}
	body := strings.NewReader(`{"jsonrpc":"2.0","id":"1","method":"DERO.GetInfo"}`)
	resp, err := client.Post(node+"/json_rpc", "application/json", body)
	if err != nil {
		log.Printf("getDaemonInfo error: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var raw struct {
		Result map[string]any `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&raw)
	if raw.Result == nil {
		return nil
	}

	return parseGetInfo(raw.Result)
}

// parseGetInfo extracts DaemonInfo from a GetInfo JSON object.
// Works with both the Gnomon API and daemon RPC response formats.
func parseGetInfo(data map[string]any) *DaemonInfo {
	info := &DaemonInfo{}

	if h, ok := data["topoheight"].(float64); ok {
		info.TopoHeight = int64(h)
	}
	if h, ok := data["stableheight"].(float64); ok {
		info.StableHeight = int64(h)
	}
	if d, ok := data["difficulty"].(float64); ok {
		info.Difficulty = int64(d)
	}
	if v, ok := data["version"].(string); ok {
		info.Version = v
	}
	if n, ok := data["network"].(string); ok {
		info.Network = n
	}
	if info.Network == "" {
		if testnet, ok := data["testnet"].(bool); ok && testnet {
			info.Network = "Testnet"
		} else {
			info.Network = "Mainnet"
		}
	}
	if m, ok := data["tx_pool_size"].(float64); ok {
		info.MempoolSize = int(m)
	}

	return info
}

func stopIndexer() {
	if myIndexer != nil {
		myIndexer.Close()
		myIndexer = nil
	}
}

func closeStorage() {
	stopIndexer()
}
