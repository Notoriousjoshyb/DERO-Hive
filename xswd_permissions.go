package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/deroproject/graviton"
)

// Permission types for XSWD
type XSWDPermission string

const (
	PermissionReadPublicData  XSWDPermission = "read_public_data" // Read-only daemon data (GetInfo, GetBlock, etc.)
	PermissionViewAddress     XSWDPermission = "view_address"
	PermissionViewBalance     XSWDPermission = "view_balance"
	PermissionSignTransaction XSWDPermission = "sign_transaction"
	PermissionSCInvoke        XSWDPermission = "sc_invoke"
)

// AllPermissions returns all defined permission types
func AllPermissions() []XSWDPermission {
	return []XSWDPermission{
		PermissionReadPublicData,
		PermissionViewAddress,
		PermissionViewBalance,
		PermissionSignTransaction,
		PermissionSCInvoke,
	}
}

// PermissionInfo provides human-readable info about a permission
type PermissionInfo struct {
	ID          XSWDPermission `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	AlwaysAsk   bool           `json:"alwaysAsk"` // If true, requires per-action approval even when granted
}

// GetPermissionInfo returns metadata about a permission
func GetPermissionInfo(p XSWDPermission) PermissionInfo {
	switch p {
	case PermissionReadPublicData:
		return PermissionInfo{
			ID:          p,
			Name:        "Read Public Blockchain Data",
			Description: "Can read public blockchain info (blocks, transactions, network stats)",
			AlwaysAsk:   false,
		}
	case PermissionViewAddress:
		return PermissionInfo{
			ID:          p,
			Name:        "View Wallet Address",
			Description: "Can see your public wallet address",
			AlwaysAsk:   false,
		}
	case PermissionViewBalance:
		return PermissionInfo{
			ID:          p,
			Name:        "View Balance",
			Description: "Can see your wallet balance",
			AlwaysAsk:   false,
		}
	case PermissionSignTransaction:
		return PermissionInfo{
			ID:          p,
			Name:        "Sign Transactions",
			Description: "Can request to send DERO (requires approval each time)",
			AlwaysAsk:   true,
		}
	case PermissionSCInvoke:
		return PermissionInfo{
			ID:          p,
			Name:        "Smart Contract Calls",
			Description: "Can request smart contract interactions (requires approval each time)",
			AlwaysAsk:   true,
		}
	default:
		return PermissionInfo{
			ID:          p,
			Name:        string(p),
			Description: "Unknown permission",
			AlwaysAsk:   true,
		}
	}
}

// ConnectedApp represents a dApp that has connected via XSWD
type ConnectedApp struct {
	Origin       string                  `json:"origin"`
	Name         string                  `json:"name"`
	Description  string                  `json:"description,omitempty"`
	Permissions  map[XSWDPermission]bool `json:"permissions"`
	GrantedAt    int64                   `json:"grantedAt"`
	LastAccessed int64                   `json:"lastAccessed"`
}

// PermissionManager handles XSWD permission storage and checking
type PermissionManager struct {
	sync.RWMutex
	store         *graviton.Store
	apps          map[string]*ConnectedApp // origin -> app
	activeClients map[string]bool          // origin -> is currently connected
}

var permissionManager *PermissionManager

// InitPermissionManager initializes the global permission manager
func InitPermissionManager(cache *GravitonCache) {
	pm := &PermissionManager{
		apps:          make(map[string]*ConnectedApp),
		activeClients: make(map[string]bool),
	}

	// Use the same Graviton store as the cache
	if cache != nil {
		pm.store = cache.store
	}

	// Load persisted permissions
	pm.loadFromStorage()

	permissionManager = pm
}

// GetPermissionManager returns the global permission manager
func GetPermissionManager() *PermissionManager {
	return permissionManager
}

// loadFromStorage loads persisted permissions from Graviton
func (pm *PermissionManager) loadFromStorage() {
	if pm.store == nil {
		return
	}

	ss, err := pm.store.LoadSnapshot(0)
	if err != nil {
		return
	}

	tree, _ := ss.GetTree("xswd_permissions")
	if tree == nil {
		return
	}

	// Iterate all keys to load apps
	cursor := tree.Cursor()
	for k, v, err := cursor.First(); err == nil; k, v, err = cursor.Next() {
		if k == nil {
			break
		}

		var app ConnectedApp
		if err := json.Unmarshal(v, &app); err == nil {
			pm.apps[string(k)] = &app
		}
	}
}

// saveToStorage persists a single app's permissions to Graviton
func (pm *PermissionManager) saveToStorage(app *ConnectedApp) error {
	if pm.store == nil {
		return fmt.Errorf("storage not initialized")
	}

	ss, err := pm.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree("xswd_permissions")

	data, err := json.Marshal(app)
	if err != nil {
		return err
	}

	if err := tree.Put([]byte(app.Origin), data); err != nil {
		return err
	}

	_, err = graviton.Commit(tree)
	return err
}

// deleteFromStorage removes an app's permissions from Graviton
func (pm *PermissionManager) deleteFromStorage(origin string) error {
	if pm.store == nil {
		return fmt.Errorf("storage not initialized")
	}

	ss, err := pm.store.LoadSnapshot(0)
	if err != nil {
		return err
	}

	tree, _ := ss.GetTree("xswd_permissions")

	if err := tree.Delete([]byte(origin)); err != nil {
		return err
	}

	_, err = graviton.Commit(tree)
	return err
}

// GrantPermissions stores permissions for an app
func (pm *PermissionManager) GrantPermissions(origin, name, description string, permissions []XSWDPermission) error {
	pm.Lock()
	defer pm.Unlock()

	now := time.Now().Unix()

	app, exists := pm.apps[origin]
	if !exists {
		app = &ConnectedApp{
			Origin:      origin,
			Name:        name,
			Description: description,
			Permissions: make(map[XSWDPermission]bool),
			GrantedAt:   now,
		}
		pm.apps[origin] = app
	} else {
		// Update name/description if provided
		if name != "" {
			app.Name = name
		}
		if description != "" {
			app.Description = description
		}
	}

	// Grant the specified permissions
	for _, p := range permissions {
		app.Permissions[p] = true
	}
	app.LastAccessed = now

	return pm.saveToStorage(app)
}

// RevokePermission removes a specific permission from an app
func (pm *PermissionManager) RevokePermission(origin string, permission XSWDPermission) error {
	pm.Lock()
	defer pm.Unlock()

	app, exists := pm.apps[origin]
	if !exists {
		return nil
	}

	delete(app.Permissions, permission)
	return pm.saveToStorage(app)
}

// RevokeAllPermissions removes all permissions for an app
func (pm *PermissionManager) RevokeAllPermissions(origin string) error {
	pm.Lock()
	defer pm.Unlock()

	if _, exists := pm.apps[origin]; !exists {
		return nil
	}

	delete(pm.apps, origin)
	delete(pm.activeClients, origin)
	return pm.deleteFromStorage(origin)
}

// HasPermission checks if an app has a specific permission
func (pm *PermissionManager) HasPermission(origin string, permission XSWDPermission) bool {
	pm.RLock()
	defer pm.RUnlock()

	app, exists := pm.apps[origin]
	if !exists {
		return false
	}

	// Update last accessed time (best effort, don't lock for write)
	app.LastAccessed = time.Now().Unix()

	return app.Permissions[permission]
}

// GetApp returns a connected app by origin
func (pm *PermissionManager) GetApp(origin string) *ConnectedApp {
	pm.RLock()
	defer pm.RUnlock()

	if app, exists := pm.apps[origin]; exists {
		// Return a copy to avoid race conditions
		appCopy := *app
		permCopy := make(map[XSWDPermission]bool)
		for k, v := range app.Permissions {
			permCopy[k] = v
		}
		appCopy.Permissions = permCopy
		return &appCopy
	}
	return nil
}

// GetAllApps returns all connected apps
func (pm *PermissionManager) GetAllApps() []*ConnectedApp {
	pm.RLock()
	defer pm.RUnlock()

	apps := make([]*ConnectedApp, 0, len(pm.apps))
	for _, app := range pm.apps {
		// Return copies
		appCopy := *app
		permCopy := make(map[XSWDPermission]bool)
		for k, v := range app.Permissions {
			permCopy[k] = v
		}
		appCopy.Permissions = permCopy
		apps = append(apps, &appCopy)
	}
	return apps
}

// SetActiveClient marks a client as actively connected
func (pm *PermissionManager) SetActiveClient(origin string, active bool) {
	pm.Lock()
	defer pm.Unlock()

	if active {
		pm.activeClients[origin] = true
	} else {
		delete(pm.activeClients, origin)
	}
}

// IsClientActive checks if a client is currently connected
func (pm *PermissionManager) IsClientActive(origin string) bool {
	pm.RLock()
	defer pm.RUnlock()

	return pm.activeClients[origin]
}

// GetActiveClients returns all currently connected app origins
func (pm *PermissionManager) GetActiveClients() []string {
	pm.RLock()
	defer pm.RUnlock()

	clients := make([]string, 0, len(pm.activeClients))
	for origin := range pm.activeClients {
		clients = append(clients, origin)
	}
	return clients
}

// GetRequiredPermission returns the permission required for a given XSWD method
func GetRequiredPermission(method string) XSWDPermission {
	switch method {
	case "GetAddress", "DERO.GetAddress",
		"GetPublicKey",
		"MakeIntegratedAddress", "SplitIntegratedAddress",
		"GetDaemon", "DERO.GetDaemon":
		return PermissionViewAddress
	case "GetBalance", "DERO.GetBalance",
		"GetHeight", "DERO.GetHeight",
		"GetTransfers", "GetTransferbyTXID":
		return PermissionViewBalance
	case "transfer", "Transfer", "DERO.Transfer":
		return PermissionSignTransaction
	case "scinvoke", "SC_Invoke", "DERO.SC_Invoke":
		return PermissionSCInvoke
	case "SignData", "DecryptPayload":
		return PermissionSignTransaction
	// Read-only daemon methods - no wallet needed
	case "DERO.GetInfo", "GetInfo",
		"DERO.GetBlock", "GetBlock",
		"DERO.GetBlockHeaderByHash", "GetBlockHeaderByHash",
		"DERO.GetBlockHeaderByTopoHeight", "GetBlockHeaderByTopoHeight",
		"DERO.GetTxPool", "GetTxPool",
		"DERO.GetTransaction", "GetTransaction",
		"DERO.GetRandomAddress", "GetRandomAddress",
		"DERO.GetSC", "GetSC",
		"DERO.GetGasEstimate", "GetGasEstimate",
		"DERO.NameToAddress", "NameToAddress":
		return PermissionReadPublicData
	default:
		return ""
	}
}

// RequiresWallet returns true if the permission requires wallet access
func RequiresWallet(p XSWDPermission) bool {
	switch p {
	case PermissionViewAddress, PermissionViewBalance, PermissionSignTransaction, PermissionSCInvoke:
		return true
	default:
		return false
	}
}

// DefaultRequestedPermissions returns the default permissions a dApp requests if not specified
// Now defaults to read-only only - apps must explicitly request wallet permissions
func DefaultRequestedPermissions() []XSWDPermission {
	return []XSWDPermission{
		PermissionReadPublicData,
	}
}

// HasAnyWalletPermission returns true if the permission list includes any wallet-related permissions
func HasAnyWalletPermission(perms []XSWDPermission) bool {
	for _, p := range perms {
		if RequiresWallet(p) {
			return true
		}
	}
	return false
}
