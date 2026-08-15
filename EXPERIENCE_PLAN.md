# DERO Hive — Experience Plan (UX · UI · Tools · Design)

Date: 2026-08-15 · Basis: source audit of `src/renderer`, `src/main`, `src/shared`, `tailwind.config.js` on branch `fix/redact-test-gcp-fixture-scanner`.

Companion to [GAP_ANALYSIS.md](GAP_ANALYSIS.md), which is architecture-first. This plan is experience-first: what the person using Hive sees, touches, and trusts. Where the two overlap, this doc says which item unblocks which.

---

## 0. Where things actually stand

Re-verified against the code, not the July audit's assumptions.

**Landed since the audit** (Phase 0 + much of Phase 1 in GAP_ANALYSIS): typed errors (`src/shared/errors.ts` + `errors.test.ts`), checkpoints (`src/main/checkpoints/`), log redaction (`src/main/utils/redact.ts`), path policy + secrets guard (`pathPolicy.ts`, `secrets.ts`), tool-registry trust (`registry.trust.test.ts`), desktop plan mode (`chat.planmode.test.ts`), live usage accumulation (`usageAccumulator.ts`, `TokenUsage.tsx`), retry/fallback surfaced in `ChatView.tsx:56-70`.

**Still open and confirmed by grep:**

| Claim | Evidence |
|---|---|
| No web fetch / web search tool | 21 builtins in `src/main/tools/builtin.ts`, none network-facing |
| No structured git tools | git only reachable through `run_shell` |
| Renderer is single-session | `stores/app.ts:539-566` — one `streamingContent` / `streamingReasoning` pair for the whole app |
| No paste-to-attach | zero `onPaste` handlers in `src/renderer` |
| No CI | no `.github/` directory; 45 test scripts exist and are scriptable |
| Status colours aren't themed | `tailwind.config.js:31-34` hardcodes `success/warn/danger/info` as hex while every other colour is a CSS var; no `--success` in `globals.css` |
| Model catalog is behind | `src/shared/modelMetadata.ts:55-71` has `claude-opus-4.8/4.7/4.6`, `claude-sonnet-5`, `claude-fable-5` — **no `claude-opus-5`**; presets default to `claude-sonnet-4-5` (`presets.ts:13,80,126`) |
| Newer models have no prices | only `opus-4.5/4.1`, `sonnet-4.5/4`, `haiku-4.5` and the 3.x row carry `inputPrice`/`outputPrice` — every 4.6+ model renders "—" in the cost dashboard |
| Accessibility is thin | 2 `role="dialog"` across ~12 modals; most components have 0–2 `aria-label`s; no focus trap |
| No general notification system | `CompactionToast.tsx` is a one-off; nothing tells you a background run finished |

---

## 1. The ten experience problems

Ranked by how often they bite, not by effort.

1. **The app has four side panels and no layout.** `App.tsx:124-132` renders Sidebar, Vision, Companion and RightSidebar as four independent booleans; all four can be open at once and the chat column gets crushed. Nothing persists across restart.
2. **Code / Vision / Cockpit / Chat are mutually exclusive.** `App.tsx:127` is a ternary chain — opening the Code tab *replaces* your chat. You cannot look at a file and the conversation that produced it at the same time.
3. **One conversation at a time, really.** The main process already runs N concurrent streams; the renderer holds one streaming buffer, so switching away from a running chat loses its live output. This is the single biggest ceiling on the product.
4. **The composer is a tool bar of ten unlabelled icons.** Model, agent, thinking effort, plan mode, approval mode, compare, swarm, schedule, attach, focus — all peer icon buttons with `title=` tooltips only (`ComposerToolbar.tsx`). Nothing shows the *resulting* run configuration as one readable line.
5. **You can't paste an image.** In 2026, in an app with full vision support.
6. **Nothing tells you what happened while you were away.** No toast/inbox for finished runs, failed tools, scheduled tasks, MCP disconnects.
7. **The agent can't reach the web or speak git.** Two of the three things a coding agent does all day.
8. **Cost is honest for old models and blank for new ones.** The pipeline works; the table is stale.
9. **Themes break at the edges.** Pick Solarized or Gruvbox and every success/warning/error colour stays the default palette's hex.
10. **Keyboard coverage stops at ten shortcuts.** No `Ctrl+1..9` session switching, no palette-driven model / agent / theme switching (the CLI already has this).

---

## 2. Phases

Each phase ships alone. Effort: **S** < 1 day · **M** 1–3 days · **L** multi-day.

### E0 — Currency & correctness ✅ **shipped 2026-08-15**

