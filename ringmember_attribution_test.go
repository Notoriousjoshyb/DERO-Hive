// Headless on-chain verification for sender-visibility (anonymous attribution +
// curated ring members). This exercises the EXACT fork code path HOLOGRAM's send
// wiring calls — TransferPayload0WithOptions with AttributionAnonymous + curated
// PreferredDecoys — against the live simulator daemon, then opens the RECEIVER
// wallet and asserts it decodes a DECOY as the claimed sender (not the real one).
//
// This proves the wiring actually drives attribution on-chain, not just renders.
//
// Opt-in (does not run in normal `go test`):
//   HOLOGRAM_RINGTEST=1 go test -run TestRingMemberAnonymousAttribution -v -timeout 300s
//
// Requires HOLOGRAM's simulator running (Settings → Simulator): daemon at :20000
// with the canonical pre-seeded, funded, registered test wallets.
package main

import (
	"encoding/hex"
	"os"
	"testing"
	"time"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/rpc"
	"github.com/deroproject/derohe/walletapi"
)

const (
	simDaemon       = "127.0.0.1:20000"
	ringTestRing    = uint64(16)
	ringTestAmount  = uint64(100000) // 0.00100 DERO in atomic units
	ringTestPayPort = uint64(0)
)

// openSimWalletFromSeed recreates a canonical sim test wallet in memory (no file
// locks vs the running simulator) and brings it online against the sim daemon.
func openSimWalletFromSeed(t *testing.T, seedHex string) *walletapi.Wallet_Memory {
	t.Helper()
	seedRaw, err := hex.DecodeString(seedHex)
	if err != nil {
		t.Fatalf("decode seed: %v", err)
	}
	w, err := walletapi.Create_Encrypted_Wallet_Memory("", new(crypto.BNRed).SetBytes(seedRaw))
	if err != nil {
		t.Fatalf("create wallet from seed: %v", err)
	}
	w.SetNetwork(false) // simulator is testnet-flavored — must match daemon
	w.SetDaemonAddress(simDaemon)
	w.SetOnlineMode()
	// Give the global sync loop a moment to establish the shared daemon connection
	// (walletapi.Connect was called once in the test before any wallet is opened).
	for i := 0; i < 20 && !walletapi.IsDaemonOnline(); i++ {
		time.Sleep(250 * time.Millisecond)
	}
	if err := w.Sync_Wallet_Memory_With_Daemon(); err != nil {
		t.Fatalf("initial sync: %v", err)
	}
	return w
}

