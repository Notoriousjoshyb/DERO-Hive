module github.com/DHEBP/HOLOGRAM

go 1.24.0

require (
	github.com/civilware/Gnomon v0.0.0-20260112113638-0280ea286474
	github.com/civilware/epoch v0.0.0-20241002060739-1ed2fc6f74cb
	github.com/civilware/tela v0.0.0-20250806221602-aa892d2ff8d4
	github.com/deroproject/derohe v0.0.0-20250813215012-9b6a8b82c839
	github.com/deroproject/graviton v0.0.0-20220130070622-2c248a53b2e1
	github.com/fsnotify/fsnotify v1.9.0
	github.com/gorilla/websocket v1.5.3
	github.com/wailsapp/wails/v2 v2.11.0
)

// Local R&D: point derohe at the DEROFDN community-dev fork for sender-attribution
// privacy work. Not for release — revert before any HOLOGRAM commit/tag.
// NOTE: `go mod tidy` strips this until HOLOGRAM code actually calls the fork's new
// symbols; re-add it if it disappears.
replace github.com/deroproject/derohe => github.com/DHEBP/derohe v0.0.0-20260613172821-92b800569ca4

require (
	github.com/VictoriaMetrics/metrics v1.23.1 // indirect
	github.com/bep/debounce v1.2.1 // indirect
	github.com/blang/semver/v4 v4.0.0 // indirect
	github.com/caarlos0/env/v6 v6.10.1 // indirect
	github.com/cespare/xxhash v1.1.0 // indirect
	github.com/coder/websocket v1.8.12 // indirect
	github.com/creachadair/jrpc2 v0.35.4 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dchest/siphash v1.2.3 // indirect
	github.com/fxamacker/cbor/v2 v2.4.0 // indirect
	github.com/go-logr/logr v1.2.3 // indirect
	github.com/go-logr/zapr v1.2.3 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/google/go-cmp v0.6.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/hashicorp/golang-lru v0.5.1 // indirect
	github.com/jchv/go-winloader v0.0.0-20210711035445-715c2860da7e // indirect
	github.com/klauspost/cpuid/v2 v2.2.6 // indirect
	github.com/klauspost/reedsolomon v1.11.5 // indirect
	github.com/labstack/echo/v4 v4.13.3 // indirect
	github.com/labstack/gommon v0.4.2 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mgutz/ansi v0.0.0-20200706080929-d51e80ef957d // indirect
	github.com/minio/sha256-simd v1.0.0 // indirect
	github.com/mitchellh/colorstring v0.0.0-20190213212951-d06e56a500db // indirect
	github.com/nxadm/tail v1.4.11 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/robfig/cron/v3 v3.0.1 // indirect
	github.com/samber/lo v1.49.1 // indirect
	github.com/satori/go.uuid v1.2.0 // indirect
	github.com/schollz/progressbar/v3 v3.19.0 // indirect
	github.com/segmentio/fasthash v1.0.3 // indirect
	github.com/sirupsen/logrus v1.9.3 // indirect
	github.com/stretchr/testify v1.10.0 // indirect
	github.com/templexxx/cpu v0.1.1 // indirect
	github.com/templexxx/xorsimd v0.4.3 // indirect
	github.com/tjfoc/gmsm v1.4.1 // indirect
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fastrand v1.1.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/valyala/histogram v1.2.0 // indirect
	github.com/wailsapp/go-webview2 v1.0.22 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	github.com/x-cray/logrus-prefixed-formatter v0.5.2 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	github.com/xtaci/kcp-go/v5 v5.6.2 // indirect
	go.etcd.io/bbolt v1.3.7 // indirect
	go.uber.org/atomic v1.10.0 // indirect
	go.uber.org/multierr v1.9.0 // indirect
	go.uber.org/zap v1.24.0 // indirect
	golang.org/x/crypto v0.46.0 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.39.0 // indirect
	golang.org/x/term v0.38.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	golang.org/x/time v0.8.0 // indirect
	golang.org/x/xerrors v0.0.0-20231012003039-104605ab7028 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
