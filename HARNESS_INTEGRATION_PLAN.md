# Borrowing from DeepSeek Harness and Unsloth Studio

Date: 2026-08-15 · Companion to [EXPERIENCE_PLAN.md](EXPERIENCE_PLAN.md) and [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

Sources read locally:

- **DeepSeek Harness (`dsh`)** — `C:\Users\joshu\Desktop\Deepseek harness\deepseek-harness`, MIT, DeepSeek AI. A TypeScript monorepo of ~45 packages where *everything is a plugin* (built on [Cordis](https://github.com/cordiverse/cordis)). Ships a Web UI, a CLI, and a headless runner. This is a direct peer to Hive and the richer of the two sources.
- **Unsloth Studio / Desktop** — installed runtime at `C:\Users\joshu\.unsloth` (Tauri app, bundled Node 24 + llama.cpp + whisper.cpp + per-torch-version Python venvs). A local fine-tuning and inference studio, *not* an agent harness — the overlap with Hive is packaging and local-model serving, not agent behaviour.

**What I actually read:** all of `dsh`'s architecture, tool-catalog and ~8 subsystem docs, plus package READMEs for spill and sandbox. I did **not** read `dsh` implementation source beyond those, so the effort estimates below are sized from documented interfaces, not from having ported anything. Unsloth is a shipped binary — I inspected its on-disk layout and manifests and confirmed features against its public docs; there is no source to read.

---

## 1. Verdict table

Ranked by value per unit of work. "Fits" names the phase in [EXPERIENCE_PLAN.md](EXPERIENCE_PLAN.md) this slots into.

| # | Feature | From | Verdict | Effort | Fits |
|---|---|---|---|---|---|
| 1 | **`ask_user_question` tool** — agent asks the human a structured question (options, descriptions, multi-select) and blocks until answered | dsh | ✅ **shipped** | S | E4 |
| 2 | **Tool-output spill** — cap inline results, persist the full text, hand the model a locator + retrieval hint | dsh | ✅ **shipped** | S | E3 |
| 3 | **Packaged ripgrep** for `glob`/`grep` via `@vscode/ripgrep` | dsh | ✅ **shipped** | S | E3 |
| 4 | **Pinned-asset manifests** — version + sha256 + install fingerprint per bundled binary | Unsloth | ✅ **shipped** | S | E0 follow-up |
| 5 | **Background jobs** — `run_in_background` on shell + `job_list`/`job_output`/`job_kill` over one kind-agnostic registry | dsh | ✅ **shipped** | M | E2 |
| 6 | **Session event log as the source of truth** — append-only events, `deriveMessages()` projection, "model-visible means logged" invariant | dsh | **Adapt** | L | E2 (foundation) |
| 7 | **Windows ACL sandbox** for `run_shell`, with honest `full`/`partial` enforcement reporting | dsh | **Take** | M | Revises ADL-2 |
| 8 | **Subagent system** — `subagent`, `send_message`, `interrupt_agent`, `list_agents`, child-scoped `report` | dsh | **Adapt** | L | GAP Phase 3 |
| 9 | **Bundled llama.cpp** with GPU-backend auto-detection and prebuilt fallback | Unsloth | **Take** | M | GAP Phase 2 |
| 10 | **Generated tool catalog** — boot each tool plugin, read its real schema, fail CI if a tool is undocumented | dsh | ✅ **shipped** | S | E0 follow-up |
| 11 | **`lsp` tool** behind a provider seam | dsh | ✅ **shipped** | M | E3 |
| 12 | **Capability seams** (Definition / Provider / Consumer) for fs, shell, subprocess, web | dsh | **Adapt** | M | E3 |
| 13 | **Code mode (`run_code`)** — model writes one program that calls tools as bindings | dsh | **Later** | L | Post-E5 |
| 14 | **Runtime invariants registry** | dsh | **Later** | M | — |
| 15 | **Goal tool** (`create_goal`/`update_goal` with authority rounds) | dsh | **Skip for now** | M | — |
| 16 | Cordis plugin runtime; profiles/bundles/config patches | dsh | **Skip** | — | — |
| 17 | Fine-tuning, LoRA/QLoRA, dataset designer, training runs | Unsloth | **Skip** | — | — |

---

## 2. The five that change Hive most

### 2.1 `ask_user_question` — the agent can finally ask (S)

Today a Hive agent that hits ambiguity either guesses or stops. `dsh` models this as a **provider-neutral seam**: the tool declares a question with `id`, `question`, optional `header`, `options[]` (label + description) and `multi_select`; whichever UI is attached supplies the provider and answers. It also carries a **presentation intent** (e.g. `approve`) that changes *rendering only* — a UI that doesn't recognise the tag falls back to a generic option list and returns the same answer shape, so callers read identical fields either way.

That last detail is the part worth copying deliberately: it's what stops a richer UI from forking the answer contract.

Hive already has most of the machinery — `PermissionDialog` is a blocking, main-process-driven modal with an IPC round-trip. This is that pattern with a different payload.

- New builtin in `src/main/tools/builtin.ts`; execution parks on a promise keyed by call id.
- Renderer component modelled on `PermissionDialog.tsx`, with queueing (E2.3 already needs per-conversation attribution).
- Answer is a durable part of the transcript, not just a modal side effect.

### 2.2 Tool-output spill — stop tool results eating the context (S)

A `tools/post-execute` transformer: when a result exceeds `maxInlineBytes`, save the **full** text to a spill store and replace the model-facing result with a bounded head/tail preview plus a locator and a retrieval hint ("use `read`/`grep` on this path"). `dsh`'s local backend is worth copying almost verbatim for its security properties:

- Files at `<root>/session-<sha256 prefix>/<random>-<safeName>`.
- Private `0700` per-process temp root by default — a predictable world-readable root would let other local users read spilled output or plant symlinks.
- Exclusive owner-only create (`open(path, 'wx', 0o600)`), so a planted symlink can't redirect the write.
- Storage failure is best-effort: the policy keeps the inline result rather than losing it.

Hive's `grep_files`/`read_file`/`run_shell` can all return enormous payloads straight into context today. This is the cheapest large win on the list, and it composes with Hive's existing checkpoint blob store.

**Known limitation to inherit knowingly:** spill files persist until external cleanup, because resumed and forked sessions may still reference a path. Tie pruning to Hive's existing conversation-deletion prune.

### 2.3 Background jobs (M)

`dsh` has one **kind-agnostic** job registry: background bash runs, PTY sends and subagents are all collected, listed and killed through the same `job_list` / `job_output` / `job_kill` tools, and completion notices are injected back into the conversation. The `run_in_background` parameter is *removed from the schema entirely* when the capability is disabled, rather than being advertised and then refused.

Hive has no background execution at all — `run_shell` blocks the turn. This is the natural companion to E2 (multi-session), and the "one registry, many producers" shape is what stops three separate half-implementations later.

### 2.4 Session event log as the source of truth (L — the foundational one)

`dsh`'s core claim: the append-only session log **is** the context. `deriveMessages()` projects model history from it; raw `assistant/chunk` events preserve replay and UI fidelity; fork, resume, transcripts, telemetry and persistence are all derived. A runtime invariant enforces **"model-visible means logged"** — anything reaching a model request must be reconstructable from the log, so adding a new model-visible input *requires* a new event type.

This is the root fix for a bug the July audit already found in Hive: historical tool-call results never re-render after reload, because they live in an in-memory map fed only by live stream events. Hive's `messages` table stores the rendered conversation, not the event stream that produced it.

**Do not port Cordis to get this.** The valuable part is the data model plus the invariant, both of which fit Hive's existing SQLite + migration pattern:

1. Add a `session_events` table (append-only, ordered, typed).
2. Write events for everything model-visible: user message, assistant chunk, assistant message, tool call, tool result, injected context.
3. Derive the renderer transcript and the provider request from that table.
4. Keep `messages` as a projection during migration; delete it once derivation is trusted.

Schedule this **before** E2's per-conversation stream refactor if you want to do it at all — both touch the same code, and doing them in the wrong order means doing the store restructure twice.

### 2.5 Windows sandboxing is possible after all (M)

[GAP_ANALYSIS.md](GAP_ANALYSIS.md) ADL-2 concluded: *"Windows Job Objects restrict processes and resources but not filesystem paths or network... the realistic path is a container."* `dsh` ships `@deepseek-ai/dsh-sandbox-windows-acl`, a **restricted-token + ACL** runner that governs file effects with no container. It's real, and it's honest about its limits:

- Modes are `read-only` / `workspace-write` / `danger-full-access`; the last bypasses the sandbox entirely and never calls the provider.
- Enforcement is a **reported fact**, `full` or `partial` — Windows reports `partial` because the restricted token must retain `Everyone` for process initialisation, so external objects granting `Everyone` write remain writable, and NTFS hard links alias one file object across paths.
- A deterministic per-workspace write SID and standing ACE, plus a **random private temp dir with its own SID and revocable ACE per session/workspace pair** — so sessions sharing a workspace share its write authority without inheriting each other's temp authority.
- Crash residue can't authorise a resumed session: a fresh provider always picks a new temp path and SID.
- A workspace equal to or containing the platform temp root **fails before any ACL mutation**, because its inheritable ACE would otherwise reach every private temp child.
- Unusable runners **fail closed** with `SANDBOX_UNAVAILABLE`; execution never silently falls through unconfined.

That last principle is the one to adopt regardless of which backend Hive ships. ADL-2 should be revised from "container-only, Phase 5" to "ACL restricted-token on Windows, opt-in per project, with enforcement surfaced in the UI".

---

## 3. From Unsloth: packaging discipline and local inference

Unsloth is a fine-tuning studio, so most of it is out of scope. Two things are directly worth stealing.

### 3.1 Pinned-asset manifests (S — do this next)

Every bundled runtime ships a manifest recording exactly what was installed. Node:

```json
{ "schema_version": 1, "kind": "node", "version": "24.18.0",
  "asset": "node-v24.18.0-win-x64.zip", "sha256": "0ae68406…" }
```

llama.cpp records far more — resolved tag, published repo, asset name, **asset sha256**, source commit + source tarball sha256, the detected `backend` (`cuda`) vs `backend_request` (`auto`), a `bundle_profile` (`cuda13-newer`), an `install_fingerprint`, `prebuilt_fallback_used`, and `installed_at_utc`.

Hive's `scripts/setup-whisper.mjs`, `setup-mcp.mjs` and `setup-simulator.mjs` download assets with **no pinning, no checksum and no record of what landed**. Adopting the manifest pattern gives reproducible installs, a real integrity check, and a cheap "is this up to date / do I need to re-download" test. It also directly retires the awkwardness in the CI workflow from E0.6, where the only lever available was skipping install scripts wholesale — with manifests, CI can skip *downloads* while still validating what a dev machine has.

Add a `HIVE_SKIP_ASSETS=1` env guard at the same time.

### 3.2 Bundled llama.cpp with backend auto-detection (M)

Unsloth resolves a llama.cpp build for the detected accelerator (`backend: "cuda"` from `backend_request: "auto"`, profile `cuda13-newer`), with a published-prebuilt path and a source fallback, all recorded in the manifest. Hive's local-model story is currently "point at Ollama's OpenAI-compatible endpoint" — the GAP analysis lists llama.cpp/LM Studio presets and a VRAM fit check as open items.

Bundling a llama.cpp server would give Hive genuine offline capability (it already bundles whisper.cpp, so the machinery is half-built), plus direct GGUF loading from local files or Hugging Face. Pairs with the GAP item on VRAM fit checks and KV-cache quantisation surfacing.

**Scope guard:** serve models, don't train them. Fine-tuning, LoRA/QLoRA, dataset design and training-run management are Unsloth's product, not Hive's.

---

## 4. What I'd deliberately not take

- **Cordis, profiles, bundles and config patches.** `dsh` is a plugin runtime with no privileged core, and that buys real things — but it is *the* architectural decision of that codebase, not a feature you can lift. Hive already decided this (ADL-6: MCP-plus-thin-registry, not a sandboxed plugin runtime), and retrofitting Cordis would be a rewrite, not an integration. Take the *seam* discipline (item 12) instead: Definition / Provider / Consumer as a convention, so pointing fs + subprocess at a remote sandbox moves Bash, PTY and LSP with them.
- **Code mode (`run_code`).** Genuinely interesting — the model writes one program and calls tools through generated SDK bindings, with nested calls re-entering the full guarded tool pipeline under a concurrency contract. It collapses N round-trips into one. But it needs a worker-thread runtime, generated per-language SDK sections in the system prompt, and nested-call linkage back to the outer tool result. Revisit after E5.
- **Goal tool with authority rounds.** `dsh` gates goal mutations on "direct-human root authority" and admitted-round counts. Hive has no authority model to hang this on; it would be ceremony without the substrate.
- **i18n throughout.** `dsh` ships `.i18n.yaml` + `.zh.md` for every doc. Admirable, not a Hive problem today.

---

## 5. Licensing

`dsh` is **MIT** (Copyright (c) 2026 DeepSeek) — copying code, not just ideas, is permitted with the copyright notice and permission notice retained. If any file is ported closely rather than reimplemented, add it to Hive's third-party notices and keep the header. `dsh` itself models this with a `THIRD_PARTY_NOTICES.md`, which Hive currently lacks and should add as part of this work.

**Unsloth's licensing needs checking before any code is copied** — I confirmed the install layout and feature set, not the licence terms of the Studio/Desktop app (the `unsloth` training library and the app are not necessarily under the same terms). The manifest *pattern* in §3.1 is a design idea and carries no licensing question; bundling their llama.cpp builds from `unslothai/llama.cpp` does, and llama.cpp's own MIT licence plus its third-party notices apply on top.

---

## 5a. Shipped 2026-08-15 — items 1–4

| Item | Landed as | Notes |
|---|---|---|
| Spill | `src/main/tools/spill.ts`, applied in `registry.ts` on every builtin and MCP result | 16 KB inline cap, head/tail preview, full text under `paths.spill/session-<hash>/`. Copied dsh's security properties: private 0700 root, unguessable filename prefix, exclusive `wx` create so a planted symlink cannot redirect the write. A failed save keeps the inline result. |
| `ask_user_question` | `src/main/tools/userQuestions.ts` + `AskUserDialog.tsx` | Parks the tool call over IPC, modelled on the existing permission round-trip. Options *and* free text are both accepted, and the answer shape is identical either way. |
| Packaged ripgrep | `src/main/tools/ripgrep.ts`, consumed by `glob_files` / `grep_files` | `@vscode/ripgrep` turned out to have **no postinstall** — binaries arrive as platform-specific optional deps, so `npm ci --ignore-scripts` still gets a working one. The JS path is kept as a fallback for platforms with no build. |
| Asset manifests | `scripts/lib/assets.mjs` + `setup-whisper.mjs`; `HIVE_SKIP_ASSETS` in all three setup scripts | Manifest records kind, version, asset, url, sha256, bytes, platform, install time. Pins are separate from observed hashes (`pinned_sha256` vs `sha256`) so trust-on-first-use is never mistaken for an assertion. |

Three things worth recording because they changed the design:

- **ripgrep blocks forever if stdin is an open pipe.** It searches stdin whenever stdin is not a TTY, so `spawn` without `stdio: ['ignore', …]` hangs instead of walking the directory. Caught by the first test run.
- **grep now skips gitignored files.** That is ripgrep's default and is right for a coding agent, but it *is* a behaviour change — the tool description says so explicitly.
- **A bad regex now surfaces as an error** instead of silently falling through to the JS engine, which has different syntax. Retrying under different semantics would have hidden the model's mistake.

Deliberately deferred within these items: pruning spill files when a conversation is deleted (they persist, exactly as dsh's do, because forked and resumed conversations may still reference a path), and pinning the whisper model's sha256 (upstream publishes no checksum, so there is nothing to assert).

## 5b. Shipped 2026-08-15 — items 5 and 10, plus three tool gaps

| Item | Landed as | Notes |
|---|---|---|
| Background jobs (5) | `src/main/tools/jobs.ts`, `run_in_background` on `run_shell`, `job_list`/`job_output`/`job_kill` | One kind-agnostic registry: a producer hands over a label and a way to stop itself, then pushes output. Adding PTY sends or subagents later means calling `register`/`append`/`finish`, not writing a second set of tools. |
| Generated tool catalog (10) | `src/main/tools/catalog.ts` + `catalog.test.ts`, output at `docs/TOOL_CATALOG.md`, regenerated with `npm run docs:tools` | Generated by **booting** `listBuiltinTools()`, so capability-dependent schema is captured. The test fails CI when the doc drifts, when a tool has no real description, or when a non-obvious parameter is undocumented. |
| Multi-hunk `edit_file` (§3.4) | `src/main/tools/edits.ts` | Ordered hunks applied to the evolving text, atomically: a miss anywhere discards the whole call and names the hunk. `replace_all` covers the deliberate many-match case. |
| Structured git tools (§3.3) | `src/main/tools/git.ts` — `git_status`/`git_diff`/`git_log`/`git_branch`/`git_commit`/`git_push` | argv, never a shell string. Porcelain is parsed from `-z` output so paths with spaces survive. `git_push` is the first member of a new **always-confirm** set: it asks even under a saved allow rule and even in "never ask" mode. |
| `web_fetch` (§3.1) | `src/main/tools/webFetch.ts` | Every redirect hop is re-validated, not just the first — a public hostname redirecting to `169.254.169.254` is the whole attack. Body capped while streaming at 2 MB, non-text content types refused by name. |

Four things worth recording because they changed the design:

- **Capability-shaped schemas beat capability errors.** With background jobs off, `run_in_background` is absent from the schema and the three job tools are absent from the list. dsh is right that advertising-then-refusing costs the model a turn to discover.
- **"Never ask" is a statement about local work.** It should not extend to pushing to a remote, so `ALWAYS_CONFIRM` sits in front of the approval mode rather than inside it.
- **A finished background job has to reach the model somehow.** Without the event log (§0) there is no channel, so completion notices are drained onto the next tool result. It is a stopgap, and the right home for it is the event log.
- **Decoding HTML entities too early deletes content.** `&lt;x&gt;` inside a `<pre>` becomes `<x>` and the next tag-strip removes it. Entities stay encoded until after the last strip.

Deliberately not done in this batch: killing background jobs when a *conversation* is deleted (they die with the app, and a job outliving its turn is the point), and any renderer surface for jobs — the notification centre (§2.4) is where that belongs.

## 5c. Shipped 2026-08-15 — a second pass on Hive's own gaps

Not from dsh or Unsloth, but they fell out of the same work.

| Item | Landed as | Notes |
|---|---|---|
| `web_search` (§3.2) | `src/main/tools/webSearch.ts` | Brave, Tavily and SearXNG behind one seam. Unconfigured means the tool is **absent from the list**, following dsh's capability rule — a model shown a tool whose only answer is "ask your user for an API key" has already wasted a turn. SearXNG's endpoint is deliberately exempt from the `web_fetch` loopback guard: it is user configuration, not a URL the model chose. |
| MCP namespacing (§3.6) | `src/main/mcp/namespace.ts` | `mcp__server__tool`. The backlog said `server:tool`; that is wrong — the provider tool-name schema is `^[a-zA-Z0-9_-]{1,64}$`, so a colon invalidates the entire request. Truncation eats the *server* half first and collisions get a numeric suffix, because dropping a tool is the bug being fixed. No permission migration: a rule saved against the raw name matches through an alias. |
| Spill pruning (§1.1) | `pruneSpill()` in `src/main/tools/spill.ts` | Hangs off conversation deletion, beside the checkpoint prune. |
| `THIRD_PARTY_NOTICES.md` (§1.3) | repo root | Every file adapted from dsh, plus the Unsloth manifest pattern recorded as a design idea with no code taken. |

## 5d. Shipped 2026-08-15 — item 11, and two dialog fixes

| Item | Landed as | Notes |
|---|---|---|
| `lsp` behind a provider seam (11) | `src/main/lsp/{codec,session,manager}.ts` + `src/main/tools/lsp.ts` | definition / references / hover / diagnostics / symbols. **The schema never changes with availability** — the opposite choice to `web_search`, and deliberate: search is on or off for the whole app, while language support is per file type, so a schema that appeared and disappeared per file would be unusable. Unserved files get `LSP_UNAVAILABLE` plus the fallback to use. |
| Permission attribution (§2.3) | `PermissionDialog.tsx` | Names the asking conversation, shows queue depth, Escape denies, `role="dialog"` + `aria-modal` + focus on Deny. |
| Diff-first approval (§5.5) | `PermissionDialog.tsx` | The thing being approved is the change, not the JSON. |

Worth recording:

- **LSP framing is where a naive client breaks.** `Content-Length` counts *bytes*; a chunk boundary can split a multi-byte character, so the framer buffers `Buffer`s and only decodes complete messages. There is a test that feeds a message one byte at a time, and another that splits mid-character.
- **The fake language server in the test had to serialize its writes.** Interleaving two deliberately-split replies corrupts the stream on the *server* side, which proves nothing about the client — the first version of the test failed intermittently for exactly that reason.
- **Escape must deny.** Dismissing a permission prompt can never be the permissive outcome.

## 6. Suggested order

Nothing here should displace E1/E2 — the shell and multi-session work is still what makes Hive usable day to day. This slots in around it:

```
now        4. asset manifests (S)   ← closes the E0.6 CI compromise
           2. tool-output spill (S)
           3. packaged ripgrep (S)  ← folds into E3.3
           1. ask_user_question (S) ← folds into E4

before E2  6. session event log (L) ← MUST precede the E2 store refactor
                                       or the restructure happens twice

with E2    5. background jobs (M)
after E2   8. subagents (M/L)  10. tool catalog (S)  11. lsp (M)
           7. Windows ACL sandbox (M)  9. bundled llama.cpp (M)
```

The one sequencing decision that actually costs you if you get it wrong is **item 6 versus E2.1**. Both rewrite how conversation state is stored and streamed. Decide whether the event log is in scope before starting the multi-session store work.
