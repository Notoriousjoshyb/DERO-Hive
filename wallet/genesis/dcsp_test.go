package genesis

// G6 — the DCSP registration message round-trip (the one new wire format).
// Covers: encode→decode round-trip, the QR-v20 size bound (review [M11]: the
// wrapped blob is ~493 bytes, fits v20 not v10), network-mismatch rejection,
// and embedded-tx re-validation.

import (
	"encoding/base64"
	"strings"
	"testing"
)

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

const fixedTS = 1750000000 // fixed timestamp (no clock in the subpackage)

func TestDCSP_RoundTrip(t *testing.T) {
	blob, err := EncodeRegistrationDCSP(NetworkMainnet, fixedTS, testAddr, burnedRegHex)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.HasPrefix(blob, "DCSP:") {
		t.Fatalf("blob missing DCSP: prefix: %.16q", blob)
	}

	msg, err := DecodeDCSP(blob)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if msg.Dcsp != 1 || msg.Type != "registration" {
		t.Fatalf("unexpected header: dcsp=%d type=%q", msg.Dcsp, msg.Type)
	}
	if msg.Network != "mainnet" || msg.Address != testAddr || msg.RawTx != burnedRegHex {
		t.Fatalf("field mismatch: %+v", msg)
	}
	if msg.Created != fixedTS {
		t.Fatalf("created = %d, want %d", msg.Created, fixedTS)
	}
}

// [M11] the wrapped blob must fit QR v20 (~858 B), and must NOT be small enough
// to imply the false "v10" claim. Pin both bounds so a future field addition
// that blows the QR budget fails loudly.
func TestDCSP_WrappedBlobFitsQRv20(t *testing.T) {
	blob, err := EncodeRegistrationDCSP(NetworkMainnet, fixedTS, testAddr, burnedRegHex)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	const qrV10Max = 271
	const qrV20Max = 858
	if len(blob) <= qrV10Max {
		t.Fatalf("blob is %d bytes — unexpectedly small; the v10 claim was supposed to be false", len(blob))
	}
	if len(blob) > qrV20Max {
		t.Fatalf("blob is %d bytes — exceeds QR v20 (%d); transport assumption broken", len(blob), qrV20Max)
	}
	t.Logf("wrapped DCSP registration blob = %d bytes (fits QR v20)", len(blob))
}

func TestDCSP_Decode_RejectsBadInput(t *testing.T) {
	cases := map[string]string{
		"no prefix":      "eyJkY3NwIjoxfQ==",
		"bad base64":     "DCSP:!!!not-base64!!!",
		"bad json":       "DCSP:" + b64("{not json"),
		"wrong version":  "DCSP:" + b64(`{"dcsp":2,"type":"registration"}`),
		"wrong type":     "DCSP:" + b64(`{"dcsp":1,"type":"unsigned"}`),
	}
	for name, blob := range cases {
		if _, err := DecodeDCSP(blob); err == nil {
			t.Errorf("%s: expected decode error, got nil", name)
		}
	}
}

func TestDCSP_ValidateForBroadcast(t *testing.T) {
	msg, err := DecodeDCSP(mustEncode(t, NetworkMainnet, testAddr, burnedRegHex))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	// network match + valid tx → ok, returns the tx.
	tx, err := ValidateForBroadcast(msg, NetworkMainnet)
	if err != nil {
		t.Fatalf("validate (matching network): %v", err)
	}
	if tx == nil || !tx.IsRegistrationValid() {
		t.Fatal("expected a valid registration tx back")
	}

	// network MISMATCH → rejected (the real safety gate).
	if _, err := ValidateForBroadcast(msg, NetworkSimulator); err == nil {
		t.Fatal("expected network-mismatch rejection (mainnet blob vs simulator wallet)")
	}
}

func TestDCSP_ValidateForBroadcast_RejectsForeignTx(t *testing.T) {
	// a blob whose raw_tx is not a valid registration must be rejected even if
	// the network matches. Corrupt one hex byte of the registration.
	bad := "ff" + burnedRegHex[2:]
	msg, err := DecodeDCSP(mustEncode(t, NetworkMainnet, testAddr, bad))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, err := ValidateForBroadcast(msg, NetworkMainnet); err == nil {
		t.Fatal("expected rejection of an invalid/corrupted registration tx")
	}
}

// helpers
func mustEncode(t *testing.T, n Network, addr, rawTx string) string {
	t.Helper()
	blob, err := EncodeRegistrationDCSP(n, fixedTS, addr, rawTx)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return blob
}
