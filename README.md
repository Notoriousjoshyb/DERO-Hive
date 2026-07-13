# DERO Hive

DERO Hive is a local-first desktop AI workspace for chat, coding, tools, MCP servers, projects, and DERO development.

## Highlights

- Built-in provider presets for Codex (ChatGPT), OpenAI, Anthropic, OpenRouter, Groq, Ollama, OpenCode, MiniMax, Kimi, and Moonshot.
- Persistent Codex ACP sessions with ChatGPT browser sign-in; no OpenAI API key is required for ChatGPT subscription use.
- Per-model thinking controls. Known provider/model capabilities take precedence; unavailable capability metadata falls back to Medium reasoning.
- Streaming chat with reasoning output, conversation history, token/context indicators, attachments (drag-and-drop with reordering), and project-aware working directories.
- Side-by-side model comparison with streaming output, independent cancellation, error states, model swapping, and keyboard-friendly controls.
- Conversation power features: fork/revert from any message, full-text search (Ctrl+Shift+F) with jump-to-message, bookmarks, archiving, per-conversation system prompts, and Markdown/JSON export.
- Composer agents (persona presets, built-in + custom), a prompt library inserted via `#` with `{{clipboard}}`/`{{date}}` variables, and fuzzy `/` skill + `@` file autocomplete.
- Inline Mermaid diagrams and KaTeX math in chat; token & estimated-cost usage dashboard; native desktop notifications when responses finish in the background.
- Built-in file, shell, Git, artifact, voice, and permission workflows. Keyboard shortcuts cheatsheet on `?`.
- MCP server support over stdio or remote HTTP, with encrypted server credentials, a curated Discover catalog for one-click installs, bundled DERO MCP resources, and DERO-focused skills you can also import from any local `SKILL.md` folder.
- Tool approval modes — always, never, or scoped to the current conversation/project so you're asked once per tool instead of every call.
- Provider fallback chains: configure backup provider/model pairs that Hive tries automatically if the primary one errors before producing output.
- Swarm: run specialists in parallel on a task, followed by an automatic Verify pass that fact-checks their reports against the codebase before a Synthesizer produces the final answer.
- Optional per-project knowledge vault: capture notes into an Obsidian vault (via MCP), with consent-gated automatic writes, scheduled daily digests and weekly syntheses, and an offline retry queue.
- Appearance engine: themes, accent colour override, and custom CSS injection.
- Activity panel: a live, terminal-style log of every file the agent writes or edits, with `git diff`-style hunks, before/after snapshots, and +/- line counts.
- Browser Companion extension (Chrome/Edge side panel) that sends page context to DERO Hive, streams replies live back into the browser, and can save captured context straight into a project's knowledge vault. See below.

## Requirements

- Node.js 18 or later
- npm 9 or later
- Git
- Windows 10/11 for the packaged installer; development mode also works on macOS/Linux where dependencies are available.

## Development

```bash
git clone https://github.com/Notoriousjoshyb/DERO-Hive.git
cd DERO-Hive
npm install
npm run dev
```

`postinstall` rebuilds the native SQLite dependency, prepares bundled resources, and applies the Codex ACP Windows hidden-window patch.

## Terminal interface

Hive includes a full-screen terminal UI designed for the VS Code integrated terminal and other modern terminals. It reuses the desktop provider adapters, model metadata, reasoning controls, tools, MCP servers, skills, permissions, projects, and SQLite conversation format.

```bash
# Run once from this checkout
npm run cli:link

# Then open any project in VS Code and run this in its integrated terminal
hive

# Or start directly from this checkout
npm run hive -- -C path/to/project
```

Run the command from the project you want Hive to work in. The launch folder becomes the tool workspace automatically; use `hive -C <folder>` to override it. On first use, configure a provider with `hive provider add`, then refresh its models with `hive provider refresh <provider-id>` if needed. `hive --classic` keeps the line-oriented interface, while `hive chat "prompt"` supports scripts and one-shot requests.

Inside the TUI:

