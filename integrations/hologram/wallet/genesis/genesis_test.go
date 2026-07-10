package genesis

// Build gates ported from the coldwallet-fork verification (see
// docs/HOLOGRAM/build-gates/). These run in the subpackage's OWN test binary,
// independent of the root package's global mutations — so they execute under
// clean globals by default (gate G7), but we force them clean anyway to be
// robust against any import-chain side effects.
//
//   G1-fast  the burned-vector registration is complete (24-bit PoW + valid + binds)
//   G3       seed↔address self-check fires no FALSE failure per network
//   G5       coarse entropy tripwire (companion to the real forbidden-import lint)
//   G7       the burned mainnet vector derives green under clean globals

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/transaction"
	"github.com/deroproject/derohe/walletapi"
)

// Burned, intentionally-public test vector (registration was broadcast to
// mainnet; never use for funds). Pins derivation; safe to commit.
const (
	testSeed = "anybody auburn down awning nightly eels icon ungainly jump upstairs foolish swung rudely kangaroo catch gossip upcoming kennel echo dwindling bifocals potato jewels jailed bifocals"
	testAddr = "dero1qyfez0fm768fmp9tele8crqnvq59jgmjcx07y85y9x8mv0a43fss2qgx3n4pl"
	// real registration TX of the burned wallet — carries a genuine 24-bit PoW.
	burnedRegHex = "0100000113913d3bf68e9d84abcff27c0c136028592372c19fe21e84298fb63fb58a61050111dfa2948c69d1ffed09a9600e23a8e39b84d9392c6d0e01844606d60cb4f01f101962776c0942de7c47efcf3cdf87abafdb274b7034f88f73838a10b723ee97"
)

// cleanGlobals forces mainnet, non-simulator globals for the duration of a test
// and restores them after — so a stale --simulator/--testnet (which would flip
// deto1/dero1 rendering and, on disk, KDF strength) cannot make a correct vector
// fail for environment reasons (gate G7 / review [M10]).
func cleanGlobals(t *testing.T) {
	t.Helper()
	prevSim := globals.Arguments["--simulator"]
	prevTest := globals.Arguments["--testnet"]
	if globals.Arguments == nil {
		globals.Arguments = map[string]interface{}{}
	}
	globals.Arguments["--simulator"] = false
	globals.Arguments["--testnet"] = false
	t.Cleanup(func() {
		globals.Arguments["--simulator"] = prevSim
		globals.Arguments["--testnet"] = prevTest
	})
}

// ---- G7 + G1-fast: the burned mainnet vector derives green, and its
// registration is complete (24-bit PoW + IsRegistrationValid + binds to pubkey).
func TestBurnedVector_DerivesAndRegistrationComplete(t *testing.T) {
	cleanGlobals(t)

	// G7: seed → address under clean globals must equal the burned mainnet addr.
	if err := verifySeedMatchesAddress(testSeed, testAddr, true); err != nil {
		t.Fatalf("burned mainnet vector failed under clean globals: %v "+
			"(if this fails, a stale --simulator/--testnet global is the cause)", err)
	}

	// G1-fast: the burned registration is complete.
	raw, err := hex.DecodeString(burnedRegHex)
	if err != nil {
		t.Fatalf("decode burned reg hex: %v", err)
	}
	var tx transaction.Transaction
	if err := tx.Deserialize(raw); err != nil {
		t.Fatalf("deserialize: %v", err)
	}
	if tx.TransactionType != transaction.REGISTRATION {
		t.Fatalf("type = %v, want REGISTRATION", tx.TransactionType)
	}
	// (a) the 24-bit consensus PoW — IsRegistrationValid does NOT check this.
	if h := tx.GetHash(); !(h[0] == 0 && h[1] == 0 && h[2] == 0) {
		t.Fatalf("registration hash lacks 24-bit PoW: %x", h[:4])
	}
	// (b) the Schnorr signature.
	if !tx.IsRegistrationValid() {
		t.Fatal("IsRegistrationValid() = false on a known-good registration")
	}
	// (c) binds to the burned wallet's pubkey.
	account, err := walletapi.Generate_Account_From_Recovery_Words(testSeed)
	if err != nil {
		t.Fatalf("recover account: %v", err)
	}
	pub := account.Keys.Public.EncodeCompressed()
	if !bytes.Equal(tx.MinerAddress[:], pub[:]) {
		t.Fatal("MinerAddress does not bind to the wallet pubkey")
	}
}

// ---- G3: the self-check must not fire a FALSE failure for a correct wallet on
// either network, and the network flag must still be load-bearing.
func TestSelfCheck_NoFalseFailure_PerNetwork(t *testing.T) {
	cleanGlobals(t)
	for _, net := range []Network{NetworkMainnet, NetworkSimulator} {
		net := net
		t.Run(string(net), func(t *testing.T) {
			cw, err := Generate(net, 0) // 0 = English
			if err != nil {
				t.Fatalf("Generate(%s): %v", net, err)
			}
			if !cw.SelfCheckOK {
				t.Fatalf("Generate(%s) returned SelfCheckOK=false for a correct wallet", net)
			}
			// flipping the network flag must break the match (flag is load-bearing).
			if err := verifySeedMatchesAddress(cw.Seed, cw.Address, !net.mainnet()); err == nil {
				t.Fatalf("expected %s seed to NOT match a %v-rendered address", net, !net.mainnet())
			}
		})
	}
}

// ---- G5: coarse entropy tripwire. NOT a real pin of crypto/rand (a clock-seeded
// math/rand would also pass); the real pin is the forbidden-import lint in
// lint_test.go. Companion only (review [M6]).
func TestKeygen_Entropy_NoCollision(t *testing.T) {
	cleanGlobals(t)
	const n = 16
	seen := make(map[string]bool, n)
	for i := 0; i < n; i++ {
		cw, err := Generate(NetworkMainnet, 0)
		if err != nil {
			t.Fatalf("Generate #%d: %v", i, err)
		}
		if seen[cw.Address] {
			t.Fatalf("duplicate address on keygen %d — entropy source regressed", i)
		}
		seen[cw.Address] = true
	}
}
