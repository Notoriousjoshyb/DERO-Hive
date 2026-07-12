# GitHub Resources for Dero Hive — Deep Research Report

> Generated 2026-07-09 via a multi-agent deep-research workflow: 5 search angles → 23 sources fetched → 115 claims extracted → top 25 adversarially verified by independent 3-vote panels (24 confirmed, 1 refuted). Star counts, versions, and dates are snapshots as of 2026-07-09. Items marked **⚠ unverified lead** were fetched and extracted but fell below the verification budget — treat as promising, not confirmed.

**Companion file:** [`resources/mcp-registry.json`](resources/mcp-registry.json) — the machine-readable seed registry for a planned MCP Discover tab. Only verification-confirmed servers are included.

---

## Top picks (TL;DR)

1. **Bundle the 7 official MCP reference servers** ([modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)) as the Discover tab's first entries — one-line npx/uvx installs, already in `resources/mcp-registry.json`.
2. **Adopt the official MCP Registry's `server.json` schema + REST API** ([modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)) as the expansion path — snapshot and vet, don't live-depend.
3. **Implement the Agent Skills open standard** ([agentskills/agentskills](https://github.com/agentskills/agentskills)) in the skills loader — it's nearly what Dero Hive already does (folder + SKILL.md + name/description frontmatter), and conforming unlocks a 40+-client ecosystem of ready-made skills.
4. **Mine [5ire](https://github.com/nanbingxyz/5ire) and LobeChat's plugin-index pattern** for marketplace/provider architecture — 5ire is the closest open-source analogue to Dero Hive.
5. **User-suggested, strong fit: [alibaba/page-agent](https://github.com/alibaba/page-agent)** (MIT, 25.5k★) — embed a GUI agent inside Dero Hive's own renderer so an "Agent" mode can operate the app's UI by natural language.

---

## 1. MCP servers & registries for the Discover tab

### modelcontextprotocol/servers — the seven reference servers ✅ verified 3-0
**Goal: ship-in-app.** 88.3k★, latest release `2026.7.4` (2026-07-04). Exactly seven active reference servers remain in the repo — all seeded into `resources/mcp-registry.json`:

| Server | Runtime | Install | Category |
|---|---|---|---|
| Filesystem | Node | `npx -y @modelcontextprotocol/server-filesystem <dir>` | files |
| Memory | Node | `npx -y @modelcontextprotocol/server-memory` | knowledge-graph memory |
| Sequential Thinking | Node | `npx -y @modelcontextprotocol/server-sequential-thinking` | reasoning |
| Everything | Node | `npx -y @modelcontextprotocol/server-everything` | MCP client testing |
| Fetch | Python | `uvx mcp-server-fetch` | web fetch → markdown |
| Git | Python | `uvx mcp-server-git` | git operations |
| Time | Python | `uvx mcp-server-time` | time/timezone |

All seven install packages were re-verified live on npm/PyPI on 2026-07-09 (npm `2026.7.4`; PyPI `2026.6.x`, MIT).

**Caveats (verified):**
- **Windows:** `npx` is a `.cmd` shim — Dero Hive's MCP manager must spawn `cmd /c npx ...` (or `shell: true`) from Electron's `child_process` (README + issues #40/#3460).
- The former SQLite, Brave Search, Puppeteer, GitHub, etc. servers were moved to `modelcontextprotocol/servers-archived` — the seven do **not** cover every category (no SQLite, no search).
- License: the repo is transitioning MIT → Apache-2.0 (new code Apache-2.0, unrelicensed older contributions MIT — LICENSE file read 2026-07-09).

### Official MCP Registry — the schema and API to adopt ✅ verified 3-0
**Goal: ship-in-app seed data.** [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) (~7k★, v1.7.9 May 2026; Apache-2.0/MIT code, CC-BY-4.0 docs) is the canonical machine-readable index — the servers repo's community list was formally retired in its favor.

- Unauthenticated REST API: `https://registry.modelcontextprotocol.io/v0/servers` — paginated JSON (`name`, `version`, `remotes`, `repository`, `nextCursor`), under a **v0.1 API freeze** (live-curled 200 on 2026-07-09).
- Adopt its `server.json` data model and reverse-DNS namespacing (`io.github.username/*` requires authenticating as that user via mcp-publisher CLI) for ecosystem compatibility.
- **Do not live-depend:** it is explicitly a preview ("breaking changes or data resets may occur") with **minimal-to-no moderation** — ship a pinned, self-vetted snapshot. ("Curated" was a claim the verifiers corrected.)

### punkpeye/awesome-mcp-servers — legally minable enrichment ✅ verified 3-0
**Goals: ship-in-app seed data + the only verified crypto lead.** MIT (LICENSE file confirmed via GitHub API), 90.5k★, 12.7k forks, 8,551 commits, pushed 2026-07-04. 52 categories including Browser Automation, Databases, Knowledge & Memory, Search & Data Extraction, Version Control, and a crypto-dominated **Finance & Fintech** section (`web3-research-mcp` — "Deep Research for crypto - free & fully local", `armor-crypto-mcp` multi-chain wallets/DeFi, `alchemy-mcp-server`, `bicscan-mcp`). MIT permits mining it into the bundled Discover JSON provided the copyright/license notice is preserved.

**❌ Refuted (0-3):** the claim that every listed server carries a language/scope/OS/official-status legend. Per-server Windows-friendliness, local-first, and official-status metadata **must be derived independently** — it cannot be scraped from this list.

---

## 2. Agent Skills ecosystem for the skills loader

### The Agent Skills open standard ✅ verified 3-0
**Goal: ship-in-app.** [agentskills/agentskills](https://github.com/agentskills/agentskills) (22.8k★; Apache-2.0 code, CC-BY-4.0 docs; spec at [agentskills.io](https://agentskills.io/specification)) — Anthropic-originated, now adopted by **40+ clients** including GitHub Copilot, Cursor, OpenAI Codex, VS Code, Gemini CLI, and Goose.

The format is minimal enough for `src/main/skills/loader.ts` to implement directly:
- A skill = a folder containing `SKILL.md` with YAML frontmatter requiring only `name` (≤64 chars, lowercase+hyphens, must match directory name) and `description` (≤1024 chars); optional `scripts/`, `references/`, `templates/`.
- Three-stage progressive disclosure: metadata only at startup → full instructions on activation → bundled files on execution.
- Conforming immediately taps [anthropics/skills](https://github.com/anthropics/skills) and the wider ecosystem. Dero Hive's bundled `resources/skills/*/SKILL.md` layout is already close to conforming.

### License gate on anthropics/skills ✅ verified 3-0
Split-licensed **per folder** (no umbrella LICENSE): many skills are Apache-2.0 and can be bundled/mirrored in MIT-licensed Dero Hive (retain Apache notices), **but** the document skills (`skills/docx`, `skills/pdf`, `skills/pptx`, `skills/xlsx`) are source-available under a proprietary license that explicitly prohibits distribution, reproduction, and derivatives — **do not redistribute those four.** Check each folder's `LICENSE.txt` before mirroring.

### Claude Code's unified skills/slash-commands convention ✅ verified 3-0
**Goal: ship-in-app.** Claude Code merged slash commands and skills: a flat `commands/deploy.md` and a directory `skills/deploy/SKILL.md` both create `/deploy` and behave identically; the directory name becomes the command, the frontmatter `description` drives automatic model invocation, and skills take precedence on name collisions. Mirroring this dual-path convention (flat `.md` OR skill directory) in Dero Hive's loader gives drop-in compatibility with existing collections; Claude Code-specific extensions (invocation control, subagents, dynamic context) degrade gracefully to base-standard behavior.

### awesome-claude-code — browse, but do NOT ingest ✅ verified 3-0 (license corrected during synthesis)
**Goals: reference + your own dev setup.** [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (~49.6k★, human-curated within the past week) indexes skills, agents, plugins, hooks, CLAUDE.md files, and tooling, backed by a machine-readable CSV (`THE_RESOURCES_TABLE_NEW.csv`). **However its license is CC BY-NC-ND 4.0 (NonCommercial-NoDerivatives)** — do not ingest the CSV into a bundled registry without the maintainer's permission (the license text invites contact for modified-form use). One verifier's "MIT" remark was wrong; the LICENSE file was decoded directly.

---

## 3. Comparable open-source AI harnesses

### 5ire — the closest analogue ✅ verified 3-0
[nanbingxyz/5ire](https://github.com/nanbingxyz/5ire) (5.3k★, v0.15.4 2026-03-18): Electron 31.7.1, 98.4% TypeScript desktop AI assistant + MCP client. Nine providers (OpenAI, Azure, Anthropic, Google, Mistral, Doubao, Grok, DeepSeek, Ollama), built-in local knowledge base (BGE-M3 embedding RAG over docx/xlsx/pptx/pdf/txt/csv), and an MCP marketplace backed by its own repo ([nanbingxyz/mcpsvr](https://github.com/nanbingxyz/mcpsvr)). **License caveat:** package.json declares "Modified Apache-2.0" — check terms before reusing code; studying architecture/UX is unaffected.

### LobeChat's plugin-index pattern ✅ verified (medium confidence, 2-1)
[lobehub/lobe-chat-plugins](https://github.com/lobehub/lobe-chat-plugins) (MIT per README; GitHub API shows license:null): the client fetches `index.json` from a git-hosted repo (via `PLUGINS_INDEX_URL`, default chat-plugins.lobehub.com); new entries arrive by PR from a `plugin-template.json`. This **bundled-JSON-plus-PR-template governance model is directly reusable** for Dero Hive's Discover registry and community submissions. Caveat: LobeChat's newest MCP marketplace moved to a cloud Market SDK (market.lobehub.com); the JSON index is now the classic/fallback path.

### ⚠ Unverified notes (fetched, not adversarially verified)
- **LibreChat** has no in-app MCP marketplace: servers are configured via a static `librechat.yaml` list; its "marketplace" is external discovery via Smithery.ai. Dynamic runtime discovery is an open discussion (#9837).
- **CherryHQ/mcpmarket** is, despite the name, a pnpm monorepo publishing its own `@mcpmarket` npm servers — not a registry to seed from.
- Cherry Studio, Jan, AnythingLLM, Open WebUI, Witsy claims did not survive to verification — open question.

---

## 4. DERO / blockchain agent tooling

> **Coverage gap:** this angle produced **zero surviving verified claims** in the adversarial pass. The only verified crypto lead is awesome-mcp-servers' Finance & Fintech section (§1). Everything below is **⚠ unverified lead** extracted from fetched primary sources — confirm before acting.

- **[deroproject/derohe](https://github.com/deroproject/derohe)** — the DERO homomorphic-encryption chain itself. Custom "RESEARCH LICENSE" v1.1.2 **forbidding commercial use** — cannot be vendored into MIT Dero Hive; interoperate at arm's length via its stable local JSON-RPC (daemon `:10102`, wallet `:10103` mainnet; `:40402/:40403` testnet). Go, official Windows binaries, Release142 (Aug 2025), 222★. Contains the reference **DVM** implementation in `/dvm`.
- **[civilware/tela](https://github.com/civilware/tela)** — TELA decentralized-web standard: on-chain app files (TELA-INDEX-1 / TELA-DOC-1 contracts, DVM-BASIC), executed locally; XSWD wallet connectivity. **MIT**, Go, pushed 2026-05-30, 20★, no releases.
- **[civilware/Gnomon](https://github.com/civilware/Gnomon)** — decentralized DERO indexer with queryable SC/transaction data (REST endpoints, `listsc` CLI). **MIT**, Go. **Dormant** (last main commit Nov 2023, 22★); build-from-source only.
- **[DEROFDN/Engram](https://github.com/DEROFDN/Engram)** — official DERO Foundation smart wallet (Go/Fyne, Windows-buildable, v0.6.1 Aug 2025). **DERO Research License — no commercial use/distribution**: mine it for XSWD/dApp-connection patterns and the DERO-native feature catalog (encrypted messaging, asset tracking, Gnomon integration, EPOCH mining), don't reuse code.
- From §1 (listing verified, repos not vetted): `web3-research-mcp`, `armor-crypto-mcp`, `alchemy-mcp-server`, `bicscan-mcp`.

**Not covered at all** (open question): Coinbase AgentKit, GOAT SDK, Solana Agent Kit, Monero wallet-RPC MCP tooling.

---

## 5. Wallet × AI-agent hybrids (the "Ripley Terminal with an Agent tab" idea)

> **Coverage gap:** zero surviving verified claims. All items are **⚠ unverified leads** — but the user-suggested page-agent below was directly verified by repo fetch.

### alibaba/page-agent — user-suggested, strong fit ✅ verified by direct repo fetch 2026-07-09
[alibaba/page-agent](https://github.com/alibaba/page-agent) — "The GUI Agent Living in Your Webpage. One script gives any web page its own AI agent." **MIT, TypeScript (82.6%), 25.5k★, 2.2k forks, v1.12.0 released 2026-07-09 (same-day active).**
- In-page GUI agent: natural-language DOM control (`await agent.execute('Click the login button')`) — no extension, no headless browser, no screenshots/multimodal model needed.
- Works with "most mainstream models, **including locally deployed ones**" via OpenAI-compatible `baseURL` + `apiKey` — exactly Dero Hive's provider model.
- `npm install page-agent`; has MCP-server integration for external agent control.
- **Why it matters here:** this is a possible implementation piece for an Agent-tab concept — embed it in the renderer and an "Agent mode" could operate Dero Hive's own UI (navigate panels, fill the composer, manage conversations) using the user's already-configured provider.

### ⚠ Unverified leads (design references)
- **[feather-wallet/feather](https://github.com/feather-wallet/feather)** — BSD-3-Clause C++/Qt Monero wallet (v2.8.1 Apr 2025, ~562★, Windows/Linux/Tails/macOS). The closest open-source referent for the Ripley-Terminal wallet half: deep coin control (freeze/thaw, manual input selection), built-in Tor, threat-model configurability. **No AI/agent/plugin surface** — UX-pattern reference only.
- **[elizaOS/eliza](https://github.com/elizaOS/eliza)** — MIT, TypeScript, ~18.7k★, local-first agent OS whose app ships a **non-custodial crypto wallet integrated with its AI agent** (EVM/Solana transfers, swaps, bridges) — the most concrete wallet-UI-plus-agent reference found, though not DERO/privacy-coin and using its own plugin system (not MCP). Bun toolchain; Windows via WINDOWS.md.
- **[coinbase/onchain-agent-demo](https://github.com/coinbase/onchain-agent-demo)** — Apache-2.0 Next.js demo pairing a chat UI with onchain wallet actions (deploy ERC-20s, NFTs, balances) via AgentKit, streaming over SSE. **Not local-first** (hosted Python backend, CDP + OpenAI keys) and stale (last push Jun 2025, 42★) — UX-pattern reference only.

---

## Refuted during verification

| Claim | Vote | Consequence |
|---|---|---|
| awesome-mcp-servers tags every server with a language/scope/OS/official legend | 0-3 | Derive per-server Windows/local/official metadata independently; don't scrape it from the list |

License corrections made during synthesis: awesome-claude-code is CC BY-NC-ND 4.0 (not MIT); anthropics/skills document skills are non-redistributable; 5ire is "Modified Apache-2.0" (terms unverified); lobe-chat-plugins shows license:null via API despite README MIT.

---

## Open questions / suggested follow-up research

1. Vet the crypto MCP servers (armor-crypto-mcp, web3-research-mcp, alchemy-mcp-server) and the big agent toolkits (Coinbase AgentKit, GOAT SDK, Solana Agent Kit) for quality/license/Windows-local fit — angle 4 never got verified coverage.
2. Hunt specifically for wallet apps with an integrated AI Agent tab (the Ripley Terminal pattern) — no verified example exists; eliza is the nearest.
3. Survey the remaining comparable harnesses (Cherry Studio, Jan, LibreChat, AnythingLLM, Open WebUI, Witsy) for MCP-discovery and agent-tab implementations.
4. Decide the metadata source for Discover entries: does the official registry's `server.json` `packages` field carry enough signal (runtime, transport), or does Dero Hive curate `local`/`windows`/`license` itself (as `resources/mcp-registry.json` now does)?

---

## Sources (23 fetched; primary unless noted)

modelcontextprotocol/servers · modelcontextprotocol/registry · registry.modelcontextprotocol.io · punkpeye/awesome-mcp-servers · anthropics/skills · agentskills/agentskills · agentskills.io/specification · code.claude.com/docs/en/skills · hesreallyhim/awesome-claude-code · travisvn/awesome-claude-skills (secondary) · ComposioHQ/awesome-claude-skills (secondary) · lobehub/lobe-chat-plugins · nanbingxyz/5ire · CherryHQ/mcpmarket · LibreChat discussion #9837 (forum) · librechat.ai/docs/features/mcp · DBFritz/lobechat-mcp-plugin · civilware/tela · civilware/Gnomon · DEROFDN/Engram · deroproject/derohe · feather-wallet/feather · elizaOS/eliza · coinbase/onchain-agent-demo · alibaba/page-agent (user-suggested, fetched directly)
