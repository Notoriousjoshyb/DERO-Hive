// Package genesis implements offline cold-wallet creation for HOLOGRAM:
// in-memory key generation, seed↔address self-verification, and (separately)
// registration proof-of-work — all provably offline.
//
// Lineage: the logic is lifted from the dero-coldwallet CLI
// (Slixe → mmarcel/8lecramm → Dirtybird99), itself built on deroproject/derohe.
// This package contains ONLY pure logic (no docopt/os.Exit/stdout); the Wails
// surface lives in the parent package's wallet_genesis_service.go.
//
// HARD INVARIANTS (see IMPLEMENTATION-PLAN_cold-wallet-genesis.md §5):
//   - The Wallet_Memory created here is a non-escaping local: it is never
//     stored in any app-global, never has SetOnlineMode/Connect/SetDaemonAddress
//     called on it, and is Close()'d before the caller returns. The offline
//     guarantee rests on this non-escape, not on SetOfflineMode() (a no-op flag).
//   - The caller (the *App wrapper) MUST refuse to invoke any of these functions
//     while the app is in simulator mode — a stale state corrupts both the
//     deto1/dero1 address rendering and (on the disk-persist path) the KDF.
package genesis

import (
	"fmt"

	"github.com/deroproject/derohe/walletapi"
	"github.com/deroproject/derohe/walletapi/mnemonics"
)

// Network is HOLOGRAM's binary network model (mirrors nodeManager: mainnet or
// simulator; there is no separate testnet NetworkMode). The bool the derohe
// walletapi wants is Mainnet == (Network != simulator).
type Network string

const (
	NetworkMainnet   Network = "mainnet"
	NetworkSimulator Network = "simulator"
)

// mainnet reports the boolean derohe's SetNetwork / address rendering expects.
// Simulator addresses render with the testnet (deto1) HRP.
func (n Network) mainnet() bool { return n != NetworkSimulator }

// ColdWallet is the result of generating a cold wallet, in-memory only. It holds
// the secret seed; treat it as the most sensitive value in the app. RawTx is the
// hex registration transaction (empty until MineRegistration runs).
type ColdWallet struct {
	Address     string
	Seed        string
	SelfCheckOK bool
	RawTx       string // hex registration TX; "" until registration is mined
}

// Generate creates a fresh random wallet entirely in memory and verifies that
// its seed re-derives its address via the official recovery path. It performs
// NO network or daemon I/O and NO disk I/O. The returned ColdWallet carries the
// plaintext seed; the caller owns its lifecycle.
//
// languageID indexes mnemonics.Languages (the seed wordlist language).
//
// The wallet handle is closed before return — Generate intentionally does not
// expose a live *Wallet_Memory, to keep the non-escape invariant trivially true
// for the keygen+self-check path. Registration (which needs the live keys) is a
// separate call, MineRegistration, that manages its own short-lived handle.
func Generate(network Network, languageID int) (*ColdWallet, error) {
	if languageID < 0 || languageID >= len(mnemonics.Languages) {
		return nil, fmt.Errorf("invalid seed language id %d", languageID)
	}
	lang := mnemonics.Languages[languageID]

	w, err := walletapi.Create_Encrypted_Wallet_Random_Memory("")
	if err != nil {
		return nil, fmt.Errorf("generate random wallet: %w", err)
	}
	// Defensive: never let this handle go online, always release it.
	w.SetOfflineMode()
	defer w.Close_Encrypted_Wallet()

	w.SetNetwork(network.mainnet())

	address := w.GetAddress().String()
	seed := w.GetSeedinLanguage(lang.Name)

	if err := verifySeedMatchesAddress(seed, address, network.mainnet()); err != nil {
		// Self-check failure: return nothing usable. This should be impossible;
		// it indicates a derohe-level keygen/mnemonic defect.
		return nil, fmt.Errorf("seed↔address self-check FAILED: %w", err)
	}

	return &ColdWallet{
		Address:     address,
		Seed:        seed,
		SelfCheckOK: true,
	}, nil
}

// verifySeedMatchesAddress re-derives the address from the seed using the
// official recovery path (the same one dero-wallet-cli uses) and compares it.
// The recovery derivation (Words_To_Key) is genuinely independent from the
// generation path (Key_To_Words), so a mnemonic encode/decode defect is caught.
func verifySeedMatchesAddress(seed, expected string, mainnet bool) error {
	account, err := walletapi.Generate_Account_From_Recovery_Words(seed)
	if err != nil {
		return fmt.Errorf("seed did not parse: %w", err)
	}
	addr := account.GetAddress()
	// Account.GetAddress() returns Mainnet=false (zero value); set it explicitly
	// for THIS network before stringifying, or a correct testnet/simulator
	// wallet would falsely mismatch a mainnet-rendered address (review G3).
	addr.Mainnet = mainnet
	if got := addr.String(); got != expected {
		return fmt.Errorf("re-derived %s != %s", got, expected)
	}
	return nil
}
