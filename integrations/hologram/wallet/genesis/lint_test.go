package genesis

// Forbidden-import lint — the REAL pin behind gates G5 and the offline
// guarantee (review [M5]/[M6]). The runtime non-collision test (G5) is only a
// coarse tripwire; this AST check is what actually prevents a regression:
//   - math/rand as an entropy source would silently destroy key unpredictability
//     even though addresses still look distinct.
//   - SetOnlineMode/Connect/SetDaemonAddress in this package would open a network
//     path on the cold wallet. (The import lint is necessary-but-not-sufficient
//     for offline — the non-escape invariant in genesis.go is the rest.)
//
// This scans the package's own non-test source files; it does not recurse into
// dependencies.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNoForbiddenImports(t *testing.T) {
	forbidden := map[string]string{
		"math/rand": "use crypto/rand — math/rand would destroy key entropy",
	}

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue // lint the package's shipping code, not the tests
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		file, err := parser.ParseFile(fset, f, src, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		for _, imp := range file.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			if reason, bad := forbidden[path]; bad {
				t.Errorf("%s imports forbidden package %q: %s", f, path, reason)
			}
		}
	}
}

// TestNoOnlineModeCalls asserts the genesis package never references the symbols
// that would put a wallet online. This is a source-text check (cheap, robust to
// refactors of the symbols' definitions). Necessary but not sufficient — see the
// non-escape invariant in genesis.go.
func TestNoOnlineModeCalls(t *testing.T) {
	forbidden := []string{"SetOnlineMode", "SetDaemonAddress"}
	// Note: "Connect" is too generic to grep safely; the import lint + non-escape
	// invariant cover the daemon-connection path. SetOnlineMode is the only
	// function that starts the sync goroutine, so it is the load-bearing one.

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, f, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			for _, name := range forbidden {
				if sel.Sel.Name == name {
					t.Errorf("%s references forbidden online-mode symbol %q", f, name)
				}
			}
			return true
		})
	}
}
