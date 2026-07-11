# DERO Hive — New Feature Ideas

> A curated list of features that would add meaningful value to the app. Prioritised roughly by impact × feasibility.

**Progress (2026-07-10):** 29 of 35 shipped (✅), 3 partial (🟡), 3 open.
Shipped: #1–#5, #7–#12, #16, #18–#23, #25–#35 · Partial: #6, #13, #24 · Open: #14, #15, #17

---

## 🟡 P2 — Good Additions

### 6. Image Generation & Artifact Gallery
**Status:** 🟡 **Partial.** `VisionTab` is a full-page gallery of saved artifacts with type filters, search, and a viewer modal; added a "Current chat" scope filter so the gallery can be scoped to the active conversation. Image generation via provider (DALL-E / SD) still open.  
**What:** Add a gallery view (grid/carousel) of all rendered artifacts for a conversation or project. Support image generation via provider (DALL-E, Stable Diffusion via Ollama). Let the AI generate images and show them inline.  
**Why:** Visual output is highly engaging; gallery lets users browse past artifacts.

### 10. Model Fallback / Chain-of-Providers
**Status:** ✅ **Done.** Settings expose an ordered provider/model fallback chain. Chat retries the next configured target only when the current provider fails before emitting content, reasoning, tool calls, usage, or permission effects; once observable work begins, Hive fails closed instead of risking duplicate side effects.  
~~**What:** Configure a "fallback chain": if Provider A returns an error or rate-limit, automatically retry with Provider B (e.g., Claude → Ollama). Optionally let the AI pick the cheapest model for simple tasks.~~  
~~**Why:** Robustness against outages; cost optimisation.~~

---

## 🔵 P3 — Nice to Have

### 13. Inline Code Execution (Pyodide / Web Containers)
**Status:** 🟡 **Partial.** JavaScript runs in a sandboxed Web Worker (`src/renderer/src/workers/jsRunner.ts`) fully offline with network APIs disabled; output and console calls are capped to guard against runaway scripts. Python runs via Pyodide loaded from CDN (cached after first run). `CodeRunner` appears below runnable `js`/`python` blocks (`Message.tsx`). Offline Pyodide bundling and persistent output still open.  
**What:** Run JavaScript/Python code **inside the renderer** via Pyodide (WebAssembly Python) or a sandboxed Web Worker for JS. Show output inline below the code block. **No network calls** needed for simple scripts.  
**Why:** Instant feedback for code snippets; privacy (code never leaves the machine).

### 14. Local RAG — Embeddings & Semantic Search over Project Files
**Status:** Full-text search exists (FTS5).  
**What:** Generate embeddings for project files (using a local model via Ollama or a small ONNX model) at configurable intervals. When the user asks a question, retrieve relevant code snippets as additional context. Store embeddings in SQLite with `sqlite-vec` or a simple JSON index.  
**Why:** The killer feature for working with large codebases — "answer questions about my code".

### 15. Collaborative Chat (Share Conversation via URL)
**Status:** Entirely local.  
**What:** Export a conversation to a lightweight HTTP server or a pastebin-like service. Generate a shareable link that re-imports the conversation (read-only or forkable).  
**Why:** Team collaboration; getting help from others.

### 17. Plugin / Extension System
**Status:** MCP servers provide external tools; built-in tools are hardcoded.  
**What:** Define a plugin API: a folder of `.js` files in `~/.hive/plugins/` that can register new tools/interceptors. Hot-reload on change.  
**Why:** Community contributions without modifying core; like Obsidian's plugin ecosystem.

### 21. "Focus Mode" Improvements
**Status:** ✅ **Done.** F11 toggles OS full-screen (`window:toggleFullscreen` IPC); the titlebar auto-hides on enter/leave-full-screen events (`TitleBar.tsx`); older messages are dimmed in zen mode (`globals.css`); the composer shows a live word count, a pomodoro countdown timer, and a word-count goal while focus mode is active (`InputBar.tsx`, `GeneralPanel.tsx`).  
~~**What:** Add a full-screen mode (F11 or Cmd+Shift+F). Auto-hide the titlebar. Add a countdown timer or word-count goal. "Zen mode" that fades everything except the last few messages.~~  
~~**Why:** Deep work; distraction-free writing.~~

### 24. Offline Mode Indicator
**Status:** 🟡 **Mostly done.** Green/red/yellow dot in the titlebar (`online`/`offline` events + `lastStreamErrorAt`/`lastStreamSuccessAt`); sending to a remote provider while offline shows a clear error (localhost providers like Ollama are exempt). Streaming failures from remote providers are auto-retried up to 2× before surfacing the error (`streamWithRetry` in `chat.ts`). Offline queueing still open.  
**What:** Show a coloured dot in the titlebar: green (connected to provider), yellow (intermittent), red (offline). Pause streaming gracefully if the connection drops; auto-retry. Queue messages sent while offline and send when reconnected.  
**Why:** Users with spotty connections need clear feedback.

### 26. In-Flight Message Queueing
**Status:** ✅ **Done.** Type and send while the model is streaming; the message is queued in the renderer (`pendingUserMessages`) and via main-process IPC (`chat:queue-message`), then persisted and inserted into the context at the next tool-call boundary (`chat.ts`). The composer shows a "N queued" badge.  
**What:** Let the user type a follow-up message while the assistant is working; hold it and send it at the next natural break (tool-call boundary) so the assistant can respond without starting a new turn.  
**Why:** Matches the fluid interaction model of Claude/Codex — users can correct or add context mid-turn.

