package main

import "time"

// currentNode holds the active DERO daemon address (e.g. "http://127.0.0.1:10102").
// Set by the set_node command, read by TELA and native handlers.
var currentNode string

// nodeConnectedAt records when the current node was connected, for uptime tracking.
var nodeConnectedAt time.Time