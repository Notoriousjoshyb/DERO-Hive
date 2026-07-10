# DERO Hive

> A feature-rich, provider-agnostic AI harness desktop app — think Claude Desktop, but with total freedom.

**DERO Hive** is an Electron + React + Vite desktop application that gives you a unified chat interface connected to **any** AI provider (OpenAI-compatible, Anthropic, local models via Ollama, and more). It ships with built-in tools, MCP server integration, voice input, artifact rendering, git integration, full-text search, and a granular permission system — all running locally with SQLite persistence.

---

## ✨ Features

### 🤖 Multi-Provider AI Chat
- **Built-in presets**: OpenCode Zen, OpenCode Go, MiniMax M3, Kimi Code (Moonshot), OpenAI, Anthropic, Groq, OpenRouter, Ollama — plus custom OpenAI-compatible endpoints.
- **Streaming**: Token-by-token SSE rendering with reasoning/thinking display (e.g. OpenAI o1-style extended thinking).
- **Model list**: Live model list fetching from each provider's `/models` endpoint.
- **System prompts**: Customizable per-conversation system prompt, defaults to DERO Hive's built-in.
- **Temperature & settings**: Per-request temperature, top-p, max tokens configuration.
- **Conversation history**: Full conversation storage with auto-title generation.

### 🛠️ Built-in Tools
The assistant can use these tools directly in chat (with your permission):

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with line range support, binary detection |
| `write_file` | Write content to files (with diff preview) |
| `edit_file` | Replace exact text in files (find-and-replace style) |
| `glob` | Find files matching a glob pattern |
| `grep` | Search for a regex pattern across files |
| `list_directory` | List files and subdirectories |
| `run_shell` | Execute shell commands (with approval) |
| `todo_write` | Maintain a structured task list |

### 🔌 MCP (Model Context Protocol) Server Support
- Connect stdio or Streamable HTTP MCP servers for custom tools, resources, and prompts.
- Built-in bundled MCP servers auto-discovered from `resources/mcp/`.
- Curated Discover entries include a local Obsidian MCP connection.
- Start/stop/restart servers from the Settings UI.
- Real-time status monitoring with auto-reconnect.
- Permission gating for MCP-provided tools.

### 🎙️ Voice Input (Working Mic)
Three engine options:
- **Browser SpeechRecognition** — built-in browser API, no downloads.
- **Whisper.cpp** — offline, accurate speech-to-text (~100MB model, local).
- **WebSocket STT endpoint** — stream audio to a local or remote STT server.

Features: live interim results, auto-stop on silence (configurable), visual feedback (pulsing red icon + "Listening…"), toggleable notification sounds.

### 🖼️ Multi-Modal Input
Drag & drop or paste:
- **Images** — auto-included as `image_url` content parts (supports detail control).
- **Audio** — transcribed via whisper and included as text.
- **PDFs** — text extracted and included as file content.
- **Any file** — attached with filename + MIME type data.

### 🎨 Artifacts & Canvas
When the assistant generates HTML, SVG, React components, or Mermaid diagrams, they appear in the **Canvas** side panel with live preview rendering:
- HTML/SVG rendered in an isolated sandboxed iframe.
- Mermaid diagrams rendered server-side and displayed as SVG.
- React components detected and rendered with basic JSX transformation.
- Artifact history stored per-conversation in SQLite.

### 📁 Projects
Organize conversations into **projects**:
- Add/remove project folders via Settings or sidebar.
- Each project has: `id`, `name`, `icon` (emoji picker), `color`, `path`, `createdAt`.
- Conversations can be linked to a project or unlinked (default).
- Open project folder in file explorer.
- Project dashboard with stats (conversation count, last active, total messages).

### 💻 Code Tab (Built-in Editor)
A lightweight code editor with:
- File explorer tree (auto-skips `node_modules`, `.git`, `dist`, etc.).
- Code editing with syntax highlighting (via CodeMirror/Prism-style editor).
- Diff view showing file changes made during the conversation.
- Open folder override for working outside the project root.

### 🔍 Git Integration (Right Sidebar)
Full Git panel with:
- Current branch, ahead/behind status.
- Staged, modified, and untracked files list.
- Recent commit log (last 10 commits).
- Click to view file diffs.

