# HOLOGRAM Makefile
# Builds HOLOGRAM along with derod and simulator from derohe source
#
# Usage:
#   make            - Build HOLOGRAM + derod + simulator
#   make release    - Distribution build (clean + trimpath + build metadata)
#   make derod      - Build derod only
#   make simulator  - Build simulator only
#   make clean      - Clean build artifacts
#   make dev        - Run in development mode
#
# The derod and simulator binaries are built from the derohe dependency
# and placed alongside the HOLOGRAM executable in build/bin/

.PHONY: all hologram release derod simulator mtp-anchor clean dev test-mtp test-mtp-integration help

# Build metadata - injected into the binary via ldflags
# Match the actual variable assignment, not the example comment above it.
VERSION  := $(shell sed -n 's/^[[:space:]]*AppVersion[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' version.go | sed -n '1p')
COMMIT   := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE     := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS  := -X main.AppVersion=$(VERSION) -X main.BuildDate=$(DATE) -X main.GitCommit=$(COMMIT)

# Detect OS and architecture
GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)

# Binary names based on platform
ifeq ($(GOOS),windows)
    HOLOGRAM_BIN = Hologram.exe
    DEROD_BIN = derod.exe
    SIMULATOR_BIN = simulator.exe
else ifeq ($(GOOS),darwin)
    HOLOGRAM_BIN = Hologram.app
    DEROD_BIN = derod-darwin
    SIMULATOR_BIN = simulator-darwin
else
    HOLOGRAM_BIN = Hologram
    DEROD_BIN = derod-linux-$(GOARCH)
    SIMULATOR_BIN = simulator-linux-$(GOARCH)
endif

# Linux: link against webkit2gtk-4.1 (libsoup3) instead of the default
# webkit2gtk-4.0 (libsoup2). All current distros (Ubuntu 24.04+, Debian 13,
# Fedora 40+, Arch) ship 4.1 only — building without this tag fails to link
# or crashes at runtime due to libsoup2 ↔ libsoup3 conflicts.
# Override on the command line if you really need the legacy 4.0 binding:
#   make WAILS_TAGS= ...
ifeq ($(GOOS),linux)
    WAILS_TAGS ?= -tags webkit2_41
else
    WAILS_TAGS ?=
endif

# Build directories
BUILD_DIR = build/bin
DEROHE_PKG = github.com/deroproject/derohe

# Get derohe module path from go mod

# Default target - build derod/simulator FIRST, then hologram
# This order is important because wails build runs go mod tidy which
# can remove "unused" dependencies needed for derod/simulator
all: derod simulator hologram
	@echo ""
	@echo "✅ Build complete!"
	@echo "   HOLOGRAM: $(BUILD_DIR)/$(HOLOGRAM_BIN)"
	@echo "   derod:    $(BUILD_DIR)/$(DEROD_BIN)"
	@echo "   simulator: $(BUILD_DIR)/$(SIMULATOR_BIN)"
	@echo ""
ifeq ($(GOOS),darwin)
	@echo "Run with: open $(BUILD_DIR)/Hologram.app"
else
	@echo "Run with: ./$(BUILD_DIR)/$(HOLOGRAM_BIN)"
endif

# Build HOLOGRAM using wails (dev/local build with metadata)
hologram:
	@echo "🔨 Building HOLOGRAM ($(VERSION), $(COMMIT))..."
	wails build $(WAILS_TAGS) -ldflags "$(LDFLAGS)"
	@echo "✅ HOLOGRAM built"

# Release build — clean, trimpath, metadata injected (use this for distribution)
release: derod simulator
	@echo "🚀 Building HOLOGRAM release ($(VERSION), $(COMMIT))..."
	wails build $(WAILS_TAGS) -ldflags "$(LDFLAGS)" -clean -trimpath
	@echo "✅ Release build complete: $(BUILD_DIR)/$(HOLOGRAM_BIN)"

# Build derod from derohe source
# Note: We build from HOLOGRAM's module context so dependencies resolve correctly
derod: check-derohe
	@echo "🔨 Building derod from derohe source..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(DEROD_BIN) $(DEROHE_PKG)/cmd/derod
	@chmod +x $(BUILD_DIR)/$(DEROD_BIN)
	@echo "✅ derod built: $(BUILD_DIR)/$(DEROD_BIN)"

# Build simulator from derohe source
# Note: We build from HOLOGRAM's module context so dependencies resolve correctly
simulator: check-derohe
	@echo "🔨 Building simulator from derohe source..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(SIMULATOR_BIN) $(DEROHE_PKG)/cmd/simulator
	@chmod +x $(BUILD_DIR)/$(SIMULATOR_BIN)
	@echo "✅ simulator built: $(BUILD_DIR)/$(SIMULATOR_BIN)"

# Check that derohe dependency is available and add cmd dependencies.
# No version is pinned here: the derohe module is resolved by go.mod (currently a
# replace onto the public fork), and these go get calls only pull the cmd-only
# transitive deps (readline, dns, lumberjack) into go.sum so derod/simulator build.
check-derohe:
	@echo "🔍 Checking derohe dependency..."
	@go get $(DEROHE_PKG)/cmd/derod 2>/dev/null || true
	@go get $(DEROHE_PKG)/cmd/simulator 2>/dev/null || true

# Build mtp-anchor CLI tool
mtp-anchor:
	@echo "🔨 Building mtp-anchor..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/mtp-anchor ./cmd/mtp-anchor
	@chmod +x $(BUILD_DIR)/mtp-anchor
	@echo "✅ mtp-anchor built: $(BUILD_DIR)/mtp-anchor"

# Run unit tests for the messenger/mtp package (no simulator required)
test-mtp:
	@echo "🧪 Running messenger/mtp unit tests..."
	go test ./messenger/mtp/... -v -count=1

# Run the full integration test suite against a live simulator
# Prerequisites: simulator daemon + wallet RPC must be running.
# Optional env vars:
#   WALLET_RPC  (default http://127.0.0.1:30000/json_rpc)
#   DAEMON_RPC  (default http://127.0.0.1:20000/json_rpc)
#   SCID        (only needed with --skip-deploy)
test-mtp-integration: mtp-anchor
	@echo "🧪 Running MTP integration tests..."
	@bash cmd/mtp-anchor/integration_test.sh \
		--wallet-rpc "$${WALLET_RPC:-http://127.0.0.1:30000/json_rpc}" \
		--daemon-rpc "$${DAEMON_RPC:-http://127.0.0.1:20000/json_rpc}"

# Development mode
dev:
	wails dev $(WAILS_TAGS)

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	@echo "✅ Clean complete"

# Help
help:
	@echo "HOLOGRAM Build System"
	@echo ""
	@echo "Targets:"
	@echo "  all        - Build HOLOGRAM + derod + simulator (recommended)"
	@echo "  hologram   - Build HOLOGRAM only (with build metadata)"
	@echo "  release    - Distribution build: clean + trimpath + metadata"
	@echo "  derod      - Build derod from derohe source"
	@echo "  simulator  - Build simulator from derohe source"
	@echo "  mtp-anchor - Build the mtp-anchor CLI tool"
	@echo "  test-mtp   - Run messenger/mtp unit tests (no simulator needed)"
	@echo "  test-mtp-integration - Run full integration suite (simulator required)"
	@echo "  clean      - Remove build artifacts"
	@echo "  help       - Show this help"
	@echo ""
	@echo "Platform: $(GOOS)/$(GOARCH)"
	@echo ""
	@echo "The 'make all' command builds everything needed to run HOLOGRAM"
	@echo "without downloading any pre-built binaries."