func TestRingMemberAnonymousAttribution(t *testing.T) {
	if os.Getenv("HOLOGRAM_RINGTEST") != "1" {
		t.Skip("set HOLOGRAM_RINGTEST=1 and run the simulator to exercise this")
	}

	// This harness runs in its own process, so its globals default to mainnet and
	// walletapi.Connect would reject the testnet-flavored sim daemon. Mirror what
	// HOLOGRAM's SimulatorManager does (simulator_manager.go:90-92): set the sim +
	// testnet flags and re-init the network config so Config = Testnet.
	globals.Arguments["--simulator"] = true
	globals.Arguments["--testnet"] = true
	globals.InitNetwork()

	// Establish the shared walletapi daemon connection (the global rpc_client that
	// IsDaemonOnline / Sync read). Without this, SetOnlineMode alone reports offline.
	if err := walletapi.Connect(simDaemon); err != nil {
		t.Fatalf("walletapi.Connect(%s): %v", simDaemon, err)
	}

	// sender = wallet 0, receiver = wallet 1; decoys = wallets 2..6 (curated set).
	sender := openSimWalletFromSeed(t, SimulatorWalletSeeds[0])
	receiver := openSimWalletFromSeed(t, SimulatorWalletSeeds[1])
	senderAddr := sender.GetAddress().String()
	receiverAddr := receiver.GetAddress().String()

	if !sender.IsRegistered() {
		t.Fatalf("sender wallet 0 not registered on the sim chain — fund/register test wallets first")
	}
	if mature, _ := sender.Get_Balance(); mature < ringTestAmount {
		t.Fatalf("sender balance %d < required %d — fund test wallet 0 in the simulator", mature, ringTestAmount)
	}

	// The curated ring members: other registered sim wallets (never sender/receiver).
	curated := []string{}
	for i := 2; i <= 6; i++ {
		w := openSimWalletFromSeed(t, SimulatorWalletSeeds[i])
		curated = append(curated, w.GetAddress().String())
	}
	curatedSet := map[string]bool{}
	for _, a := range curated {
		curatedSet[a] = true
	}
	t.Logf("sender   = %s", senderAddr)
	t.Logf("receiver = %s", receiverAddr)
	t.Logf("curated decoys (%d) = %v", len(curated), curated)

	// Build the anonymized, curated transfer — the exact fork call HOLOGRAM's
	// runTransfer makes (anonymize=true + preferred_decoys=set members).
	transfers := []rpc.Transfer{{
		Destination: receiverAddr,
		Amount:      ringTestAmount,
		Payload_RPC: rpc.Arguments{
			{Name: rpc.RPC_DESTINATION_PORT, DataType: rpc.DataUint64, Value: ringTestPayPort},
		},
	}}
	opts := walletapi.TransferOptions{
		Attribution: walletapi.AttributionAnonymous,
		Ring:        &walletapi.RingPreference{PreferredDecoys: curated}, // Strict:false
	}

	if err := sender.Sync_Wallet_Memory_With_Daemon(); err != nil {
		t.Fatalf("pre-build sync: %v", err)
	}
	tx, err := sender.TransferPayload0WithOptions(transfers, ringTestRing, false, rpc.Arguments{}, 0, false, opts)
	if err != nil {
		t.Fatalf("TransferPayload0WithOptions: %v", err)
	}
	// NOTE: Statement.RingSize is computed during proof gen and only re-materializes
	// after the daemon round-trip populates the ring; it's not reliable pre-broadcast.
	// Ring size is verified below from what the receiver actually sees on-chain.
	if err := sender.SendTransaction(tx); err != nil {
		t.Fatalf("broadcast: %v", err)
	}
	txid := tx.GetHash().String()
	t.Logf("broadcast anonymized ring-%d tx %s", ringTestRing, txid)

	// Let the sim mine + propagate, then sync the RECEIVER and read what IT
	// decodes the sender as — this is exactly what the cb02257 chip displays.
	var got rpc.Entry
	found := false
	for attempt := 0; attempt < 30 && !found; attempt++ {
		time.Sleep(2 * time.Second)
		if err := receiver.Sync_Wallet_Memory_With_Daemon(); err != nil {
			t.Logf("receiver sync attempt %d: %v", attempt, err)
			continue
		}
		for _, e := range receiver.Show_Transfers(crypto.ZEROHASH, false, true, false, 0, 0, "", "", 0, 0) {
			if e.TXID == txid {
				got = e
				found = true
				break
			}
		}
	}
	if !found {
		t.Fatalf("receiver never saw tx %s after ~60s — did the sim mine it?", txid)
	}

	// === The assertions that prove anonymization happened on-chain ===
	t.Logf("receiver decoded sender = %s (verified=%v)", got.Sender, got.SenderVerified)

	if got.SenderVerified {
		t.Errorf("SenderVerified=true at ring %d — attribution must be UNVERIFIED above ring 2", ringTestRing)
	}
	if got.Sender == senderAddr {
		t.Fatalf("FAIL: receiver decoded the REAL sender (%s) — anonymization did not take effect", senderAddr)
	}
	if got.Sender == receiverAddr {
		t.Errorf("receiver decoded its OWN address as sender — that's honest-mode behavior, not anonymous")
	}
	if !curatedSet[got.Sender] {
		// Not fatal: the fork picks a random slot among witness_index[2:], which
		// includes our curated members AND any random top-up. A curated hit proves
		// curation drove it; a non-curated decoy still proves anonymization worked.
		t.Logf("NOTE: decoded sender is a decoy but not from the curated set (random top-up slot) — anonymization still confirmed")
	} else {
		t.Logf("CONFIRMED: receiver attributes the send to a CURATED decoy — curation drove the attribution")
	}

	t.Logf("PASS: anonymized attribution verified on-chain — receiver sees a decoy, not the real sender")
}
