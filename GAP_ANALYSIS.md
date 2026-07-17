# DERO Hive → AI Work Hub: Gap Analysis & Phased Roadmap

Date: 2026-07-17 · Basis: full-source audit of `src/main`, `src/shared`, `src/renderer`, `cli/`, `resources/` (8 parallel audit passes, all claims verified against code).

---

## 0. Executive Summary

The audit's headline: **this is much further along than "a desktop app that talks to LLMs"** — provider abstraction with fallback chains, MCP client, permission system, skills lifecycle, swarm prototype, knowledge vault, voice, and a CLI that reuses the desktop's services all exist and mostly work. The mission is therefore extension, exactly as requested.

But the audit also found **claimed-but-dead or cosmetic features** that must be fixed before building on top of them, because several target features (cost routing, autonomy, evals) depend on them:

- **Cost tracking is a facade.** `ProviderModel.inputPrice/outputPrice` are read by both dashboards but *no code path ever writes them* — every cost figure renders "—". OpenRouter's `pricing` field is fetched but not parsed.
- **Swarm persistence is vaporware.** `swarm_runs`/`swarm_tasks` tables exist (migration v9, with `phase`/`worktree_path` columns) but nothing reads or writes them; swarm execution lives entirely in the renderer, run records are in-memory, and worker conversations are deleted after each run.
- **Desktop plan mode is advisory-only with API providers** — it injects a system-prompt note but does not filter tools (real filtering exists only in the CLI and for Codex ACP).
- **`cli/src/utils/agentMemory.ts` (290 lines, a real ranked-memory library) is dead code** — nothing outside its tests imports it.
- **No checkpoint/rollback for file edits.** Before/after snapshots are 50 KB-capped, held in renderer memory, display-only, and die on conversation switch. Git is the only revert path.
- **Historical tool-call results never re-render** after conversation reload (results live in an in-memory map fed only by live stream events).
- **`run_shell` is unsandboxed** — full user environment, unrestricted network, unrestricted command string; only `cwd` is path-validated.
- **Agent reads of secrets are unguarded** — `read_file` will happily ship a workspace `.env` to the LLM.
- **Approval coverage has holes** — `generate_image/audio/video` (spend money), `generate_tela_dapp`, `simulator_create_wallet` never prompt; trusted MCP servers skip all prompts.
- **Errors are untyped strings** ending in a dismiss-only banner; the transparent auto-retry/fallback is never surfaced.
- **Config lives in one SQLite DB** — no export/import of providers/agents/permissions/settings; the `mcp.json` path is defined but unused.

---

## 1. Gap Analysis by Feature Area

Effort: **S** < 1 day · **M** 1–3 days · **L** multi-day / architectural. Risk: low / med / high (blast radius if done wrong).

### 1. Provider & Model Layer

Where we are: unified schema in `src/shared/types.ts` + `presets.ts` (12 presets incl. **OpenCode Zen and Go — already done**); 3 adapters (`openai-compatible`, `anthropic`, `codex-acp`); live capability fetch (OpenRouter/Ollama/Anthropic) + static table (~80 models); fallback chains with full conversation-state preservation (pre-output only, `chat.ts:122-156`).

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Bedrock / Vertex / Azure presets | M (Azure S–M) | med | Azure ≈ OpenAI-compat + `api-version` + deployment routing. Bedrock needs SigV4 signing, Vertex needs GCP OAuth — new auth paths in main only |
| llama.cpp server / LM Studio presets | S | low | Already reachable via `custom`; make named presets with correct defaults |
| Prompt-caching capability flag + Anthropic `cache_control` + cached-token usage capture | M | low | `anthropic.ts` claims caching in a comment but never sends `cache_control`; cached tokens not captured anywhere |
| Pricing data pipeline (parse OpenRouter `pricing`, static table, editor) | S | low | Unblocks cost dashboard AND cost routing |
| Failover error classification (429 vs 5xx vs auth) | M | low | Today "any error = next provider", no retry-after handling |
| Per-role model config (chat / background / utility / cheap) | M | med | Prerequisite for routing + cheap-model offload |
| Cost-aware router w/ escalation signals (context length, repeated failures, user override) | M | med | Deterministic policy-as-data executed in `chat.ts` pre-request; depends on pricing + classification |
| Ollama first-class: `/api/show` real context, pull, `num_ctx`, keep-alive | M | low | Currently just an OpenAI-compat endpoint |
| VRAM fit check + KV-cache quant surfacing | M | low | Estimate from model size metadata + user GPU profile setting; encode RTX 5080/5070 Ti knowledge as presets |