### 📝 Skills (Slash Commands)
Built-in slash-command prompt templates:

| Command | Description |
|---------|-------------|
| `/commit` | Generate a conventional commit message from staged changes |
| `/review` | Code review for bugs, style, security issues |
| `/explain` | Explain a code snippet in plain language |
| `/tests` | Generate unit tests for the selected code |
| `/doc` | Generate documentation comments |
| `/fix` | Fix bugs in the selected code |
| `/refactor` | Suggest refactoring improvements |

Custom skills can be created in Settings or imported from a local folder containing `SKILL.md`.

### 🔒 Permission System
Granular control over tool execution:
- **Always ask** — sensitive and untrusted MCP tools prompt every time.
- **Ask once per chat** — remember approval for one tool in one conversation.
- **Never ask** — skip implicit prompts; explicit deny/ask rules still apply.
- Per-tool rules stored securely.

### 🗃️ Local-First & SQLite
- Full conversation history stored in SQLite with FTS5 full-text search.
- Encrypted secrets storage (API keys encrypted at rest).
- Conversation compaction to manage token budgets.
- No cloud dependency — your data stays on your machine.

### 🔎 Full-Text Search
Search across all conversations from the sidebar search bar:
- Searches conversation titles and message content.
- FTS5-powered for fast results.
- Click a result to jump directly to that conversation.

### ⚙️ Settings (6 panels)
1. **General** — Theme (dark/light), font, font size, spacing, input behavior, voice notification sounds.
2. **Providers** — Add/edit/delete AI providers, configure base URLs, API keys, model overrides.
3. **Projects** — Manage project folders with icons and colors.
4. **MCP Servers** — Add/edit/delete MCP server configurations, connect/disconnect.
5. **Skills** — Enable/disable built-in skills, add custom skills.
6. **Tools & Permissions** — Configure tool approval mode (always/ask/deny), per-tool rules.

### ⌨️ Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Quick search |
| `Ctrl/Cmd + N` | New conversation |
| `Ctrl/Cmd + Shift + ,` | Open Settings |
| `Ctrl/Cmd + \` | Toggle sidebar |
| `Ctrl/Cmd + '` | Toggle right sidebar |
| `Ctrl/Cmd + Shift + C` | Toggle code tab |
| `Ctrl/Cmd + Shift + A` | Toggle canvas/artifacts |
| `Ctrl/Cmd + Enter` | Send message (in plan mode) |
| `Escape` | Close modals / Cancel streaming |

### 🧩 Additional Features
- **Composer Queue** — Queue multiple messages with attachments and send them in sequence.
- **Focus Mode** — Full-screen chat input for distraction-free writing.
- **Plan Mode** — Assistant plans before answering (thinks step-by-step).
- **Reasoning Levels** — Off / Low / Medium / High reasoning effort (for supported providers).
- **Token Usage Display** — Real-time token count per message and total.
- **Context Indicator** — Shows approximate context window usage.
- **Conversation Forking** — Backend support for branching conversations.
- **GitHub URL Fetching** — Paste a GitHub issue/PR URL to fetch its content.
- **Terminal Sessions** — Persistent shell sessions with process management.
- **Compaction Toast** — Notification when conversations are automatically compacted.
- **File Changes Tracking** — Automatic tracking of files written/edited during a session.

---

## 📦 Installation

### Prerequisites
- **Node.js** 18+ (LTS recommended)
- **npm** 9+ or **yarn** 1.22+
- **Git** (for cloning and git integration features)
- **Windows**: Windows 10/11 (build tested on x64)
- **macOS/Linux**: Not yet packaged, but should run with `npm run dev`

### Quick Start (Development)

```bash
# 1. Clone the repository
git clone https://github.com/Notoriousjoshyb/dero-hive.git
cd dero-hive

# 2. Install dependencies
npm install

# 3. Start in development mode (hot-reload)
npm run dev
```

The `postinstall` script will automatically:
- Download Whisper.cpp binaries for voice input (if on Windows).
- Set up bundled MCP servers.

### Build for Production

```bash
# Build the app (platform-agnostic bundle)
npm run build

# Build Windows installer (NSIS setup)
npm run build:win
# Output: release/DERO Hive Setup 0.1.0.exe

# Preview production build (without packaging)
npm run start
```

