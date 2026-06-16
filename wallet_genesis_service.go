// Cold-wallet genesis — Wails surface.
//
// This is the thin *App wrapper layer ([B1]): the methods Svelte calls. They
// delegate to the pure-logic wallet/genesis subpackage and own a.ctx for
// progress events. No main.go Bind change is needed — `app` is already bound.
//
// The hard-refuse simulator guard lives here (the wrapper owns app state); the
// subpackage stays pure. See IMPLEMENTATION-PLAN_cold-wallet-genesis.md §5/§6.

package main

import (
	"github.com/DHEBP/HOLOGRAM/wallet/genesis"
)

// genesisRefuseMsg is shown when cold-wallet genesis is blocked because the app
// is in simulator mode. Gating on the authoritative a.IsInSimulatorMode()
// (nodeManager.networkMode) — NOT the stale globals.Arguments["--simulator"]
// (review [M4]; mirrors the established pattern at wallet.go:201-210).
const genesisRefuseMsg = "Cold wallet genesis is disabled while Simulator Mode is active — stop the simulator first."

// genesisGuard returns a non-nil error envelope if genesis must be refused.
// Both persistence models (in-memory and disk-persist) are refused under
// simulator mode: a stale/sim network corrupts deto1/dero1 address rendering on
// both paths, and the KDF strength on the disk path.
func (a *App) genesisGuard() map[string]interface{} {
	if a.IsInSimulatorMode() {
		return map[string]interface{}{"success": false, "error": genesisRefuseMsg}
	}
	return nil
}

// GenerateColdWallet creates a fresh cold wallet fully offline, in memory, and
// self-verifies the seed↔address derivation. It returns the address, the
// plaintext seed, and the self-check result.
//
// persist is reserved for the two supported delivery models (in-memory-only vs
// persist-encrypted-.db, the user's choice); the current step lands the
// in-memory path. The seed is returned for the reveal-gated UI and the
// paper-wallet Save flow; it is never logged and never placed in an event
// payload (R2/[M7]).
func (a *App) GenerateColdWallet(network string, languageID int, persist bool) map[string]interface{} {
	if refused := a.genesisGuard(); refused != nil {
		return refused
	}

	cw, err := genesis.Generate(genesis.Network(network), languageID)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	// NOTE: persist==true (disk-encrypted .db with a real password) is a
	// follow-up step; it reuses CreateWallet's persistence path and adds the
	// password prompt. In-memory-only is the default and the smallest surface.
	_ = persist

	return map[string]interface{}{
		"success":     true,
		"address":     cw.Address,
		"seed":        cw.Seed,
		"selfCheckOK": cw.SelfCheckOK,
	}
}

// VerifyColdWallet independently re-derives an address from a seed (and, if a
// registration hex is supplied, validates it offline) — the cold-storage trust
// check. Refused under simulator mode for the same rendering reason as genesis.
func (a *App) VerifyColdWallet(seed, address, registrationHex string) map[string]interface{} {
	if refused := a.genesisGuard(); refused != nil {
		return refused
	}
	// Delegates to the subpackage verifier (ported in a following step alongside
	// the registration logic). Stub envelope keeps the binding shape stable.
	return map[string]interface{}{
		"success": false,
		"error":   "VerifyColdWallet not yet implemented",
		"seed":    "", // never echo the seed back
		"_args":   map[string]string{"address": address, "registrationHex": registrationHex},
	}
}
