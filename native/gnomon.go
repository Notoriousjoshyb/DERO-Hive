package main

import (
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

	"github.com/civilware/Gnomon/api"
	"github.com/civilware/Gnomon/indexer"
	"github.com/civilware/Gnomon/storage"
	"github.com/civilware/Gnomon/structures"
)

var (
	gravDB    *storage.GravitonStore
	boltDB    *storage.BboltStore
	apiServer *api.ApiServer
	myIndexer *indexer.Indexer
)

var indexerRunning bool

var syncCancel chan struct{}

var (
	telaMetadataMu     sync.RWMutex
	telaMetadataOnce   sync.Once
	telaMetadataReady  = make(chan struct{})
	telaMetadata       map[string]*TelaAppInfo
)

const telaFilter = `Function init() Uint64
10 IF EXISTS("owner") == 0 THEN GOTO 30
20 RETURN 1
30 STORE("owner", address())
50 STORE("telaVersion",`

type TelaAppInfo struct {
	SCID         string `json:"scid"`
	DURL         string `json:"durl"`
	Name         string `json:"name"`
	InstallHeight int64  `json:"install_height"`
	FromAPI      bool   `json:"from_api"`
}

func discoverTelaApps(node string) []TelaAppInfo {
	// 1. Return from in-memory indexer SCIDs first (instant, matches server_status count)
	if myIndexer != nil && len(myIndexer.ValidatedSCs) > 0 {
		myIndexer.Lock()
		scids := make([]string, len(myIndexer.ValidatedSCs))
		copy(scids, myIndexer.ValidatedSCs)
		myIndexer.Unlock()
		log.Printf("TELA discovery: got %d SCIDs from indexer", len(scids))

		apps := make([]TelaAppInfo, 0, len(scids))
		for _, scid := range scids {
			apps = append(apps, TelaAppInfo{SCID: scid, DURL: scid, Name: scid, InstallHeight: 0, FromAPI: false})
		}
		return apps
	}

	// 2. Fallback: bundled known TELA list (indexer not ready yet)
	log.Printf("TELA discovery: falling back to bundled catalog (%d SCIDs)", len(bundledTelaSCIDs))
	return discoverTelaAppsFromBundled(node)
}

func discoverTelaAppsFromBundled(node string) []TelaAppInfo {
	// Kick off background metadata fetch once
	telaMetadataOnce.Do(func() {
		go func() {
			fetchBundledMetadata(node)
			close(telaMetadataReady)
		}()
	})

	// Wait up to 5s for metadata to be ready
	select {
	case <-telaMetadataReady:
	case <-time.After(5 * time.Second):
	}

	telaMetadataMu.RLock()
	cached := telaMetadata
	telaMetadataMu.RUnlock()

	apps := make([]TelaAppInfo, 0, len(bundledTelaSCIDs))
	for _, scid := range bundledTelaSCIDs {
		if cached != nil {
			if a, ok := cached[scid]; ok {
				apps = append(apps, *a)
				continue
			}
		}
		apps = append(apps, TelaAppInfo{SCID: scid, DURL: scid, Name: scid, InstallHeight: 0})
	}
	if len(apps) == 0 {
		log.Printf("TELA discovery: bundled catalog had 0 valid TELA contracts for node %s", node)
	}
	return apps
}

func extractString(code, prefix string) string {
	idx := strings.Index(code, prefix)
	if idx == -1 {
		return ""
	}
	start := idx + len(prefix)
	end := strings.Index(code[start:], `"`)
	if end == -1 {
		return ""
	}
	return code[start : start+end]
}

