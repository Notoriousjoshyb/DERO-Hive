// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Regression tests for the native-DERO burn guard.

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/rpc"
)

// TestDetectDestructiveBurn locks in the rule that a burn on the zero SCID (native DERO)
// with no smart contract attached is treated as destructive and blocked. This guards the
// generic XSWD "transfer" path: a dApp/caller sending a deposit-style burn without the
// SCID + sc_rpc that would route it to a contract must NOT be able to silently destroy
// native DERO. If a future edit removes the guard or weakens the zero-SCID check, the
// "native burn, no SC" case below will start returning destructive=false and fail.
func TestDetectDestructiveBurn(t *testing.T) {
	tokenSCID := crypto.HashHexToHash("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90")

	cases := []struct {
		name        string
		transfers   []rpc.Transfer
		hasSCCall   bool
		wantBurn    uint64
		wantBlocked bool
	}{
		{
			name:        "native burn, no SC -> blocked (the incident)",
			transfers:   []rpc.Transfer{{Burn: 1500000000, SCID: crypto.ZEROHASH}},
			hasSCCall:   false,
			wantBurn:    1500000000,
			wantBlocked: true,
		},
		{
			name:        "native burn WITH SC call -> allowed (deposit/donation)",
			transfers:   []rpc.Transfer{{Burn: 1500000000, SCID: crypto.ZEROHASH}},
			hasSCCall:   true,
			wantBlocked: false,
		},
		{
			name:        "token burn (non-zero SCID) -> allowed (normal token transfer)",
			transfers:   []rpc.Transfer{{Burn: 1000, SCID: tokenSCID}},
			hasSCCall:   false,
			wantBlocked: false,
		},
		{
			name:        "plain native send, no burn -> allowed",
			transfers:   []rpc.Transfer{{Amount: 100000, Destination: "dero1...", SCID: crypto.ZEROHASH}},
			hasSCCall:   false,
			wantBlocked: false,
		},
		{
			name:        "mixed: safe token transfer + destructive native burn -> blocked",
			transfers:   []rpc.Transfer{{Burn: 1000, SCID: tokenSCID}, {Burn: 50000, SCID: crypto.ZEROHASH}},
			hasSCCall:   false,
			wantBurn:    50000,
			wantBlocked: true,
		},
		{
			name:        "no transfers -> allowed",
			transfers:   nil,
			hasSCCall:   false,
			wantBlocked: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotBurn, gotBlocked := detectDestructiveBurn(tc.transfers, tc.hasSCCall)
			if gotBlocked != tc.wantBlocked {
				t.Fatalf("blocked = %v, want %v", gotBlocked, tc.wantBlocked)
			}
			if tc.wantBlocked && gotBurn != tc.wantBurn {
				t.Errorf("burn amount = %d, want %d", gotBurn, tc.wantBurn)
			}
		})
	}
}

// TestShouldBlockBurn locks in the destruction POLICY: a destructive native-DERO burn (zero
// SCID, no contract) is ALWAYS blocked, with no override. HOLOGRAM never burns DERO. The block
// must apply only to the destructive case -- it must never affect a normal transfer or a
// contract deposit. This is the exact decision that would have stopped the incident. If anyone
// ever reintroduces an override path, the "always blocked" cases below will fail.
func TestShouldBlockBurn(t *testing.T) {
	tokenSCID := crypto.HashHexToHash("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90")

	cases := []struct {
		name        string
		transfers   []rpc.Transfer
		hasSCCall   bool
		wantBurn    uint64
		wantBlocked bool
	}{
		{
			name:        "destructive native burn -> ALWAYS blocked (the incident)",
			transfers:   []rpc.Transfer{{Burn: 1500000000, SCID: crypto.ZEROHASH}},
			wantBurn:    1500000000,
			wantBlocked: true,
		},
		{
			name:        "small destructive native burn -> ALWAYS blocked (no override)",
			transfers:   []rpc.Transfer{{Burn: 1, SCID: crypto.ZEROHASH}},
			wantBurn:    1,
			wantBlocked: true,
		},
		{
			name:        "contract deposit burn -> allowed (deposit, not destruction)",
			transfers:   []rpc.Transfer{{Burn: 5, SCID: crypto.ZEROHASH}},
			hasSCCall:   true,
			wantBlocked: false,
		},
		{
			name:        "token transfer (non-zero SCID) -> allowed (normal token transfer)",
			transfers:   []rpc.Transfer{{Burn: 1000, SCID: tokenSCID}},
			wantBlocked: false,
		},
		{
			name:        "plain native send, no burn -> allowed",
			transfers:   []rpc.Transfer{{Amount: 100000, SCID: crypto.ZEROHASH}},
			wantBlocked: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotBurn, gotBlocked := shouldBlockBurn(tc.transfers, tc.hasSCCall)
			if gotBlocked != tc.wantBlocked {
				t.Fatalf("blocked = %v, want %v", gotBlocked, tc.wantBlocked)
			}
			if tc.wantBlocked && gotBurn != tc.wantBurn {
				t.Errorf("burn amount = %d, want %d", gotBurn, tc.wantBurn)
			}
		})
	}
}

