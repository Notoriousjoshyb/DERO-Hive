package genesis

// Offline paper wallet — a self-contained HTML recovery certificate. Every asset
// (CSS, QR images) is inlined as a data: URI, so the page makes ZERO network
// requests and is safe to open/print on an air-gapped machine. The file holds
// the plaintext seed and is written 0600.
//
// Ported from the coldwallet fork's paper.go (lineage: Slixe → mmarcel/8lecramm
// → Dirtybird99, DERO Research License v1.1.2 non-commercial). The HTML/CSS is
// the fork's print-optimized certificate; a HOLOGRAM design-system restyle is a
// separate follow-up. Logic is unchanged except: the footer credits HOLOGRAM +
// the lineage, and rendering is split from file-writing so the caller controls
// the destination (Save dialog).

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html/template"
	"os"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// qrDataURI renders content as a PNG QR code and returns it as a base64 data:
// URI for inline embedding (no external requests, fully offline).
func qrDataURI(content string, size int) (template.URL, error) {
	png, err := qrcode.Encode(content, qrcode.Medium, size)
	if err != nil {
		return "", err
	}
	return template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png)), nil
}

type paperData struct {
	Network   string
	Version   string
	Address   string
	Seed      string
	SeedWords []string
	TxHex     string
	HasTx     bool
	AddressQR template.URL
	SeedQR    template.URL
	TxQR      template.URL
}

// Production QR sizes (the G2 gate round-trips at exactly these).
const (
	qrSizeAddress = 280
	qrSizeSeed    = 360
	qrSizeTx      = 280
)

// RenderPaperWallet builds the self-contained offline HTML certificate as bytes.
// It does not touch the filesystem — WritePaperWallet does that at 0600. Keeping
// render separate keeps it testable and lets the caller decide the destination.
func RenderPaperWallet(network, version, address, seed, txHex string) ([]byte, error) {
	d := paperData{
		Network:   network,
		Version:   version,
		Address:   address,
		Seed:      seed,
		SeedWords: strings.Fields(seed),
		TxHex:     txHex,
		HasTx:     txHex != "",
	}

	var err error
	if d.AddressQR, err = qrDataURI(address, qrSizeAddress); err != nil {
		return nil, fmt.Errorf("address QR: %w", err)
	}
	if d.SeedQR, err = qrDataURI(seed, qrSizeSeed); err != nil {
		return nil, fmt.Errorf("seed QR: %w", err)
	}
	if d.HasTx {
		if d.TxQR, err = qrDataURI(txHex, qrSizeTx); err != nil {
			return nil, fmt.Errorf("tx QR: %w", err)
		}
	}

	tmpl, err := template.New("paper").Funcs(template.FuncMap{
		"add": func(a, b int) int { return a + b },
	}).Parse(paperTemplate)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, d); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// WritePaperWallet renders the certificate and writes it to path at 0600 (the
// file holds the plaintext seed). The caller owns the path (e.g. from a Save
// dialog) and is responsible for telling the user to destroy the file after
// printing.
func WritePaperWallet(path, network, version, address, seed, txHex string) error {
	html, err := RenderPaperWallet(network, version, address, seed, txHex)
	if err != nil {
		return err
	}
	return os.WriteFile(path, html, 0600)
}