func fetchBundledMetadata(node string) {
	log.Printf("Background: fetching metadata for %d bundled SCIDs", len(bundledTelaSCIDs))

	type scJob struct {
		scid string
		durl string
		name string
	}

	const workers = 8
	jobs := make(chan string, len(bundledTelaSCIDs))
	results := make(chan scJob, len(bundledTelaSCIDs))
	var wg sync.WaitGroup

	client := &http.Client{Timeout: 10 * time.Second}

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for scid := range jobs {
				reqBody := fmt.Sprintf(
					`{"jsonrpc":"2.0","id":"1","method":"DERO.GetSC","params":{"scid":%q,"code":true,"variables":false}}`,
					scid,
				)
				resp, err := client.Post(node+"/json_rpc", "application/json", strings.NewReader(reqBody))
				if err != nil {
					continue
				}
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil {
					continue
				}

				var rpc struct {
					Result *struct {
						Code string `json:"code"`
					} `json:"result"`
				}
				if json.Unmarshal(body, &rpc) != nil || rpc.Result == nil {
					continue
				}

				out := scJob{scid: scid}
				if d := extractString(rpc.Result.Code, `STORE("dURL", "`); d != "" {
					out.durl = d
				}
				if n := extractString(rpc.Result.Code, `STORE("nameHdr", "`); n != "" {
					out.name = n
				}
				results <- out
			}
		}()
	}

	for _, scid := range bundledTelaSCIDs {
		jobs <- scid
	}
	close(jobs)
	wg.Wait()
	close(results)

	m := make(map[string]*TelaAppInfo, len(bundledTelaSCIDs))
	for r := range results {
		durl := r.durl
		name := r.name
		if durl == "" {
			durl = r.scid
		}
		if name == "" {
			name = r.scid
		}
		m[r.scid] = &TelaAppInfo{SCID: r.scid, DURL: durl, Name: name, InstallHeight: 0}
	}

	telaMetadataMu.Lock()
	telaMetadata = m
	telaMetadataMu.Unlock()

	log.Printf("Background: metadata cached for %d/%d SCIDs", len(m), len(bundledTelaSCIDs))
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

func initDB() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not find home dir: %w", err)
	}
	db := filepath.Join(home, ".purewolf", "gnomondb")
	os.MkdirAll(db, 0755)

	boltDB, err = storage.NewBBoltDB(db, "GNOMON.db")
	if err != nil {
		return fmt.Errorf("boltdb: %w", err)
	}

	gravDB, err = storage.NewGravDB(db, "25ms")
	if err != nil {
		return fmt.Errorf("gravdb: %w", err)
	}

	log.Printf("DB handles reinitialized")
	return nil
}

func initStorage() error {
	if err := initDB(); err != nil {
		return err
	}

	apiCfg := &structures.APIConfig{
		Enabled: true,
		Listen:  fmt.Sprintf("127.0.0.1:%d", *gnomonPort),
	}
	apiServer = api.NewApiServer(apiCfg, gravDB, boltDB, "boltdb")
	go apiServer.Start()

	log.Printf("Storage + Gnomon API ready on :%d", *gnomonPort)
	return nil
}

func updateAPIServerDB() {
	if apiServer == nil {
		return
	}
	apiServer.GravDBBackend = gravDB
	apiServer.BBSBackend = boltDB
	log.Printf("API server DB handles updated")
}

