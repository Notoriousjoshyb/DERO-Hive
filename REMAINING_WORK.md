# DERO Hive — Remaining Work

Date: 2026-08-15 · Single backlog consolidating what is left from [EXPERIENCE_PLAN.md](EXPERIENCE_PLAN.md) (UX/UI phases) and [HARNESS_INTEGRATION_PLAN.md](HARNESS_INTEGRATION_PLAN.md) (features borrowed from DeepSeek Harness and Unsloth Studio). [GAP_ANALYSIS.md](GAP_ANALYSIS.md) remains the deeper architectural audit — this file does not restate it.

Effort: **S** < 1 day · **M** 1–3 days · **L** multi-day.

---

## 0. Decide this first — it gates everything in §2

**Session event log (H6, L).** Adopt dsh's model: an append-only `session_events` table as the source of truth, with the model's message history *derived* from it rather than stored separately, and the invariant that anything model-visible must be reconstructable from the log.

- **Why it matters:** it is the root fix for the bug the July audit found — historical tool results never re-render after reload, because they live in an in-memory map fed only by live stream events.
- **Why it is urgent:** it rewrites the same code **E2.1** rewrites. Doing E2 first means doing the store restructure twice.
- **Not a Cordis port.** The valuable parts are the data model and the invariant, both of which fit the existing SQLite + migration pattern.
- Migration shape: add `session_events` → write events for user message, assistant chunk, assistant message, tool call, tool result, injected context → derive the transcript and the provider request from it → keep `messages` as a projection until derivation is trusted, then drop it.

**Answer needed:** in scope before E2, or explicitly deferred (accepting that E2 gets redone later)?

---

## 1. Loose ends from work already shipped

Small, and each one closes a hole I knowingly left open.

| # | Item | Where | Effort |
|---|---|---|---|
| 1.1 | ~~**Prune spill files when a conversation is deleted.**~~ ✅ **Shipped 2026-08-15** — `pruneSpill()` in `src/main/tools/spill.ts`, called from `CONV_DELETE` beside the checkpoint prune. A fork referencing a pruned path now gets an honest "file not found". | S |
| 1.2 | **Verify the CI install path.** `npm ci --ignore-scripts` + `npm rebuild better-sqlite3` is reasoned but unproven — it cannot be tested locally. First push to GitHub confirms or breaks it. | `.github/workflows/ci.yml` | S |
| 1.3 | ~~**Add `THIRD_PARTY_NOTICES.md`.**~~ ✅ **Shipped 2026-08-15** — repo root. Lists every file adapted from dsh, the Unsloth manifest pattern (no code taken), bundled binaries and the notable npm licences. | S |
| 1.4 | ~~**Check Unsloth's licence.**~~ ✅ **Resolved 2026-08-15** — Unsloth dual-licenses and the split matters: the core `unsloth` library is Apache-2.0, but **Studio / Desktop is AGPL-3.0** — the very part whose layout inspired `scripts/lib/assets.mjs`. AGPL is copyleft and incompatible with Hive's MIT, so **no Unsloth Studio code may ever be copied in**. Only the manifest *idea* was taken, which is fine. Recorded in `THIRD_PARTY_NOTICES.md`. | — | S |
| 1.5 | ~~**Resolve the gateway preset defaults.**~~ ✅ **Shipped 2026-08-15** — verified against each gateway's own catalog: Zen serves bare `claude-opus-5`, OpenRouter serves `anthropic/claude-opus-5` ($5/$25, 1M ctx). Both presets repointed, OpenRouter metadata added (incl. `-fast` at 2×), and both ids pinned by assertions in `presets.test.ts` / `modelMetadata.test.ts`. | `src/shared/presets.ts` | S |
| 1.6 | ~~**Revise ADL-2 in GAP_ANALYSIS.**~~ ✅ **Shipped 2026-08-15** — the "container is the only realistic path" conclusion is struck through and replaced. Revised recommendation: restricted-token + ACL, opt-in per project, no Docker/WSL2 dependency. **Network egress remains unsolved** — dsh's sandbox vocabulary excludes network and process visibility, so "no network unless allowed" needs a separate mechanism. | `GAP_ANALYSIS.md` | S |
| 1.7 | **Pin the whisper model hash** if upstream ever publishes a checksum. Today it is trust-on-first-use, recorded but not asserted. | `scripts/setup-whisper.mjs` | S |

---

## 2. E1–E2 — the shell and multi-session (the core UX unlock)

Still the work that most changes daily use. **E2 depends on the §0 decision.**

### E1 — Workspace shell (~1 week)

