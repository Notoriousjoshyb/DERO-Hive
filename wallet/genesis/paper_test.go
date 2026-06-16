package genesis

// G2 — paper-wallet ARTIFACT build gate. Exercises the assembled certificate a
// user actually prints, not just the QR primitive:
//   - file written 0600 (it holds the plaintext seed)
//   - emitted HTML has NO external-resource references (data: URIs only)
//   - the seed renders word-by-word in escaped <span class="w"> elements
//   - all three embedded QRs round-trip through gozxing (an INDEPENDENT decoder)
//     at the PRODUCTION sizes — the silent-fund-loss guard
//
// Note: html/template escapes '+' in the base64 data URI to "&#43;" inside the
// src attribute. A browser unescapes HTML entities before parsing the data: URI,
// so to round-trip the QR the way a real reader does we html.UnescapeString each
// src. This is a test-fidelity requirement, not a defect in paper.go.

import (
	"bytes"
	"encoding/base64"
	"html"
	"image"
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

func TestWritePaperWallet_Artifact(t *testing.T) {
	cleanGlobals(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "paper.html")

	if err := WritePaperWallet(path, "MAINNET", "test", testAddr, testSeed, burnedRegHex); err != nil {
		t.Fatalf("WritePaperWallet: %v", err)
	}

	// (1) 0600 perms — the file holds the plaintext seed.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("paper wallet perms = %o, want 0600", perm)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	doc := string(raw)

	// (2) no external resources — the whole point of "genuinely offline".
	forbidden := regexp.MustCompile(`(?i)(<script|<link|@import|src\s*=\s*["']https?:|href\s*=\s*["']https?:|url\(\s*["']?https?:|integrity\s*=|crossorigin|fetch\(|xmlhttprequest)`)
	if m := forbidden.FindString(doc); m != "" {
		t.Fatalf("emitted HTML contains an external-resource reference: %q", m)
	}
	for _, src := range imgSrcs(doc) {
		if !strings.HasPrefix(src, "data:image/") {
			t.Fatalf("img src is not a data: URI: %.40q", src)
		}
	}

	// (3) the seed renders word-by-word in escaped word-spans (NOT a contiguous
	// string — a substring check for the whole seed would wrongly fail).
	for _, w := range strings.Fields(testSeed) {
		if !strings.Contains(doc, `<span class="w">`+w+`</span>`) {
			t.Fatalf("seed word %q not rendered in an escaped word-span", w)
		}
	}

	// (4) the three embedded QRs round-trip at PRODUCTION sizes.
	srcs := imgSrcs(doc)
	if len(srcs) < 3 {
		t.Fatalf("expected 3 embedded QR images, found %d", len(srcs))
	}
	want := map[string]string{testAddr: "address", testSeed: "seed", burnedRegHex: "tx"}
	decoded := map[string]bool{}
	for _, src := range srcs {
		decoded[decodeQR(t, src)] = true
	}
	for content, label := range want {
		if !decoded[content] {
			t.Fatalf("production QR for %s did not round-trip from the assembled artifact", label)
		}
	}
}

// imgSrcs extracts every <img ... src="..."> value, HTML-unescaping it (so the
// base64 data URI is decodable the way a browser would see it).
var imgSrcRe = regexp.MustCompile(`(?is)<img[^>]*\ssrc\s*=\s*"([^"]*)"`)

func imgSrcs(doc string) []string {
	var out []string
	for _, m := range imgSrcRe.FindAllStringSubmatch(doc, -1) {
		out = append(out, html.UnescapeString(m[1]))
	}
	return out
}

// decodeQR turns a data: URI back into its text via gozxing — an INDEPENDENT
// decoder from the skip2/go-qrcode encoder. A QR that renders but decodes to
// truncated/mangled data would be silent fund loss; this catches it.
func decodeQR(t *testing.T, dataURI string) string {
	t.Helper()
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURI, prefix) {
		t.Fatalf("unexpected data URI prefix: %.30q", dataURI)
	}
	rawPNG, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURI, prefix))
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	img, _, err := image.Decode(bytes.NewReader(rawPNG))
	if err != nil {
		t.Fatalf("png decode: %v", err)
	}
	bmp, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		t.Fatalf("bitmap: %v", err)
	}
	res, err := qrcode.NewQRCodeReader().Decode(bmp, nil)
	if err != nil {
		t.Fatalf("qr decode: %v", err)
	}
	return res.GetText()
}