### Build Options

| Script | Description |
|--------|-------------|
| `npm run dev` | Development mode with hot-reload |
| `npm run start` | Preview production build |
| `npm run build` | Production bundle (out/) |
| `npm run build:win` | Windows installer via electron-builder |
| `npm run setup:whisper` | Manual whisper setup |
| `npm run setup:mcp` | Manual MCP server setup |
| `npm run typecheck` | Full TypeScript type checking |
| `npm run lint` | ESLint check |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DERO_HIVE_DATA_DIR` | Override the default data directory (default: `%APPDATA%/DERO Hive`) |

---

## 🏗️ Architecture

```
dero-hive/
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts               # App entry, window creation, IPC registration
│   │   ├── db/
│   │   │   └── client.ts          # SQLite database client (better-sqlite3)
│   │   ├── ipc/                   # IPC handlers (14 modules)
│   │   │   ├── app.ts             # App-level IPC (platform, versions, etc.)
│   │   │   ├── artifacts.ts       # Artifact CRUD
│   │   │   ├── chat.ts            # Chat send/abort/stream
│   │   │   ├── conversations.ts   # Conversation CRUD + search
│   │   │   ├── fs.ts              # File system operations for renderer
│   │   │   ├── github.ts          # GitHub issue/PR fetcher
│   │   │   ├── mcp.ts             # MCP server management
│   │   │   ├── projects.ts        # Project CRUD
│   │   │   ├── providers.ts       # Provider config CRUD + model fetching
│   │   │   ├── settings.ts        # App settings get/set
│   │   │   ├── shell.ts           # Shell command execution
│   │   │   ├── skills.ts          # Skill CRUD
│   │   │   ├── tools.ts           # Tool-related IPC
│   │   │   └── whisper.ts         # Whisper STT control
│   │   ├── mcp/
│   │   │   ├── manager.ts         # MCP server lifecycle manager
│   │   │   └── client.ts          # MCP client instance wrapper
│   │   ├── providers/
│   │   │   ├── registry.ts        # Provider adapter registry
│   │   │   ├── base.ts            # Base provider adapter interface
│   │   │   ├── openai-compatible.ts # OpenAI-compatible adapter
│   │   │   └── anthropic.ts       # Anthropic-specific adapter
│   │   ├── skills/
│   │   │   └── loader.ts          # Skill markdown parser + loader
│   │   ├── terminal/
│   │   │   └── session.ts         # Persistent terminal session management
│   │   ├── tools/
│   │   │   ├── registry.ts        # Tool registry + permission system
│   │   │   └── builtin.ts         # 8 built-in tool implementations
│   │   ├── whisper/
│   │   │   └── manager.ts         # Whisper.cpp process manager
│   │   └── utils/
│   │       ├── logger.ts          # Structured logging
│   │       ├── paths.ts           # App path resolution
│   │       ├── secrets.ts         # Encrypted secrets (API keys)
│   │       └── tokenBudget.ts     # Token counting & budget management
│   │
│   ├── preload/
│   │   └── index.ts               # Context-isolated IPC bridge
│   │
│   ├── renderer/                   # React frontend
│   │   ├── index.html             # HTML entry point
│   │   └── src/
│   │       ├── App.tsx            # Root React component
│   │       ├── stores/
│   │       │   └── app.ts         # Zustand global state store
│   │       ├── components/
│   │       │   ├── ChatView.tsx   # Main chat area with message list
│   │       │   ├── InputBar.tsx   # Composer input with attachments
│   │       │   ├── MessageList.tsx # Virtualized message rendering
│   │       │   ├── Message.tsx    # Single message display
│   │       │   ├── Sidebar.tsx    # Left sidebar (conversations, projects, search)
│   │       │   ├── CanvasPanel.tsx # Artifacts side panel
│   │       │   ├── TitleBar.tsx   # Custom title bar with controls
│   │       │   ├── EmptyState.tsx # Welcome/empty screen
│   │       │   ├── PermissionDialog.tsx # Tool permission request modal
│   │       │   ├── TaskListPanel.tsx # TODO list display
│   │       │   ├── CompactionToast.tsx # Auto-compaction notification
│   │       │   ├── VoiceInput.tsx # Mic button + recording UI
│   │       │   ├── ComposerToolbar.tsx # @, /, !, # helpers
│   │       │   ├── ComposerAutocomplete.tsx # Autocomplete popup
│   │       │   ├── TokenUsage.tsx # Token/context usage display
│   │       │   ├── code/
│   │       │   │   ├── CodeTab.tsx    # Full code editor tab
│   │       │   │   ├── CodeEditor.tsx # Syntax-highlighted editor
│   │       │   │   └── fileIcons.ts   # File type icon mapping
│   │       │   ├── rightsidebar/
│   │       │   │   ├── RightSidebar.tsx # Right sidebar container
│   │       │   │   ├── GitPanel.tsx    # Git status + commits
│   │       │   │   ├── FilesPanel.tsx  # File explorer tree
│   │       │   │   └── ContextPanel.tsx # Context overview
│   │       │   └── settings/
│   │       │       ├── SettingsModal.tsx # Settings dialog
│   │       │       ├── GeneralPanel.tsx  # Theme, fonts, appearance
│   │       │       ├── ProvidersPanel.tsx # Provider configuration
│   │       │       ├── ProjectsPanel.tsx  # Project management
│   │       │       ├── McpPanel.tsx       # MCP server management
│   │       │       ├── SkillsPanel.tsx    # Skill management
│   │       │       └── ToolsPanel.tsx     # Tool permissions
│   │       ├── hooks/
│   │       │   ├── useChat.ts           # Chat send/stream logic
│   │       │   └── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │       └── lib/
│   │           ├── theme.ts    # Theme application
│   │           ├── thinking.ts # Reasoning content extraction
│   │           └── audioWav.ts # Audio encoding utilities
│   │
│   └── shared/
│       ├── types.ts            # Shared TypeScript types
│       ├── presets.ts          # Provider preset definitions
│       └── defaults.ts         # Default system prompt & skills
│
├── resources/
│   ├── skills/                 # Bundled custom skill markdown files
│   ├── mcp/                    # Bundled MCP server packages
│   ├── icon.ico                # App icon (Windows)
│   └── icon.svg                # App icon (scalable)
│
├── scripts/
│   ├── setup-whisper.mjs       # Whisper.cpp download/install
│   └── setup-mcp.mjs           # MCP server setup
│
├── release/                    # Build output (installer, unpacked)
├── out/                        # Compiled output
├── electron.vite.config.ts     # Vite + Electron config
├── tailwind.config.js          # Tailwind CSS configuration
├── postcss.config.mjs          # PostCSS configuration
├── tsconfig.json               # TypeScript root config
├── tsconfig.node.json          # TypeScript node config
├── tsconfig.web.json           # TypeScript web config
└── package.json                # Dependencies & scripts
```

### Data Flow
1. **User types a message** in the InputBar → stored in Zustand state.
2. **Send** triggers `window.hive.chatSend()` via IPC → main process.
3. **Main process** calls the appropriate ProviderAdapter (OpenAI-compatible or Anthropic).
4. **Provider streams tokens** back via SSE → forwarded to renderer via IPC events.
5. **Renderer** updates streaming content in real-time, renders Markdown with syntax highlighting.
6. **Tool calls** from the assistant are intercepted by ToolRegistry → permission check → execution → result sent back.
7. **MCP tools** are handled via the McpManager over stdio or Streamable HTTP.
8. **All conversations** are persisted to SQLite with FTS5 full-text search indexing.

---

## 🗄️ Database Schema

The app uses **better-sqlite3** with these tables:

| Table | Description |
|-------|-------------|
| `settings` | Key-value app settings (theme, fonts, etc.) |
| `conversations` | Conversation metadata (title, provider, model, project, compaction stats) |
| `messages` | Individual messages with content, reasoning, tool calls, token usage |
| `messages_fts` | FTS5 virtual table for full-text search |
| `artifacts` | Saved artifacts (HTML, SVG, Mermaid, etc.) |
| `projects` | Project folders with icon, color, path |
| `providers` | Provider configurations (base URL, models, enabled state) |
| `mcp_servers` | MCP server transport and non-secret configuration; credentials are encrypted separately |
| `skills` | Custom skills (name, description, prompt, category) |
| `tool_permissions` | Per-tool permission rules (allow/deny/ask) |
| `schema_version` | Migration tracking |

---

## 🔧 Configuration

### Data Directory
All data (SQLite DB, encrypted secrets, logs) is stored at:
- **Windows**: `%APPDATA%/DERO Hive/`
- Override with `DERO_HIVE_DATA_DIR` environment variable.

### First-Time Setup
1. Launch the app → empty chat screen.
2. Press `Ctrl/Cmd + ,` or click the gear icon to open Settings.
3. Go to **Providers** tab.
4. Click a preset (e.g. **OpenCode Zen**, **OpenAI**, **Anthropic**).
5. Paste your API key in the field.
6. Click **Save** → the provider will fetch available models.
7. Close Settings, select a model from the dropdown in the composer, and start chatting!

---

## 🧪 Testing & Quality

```bash
# Typecheck, tests, and production build
npm run check