| # | Item | Effort |
|---|---|---|
| 1.1 | **Tabbed main area.** Chat / Code / Vision / Cockpit become tabs, not the either-or ternary at `App.tsx:127`. Multiple chat tabs. `Ctrl+1..9`, middle-click close, `Ctrl+Shift+T` reopen. | M |
| 1.2 | **Split view.** One vertical split — chat left, code or vision right. Drag to resize, double-click divider to reset. | M |
| 1.3 | **Right dock consolidation.** Vision, Companion and RightSidebar stop being three competing panels; one dock with its own tab strip (Activity / Files / Git / Context / Usage / Audit / Graph / Vision / Companion). | M |
| 1.4 | **Persisted layout + presets.** Widths, open tabs, dock selection saved. Ship *Chat*, *Build*, *Review* presets. Must go in the single `appSettings` blob — top-level keys are dead reads. | S |
| 1.5 | **Command palette parity.** Model, agent, theme, layout-preset and provider switching, matching the CLI's `Ctrl+P`. | S |

### E2 — Multi-session (~1 week, gated by §0)

| # | Item | Effort |
|---|---|---|
| 2.1 | **Per-conversation stream state.** `stores/app.ts` moves from one `streamingContent`/`streamingReasoning`/`isStreaming` triple to a `Map<conversationId, StreamState>`; `useChat.ts` routes events by id instead of assuming the visible conversation. | L |
| 2.2 | **Background progress.** Sidebar rows for running conversations show spinner, token count, elapsed time; tab strip shows a dot. | S |
| 2.3 | ~~**Permission-prompt attribution.**~~ ✅ **Shipped 2026-08-15** — the dialog names the asking conversation, shows "1 of N" when several are waiting, traps Escape as *deny*, and carries `role="dialog"`/`aria-modal` with focus moved to Deny. | S |
| 2.4 | **Notification centre.** One toast + history surface for: run finished, run failed, tool denied, scheduled task fired, MCP dropped, budget threshold crossed. Click-through jumps to the conversation; OS notification when unfocused. Generalizes `CompactionToast.tsx`. | M |
| 2.5 | ~~**Background jobs (H5).**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/jobs.ts`, `run_in_background` on `run_shell`, and `job_list` / `job_output` / `job_kill` over one kind-agnostic registry. The parameter and the three tools are removed from the schema when the capability is off. Completion notices ride on the next tool result until §0 gives them a real channel. | M |

---

## 3. Tools and capabilities

| # | Item | Source | Effort |
|---|---|---|---|
| 3.1 | ~~**`web_fetch`**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/webFetch.ts`. Every redirect hop is re-validated against private/loopback ranges, body capped at 2 MB while streaming, non-text types refused by name. | E3.1 | S |
| 3.2 | ~~**`web_search`**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/webSearch.ts` with Brave, Tavily and SearXNG behind one seam. Unconfigured means the tool is filtered out of the advertised list. Keys go to the secret store through a new allowlisted `settings:setSecret` channel that is write-only from the renderer. | E3.2 | M |
| 3.3 | ~~**Structured git tools**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/git.ts`, all six tools, argv not shell strings, `-z` porcelain parsing. `git_push` asks in every approval mode via the new `ALWAYS_CONFIRM` set. Still to do: point the Git dock panel at the same parsed data. | E3.3 | M |
| 3.4 | ~~**Multi-hunk `edit_file`**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/edits.ts`. Ordered hunks over the evolving text, atomic, with `replace_all` for the deliberate many-match case. | E3.4 | M |
| 3.5 | **Tool-call re-run + edit-args-and-retry** in the transcript, fixing the historical-result rendering path at the same time. Largely subsumed if §0 lands. | E3.5 | M |
| 3.6 | ~~**MCP namespacing**~~ ✅ **Shipped 2026-08-15** — `src/main/mcp/namespace.ts`. Advertised as `mcp__server__tool`, **not** `server:tool`: a colon fails the Anthropic/OpenAI tool-name schema `^[a-zA-Z0-9_-]{1,64}$` and would invalidate the whole request. No migration was needed — a rule saved against a bare tool name still matches via an alias in `matchRule`. | E3.6 | M |
| 3.7 | **MCP resources & prompts** — discovery already works; wire `readResource`/`getPrompt` into composer `@` autocomplete and the context panel. | E3.7 | M |
| 3.8 | ~~**`lsp` tool behind a provider seam (H11).**~~ ✅ **Shipped 2026-08-15** — `src/main/lsp/` (framing codec, session, manager) + `src/main/tools/lsp.ts`. Actions: definition, references, hover, diagnostics, symbols. Schema never changes; an unserved file type returns `LSP_UNAVAILABLE` naming `grep_files` as the fallback. Servers are configured in Settings → General → Language servers; nothing is downloaded. | dsh | M |
| 3.9 | **Capability seams (H12)** — Definition / Provider / Consumer as a convention for fs, shell, subprocess, web. The payoff: pointing fs + subprocess at a remote sandbox moves Bash, PTY and LSP with them, no forks. | dsh | M |
| 3.10 | ~~**Generated tool catalog (H10)**~~ ✅ **Shipped 2026-08-15** — `src/main/tools/catalog.ts`, output at `docs/TOOL_CATALOG.md`, regenerated with `npm run docs:tools`. `catalog.test.ts` fails CI on drift or an undocumented tool/parameter. | dsh | S |

---

## 4. Security and local inference

| # | Item | Source | Effort |
|---|---|---|---|
| 4.1 | **Windows ACL sandbox for `run_shell` (H7).** Restricted-token + ACL, no container needed. Modes `read-only` / `workspace-write` / `danger-full-access`; enforcement reported honestly as `full` or `partial`; unusable runners **fail closed**, never silently unconfined. Per-session private temp with its own SID; reject a workspace that contains the platform temp root. | dsh | M |
| 4.2 | **Bundled llama.cpp (H9)** with GPU-backend auto-detection and published-prebuilt fallback, recorded through the manifest helper now in `scripts/lib/assets.mjs`. Gives genuine offline inference and direct GGUF loading. **Serve models, don't train them.** | Unsloth | M |
| 4.3 | **Per-project trust gating for the sandbox** — opt-in per project, surfaced in the UI alongside the existing trust levels. | — | S |

---

## 5. Composer and conversation craft (E4)

| # | Item | Effort |
|---|---|---|
| 5.1 | **Run-configuration chip** — one readable line ("Opus 5 · Plan mode · Ask on write · 3 skills · 12 tools") that expands into the full control surface; the ten icon buttons collapse into an overflow. | M |
| 5.2 | **Real labels** — `aria-label` + shortcut hint on every composer and title-bar control. | S |
| 5.3 | **Message actions** — hover row: copy, quote-reply, fork from here, edit-and-resend, collapse. `parent_id` exists but is unreachable per message. | S |
| 5.4 | **Fork tree navigation** — siblings, fork point, click through to parent. | M |
| 5.5 | ~~**Diff-first permission dialog**~~ ✅ **Shipped 2026-08-15** — `write_file` diffs against the file on disk (so an overwrite shows what is lost); `edit_file` renders a diff per hunk straight from its arguments, no read needed. | S |
| 5.6 | **Per-hunk accept / reject** — Activity panel goes from view-only to actionable, backed by checkpoints. | M |

---

## 6. Design system and polish (E5 — parallelizable)

| # | Item | Effort |
|---|---|---|
| 6.1 | **Token pass** — elevation, radius and spacing scales as tokens; audit for stray hex. (Colour tokens are done.) | S |
| 6.2 | **Density modes** — comfortable / compact on the existing `--spacing-density` variable. | S |
| 6.3 | **Accessibility pass** — `role="dialog"` + `aria-modal` + focus trap + restore-focus on all ~12 modals; consistent focus rings; keyboard reachability for icon-only controls. `AskUserDialog` is the pattern to copy. | M |
| 6.4 | **Empty and error states** — every panel gets a real empty state with the one action that fills it. `EmptyState.tsx` is the quality bar. | S |
| 6.5 | **Onboarding** — first-run: provider (free pair pre-selected), project folder, theme, three-step tour. Skippable, re-runnable from the palette. | M |
| 6.6 | **Neon preset** — ~15 lines across `theme.ts` and `GeneralPanel.tsx`. | S |

---

## 7. Larger bets — revisit after §2–§4

| # | Item | Source | Effort |
|---|---|---|---|
| 7.1 | **Subagent system (H8)** — `subagent`, `send_message`, `interrupt_agent`, `list_agents`, child-scoped `report`. Replaces the renderer-only Swarm prototype and activates the dead `swarm_runs` tables. Wants §0 and 2.5 first. | dsh | L |
| 7.2 | **Code mode / `run_code` (H13)** — the model writes one program that calls tools as bindings, collapsing N round-trips into one. Needs a worker runtime, generated per-language SDK sections in the prompt, and nested-call linkage back to the outer result. | dsh | L |
| 7.3 | **Runtime invariants registry (H14)** — package-owned runtime checks, selectable by config. Pairs naturally with the §0 "model-visible means logged" invariant. | dsh | M |
| 7.4 | **Project memory + semantic search** — GAP Phase 4. File-backed `.hive/memory.md` + ranked injection with token budgets; embeddings in `sqlite-vec`. | GAP | L |
| 7.5 | **Eval harness** — replayable golden sessions against mocked providers. | GAP | L |

---

## 8. Explicitly not doing

- **Cordis / plugin runtime / profiles+bundles.** The architectural decision of dsh's codebase, not a liftable feature. Hive already chose MCP-plus-thin-registry (ADL-6). Take the seam discipline (3.9) instead.
- **`goal` tool with authority rounds.** dsh gates goal mutations on "direct-human root authority" and admitted-round counts; Hive has no authority model to hang that on — ceremony without substrate.
- **Fine-tuning, LoRA/QLoRA, dataset designer, training runs.** Unsloth's product, not Hive's.
- **Doc i18n.** dsh ships `.i18n.yaml` + `.zh.md` per doc. Admirable; not a Hive problem.

---

## Suggested order

```
decide §0 ──┬── yes ──► event log (L) ──► E1 ──► E2 (incl. 2.5 jobs)
            └── no  ──► E1 ──► E2  (accepting a later redo)

parallel:   §1 loose ends (S, do now)
            §3 tools — 3.1/3.2/3.3 give the most day-one value
            §6 design/a11y — independent of everything else

after:      §4 sandbox + llama.cpp   §5 composer craft   §7 larger bets
```
