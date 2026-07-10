# HOLOGRAM Architecture

Contributor-focused architecture map for HOLOGRAM (Wails + Go + Svelte).

This document is intentionally practical: where code lives, how data flows, and how to make changes safely.

## 1) System Overview

HOLOGRAM is a native desktop app built with Wails:

- **Go backend** owns blockchain, wallet, indexing, storage, and protocol services.
- **Svelte frontend** owns UI, user interaction, and route-level workflows.
- **Wails bridge** connects both sides using generated JS bindings and runtime events.

```text
Svelte UI (frontend/src)
       |
       | Wails bindings + events
       v
Go App orchestrator (app.go + domain files)
       |
       +--> derod RPC (daemon_client.go)
       +--> Wallet manager (wallet.go)
       +--> Gnomon indexer (gnomon.go)
       +--> TELA services (tela_service.go + server_manager.go)
       +--> XSWD server/client/router (xswd_*.go)
       +--> Graviton-backed caches/settings (storage.go, nrs_cache.go, app_settings.go)
```

## 2) Runtime Modes and Ports

HOLOGRAM supports two networks:

- **Mainnet**
  - Daemon RPC: `127.0.0.1:10102`
- **Simulator**
  - Daemon RPC: `127.0.0.1:20000`

XSWD server for dApps:

- **XSWD WebSocket**: `127.0.0.1:44326`

## 3) Startup Lifecycle

High-level startup sequence:

1. `main.go` initializes DERO globals and wallet lookup table.
2. `NewApp()` creates the central app object and core services.
3. Wails starts and calls `app.startup(ctx)`.
4. Settings load and daemon endpoint is reconciled for selected network.
5. TELA shard path, permission manager, and caches are initialized.
6. Daemon connectivity check runs asynchronously.
7. First-run wizard gate decides when background services start.
8. Background services (XSWD, Gnomon, status broadcaster, dev support) start after setup is complete.

## 4) Backend Structure (Go)

Core orchestration and domains:

- `app.go`: central `App` struct and lifecycle (`startup`, `shutdown`).
- `app_navigation.go`: browser-like navigation/history/bookmarks.
- `app_settings.go`: loading/saving persisted settings.
- `app_status.go`: periodic status snapshots and event broadcast.
- `app_gnomon.go`: app-level discovery/search integration.
- `app_devsupport.go`: developer support/EPOCH app-level behavior.

Primary service modules:

- `daemon_client.go`: JSON-RPC client to daemon.
- `wallet.go`: wallet lifecycle, balance, transfers, history.
- `node_manager.go`: embedded node process management.
- `gnomon.go`: indexer lifecycle and indexed queries.
- `explorer_service.go`: explorer-facing block/tx data.
- `tela_service.go`: DOC/INDEX install/update/clone/version operations.
- `server_manager.go`: serving/proxying TELA web content.
- `xswd_server.go`, `xswd_client.go`, `xswd_router.go`, `xswd_permissions.go`: dApp wallet protocol.
- `storage.go`, `nrs_cache.go`, `offline_cache.go`: local persistent caches.

Supporting modules include `content_filter.go`, `proof_validation.go`, `search_service.go`, and simulator/dev tooling files.

## 5) Frontend Structure (Svelte)

Entry and route surfaces:

- `frontend/src/App.svelte`: root shell, event wiring, top-level navigation.
- `frontend/src/routes/Browser.svelte`: TELA browsing and render flows.
- `frontend/src/routes/Explorer.svelte`: chain explorer UX.
- `frontend/src/routes/Wallet.svelte`: wallet UX.
- `frontend/src/routes/Studio.svelte`: TELA publishing/dev UX.
- `frontend/src/routes/Settings.svelte`: network/config/system controls.

Shared app layer:

- `frontend/src/lib/components/*`: reusable UI units.
- `frontend/src/lib/stores/appState.js`: main app store and helper actions.
- `frontend/src/styles/hologram.css`: global HOLOGRAM UI system tokens/patterns.
- `frontend/src/lib/components/holo/*`: shared design-system components.

## 6) Bridge Contract: Frontend <-> Backend

Two communication channels:

- **Generated bindings** (`frontend/wailsjs/go/main/App.js`): direct calls to exposed Go methods.
- **Runtime events** (`EventsOn`/`EventsEmit`): push updates and async prompts.

Common event patterns:

- `status:update`: periodic system status payloads.
- `xswd:request`: wallet approval/signing prompts for dApps.
- plus route-specific UX events (toasts/progress/notifications).

Important: `frontend/wailsjs/*` is generated code. Do not hand-edit generated outputs.

## 7) Key Data Flows

### A) TELA content navigation

1. Frontend requests navigation (SCID or dURL).
2. Backend resolves identifiers, checks cache, and fetches/serves content when needed.
3. Server/proxy path ensures content can run in HOLOGRAM context.
4. Frontend displays the result and updates history/state.

### B) Wallet transfer

1. Frontend sends transfer request through Wails binding.
2. Backend validates request and wallet state.
3. Wallet library builds/signs/submits transaction.
4. Result (txid or error) returns to frontend for UX feedback.

### C) XSWD request handling

1. dApp sends JSON-RPC call over XSWD.
2. Permissions are checked per app/method.
3. If approval is required, frontend modal is triggered.
4. Router dispatches allowed method to daemon/wallet/tela/gnomon handlers.
5. JSON-RPC response returns to dApp.

## 8) Persistence and Local State

Persistent state is stored under HOLOGRAM data directories (settings, cache, indexer, wallet data, network-specific artifacts). Code paths for this are centralized in:

- `paths.go`
- `app_settings.go`
- `storage.go`
- `nrs_cache.go`

When changing persistence logic, keep backward compatibility in mind (existing users have previous settings/state on disk).

## 9) Change Guide (Humans and AI Agents)

Use this quick map before editing:

- **Need a new UI behavior?** Start in route/component files and `appState.js`.
- **Need new backend capability?** Add or extend Go app/service method, then expose via Wails binding.
- **Need wallet/XSWD behavior?** Prefer `xswd_*` and `wallet.go` paths; preserve permission checks.
- **Need UI styling changes?** Follow `docs/DESIGN-SYSTEM-RULEBOOK.md` and existing `hologram.css` patterns.
- **Need daemon/indexer behavior?** Touch `daemon_client.go`, `node_manager.go`, `gnomon.go` with care.

Before opening a PR:

1. `go test ./...`
2. `wails build`
3. `frontend` build check (`npm run build`)
4. Confirm UI changes match the design rulebook exactly

## 10) Related Docs

- Design system: `docs/DESIGN-SYSTEM-RULEBOOK.md`
- Contribution guide: `CONTRIBUTING.md`
- Product/user overview: `README.md`
