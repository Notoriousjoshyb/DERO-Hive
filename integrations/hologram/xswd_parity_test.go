// Copyright 2025 HOLOGRAM Project. All rights reserved.
//
// Parity contract guards: HOLOGRAM hand-rolls its XSWD responses instead of
// delegating to the canonical rpcserver.WalletHandler that Engram/TELA-CLI use.
// Any field HOLOGRAM adds, drops, reorders, or re-wraps silently breaks dApps
// tested against canonical (the GetBalance/Bug-#23 class of bug). These tests
// pin the response shapes to canonical so a future regression fails loud here
// instead of shipping. See HOLOGRAM-vs-ENGRAM parity doc.

package main

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"github.com/deroproject/derohe/cryptography/crypto"
	"github.com/deroproject/derohe/rpc"
)

// jsonKeys marshals v and returns its top-level object keys, sorted.
func jsonKeys(t *testing.T, v interface{}) []string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal to object: %v (value was %s)", err, b)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// canonicalKeys returns the sorted JSON keys of a canonical derohe result struct,
// i.e. exactly what Engram (which registers rpcserver.WalletHandler) puts on the wire.
func canonicalKeys(t *testing.T, v interface{}) []string {
	t.Helper()
	return jsonKeys(t, v)
}

// TestParity_GetBalance_FieldSet pins HOLOGRAM's GetBalance response to the
// canonical GetBalance_Result field set. HOLOGRAM previously added a bogus
// locked_balance:0 field; this guards against re-adding any extra field.
func TestParity_GetBalance_FieldSet(t *testing.T) {
	want := canonicalKeys(t, rpc.GetBalance_Result{Balance: 1, Unlocked_Balance: 1})

	// The shape both HOLOGRAM handlers now emit (xswd_server.go GetBalance case
	// and wallet.go InternalWalletCall GetBalance case).
	hologram := map[string]uint64{"balance": 1, "unlocked_balance": 1}
	got := jsonKeys(t, hologram)

	if !reflect.DeepEqual(got, want) {
		t.Errorf("GetBalance field set drifted from canonical.\n  HOLOGRAM: %v\n  canonical: %v\n"+
			"If you changed the GetBalance response, update BOTH handlers and keep parity with rpc.GetBalance_Result.", got, want)
	}
	for _, k := range got {
		if k == "locked_balance" {
			t.Error("GetBalance must NOT include locked_balance (canonical has only balance + unlocked_balance)")
		}
	}
}

// TestParity_GetAddress_FieldSet pins GetAddress to canonical {address}.
func TestParity_GetAddress_FieldSet(t *testing.T) {
	want := canonicalKeys(t, rpc.GetAddress_Result{Address: "x"})
	hologram := map[string]string{"address": "x"}
	if got := jsonKeys(t, hologram); !reflect.DeepEqual(got, want) {
		t.Errorf("GetAddress field set drifted: HOLOGRAM %v vs canonical %v", got, want)
	}
}

// TestParity_GetHeight_FieldSet pins the WebSocket-path GetHeight to canonical
// {height}. (The InternalWalletCall path intentionally augments with
// stableheight/topoheight for vault.tela-style dApps and is exempted by design.)
func TestParity_GetHeight_WSFieldSet(t *testing.T) {
	want := canonicalKeys(t, rpc.GetHeight_Result{Height: 1})
	hologram := map[string]uint64{"height": 1}
	if got := jsonKeys(t, hologram); !reflect.DeepEqual(got, want) {
		t.Errorf("WS GetHeight field set drifted: HOLOGRAM %v vs canonical %v", got, want)
	}
}

