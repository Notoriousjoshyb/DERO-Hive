# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`dev`) | ✅ |
| Older releases | ⚠️ Best-effort only |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security issue — including but not limited to:

- Wallet key material exposure
- XSWD permission bypass or privilege escalation
- Arbitrary code execution via TELA app sandbox escape
- Credential or session leakage through the telaHost bridge
- Dependency with a known critical CVE affecting HOLOGRAM

Please report it using **[GitHub's private vulnerability reporting](https://github.com/DHEBP/HOLOGRAM/security/advisories/new)**.

This keeps the report confidential until a fix is ready and gives both parties a structured place to track it.

Include:

- A clear description of the issue
- Steps to reproduce (proof-of-concept if available)
- Potential impact assessment
- Any suggested mitigations you have in mind

You will receive an acknowledgement within **48 hours** and a status update within **7 days**.

---

## Scope

### In scope

- HOLOGRAM application code (`*.go`, `frontend/`)
- XSWD server and permission model (`xswd_server.go`, `xswd_permissions.go`, `xswd_router.go`)
- Integrated wallet operations (`wallet.go`, `xswd_client.go`)
- telaHost bridge (iframe ↔ app communication)
- TELA content sandbox isolation
- Smart contract invocation and signature validation flows

### Out of scope

- Vulnerabilities in the DERO node (`derod`) or derohe codebase — report those to the [DERO project](https://github.com/deroproject/derohe/security)
- Social engineering attacks
- Issues requiring physical access to the machine
- Denial-of-service via resource exhaustion on a local machine

---

## Security Model Notes

HOLOGRAM's security depends on several layers worth understanding:

- **XSWD permissions** — all wallet operations requested by TELA apps require explicit user approval via native modals; apps cannot silently access wallet functions
- **Iframe sandboxing** — TELA apps run in sandboxed iframes; they communicate with HOLOGRAM only through the telaHost postMessage bridge, not via direct Go bindings
- **Local-only RPC** — the embedded XSWD server listens on `127.0.0.1` only; it is not exposed to the network
- **Privacy-first networking** — HOLOGRAM does not collect usage analytics or tracking telemetry; optional GitHub update checks may be enabled via settings

---

## Disclosure Policy

We follow a **coordinated disclosure** model:

1. You report privately.
2. We confirm and investigate.
3. We develop and test a fix.
4. We release the fix and credit you (unless you prefer to remain anonymous).
5. We publish a security advisory after a reasonable patch window.

We ask that you give us a reasonable amount of time (typically 30–90 days depending on severity) to release a fix before any public disclosure.