### 2. Agent Orchestration

Where we are: Swarm exists (parallel specialists → one-shot Verify → Synthesizer) but is a 360-line renderer component with hardcoded topology; 17 prompt-only personas; dispatch heuristic for auto-swarm.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| `AgentDefinition` v2: model override, tool allow-list, skill refs, context budget | M | med | Schema + migration + resolution logic; unlocks templates, roster, sub-agents |
| Enforced per-agent tool scoping (today "read-only worker" is prompt text) | S–M | low | Filter in `ToolRegistry.listTools`/dispatch once agents carry allow-lists |
| Sub-agent spawn tool (planner → worker, isolated context + budget, report-back) | M | med | New built-in `spawn_agent` tool; execution in main process |
| Critique/refine loop primitive (generator → critic → refine until pass/budget) | M | low | Generalize Verify into a reusable pattern runner |
| General graph execution engine (nodes/edges/hand-offs as data, main-process) | L | high | The big one; supersedes renderer SwarmModal; persists runs |
| Live orchestration view (which agent active + why) | M | med | Depends on engine events + multi-session renderer (5.) |
| Self-evolve in-app: start/pause/kill, backlog view, run history, cycle diffs | L | high | Driver in main process; depends on checkpoints (3.), run history (6.), trust (7.); honor existing STOP/PAUSE sentinels |

### 3. Tooling & MCP

