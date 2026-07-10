package main

import (
	"encoding/hex"
	"strings"
)

// normalizeDEROGetSCResult decodes printable ASCII string values from
// DERO.GetSC variable maps to preserve legacy client behavior.
func normalizeDEROGetSCResult(result interface{}) interface{} {
	resultMap, ok := result.(map[string]interface{})
	if !ok {
		return result
	}

	normalizeGetSCMapField(resultMap, "stringkeys")
	normalizeGetSCMapField(resultMap, "uint64keys")
	return resultMap
}

func normalizeGetSCMapField(resultMap map[string]interface{}, field string) {
	raw, ok := resultMap[field]
	if !ok {
		return
	}

	values, ok := raw.(map[string]interface{})
	if !ok {
		return
	}

	normalized := make(map[string]interface{}, len(values))
	for key, value := range values {
		if strValue, ok := value.(string); ok {
			normalized[key] = decodePrintableHexString(strValue)
		} else {
			normalized[key] = value
		}
	}

	resultMap[field] = normalized
}

func decodePrintableHexString(value string) string {
	trimmed := strings.TrimSpace(value)
	if !shouldDecodeHexString(trimmed) {
		return value
	}
	decimalOnly := isDecimalString(trimmed)

	decoded, err := hex.DecodeString(trimmed)
	if err != nil {
		return value
	}

	if !isPrintableASCII(decoded) {
		return value
	}

	decodedText := strings.TrimRight(string(decoded), "\x00 \t\n\r")
	if decodedText == "" {
		return value
	}
	// Keep short decimal strings as numbers ("50" should stay numeric).
	if decimalOnly && len(decodedText) == 1 {
		return value
	}
	// Decimal-only hex should decode only when it clearly becomes text.
	if decimalOnly && !containsASCIIAlpha(decodedText) {
		return value
	}

	return decodedText
}

func shouldDecodeHexString(value string) bool {
	if value == "" || len(value)%2 != 0 || len(value) < 4 {
		return false
	}

	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}

	return true
}

func isPrintableASCII(data []byte) bool {
	if len(data) == 0 {
		return false
	}

	for _, b := range data {
		if b < 32 || b > 126 {
			return false
		}
	}

	return true
}

func isDecimalString(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func containsASCIIAlpha(value string) bool {
	for _, c := range value {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			return true
		}
	}
	return false
}
