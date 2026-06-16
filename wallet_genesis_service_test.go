package main

// G4 — the simulator hard-refuse guard (the real "do this first" blocker).
//
// Genesis must refuse while the app is in simulator mode, gated on the
// AUTHORITATIVE a.IsInSimulatorMode() (nodeManager.networkMode) — NOT the stale
// globals.Arguments["--simulator"] (review [M4]). A stale/sim network corrupts
// deto1/dero1 address rendering on both persistence paths, and KDF strength on
// the disk path, so both models are refused.

import (
	"fmt"
	"testing"

	"github.com/DHEBP/HOLOGRAM/wallet/genesis"
)

// fakeDaemon is a minimal BlockchainClient for testing the broadcast path
// without a real daemon. It records the last call and returns a canned result.
type fakeDaemon struct {
	lastMethod string
	lastParams interface{}
	result     interface{}
	err        error
}

func (f *fakeDaemon) Call(method string, params interface{}) (interface{}, error) {
	f.lastMethod = method
	f.lastParams = params
	return f.result, f.err
}

// remaining BlockchainClient methods — unused by the broadcast path, stubbed.
func (f *fakeDaemon) GetInfo() (map[string]interface{}, error) { return nil, nil }
func (f *fakeDaemon) GetSC(string, bool, bool) (map[string]interface{}, error) {
	return nil, nil
}
func (f *fakeDaemon) GetSCVariables(string, bool, bool) (map[string]interface{}, error) {
	return nil, nil
}
func (f *fakeDaemon) TestConnection() error      { return nil }
func (f *fakeDaemon) GetEndpoint() string        { return "" }
func (f *fakeDaemon) SetEndpoint(endpoint string) {}

const (
	burnedAddrRoot   = "dero1qyfez0fm768fmp9tele8crqnvq59jgmjcx07y85y9x8mv0a43fss2qgx3n4pl"
	burnedRegHexRoot = "0100000113913d3bf68e9d84abcff27c0c136028592372c19fe21e84298fb63fb58a61050111dfa2948c69d1ffed09a9600e23a8e39b84d9392c6d0e01844606d60cb4f01f101962776c0942de7c47efcf3cdf87abafdb274b7034f88f73838a10b723ee97"
)

func TestBroadcastRegistrationDCSP_HappyPath(t *testing.T) {
	withNetworkMode(t, NetworkMainnet)
	blob, err := genesis.EncodeRegistrationDCSP(genesis.NetworkMainnet, 1750000000, burnedAddrRoot, burnedRegHexRoot)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	fake := &fakeDaemon{result: map[string]interface{}{"status": "OK", "txid": "abc123"}}
	a := &App{daemonClient: fake}

	res := a.BroadcastRegistrationDCSP(blob)
	if ok, _ := res["success"].(bool); !ok {
		t.Fatalf("broadcast should succeed; got %v", res["error"])
	}
	if fake.lastMethod != "DERO.SendRawTransaction" {
		t.Fatalf("called %q, want DERO.SendRawTransaction", fake.lastMethod)
	}
	if res["txid"] != "abc123" {
		t.Fatalf("txid = %v, want abc123", res["txid"])
	}
	if p, ok := fake.lastParams.(map[string]interface{}); !ok || p["tx_as_hex"] != burnedRegHexRoot {
		t.Fatalf("daemon did not receive the raw tx hex: %v", fake.lastParams)
	}
}

func TestBroadcastRegistrationDCSP_NetworkMismatchRejected(t *testing.T) {
	withNetworkMode(t, NetworkSimulator) // hot wallet on simulator...
	blob, _ := genesis.EncodeRegistrationDCSP(genesis.NetworkMainnet, 1750000000, burnedAddrRoot, burnedRegHexRoot)
	fake := &fakeDaemon{result: map[string]interface{}{"status": "OK"}}
	a := &App{daemonClient: fake}

	res := a.BroadcastRegistrationDCSP(blob)
	if ok, _ := res["success"].(bool); ok {
		t.Fatal("must reject a mainnet blob when the wallet is on simulator")
	}
	if fake.lastMethod != "" {
		t.Fatal("must NOT call the daemon when the network check fails")
	}
}

func TestBroadcastRegistrationDCSP_NilDaemon(t *testing.T) {
	withNetworkMode(t, NetworkMainnet)
	blob, _ := genesis.EncodeRegistrationDCSP(genesis.NetworkMainnet, 1750000000, burnedAddrRoot, burnedRegHexRoot)
	a := &App{} // no daemonClient

	res := a.BroadcastRegistrationDCSP(blob)
	if ok, _ := res["success"].(bool); ok {
		t.Fatal("must fail cleanly when not connected to a daemon")
	}
}

