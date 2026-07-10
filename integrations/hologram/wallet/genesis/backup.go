package genesis

// Cold-wallet backup artifact — a plain, auditable .txt file.
//
// Format chosen deliberately (the "Tim May" decision): a text file you can open
// in any editor and verify with your own eyes that your seed is present and
// nothing else is. No browser (an HTML file opens in a networked app), no PDF
// (an opaque binary you can't audit), no rendering dependency to produce it.
//
//   - The 25-word seed is written human-readable for hand-transcription to metal.
//   - The registration is written as a copy-pasteable DCSP: string (it is NOT
//     secret), so the 202-char hex never has to be hand-typed on the hot side.
//   - No QR codes: the readable seed is transcribed by hand and the registration
//     travels as the pastable DCSP: string, so this artifact stays pure text.

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// RenderBackupText builds the cold-wallet backup as plain UTF-8 text. created is
// caller-supplied (the subpackage takes no clock); pass the genesis timestamp.
// registrationHex may be empty (the address can be backed up before it is mined),
// in which case the registration section is omitted.
func RenderBackupText(network Network, created int64, address, seed, registrationHex string) (string, error) {
	var b strings.Builder

	line := strings.Repeat("=", 64)
	b.WriteString(line + "\n")
	b.WriteString("  DERO COLD WALLET — OFFLINE BACKUP\n")
	b.WriteString(fmt.Sprintf("  network: %s   created: %s\n", network, time.Unix(created, 0).UTC().Format("2006-01-02 15:04 UTC")))
	b.WriteString(line + "\n\n")

	b.WriteString("ADDRESS (public, safe to share)\n")
	b.WriteString("  " + address + "\n\n")

	b.WriteString(strings.Repeat("-", 64) + "\n")
	b.WriteString("RECOVERY SEED — SECRET. Anyone who reads these 25 words can\n")
	b.WriteString("take everything. Transcribe to paper or metal, then destroy\n")
	b.WriteString("this file. Never store it on a networked device.\n")
	b.WriteString(strings.Repeat("-", 64) + "\n\n")

	// Numbered grid — for reading and hand-transcription to paper/metal.
	words := strings.Fields(seed)
	for i, w := range words {
		// 5 words per line, numbered, padded for alignment.
		b.WriteString(fmt.Sprintf("%2d. %-12s", i+1, w))
		if (i+1)%5 == 0 {
			b.WriteString("\n")
		}
	}
	if len(words)%5 != 0 {
		b.WriteString("\n")
	}
	b.WriteString("\n")

	// Paste-ready line — the same 25 words, space-joined and unnumbered, alone on
	// its own line so it can be triple-click-selected and pasted straight into a
	// wallet's restore field. (The numbered grid above does NOT paste cleanly —
	// its numbers would be read as extra words.)
	b.WriteString("To restore by PASTE, copy the single line below (the 25 words only):\n\n")
	b.WriteString(strings.Join(words, " ") + "\n\n")

	if registrationHex != "" {
		blob, err := EncodeRegistrationDCSP(network, created, address, registrationHex)
		if err != nil {
			return "", fmt.Errorf("encode registration: %w", err)
		}
		b.WriteString(strings.Repeat("-", 64) + "\n")
		b.WriteString("REGISTRATION (not secret) — broadcast once from an online\n")
		b.WriteString("device to activate this address. In HOLOGRAM: Wallet ▸\n")
		b.WriteString("Broadcast registration ▸ paste the line below ▸ send.\n")
		b.WriteString(strings.Repeat("-", 64) + "\n\n")
		b.WriteString(blob + "\n\n")
	}

	b.WriteString("Recover with the official DERO wallet using the 25 words above.\n")
	b.WriteString("Generated offline by HOLOGRAM. Cold wallet lineage:\n")
	b.WriteString("Slixe / mmarcel / Dirtybird. DERO Research License.\n")

	return b.String(), nil
}

// WriteBackupText renders the backup and writes it to path at 0600 (it holds the
// plaintext seed). The caller owns the path (e.g. from a Save dialog).
func WriteBackupText(path string, network Network, created int64, address, seed, registrationHex string) error {
	txt, err := RenderBackupText(network, created, address, seed, registrationHex)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(txt), 0600)
}