# Tests only
npm test
```

---

## 🚧 Roadmap & Future Work

### 🔴 High Priority
- [ ] **Conversation Branching / Forking** — UI buttons to fork from any message, fork lineage visualization.
- [ ] **Full-Text Search Dialog** — `Cmd/Ctrl+Shift+F` search dialog with snippets, context, filters, match highlighting.
- [ ] **Message Editing** — Edit any user/assistant message and re-send to continue the conversation.
- [ ] **Drag & Drop Reordering** — Reorder conversations or projects in the sidebar.

### 🟡 Medium Priority
- [ ] **macOS & Linux Builds** — Package for `.dmg` (macOS) and `.AppImage`/`.deb` (Linux).
- [ ] **Multiple Windows / Tabs** — Open multiple conversations in separate windows.
- [ ] **Export / Import** — Export conversations as Markdown, JSON, or PDF.
- [ ] **Prompt Library** — Save and organize reusable prompts.
- [ ] **Image Generation** — Support for DALL-E, Stable Diffusion, or other image generation providers.
- [ ] **Web Search Tool** — Built-in web search tool for the assistant.
- [ ] **RAG (Retrieval-Augmented Generation)** — Ingest documents and let the assistant search them.
- [ ] **Theme Store** — User-contributed themes.
- [ ] **Plugin System** — Community plugin API.

### 🟢 Nice-to-Have
- [ ] **Conversation Stats** — Word count, token usage over time, most used models.
- [ ] **Multi-Language Spelling/Grammar Check** — Built-in proofreading skill.
- [ ] **VSCode Extension** — Connect DERO Hive conversations to VS Code.
- [ ] **Auto-Tagging** — Automatic tagging of conversations by topic.
- [ ] **Pinned Messages** — Pin important messages to the top of a conversation.
- [ ] **Collaborative Chat** — Share conversations with others (via export or server).
- [ ] **Touch Bar Support** — macOS Touch Bar shortcuts.

---

## 🧑‍💻 Development

### Prerequisites
- Node.js 18+
- npm 9+
- Git

### Setup
```bash
git clone https://github.com/your-org/dero-hive.git
cd dero-hive
npm install
npm run dev
```

### Project Scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` | Hot-reload development |
| `npm run start` | Preview production build |
| `npm run build` | Build production bundle |
| `npm run build:win` | Build Windows installer |
| `npm run setup:whisper` | Download whisper.cpp |
| `npm run setup:mcp` | Build bundled MCP servers |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |

### Tech Stack
| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | Electron 33 |
| **Build Tool** | electron-vite / Vite 6 |
| **Frontend** | React 18, TypeScript |
| **Styling** | Tailwind CSS 3 |
| **State Management** | Zustand 5 |
| **Database** | better-sqlite3 |
| **Markdown Rendering** | react-markdown, rehype, remark |
| **Syntax Highlighting** | Shiki (main), highlight.js (fallback) |
| **IPC** | Electron contextBridge + ipcMain/ipcRenderer |
| **MCP** | @modelcontextprotocol/sdk |
| **Icons** | Custom file icons, emoji picker |
| **Packaging** | electron-builder |

---

## 📄 License

MIT — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/), [React](https://reactjs.org/), [Vite](https://vitejs.dev/), and [Tailwind CSS](https://tailwindcss.com/).
- MCP support via the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk).
- Voice recognition powered by [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) and the Web Speech API.
- All the open-source packages listed in `package.json`.