func TestBroadcastRegistrationDCSP_DaemonError(t *testing.T) {
	withNetworkMode(t, NetworkMainnet)
	blob, _ := genesis.EncodeRegistrationDCSP(genesis.NetworkMainnet, 1750000000, burnedAddrRoot, burnedRegHexRoot)
	fake := &fakeDaemon{err: fmt.Errorf("daemon down")}
	a := &App{daemonClient: fake}

	res := a.BroadcastRegistrationDCSP(blob)
	if ok, _ := res["success"].(bool); ok {
		t.Fatal("must surface a daemon error as failure")
	}
}

// withNetworkMode sets the package-global nodeManager.networkMode for a test and
// restores it after. nodeManager is a shared global (node_manager.go:101), so
// these tests must not run in parallel with anything that reads it.
func withNetworkMode(t *testing.T, mode NetworkMode) {
	t.Helper()
	prev := nodeManager.networkMode
	nodeManager.networkMode = mode
	t.Cleanup(func() { nodeManager.networkMode = prev })
}

func TestGenesis_RefusesUnderSimulatorMode(t *testing.T) {
	withNetworkMode(t, NetworkSimulator)
	a := &App{}

	res := a.GenerateColdWallet("mainnet", 0, false)
	if ok, _ := res["success"].(bool); ok {
		t.Fatal("GenerateColdWallet must refuse in simulator mode; it succeeded")
	}
	if msg, _ := res["error"].(string); msg != genesisRefuseMsg {
		t.Fatalf("refuse message = %q, want %q", msg, genesisRefuseMsg)
	}
	// the seed must never be present in a refused response
	if _, present := res["seed"]; present {
		t.Fatal("refused response must not carry a seed field")
	}

	// VerifyColdWallet is gated the same way.
	vres := a.VerifyColdWallet(testSeedRoot, "", "mainnet", "")
	if ok, _ := vres["success"].(bool); ok {
		t.Fatal("VerifyColdWallet must refuse in simulator mode")
	}
}

func TestGenesis_GeneratesUnderMainnet(t *testing.T) {
	withNetworkMode(t, NetworkMainnet)
	a := &App{}

	res := a.GenerateColdWallet("mainnet", 0, false)
	if ok, _ := res["success"].(bool); !ok {
		t.Fatalf("GenerateColdWallet should succeed in mainnet mode; got error: %v", res["error"])
	}
	addr, _ := res["address"].(string)
	seed, _ := res["seed"].(string)
	if addr == "" || seed == "" {
		t.Fatalf("expected non-empty address and seed, got addr=%q seedLen=%d", addr, len(seed))
	}
	if ok, _ := res["selfCheckOK"].(bool); !ok {
		t.Fatal("expected selfCheckOK=true for a freshly generated wallet")
	}
}

// testSeedRoot mirrors the subpackage's burned vector for the refuse-path check
// (the value is never derived here — the guard fires before any derivation).
const testSeedRoot = "anybody auburn down awning nightly eels icon ungainly jump upstairs foolish swung rudely kangaroo catch gossip upcoming kennel echo dwindling bifocals potato jewels jailed bifocals"

// MineRegistration is refused in simulator mode (same guard as genesis).
func TestMineRegistration_RefusesUnderSimulatorMode(t *testing.T) {
	withNetworkMode(t, NetworkSimulator)
	a := &App{}
	res := a.MineRegistration(testSeedRoot, "mainnet")
	if ok, _ := res["success"].(bool); ok {
		t.Fatal("MineRegistration must refuse in simulator mode")
	}
}

// A second MineRegistration while one is in progress is rejected; CancelColdRegistration
// clears it. (a.ctx is nil here so events are no-ops; we drive the state machine
// directly via the wrapper and a real but immediately-cancelled mine.)
func TestMineRegistration_RejectsConcurrentAndCancels(t *testing.T) {
	withNetworkMode(t, NetworkMainnet)
	a := &App{}

	// Start a real mine (background grind), then immediately assert a second
	// start is rejected and cancel stops it.
	res := a.MineRegistration(testSeedRoot, "mainnet")
	if ok, _ := res["success"].(bool); !ok {
		t.Fatalf("first MineRegistration should start; got %v", res["error"])
	}
	t.Cleanup(func() { a.CancelColdRegistration() }) // ensure the grind never outlives the test

	second := a.MineRegistration(testSeedRoot, "mainnet")
	if ok, _ := second["success"].(bool); ok {
		t.Fatal("second concurrent MineRegistration must be rejected")
	}

	cancel := a.CancelColdRegistration()
	if ok, _ := cancel["success"].(bool); !ok {
		t.Fatalf("CancelColdRegistration should succeed while mining; got %v", cancel["error"])
	}
	// cancelling again (nothing running) is a clean no-op error, not a panic.
	again := a.CancelColdRegistration()
	if ok, _ := again["success"].(bool); ok {
		t.Fatal("CancelColdRegistration with nothing running should report no-op")
	}
}
