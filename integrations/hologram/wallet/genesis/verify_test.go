package genesis

// Tests for the offline verify path. Uses the burned mainnet vector (address +
// registration). Covers the fund-safety check (address match), the registration
// checks (valid + binds), and the failure modes that matter: wrong address,
// wrong network rendering ([G3]), and a registration that does not bind.

import "testing"

func TestVerify_BurnedVector_AllChecksPass(t *testing.T) {
	cleanGlobals(t)
	res, err := Verify(testSeed, testAddr, NetworkMainnet, burnedRegHex)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !res.AddressMatch {
		t.Fatal("address should match for the burned vector")
	}
	if !res.HasRegistration || !res.RegistrationValid || !res.BindsToKey {
		t.Fatalf("registration checks failed: %+v", res)
	}
}

func TestVerify_WrongAddress_NoMatch(t *testing.T) {
	cleanGlobals(t)
	wrong := "dero1qyfez0fm768fmp9tele8crqnvq59jgmjcx07y85y9x8mv0a43fss2qgx3n4XX"
	res, err := Verify(testSeed, wrong, NetworkMainnet, "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if res.AddressMatch {
		t.Fatal("a corrupted address must NOT match — this guards against silent fund loss")
	}
}

// [G3]: a correct seed rendered for the WRONG network must report no match
// (deto1 vs dero1) — and rendered for the RIGHT network must match. Proves the
// network is threaded through, not hardcoded.
func TestVerify_NetworkRendering(t *testing.T) {
	cleanGlobals(t)

	// burned addr is mainnet (dero1...); verifying it as simulator must NOT match.
	resSim, err := Verify(testSeed, testAddr, NetworkSimulator, "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if resSim.AddressMatch {
		t.Fatal("mainnet address must not match when rendered as simulator (deto1)")
	}

	// and the mainnet rendering must match (already covered, but assert here too).
	resMain, _ := Verify(testSeed, testAddr, NetworkMainnet, "")
	if !resMain.AddressMatch {
		t.Fatal("mainnet address must match when rendered as mainnet")
	}
}

// A registration that belongs to a DIFFERENT wallet must not bind, even though
// it is itself a valid registration.
func TestVerify_RegistrationDoesNotBindForeignKey(t *testing.T) {
	cleanGlobals(t)

	// Generate a fresh wallet; verify the BURNED registration against IT. The
	// burned reg is valid, but it binds to the burned key, not this fresh one.
	fresh, err := Generate(NetworkMainnet, 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	res, err := Verify(fresh.Seed, fresh.Address, NetworkMainnet, burnedRegHex)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !res.AddressMatch {
		t.Fatal("fresh wallet's own address should match")
	}
	if res.BindsToKey {
		t.Fatal("the burned registration must NOT bind to a different wallet's key")
	}
	// it is still a structurally valid registration signature...
	if !res.RegistrationValid {
		t.Fatal("the burned registration is a valid signature regardless of binding")
	}
}

func TestVerify_BadSeed_Errors(t *testing.T) {
	cleanGlobals(t)
	if _, err := Verify("not a real seed", testAddr, NetworkMainnet, ""); err == nil {
		t.Fatal("an unparseable seed must return an error")
	}
}

func TestVerify_BadRegistrationHex_Errors(t *testing.T) {
	cleanGlobals(t)
	if _, err := Verify(testSeed, testAddr, NetworkMainnet, "nothex!!"); err == nil {
		t.Fatal("undecodable registration hex must return an error")
	}
}
