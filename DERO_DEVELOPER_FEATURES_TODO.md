# DERO Developer Studio — Feature Roadmap

This roadmap turns DERO Hive's existing local-first AI, MCP, skills, code editor, and simulator foundations into an integrated development environment for DERO builders.

## Delivery principles

- AI may read, explain, generate, lint, test, and prepare transactions automatically.
- Wallet access, signing, contract invocation on a live network, and deployment always require a distinct, explicit user approval.
- Simulator-first: every generated contract should be linted and exercised locally before a live-network deployment is offered.
- Chain assertions must be based on daemon/MCP evidence and clearly distinguish verified facts from model inference.

## 1. AI DVM-BASIC Contract Studio — Complete

- [x] Add a Contract Brief workflow and specialist contract agent.
- [x] Generate a non-destructive local `Counter.bas` starter contract and load it into the structural analyser.
- [x] Add deterministic structural checks for initializers, line-number control flow, `SIGNER()` guards, transfers, and missing returns.
- [x] Add literal `STORE`/`LOAD` coverage hints and likely-unreachable-line detection.
- [x] Extend linting with type-aware storage consistency and richer control-flow analysis.
- [x] Generate a DVM-BASIC contract, tests, and deployment notes from a plain-language brief.
- [x] Provide line-specific AI review findings and proposed regression tests.
- [x] Save contract briefs, source, review results, and test output as project artifacts.

## 2. Simulator-first AI Development Loop — Complete

- [x] Manage simulator lifecycle and a loopback-only RPC health check from a DERO project cockpit.
- [x] Inspect simulator network, height, topo height, and transaction-pool state through structured read-only RPC.
- [x] Expose local simulator chain inspection as a read-only AI tool (`get_simulator_chain_info`).
- [x] Add safe commands for reset, fixture wallets, deploy, invoke, mine, inspect state, and assert expected values.
- [x] Give models structured simulator tools rather than relying on free-form terminal commands.
- [x] Record a reproducible test run with its source revision and results.

## 3. Chain-aware Chat Context — Complete

- [x] Provide a Chain Context workflow that directs models to the connected read-only DERO MCP tools.
- [x] Recognise likely 64-character chain identifiers, DERO addresses, and TELA URLs in the composer, attaching an unverified reference receipt for the model.
- [x] Attach verified contract source, state, gas estimates, transaction context, and canonical documentation to a chat.
- [x] Provide one-click actions to explain a contract, trace a transaction, estimate deployment cost, and inspect chain health.
- [x] Clearly label daemon evidence, documentation context, and model inference.

## 4. TELA dApp Builder — Complete

- [x] Create a non-destructive `tela-starter` scaffold with HTML, CSS, and an explicit read-only XSWD connection example.
- [x] Generate a DVM contract, TELA application structure, JavaScript frontend, local-server configuration, and deployment manifest.
- [x] Add live preview, hot reload, and AI-assisted diagnostics.
- [x] Validate TELA artifacts before packaging or publishing.

## 5. XSWD Wallet Integration Test Harness — Complete

- [x] Include an opt-in `?mock=1` read-only XSWD fixture in the TELA starter; signing, transfers, deployment, and key methods are excluded.
- [x] Expand the mock wallet bridge with configurable deterministic fixture scenarios.
- [x] Add an opt-in real-wallet mode with capability-specific permission prompts.
- [x] Prevent models from silently signing, transferring, or deploying.

## 6. AI Security and Privacy Audit Mode — Complete

- [x] Run DERO-specific multi-model contract reviews using a fixed checklist.
- [x] Report severity, affected lines, exploit path, simulator reproduction, remediation, and confidence.
- [x] Compare agreement and disagreement across selected models before applying a fix.

## 7. Gnomon-powered dApp Intelligence — Complete

- [x] Discover similar contracts and indexed transactions from a local or configured Gnomon source.
- [x] Generate index/query code and post-deployment monitoring views.
- [x] Keep indexing endpoints configurable and show freshness/network provenance.

## 8. DERO Agent Packs — Complete

- [x] Ship focused agents for Contract Architecture, DVM Security, TELA Frontend, Simulator Testing, Chain Investigation, and Release Management.
- [x] Each pack supplies a scoped prompt, relevant skills, tools, and safety guidance.
- [x] Allow project-level defaults without preventing per-chat overrides.

## Initial integration slice

The first implementation slice connects items 1–3: a DERO project type, a DERO Studio cockpit with Contract / Audit / TELA / Chain-context prompts, specialist agents, and direct simulator lifecycle control. The next slice adds structured simulator RPC operations and DVM linting.