const fastSyncDiff = 100

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

	// Start health watch to handle auto-reconnect
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

	lastHeight, err := boltDB.GetLastIndexHeight()
	log.Printf("Resuming from lastHeight=%d err=%v", lastHeight, err)

	if err != nil {
		log.Printf("DB read failed (%v). Resetting cache.", err)
		home, _ := os.UserHomeDir()
		dbPath := filepath.Join(home, ".purewolf", "gnomondb")
		os.RemoveAll(dbPath)
		os.MkdirAll(dbPath, 0755)
		if err := initDB(); err != nil {
			log.Printf("DB re-init after read failure: %v", err)
		}
		updateAPIServerDB()
		lastHeight = 0
	} else if lastHeight > 0 {
		chainHeight := getChainTopoHeight(node)
		if chainHeight > 0 && lastHeight > chainHeight {
			log.Printf("Stored height %d exceeds chain %d — resetting DB", lastHeight, chainHeight)
			home, _ := os.UserHomeDir()
			dbPath := filepath.Join(home, ".purewolf", "gnomondb")
			os.RemoveAll(dbPath)
			os.MkdirAll(dbPath, 0755)
			if err := initDB(); err != nil {
				log.Printf("DB re-init after height mismatch: %v", err)
			}
			updateAPIServerDB()
			lastHeight = 0
		}
	}

	gap := targetHeight - lastHeight
	log.Printf("Chain height=%d | Indexed=%d | Gap=%d", targetHeight, lastHeight, gap)

	// Preload TELA SCIDs before creating the indexer.
	// Uses the bundled catalog (instant) for immediate startup.
	// Registry SC query runs in background — no 30s delay on remote nodes.
	preloadSCIDs := bundledTelaSCIDs
	log.Printf("Discovering TELA catalog: using bundled catalog (%d SCIDs)", len(preloadSCIDs))

	sf := []string{telaFilter}

	fastSyncConfig := &structures.FastSyncConfig{
		Enabled:           true,
		ForceFastSync:     true,
		ForceFastSyncDiff: fastSyncDiff,
		SkipFSRecheck:     false,
		NoCode:            false,
	}

	activeIndexer := indexer.NewIndexer(
		gravDB,
		boltDB,
		"boltdb",
		sf,
		lastHeight,
		nodeForIndexer,
		"daemon",
		false,
		false,
		fastSyncConfig,
		[]string{},
		false,
	)
	myIndexer = activeIndexer

	// Feed pre-discovered SCIDs to the indexer BEFORE fastsync begins.
	// The indexer writes them to the persistent store and marks them as validated.
	// During fastsync, Gnomon scans historical blocks for these SCIDs and indexes
	// their variable data (ratings, names, descriptions).
	imports := make(map[string]*structures.FastSyncImport, len(preloadSCIDs))
	for _, scid := range preloadSCIDs {
		imports[scid] = &structures.FastSyncImport{}
	}
	if err := activeIndexer.AddSCIDToIndex(imports, false, false); err != nil {
		log.Printf("Preload AddSCIDToIndex error: %v", err)
	} else {
		log.Printf("Preloaded %d SCIDs before fastsync", len(imports))
	}

	indexerRunning = true
	go activeIndexer.StartDaemonMode(5)

	// Background: try the on-chain registry SC for additional SCIDs that
	// aren't in the bundled catalog. This may take 30s on mainnet but
	// doesn't block startup.
	go func() {
		extraSCIDs, err := queryGnomonSCID(node)
		if err != nil || len(extraSCIDs) == 0 {
			return
		}
		telaSCIDs := filterTelaSCIDs(node, extraSCIDs)
		if len(telaSCIDs) > 0 {
			log.Printf("Background registry: discovered %d additional TELA SCIDs", len(telaSCIDs))
			addNewSCIDsToIndexer(telaSCIDs)
		}
	}()
	log.Printf("Fastsync indexer started from height %d", lastHeight)

	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-cancel:
				return
			case <-ticker.C:
				log.Printf(
					"[GNOMON] indexed=%d chain=%d scids=%d",
					activeIndexer.LastIndexedHeight,
					activeIndexer.ChainHeight,
					len(activeIndexer.ValidatedSCs),
				)
			}
		}
	}()

	go monitorIndexer(cancel, node, activeIndexer)
}

func monitorIndexer(
	cancel chan struct{},
	node string,
	idx *indexer.Indexer,
) {
	targetHeight := getChainTopoHeight(node)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

loop:
	for {
		select {
		case <-cancel:
			return

		case <-ticker.C:
			if h := getChainTopoHeight(node); h > targetHeight {
				targetHeight = h
			}

			indexed := idx.LastIndexedHeight

			sendMsg(map[string]any{
				"event":   "sync_progress",
				"indexed": indexed,
				"chain":   targetHeight,
			})

			if indexed >= targetHeight-20 {
				break loop
			}
		}
	}

	sendMsg(map[string]any{
		"event":  "tip_synced",
		"height": idx.LastIndexedHeight,
	})

	go startLivePoll(cancel, node, idx.LastIndexedHeight)
	go scanNewBlocksForSCIDs(cancel, node)
	go scanHistoricalSCIDs(cancel, node)
}