- `/` opens discoverable commands, `@` completes and injects bounded workspace-file context, `#` inserts saved or built-in prompt-library entries, and `!command` runs an explicit local shell command and sends its output back as context.
- `Ctrl+P` switches provider/model, `Ctrl+T` cycles model-aware reasoning effort, `Shift+Tab` switches Build/Plan, `Ctrl+O` expands reasoning/tool detail, `Esc` stops a response, and `Ctrl+R` resumes a session.
- `PgUp`/`PgDn` (or `Shift+↑`/`Shift+↓`) scroll back through the transcript — the full-screen renderer repaints in place, so use these rather than the terminal's own scrollback.
- `/theme` switches between Hive Dark, Hive Light, System, Solarized, Nord, Catppuccin, and Gruvbox. The desktop accent override is also understood.
- `/permissions` selects Inspect (always ask), Collaborate (once per conversation), Project trust, or Autopilot. It can also list/add/remove scoped rules; persistent deny rules always win.
- `/attach`, `/agent`, `/compact`, `/fork`, `/undo`, `/diff`, `/context`, `/mcp`, `/skills`, `/project`, `/export`, and `/search` expose the corresponding coding-first workflows.

Plan mode retains read-only file/search inspection while suppressing mutating, shell, media, and third-party tools. Codex ACP-native file/shell activity appears in the same expandable tool timeline as Hive tools. Generated media is copied into the active workspace under `media/hive/` so it remains accessible from the terminal; attachment support still depends on the selected model/provider's image, audio, PDF, or file capabilities.

This terminal interface focuses on coding-agent workflows. Desktop-only visual surfaces—including side-by-side Compare, Swarm orchestration, microphone capture, the Vision/Media studio, Browser Companion, and knowledge-vault dashboards—remain in the Electron app rather than being imitated as incomplete terminal panels.

The CLI uses `~/.hive` by default so a standalone Node process never races the running Electron app for its database and cannot silently bypass Electron's OS-backed secret store. Override it with `--data-dir` or `HIVE_DATA_DIR` when needed, but do not point both running interfaces at the same database. Headless API-key storage uses the existing machine-derived fallback and is obfuscation rather than OS-keychain encryption.

## Verification and builds

```bash
# Type-check main, renderer, and terminal processes
npm run typecheck

# Terminal command/parser and render smoke tests
npm run test:cli

# Vision artifact extraction and viewer tests (dependency-free)
npm run test:vision

# Shared library pure-function tests (diff, DERO references, thinking
# capabilities, gnomon queries, agent resolution, DVM lint, model
# metadata, provider presets, type normalizers)
npm run test:shared

# All test suites
npm run test:all

# Production bundle
npm run build

# Windows NSIS installer
npm run build:win
```

`npm run lint` runs the repository ESLint configuration. Typecheck and the production build are also required before release.

## Providers

Use **Settings → Providers** to add a provider. API-backed providers fetch their model list after being saved.

| Provider | Authentication | Notes |
|---|---|---|
| Codex (ChatGPT) | ChatGPT browser sign-in | Saving starts model discovery automatically. Codex credentials are managed by Codex, not stored by DERO Hive. |
| OpenAI | API key | Uses the OpenAI-compatible chat endpoint. |
| Anthropic | API key | Uses the native Messages API. |
| OpenRouter | API key | Routes to supported upstream models. |
| Groq, OpenCode, MiniMax, Kimi, Moonshot | API key or subscription key | Use their documented OpenAI-compatible endpoints. |
| Ollama | None by default | Uses local installed models. |
| Custom | Provider-defined | OpenAI-compatible endpoint. |

### Codex (ChatGPT) setup

1. Add **Codex (ChatGPT)** in Settings → Providers and save it.
2. Complete the browser sign-in if Codex has no reusable local login session.
3. DERO Hive automatically imports the available Codex models and their reported thinking levels.

The Codex adapter stays alive for the app session. Normal messages reuse the existing ACP process and do not intentionally start another browser login. On Windows, the bundled Codex app-server is launched hidden to avoid console-window flashes.

Codex normally stores its reusable credentials in the operating-system credential store or `~/.codex/auth.json`. Treat `auth.json` as a password and never commit or share it.

## Media generation

Generate images, video, and audio and view or play them directly in **Vision → Media** — images render inline, and video and audio get in-app players.

You can also just **ask in chat** ("generate an image of…", "read this aloud"). Tool-capable models call the built-in `generate_image` / `generate_audio` / `generate_video` tools, and the result previews inline in the conversation. Note a chat model only knows *text* — it needs a media generator to be available: either a media-capable model on a connected provider, or a dedicated media provider. If none is configured, Hive tells you how to add one instead of guessing.

Media capability is derived from your **model providers**. When a provider connects and its model list is pulled, each model id is auto-classified: text-to-image models (DALL·E, GPT Image, Flux, SDXL, Imagen…), video models (Sora, Veo, Kling…), and speech/music models (TTS, MusicGen…). Any media-capable models then appear as options in the Media studio for their kind — no separate configuration needed.

