package genesis

// Registration proof-of-work — the offline mine that makes a fresh address
// fundable on-chain. A REGISTRATION tx is a self-contained Schnorr signature
// over the public key (no height/ring/balance), so it is built entirely from
// local keys with zero chain state — the one cold operation DERO-HE allows.
//
// ALGORITHM LINEAGE (DERO Research License v1.1.2, non-commercial):
//   Slixe (original) → mmarcel/8lecramm (the increment-optimized nonce search:
//   increment tmpsecret by 1 and tmppoint by G each attempt instead of
//   re-randomizing) → Dirtybird99 (the non-blocking channel send that stops the
//   loser goroutines leaking). This is Dirtybird's version with cancel + a
//   progress counter + an IsRegistrationValid gate folded in.
//
// The increment optimization is sound because exactly one registration is ever
// published per wallet, so no two emitted signatures share a nonce (verified).

import (
	"encoding/hex"
	"fmt"
	"math/big"
	goruntime "runtime"
	"sync"
	"sync/atomic"

	"github.com/deroproject/derohe/cryptography/bn256"
	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/transaction"
	"github.com/deroproject/derohe/walletapi"
)

// MineRegistrationFromSeed re-derives the wallet from its seed and mines a
// registration for it, then releases the handle. This is the entry point the
// *App wrapper uses: GenerateColdWallet does not keep a live wallet around (the
// non-escape invariant), so registration re-derives a short-lived local from the
// seed the caller already holds. network selects mainnet vs simulator rendering;
// it does NOT change PoW difficulty (the 24-bit target is fixed).
func MineRegistrationFromSeed(
	seed string,
	network Network,
	cancel <-chan struct{},
	onProgress func(attempts uint64),
) (string, error) {
	account, err := walletapi.Generate_Account_From_Recovery_Words(seed)
	if err != nil {
		return "", fmt.Errorf("seed did not parse: %w", err)
	}
	// Rebuild a short-lived in-memory wallet from the recovered secret scalar
	// (Keys.Secret is a *crypto.BNRed, which is exactly what the ctor wants).
	w, err := walletapi.Create_Encrypted_Wallet_Memory("", account.Keys.Secret)
	if err != nil {
		return "", fmt.Errorf("open in-memory wallet: %w", err)
	}
	w.SetOfflineMode()
	defer w.Close_Encrypted_Wallet()
	w.SetNetwork(network.mainnet())

	return MineRegistration(w, cancel, onProgress)
}

// MineRegistration mines a valid 24-bit registration TX for w across all cores
// and returns it hex-encoded. It does NOT broadcast — the hex is for offline
// transport (QR / paper / DCSP blob).
//
//   - cancel: closing or sending on this channel aborts the search; returns
//     ("", nil) — a cancelled mine is not an error and leaks no secret.
//   - onProgress: called (possibly nil) with the running attempt count so the
//     caller can stream UI progress. It is invoked from worker goroutines; keep
//     it cheap and non-blocking.
//
// The result is gated by derohe's own IsRegistrationValid() before return, so a
// malformed tx never escapes as "valid".
func MineRegistration(
	w *walletapi.Wallet_Memory,
	cancel <-chan struct{},
	onProgress func(attempts uint64),
) (string, error) {
	found := make(chan *transaction.Transaction, 1)
	var attempts uint64
	var wg sync.WaitGroup

	workers := goruntime.GOMAXPROCS(0)
	if workers < 1 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mineWorker(w, found, cancel, &attempts, onProgress)
		}()
	}

	select {
	case tx := <-found:
		// Gate on derohe's own check before trusting the result.
		if tx.TransactionType != transaction.REGISTRATION || !tx.IsRegistrationValid() {
			return "", fmt.Errorf("produced registration TX failed IsRegistrationValid()")
		}
		return hex.EncodeToString(tx.Serialize()), nil
	case <-cancel:
		return "", nil
	}
}

// mineWorker runs the increment-optimized nonce search until it finds a tx whose
// hash has 3 leading zero bytes (the 24-bit target), cancel fires, or another
// worker wins. Lifted from the Dirtybird/mmarcel coldwallet GetRegistrationTX.
func mineWorker(
	w *walletapi.Wallet_Memory,
	found chan<- *transaction.Transaction,
	cancel <-chan struct{},
	attempts *uint64,
	onProgress func(uint64),
) {
	var tx transaction.Transaction
	tx.Version = 1
	tx.TransactionType = transaction.REGISTRATION
	add := w.GetAddress().PublicKey.EncodeCompressed()
	copy(tx.MinerAddress[:], add[:])

	var tmppoint bn256.G1
	tmpsecret := crypto.RandomScalar()
	tmppoint.ScalarMult(crypto.G, tmpsecret)

	pub := w.Get_Keys().Public.G1().String()
	secret := w.Get_Keys().Secret.BigInt()

	for {
		// Bail promptly if cancelled or another worker already won.
		select {
		case <-cancel:
			return
		default:
		}

		serialize := []byte(fmt.Sprintf("%s%s", pub, tmppoint.String()))
		c := crypto.ReducedHash(serialize)
		s := new(big.Int).Mul(c, secret)
		s = s.Mod(s, bn256.Order)
		s = s.Add(s, tmpsecret)
		s = s.Mod(s, bn256.Order)

		crypto.FillBytes(c, tx.C[:])
		crypto.FillBytes(s, tx.S[:])

		n := atomic.AddUint64(attempts, 1)
		if onProgress != nil && n%10000 == 0 {
			onProgress(n)
		}

		hash := tx.GetHash()
		if hash[0] == 0 && hash[1] == 0 && hash[2] == 0 {
			// Non-blocking send: the first worker delivers; the rest fall through
			// to default and return cleanly instead of blocking forever
			// (Dirtybird's fix to mmarcel's bare send).
			select {
			case found <- &tx:
			default:
			}
			return
		}
		tmpsecret.Add(tmpsecret, big.NewInt(1))
		tmppoint.Add(&tmppoint, crypto.G)
	}
}
