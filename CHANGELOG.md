# Changelog

All notable changes to HOLOGRAM are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.7] - 2026-06-18

Clearer asset handling, hardened transfer validation, and Linux release binaries that run on current distros out of the box.

### Changed
- Wallet: native DERO is managed as the base coin (Dashboard / Send), separate from the contract-token portfolio — which now lists contract assets only.

### Fixed
- Wallet: hardened transfer validation so a native-DERO burn is consistently rejected across all send paths.
- Linux: release binaries are built against `webkit2gtk-4.1` (libsoup3) instead of the discontinued `4.0`, so they launch on Ubuntu 24.04+, Debian 13+, Fedora 40+, and Arch without a manual library symlink. CI now fails the release if a Linux binary links the old `4.0` runtime.

---

## [1.0.6] - 2026-06-08

Payment URI workflow, unified storage controls, and XSWD bridge fixes.

### Added
- Wallet: smart-paste payment URI field with a 7-state input model
- Settings: Data & Storage section — a unified clear/reset surface

### Changed
- Tightened the XSWD RPC surface and hardened CI checks

### Fixed
- XSWD: route `DERO.GetHeight` through the daemon proxy and reclassify it as read-public-data
- XSWD bridge: dispatch message events to `addEventListener` handlers
- Wallet: `CreatePaymentRequest` uses the local wallet path; failures are surfaced instead of swallowed
- Payment URI: dual-path integrated-address decode + address-aware OmniSearch
- Studio: accept `InitializePrivate` as a valid SC entrypoint
- Dev server: hot reload actually reloads, and real errors are surfaced

---

## [1.0.2] - 2026-04-20

Wallet registration and expanded platform support.

### Added
- Manual PoW-based wallet registration — new wallets can register on-chain without waiting for incoming DERO
- Registration progress UI with hash count, elapsed time, and cancel option
- Blockchain confirmation polling after registration TX broadcast
- Linux ARM64 (aarch64) binary for Raspberry Pi and ARM servers

### Changed
- PoW registration uses all available CPU cores (GOMAXPROCS-1) for faster completion
- Release artifacts renamed from `Hologram-*` to `HOLOGRAM-*` for brand consistency

### Fixed
- Duplicate toast notifications when starting wallet registration

---

## [1.0.1] - 2026-04-20

Cross-platform binaries and release automation.

### Added
- Pre-built binaries for Linux (amd64) and Windows (amd64) — closes the gap from v1.0.0 release notes
- GitHub Actions release workflow (`.github/workflows/release.yml`) — tag-triggered cross-platform builds
- Universal macOS binary (Intel + Apple Silicon in one file)
- SHA256 checksums for all release artifacts

### Changed
- Added plain-language disclaimer section to README reinforcing MIT "AS IS" terms for wallet-adjacent software

---

## [1.0.0] - 2026-04-18

First public release

### Added (post-RC)
- `hologram-explorer-search` message handler — TELA apps can invoke Explorer searches
- Privacy Mode enforcement for external link opens (https intercept + user prompt)
- `dero://` deep link protocol registration and launch URL handling

### Fixed (post-RC)
- Network classification now uses daemon-reported field (fixes simulator edge cases)
- Recent search history scoped per-network
- SC deployment TXIDs auto-pivot to contract view in Explorer
- Gnomon corrupted cache recovery on startup
- Batch deploy budget gate and mainnet precheck hardening
- Simulator network switching and wallet state alignment
- EPOCH attribution and uptime overflow guards
- Favorite toggling and offline cache metadata display
- Active wallet filename kept in sync after operations

---

## [1.0.0-rc] - 2026-04-01

Release candidate — full feature set for testing.

### Added

#### TELA Browser
- Full TELA decentralized web browser — resolves INDEX and DOC contracts, reconstructs multi-shard apps, and renders them in an isolated webview
- Per-tab browser history with back/forward navigation and iframe caching
- Auto-start Gnomon on Browser page mount for immediate app discovery
- TELA icon rendering with V2 header support and SCID icon resolution
- TELA-STATIC text file rendering support
- Content filtering for Browser app list
- Download interceptor for dApp blob/local file downloads via JS bridge

