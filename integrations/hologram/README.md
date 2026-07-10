<p align="center">
  <img src="frontend/src/assets/hologram-wordmark.svg" alt="HOLOGRAM" height="40">
</p>

<p align="center">
  <strong>The Complete DERO Experience</strong>
</p>

---

## Overview

HOLOGRAM reimagines what a browser can be. Built for the DERO blockchain, it's a native desktop app where content is permanent, privacy is default, and you can deploy your own applications directly to the chain.

Browse TELA applications. Manage your DERO. Build and deploy dApps with an integrated development studio. Everything unified in one experience.

### Beyond Web 2.0

| Traditional Web | HOLOGRAM |
|-----------------|----------|
| Content on centralized servers | Content on blockchain (immutable) |
| Tracking, cookies, analytics | Zero tracking, complete privacy |
| Requires internet connection | Offline-first with local caching |
| Extensions required for Web3 | Native wallet and dApp integration |
| Servers can censor or disappear | Permanent, censorship-resistant |

---

## Key Features

| Category | Features |
|----------|----------|
| **Explorer** | Block/TX explorer with DeroProof validation, time-travel SC state |
| **Browser** | TELA app rendering, dURL navigation, content caching, offline mode |
| **Wallet** | Create, restore, manage DERO wallets with full transaction history |
| **Studio** | Local dev server with hot reload, batch TELA deployment |
| **Discovery** | Gnomon-powered search, ratings, and content filtering |
| **Simulator** | One-click dev environment with instant blocks |
| **Privacy** | No tracking, no ads, censorship-resistant |

---

## Quick Start

### Prerequisites

