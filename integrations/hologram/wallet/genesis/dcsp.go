package genesis

// DCSP registration message codec — the cold→hot transport for an offline
// registration TX. The cold side emits a self-describing blob; the hot side
// parses, validates, and broadcasts it via sendrawtransaction.
//
// This is the ONE wire format the cold-wallet feature adds. The full DCSP
// unsigned→sign→broadcast flow is architecturally unsolved on DERO-HE (see
// DERO-COLD-SIGNING-PROTOCOL.md "Architectural reality"); registration is the
// only air-gappable transaction, which is why it is the only DCSP message type
// implemented here.
//
// Transport encoding (per the DCSP spec): minify JSON → base64 → "DCSP:" prefix.
// The wrapped registration blob is ~493 bytes, which fits a single QR v20.

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/deroproject/derohe/transaction"
)

// dcspPrefix identifies a DCSP transport blob.
const dcspPrefix = "DCSP:"

// dcspVersion is the current protocol version.
const dcspVersion = 1

// RegistrationMsg is the DCSP {type:"registration"} message. The cold side fills
// it from a generated wallet; the hot side reconstructs it from a scanned blob.
type RegistrationMsg struct {
	Dcsp    int    `json:"dcsp"`    // protocol version (currently 1)
	Type    string `json:"type"`    // always "registration"
	Network string `json:"network"` // "mainnet" | "testnet" | "simulator"
	Created int64  `json:"created"` // unix timestamp (caller-supplied; no clock here)
	Address string `json:"address"` // the address being registered
	RawTx   string `json:"raw_tx"`  // hex-encoded serialized REGISTRATION tx
}

// EncodeRegistrationDCSP builds a transport blob ("DCSP:<base64-minified-json>")
// from the message fields. created is caller-supplied (the subpackage takes no
// clock dependency); pass the genesis timestamp.
func EncodeRegistrationDCSP(network Network, created int64, address, rawTxHex string) (string, error) {
	msg := RegistrationMsg{
		Dcsp:    dcspVersion,
		Type:    "registration",
		Network: string(network),
		Created: created,
		Address: address,
		RawTx:   rawTxHex,
	}
	// json.Marshal already minifies (no indentation/whitespace).
	raw, err := json.Marshal(msg)
	if err != nil {
		return "", fmt.Errorf("marshal DCSP registration: %w", err)
	}
	return dcspPrefix + base64.StdEncoding.EncodeToString(raw), nil
}

// DecodeDCSP parses a transport blob back into a RegistrationMsg. It validates
// the prefix, base64, JSON, protocol version, and message type — structural
// checks only. Semantic checks (network match, tx validity) are
// ValidateForBroadcast's job.
func DecodeDCSP(blob string) (RegistrationMsg, error) {
	var msg RegistrationMsg

	blob = strings.TrimSpace(blob)
	if !strings.HasPrefix(blob, dcspPrefix) {
		return msg, fmt.Errorf("not a DCSP blob (missing %q prefix)", dcspPrefix)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(blob, dcspPrefix))
	if err != nil {
		return msg, fmt.Errorf("DCSP base64 decode: %w", err)
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return msg, fmt.Errorf("DCSP json decode: %w", err)
	}
	if msg.Dcsp != dcspVersion {
		return msg, fmt.Errorf("unsupported DCSP version %d (want %d)", msg.Dcsp, dcspVersion)
	}
	if msg.Type != "registration" {
		return msg, fmt.Errorf("unexpected DCSP type %q (want \"registration\")", msg.Type)
	}
	return msg, nil
}

// ValidateForBroadcast checks a decoded message is safe to broadcast on the
// hot wallet's current network: the network field must match, and the embedded
// raw_tx must still be a valid REGISTRATION (defense in depth before
// sendrawtransaction). It returns the deserialized tx on success.
func ValidateForBroadcast(msg RegistrationMsg, hotNetwork Network) (*transaction.Transaction, error) {
	if Network(msg.Network) != hotNetwork {
		return nil, fmt.Errorf("network mismatch: blob is %q, wallet is %q", msg.Network, hotNetwork)
	}
	raw, err := hex.DecodeString(msg.RawTx)
	if err != nil {
		return nil, fmt.Errorf("raw_tx hex decode: %w", err)
	}
	var tx transaction.Transaction
	if err := tx.Deserialize(raw); err != nil {
		return nil, fmt.Errorf("raw_tx deserialize: %w", err)
	}
	if tx.TransactionType != transaction.REGISTRATION {
		return nil, fmt.Errorf("raw_tx is not a REGISTRATION transaction")
	}
	if !tx.IsRegistrationValid() {
		return nil, fmt.Errorf("raw_tx registration signature is invalid")
	}
	return &tx, nil
}
