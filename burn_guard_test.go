// Copyright 2025 HOLOGRAM Project. All rights reserved.
// Regression tests for the native-DERO burn guard.

package main

import (
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

// TestShouldBlockBurn locks in the destruction POLICY: a destructive native-DERO burn is
// blocked UNLESS the user explicitly confirmed it. The confirmDestroy flag must only matter
// when the burn is genuinely destructive -- it must never weaken a normal transfer or a
// contract deposit. This is the exact decision that would have stopped the incident, plus
// the deliberate-burn override.
func TestShouldBlockBurn(t *testing.T) {
	tokenSCID := crypto.HashHexToHash("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90")

	cases := []struct {
		name           string
		transfers      []rpc.Transfer
		hasSCCall      bool
		confirmDestroy bool
		wantBurn       uint64
		wantBlocked    bool
	}{
		{
			name:           "destructive burn, NOT confirmed -> blocked (the incident)",
			transfers:      []rpc.Transfer{{Burn: 1500000000, SCID: crypto.ZEROHASH}},
			confirmDestroy: false,
			wantBurn:       1500000000,
			wantBlocked:    true,
		},
		{
			name:           "destructive burn, confirmed -> allowed (deliberate burn)",
			transfers:      []rpc.Transfer{{Burn: 1500000000, SCID: crypto.ZEROHASH}},
			confirmDestroy: true,
			wantBlocked:    false,
		},
		{
			name:           "contract deposit burn, confirm flag set -> still allowed, flag is a no-op",
			transfers:      []rpc.Transfer{{Burn: 5, SCID: crypto.ZEROHASH}},
			hasSCCall:      true,
			confirmDestroy: true,
			wantBlocked:    false,
		},
		{
			name:           "token transfer (non-zero SCID), confirm flag set -> allowed, flag is a no-op",
			transfers:      []rpc.Transfer{{Burn: 1000, SCID: tokenSCID}},
			confirmDestroy: true,
			wantBlocked:    false,
		},
		{
			name:           "token transfer, no confirm -> allowed (normal token transfer)",
			transfers:      []rpc.Transfer{{Burn: 1000, SCID: tokenSCID}},
			confirmDestroy: false,
			wantBlocked:    false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotBurn, gotBlocked := shouldBlockBurn(tc.transfers, tc.hasSCCall, tc.confirmDestroy)
			if gotBlocked != tc.wantBlocked {
				t.Fatalf("blocked = %v, want %v", gotBlocked, tc.wantBlocked)
			}
			if tc.wantBlocked && gotBurn != tc.wantBurn {
				t.Errorf("burn amount = %d, want %d", gotBurn, tc.wantBurn)
			}
		})
	}
}
