package main

import (
	"fmt"
	"regexp"
	"strings"
)

// TELADeploymentError represents a TELA-specific deployment error with detailed help
type TELADeploymentError struct {
	Pattern     string // Regex or string pattern to match
	Title       string // Short error title
	Description string // What happened
	Fix         string // How to fix it
	Example     string // Optional example
}

// TELADeploymentErrors contains TELA-specific error patterns with detailed guidance
var TELADeploymentErrors = []TELADeploymentError{
	// === CRITICAL: Comment wrapper issues (most common deployment failure) ===
	{
		Pattern:     `Expecting declaration of function.*found`,
		Title:       "File contains '*/' which breaks TELA deployment",
		Description: "TELA wraps your code in a DVM-BASIC comment block. If your file contains '*/' (even in a string), it prematurely closes the comment and the parser tries to read your code as DVM-BASIC.",
		Fix:         "Replace '*/' with '*' + '/' in your source code (string concatenation).",
		Example:     "Before: line.startsWith('*/')\nAfter:  line.startsWith('*' + '/')",
	},
	{
		Pattern:     `invalid char literal`,
		Title:       "File contains characters that break TELA parsing",
		Description: "Your file contains special characters that the DVM-BASIC parser cannot handle. This usually happens when '*/' appears in your code.",
		Fix:         "Check for '*/' in strings and replace with '*' + '/' (string concatenation).",
		Example:     "",
	},
	{
		Pattern:     `literal not terminated`,
		Title:       "Unterminated string in TELA wrapper",
		Description: "The TELA comment wrapper was broken by content in your file, causing a parsing error.",
		Fix:         "Check for '*/' anywhere in your file and replace with '*' + '/'.",
		Example:     "",
	},

	// === Unicode/Character encoding issues (causes daemon crashes!) ===
	{
		Pattern:     `unicode|non-ascii|encoding error|invalid.*character`,
		Title:       "File contains Unicode characters",
		Description: "Your file contains non-ASCII characters (smart quotes, emojis, special symbols) that can crash the DERO daemon or cause parsing errors.",
		Fix:         "Replace Unicode characters with ASCII equivalents. Common culprits: smart quotes, em dash (use --), ellipsis (use ...).",
		Example:     "Before: const msg = [smart-quote]Hello [em-dash] world[smart-quote]\nAfter:  const msg = \"Hello -- world\"",
	},
	{
		Pattern:     `graviton.*panic|daemon.*crash|simulator.*crash`,
		Title:       "Daemon crashed during deployment",
		Description: "The simulator daemon process became unavailable during deployment. This can be caused by malformed DOC content, SC parse/execution failures, or simulator connection instability.",
		Fix:         "Check deploy logs around the first failing file and look for DVM parse errors (e.g., \"Expecting declaration of function\"). Also ensure files are ASCII-safe and do not contain '*/' inside raw DOC content.",
		Example:     "",
	},

	// === Size limit errors ===
	{
		Pattern:     `file.*too.*large|exceeds.*limit|size.*exceeded|docCode size is to large|DOC SC size is to large`,
		Title:       "File too large for TELA deployment",
		Description: "The file exceeds the maximum size allowed for TELA deployment. DOC files must be under 18KB, INDEX files under ~11.64KB.",
		Fix:         "Enable compression during deployment, or split large files using DocShards. Minify JS/CSS to reduce size.",
		Example:     "Size limits:\n• DOC: 18KB max (19.2KB total with wrapper)\n• INDEX: 11.64KB max\n• Shard: 17,500 bytes",
	},
	{
		Pattern:     `contract exceeds max INDEX install size`,
		Title:       "INDEX too large",
		Description: "Your TELA INDEX contract exceeds the maximum allowed size. This happens when you have too many DOCs or long metadata.",
		Fix:         "Reduce the number of DOCs in your INDEX, or shorten file names and descriptions.",
		Example:     "",
	},

	// === SCID/Contract errors ===
	{
		Pattern:     `invalid SCID|SCID must be 64|Invalid hexadecimal ID|Invalid ID size`,
		Title:       "Invalid Smart Contract ID (SCID)",
		Description: "The SCID format is invalid. SCIDs must be exactly 64 hexadecimal characters (0-9, a-f).",
		Fix:         "Check that the SCID is exactly 64 characters and contains only hex characters. Remove any extra whitespace or characters.",
		Example:     "Valid SCID: f2815b442d62a055e4bb8913167e3dbce3208f300d7006aaa3a2f127b06de29d",
	},
	{
		Pattern:     `not a TELA contract|does not parse as TELA`,
		Title:       "Not a valid TELA contract",
		Description: "The smart contract at this SCID is not a valid TELA DOC or INDEX contract.",
		Fix:         "Verify you're using the correct SCID. Use tela-cli's search command to find valid TELA content.",
		Example:     "",
	},

	// === Wallet/Account errors ===
	{
		Pattern:     `Account Unregistered|account unregistered|-32098.*unregistered`,
		Title:       "Recipient wallet is not registered",
		Description: "The recipient's wallet address is not yet registered on the DERO blockchain. In DERO, addresses must be registered before they can receive transactions.",
		Fix:         "The recipient needs to register their wallet first. They can do this by clicking 'Register Now' in their wallet app (Backup & Security section). Registration uses PoW and can take a few minutes. In simulator mode, use one of the pre-seeded test wallets which are already registered.",
		Example:     "",
	},
	{
		Pattern:     `Sending to self`,
		Title:       "Cannot send to yourself",
		Description: "DERO does not allow sending transactions to your own address.",
		Fix:         "This is usually handled automatically. If you see this error, please report it as a bug.",
		Example:     "",
	},
	{
		Pattern:     `zero balance|insufficient balance|not enough`,
		Title:       "Insufficient balance",
		Description: "Your wallet does not have enough DERO for this transaction.",
		Fix:         "Add funds to your wallet. In simulator mode, wait for mining rewards (blocks are auto-mined).",
		Example:     "",
	},
	{
		Pattern:     `wallet not open|wallet is not open|no wallet`,
		Title:       "No wallet connected",
		Description: "A wallet must be connected to perform this operation.",
		Fix:         "Open a wallet file first. In simulator mode, a test wallet is usually opened automatically.",
		Example:     "",
	},
	{
		Pattern:     `incorrect password|invalid password|wrong password`,
		Title:       "Incorrect wallet password",
		Description: "The password provided for the wallet file is incorrect.",
		Fix:         "Check your password and try again. Passwords are case-sensitive.",
		Example:     "",
	},

	// === Connection/Network errors ===
	{
		Pattern:     `websocket.*close.*1006|abnormal closure.*unexpected EOF`,
		Title:       "Simulator daemon crashed (websocket conflict)",
		Description: "The simulator daemon can only handle one websocket connection at a time. Multiple connections caused it to crash.",
		Fix:         "Restart simulator mode and try again. This should be handled automatically - if it persists, please report it.",
		Example:     "",
	},
	{
		Pattern:     `connection refused|dial tcp.*connect`,
		Title:       "Cannot connect to daemon",
		Description: "Cannot establish a connection to the DERO daemon. The daemon may not be running.",
		Fix:         "Ensure the daemon is running. In simulator mode, restart simulator mode. Check that the correct port is being used.",
		Example:     "Default ports:\n• Mainnet: 10102\n• Simulator: 20000",
	},
	{
		Pattern:     `offline|not connected|daemon.*not.*respond|no daemon connection`,
		Title:       "Not connected to daemon",
		Description: "Cannot communicate with the DERO daemon.",
		Fix:         "Ensure the daemon is running. In simulator mode, restart simulator mode.",
		Example:     "",
	},
	{
		Pattern:     `timeout|timed out|context deadline exceeded`,
		Title:       "Operation timed out",
		Description: "The operation took too long to complete. The daemon may be busy or unresponsive.",
		Fix:         "Try again. If the problem persists, restart the daemon or check your network connection.",
		Example:     "",
	},

	// === Transaction build errors ===
	{
		Pattern:     `could not be built|transaction is nil`,
		Title:       "Transaction build failed",
		Description: "The transaction could not be built. This can happen if the wallet is not synced or has zero balance.",
		Fix:         "Ensure your wallet is synced and has sufficient balance. In simulator mode, wait for mining rewards.",
		Example:     "",
	},
	{
		Pattern:     `ring members|not enough ring`,
		Title:       "Not enough ring members",
		Description: "Cannot find enough ring members to build a private transaction. This can happen on a fresh blockchain with few transactions.",
		Fix:         "Wait for more blocks to be mined, then try again. In simulator mode, wait 30-60 seconds for more blocks.",
		Example:     "",
	},
	{
		Pattern:     `nonce.*mismatch|invalid nonce`,
		Title:       "Wallet nonce out of sync",
		Description: "The wallet's transaction counter is out of sync with the blockchain.",
		Fix:         "The system will retry automatically. If it persists, restart the wallet.",
		Example:     "",
	},

	// === XSWD-specific errors ===
	{
		Pattern:     `Invalid name|Invalid description`,
		Title:       "XSWD: Invalid app name or description",
		Description: "The XSWD application name or description contains invalid characters. Only ASCII characters (0-127) are allowed.",
		Fix:         "Remove Unicode characters from your app name and description. Replace smart quotes with straight quotes.",
		Example:     "Invalid: [smart-quote]My App[smart-quote] (curly quotes)\nValid:   \"My App\" (straight quotes)",
	},
	{
		Pattern:     `Invalid URL compared to origin`,
		Title:       "XSWD: URL doesn't match origin",
		Description: "The URL in your XSWD application data doesn't match the actual browser origin.",
		Fix:         "Use window.location.origin for the URL field in your application data.",
		Example:     "url: window.location.origin  // Correct\nurl: \"http://localhost:8080\"  // Wrong if running on different port",
	},
	{
		Pattern:     `requesting permissions without signature`,
		Title:       "XSWD: Permissions require signature",
		Description: "You included a permissions object in your XSWD connection but didn't provide a valid DERO signature.",
		Fix:         "Either remove the permissions field (users will be prompted for each action), or provide a valid signature.",
		Example:     "",
	},
	{
		Pattern:     `-32601.*Method not found`,
		Title:       "XSWD: Method not found",
		Description: "The RPC method you're calling doesn't exist or is misspelled.",
		Fix:         "Check the method name for typos. Common methods: DERO.GetInfo, DERO.GetBlock, GetBalance, Transfer.",
		Example:     "",
	},
	{
		Pattern:     `-32700.*Parse error`,
		Title:       "XSWD: Invalid JSON",
		Description: "The JSON in your request is malformed.",
		Fix:         "Check your JSON syntax. Use JSON.stringify() for objects.",
		Example:     "",
	},
	{
		Pattern:     `-32602.*Invalid params`,
		Title:       "XSWD: Invalid parameters",
		Description: "The parameters you passed to the RPC method are invalid or have wrong types.",
		Fix:         "Check the API documentation for the correct parameter format.",
		Example:     "",
	},

	// === Gnomon/Search errors ===
	{
		Pattern:     `gnomon not running|gnomon.*not.*started`,
		Title:       "Gnomon indexer not running",
		Description: "The Gnomon blockchain indexer is not running. It's needed for searching and discovering TELA content.",
		Fix:         "Start Gnomon from Settings, or use tela-cli with --gnomon flag.",
		Example:     "",
	},
	{
		Pattern:     `durl not found|dURL.*not.*exist`,
		Title:       "dURL not found",
		Description: "The TELA dURL you're trying to access doesn't exist on the blockchain.",
		Fix:         "Check the dURL for typos. Use Gnomon search to find available content.",
		Example:     "",
	},

	// === Gas/Fee errors ===
	{
		Pattern:     `gas limit exceeded|out of gas`,
		Title:       "Transaction ran out of gas",
		Description: "The smart contract execution exceeded the gas limit.",
		Fix:         "This shouldn't happen with normal TELA deployments. If it persists, try deploying smaller files.",
		Example:     "",
	},
	{
		Pattern:     `fee too low|gas estimate.*failed`,
		Title:       "Gas estimation failed",
		Description: "Could not estimate the gas fees for this transaction. The smart contract may have validation errors.",
		Fix:         "Check your file content for issues. The daemon validates SC code during gas estimation.",
		Example:     "",
	},
}

