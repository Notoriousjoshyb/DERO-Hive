// Copyright 2017-2025 DERO Project. All rights reserved.
// Security enhancement: Payload proof validation
// Prevents fake proofs with impossible amounts

package main

import (
	"fmt"
)

const (
	// Maximum safe value for int64 conversion (2^63 - 1)
	// Prevents uint64 to int64 wraparound attacks
	MAX_INT64_SAFE = 9223372036854775807

	// For display and calculations: 1 DERO = 100,000 atomic units
	// (matches derohe globals.go and GetInfo RPC supply conversion)
	ATOMIC_UNITS_PER_DERO = 100_000

	// Maximum reasonable transfer amount in atomic units
	// DERO hard cap: 21M DERO (like Bitcoin, this will never increase)
	// Setting max at 22M DERO = ~5% above hard cap.
	// Blocks impossible amounts while leaving a buffer.
	MAX_REASONABLE_AMOUNT_ATOMIC = 22_000_000 * ATOMIC_UNITS_PER_DERO // 2_200_000_000_000

	// Hard cap reference
	DERO_HARD_CAP_ATOMIC = 21_000_000 * ATOMIC_UNITS_PER_DERO // 2_100_000_000_000

	// Current approximate circulating supply (for context display)
	// This is approximate - actual supply can be queried from daemon
	CURRENT_SUPPLY_APPROX_ATOMIC = 16_500_000 * ATOMIC_UNITS_PER_DERO // 1_650_000_000_000
)

// ProofValidationResult holds the validation result with context
type ProofValidationResult struct {
	Valid           bool
	Error           string
	Warnings        []string
	SupplyContext   string  // e.g., "This is 12.5% of total DERO supply"
	PercentOfSupply float64 // Percentage of current supply
}

// ValidatePayloadProofAmount performs security checks on payload proof amounts
// Prevents:
//   - uint64 to int64 wraparound attacks
//   - Impossibly large amounts (exceeding total supply hard cap)
//   - False accusations based on fake proofs
func ValidatePayloadProofAmount(amount uint64) error {
	// Check 1: Prevent int64 wraparound
	// Historical context: Some code paths use SetInt64(int64(amount))
	// For amounts >= 2^63, this wraps to negative values
	if amount > MAX_INT64_SAFE {
		return fmt.Errorf("amount exceeds maximum safe integer - possible wraparound attack")
	}

	// Check 2: Sanity check against DERO hard cap
	// DERO has a permanent hard cap of 21M (like Bitcoin)
	// Any amount > 21M DERO is mathematically impossible
	// We use 22M to give a small buffer while blocking obvious fakes
	if amount > MAX_REASONABLE_AMOUNT_ATOMIC {
		amountInDero := amount / ATOMIC_UNITS_PER_DERO
		return fmt.Errorf("amount %d DERO exceeds DERO hard cap (21M) - proof is fabricated",
			amountInDero)
	}

	return nil
}

// ValidatePayloadProofAmountWithContext performs validation and returns detailed context
func ValidatePayloadProofAmountWithContext(amount uint64) ProofValidationResult {
	result := ProofValidationResult{
		Valid:    true,
		Warnings: []string{},
	}

	// Run basic validation
	if err := ValidatePayloadProofAmount(amount); err != nil {
		result.Valid = false
		result.Error = err.Error()
		return result
	}

	// Calculate percentage of supply
	percentOfSupply := float64(amount) / float64(CURRENT_SUPPLY_APPROX_ATOMIC) * 100
	result.PercentOfSupply = percentOfSupply

	// Generate supply context string
	if percentOfSupply >= 1.0 {
		result.SupplyContext = fmt.Sprintf("%.1f%% of current DERO supply", percentOfSupply)
	} else if percentOfSupply >= 0.01 {
		result.SupplyContext = fmt.Sprintf("%.2f%% of current DERO supply", percentOfSupply)
	}

	// Collect warnings
	result.Warnings = DetectSuspiciousProofPatterns(amount)

	return result
}

// DetectSuspiciousProofPatterns flags potentially fake or suspicious proofs
// Returns warnings for amounts that might warrant additional scrutiny
func DetectSuspiciousProofPatterns(amount uint64) []string {
	var warnings []string

	// Warning 1: Near int64 boundary (possible wraparound attempt)
	boundaryThreshold := uint64(MAX_INT64_SAFE * 9 / 10) // Within 90% of wraparound
	if amount > boundaryThreshold {
		warnings = append(warnings,
			"Amount near int64 maximum - possible wraparound attempt")
	}

	// Warning 2: Exceeds current circulating supply (~16.5M)
	// This is suspicious but not impossible (could be legitimate edge case)
	if amount > CURRENT_SUPPLY_APPROX_ATOMIC {
		amountDero := amount / ATOMIC_UNITS_PER_DERO
		warnings = append(warnings,
			fmt.Sprintf("Amount (%d DERO) exceeds current circulating supply - verify carefully", amountDero))
	}

	// Warning 3: Very large amount (> 1M DERO) - not fake, just notable
	largeThreshold := uint64(1_000_000 * ATOMIC_UNITS_PER_DERO) // 1M DERO
	if amount > largeThreshold && amount <= CURRENT_SUPPLY_APPROX_ATOMIC {
		amountDero := amount / ATOMIC_UNITS_PER_DERO
		warnings = append(warnings,
			fmt.Sprintf("Large transfer amount: %d DERO", amountDero))
	}

	// Warning 4: Suspiciously round number in trillions (often fabricated)
	if amount >= 1_000_000_000_000 && amount%1_000_000_000_000 == 0 {
		amountDero := amount / ATOMIC_UNITS_PER_DERO
		warnings = append(warnings,
			fmt.Sprintf("Suspiciously round number (%d DERO exactly)", amountDero))
	}

	return warnings
}

