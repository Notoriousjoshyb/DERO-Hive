package main

import (
	"embed"
	"os"

	"github.com/deroproject/derohe/globals"
	"github.com/deroproject/derohe/walletapi"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	originalArgs := append([]string(nil), os.Args...)

	// Capture launch args (e.g., dero:// links) before clearing Wails/CLI flags.
	launchArgs := []string{}
	if len(originalArgs) > 1 {
		launchArgs = append(launchArgs, originalArgs[1:]...)
	}

	// Clear args to prevent DERO globals from picking up Wails flags
	os.Args = []string{os.Args[0]}

	// Initialize DERO globals for mainnet
	globals.Arguments = make(map[string]interface{})
	globals.Arguments["--testnet"] = false  // Required by DERO library, but testnet is not used in Hologram
	globals.Arguments["--simulator"] = false
	globals.Initialize()
	globals.InitNetwork() // This sets up the correct address prefixes for mainnet

	// Initialize wallet lookup table (required for crypto operations)
	go walletapi.Initialize_LookupTable(1, 1<<21)

	// Create an instance of the app structure
	app := NewApp()
	app.captureLaunchURLFromArgs(launchArgs)

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "HOLOGRAM - DERO Decentralized Web",
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 12, G: 12, B: 20, A: 1}, // --void-base: #0c0c14
		OnStartup:        app.startup,
		OnShutdown:        app.shutdown,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true, // Prevent WebKit from natively handling drops (causes image preview navigation); Wails OnFileDrop provides real paths
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: false, // Standard macOS title bar for proper window dragging
			},
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
