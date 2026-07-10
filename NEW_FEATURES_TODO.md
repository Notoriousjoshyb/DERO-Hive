# DERO Hive — New Feature Ideas

> A curated list of features that would add meaningful value to the app. Prioritised roughly by impact × feasibility.

**Progress (2026-07-10):** 15 of 25 shipped (✅), 3 partial (🟡), 7 open.
Shipped: #1–#5, #7–#9, #11, #12, #16, #18, #20, #23, #25 · Partial: #21, #22, #24 · Open: #6, #10, #13–#15, #17, #19

---

## 🟢 P1 — High Impact, Moderate Effort

### 1. Agentic Chat — Slash-command Agent Switching
**Status:** ✅ **Done.** Built-in agents (Default/Explore/Review) with real persona prompts in `shared/agents.ts`; custom agents managed via "Manage agents…" (`AgentsModal.tsx`), persisted in `AppSettings.customAgents`; the active agent's prompt is layered onto the base system prompt in `chat.ts` (`req.agentPrompt`).  
**What:** Let users define custom "agents" (system prompt presets) and switch between them via a dropdown in the composer toolbar. Save/load agent definitions from a local JSON file.  
**Why:** Power users want different personas (coder, architect, debugger, writer) without re-typing system prompts.

### 2. Conversation Branching / Forking UI
**Status:** ✅ **Done.** Fork/Revert buttons appear on hover on every user and assistant message (`MessageActions` in `Message.tsx`), backed by `forkConversation` / `revertConversation` in the store. Forked chats show a lineage glyph in the sidebar with a "Forked from …" tooltip.  
**What:** Add "Fork from here" button on each assistant message (visible on hover) and "Fork chat" in the conversation context menu. Show fork lineage (parent → child indicator).  
**Why:** One of the most-requested features in AI chat apps for exploring alternative solution paths.

### 3. Message Search & Full-Text Search UI
**Status:** ✅ **Done.** `SearchDialog.tsx` (Ctrl+Shift+F): FTS5-backed results grouped by conversation with highlighted snippets, ↑↓/Enter keyboard nav; clicking a result opens the conversation, scrolls to the matched message, and flashes it (`search-flash`). Project filter still open.  
**What:** Build a full search dialog (Cmd+Shift+F) with result snippets, conversation context, chronological sort, and filter by project. Highlight matches in the conversation view.  
**Why:** Conversations grow deep; finding a past insight becomes painful.

### 4. Context-Aware Auto-Complete / Prompt Suggestions
**Status:** ✅ **Done.** Fuzzy subsequence matching + ranking for `/` skills and `@` files (`fuzzyScore` in `ComposerAutocomplete.tsx`), matched-character highlighting, and full keyboard navigation (↑↓, Tab/Enter to select, Esc to dismiss) wired through InputBar's key handler. Project symbols still open.  
**What:** When the user starts typing `@`, show a menu of: open files, recent files, project symbols. When typing `/`, show skill descriptions (already partially done). Add fuzzy matching.  
**Why:** Reduces friction; keeps users in flow.

### 5. Conversation Export (Markdown / JSON / PDF)
**Status:** ✅ **Markdown + JSON done.** "Export Markdown" and "Export JSON" (full structured data) in the conversation menus (`Sidebar.tsx`). PDF and batch export still open.  
**What:** Export conversation as Markdown (with YAML frontmatter), JSON (full structured data), or PDF (print layout). Batch export for the whole project.  
**Why:** Users want to share conversations, save them to repos, or print for review.

---

## 🟡 P2 — Good Additions

### 6. Image Generation & Artifact Gallery
**Status:** Artifacts exist for HTML/SVG/Mermaid.  
**What:** Add a gallery view (grid/carousel) of all rendered artifacts for a conversation or project. Support image generation via provider (DALL-E, Stable Diffusion via Ollama). Let the AI generate images and show them inline.  
**Why:** Visual output is highly engaging; gallery lets users browse past artifacts.

### 7. Prompt Library / Template Manager
**Status:** ✅ **Done.** "Prompts" tab in Settings (`PromptsPanel.tsx`, `prompts` DB table + `prompt:*` IPC): create/edit/delete/categorise templates. Insert via the composer's `#` trigger with fuzzy matching; `{{clipboard}}` and `{{date}}` interpolate at insert time. `{{file}}`/`{{selection}}` still open.  
**What:** Create a dedicated "Prompt Library" panel where users can browse, edit, create, and organise reusable prompts (not just slash commands). Support variable interpolation (`{{file}}`, `{{selection}}`, `{{clipboard}}`).  
**Why:** Power users build up a collection of prompt patterns.