const paperTemplate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DERO Cold Wallet, {{.Network}}</title>
<style>
  :root {
    --paper: oklch(0.987 0.004 95);
    --ink:   oklch(0.205 0.012 265);
    --ink-2: oklch(0.205 0.012 265 / 0.62);
    --hair:  oklch(0.205 0.012 265 / 0.85);
    --faint: oklch(0.205 0.012 265 / 0.18);
    --danger: oklch(0.46 0.165 27);
    --danger-faint: oklch(0.46 0.165 27 / 0.10);
    --mono: ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, Menlo, monospace;
    --serif: Georgia, "Times New Roman", "Liberation Serif", serif;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: oklch(0.93 0.006 95);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.45;
    padding: 24px;
  }
  .sheet {
    background: var(--paper);
    width: 190mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 14mm 14mm 12mm;
    border: 1px solid var(--hair);
    box-shadow: 0 1px 0 var(--faint), 0 24px 60px -40px var(--ink);
    position: relative;
  }
  .sheet::before {
    content: ""; position: absolute; inset: 6mm;
    border: 1px solid var(--faint);
    pointer-events: none;
  }
  .sheet > * { position: relative; }
  header {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 16px;
    border-bottom: 3px double var(--hair);
    padding-bottom: 10px;
  }
  .mark { display: flex; flex-direction: column; gap: 2px; }
  .mark .title {
    font-family: var(--serif);
    font-size: 25px; font-weight: 700; letter-spacing: 0.01em;
    line-height: 1.05;
  }
  .mark .sub {
    font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ink-2);
  }
  .badge {
    font-family: var(--mono); font-size: 11px; font-weight: 700;
    letter-spacing: 0.18em;
    border: 1.5px solid var(--ink); border-radius: 2px;
    padding: 5px 10px; white-space: nowrap;
  }
  .badge.testnet { border-color: var(--danger); color: var(--danger); }
  .label {
    font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--ink-2); font-weight: 700;
  }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
  .qr { width: 116px; height: 116px; display: block; image-rendering: pixelated; }
  .qr-cap { text-align: center; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-2); margin-top: 3px; }
  .data {
    font-family: var(--mono); font-size: 12.5px; line-height: 1.5;
    word-break: break-all; border: 1px solid var(--hair); border-radius: 2px;
    padding: 9px 11px; background: oklch(0.987 0.004 95);
  }
  .public { margin-top: 16px; }
  .public .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .public .head .tag {
    font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
    border: 1px solid var(--hair); border-radius: 999px; padding: 1px 7px; color: var(--ink-2);
  }
  .vault {
    margin-top: 16px;
    border: 2px solid var(--danger);
    border-radius: 3px;
    padding: 0;
    position: relative;
    background:
      repeating-linear-gradient(45deg, var(--danger-faint) 0 8px, transparent 8px 16px);
    break-inside: avoid;
  }
  .vault::before, .vault::after {
    content: ""; position: absolute; left: 0; right: 0; height: 7px;
    background: repeating-linear-gradient(-45deg, var(--danger) 0 6px, transparent 6px 12px);
    opacity: 0.5;
  }
  .vault::before { top: -2px; } .vault::after { bottom: -2px; }
  .vault-inner { background: var(--paper); margin: 7px; padding: 12px 14px; border-radius: 2px; }
  .vault-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
  .vault-head .t {
    font-family: var(--serif); font-weight: 700; font-size: 16px; color: var(--danger);
    letter-spacing: 0.02em;
  }
  .vault-head .t .stamp {
    font-family: var(--mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.22em;
    border: 1.5px solid var(--danger); color: var(--danger);
    padding: 2px 6px; border-radius: 2px; margin-left: 8px; vertical-align: 2px;
  }
  .vault-head .note { font-size: 9.5px; color: var(--ink-2); max-width: 38ch; text-align: right; padding-right: 2px; }
  .words {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 9px 24px;
    width: 100%;
  }
  .word {
    display: flex; align-items: baseline; gap: 7px; min-width: 0; white-space: nowrap;
    font-family: var(--mono); font-size: 11.5px;
    border-bottom: 1px solid var(--faint); padding-bottom: 3px;
  }
  .word .n { font-size: 8.5px; color: var(--ink-2); width: 15px; text-align: right; font-variant-numeric: tabular-nums; }
  .word .w { font-weight: 600; }
  .seed-qr { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--faint); }
  .seed-qr .restore { font-size: 9.5px; color: var(--ink-2); max-width: 28ch; }
  .reg { margin-top: 16px; break-inside: avoid; }
  .reg .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .reg .hex { font-size: 11px; }
  .fold {
    margin: 18px 0 14px; border-top: 1px dashed var(--hair);
    text-align: center; position: relative;
  }
  .fold span {
    position: relative; top: -8px; background: var(--paper); padding: 0 10px;
    font-size: 8.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-2);
  }
  .guide { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 26px; }
  .guide li { font-size: 10.5px; line-height: 1.5; }
  .guide .danger { color: var(--danger); font-weight: 600; }
  footer {
    margin-top: 14px; padding-top: 9px; border-top: 1px solid var(--hair);
    display: flex; justify-content: space-between; gap: 12px;
    font-size: 9px; color: var(--ink-2); letter-spacing: 0.04em;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border: none; width: auto; padding: 6mm; }
    .sheet::before { inset: 3mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @page { size: A4; margin: 8mm; }
</style>
</head>
<body>
<main class="sheet">
  <header>
    <div class="mark">
      <div class="title">DERO Cold Wallet</div>
      <div class="sub">Offline recovery certificate</div>
    </div>
    <div class="badge {{if ne .Network "MAINNET"}}testnet{{end}}">{{.Network}}</div>
  </header>

  <section class="public">
    <div class="head">
      <span class="label">Wallet address</span>
      <span class="tag">Public, safe to share</span>
    </div>
    <div class="row">
      <div class="data">{{.Address}}</div>
      <div><img class="qr" alt="Address QR" src="{{.AddressQR}}"><div class="qr-cap">Address</div></div>
    </div>
  </section>

  <section class="vault">
    <div class="vault-inner">
      <div class="vault-head">
        <div class="t">Recovery Seed <span class="stamp">SECRET</span></div>
        <div class="note">These 25 words alone control the funds. Anyone who reads them can take everything.</div>
      </div>
      <div class="words">
        {{range $i, $w := .SeedWords}}<div class="word"><span class="n">{{add $i 1}}</span><span class="w">{{$w}}</span></div>{{end}}
      </div>
      <div class="seed-qr">
        <div><img class="qr" alt="Seed QR (secret)" src="{{.SeedQR}}"><div class="qr-cap">Seed, secret</div></div>
        <div class="restore">Scanning this code reveals the secret seed. Treat the QR exactly like the words.</div>
      </div>
    </div>
  </section>

  {{if .HasTx}}
  <section class="reg">
    <div class="head">
      <span class="label">Account registration</span>
      <span class="tag">Not secret</span>
    </div>
    <div class="row">
      <div class="data hex">{{.TxHex}}</div>
      <div><img class="qr" alt="Registration QR" src="{{.TxQR}}"><div class="qr-cap">Registration</div></div>
    </div>
  </section>
  {{end}}

  <div class="fold"><span>Fold here, seed inwards</span></div>

  <ul class="guide" style="list-style:none;padding:0;margin:0">
    <li class="danger">Write the seed onto metal. Store copies in separate secure places.</li>
    <li class="danger">Never type, photograph, or store the seed on any online device.</li>
    <li>The address and registration are public. Only the seed is secret.</li>
    <li>Broadcast the registration once to activate the address before funding.</li>
    <li>Destroy the file this sheet was printed from. Keep only paper or metal.</li>
    <li>Recover with the official DERO wallet using the 25 words above.</li>
  </ul>

  <footer>
    <span>Generated offline by HOLOGRAM, {{.Version}}</span>
    <span>Cold wallet lineage: Slixe / mmarcel / Dirtybird. DERO Research License.</span>
  </footer>
</main>
</body>
</html>
`