#### Studio
- **Batch Upload** — scan a local folder, auto-infer app name/description/dURL from `package.json`, `index.html`, and `README.md`, preview a preflight summary (file count, sizes, oversized warnings), and deploy as a TELA INDEX + DOC set
- **DocShard Manager** — shard any file >18 KB into `.shard` fragments and reconstruct from a shard folder; drag-and-drop file intake for both modes
- **Install DOC / Install INDEX** — deploy individual contracts with DocType selector
- **Version Control** — file-based diff viewer with TELA version history and semantic labels
- **Clone** — clone an existing TELA app from chain
- **Deploy SC** — raw smart contract deployment with DVM validation, gas estimation, and safety guardrails
- **Deploy SC Function Interactor** — dynamic SC function call UI
- dURL auto-slug populated on folder scan; reactive warning when a shard batch is missing the `.tela.shards` dURL suffix
- Preflight summary panel: file count, total size, oversized file detection with shard-manager hints

#### Wallet
- Connect via XSWD protocol (Engram and compatible wallets)
- Send DERO and tokens with ringsize selection, fee display, and integrated address validation
- Receive with integrated address generation and payment URI support
- Transaction history with export, TXID caching, and semantic labels
- Hide balance / hide address privacy toggles (per-field eye icon, persisted across restarts)
- Privacy masking propagated to Sidebar (expanded, collapsed, and menu states), WalletModal, Recent Activity, and History
- Change wallet password
- Wallet recovery from backup
- Internal wallet polling with asset support
- `GetPublicKey` and `DecryptPayload` for Dead Drop encryption

#### Gnomon Integration
- Gnomon-powered app discovery with fastsync and Time Machine (historical snapshot browser)
- OmniSearch — unified search across apps, smart contracts, transactions, and block numbers, with autocomplete and cross-tab support
- Tagging and content-class metadata on discovered apps
- Simple-Gnomon: historical queries and on-chain data allocation
- Resync UI with fastsync option; DB reset on height mismatch

#### XSWD API Server
- Built-in XSWD WebSocket server for dApp ↔ wallet communication
- Handles `DERO.*`, `Gnomon.*`, `EPOCH.*`, and `DeroAuth.*` method namespaces
- OAuth-style redirect flow for DeroAuth
- Per-app permission scoping with read-only app detection
- `telaHost` API injected into XSWD bridge for cross-origin and local dev compatibility
- XSWD bridge injection for local dev server HTML responses

#### Simulator
- Full local simulator mode — runs an embedded DERO daemon and test wallets for offline development
- Pre-seeded test wallets UI on Wallet page
- Complete DVM deploy + invoke flow in simulator
- Simulator crash detection and notification
- `ReconnectSimulatorMode` for app restart with an existing daemon
- Automatic fallback to mainnet when simulator daemon is unreachable

#### Settings & Infrastructure
- Settings persistence across restarts (daemon endpoint, network, privacy toggles, and more)
- Remote daemon endpoints persisted across restarts
- First-run wizard with node detection, LAN/external node option, and developer support screen
- LAN node connection support for power users
- SHA256 checksum verification for downloaded binaries
- EPOCH fair developer support address switching
- Battery detection for developer support (Windows via PowerShell/WMI)
- Villager identicon avatar system with 12 background patterns
- `derod` and `simulator` built from derohe source via Makefile (`make all`)
- Build metadata (`version`, `commit`, `buildDate`) injected at build time via `-ldflags`

### Fixed

