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
	"fmt"
	"sync"
	"time"

	"github.com/DHEBP/HOLOGRAM/wallet/genesis"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// genesisRegState is the cold-registration miner's state — deliberately SEPARATE
// from the hot wallet's package-global regState (review [M1]). The hot regState
// carries broadcast/confirmation fields meaningless for an offline cold mine, and
// sharing it would tangle two state machines. One cold mine runs at a time.
type genesisRegStateT struct {
	sync.Mutex
	inProgress bool
	cancelCh   chan struct{}
}

var genesisRegState = &genesisRegStateT{}

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
// The seed crosses the bridge only as the inbound argument; it is never echoed
// back in the result (R2/[M7]).
func (a *App) VerifyColdWallet(seed, address, network, registrationHex string) map[string]interface{} {
	if refused := a.genesisGuard(); refused != nil {
		return refused
	}
	res, err := genesis.Verify(seed, address, genesis.Network(network), registrationHex)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	return map[string]interface{}{
		"success":           true,
		"addressMatch":      res.AddressMatch,
		"hasRegistration":   res.HasRegistration,
		"registrationValid": res.RegistrationValid,
		"bindsToKey":        res.BindsToKey,
	}
}

// MineRegistration mines the offline registration PoW for a cold wallet derived
// from `seed`, streaming progress as `genesis:registration_*` events and
// returning the registration hex (for QR / paper / DCSP transport). It does NOT
// broadcast. The mine is a multi-minute 24-bit grind; it runs on a background
// goroutine and is cancellable via CancelRegistration.
//
// Events (namespaced separately from the hot wallet's wallet:registration_*, so
// the cold UI never shows broadcast/confirm states it doesn't have, [M1]):
//   - genesis:registration_started   {}
//   - genesis:registration_progress  {attempts}
//   - genesis:registration_complete  {registrationHex}
//   - genesis:registration_cancelled {}
//   - genesis:registration_failed    {error}
//
// The seed crosses the bridge only as the inbound argument; it is never echoed
// back in any event payload or the result (R2/[M7]).
func (a *App) MineRegistration(seed, network string) map[string]interface{} {
	if refused := a.genesisGuard(); refused != nil {
		return refused
	}

	genesisRegState.Lock()
	if genesisRegState.inProgress {
		genesisRegState.Unlock()
		return map[string]interface{}{"success": false, "error": "A cold registration is already in progress"}
	}
	genesisRegState.inProgress = true
	genesisRegState.cancelCh = make(chan struct{})
	cancelCh := genesisRegState.cancelCh
	genesisRegState.Unlock()

	a.emitGenesis("genesis:registration_started", nil)
	startedAt := time.Now()

	go func() {
		defer func() {
			genesisRegState.Lock()
			genesisRegState.inProgress = false
			genesisRegState.Unlock()
		}()

		hexTx, err := genesis.MineRegistrationFromSeed(
			seed,
			genesis.Network(network),
			cancelCh,
			func(attempts uint64) {
				a.emitGenesis("genesis:registration_progress", map[string]interface{}{
					"attempts": attempts,
					"elapsed":  time.Since(startedAt).Seconds(),
				})
			},
		)
		switch {
		case err != nil:
			a.emitGenesis("genesis:registration_failed", map[string]interface{}{"error": err.Error()})
		case hexTx == "":
			a.emitGenesis("genesis:registration_cancelled", nil)
		default:
			a.emitGenesis("genesis:registration_complete", map[string]interface{}{"registrationHex": hexTx})
		}
	}()

	return map[string]interface{}{"success": true, "message": "Cold registration started"}
}

// CancelColdRegistration aborts an in-progress cold registration mine. Named
// distinctly from the hot wallet's CancelRegistration (wallet.go:4565) — the two
// registration flows are deliberately separate ([M1]). Safe to call when none is
// running.
func (a *App) CancelColdRegistration() map[string]interface{} {
	genesisRegState.Lock()
	defer genesisRegState.Unlock()
	if !genesisRegState.inProgress || genesisRegState.cancelCh == nil {
		return map[string]interface{}{"success": false, "error": "No cold registration is in progress"}
	}
	close(genesisRegState.cancelCh)
	genesisRegState.cancelCh = nil
	return map[string]interface{}{"success": true}
}

// emitGenesis emits a namespaced genesis event if the Wails context is live.
func (a *App) emitGenesis(event string, payload map[string]interface{}) {
	if a.ctx == nil {
		return
	}
	if payload == nil {
		wailsruntime.EventsEmit(a.ctx, event)
		return
	}
	wailsruntime.EventsEmit(a.ctx, event, payload)
}

// RenderPaperWallet renders the offline paper-wallet HTML and writes it to a
// user-chosen path at 0600. The decided delivery model: the seed stays Go-side
// — it is written to a local file the user controls, never returned across the
// Wails bridge into the JS heap/DOM ([M7]/[M9]). The user is told to print then
// destroy the file (the HTML's own guidance + the UI copy).
//
// network is the display network ("mainnet"/"simulator"); registrationHex is
// optional (the address can be papered before it is registered).
func (a *App) RenderPaperWallet(network, address, seed, registrationHex string) map[string]interface{} {
	if refused := a.genesisGuard(); refused != nil {
		return refused
	}

	netLabel := "MAINNET"
	if genesis.Network(network) == genesis.NetworkSimulator {
		netLabel = "SIMULATOR"
	}

	savePath, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		DefaultFilename: "dero-cold-wallet.html",
		Title:           "Save Cold Wallet (contains the SECRET seed)",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "HTML paper wallet (*.html)", Pattern: "*.html"},
		},
	})
	if err != nil {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("save dialog error: %v", err)}
	}
	if savePath == "" {
		return map[string]interface{}{"success": false, "cancelled": true}
	}

	if err := genesis.WritePaperWallet(savePath, netLabel, hologramVersion(), address, seed, registrationHex); err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	return map[string]interface{}{"success": true, "path": savePath}
}

// hologramVersion returns a short version string for the paper-wallet footer.
// Kept tiny and local; wire to the real build version if/when one is threaded
// through the App.
func hologramVersion() string { return "HOLOGRAM" }
