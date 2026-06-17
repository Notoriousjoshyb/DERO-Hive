package main

func (a *App) RespondToXSWDRequest(reqID string, approved bool, password string) {
	if a.xswdServer != nil {
		a.xswdServer.ProcessApproval(reqID, approved, password)
	}
}

// RespondToXSWDRequestWithPermissions handles XSWD request responses with explicit permissions
func (a *App) RespondToXSWDRequestWithPermissions(reqID string, approved bool, password string, permissions []string) {
	if a.xswdServer != nil {
		a.xswdServer.ProcessApprovalWithPermissions(reqID, approved, password, permissions)
	}
}

// RespondToXSWDRequestConfirmDestroy approves a request that carries a destructive
// native-DERO burn. The frontend calls this only after the user passes type-to-confirm;
// it injects the confirmDestroy flag so the backend burn guard allows the destruction.
func (a *App) RespondToXSWDRequestConfirmDestroy(reqID string, approved bool, password string) {
	if a.xswdServer != nil {
		a.xswdServer.ProcessApprovalConfirmDestroy(reqID, approved, password)
	}
}