#### XSWD / Wallet Parity
- `SIGNER()` returned empty string — was caused by hardcoded ringsize 16; now uses ringsize from params (default 2)
- `transfers[].scid` not parsed — token transfers were broken
- `fees` always hardcoded to 0
- `sc_rpc` only handled U/S/H types — `I` (int64) was silently dropped
- `sc_dero_deposit` / `sc_token_deposit` not parsed
- SC deployment via XSWD (`sc` param) not routed correctly
- `DERO.*` and `Gnomon.*` methods not forwarded to WebSocket dApps
- `AttemptEPOCHWithAddr` not handled
- `GetMaxHashesEPOCH` response key mismatch
- Null bytes in SCIDs causing key lookup failures — stripped in `sanitizeSCID()` and `decodeHexString()`
- Hex-encoded string values in `GetAllSCIDVariableDetails` responses not decoded
- `GetDaemon` endpoint format corrected to match Engram; simulator endpoint returned correctly
- `GetHeight` now populates `stableheight` and `topoheight`
- Double approval modal on TELA app reconnect
- Missing XSWD methods, lowercase aliases, and permission mappings

#### Simulator
- Test wallet showed 0 DERO balance
- Test wallets not loading on app restart
- Simulator daemon crashed on SC deploy
- Gnomon stale height after simulator restart
- Unreachable simulator now falls back to mainnet correctly
- SC deploy crash via disconnect-before-pause and post-tx settle delay
- WebSocket sequencing conflicts in batch upload
- Fund Wallet network mismatch and balance sync
- Fastsync disabled in simulator mode (was causing incorrect progress display)

#### Studio / Shards
- Shard `outputDir` reported a phantom relative path (`./datashards/shards/`) instead of the actual output directory (`filepath.Dir(filePath)`)
- GZIP compression toggle was not actually compressing before sharding
- Double extension when discovering compressed shard files (`.gz.gz`)
- Shard discovery and ordering in `ConstructFromShards`
- dURL tag detection aligned with backend (`.tela.shards`, `.tela.lib` suffixes)
- Drop-hijack bug: dropping a file into the app caused the webview to navigate to the file, rendering the app non-functional — fixed with `DisableWebViewDrop: true` in Wails config and a global JS `preventDefault` guard

#### Browser
- Blob downloads not intercepted for local dev server — added blob cache interceptor
- TELA entry point ordering: `index.html` now deployed as DOC1
- `telaHost` not enabled for local files — fixed
- New XSWD methods not matched due to case-sensitive string comparison
- Browser console auto-scroll fighting user scroll-up
- Double OmniSearch dropdown on load
- Normal transactions misclassified as smart contracts in Explorer

#### Wallet
- Broadcast transactions to daemon after building (were not being sent)
- Amount rounding, integrated address validation, payment URI parsing
- `walletPath` lost on wallet close, breaking re-open fallback
- Reserved insufficient fees when sending max balance
- Ringsize selection missing from Transfer and TokenSend modals
- Non-blocking daemon connect, address prefix restore, file picker fixes
- TELA app reconnect shown double approval modal

#### Network / Settings
- Daemon endpoint display and effective network label on startup
- Settings not persisted across restarts (daemon endpoint)
- Gnomon DB not reset when stored height exceeded daemon chain height
- Network mismatch detection on startup

#### UI / General
- Gas estimation formula was ~100x too high
- OmniSearch dropdown opened automatically on load
- Scroll freezing in Wallet History and SyncManager
- Block number color, sidebar indicator navigation, search autocomplete
- `window.confirm` replaced with modal for destructive actions (Full Resync)
- Design System v7.0 compliance pass (emojis removed from log/UI, colors, layout)
- Infinite log loop in production builds
- Console clear button not working

### Changed
- Go module path is `github.com/DHEBP/HOLOGRAM`
- Testnet support removed — mainnet and simulator only
- Historical Timeline feature removed (superseded by Time Machine)
- Dead code, phantom mining, bookmark, and text-index bindings pruned
- README updated: Go requirement corrected to 1.24.0+, build instructions clarified
- Copyright year updated to 2026

[1.0.0]: https://github.com/DHEBP/HOLOGRAM/releases/tag/v1.0.0
[1.0.0-rc]: https://github.com/DHEBP/HOLOGRAM/releases/tag/v1.0.0-rc