Where we are: 21 built-ins (read/write/edit/glob/grep/shell/todo/DERO/media); MCP stdio + streamable-HTTP with tool/resource/prompt **discovery**; 4-mode approval with persisted per-tool rules (substring/regex patterns); symlink-safe path containment.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Web fetch + web search tools | S–M | low | Biggest parity hole vs OpenCode; search needs a provider (Brave/Tavily key or local SearXNG) |
| Structured git tools (status/diff/log/commit; push always-confirm) | S–M | med | Stops funneling git through opaque `run_shell`; distinguishes commit vs push |
| OS-level sandboxing for `run_shell` | L | high | See ADL-2; staged approach, Phase 1 delivers audit+trust baseline |
| Fix approval bypasses (media gen, tela scaffold, simulator wallet) | S | low | One list in `registry.ts:172-182` + trusted-MCP write gating |
| Desktop permission-rules manager UI (rules are CLI-only today) | M | low | Panel + IPC over existing `permissions` table |
| True glob + per-directory path rules | M | med | Current `pattern` is substring/regex on stringified args; needs path semantics |
| Per-agent MCP tool allow-lists | S–M | low | Follows AgentDefinition v2 |
| MCP namespacing (`server:tool` advertised names) | M | med | Breaking for saved rules; collisions currently first-match-wins, builtins shadow MCP |
| MCP resources/prompts consumption (`readResource`/`getPrompt` don't exist) | M | low | Discovery exists; wire into context/composer |
| Tool-call re-run + edit-args-and-retry in transcript | M | low | Also fix historical-result rendering bug |
| `edit_file` multi-hunk / patch-style edits | M | med | Current: single exact-match replacement per call |

### 4. Context & Memory

Where we are: auto+manual compaction at 85% (regex-heuristic, not LLM); knowledge vault (Obsidian via MCP, consent-gated, digests) but **never injected into chat context**; full skills lifecycle (discovery/parse/sync/import UI) but global enable, prompt-replacement injection, no watcher.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| First-class project memory store (persistent facts/decisions, hand-editable) | M | med | Revive `agentMemory.ts` ranking; file-backed (`.hive/memory.md` in project) + db index — syncs via folder sync, editable anywhere (ADL-5) |
| Session memory vs project memory UI (view/edit both) | M | low | Memory panel + composer indicator |
| Memory injection into context with per-component token budgets | M | med | `tokenBudget.ts` is estimation-only today; no per-component caps exist |
| LLM-summarizing compaction (replace regex heuristics) + compaction archive/log viewer | M | med | Originals are hard-deleted today; archive dropped messages + "what got compacted" view |
| Semantic search (embeddings + local vector store over sessions + project files) | L | med | See ADL-1; biggest single infra add in this area |
| Per-session skill toggles + browse panel | S–M | low | `skills.enabled` is global; add per-conversation map |
| Skills: import-by-reference, fs watcher, external "home" folder, companion dirs | M | low | Copy-only + restart/rescan today; fixes Homebase sync use-case |
| Skills stop replacing the whole system prompt on invoke | S | low | Compose instead of replace (`chat.ts:320`) |

### 5. Sessions & Projects

Where we are: fork (whole + from-message) with `parent_id`; per-conversation model/provider/system-prompt; **main process already runs N concurrent streams** (`activeRequests` map); renderer is architecturally single-session (events for non-visible conversations are dropped).

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Multi-session renderer: per-conversation stream state, tabs, background progress, permission-prompt attribution | L | med | Store restructure (`stores/app.ts` single streaming buffer → per-conv map); unlocks orchestration UX + concurrent work |
| Checkpoint/rollback for agent file edits (persisted, revertible) | M | med | See ADL-3; foundation for per-hunk review AND self-evolve diffs |
| Fork branch tree + navigation (siblings, fork point, view-parent click-through) | S–M | low | `parent_id` exists; store fork-point message id |
| Project templates (skills/agents/permissions/model presets; "DERO dev", "BA") | M | low | Extend `projects.config`; depends on AgentDefinition v2 |
| Per-session agent + permission config (currently global settings) | M | med | Part of multi-session work |

### 6. Observability & Cost

Where we are: per-message token usage recorded; UsagePanel today/7d/30d by model+provider (but cost dead); budget alerts; per-turn token bar; leveled file logger.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Populate pricing (see 1.) — makes the existing dashboard real | S | low | Highest leverage-per-hour in the whole list |
| Live per-session token/cost meter (stream `usage` events; currently dropped at `useChat.ts:55`) | S | low | |
| Cached-token capture (Anthropic + OpenAI) | S | low | |
| Error taxonomy: provider vs tool vs harness, with retry/abort + visible fallback notices | M | low | Typed errors through `StreamEvent`; persist `messages.error` (dead column) |
| Full request/response payload logging (toggleable, redacted) | M | med | Redaction must be provable; off by default |
| Run history (activate `swarm_runs`/`swarm_tasks`; duration, tokens/cost, pass/fail, diff summary) | M | low | Schema exists; write from main-process runner |
| Tool-execution audit trail (persisted: args-redacted, decision, files touched) | M | med | Feeds sandbox story + security requirement |

### 7. Security & Secrets

Where we are: secrets in Electron safeStorage (v2) with documented v1 obfuscation fallback; renderer never sees keys; no plaintext keys on disk (verified); loopback-only bridges; hashed pairing tokens.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Secret-file guard for agent tools (`.env*`, `*.pem`, `id_rsa`, `*.key` denied by default) | S | low | Currently `read_file` ships `.env` to the LLM |
| Log redaction utility (Bearer/sk-/AKIA patterns) applied at all call sites | S | med | `HIVE_DEBUG` SSE fragments are logged unredacted today |
| Per-project trust level gating auto-run modes (untrusted ⇒ always ask) | M | low | `never`/autopilot is offered globally today |
| Harden `SHELL_RUN` IPC (arbitrary exec, only cwd validated) | M | med | Gate behind trust + approval like `run_shell` |
| OS sandbox for tool execution (FS scope + network egress control + touched-files audit) | L | high | ADL-2; Windows Job Objects don't do FS/net — realistic path is container (WSL2/Docker) opt-in per project |
| Scope FS allowed-roots to *active* project only | S | med | Today every registered project widens renderer FS reach globally |

### 8. Extensibility

Where we are: MCP = only true plugin mechanism; custom OpenAI-compatible providers via UI; skills/slash-commands/agents/custom-CSS are file-based; new provider = edit ≥5 files + rebuild.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Config-as-code export/import (providers sans keys, agents, permissions, projects, settings, skill refs) | M | med | ADL-4; solves the two-machine problem; secrets excluded by design, re-prompted on import |
| Plugin API (manifest, tools/providers/panels without forking) | L | high | ADL-6; recommend MCP-plus-thin-registry, not a sandboxed JS runtime |
| Skill import by reference + watcher (see 4.) | M | low | |

### 9. Multi-modal & Input

Where we are: image input end-to-end with vision gating + fallback filtering; audio on OpenAI path; whisper.cpp bundled dictation (~85%: 3 modes, device select); media generation studio.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Paste-to-attach (clipboard images/files/text → attachment) | S | low | No `onPaste` handler exists anywhere in renderer |
| Push-to-talk + VAD auto-stop + true streaming whisper | M | low | Current "live" mode re-transcribes the whole buffer every 1.4 s |

### 10. Developer Experience / UI

Where we are: Activity panel (view-only diffs); Code tab (explorer + hljs editor + one piped shell + embedded chat); Ctrl+K palette (navigation/conversations/skill-insert); theme engine (4 presets + accent + custom CSS); ErrorBoundary.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Per-hunk accept/reject diff review | M | med | Builds on checkpoints (ADL-3); Activity panel is view-only today; permission dialog shows raw JSON not a diff |
| Permission dialog renders a diff for file writes | S | low | Snapshot meta already exists at decision time |
| Palette: model/agent/theme switching (CLI Ctrl+P parity) | S | low | |
| PTY terminal (node-pty, tabs/splits, interactive programs) | M | med | Current: one sentinel-framed piped shell, no PTY; native rebuild for Electron |
| Neon/cyan-magenta theme preset | S (≈15 lines, 2 files) | low | `theme.ts:60` + `GeneralPanel.tsx:166` |

### 11. Testing & Evaluation

Where we are: 45 tsx assert-script tests (all passing), typecheck ×3, eslint; `vitest.config.ts` is an intentional empty stub; **no CI at all**.

| Gap | Effort | Risk | Notes |
|---|---|---|---|
| Eval harness: replayable sessions + outcome assertions against mocked providers | L | med | ADL-7; golden fixtures + nock-style provider mocks + live mode |
| stop-slop quality gate as built-in output check | M | low | No trace in repo today; surface its checks as a post-generation gate (needs the skill's check list encoded) |
| CI (GitHub Actions: typecheck + lint + tests) | S | low | Tests already scriptable |

---

## 2. Phased Roadmap

Ordered by leverage: each phase unlocks the next. Every phase ships useful value alone.

**Phase 0 — Correctness quick wins** (days, zero dependencies, mostly bug fixes)
Fix historical tool-result rendering; permission dialog shows diffs; approval-bypass fixes; secret-file guard; log redaction; skill-invoke prompt composition (not replacement); palette model/agent switching; paste-to-attach; neon theme; CI workflow. *Why first: cheap trust + several README claims become true.*

**Phase 1 — Trust & Cost Foundation** (fully scoped in §4)
Pricing pipeline + live meter + cached tokens; error taxonomy + visible fallback/retry; per-project trust levels; tool-execution audit log; **file-edit checkpoints + rollback**; desktop permission-rules UI + real desktop plan mode.
*Why this is the keystone: cost routing needs pricing data; self-evolve needs checkpoints + trust + audit; per-hunk review needs checkpoints; eval harness needs typed errors. Everything autonomous later stands on this.*

**Phase 2 — Provider Parity & Routing**
Azure preset; Bedrock (SigV4); Vertex (OAuth); llama.cpp/LM Studio presets; prompt-caching flag + Anthropic `cache_control` + cached-token billing; Ollama first-class (show/pull/num_ctx/keep-alive + VRAM/KV surfacing); failover classification (429/5xx/auth); per-role models; cost-aware router with escalation. **Config-as-code export/import** (independent track; schema now stable enough).

**Phase 3 — Agent Platform**
AgentDefinition v2 + enforced tool scoping; per-agent MCP allow-lists; sub-agent spawn tool; critique/refine primitive; main-process graph engine superseding SwarmModal (activating `swarm_runs`); live agent-status view; **multi-session renderer** (prereq, schedule first in-phase); web fetch/search + git tools + MCP namespacing; project templates (DERO-dev, BA).

**Phase 4 — Memory & Knowledge**
Project memory store (file-backed + ranked injection + budgets); memory UI; LLM compaction + archive/viewer; per-session skills + reference-import + watcher; semantic search (embeddings + vector store); opt-in vault→context injection.

**Phase 5 — Autonomy & Quality Gates**
Self-evolve loop in-app (driver, controls, backlog, run history, cycle diffs via checkpoints); OS sandbox (container-based, opt-in per project — ADL-2); eval harness; stop-slop gate; PTY terminal.

**Phase 6 — Platform Extensibility**
Plugin API (ADL-6); per-hunk accept/reject UI polish; voice polish (PTT/VAD/streaming); MCP resources/prompts consumption.

Explicitly NOT in any phase (guardrails honored): no second config format (all config extends `src/shared/types.ts`); MiMo/DeepSeek free pair remains a fully functional default everywhere (router defaults to free pair; semantic search defaults to local embeddings); no premium provider required for any baseline feature.

---

## 3. Architecture Decisions Log — for Oracle review before implementation

**ADL-1 · Vector store for semantic search (Phase 4).** Options: (a) `sqlite-vec` extension in the existing better-sqlite3 DB; (b) `hnswlib-node`; (c) pure-JS index (voy-search) in a sidecar file. **Recommend (a)**: one DB file, WAL, no new service, matches existing native-module build pipeline (sqlite-vec ships prebuilds loadable via better-sqlite3 `loadExtension`). Embeddings: local-first via Ollama `nomic-embed-text` or transformers.js MiniLM — keeps free default intact; provider embeddings (OpenAI voyage etc.) as opt-in. *Review point: extension loading under asar + CLI dual-build (`patch-sqlite3-dual.mjs`).*

**ADL-2 · Sandbox approach for `run_shell` (Phase 5; baseline in Phase 1).** Windows truth: Job Objects restrict processes/resources but not filesystem paths or network. Options: (a) approval + audit only (status quo+); (b) per-project WSL2/Docker container execution with mounted workspace and `--network none` unless allowed; (c) Windows Sandbox (heavy, Pro-only); (d) restricted-token child processes (partial). **Recommend staged: Phase 1 ships (a) done properly (trust levels + audit trail); Phase 5 adds (b) as opt-in per project trust=standard+**, which is the only option that delivers the stated "scoped FS + no network unless allowed" with real enforcement. *Review point: Docker/WSL2 dependency for a desktop app; fallback when absent = approval mode.*

**ADL-3 · Checkpoint storage (Phase 1).** Options: (a) shadow git repo per project (aider-style); (b) content-addressed snapshot store in userData + db index; (c) in-project `.hive/checkpoints/`. **Recommend (b)**: no repo pollution, works for non-git projects, dedupes by hash; snapshots keyed by tool_call_id so Activity entries, per-hunk review, and self-evolve diffs all read the same store. Full before-content captured (no 50 KB cap for persistence; cap display only). *Review point: storage growth — prune policy tied to conversation deletion.*

**ADL-4 · Config-as-code format (Phase 2).** **Recommend JSON documents validated by zod schemas generated alongside `src/shared/types.ts` types** (no second config format — the unified provider schema *is* the file format), one `hive-home/` folder: `providers.json` (keys as `secret://` refs), `agents.json`, `permissions.json`, `projects.json`, `settings.json`, `skills/` (by reference). Import reconciles by id, re-prompts for secrets. *Review point: YAML is friendlier to hand-edit but adds a parser dep and drift risk.*

**ADL-5 · Memory storage (Phase 4).** **Recommend file-backed project memory (`.hive/memory.md` in project, human-editable, syncs with folder/Homebase) mirrored into a db table for ranked retrieval** (revive `agentMemory.ts` scoring: Jaccard + recency + pin + budget). Session memory stays in conversation rows. *Review point: two writers (app + hand edits) — last-write-wins with mtime check.*

**ADL-6 · Plugin API shape (Phase 6).** Options: (a) sandboxed JS runtime (isolated-vm); (b) MCP-everything (plugins are local MCP servers); (c) in-process trusted modules with manifest. **Recommend (b)+(thin c): tools/providers ship as MCP servers or config entries (already works); add a narrow declarative "panel plugin" registry (manifest + webview) later.** A full sandboxed runtime is a large attack surface for marginal gain. *Review point: DERO Command Center (Engram/Netrunner/TELA) fits as bundled MCP + panel preset rather than a plugin-runtime tenant.*

**ADL-7 · Eval harness design (Phase 5).** **Recommend golden-session JSON fixtures (recorded via Phase 1 payload logging, sanitized) replayed against provider mocks**, assertions as data: `contains`, `not_contains`, `tool_called(name, args-match)`, `file_exists/content_match`, `max_turns`, `cost_ceiling`. Live-provider mode for smoke evals. *Review point: assertion brittleness vs deterministic mocks.*

**ADL-8 · Orchestration execution location (Phase 3).** **Recommend main-process graph engine** (nodes = agent+model+tool-scope+budget; edges = hand-off rules; state = scratchpad table), renderer subscribes to run events; CLI reuses the same engine (mirrors existing CLI/desktop service sharing). Renderer-side SwarmModal is retired to "launch config UI". *Rationale: persistence, reload survival, CLI parity, self-evolve reuse.*

**ADL-9 · Self-evolve driver (Phase 5).** **Recommend main-process loop runner**: file-based state in `SELF_EVOLVE/` (existing convention), honors `STOP`/`PAUSE` sentinels (already in `.gitignore`), each cycle = one graph-engine run with checkpoint diff captured, rows in `agent_runs`. Start/pause/kill = IPC to the runner. *Review point: cycle cost ceilings + mandatory trust=trusted project.*

**ADL-10 · Router design (Phase 2).** **Recommend deterministic policy-as-data**: roles (`chat`, `background`, `utility`) → ordered candidate list with cost ceilings; escalation triggers (context > X% of window, N consecutive tool failures, explicit user override) bump to next tier; every routing decision logged to the audit trail. No LLM-in-the-loop routing initially. *Rationale: predictable bills, debuggable, eval-able.*

---

## 4. Phase 1 Work Order — "Trust & Cost Foundation" (ready for Sisyphus)

Goal: make Hive safe to automate and honest about cost. No new user-facing "features" beyond visibility — this phase turns existing claims real.

### 1A. Pricing pipeline & live meter
- `src/main/providers/models.ts`: parse OpenRouter `pricing.prompt/completion` → `$/1M` into `ProviderModel.inputPrice/outputPrice`; Anthropic + OpenAI static prices into `KNOWN_MODELS` (`src/shared/modelMetadata.ts`); Groq/MiniMax/Kimi where published.
- `src/main/providers/anthropic.ts` + `openai-compatible.ts`: capture `cache_read_input_tokens`/`cache_creation_input_tokens` (and OpenAI `prompt_tokens_details.cached_tokens`) into the usage object; extend usage type in `src/shared/types.ts`.
- `src/renderer/src/hooks/useChat.ts:55`: stop dropping `usage` events; accumulate live per-conversation in `stores/app.ts`; `TokenUsage.tsx` reads live accumulator; `UsagePanel.tsx` refreshes on `done`.

### 1B. Error taxonomy & visible resilience
- New `src/shared/errors.ts`: `HiveError { category: 'provider'|'tool'|'harness', kind: 'rate_limit'|'auth'|'quota'|'overloaded'|'network'|'invalid_request'|'unknown', retriable, retryAfterMs?, providerId?, model? }` with classifiers per adapter (status + body sniffing).
- `src/main/ipc/chat.ts`: use classification in `streamWithFallback` (rate_limit/overloaded ⇒ backoff then next target; auth/quota ⇒ abort chain); emit `fallback` stream event (from→to, reason); persist `messages.error`.
- `src/shared/types.ts`: `StreamEvent.error` becomes structured; `ChatView.tsx` banner gains category, Retry (resend last turn), Dismiss; fallback toast.

### 1C. Per-project trust levels
- `src/shared/types.ts`: `ProjectConfig.trust: 'untrusted'|'standard'|'trusted'` (default `standard`; migration in `db/client.ts` v14).
- `src/main/tools/registry.ts`: permission request path consults active project's trust — `untrusted` forces ask (ignores `never` mode and session/project grants; autopilot not offered in UI); `trusted` unlocks autopilot offering.
- UI: trust selector in `ProjectsPanel.tsx`; composer mode switcher (`ComposerToolbar.tsx`) filters disallowed modes.

### 1D. Tool-execution audit log
- Migration v15: `tool_executions(id, conversation_id, tool, args_redacted, decision, duration_ms, status, files_touched, created_at)`.
- `src/main/tools/registry.ts` + `src/main/ipc/shell.ts`: write rows (args passed through redaction util); new right-sidebar **Audit** tab (paged list, expandable).
- New `src/main/utils/redact.ts`: Bearer/sk-/AKIA/private-key patterns; applied to audit rows, logs, and (Phase-2) payload logging.

### 1E. File-edit checkpoints + rollback (ADL-3)
- New `src/main/checkpoints/store.ts`: content-addressed blobs under `userData/checkpoints/`; migration v16: `file_checkpoints(id, conversation_id, tool_call_id, path, before_hash, after_hash, size_bytes, created_at, reverted_at)`.
- `src/main/tools/builtin.ts`: `write_file`/`edit_file` capture full before-content (null for new files) pre-mutation; return `checkpointId` in meta.
- IPC `CHECKPOINT_REVERT` / `CHECKPOINT_LIST` / `CHECKPOINT_REVERT_ALL(conversationId, since)`; `ActivityPanel.tsx`: per-entry Revert + "revert conversation's changes" batch; snapshots survive conversation switch/restart (main-owned, not renderer memory).

### 1F. Desktop permission-rules UI + real plan mode
- Replace read-only `ToolsPanel.tsx` with rules manager (list/add/remove: tool, action, pattern, scope, project) over existing IPC/`permissions` table (parity with CLI `/permissions`).
- `src/main/ipc/chat.ts`: enforce plan mode tool filtering (port `PLAN_SAFE_TOOL_NAMES` approach from `cli/src/services/chat.ts:18-25`), not just a prompt note.

### Test plan (repo convention: tsx assert scripts, registered in `package.json`)
- `models.pricing.test.ts` — OpenRouter pricing parse fixtures; static table sanity.
- `errors.classify.test.ts` — status/body fixtures per adapter → correct kind/retriable.
- `redact.test.ts` — secret-pattern corpus (keys, .env blocks, PEM headers).
- `registry.trust.test.ts` — trust×mode matrix (untrusted+never ⇒ ask; deny rules absolute).
- `checkpoints.test.ts` — write/edit → capture → revert round-trips in temp dirs; new-file revert deletes; batch revert; 50KB+ file not truncated.
- `audit.log.test.ts` — execution writes row; args redacted; decision recorded.
- `useChat.usage.test.ts` — usage event accumulation reducer.
- Contract tests (style of `conversations.contract.test.ts`) for new IPC channels.
- Gate: `npm run typecheck && npm run test:all` green; manual checklist — forced-429 mock shows fallback toast + retry; `.env` read denied; cost figures populate for OpenRouter; revert restores file bytes exactly.

### Out of scope for Phase 1
New providers, routing policy, graph orchestration, sandbox containers, payload logging UI, per-hunk accept/reject (checkpoints land the data layer only), the `.env` secret-file guard (Phase 0 — the checklist line above predates the split).

### Status: DELIVERED 2026-07-17
All six workstreams implemented and verified: `npm run typecheck` (node+web+cli), `npm run test:all` (vision + shared + cli + lint ×2), `npm run test:renderer` — all green, including 8 new test files (errors, redact, pricing, cached-tokens, checkpoints, trust-matrix, plan-mode/fallback, usage accumulator). Known follow-ups: provider-native `requestPermission` (Codex ACP) not yet trust-gated; live cost chip may mis-price after a mid-turn fallback (persisted per-turn usage is correctly attributed); checkpoint revert intentionally overwrites later user edits (UI warns); CLI tool ctx lacks `toolCallId` wiring; `PermissionRule.createdAt` not surfaced in UI.

---

*Handoff notes: §3 is packaged for Oracle review (10 decision points, recommendations included). §4 is executable as written. Phases 2–6 get full work orders at phase entry.*