// TestTransferTokenCannotBurnNativeDero reproduces the v1.0.6 incident at the source level:
// native DERO sent through the token path (TransferToken) with the exact incident signature
// -- native SCID, 1,500,000,000 atomic (15000 DERO), the user-selected ring size of 128 --
// destroyed the coins because TransferToken built Burn:amount on the zero SCID. This test
// exercises the SAME production constructor TransferToken now uses (buildTokenTransfer), so
// it tests real code, not a re-implementation, and proves two things:
//  1. the corrected constructor emits a NON-destructive transfer (Amount-credited, Burn 0),
//     so shouldBlockBurn would NOT trip on a normal send;
//  2. the guard wired into TransferToken catches the destructive shape -- had the old
//     Burn:amount construction survived, shouldBlockBurn would have blocked it.
// If anyone reverts buildTokenTransfer to Burn:amount, assertion (1) fails loudly.
func TestTransferTokenCannotBurnNativeDero(t *testing.T) {
	const nativeSCID = "0000000000000000000000000000000000000000000000000000000000000000"
	const incidentAmount = uint64(1500000000) // 15000.00000 DERO, the exact burned amount
	const incidentRing = uint64(128)          // user-selected ring size in the incident
	_ = incidentRing                          // ring size is irrelevant to burn classification; pinned for provenance

	dest := "dero1qy976ssakhfynpd4lnh39u7gw9spfzr9z55ckfd0yhrhsdr235glgqq28xlvm"

	// (1) The real constructor TransferToken uses, with the incident's native SCID + amount.
	transfers := buildTokenTransfer(nativeSCID, dest, incidentAmount)
	if _, block := shouldBlockBurn(transfers, false); block {
		t.Fatalf("buildTokenTransfer produced a destructive native-DERO transfer for a normal send -- it must credit Amount with Burn 0, not burn")
	}
	if got := transfers[0].Burn; got != 0 {
		t.Fatalf("buildTokenTransfer set Burn=%d on a token send; must be 0 (the v1.0.6 incident was Burn:amount)", got)
	}
	if got := transfers[0].Amount; got != incidentAmount {
		t.Fatalf("buildTokenTransfer set Amount=%d; the recipient must be credited the full %d", got, incidentAmount)
	}

	// (2) Counterfactual: the exact v1.0.6 destructive construction (Burn:amount on zero SCID)
	// MUST be classified as a block, proving the guard wired into TransferToken covers it.
	v106Destructive := []rpc.Transfer{{Destination: dest, Amount: 0, Burn: incidentAmount, SCID: crypto.ZEROHASH}}
	burnAmt, block := shouldBlockBurn(v106Destructive, false)
	if !block {
		t.Fatalf("the v1.0.6 destructive shape (Burn=%d on zero SCID) was NOT blocked -- the TransferToken guard would not have stopped the incident", incidentAmount)
	}
	if burnAmt != incidentAmount {
		t.Errorf("blocked burn amount = %d, want %d", burnAmt, incidentAmount)
	}
}

// TestNoBurnOverrideReintroduced is a source-level sentinel that fails the build if anyone
// reintroduces a way to bypass the burn prohibition. HOLOGRAM must never burn DERO: there is
// no confirmDestroy flag, no override parameter, no approve path for a destructive burn. If a
// future change brings any of that back, this test fails loudly instead of silently shipping a
// path that can destroy a user's coins. To deliberately burn DERO, users must use the CLI.
func TestNoBurnOverrideReintroduced(t *testing.T) {
	// Scan the Go and frontend sources for tokens that only exist when an override is present.
	roots := []string{".", "frontend/src"}
	banned := []string{"confirmDestroy", "ConfirmDestroy"}

	skipDir := func(name string) bool {
		switch name {
		case "node_modules", "dist", ".git", ".task", "build", "bin":
			return true
		}
		return false
	}

	var offenders []string
	for _, root := range roots {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				if skipDir(info.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			switch filepath.Ext(path) {
			case ".go", ".svelte", ".js", ".ts":
			default:
				return nil
			}
			// This sentinel test file legitimately names the banned tokens; skip it.
			if filepath.Base(path) == "burn_guard_test.go" {
				return nil
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			for _, tok := range banned {
				if strings.Contains(string(data), tok) {
					offenders = append(offenders, fmt.Sprintf("%s contains %q", path, tok))
				}
			}
			return nil
		})
	}

	if len(offenders) > 0 {
		t.Fatalf("burn-override token reintroduced (HOLOGRAM must never burn DERO):\n  %s",
			strings.Join(offenders, "\n  "))
	}
}
