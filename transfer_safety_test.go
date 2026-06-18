// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Regression tests for irreversible-action footguns on the send surface:
//   1. formatDEROAmount must use the correct atomic divisor (1e5), so the figure
//      a user reads before approving a send is not understated.
//   2. The send path must reject a destination whose network byte does not match
//      the active network — a wrong-network paste is an irreversible mis-send.
//   3. An integrated-address invoice (deroi…) must be reconciled — an expired
//      address or a wrong amount is rejected, never paid silently.

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/deroproject/derohe/rpc"
)

// a real, valid mainnet address used as a known-good base for building integrated
// addresses in tests (same vector the burn-guard tests reuse).
const testBaseMainnetAddr = "dero1qy976ssakhfynpd4lnh39u7gw9spfzr9z55ckfd0yhrhsdr235glgqq28xlvm"

// integratedAddr clones the known-good base address and attaches the given invoice
// arguments, returning the parsed integrated *rpc.Address.
func integratedAddr(t *testing.T, args rpc.Arguments) *rpc.Address {
	t.Helper()
	base, err := rpc.NewAddress(testBaseMainnetAddr)
	if err != nil {
		t.Fatalf("parse base address: %v", err)
	}
	ia := base.Clone()
	ia.Arguments = args
	if _, err := ia.MarshalText(); err != nil {
		t.Fatalf("encode integrated address: %v", err)
	}
	return &ia
}

// TestCheckIntegratedInvoice locks in the reconciliation of a deroi… invoice: an
// expired address and an amount that does not match the requested amount must be
// rejected (non-empty error), while a satisfied invoice and a plain (non-integrated)
// address must pass (empty error). A regression here re-opens silent mis-payment.
func TestCheckIntegratedInvoice(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	t.Run("plain address -> ok", func(t *testing.T) {
		addr, _ := rpc.NewAddress(testBaseMainnetAddr)
		if msg := checkIntegratedInvoice(addr, 12345, now); msg != "" {
			t.Fatalf("plain address should pass, got %q", msg)
		}
	})

	t.Run("nil address -> ok", func(t *testing.T) {
		if msg := checkIntegratedInvoice(nil, 12345, now); msg != "" {
			t.Fatalf("nil address should pass, got %q", msg)
		}
	})

	t.Run("requested amount matches -> ok", func(t *testing.T) {
		addr := integratedAddr(t, rpc.Arguments{
			{Name: rpc.RPC_VALUE_TRANSFER, DataType: rpc.DataUint64, Value: uint64(500000)},
		})
		if msg := checkIntegratedInvoice(addr, 500000, now); msg != "" {
			t.Fatalf("matching amount should pass, got %q", msg)
		}
	})

	t.Run("requested amount mismatch -> blocked", func(t *testing.T) {
		addr := integratedAddr(t, rpc.Arguments{
			{Name: rpc.RPC_VALUE_TRANSFER, DataType: rpc.DataUint64, Value: uint64(500000)},
		})
		if msg := checkIntegratedInvoice(addr, 400000, now); msg == "" {
			t.Fatal("amount mismatch must be blocked, got pass")
		}
	})

	t.Run("expired -> blocked", func(t *testing.T) {
		addr := integratedAddr(t, rpc.Arguments{
			{Name: rpc.RPC_EXPIRY, DataType: rpc.DataTime, Value: past},
		})
		if msg := checkIntegratedInvoice(addr, 12345, now); msg == "" {
			t.Fatal("expired address must be blocked, got pass")
		}
	})

	t.Run("not yet expired -> ok", func(t *testing.T) {
		addr := integratedAddr(t, rpc.Arguments{
			{Name: rpc.RPC_EXPIRY, DataType: rpc.DataTime, Value: future},
		})
		if msg := checkIntegratedInvoice(addr, 12345, now); msg != "" {
			t.Fatalf("unexpired address should pass, got %q", msg)
		}
	})

	t.Run("expiry checked before amount", func(t *testing.T) {
		// An expired invoice with a matching amount must still block on expiry.
		addr := integratedAddr(t, rpc.Arguments{
			{Name: rpc.RPC_EXPIRY, DataType: rpc.DataTime, Value: past},
			{Name: rpc.RPC_VALUE_TRANSFER, DataType: rpc.DataUint64, Value: uint64(500000)},
		})
		if msg := checkIntegratedInvoice(addr, 500000, now); msg == "" {
			t.Fatal("expired-but-matching invoice must be blocked")
		}
	})
}