### 8. Drag-and-Drop File Reordering + Multi-File Upload
**Status:** ✅ **Done.** Attachment chips reorder via drag (`reorderAttachments` in the store); dropping OS files onto the composer attaches them (multi-file, 20 MB cap, type inferred from MIME) with a dashed-border drop indicator. Folder drop / progress bars still open.  
**What:** Reorder attachments via drag. Drop multiple files or an entire folder. Show upload progress (if large files).  
**Why:** Users often need to control the order images/files are sent to the model.

### 9. Token & Cost Tracking Dashboard
**Status:** ✅ **Done.** "Usage" tab in the right sidebar (`UsagePanel.tsx`): Today/7d/30d periods, total/input/output tokens, per-model breakdown with bars, estimated cost from `inputPrice`/`outputPrice` (SQL aggregation via `usage:stats` IPC in `conversations.ts`). Rate-limit warnings still open.  
**What:** Build a small dashboard / sidebar panel showing: total tokens spent today/this-week, per-model breakdown, estimated cost (using `inputPrice`/`outputPrice` from provider presets), and rate-limit warnings.  
**Why:** Helps users manage budgets, especially on paid APIs.

### 10. Model Fallback / Chain-of-Providers
**Status:** Single provider per conversation.  
**What:** Configure a "fallback chain": if Provider A returns an error or rate-limit, automatically retry with Provider B (e.g., Claude → Ollama). Optionally let the AI pick the cheapest model for simple tasks.  
**Why:** Robustness against outages; cost optimisation.

### 11. Customisable System Prompt per Conversation
**Status:** ✅ **Done.** "Edit system prompt" in the conversation menu opens `SystemPromptModal.tsx`; the saved prompt is layered on top of the default in `chat.ts` (`convSystemPrompt`) at send time.  
**What:** Add a "System prompt" field in the conversation settings (gear icon in InputBar or sidebar context menu). Auto-insert it.  
**Why:** Users want to give per-chat instructions (e.g., "You are a React expert" vs "You are a data scientist").

### 12. Conversation Archiving
**Status:** ✅ **Done.** "Archive" in the conversation menu; collapsible "Archived (n)" section at the bottom of the sidebar (`ArchivedSection` in `Sidebar.tsx`) with unarchive/delete on hover.  
**What:** Add "Archive" to conversation context menu. Add an "Archived" section at the bottom of the sidebar (collapsible, with a toggle to show/hide).  
**Why:** Decluttering without deleting; essential for heavy users.

---

## 🔵 P3 — Nice to Have

### 13. Inline Code Execution (Pyodide / Web Containers)
**Status:** Shell execution works via `run_shell` tool, but code is sent to a system shell.  
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

### 16. Live Preview for Mermaid, Math (KaTeX), Diagrams
**Status:** ✅ **Mostly done.** ```` ```mermaid ```` fences render inline as diagrams (`MermaidBlock.tsx`, lazy-loaded, `securityLevel: strict`, raw-code fallback on parse errors); `$$…$$` / `$…$` render via remark-math + rehype-katex; code blocks already had copy buttons. "Open in editor" for artifacts still open.  
**What:** Render ````mermaid` fences inline as interactive diagrams (like GitHub does). Render `$$...$$` LaTeX with KaTeX. Add a copy-to-clipboard button on code blocks and an "Open in editor" button for artifacts.  
**Why:** Rich rendering makes conversations more useful and visually appealing.

### 17. Plugin / Extension System
**Status:** MCP servers provide external tools; built-in tools are hardcoded.  
**What:** Define a plugin API: a folder of `.js` files in `~/.hive/plugins/` that can register new tools/interceptors. Hot-reload on change.  
**Why:** Community contributions without modifying core; like Obsidian's plugin ecosystem.

### 18. Keyboard Shortcuts Cheatsheet
**Status:** ✅ **Done.** Press `?` (outside inputs) to open `ShortcutsCheatsheet.tsx` — an overlay grouping General / Layout / Composer shortcuts, platform-aware modifier glyphs, `Esc` to close. Custom keybindings still open.  
**What:** Press `?` to show an overlay with all available keyboard shortcuts, grouped by category. Let users customise keybindings.  
**Why:** Discoverability — many users don't know about shortcuts.

### 19. Multi-Language Spellcheck for Input
**Status:** None.  
**What:** Leverage the OS spellcheck or a lightweight WASM dictionary. Underline misspelled words in the input textarea. Option to set language per-conversation.  
**Why:** Professional appearance; reduces embarrassing typos in prompts.

### 20. Conversation Snippets / Bookmarks
**Status:** ✅ **Done.** "Save" star on message hover (persists via `messages.bookmarked`, migration v6); collapsible "Bookmarks" section in the sidebar with previews; clicking jumps to the message and flashes it (reuses the search-jump mechanism).  
**What:** Users can bookmark specific messages (star icon in message hover). Show a "Bookmarks" section in the sidebar. Clicking jumps to that message in the conversation and highlights it.  
**Why:** Long conversations make it hard to find key decisions or insights.