| # | Item | Files | Status |
|---|---|---|---|
| 0.1 | **Add Opus 5 to the catalog** — `claude-opus-5`, 1M context / 128K output / vision / tools / reasoning | `src/shared/modelMetadata.ts` | ✅ |
| 0.2 | **Make Opus 5 the Anthropic default** | `src/shared/presets.ts` | ✅ (see note) |
| 0.3 | **Backfill prices for every 4.6+ model** so the cost dashboard stops rendering "—" | `src/shared/modelMetadata.ts` | ✅ |
| 0.4 | **Tokenize status colours** + fix the accent-opacity bug below | `globals.css`, `theme.ts`, `tailwind.config.js` | ✅ |
| 0.5 | **Paste-to-attach** — images and files from the clipboard, oversized text pastes as an attachment | `InputBar.tsx` | ✅ |
| 0.6 | **CI** — typecheck ×3, lint ×2, all four test suites on push and PR | `.github/workflows/ci.yml` | ✅ |

**Notes from implementation:**

- **0.2 scope trimmed deliberately.** Only the native `anthropic` preset was repointed, because its model IDs are authoritative. The `opencode-zen` and `openrouter` defaults still name `claude-sonnet-4-5` / `anthropic/claude-sonnet-4.5` — these are third-party gateway IDs that could not be verified, and a wrong ID breaks the first request, whereas a stale-but-valid one still works. Both are first-run fallbacks only; the live `/models` fetch replaces them on save.
- **0.4 was bigger than scoped — a real bug surfaced.** Tailwind v3 *silently drops* a utility when an opacity modifier is applied to a bare `var()` colour: with `accent: 'var(--accent)'` in the config, `bg-accent/10` and `border-accent/50` compiled to **nothing at all**. Roughly 70 call sites across the renderer were rendering no background or border. Verified by compiling the real config against a probe file. Fixed by moving `accent` / `accent-hover` / all four status colours to `rgb(var(--x) / <alpha-value>)` channel-triplet form, with `syncColorChannels()` in `theme.ts` re-deriving the triplets at runtime so theme presets, user-picked accents and custom CSS all keep working. `accent-soft` / `accent-glow` stay bare `var()` — they are already alpha washes, so the six `bg-accent-soft/NN` sites were changed to plain `bg-accent-soft`.
- **Verification:** `npm run typecheck` (node + web + cli), `npm run lint`, `npm run lint:cli`, and `test:shared` / `test:renderer` / `test:vision` / `test:cli` all pass. New assertions cover the Opus 5 metadata row, the "every current Claude has a price" invariant, and `cssColorToChannels`. The CI workflow's `npm ci --ignore-scripts` + `npm rebuild better-sqlite3` install path is reasoned but unproven until the first run on GitHub — it skips the whisper/simulator/MCP asset downloads that the repo's `postinstall` would otherwise fetch.

---

### E1 — The workspace shell (the big UI unlock, ~1 week)

Replace the boolean soup with a real layout model.

- **1.1 Tabbed main area (M).** Chat / Code / Vision / Cockpit become tabs in one strip, not an either-or ternary. Multiple chat tabs allowed. Middle-click closes, `Ctrl+1..9` selects, `Ctrl+Shift+T` reopens.
- **1.2 Split view (M).** One vertical split in the main area — chat left, code or vision right. Drag to resize, double-click the divider to reset.
- **1.3 Right dock consolidation (M).** Vision, Companion and RightSidebar stop being three competing panels and become one dock with its own tab strip (Activity / Files / Git / Context / Usage / Audit / Graph / Vision / Companion). One width, one toggle, `Ctrl+Shift+R` cycles.
- **1.4 Persisted layout + presets (S).** Panel widths, open tabs, dock selection saved to settings. Ship three presets — *Chat*, *Build* (chat + code + git), *Review* (chat + diff + audit) — switchable from the palette. Note the [settings storage gotcha](GAP_ANALYSIS.md): everything must go in the single `appSettings` blob, not a new top-level key.
- **1.5 Command palette parity (S).** Add model, agent, theme, layout-preset and provider switching to `CommandPalette.tsx` to match the CLI's `Ctrl+P`.

**Done when:** you can have a chat streaming on the left, its diff on the right, close the app, reopen it, and be exactly where you were.

---

### E2 — Multi-session (the biggest functional unlock, ~1 week)

Depends on E1.1. This is GAP_ANALYSIS Phase 3's "multi-session renderer", pulled forward because everything conversational depends on it.

- **2.1 Per-conversation stream state (L).** `stores/app.ts` moves from one `streamingContent`/`streamingReasoning`/`isStreaming` triple to a `Map<conversationId, StreamState>`. `useChat.ts` routes events by conversation id instead of assuming the visible one.
- **2.2 Background progress (S).** Sidebar rows for running conversations show a live spinner, token count and elapsed time. Tab strip shows a dot.
- **2.3 Permission-prompt attribution (S).** `PermissionDialog` names which conversation is asking, and queues rather than races when two ask at once.
- **2.4 Notification centre (M).** One toast + history surface for: run finished, run failed, tool denied, scheduled task fired, MCP server dropped, budget threshold crossed. Click-through jumps to the conversation. Optional OS notification when the window is unfocused. Generalizes `CompactionToast.tsx`.

