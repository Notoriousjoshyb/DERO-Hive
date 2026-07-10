# Optional integrations

DERO Hive keeps optional products at process boundaries. Their source history is retained under `integrations/`, but Hive does not embed or duplicate their interfaces.

| Integration | Role | Hive lifecycle |
|---|---|---|
| Hologram | DERO/TELA desktop application | Hive may launch and stop an optional packaged executable. |
| PureWolf | Browser extension native host | The browser launches it through Native Messaging; Hive reports whether the helper is installed. |
| Hermes Agent | Messaging gateway | External service only; Hive reports a configured `HERMES_GATEWAY_URL` and never installs Python. |

## Pinned source

- Hologram: `DHEBP/HOLOGRAM@0ae9398a60856b56ebda0adf153cfe1fa00b441a`
- PureWolf: `ArcaneSphere/PureWolf-Browser-Extension@a2a7e2f04206b66f39fac5b296e2e87a562e1196`
- Hermes browser/gateway interface reference (not vendored): `abundantbeing/hermes-browser-extension@13c79de5b50ec98c2560881b989bc3461e0586f5`

The directories were imported with `git subtree`. Future updates should use `git subtree pull --prefix=<directory> <repository> <reviewed-commit>` and must remain commit-pinned.

## Windows packaging

The installer always includes `resources/integrations/manifest.json`. It includes optional executables only when these files exist before `npm run build:win`:

```text
resources/integrations/hologram/bin/Hologram.exe
resources/integrations/purewolf/bin/purewolf-native.exe
```

Build upstream programs from their pinned source trees with their documented toolchains, then stage the resulting executables at those paths. Missing executables do not fail Hive installation or startup.

PureWolf still requires browser Native Messaging registration. Its upstream pinned installer currently targets Unix-like systems, so Windows registration remains a separate upstream packaging task.

Set `DERO_HIVE_HOLOGRAM_PATH` or `DERO_HIVE_PUREWOLF_PATH` to use an external executable without bundling it. Managed Hologram processes receive only desktop runtime variables, not Hive's provider keys or other environment secrets. Set `HERMES_GATEWAY_URL` to advertise an independently managed, credential-free HTTP(S) Hermes gateway URL. Hive does not start, install, authenticate to, or health-check Hermes.

See `THIRD_PARTY_NOTICES.md` for licenses and provenance.