// DetectTELAError checks if an error matches a known TELA deployment pattern
// Returns the TELADeploymentError if found, or nil if not a known pattern
func DetectTELAError(errMsg string) *TELADeploymentError {
	if errMsg == "" {
		return nil
	}

	for i := range TELADeploymentErrors {
		pattern := TELADeploymentErrors[i].Pattern
		matched, _ := regexp.MatchString("(?i)"+pattern, errMsg)
		if matched {
			return &TELADeploymentErrors[i]
		}
	}
	return nil
}

// FormatTELAError formats a TELA deployment error with full details
func FormatTELAError(telaErr *TELADeploymentError, fileName string) string {
	if telaErr == nil {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("[Error] %s", telaErr.Title))
	if fileName != "" {
		sb.WriteString(fmt.Sprintf(" (file: %s)", fileName))
	}
	sb.WriteString("\n\n")
	sb.WriteString(fmt.Sprintf("WHAT HAPPENED:\n%s\n\n", telaErr.Description))
	sb.WriteString(fmt.Sprintf("HOW TO FIX:\n%s", telaErr.Fix))
	if telaErr.Example != "" {
		sb.WriteString(fmt.Sprintf("\n\nEXAMPLE:\n%s", telaErr.Example))
	}
	return sb.String()
}

// GetTELAErrorResponse creates a detailed error response for TELA deployment errors
func GetTELAErrorResponse(errMsg string, fileName string) map[string]interface{} {
	telaErr := DetectTELAError(errMsg)
	if telaErr != nil {
		return map[string]interface{}{
			"success":        false,
			"error":          telaErr.Title,
			"description":    telaErr.Description,
			"fix":            telaErr.Fix,
			"example":        telaErr.Example,
			"fileName":       fileName,
			"technicalError": errMsg,
			"isTELAError":    true,
		}
	}

	// Fall back to generic error handling
	return map[string]interface{}{
		"success":        false,
		"error":          FriendlyErrorString(errMsg),
		"technicalError": errMsg,
		"isTELAError":    false,
	}
}