- **Go** 1.24.0+ — install from [go.dev/dl](https://go.dev/dl) (distro packages like `apt install golang-go` are usually too old)
- **Wails** v2 CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **Node.js** 18+

#### Linux-specific Dependencies

All current Linux distros (Ubuntu 24.04+, Debian 13, Fedora 40+, Arch) have moved to `webkit2gtk-4.1` (libsoup3). The Makefile auto-applies the matching `-tags webkit2_41` build tag on Linux — you just need the right system packages:

```bash
# Ubuntu/Debian
sudo apt install libgtk-3-dev libglib2.0-dev libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install gtk3-devel glib2-devel webkit2gtk4.1-devel

# Arch Linux
sudo pacman -S gtk3 glib2 webkit2gtk-4.1
```

> Hitting a build error, runtime crash, or vite timeout on Linux? See [docs/LINUX-BUILD.md](docs/LINUX-BUILD.md) — it covers the libsoup conflict, the `webkit2_41` tag, OOM during `make all`, and stale dev-server cleanup.

### Development

```bash
git clone https://github.com/DHEBP/HOLOGRAM.git
cd HOLOGRAM
cd frontend && npm install && cd ..

# macOS / Windows
wails dev

# Linux
wails dev -tags webkit2_41
# or, equivalently:
make dev
```

### Production Build (Recommended)

Build HOLOGRAM along with derod and simulator from source:

```bash
# Build everything (HOLOGRAM + derod + simulator)
make all

# Output:
# build/bin/Hologram (or Hologram.app on macOS)
# build/bin/derod-{platform}
# build/bin/simulator-{platform}
```

This builds the DERO daemon and simulator directly from the derohe source code, eliminating the need to download pre-built binaries.

### Alternative: HOLOGRAM Only

If you prefer to download derod separately:

```bash
# macOS / Windows
wails build

# Linux
wails build -tags webkit2_41

# Output locations:
# macOS:   build/bin/Hologram.app
# Linux:   build/bin/Hologram
# Windows: build/bin/Hologram.exe
```

### Cross-Platform Builds

```bash
wails build -platform darwin/amd64                    # macOS Intel
wails build -platform darwin/arm64                    # macOS Apple Silicon
wails build -platform linux/amd64   -tags webkit2_41  # Linux x64
wails build -platform windows/amd64                   # Windows x64
```

---

## Architecture

```
HOLOGRAM (Wails v2)
├── Direct HTTP → derod:10102 (blockchain reads)
├── XSWD Server → 127.0.0.1:44326 (integrated wallet + dApp bridge)
├── XSWD Client → Engram (optional external wallet)
├── Gnomon Indexer (content discovery)
├── Graviton Cache (persistent storage with versioning)
└── Iframe → TELA content (sandboxed + telaHost API)
```

### Network Modes

| Mode | Description |
|------|-------------|
| **Mainnet** | Full production network |
| **Simulator** | Local environment with instant blocks (no real DERO) |

---

## For dApp Developers

### telaHost Bridge API

HOLOGRAM provides a native JavaScript API (`telaHost`) to every TELA application, similar to how browsers provide `window.ethereum` for Web3 dApps. This is **not** browser extension injection—it's a native app feature that enables secure blockchain and wallet interactions.

**Think of it like:**
- `window.ethereum` in MetaMask/Web3 browsers
- `window.webkit` in Safari
- Native APIs provided by the browser runtime

**Security Model:**
- TELA apps run in **sandboxed iframes** (isolated from HOLOGRAM)
- All wallet operations require **explicit user approval** via native modals
- Read-only blockchain queries work instantly (no approval needed)
- Apps cannot access your wallet without permission

**Usage:**

```javascript
// Check if running in HOLOGRAM
if (window.telaHost) {
    // Read-only operations (instant, no approval needed)
    const info = await telaHost.call('DERO.GetInfo');
    const sc = await telaHost.getSmartContract(scid, true, true);
    
    // Wallet operations (requires user approval)
    await telaHost.connect();
    const address = await telaHost.getAddress();
    const balance = await telaHost.getBalance();
    
    // Transactions (triggers approval modal)
    await telaHost.transfer({ transfers: [...], ringsize: 16 });
    await telaHost.scInvoke({ scid, entrypoint: 'Vote', params: [...] });
}
```

| Method | Description |
|--------|-------------|
| `call(method, params)` | Generic RPC call |
| `connect()` | Request wallet connection |
| `isConnected()` | Check wallet status |
| `getAddress()` | Get wallet address |
| `getBalance()` | Get balance (total + unlocked) |
| `getNetworkInfo()` | Chain height, difficulty, peers |
| `getBlock(height)` | Block data |
| `getTransaction(txid)` | Transaction details |
| `getSmartContract(scid)` | SC code and variables |
| `transfer(params)` | Send DERO (requires approval) |
| `scInvoke(params)` | Invoke SC function (requires approval) |

**Learn more:** See the [full telaHost API documentation](https://hologram.derod.org/telahost-api) for complete reference and security details.

### Local Development

1. Open **Studio > Serve** tab
2. Select your TELA app directory
3. Server starts with hot reload
4. Full `telaHost` API available during development

---

## Project Structure

```
HOLOGRAM/
├── main.go                 # Wails entry point
├── app.go                  # Core app logic
├── wallet.go               # Wallet operations
├── xswd_server.go          # Integrated XSWD proxy
├── xswd_client.go          # External wallet connection
├── gnomon.go               # Content discovery
├── epoch_handler.go        # Developer support
├── simulator_*.go          # Simulator mode
├── local_dev_server.go     # Hot reload dev server
├── explorer_service.go     # Block explorer
├── time_travel_explorer.go # SC state history
├── offline_cache.go        # Offline browsing
│
├── frontend/
│   ├── src/
│   │   ├── routes/         # Page components
│   │   ├── lib/components/ # Reusable components
│   │   └── styles/
│   └── wailsjs/            # Auto-generated Go bindings
│
└── wails.json              # Wails configuration
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - Contributor/agent architecture map
- [Design System Rulebook](docs/DESIGN-SYSTEM-RULEBOOK.md) - Non-negotiable UI implementation spec
- [Official Docs](https://hologram.derod.org) - Full documentation
- [TELA Protocol](https://tela.derod.org) - TELA specification  
- [DERO Docs](https://derod.org) - DERO blockchain reference

---

## Disclaimer

HOLOGRAM is experimental software — use at your own risk. Always back up your seed phrase and test with small amounts first. See [LICENSE](LICENSE) for full terms.

---

**Version:** 1.0.1  
**Status:** Early public release — feature-complete, bug reports welcome  
**Released:** April 18, 2026
**Last Updated:** April 18, 2026
