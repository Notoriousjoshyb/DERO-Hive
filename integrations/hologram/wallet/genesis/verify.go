package genesis

// Independent verification of a cold wallet — the trust check a user runs to
// confirm, offline, that:
//   1. the seed actually controls the displayed address (no silent fund loss),
//   2. (optionally) the registration TX is cryptographically valid AND binds to
//      this wallet's public key — provable offline, no broadcast.
//
// Ported from the coldwallet fork's cmd/verify, with the [G3] fix: the fork
// hardcoded addr.Mainnet=true, which falsely mismatches a testnet/simulator
// wallet. Here the network is threaded through explicitly.

import (
	"bytes"
	"encoding/hex"
	"fmt"

	"github.com/deroproject/derohe/transaction"
	"github.com/deroproject/derohe/walletapi"
)

// VerifyResult reports each independent check. AddressMatch is the load-bearing
// one (fund-safety); the registration fields are populated only when a
// registration hex is supplied.
type VerifyResult struct {
	AddressMatch      bool
	RegistrationValid bool // the Schnorr signature is valid
	BindsToKey        bool // MinerAddress == this wallet's pubkey
	HasRegistration   bool // a registration hex was supplied and parsed
}

// Verify re-derives the address from the seed (via the official recovery path)
// and compares it to expected; if registrationHex is non-empty it also validates
// the registration offline and confirms it binds to the wallet's key. It returns
// a structured result plus an error only for unparseable inputs (a failed CHECK
// is reported in the result, not as an error).
func Verify(seed, expected string, network Network, registrationHex string) (VerifyResult, error) {
	var res VerifyResult

	account, err := walletapi.Generate_Account_From_Recovery_Words(seed)
	if err != nil {
		return res, fmt.Errorf("seed did not parse: %w", err)
	}

	addr := account.GetAddress()
	// [G3] fix: render for the ACTUAL network, not hardcoded mainnet — otherwise
	// a correct testnet/simulator wallet (deto1) would falsely mismatch.
	addr.Mainnet = network.mainnet()
	res.AddressMatch = addr.String() == expected

	if registrationHex == "" {
		return res, nil
	}

	raw, err := hex.DecodeString(registrationHex)
	if err != nil {
		return res, fmt.Errorf("registration hex did not decode: %w", err)
	}
	var tx transaction.Transaction
	if err := tx.Deserialize(raw); err != nil {
		return res, fmt.Errorf("registration did not deserialize: %w", err)
	}
	res.HasRegistration = true

	if tx.TransactionType != transaction.REGISTRATION {
		return res, nil // HasRegistration=true but Valid/Binds stay false
	}
	// binds to THIS wallet's public key
	pub := account.Keys.Public.EncodeCompressed()
	res.BindsToKey = bytes.Equal(tx.MinerAddress[:], pub[:])
	res.RegistrationValid = tx.IsRegistrationValid()

	return res, nil
}