// TestFormatDEROAmountUsesAtomicDivisor locks DERO's 5-decimal scale (1 DERO = 100000
// atomic units) into formatDEROAmount. A wrong divisor understates every figure on the
// send/approval/gas surface, mis-anchoring consent on an irreversible action. If anyone
// reverts the divisor (the shipped v1.0.7 code divided by 1e12, understating by 1e7),
// these assertions fail the build.
func TestFormatDEROAmountUsesAtomicDivisor(t *testing.T) {
	cases := []struct {
		name   string
		atomic uint64
		want   string
	}{
		{"one DERO", 100000, "1.00000"},
		{"half DERO", 50000, "0.50000"},
		{"smallest unit", 1, "0.00001"},
		{"zero", 0, "0.00000"},
		{"15000 DERO (the incident amount)", 1500000000, "15.00K"},
		{"two DERO", 200000, "2.00000"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := formatDEROAmount(c.atomic); got != c.want {
				t.Fatalf("formatDEROAmount(%d) = %q, want %q", c.atomic, got, c.want)
			}
		})
	}
}

// TestNoWrongAtomicDivisorReintroduced is a source-level sentinel: the "/ 1e12" divisor
// (the v1.0.7 formatDEROAmount bug) must never come back. DERO is 5-decimal; every
// money-formatting site divides by 1e5/100000. If a future edit reintroduces "/ 1e12"
// anywhere in the Go sources, this fails the build loudly instead of silently shipping a
// 10,000,000x-wrong figure on the approval surface.
func TestNoWrongAtomicDivisorReintroduced(t *testing.T) {
	banned := []string{"/ 1e12", "/1e12"}

	skipDir := func(name string) bool {
		switch name {
		case "node_modules", "dist", ".git", ".task", "build", "bin", "tela-cli", "datashards":
			return true
		}
		return false
	}

	var offenders []string
	_ = filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if skipDir(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" {
			return nil
		}
		// This sentinel test file legitimately names the banned token; skip it.
		if filepath.Base(path) == "transfer_safety_test.go" {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		for _, tok := range banned {
			if strings.Contains(string(data), tok) {
				offenders = append(offenders, path+" contains "+tok)
			}
		}
		return nil
	})

	if len(offenders) > 0 {
		t.Fatalf("wrong atomic divisor reintroduced (DERO is 5-decimal; use 1e5/100000):\n  %s",
			strings.Join(offenders, "\n  "))
	}
}

// TestTransferRejectsNetworkMismatchSentinel is a source-level sentinel that fails the
// build if the destination network-byte check is removed from the Transfer send path.
// The DERO library rejects an unparseable address but does NOT compare the address
// network byte against the wallet's network — a wrong-network (deto1 on mainnet) paste
// would otherwise build and send silently, irreversibly. The guard lives in Transfer()
// in wallet.go and must keep comparing addr.IsMainnet() to the active network.
func TestTransferRejectsNetworkMismatchSentinel(t *testing.T) {
	data, err := os.ReadFile("wallet.go")
	if err != nil {
		t.Fatalf("read wallet.go: %v", err)
	}
	src := string(data)

	// The guard parses the destination and compares its network to the wallet's.
	// Both halves must be present in the send path; if either is dropped, fail.
	required := []string{
		"rpc.NewAddress(destination)",
		"addr.IsMainnet() != walletIsMainnet",
	}
	var missing []string
	for _, r := range required {
		if !strings.Contains(src, r) {
			missing = append(missing, r)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("Transfer() destination network-mismatch guard weakened or removed; missing:\n  %s\n"+
			"A wrong-network destination paste is an irreversible mis-send — restore the network-byte check in Transfer().",
			strings.Join(missing, "\n  "))
	}
}

// TestTransferReconcilesIntegratedInvoiceSentinel is a source-level sentinel that fails
// the build if Transfer() stops reconciling an integrated-address invoice. Ignoring the
// embedded RPC_VALUE_TRANSFER / RPC_EXPIRY (the original "for now, log it" stub) lets a
// user pay the wrong amount or an expired invoice — an irreversible mis-payment.
func TestTransferReconcilesIntegratedInvoiceSentinel(t *testing.T) {
	data, err := os.ReadFile("wallet.go")
	if err != nil {
		t.Fatalf("read wallet.go: %v", err)
	}
	src := string(data)
	if !strings.Contains(src, "checkIntegratedInvoice(addr,") {
		t.Fatal("Transfer() no longer calls checkIntegratedInvoice — integrated-address invoice " +
			"reconciliation removed. An expired or wrong-amount invoice would be paid silently; " +
			"restore the call in Transfer().")
	}
}