// indexSCIDNow queues a single SCID for immediate Gnomon indexing.
func indexSCIDNow(scid string) {
	scid = strings.TrimSpace(scid)
	if myIndexer == nil || len(scid) != 64 {
		return
	}

	scidsToAdd := map[string]*structures.FastSyncImport{
		scid: {},
	}
	if err := myIndexer.AddSCIDToIndex(scidsToAdd, false, false); err != nil {
		log.Printf("indexSCIDNow: %v", err)
		return
	}
	log.Printf("indexSCIDNow: queued %s", scid)
}

func cancelled(cancels ...chan struct{}) bool {
	for _, c := range cancels {
		select {
		case <-c:
			return true
		default:
		}
	}
	return false
}

func filterTelaSCIDs(node string, scids []string, cancels ...chan struct{}) []string {
	const workers = 8
	jobs := make(chan string, len(scids))
	results := make(chan string, len(scids))

	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for scid := range jobs {
				if cancelled(cancels...) {
					return
				}
				if matchesTelaContract(node, scid) {
					results <- scid
				}
			}
		}()
	}

	go func() {
		for i, scid := range scids {
			if cancelled(cancels...) {
				break
			}
			jobs <- scid
			if (i+1)%25 == 0 || i+1 == len(scids) {
				sendMsg(map[string]any{
					"event":    "catalog_progress",
					"phase":    "filtering",
					"filtered": i + 1,
					"total":    len(scids),
				})
			}
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	var tela []string
	for scid := range results {
		tela = append(tela, scid)
	}
	return tela
}

func hasTelaVersionKey(node, scid string) bool {
	reqBody := fmt.Sprintf(
		`{"jsonrpc":"2.0","id":"1","method":"DERO.GetSC","params":{"scid":%q,"code":false,"variables":true,"keystring":["telaVersion"]}}`,
		scid,
	)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(node+"/json_rpc", "application/json", strings.NewReader(reqBody))
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	var rpc struct {
		Result *struct {
			StringKeys map[string]any `json:"stringkeys"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &rpc); err != nil || rpc.Result == nil {
		return false
	}

	v, ok := rpc.Result.StringKeys["telaVersion"]
	if !ok {
		return false
	}
	val, _ := v.(string)
	return strings.HasPrefix(val, "TELA-")
}

func matchesTelaContract(node, scid string) bool {
	return hasTelaVersionKey(node, scid)
}

func queryGnomonSCID(node string) ([]string, error) {
	return queryGnomonSCIDWithTimeout(node, 30*time.Second)
}

func queryGnomonSCIDWithTimeout(node string, timeout time.Duration) ([]string, error) {
	const gnomonSCID = "a05395bb0cf77adc850928b0db00eb5ca7a9ccbafd9a38d021c8d299ad5ce1a4"

	reqBody := fmt.Sprintf(
		`{"jsonrpc":"2.0","id":"1","method":"DERO.GetSC","params":{"scid":%q,"code":false,"variables":true}}`,
		gnomonSCID,
	)

	client := &http.Client{Timeout: timeout}
	resp, err := client.Post(node+"/json_rpc", "application/json", strings.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("DERO.GetSC request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	// Check for JSON-RPC error first
	var rpcResponse struct {
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
		Result *struct {
			StringKeys map[string]any `json:"stringkeys"`
		} `json:"result,omitempty"`
	}
	if err := json.Unmarshal(body, &rpcResponse); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if rpcResponse.Error != nil {
		log.Printf("queryGnomonSCID: daemon returned error code=%d message=%q (registry SC has >1024 variables?)", rpcResponse.Error.Code, rpcResponse.Error.Message)
		return nil, fmt.Errorf("daemon RPC error: code=%d msg=%s", rpcResponse.Error.Code, rpcResponse.Error.Message)
	}

	if rpcResponse.Result == nil {
		return nil, fmt.Errorf("daemon returned neither result nor error")
	}

	seen := make(map[string]struct{})
	for key := range rpcResponse.Result.StringKeys {
		if len(key) == 64 {
			seen[key] = struct{}{}
		}
	}

	scids := make([]string, 0, len(seen))
	for scid := range seen {
		scids = append(scids, scid)
	}
	return scids, nil
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

	client := &http.Client{Timeout: 10 * time.Second}

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
					continue
				}
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil {
					continue
				}

				var rpc daemonResp
				if err := json.Unmarshal(body, &rpc); err != nil || rpc.Result == nil || rpc.Error != nil {
					continue
				}

				out := &SCIDVarData{SCID: scid}
				ratings := []struct {
					rating float64
					height int64
				}{}

				for key, raw := range rpc.Result.StringKeys {
					val, _ := raw.(string)

					switch key {
					case "dURL":
						out.DURL = val
					case "nameHdr":
						out.NameHdr = val
					case "descrHdr":
						out.DescrHdr = val
					case "iconURLHdr":
						out.IconURL = val
					default:
						if len(key) == 64 && strings.HasPrefix(key, "dero1") {
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
	return all
}

func startLivePoll(cancel chan struct{}, node string, fallbackHeight int64) {
	for {
		select {
		case <-cancel:
			return
		case <-time.After(10 * time.Second):
		}

		if currentNode == "" {
			return
		}

		chainHeight := getChainTopoHeight(node)

		if myIndexer != nil && chainHeight > 0 {
			myIndexer.Lock()
			if chainHeight > myIndexer.ChainHeight {
				myIndexer.ChainHeight = chainHeight
			}
			myIndexer.Unlock()
		}

		dbHeight := fallbackHeight
		if myIndexer != nil && myIndexer.LastIndexedHeight > 0 {
			dbHeight = myIndexer.LastIndexedHeight
		} else if h, err := boltDB.GetLastIndexHeight(); err == nil && h > 0 {
			dbHeight = h
		}

		log.Printf("Live poll: dbHeight=%d chainHeight=%d", dbHeight, chainHeight)
		sendMsg(map[string]any{
			"event":   "sync_progress",
			"indexed": dbHeight,
			"chain":   chainHeight,
		})
	}
}

// fetchBlockTxHashes returns non-coinbase transaction hashes for a block height.
func fetchBlockTxHashes(node string, height int64) ([]string, error) {
	body := fmt.Sprintf(
		`{"jsonrpc":"2.0","id":"1","method":"DERO.GetBlock","params":{"height":%d}}`,
		height,
	)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(node+"/json_rpc", "application/json", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var outer struct {
		Result *struct {
			BlockJSON   string `json:"json"`
			BlockHeader *struct {
				TxCount int `json:"txcount"`
			} `json:"block_header"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&outer); err != nil {
		return nil, err
	}
	if outer.Result == nil {
		return nil, fmt.Errorf("no result")
	}

	// Skip parse of inner json when only coinbase TX exists
	if outer.Result.BlockHeader != nil && outer.Result.BlockHeader.TxCount <= 1 {
		return nil, nil
	}

	if outer.Result.BlockJSON == "" {
		return nil, nil
	}

	var inner struct {
		TxHashes []string `json:"tx_hashes"`
	}
	if err := json.Unmarshal([]byte(outer.Result.BlockJSON), &inner); err != nil {
		return nil, err
	}
	return inner.TxHashes, nil
}

// addSCIDToIndexerSkipFetch adds a SCID to the indexer without fetching
// SC variable data from the daemon (skipSCFetch=true). This avoids hanging
// when the indexer WebSocket is half-open on remote nodes.
func addSCIDToIndexerSkipFetch(scid string) {
	if myIndexer == nil || len(scid) != 64 {
		return
	}
	imports := map[string]*structures.FastSyncImport{
		scid: {},
	}
	if err := myIndexer.AddSCIDToIndex(imports, true, false); err != nil {
		log.Printf("Block scanner: AddSCIDToIndex error: %v", err)
	} else {
		log.Printf("Block scanner: indexed SCID %s (skip SC fetch)", scid)
	}
}

type ScannerState struct {
	LastHistoricalHeight int64 `json:"last_historical_height"`
	LastLiveHeight       int64 `json:"last_live_height"`
}

var scannerStatePath string

func init() {
	home, _ := os.UserHomeDir()
	scannerStatePath = filepath.Join(home, ".purewolf", "gnomondb", "scanner.json")
}

func loadScannerState() ScannerState {
	raw, err := os.ReadFile(scannerStatePath)
	if err != nil {
		return ScannerState{}
	}
	var s ScannerState
	if err := json.Unmarshal(raw, &s); err != nil {
		return ScannerState{}
	}
	return s
}

func saveScannerState(s ScannerState) {
	raw, err := json.Marshal(s)
	if err != nil {
		return
	}
	os.WriteFile(scannerStatePath, raw, 0644)
}

// scanNewBlocksForSCIDs polls the chain for new blocks after tip_synced.
// For each new block with non-coinbase transactions, it checks if any are
// TELA contract installs. Discovered SCIDs are added to the indexer and
// the frontend is notified via new_tela_app event.
func scanNewBlocksForSCIDs(cancel chan struct{}, node string) {
	select {
	case <-cancel:
		return
	case <-time.After(10 * time.Second):
	}

	state := loadScannerState()
	lastScanned := state.LastLiveHeight
	if lastScanned <= 0 {
		lastScanned = getChainTopoHeight(node)
	}
	log.Printf("Block scanner: starting from height %d", lastScanned)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-cancel:
			return
		case <-ticker.C:
		}

		chainHeight := getChainTopoHeight(node)
		if chainHeight <= lastScanned {
			continue
		}

		for h := lastScanned + 1; h <= chainHeight; h++ {
			select {
			case <-cancel:
				return
			default:
			}

			txHashes, err := fetchBlockTxHashes(node, h)
			if err != nil || len(txHashes) == 0 {
				continue
			}

			for _, txHash := range txHashes {
				if !hasTelaVersionKey(node, txHash) {
					continue
				}
				addSCIDToIndexerSkipFetch(txHash)
				sendMsg(map[string]any{
					"event":  "new_tela_app",
					"scid":   txHash,
					"height": h,
				})
				log.Printf("Block scanner: discovered TELA app %s at height %d", txHash, h)
			}
		}

		lastScanned = chainHeight
		state.LastLiveHeight = chainHeight
		saveScannerState(state)

		scidCount := 0
		if myIndexer != nil {
			myIndexer.Lock()
			scidCount = len(myIndexer.ValidatedSCs)
			myIndexer.Unlock()
		}
		sendMsg(map[string]any{
			"event":    "scanner_status",
			"type":     "live",
			"height":   chainHeight,
			"scid_cnt": scidCount,
		})
	}
}

