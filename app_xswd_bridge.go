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