### 21. "Focus Mode" Improvements
**Status:** 🟡 **Partial.** F11 toggles OS full-screen (`window:toggleFullscreen` IPC, listed in the cheatsheet). Titlebar auto-hide, timers, and zen fade still open.  
**What:** Add a full-screen mode (F11 or Cmd+Shift+F). Auto-hide the titlebar. Add a countdown timer or word-count goal. "Zen mode" that fades everything except the last few messages.  
**Why:** Deep work; distraction-free writing.

### 22. Custom CSS / Theme Engine
**Status:** ✅ **Mostly done.** Accent colour picker (overrides `--accent*` variables with derived hover/soft/glow) and a Custom CSS editor (injected last in `<head>` so it wins the cascade) in Settings → Appearance (`applyAccent`/`applyCustomCss` in `theme.ts`). Theme gallery still open.  
**What:** Let users load a custom CSS file from a path. Provide a "Theme Gallery" with community themes. Expose CSS variables for accent colour, font family, border radius, etc. in the General settings panel.  
**Why:** Strong personalisation appeal; many users love tweaking appearance.

### 23. MCP Server Auto-Install & Marketplace
**Status:** ✅ **Mostly done.** "Discover" section in Settings → MCP (`MCP_CATALOG` in `McpPanel.tsx`): curated npx-installable servers (Filesystem, Memory, Sequential Thinking, GitHub, Brave Search, Puppeteer); "Add" pre-fills the editor with command/args/env and flags required config. Version update notifications still open.  
**What:** A "Discover" tab in MCP settings that lists known MCP servers (npx packages, GitHub repos). One-click install (npm install + configure defaults). Version update notifications.  
**Why:** Lowers the barrier to extending the app with new capabilities.

### 24. Offline Mode Indicator
**Status:** ✅ **Mostly done.** Green/red dot in the titlebar (`online`/`offline` events); sending to a remote provider while offline shows a clear error (localhost providers like Ollama are exempt). Yellow "intermittent" state, auto-retry, and offline queueing still open.  
**What:** Show a coloured dot in the titlebar: green (connected to provider), yellow (intermittent), red (offline). Pause streaming gracefully if the connection drops; auto-retry. Queue messages sent while offline and send when reconnected.  
**Why:** Users with spotty connections need clear feedback.

### 25. Native Desktop Notifications
**Status:** ✅ **Done.** `notifyStreamOutcome` in `chat.ts` fires a native Notification on finish/error when the window is unfocused (click focuses the app; aborts don't notify). Toggle: Settings → General → "Desktop notifications" (`desktopNotifications`, default on).  
**What:** When a streaming response finishes (or errors) while the window is in the background, send a native OS notification with the first few words of the response. Toggle in Settings → General.  
**Why:** Users multitask; they want to know when the AI is done thinking.

---

## 📋 Implementation Notes

### Low-hanging fruit (could ship in a week) — ✅ ALL SHIPPED
1. ~~Fork UI buttons on messages (#2)~~ ✅ Done — `MessageActions` in `Message.tsx`
2. ~~Archive/unarchive conversations (#12)~~ ✅ Done — `ArchivedSection` in `Sidebar.tsx`
3. ~~Keyboard shortcuts cheatsheet (#18)~~ ✅ Done — `ShortcutsCheatsheet.tsx` (press `?`)
4. ~~Per-conversation system prompt editor (#11)~~ ✅ Done — `SystemPromptModal.tsx`, wired in `chat.ts`
5. ~~Conversation export to Markdown (#5)~~ ✅ Done — `handleExportMarkdown` in `Sidebar.tsx`

### Second wave — ✅ ALSO SHIPPED (2026-07-10)
- #1 Custom agents, #3 full-text search, #4 fuzzy autocomplete (P1 complete)
- #7 Prompt library, #8 attachment DnD, #9 usage/cost dashboard
- #16 inline Mermaid + KaTeX, #20 bookmarks, #23 MCP Discover, #25 desktop notifications
- Partial: #21 (F11 fullscreen), #22 (accent + custom CSS), #24 (offline dot + send guard)

### Foundation for bigger features (still open)
- **Local RAG (#14)** needs an embedding pipeline + a vector store
- **Plugin system (#17)** needs a loader, sandbox, and lifecycle hooks
- **Collaborative chat (#15)** needs a lightweight server or P2P transport
- **Model fallback (#10)** touches the streaming core
- **Pyodide execution (#13)** and **spellcheck languages (#19)** need new runtime pieces

### Depends on external services
- **Image generation (#6)** depends on provider API support (already in presets); the artifact-gallery half is buildable today

---

*Generated by exploring the codebase on 2026-07-09. Statuses last updated 2026-07-10 after the second implementation wave.*
