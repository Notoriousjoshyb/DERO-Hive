# Linux Build Guide

HOLOGRAM is built with [Wails v2](https://wails.io/), which renders the UI through the system's WebKitGTK runtime. The Linux WebKit ecosystem went through a transition starting around 2024 that affects every Wails app, not just HOLOGRAM. This guide covers the gotchas you will hit on a modern distro and how to resolve each one.

If you just want the working command and don't care about the why:

```bash
# Ubuntu / Debian
sudo apt install libgtk-3-dev libglib2.0-dev libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install gtk3-devel glib2-devel webkit2gtk4.1-devel

# Arch
sudo pacman -S gtk3 glib2 webkit2gtk-4.1

# Build / run
make all                       # full build (auto-applies -tags webkit2_41 on Linux)
wails dev -tags webkit2_41     # dev mode
wails build -tags webkit2_41   # HOLOGRAM-only build
```

Read on for the *why*, plus fixes for the four most common Linux failure modes.

---

## The libsoup2 → libsoup3 split (the big one)

Wails v2 has two WebKit bindings:

| Binding | WebKit package | HTTP backend |
|---------|---------------|--------------|
| Default (no tag) | `webkit2gtk-4.0` | libsoup **2** |
| `-tags webkit2_41` | `webkit2gtk-4.1` | libsoup **3** |

Every current Linux distro has dropped or is dropping the libsoup2-based `webkit2gtk-4.0`:

- **Ubuntu 24.04+ / Debian 13+** — package renamed to `libwebkit2gtk-4.1-dev`, the 4.0 package is gone.
- **Fedora 40+** — only ships `webkit2gtk4.1-devel`.
- **Arch** — ships only `webkit2gtk-4.1`. The bare `webkit2gtk` package is no longer in repos.

If you build HOLOGRAM **without** `-tags webkit2_41` on these systems you'll see one of:

- Linker errors about missing `webkit2gtk-4.0` / pkg-config can't find it.
- A successful build that **crashes at startup** because libsoup2 and libsoup3 get loaded into the same process. This is a known WebKitGTK runtime conflict, not a HOLOGRAM bug.

**Fix:** install the 4.1 dev package above and pass the build tag (or use `make`, which sets it for you).

> ### Wails v3 / `webkitgtk-6.0`?
> [wails#3193](https://github.com/wailsapp/wails/issues/3193) tracks moving Wails to GTK4 / WebKitGTK 6.0 in the v3 branch. That is **not** required for HOLOGRAM to build — `webkit2_41` is the supported path on Wails v2 and works on every modern distro.

---

## Failure 1 — `pkg-config: command not found` or "Package webkit2gtk-4.0 was not found"

You're missing the dev headers, or you have the 4.0 package name in muscle memory.

```bash
# Ubuntu/Debian
sudo apt install pkg-config libgtk-3-dev libglib2.0-dev libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install pkgconf gtk3-devel glib2-devel webkit2gtk4.1-devel

# Arch
sudo pacman -S pkgconf gtk3 glib2 webkit2gtk-4.1
```

Then rebuild with `-tags webkit2_41` (or just `make`).

---

## Failure 2 — Build succeeds but the app crashes / hangs at launch

Symptom: `wails build` finishes, but `./build/bin/Hologram` immediately segfaults, freezes the desktop, or prints something about libsoup before dying.

This is the **libsoup2 + libsoup3 in the same process** conflict. It happens when:

- You built without `-tags webkit2_41` but the runtime found a libsoup3-only WebKitGTK,
- Or the system has both libsoup major versions installed and a transitive dep pulled in the wrong one.

**Fix:**

```bash
make clean
make all      # auto-tags on Linux
# Or explicitly:
wails build -tags webkit2_41
```

---

## Failure 3 — `make all` hangs the machine / triggers OOM killer

`make all` builds three things end-to-end:

1. `derod` (DERO daemon, from `derohe` source)
2. `simulator` (DERO simulator)
3. HOLOGRAM (Wails Go + bundled Svelte frontend, CGO-linked against WebKit)

The Go linker for the third step is memory-heavy, and parallel compilation can spike well past 8 GB on a fresh checkout. On a small VM or laptop this can OOM-kill X/Wayland and lock the desktop.

**Mitigations, easiest first:**

```bash
# 1. Limit Go's parallelism (4 → 2 workers)
GOFLAGS='-p=2' make all

# 2. Skip derod/simulator entirely — build HOLOGRAM only
wails build -tags webkit2_41

# 3. If derod is the heavy step, build sequentially with reduced concurrency
make derod GOFLAGS='-p=1'
make simulator GOFLAGS='-p=1'
make hologram

# 4. Add swap if you don't have any
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

If the machine is locking up *before* the link stage, it's almost certainly the frontend `vite` build chewing memory while Go's compiler runs in parallel. `GOFLAGS='-p=2'` is the cleanest fix.

---

## Failure 4 — `wails dev` errors with "Timed out waiting for Vite to output a URL"

```
failed to find Vite server URL: Timed out waiting for Vite to output a URL after 10 seconds
```

A previous `wails dev` session left a vite/wails process holding port `5173` (or another dev port). The new session can't bind it and gives up.

**Fix:**

```bash
lsof -ti:5173 | xargs -r kill -9
pkill -f vite
pkill -f wails
wails dev -tags webkit2_41
```

If it keeps recurring, `npm run dev` may be running standalone in another terminal — close it.

---

## Failure 5 — Go is too old (`go version go1.22.x linux/amd64`)

HOLOGRAM requires Go **1.24.0+**. Most distro packages (`apt install golang-go`, etc.) are pinned to whatever shipped with the distro release and are usually one or two majors behind.

**Install a current Go from upstream:**

```bash
# Remove any distro Go first
sudo apt remove golang-go golang 2>/dev/null || true
sudo rm -rf /usr/local/go

# Pick the latest from https://go.dev/dl/
GO_VERSION=1.24.2
wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz

# Add Go to PATH (persist across sessions)
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.profile
source ~/.profile

go version   # should print 1.24.x or newer
```

Then reinstall the Wails CLI under the new Go:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
export PATH=$PATH:$HOME/go/bin
wails doctor
```

`wails doctor` is worth running once on a fresh machine — it sanity-checks Go, Node, npm, pkg-config, and WebKit headers in one shot.

---

## TL;DR cheat sheet

```bash
# 1. Up-to-date Go (>= 1.24) from go.dev, not from your distro
go version

# 2. Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest
export PATH=$PATH:$HOME/go/bin

# 3. WebKit 4.1 dev headers (your distro's package name)
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libglib2.0-dev   # Debian/Ubuntu
sudo dnf install webkit2gtk4.1-devel gtk3-devel glib2-devel         # Fedora
sudo pacman -S webkit2gtk-4.1 gtk3 glib2                            # Arch

# 4. Build with the right tag (or use make, which does this automatically)
make dev                                # interactive
make all                                # full build
wails build -tags webkit2_41            # HOLOGRAM only
```

Anything else broken? Open a [GitHub Discussion](https://github.com/DHEBP/HOLOGRAM/discussions) with your distro, `go version`, `wails doctor` output, and the exact error.