**Done when:** you can start three agents on three projects, walk away, and come back to three notifications and three complete transcripts.

---

### E3 — Tools the agent is missing (~1 week)

- **3.1 `web_fetch` (S).** URL → readable text/markdown, size-capped, redirect-limited, always approval-gated. Respects the existing trust levels.
- **3.2 `web_search` (M).** Provider-pluggable — Brave / Tavily key, or a local SearXNG endpoint. Free default stays free: no key configured means the tool is simply absent, never a paywall prompt.
- **3.3 Structured git tools (M).** `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit` as first-class tools with parsed output; `git_push` always confirms regardless of approval mode. Stops laundering git through opaque `run_shell` strings and makes the Git dock panel and the agent read the same data.
- **3.4 Multi-hunk `edit_file` (M).** Today it's one exact-match replacement per call. Accept an array of hunks, apply atomically, fail the whole call on any mismatch.
- **3.5 Tool-call re-run and edit-args-retry (M).** In-transcript: re-run a tool call, or edit its arguments and retry. Fix the historical-result rendering path at the same time (`ToolCallCard.tsx`).
- **3.6 MCP namespacing (M).** Advertise MCP tools as `server:tool`. Collisions are first-match-wins today and builtins silently shadow MCP tools. Migrate saved permission rules on upgrade — this is breaking for existing rules and needs a migration, per the [DB migration pattern](GAP_ANALYSIS.md).
- **3.7 MCP resources & prompts consumption (M).** Discovery already works; wire `readResource`/`getPrompt` into the composer's `@` autocomplete and the context panel.

---

### E4 — Composer and conversation craft (~4 days)

- **4.1 Run-configuration chip (M).** One readable line above the send button — *"Opus 5 · Plan mode · Ask on write · 3 skills · 12 tools"* — that expands into the full control surface. The ten icon buttons collapse into a "…" overflow.
- **4.2 Real labels (S).** Every composer and title-bar control gets an `aria-label` and a shortcut hint in its tooltip.
- **4.3 Message actions (S).** Hover row on every message: copy, quote-reply, fork from here, edit-and-resend, collapse. Fork exists in the data model (`parent_id`) but isn't reachable per message from the transcript.
- **4.4 Fork tree navigation (M).** Show siblings and the fork point; click through to the parent conversation.
- **4.5 Diff-first permission dialog (S).** For write/edit calls, render the actual diff instead of raw JSON args. Snapshot metadata is already available at decision time via checkpoints.
- **4.6 Per-hunk accept / reject (M).** Activity panel goes from view-only to actionable, backed by checkpoints.

---

### E5 — Design system and polish (~4 days, can run in parallel)

- **5.1 Token pass (S).** Finish what 0.4 starts: elevation, radius and spacing scales as tokens; audit for stray hex in components.
- **5.2 Density modes (S).** Comfortable / compact, wired to the existing `--spacing-density` variable, exposed in Appearance settings.
- **5.3 Accessibility pass (M).** `role="dialog"` + `aria-modal` + focus trap + restore-focus on all ~12 modals; visible focus rings everywhere (`:focus-visible` exists but isn't applied consistently); keyboard reachability for every icon-only control. `prefers-reduced-motion` is already handled — keep it that way for new animation.
- **5.4 Empty and error states (S).** Every panel gets a real empty state with the one action that fills it. `EmptyState.tsx` is the quality bar; most panels are below it.
- **5.5 Onboarding (M).** First-run flow: pick a provider (free MiMo/DeepSeek pair pre-selected), pick a project folder, pick a theme, three-step tour of composer / dock / palette. Skippable, re-runnable from the palette.
- **5.6 Neon preset (S).** ~15 lines across `theme.ts` and `GeneralPanel.tsx`.

---

## 3. Sequencing

```
E0 ──────────────────────────────► (independent, do now)
      │
E1 ───┴──► E2 ──► E4.3/4.4 (fork UI wants tabs + sessions)
      │
      └──► E4.1 (run chip wants the new shell)

E3 ──────────────────────────────► (independent of E1/E2, parallelizable)
E5 ──────────────────────────────► (parallelizable; 5.1 depends on E0.4)
```

Two people: one takes E1→E2, the other takes E3, both dip into E5. Solo: E0, E3, E1, E2, E4, E5 — E3 gives the most day-one value per hour once E0 is done.

## 4. Non-goals

- No second config format. Everything extends `src/shared/types.ts` and lives in the `appSettings` blob.
- The free MiMo/DeepSeek default pair stays fully functional. Nothing in this plan makes a paid provider a prerequisite for a baseline feature — `web_search` degrades to absent, not to a nag.
- No plugin runtime. MCP remains the extension mechanism (ADL-6).
- No new orchestration engine here; that's GAP_ANALYSIS Phase 3. E2 is deliberately scoped to the renderer's session model.