// scanHistoricalSCIDs scans blocks from chain height seeking TELA contract
// installs. Uses an 8-worker pool for parallel block fetching. Persists
// progress so reconnects resume where they left off. Sends scanner_status
// events for the UI progress bar.
func scanHistoricalSCIDs(cancel chan struct{}, node string) {
	select {
	case <-cancel:
		return
	case <-time.After(10 * time.Second):
	}

	const startHeight = 4100000
	chainHeight := getChainTopoHeight(node)
	if chainHeight <= startHeight {
		return
	}

	state := loadScannerState()
	scanFrom := state.LastHistoricalHeight
	if scanFrom < startHeight || scanFrom >= chainHeight {
		maxBlocks := int64(100000)
		scanFrom = chainHeight - maxBlocks
		if scanFrom < startHeight {
			scanFrom = startHeight
		}
	}
	if scanFrom > chainHeight {
		return
	}

	total := chainHeight - scanFrom + 1
	log.Printf("Historical scan: scanning %d blocks (%d to %d) with 8 workers",
		total, scanFrom, chainHeight)

	heights := make(chan int64, 100)
	found := make(chan string, 100)
	var wg sync.WaitGroup
	var currentHeight atomic.Int64

	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for h := range heights {
				select {
				case <-cancel:
					return
				default:
				}
				currentHeight.Store(h)
				txHashes, err := fetchBlockTxHashes(node, h)
				if err != nil || len(txHashes) == 0 {
					continue
				}
				for _, txHash := range txHashes {
					if hasTelaVersionKey(node, txHash) {
						found <- txHash
						log.Printf("Historical scan: found TELA SCID %s at height %d", txHash, h)
					}
				}
			}
		}()
	}

	// Consumer goroutine: add SCIDs as they're found
	go func() {
		for scid := range found {
			addSCIDToIndexerSkipFetch(scid)
		}
	}()

	// Progress ticker
	progressDone := make(chan struct{})
	go func() {
		tick := time.NewTicker(10 * time.Second)
		defer tick.Stop()
		saveCounter := 0
		for {
			select {
			case <-cancel:
				return
			case <-progressDone:
				return
			case <-tick.C:
				cur := currentHeight.Load()
				pct := float64(0)
				if total > 0 {
					pct = float64(cur-scanFrom) / float64(total) * 100
				}
				sendMsg(map[string]any{
					"event":    "scanner_status",
					"type":     "historical",
					"progress": int64(math.Round(pct)),
					"current":  cur,
					"total":    total,
				})
				saveCounter++
				if saveCounter%5 == 0 {
					state.LastHistoricalHeight = cur
					saveScannerState(state)
				}
			}
		}
	}()

	// Feed heights to workers
	for h := scanFrom; h <= chainHeight; h++ {
		select {
		case <-cancel:
			close(progressDone)
			return
		case heights <- h:
		}
	}
	close(heights)
	wg.Wait()
	close(found)
	close(progressDone)

	// Persist progress
	state.LastHistoricalHeight = chainHeight
	saveScannerState(state)

	scidCount := 0
	if myIndexer != nil {
		myIndexer.Lock()
		scidCount = len(myIndexer.ValidatedSCs)
		myIndexer.Unlock()
	}
	sendMsg(map[string]any{
		"event":    "scanner_status",
		"type":     "historical",
		"progress": 100,
		"current":  chainHeight,
		"total":    total,
		"scid_cnt": scidCount,
	})
	log.Printf("Historical scan: completed (%d blocks scanned)", total)
	}

