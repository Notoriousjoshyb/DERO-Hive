package genesis

// Backup artifact gate (replaces the retired HTML G2). The .txt backup must be:
//   - 0600 (it holds the plaintext seed)
//   - plainly auditable: all 25 seed words present and readable, address present
//   - carry the registration as a DCSP: string that decodes back to a valid
//     registration (so the hot side can broadcast it with no hand-typing)
//   - genuinely text (no HTML tags, no binary)

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupText_Artifact(t *testing.T) {
	cleanGlobals(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "backup.txt")

	if err := WriteBackupText(path, NetworkMainnet, fixedTS, testAddr, testSeed, burnedRegHex); err != nil {
		t.Fatalf("WriteBackupText: %v", err)
	}

	// (1) 0600 perms.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("backup perms = %o, want 0600", perm)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	doc := string(raw)

	// (2) address present, every seed word present and readable.
	if !strings.Contains(doc, testAddr) {
		t.Fatal("address not in backup")
	}
	for _, w := range strings.Fields(testSeed) {
		if !strings.Contains(doc, w) {
			t.Fatalf("seed word %q missing from backup", w)
		}
	}

	// (3) the registration is present as a DCSP: string that decodes to a valid
	// registration — the real recovery/broadcast guarantee.
	idx := strings.Index(doc, "DCSP:")
	if idx < 0 {
		t.Fatal("no DCSP: registration string in backup")
	}
	blob := strings.Fields(doc[idx:])[0] // the DCSP: token (whitespace-delimited)
	msg, err := DecodeDCSP(blob)
	if err != nil {
		t.Fatalf("backup's DCSP blob did not decode: %v", err)
	}
	if _, err := ValidateForBroadcast(msg, NetworkMainnet); err != nil {
		t.Fatalf("backup's registration is not broadcast-valid: %v", err)
	}

	// (4) it is plain text — no HTML/binary leaked in.
	if strings.Contains(doc, "<html") || strings.Contains(doc, "<script") || strings.Contains(doc, "data:image") {
		t.Fatal("backup contains markup/binary — must be plain text")
	}

	// (5) PASTE-RECOVERY guard: there must be a line that is EXACTLY the 25 seed
	// words space-joined (no numbering), so the seed pastes back as 25 tokens —
	// not 50. This regresses the numbered-grid paste bug.
	wantLine := strings.Join(strings.Fields(testSeed), " ")
	var found bool
	for _, ln := range strings.Split(doc, "\n") {
		if strings.TrimSpace(ln) == wantLine {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("no paste-ready 25-word line in backup — pasting the file would miscount the seed")
	}
	// and that line, split the way the restore field splits, must be 25 tokens.
	if n := len(strings.Fields(wantLine)); n != 25 {
		t.Fatalf("paste-ready line has %d tokens, want 25", n)
	}
}

func TestBackupText_OmitsRegistrationWhenEmpty(t *testing.T) {
	cleanGlobals(t)
	txt, err := RenderBackupText(NetworkMainnet, fixedTS, testAddr, testSeed, "")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(txt, "DCSP:") {
		t.Fatal("no registration supplied — backup must not contain a DCSP string")
	}
	if !strings.Contains(txt, testAddr) {
		t.Fatal("address should still be present without a registration")
	}
}