**MiniMax** is wired natively: if you connect a MiniMax provider, Hive reuses that same key against MiniMax's own media endpoints, so image, voice, music, and video generation (per your MiniMax plan) work in the Media studio and from chat without any extra setup.

For anything a chat provider can't do — video, music, local generators (ComfyUI / Automatic1111), or key-free services — add a **dedicated media provider** under **Settings → Media**. Built-in presets cover OpenAI Images, Stability AI, Pollinations (no key), Replicate (image / video / music), ComfyUI, Automatic1111, OpenAI-compatible image endpoints, and OpenAI / ElevenLabs speech.

Generated files are written under the app's media folder (or the active project's `media/` folder) and streamed to the UI over a restricted `hive-media://` scheme that only serves known artifacts. There is a 50 MB per-file cap. Wallet access, signing, and any on-chain action remain out of scope for media generation.

## Browser Companion extension

`browser-extension/` contains a Manifest V3 side-panel extension for Chrome/Edge. Load it via `chrome://extensions` → Developer mode → **Load unpacked**, then open it with the toolbar icon or **Alt+H**.

While the desktop app is running, it exposes a loopback-only bridge on `127.0.0.1:43120` restricted to extension origins. Pairing requires a one-time code: DERO Hive's Hive Companion panel shows a short code, which you enter once in the extension's settings to exchange for a bound, hashed credential (revocable from the Hive Companion panel). Once paired, the extension can:

- Capture the active page, a drag-to-snip region, or the open-tab list as transparent, untrusted context.
- Stream replies token-by-token into the side panel (SSE) with collapsed model thinking, tool-activity chips, and Markdown rendering.
- Sync the selected provider/model with the app in both directions.
- Save captured page context into the active project's knowledge vault, when one is configured.
- Dictate prompts through the app's bundled local Whisper — fully offline.

Extension requests always run as a single agent and never move focus away from the browser. Full details in [`browser-extension/README.md`](browser-extension/README.md).

## Thinking controls

The composer shows the reasoning levels appropriate to the selected model when the provider exposes them. `Default` means DERO Hive does not override the provider. If a provider does not publish capability data, the UI uses the standard Low / Medium / High fallback and selects Medium by default.

Different providers expose reasoning differently. DERO Hive only sends provider-specific reasoning fields where the adapter supports them, preventing unsupported models from receiving invalid request parameters.

## DERO Developer Studio

Set a project type to **DERO developer project** in **Settings → Projects** to enable its Developer Studio in the project cockpit. It provides focused AI workflows for DVM-BASIC contract design and security review, TELA dApp planning, chain investigation, simulator test planning, and release preparation.

The Studio starts and checks the bundled simulator over a loopback-only RPC endpoint, shows basic chain state, and can run a local structural check on pasted or selected `.bas` source. The `lint_dvm_basic` AI tool uses the same deterministic checks. These checks are guidance, not a compiler or proof of execution: confirm a contract with simulator execution and daemon gas estimation before considering a deployment. Wallet access, signing, transfers, live invocations, and deployment remain explicit user actions.

AI agents can also call `get_simulator_chain_info`, a read-only tool that reports the state of the local simulator only when it is running.

When a composer message includes a likely DERO address, 64-character chain identifier, or TELA URL, Hive adds a labelled unverified-reference receipt to the model context. This helps agents use DERO tools to verify claims while ensuring pasted identifiers are never treated as trusted chain evidence by default.

Use **Create starter contract** to create `contracts/Counter.bas` inside the project folder. It never overwrites an existing file.

Use **Create TELA starter** to create a small `tela-starter/` frontend. Its XSWD example requests only `DERO.GetInfo`; it does not sign, transfer, deploy, or access keys, and an existing starter file is never overwritten.

**Generate TELA dApp** scaffolds a named `tela/<name>/` contract + frontend from a short brief, then runs a validation pass (contract initializer, `SIGNER()` guard, HTML structure, XSWD wiring, hardcoded-secret scan, relative asset paths) before you touch a live network.

Contract briefs — AI review findings and proposed regression tests for a piece of DVM-BASIC source — are saved to `.hive/artifacts.json` in the project folder so they survive a restart. **Create fixture wallet** requests a throwaway simulator address (via `DERO.GetRandomAddress`) for local balance/testing without touching a real wallet. The `discover_contracts` tool guides an agent to search contracts already indexed by a connected Gnomon MCP server (by similarity, function name, transaction, or TELA app) rather than scanning the chain itself.