func addNewSCIDsToIndexer(scids []string) {
	if myIndexer == nil || len(scids) == 0 {
		return
	}

	imports := make(map[string]*structures.FastSyncImport)
	for _, scid := range scids {
		if len(scid) == 64 {
			imports[scid] = &structures.FastSyncImport{}
		}
	}

	if len(imports) == 0 {
		return
	}

	// AddSCIDToIndex skips SCIDs already in the DB, so duplicates are safe
	if err := myIndexer.AddSCIDToIndex(imports, false, false); err != nil {
		log.Printf("Background discovery: AddSCIDToIndex error: %v", err)
	} else {
		log.Printf("Background discovery: added %d SCIDs to indexer", len(imports))
	}
}

func stopSync() {
	if syncCancel != nil {
		close(syncCancel)
		syncCancel = nil
	}
	stopIndexer()
	if err := initDB(); err != nil {
		log.Printf("stopSync: reinit DB failed: %v", err)
		return
	}
	updateAPIServerDB()
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

	info := &DaemonInfo{}

	if h, ok := raw.Result["topoheight"].(float64); ok {
		info.TopoHeight = int64(h)
	}
	if h, ok := raw.Result["stableheight"].(float64); ok {
		info.StableHeight = int64(h)
	}
	if d, ok := raw.Result["difficulty"].(float64); ok {
		info.Difficulty = int64(d)
	}
	if v, ok := raw.Result["version"].(string); ok {
		info.Version = v
	}
	if n, ok := raw.Result["network"].(string); ok {
		info.Network = n
	}
	if info.Network == "" {
		if testnet, ok := raw.Result["testnet"].(bool); ok && testnet {
			info.Network = "Testnet"
		} else {
			info.Network = "Mainnet"
		}
	}
	if m, ok := raw.Result["tx_pool_size"].(float64); ok {
		info.MempoolSize = int(m)
	}

	return info
}

func stopIndexer() {
	if myIndexer != nil {
		myIndexer.Close()
		myIndexer = nil
	}
	indexerRunning = false
}

func closeStorage() {
	stopIndexer()
	if gravDB != nil {
		gravDB.Closing = true
	}
}