### 27. Side-by-Side Model Comparison
**Status:** ✅ **Done.** "Compare" button in the composer toolbar opens a split-pane modal. Two independent conversations are created; the same prompt is sent to each selected model; `chat:stream` events are routed by `conversationId` and rendered live in two panes. Includes stop buttons and reasoning output.  
**What:** Send the same prompt to two different providers/models at once and view their outputs side-by-side in real time.  
**Why:** Useful for evaluating model behaviour, cost/quality trade-offs, and prompt consistency.

### 28. Edit User Message & Regenerate
**Status:** ✅ **Done.** User messages show an "Edit" action on hover; editing opens an inline textarea; saving updates the message in the DB and regenerates the assistant response from that point. Uses `MSG_UPDATE` IPC and `skipUserPersist` to avoid duplicating the user message.  
**What:** Fix typos or refine a user prompt mid-conversation and replay the turn.  
**Why:** Common pattern in Claude/Cursor — lets users iterate on prompts without losing context.

### 29. Regenerate with Model Picker
**Status:** ✅ **Done.** Assistant messages show a "Regenerate" action; clicking it opens a compact model picker; the conversation is reverted to the preceding user message and a new response is streamed from the selected model.  
**What:** Retry any assistant response with a different model to compare quality or cost.  
**Why:** Makes it easy to swap models for a specific turn without changing the conversation default.

### 30. Model-Based Auto-Titling
**Status:** ✅ **Done.** After the first successful assistant response, if the conversation title is still default the backend sends the first turn to the same model with a summarization prompt and updates the title. A `conv:title-generated` event refreshes the conversation list.  
**What:** Generate concise, human-readable titles instead of using the first 60 characters of the first message.  
**Why:** Better scanability in the sidebar; especially useful for long or markdown-heavy first messages.

### 31. Command Palette
**Status:** ✅ **Done.** `Ctrl+K` opens a searchable palette with recent conversations, skills, and actions; navigate with arrow keys and Enter.  
**What:** Universal keyboard-driven command palette for switching chats, toggling settings, and launching actions.  
**Why:** Power-user productivity; reduces reliance on the mouse.

### 32. Custom Slash Commands
**Status:** ✅ **Done.** `.hive/commands/*.js` files are loaded on app startup, validated, and surfaced in the composer autocomplete; sending a slash command executes the script's exported handler and sends the returned content to the model.  
**What:** User-defined slash commands that expand into prompts or tool calls.  
**Why:** Reusable shortcuts and workflows tailored to a project.

### 33. Usage Budget Alerts
**Status:** ✅ **Done.** Settings include daily/monthly token budgets; a warning banner appears in the composer when the current period's usage exceeds the configured threshold.  
**What:** Set a daily or monthly token/cost budget and warn the user before they exceed it.  
**Why:** Prevents runaway spending, especially with paid API keys.

### 34. Message Scheduling
**Status:** ✅ **Done.** A "Schedule" button in the composer lets the user pick a delay (5 min, 30 min, 1 hr, custom); a scheduled message banner shows countdown and a cancel action.  
**What:** Delay sending a message until a chosen time.  
**Why:** Useful for pacing interactions, reminders, or automated prompts.

### 35. Export PDF
**Status:** ✅ **Done.** Conversations can be exported to a print-friendly HTML page via a hidden iframe + `window.print()`, which lets the user "Save as PDF".  
**What:** Export a conversation to PDF for sharing or archiving.  
**Why:** Easy sharing with non-technical stakeholders.

---

## 📋 Implementation Notes

### Foundation for bigger features (still open)
- **Local RAG (#14)** needs an embedding pipeline + a vector store
- **Plugin system (#17)** needs a loader, sandbox, and lifecycle hooks
- **Collaborative chat (#15)** needs a lightweight server or P2P transport
- **Model fallback (#10)** is shipped with pre-side-effect failover; future routing can add explicit cost policies without letting the model choose providers implicitly
- **Pyodide execution (#13)** is wired for JS with output limits; Python still needs offline bundling
- **Image generation (#6)** needs provider image-generation endpoints wired in
- **Offline mode (#24)** is mostly shipped; message queueing for offline periods could still be added
- **Model comparison (#27)** is shipped; future improvements could include token/cost counters, voting, and saved comparison history
- **Edit/regenerate (#28, #29)** are shipped; could be extended with diff view, branch/fork on edit, and per-message history
- **Auto-titling (#30)** is shipped; could add a setting to disable model-based title generation to save tokens
- **Command palette (#31)**, **custom slash commands (#32)**, **usage budget alerts (#33)**, **message scheduling (#34)**, and **export PDF (#35)** shipped as quick wins; could be extended with aliases, command history, scheduled message persistence, and PDF styling templates

### Depends on external services
- **Image generation (#6)** depends on provider API support (already in presets); the artifact-gallery half is buildable today

---

*Generated by exploring the codebase on 2026-07-09. Statuses last updated 2026-07-10 after the quick-win implementation wave.*