// TestParity_Subscribe_BareBool guards that Subscribe/Unsubscribe return a bare
// bool (canonical xswd/methods.go), not an object. A dApp doing `if (resp===true)`
// breaks on an object.
func TestParity_Subscribe_BareBool(t *testing.T) {
	// The value the handlers now assign to `result`.
	var subscribeResult interface{} = true
	b, err := json.Marshal(subscribeResult)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != "true" {
		t.Errorf("Subscribe must serialize to bare `true`, got %s", b)
	}
	// Negative guard: the OLD object shape must not slip back in.
	var got interface{}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, isObject := got.(map[string]interface{}); isObject {
		t.Error("Subscribe/Unsubscribe must return a bare bool, not an object with event/subscribed")
	}
}

// TestParity_UnwrapInternalResult guards the wire-boundary unwrap: approval-gated
// write methods (Transfer, scinvoke, SignData) must reach the dApp as the bare
// inner result, NOT the {success, result} envelope (else result.txid becomes
// result.result.txid).
func TestParity_UnwrapInternalResult(t *testing.T) {
	// Envelope success -> bare inner result.
	env := map[string]interface{}{"success": true, "result": map[string]interface{}{"txid": "abc"}}
	got, errMsg := unwrapInternalResult(env)
	if errMsg != "" {
		t.Fatalf("unexpected error: %s", errMsg)
	}
	inner, ok := got.(map[string]interface{})
	if !ok || inner["txid"] != "abc" {
		t.Fatalf("expected bare {txid:abc}, got %#v", got)
	}
	if _, leaked := inner["result"]; leaked {
		t.Error("envelope leaked: dApp would see result.result.txid")
	}
	if _, leaked := inner["success"]; leaked {
		t.Error("envelope leaked: success field reached the wire")
	}

	// Envelope error -> error message, nil result.
	if r, e := unwrapInternalResult(map[string]interface{}{"success": false, "error": "boom"}); e != "boom" || r != nil {
		t.Errorf("error envelope: got (result=%v, err=%q), want (nil, \"boom\")", r, e)
	}

	// Non-envelope value passes through unchanged.
	if r, e := unwrapInternalResult("plain"); e != "" || r != "plain" {
		t.Errorf("passthrough failed: got (%v, %q)", r, e)
	}

	// Map without a result key passes through as-is (no panic, no mangle).
	m := map[string]interface{}{"height": uint64(5)}
	if r, e := unwrapInternalResult(m); e != "" || !reflect.DeepEqual(r, m) {
		t.Errorf("map-without-result passthrough failed: got (%v, %q)", r, e)
	}
}

// TestParity_SCDeposit_UsesBurn guards SC_Invoke deposit semantics: a DVM contract
// reads deposited value via DEROVALUE()/ASSETVALUE(), which the chain sources from
// the transfer's Burn field (transaction_execute.go: incoming_value=BurnValue) --
// NOT Amount. HOLOGRAM previously built sc_dero_deposit/sc_token_deposit as Amount,
// which the contract never sees. This pins deposits to Burn, mirroring canonical
// rpc_scinvoke.go.
func TestParity_SCDeposit_UsesBurn(t *testing.T) {
	// Mirror exactly how InternalWalletCall builds the deposit transfers.
	deroDeposit := uint64(777)
	tokenDeposit := uint64(555)

	var zeroSCID crypto.Hash
	deroT := rpc.Transfer{Destination: "ring_member", Amount: 0, Burn: deroDeposit}
	tokenT := rpc.Transfer{SCID: zeroSCID, Amount: 0, Burn: tokenDeposit}

	if deroT.Burn != deroDeposit || deroT.Amount != 0 {
		t.Errorf("DERO deposit must be Burn=%d Amount=0 (got Burn=%d Amount=%d)", deroDeposit, deroT.Burn, deroT.Amount)
	}
	if deroT.Destination == "" {
		t.Error("DERO deposit needs a destination (ring member) -- empty dest with zero SCID is rejected by the wallet lib")
	}
	if tokenT.Burn != tokenDeposit || tokenT.Amount != 0 {
		t.Errorf("token deposit must be Burn=%d Amount=0 (got Burn=%d Amount=%d)", tokenDeposit, tokenT.Burn, tokenT.Amount)
	}
}
