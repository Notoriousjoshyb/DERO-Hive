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
- MCP server support with a curated Discover catalog, bundled DERO MCP resources, and DERO-focused skills.
- Appearance engine: themes, accent colour override, and custom CSS injection.
- Browser Companion extension (Chrome/Edge side panel) that sends page context to DERO Hive and streams replies live back into the browser. See below.
- Optional, process-isolated Hologram, PureWolf, and Hermes integration status. See [`INTEGRATIONS.md`](INTEGRATIONS.md).

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

## Verification and builds

```bash
# Type-check main and renderer processes
npm run typecheck

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

## Browser Companion extension

`browser-extension/` contains a Manifest V3 side-panel extension for Chrome/Edge. Load it via `chrome://extensions` → Developer mode → **Load unpacked**, then open it with the toolbar icon or **Alt+H**.

While the desktop app is running, the extension pairs automatically with a loopback-only bridge on `127.0.0.1:43120` (ephemeral token, rotated each app start). It can then:

- Capture the active page, a drag-to-snip region, or the open-tab list as transparent, untrusted context.
- Stream replies token-by-token into the side panel (SSE) with collapsed model thinking, tool-activity chips, and Markdown rendering.
- Sync the selected provider/model with the app in both directions.
- Dictate prompts through the app's bundled local Whisper — fully offline.

Extension requests always run as a single agent and never move focus away from the browser. Full details in [`browser-extension/README.md`](browser-extension/README.md).

## Thinking controls

The composer shows the reasoning levels appropriate to the selected model when the provider exposes them. `Default` means DERO Hive does not override the provider. If a provider does not publish capability data, the UI uses the standard Low / Medium / High fallback and selects Medium by default.

Different providers expose reasoning differently. DERO Hive only sends provider-specific reasoning fields where the adapter supports them, preventing unsupported models from receiving invalid request parameters.

## Security model

- API secrets remain in the Electron main process and use Electron safe storage where available.
- File and shell IPC paths are restricted to the workspace or configured project directories.
- Codex ACP actions are routed through the existing allow/deny permission dialog.
- The in-app update action opens the canonical GitHub release page; it does not download or execute unverified installers.

## Project layout

```text
src/main/                 Electron main process, IPC, providers, tools, and services
src/preload/              Context-isolated renderer API
src/renderer/src/         React user interface and Zustand state
src/shared/               Shared types, presets, model metadata, capabilities
browser-extension/        Chrome/Edge side-panel Browser Companion (unpacked MV3 extension)
resources/mcp/            Bundled DERO MCP server source and assets
resources/skills/         Bundled DERO development skills
integrations/             Pinned upstream Hologram and PureWolf source subtrees
resources/integrations/   Optional sidecar packaging manifest and staged binaries
scripts/                  Resource setup and Codex ACP patch scripts
```

## Environment

| Variable | Purpose |
|---|---|
| `DERO_HIVE_DATA_DIR` | Overrides DERO Hive's local app-data directory. |
| `CODEX_PATH` | Optional custom Codex executable used by ACP. |
| `DERO_HIVE_HOLOGRAM_PATH` | Optional external Hologram executable. |
| `DERO_HIVE_PUREWOLF_PATH` | Optional external PureWolf native-host executable. |
| `HERMES_GATEWAY_URL` | Optional independently managed Hermes HTTP(S) gateway. |

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
- [Hologram](https://github.com/DHEBP/HOLOGRAM) and [PureWolf](https://github.com/ArcaneSphere/PureWolf-Browser-Extension) are retained as pinned optional source subtrees. [Hermes Agent](https://github.com/NousResearch/hermes-agent) remains an external optional gateway. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT. See the repository license for details.

