# PureWolf

**PureWolf** is a **Tela client extension for DERO** for Firefox.  
It turns your browser into a real on-chain web browser by connecting to a **native helper** written in Go.

With PureWolf you can:

- 🌐 Load **Tela websites** directly in your browser
- 🔎 Search and resolve **SCIDs** using the Tela indexer
- ⚙️ Start and control **TELA + HyperGnomon** from the extension
- 🖥️ Serve sites locally — no gateways, no proxies, no fake web

PureWolf works on **Firefox** and installs safely in your **user folder only**.

To start using **PureWolf** install the browser extension:
> Firefox: [Firefox add-on](https://addons.mozilla.org/en-US/firefox/addon/purewolf/)

After install run the extension and follow the help instructions in the dashboard to install the native helper.

---

![PureWolf Screenshot](assets/preview.png)

## Features

- Go-based native helper (`purewolf-native`)
- Firefox Native Messaging integration
- Secure, user-local install (no sudo, no system files)
- Automatic manifest patching
- One-command native installer
- Shared extension code with browser-specific manifests

---

## Quick Start

1. Install the [Firefox add-on](https://addons.mozilla.org/en-US/firefox/addon/purewolf/)
2. Open the extension dashboard and follow the help page to install the native helper
3. Connect a DERO node
4. Browse Tela sites and SCIDs directly from the DERO blockchain 🚀

---

## Prerequisites

- **Go 1.26+** — HyperGnomon requires Go 1.26.0 ([go.mod](native/go.mod))
- **Firefox** — the extension is currently Firefox-only
- **A DERO daemon** — local node recommended, public nodes also work

---

## Architecture

```
Browser Extension
  ↕ Native Messaging (stdin/stdout JSON)
purewolf-native
  ├── HyperGnomon (indexer + API server)
  ├── TELA proxy (serves SCIDs as local URLs)
  └── DERO daemon RPC
```

The browser extension communicates with `purewolf-native` via Firefox Native Messaging.
The native helper runs:
- **HyperGnomon** — discovers and indexes TELA smart contracts on-chain via FastSync
- **TELA proxy** — loads SCID content and serves it as local HTTP URLs the browser can load
- **Daemon RPC** — queries the DERO daemon for chain state, transactions, and contract data

---

## Repository Structure

```
purewolf/
├── extension/                  # Shared extension code & UI
│   ├── js/                     # Background, content, and UI scripts
│   ├── css/                    # Stylesheets
│   ├── dashboard/              # Dashboard page components
│   ├── libs/                   # Third-party libraries
│   ├── popup/                  # Popup UI HTML
│   └── icons/                  # Extension icons
│
├── browsers/                   # Browser-specific manifests
│   └── firefox/manifest.json
│
├── native/                     # Native helper (Go)
│   ├── main.go                 # Entry point
│   ├── native.go               # Native messaging handlers
│   ├── gnomon.go               # HyperGnomon — FastSync, discovery, SCID variables
│   ├── tela.go                 # TELA proxy
│   ├── state.go                # Shared state
│   ├── tela_catalog.go         # Bundled SCID fallback list
│   ├── compat.go               # Version compat / helpers
│   ├── install.sh              # One-command installer
│   ├── com.purewolf.json       # Native messaging manifest template
│   ├── go.mod                  # Go module (requires Go 1.26)
│   └── go.sum
│
├── scripts/                    # Utility scripts
│   └── build-extension.sh      # Package the browser extension
│
├── README.md
└── LICENSE
```

---

## Installation

### 1. Install the browser extension

#### Firefox

- Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/purewolf/)
- Or load temporarily: `about:debugging` → _This Firefox_ → _Load Temporary Add-on_

### 2. Install the native helper

The native helper is required to:
- Start and control TELA
- Read local site folders
- Resolve SCIDs
- Serve pages locally

#### Linux / macOS

From the repository root:

```bash
cd native
chmod +x install.sh
./install.sh
```

#### What the installer does

- Creates `~/.purewolf/` and copies the binary (`purewolf-native`)
- Creates browser-specific native messaging folders and copies the manifest (`com.purewolf.json`)
  - Firefox → `~/.mozilla/native-messaging-hosts/`
- Replaces `/home/USERNAME` in the manifest with your actual home folder
- Sets executable permissions
- No sudo required

### 3. Restart your browser

Close and reopen the browser so the native host is detected.

When working, the extension will show:

> 🟢 **Native connected**

If not installed or detected:

> 🔴 **Native not found**

### 4. Connect a node

- It is recommended to use your own local node for the best performance and reliability.
- Public nodes also work well — load a node from the **Bookmarks** page and click **Connect**.
- Expect loading times from public nodes to be around **1–15 seconds**, while local nodes are nearly instant.

---

## Building from Source

### Build the Go native helper

```bash
cd native
go build -o ~/.purewolf/purewolf-native .
```

### Package the browser extension

```bash
bash scripts/build-extension.sh firefox
```

This copies shared extension code and injects the correct manifest for Firefox.

---

## Contributing

- Fork the repository
- Keep shared logic in `extension/`
- Browser-specific files go in `browsers/<browser>/`
- Submit clear, focused pull requests

---

## License

MIT License — see `LICENSE`.