## Security model

- API secrets, MCP server environment variables, and MCP bearer tokens remain in the Electron main process, encrypted at rest via Electron safe storage where available.
- File and shell IPC paths are restricted to the workspace or configured project directories; path containment checks resolve symlinks so a link inside the workspace can't point an operation outside it.
- Codex ACP actions and MCP tool calls are routed through the same allow/deny permission dialog, with always/never/session/project approval scopes.
- The Browser Companion bridge only accepts requests from a paired extension origin bound to a hashed, one-time-code-verified credential — not any webpage that happens to reach `127.0.0.1`.
- The in-app update action opens the canonical GitHub release page; it does not download or execute unverified installers.

## Project layout

```text
src/main/                 Electron main process, IPC, providers, tools, and services
src/main/knowledge/       Project knowledge vault service and digest/synthesis scheduler
src/preload/              Context-isolated renderer API
src/renderer/src/         React user interface and Zustand state
src/shared/               Shared types, presets, model metadata, capabilities
cli/                      Ink terminal UI, headless services, and CLI commands
browser-extension/        Chrome/Edge side-panel Browser Companion (unpacked MV3 extension)
resources/mcp/            Bundled DERO MCP server source and assets
resources/mcp-registry.json  Curated seed registry for the MCP Discover tab
resources/skills/         Bundled DERO development skills
scripts/                  Resource setup and Codex ACP patch scripts
```

## Environment

| Variable | Purpose |
|---|---|
| `HIVE_DATA_DIR` | Overrides the headless/terminal local-data directory (default `~/.hive`). |
| `HIVE_WORKSPACE` | Overrides the terminal fallback workspace when no launch folder is available. |
| `HIVE_RESOURCES` | Overrides the bundled-resource root for a relocated terminal installation. |
| `CODEX_PATH` | Optional custom Codex executable used by ACP. |

## Acknowledgments

DERO Hive is possible because of these open-source projects and services. This list covers the direct runtime and build dependencies declared in this repository; transitive dependency credits remain with their respective projects.

### Application platform and UI

- [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/) for the desktop application and Windows packaging.
- [electron-vite](https://electron-vite.org/), [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), and [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) for development and builds.
- [React](https://react.dev/), [React DOM](https://react.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [Tailwind CSS](https://tailwindcss.com/), [PostCSS](https://postcss.org/), and [Autoprefixer](https://github.com/postcss/autoprefixer) for the interface.

### AI, agent, and protocol projects

- [OpenAI Codex](https://github.com/openai/codex), [Agent Client Protocol](https://agentclientprotocol.com/), [codex-acp](https://github.com/agentclientprotocol/codex-acp), and [Zed](https://zed.dev/) for the ACP ecosystem that enables ChatGPT-backed Codex sessions.
- [Model Context Protocol](https://modelcontextprotocol.io/) and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for MCP integrations.
- [OpenAI](https://openai.com/), [Anthropic](https://www.anthropic.com/), [OpenRouter](https://openrouter.ai/), [Groq](https://groq.com/), [Ollama](https://ollama.com/), [OpenCode](https://opencode.ai/), [MiniMax](https://www.minimaxi.com/), and [Moonshot AI / Kimi](https://www.kimi.com/) for the supported provider ecosystems.

### Local data, rendering, and utilities

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and [electron-store](https://github.com/sindresorhus/electron-store) for local persistence.
- [eventsource-parser](https://github.com/rexxars/eventsource-parser) for streamed responses.
- [fast-glob](https://github.com/mrmlnc/fast-glob) and [Fuse.js](https://www.fusejs.io/) for workspace and search features.
- [Marked](https://marked.js.org/), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [rehype-raw](https://github.com/rehypejs/rehype-raw), [rehype-highlight](https://github.com/rehypejs/rehype-highlight), [highlight.js](https://highlightjs.org/), and [Shiki](https://shiki.style/) for Markdown and code rendering.
- [Mermaid](https://mermaid.js.org/), [KaTeX](https://katex.org/), [remark-math](https://github.com/remarkjs/remark-math), and [rehype-katex](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex) for inline diagrams and math.
- [Zod](https://zod.dev/) for runtime validation.
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local speech-to-text.

### DERO ecosystem

- [DERO](https://derofoundation.co) and the projects, documentation, and community that support the bundled DERO MCP server and DERO development skills.

## License

MIT. See the repository license for details.
