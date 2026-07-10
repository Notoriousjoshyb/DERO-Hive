# Optional integration binaries

Electron Builder copies this directory into the Windows installer. Source checkouts live under `integrations/`; compiled programs do not.

Expected optional Windows artifacts:

- `hologram/bin/Hologram.exe`
- `purewolf/bin/purewolf-native.exe`

If an artifact is absent, DERO Hive installs and runs normally and reports that integration as unavailable. PureWolf remains a browser-managed native host even when its binary is packaged.

Hermes is never bundled here. Point Hive at an independently installed gateway with `HERMES_GATEWAY_URL`.