// UserFriendlyErrors maps technical error patterns to user-friendly messages
var UserFriendlyErrors = map[string]string{
	// Network/Connection errors
	"connection refused":           "Cannot connect to the node. Make sure derod is running.",
	"connection reset":             "Connection was reset. The node may have restarted.",
	"no such host":                 "Cannot find the node. Check your network settings.",
	"network is unreachable":       "Network is unreachable. Check your internet connection.",
	"i/o timeout":                  "Connection timed out. The node may be busy or unreachable.",
	"context deadline exceeded":    "Request timed out. Try again or check your connection.",
	"context canceled":             "Operation was cancelled.",
	"dial tcp":                     "Cannot connect to the node. Is derod running?",
	"EOF":                          "Connection closed unexpectedly. Try reconnecting.",
	
	// Simulator-specific errors
	"daemon connection lost":       "Simulator daemon connection lost. Please restart simulator mode.",
	"daemon crashed":               "Simulator daemon crashed. Please restart simulator mode.",
	"daemon endpoint is invalid":   "Simulator not properly configured. Please restart simulator mode.",
	"could not be built":           "Transaction build failed. Wallet may be out of sync — please try again.",
	"more than you have":           "Amount plus network fees exceeds your balance. Try reducing the amount slightly.",
	"TX verification failed":       "Amount plus network fees exceeds your balance. Try reducing the amount slightly.",
	"simulator daemon not responding": "Simulator daemon not responding. Please restart simulator mode.",
	"websocket: close":             "Connection closed unexpectedly. Retrying...",
	"abnormal closure":             "Connection interrupted. The operation will be retried.",
	
	// Wallet errors
	"wallet not open":              "Please open a wallet first.",
	"wallet is not open":           "Please open a wallet first.",
	"wallet already open":          "A wallet is already open. Close it first.",
	"incorrect password":           "Incorrect wallet password.",
	"invalid password":             "Invalid wallet password.",
	"wallet file not found":        "Wallet file not found. Check the path.",
	"insufficient balance":         "Not enough DERO for this transaction.",
	"insufficient funds":           "Not enough DERO for this transaction.",
	"account unregistered":         "Recipient's wallet is not registered on-chain. They need to open their wallet and click 'Register Now' (in Backup & Security) before they can receive DERO.",
	"sending to self":              "Cannot send transactions to your own address.",
	
	// Transaction errors
	"tx rejected":                  "Transaction was rejected by the network.",
	"invalid transaction":          "Invalid transaction format.",
	"double spend":                 "Transaction rejected: possible double spend.",
	"mempool full":                 "Network mempool is full. Try again later.",
	"fee too low":                  "Transaction fee is too low.",
	"not enough ring":              "Not enough ring members. Wait for more blocks.",
	"ring members":                 "Not enough ring members for privacy. Wait for more blocks.",
	"nonce mismatch":               "Wallet out of sync. Retrying...",
	
	// Smart contract errors
	"scid not found":               "Smart contract not found on the blockchain.",
	"invalid scid":                 "Invalid smart contract ID format.",
	"sc execution failed":          "Smart contract execution failed.",
	"gas limit exceeded":           "Transaction ran out of gas.",
	"panic":                        "Smart contract error occurred.",
	"sc validation failed":         "Smart contract code validation failed. Check file content.",
	"expecting declaration":        "File contains '*/' which breaks TELA. See error details.",
	
	// XSWD errors
	"xswd not connected":           "Wallet not connected. Please connect first.",
	"xswd connection failed":       "Failed to connect to wallet service.",
	"permission denied":            "Permission denied by wallet.",
	"user rejected":                "Action was rejected by the user.",
	"request timeout":              "Wallet request timed out.",
	"invalid name":                 "XSWD: App name contains invalid characters (ASCII only).",
	"invalid description":          "XSWD: App description contains invalid characters (ASCII only).",
	"invalid url":                  "XSWD: URL doesn't match browser origin.",
	"-32601":                       "RPC method not found. Check method name.",
	"-32700":                       "Invalid JSON in request.",
	"-32602":                       "Invalid parameters for RPC method.",
	"-32098":                       "Recipient's wallet is not registered on-chain. They need to open their wallet and click 'Register Now' (in Backup & Security) before they can receive DERO.",
	
	// Gnomon errors
	"gnomon not running":           "Gnomon indexer is not running. Start it in Settings.",
	"gnomon already running":       "Gnomon indexer is already running.",
	"index not found":              "Content not found in index. Try refreshing.",
	"durl not found":               "dURL not found. Check the address.",
	
	// File/Content errors
	"no html content":              "No displayable content found.",
	"no doc contracts":             "This INDEX has no associated documents.",
	"failed to fetch":              "Failed to load content. Check your connection.",
	"decode failed":                "Failed to decode content data.",
	"assembly failed":              "Failed to assemble content for display.",
	"file too large":               "File exceeds the 18KB size limit for TELA.",
	"exceeds max":                  "Content exceeds maximum allowed size.",
	"doccode size":                 "DOC file too large. Max 18KB.",
	"index install size":           "INDEX too large. Reduce DOCs or shorten names.",
	
	// Unicode/encoding errors
	"non-ascii":                    "File contains non-ASCII characters. Use ASCII only.",
	"unicode":                      "File contains Unicode characters that may cause issues.",
	"encoding error":               "Character encoding error. Check for special characters.",
	
	// Generic errors
	"not found":                    "The requested item was not found.",
	"unauthorized":                 "You don't have permission for this action.",
	"bad request":                  "Invalid request. Please check your input.",
	"internal error":               "An internal error occurred. Please try again.",
}

// FriendlyError converts a technical error message to a user-friendly one
func FriendlyError(err error) string {
	if err == nil {
		return ""
	}
	return FriendlyErrorString(err.Error())
}

// FriendlyErrorString converts a technical error string to a user-friendly one
func FriendlyErrorString(errMsg string) string {
	if errMsg == "" {
		return ""
	}
	
	lowerMsg := strings.ToLower(errMsg)
	
	// Check each pattern
	for pattern, friendly := range UserFriendlyErrors {
		if strings.Contains(lowerMsg, strings.ToLower(pattern)) {
			return friendly
		}
	}
	
	// Return original if no match found
	return errMsg
}

// ErrorResponse creates a standardized error response with both technical and friendly messages
func ErrorResponse(err error) map[string]interface{} {
	if err == nil {
		return map[string]interface{}{
			"success": true,
		}
	}
	
	return map[string]interface{}{
		"success":       false,
		"error":         FriendlyError(err),
		"technicalError": err.Error(),
	}
}

// ErrorResponseWithData creates an error response with additional data fields
func ErrorResponseWithData(err error, data map[string]interface{}) map[string]interface{} {
	resp := ErrorResponse(err)
	for k, v := range data {
		resp[k] = v
	}
	return resp
}

