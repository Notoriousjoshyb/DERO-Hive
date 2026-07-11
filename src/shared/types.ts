// Shared types between main, preload, and renderer

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface StoredAttachment {
  id: string;
  type: 'image' | 'audio' | 'pdf' | 'file';
  filename: string;
  mimeType: string;
  size: number;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }
  | { type: 'file'; file: { filename: string; data: string; mimeType: string } }
  | { type: 'attachment_ref'; attachment: StoredAttachment };

export interface Message {
  id: string;
  role: Role;
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string; // for tool messages
  reasoning?: string; // extended thinking content
  createdAt: number;
  model?: string;
  provider?: string;
  usage?: TokenUsage;
  error?: string;
  bookmarked?: boolean;
}

// A bookmarked message as listed in the sidebar
export interface BookmarkEntry {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: Role;
  preview: string;
  createdAt: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  // Display fields filled in after execution
  result?: string;
  status?: 'pending' | 'running' | 'success' | 'error' | 'denied';
  error?: string;
  durationMs?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  source: 'builtin' | `mcp:${string}`;
}

export interface ChatRequest {
  conversationId: string;
  providerId: string;
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Main resolves this id against persisted built-in/custom agents. */
  agentId?: string;
  stream?: boolean;
  reasoning?: { effort?: Exclude<ThinkingEffort, 'off'> };
  planMode?: boolean;
}

export type StreamEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'delta'; conversationId: string; messageId: string; content?: string; reasoning?: string }
  | { type: 'tool_calls'; conversationId: string; messageId: string; toolCalls: ToolCall[] }
  | { type: 'usage'; conversationId: string; messageId: string; usage: TokenUsage }
  | { type: 'done'; conversationId: string; messageId: string }
  | { type: 'error'; conversationId: string; messageId: string; error: string };

// Provider preset definition (built-in)
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyUrl?: string;
  docsUrl?: string;
  defaultModel: string;
  models: ProviderModel[];
  headers?: Record<string, string>;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsReasoning?: boolean;
  notes?: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsReasoning?: boolean;
  /** Exact effort values reported by providers that support live discovery (for example Codex ACP). */
  thinkingOptions?: ThinkingOption[];
  inputPrice?: number; // $/1M tokens
  outputPrice?: number;
}

// Not every provider accepts the same effort values. The capability registry
// limits the composer to the values that are valid for the selected model.
export type ThinkingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ThinkingOption {
  id: Exclude<ThinkingEffort, 'off'>;
  label: string;
  description: string;
}

export interface ProviderConfig {
  id: string;
  presetId?: string;
  name: string;
  baseUrl: string;
  apiKey?: string; // never sent to renderer; presence implied by hasApiKey
  hasApiKey?: boolean; // renderer-safe indicator
  models: ProviderModel[];
  enabled: boolean;
  customHeaders?: Record<string, string>;
  modelsFetchedAt?: number;
}

export interface ProviderFallback {
  providerId: string;
  model: string;
}

interface McpServerConfigBase {
  id: string;
  name: string;
  enabled: boolean;
  timeoutMs?: number;
  trust?: boolean;
  env?: Record<string, string>; // write-only; values are never returned to renderer
  envKeys?: string[];
}

export interface StdioMcpServerConfig extends McpServerConfigBase {
  transport?: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  url?: never;
  bearerToken?: never;
  hasBearerToken?: never;
  clearBearerToken?: never;
}

export interface HttpMcpServerConfig extends McpServerConfigBase {
  transport: 'http';
  url: string;
  bearerToken?: string; // write-only; encrypted before persistence
  hasBearerToken?: boolean;
  clearBearerToken?: boolean;
  command?: never;
  args?: never;
  cwd?: never;
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  error?: string;
  tools: ToolDefinition[];
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string; arguments?: unknown[] }[];
}

export interface BrowserBridgeStatus {
  enabled: boolean;
  port: number;
  pairingCode?: string;
  paired: boolean;
}

export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  repo: string;
  license: string;
  runtime: 'node' | 'python' | 'http';
  install:
    | { transport?: 'stdio'; command: string; args: string[] }
    | { transport: 'http'; url: string };
  requiresConfig?: string;
  category: string;
  local: boolean;
  windows: boolean;
  stars?: number;
  verified?: string;
  tags?: string[];
}

export interface McpRegistry {
  version: number;
  updatedAt: string;
  description?: string;
  notes?: string[];
  servers: McpRegistryEntry[];
}

// Composer agent — a named persona (system prompt preset) selectable in the
// composer toolbar. Built-ins live in shared/agents.ts; custom ones persist in
// AppSettings.customAgents.
export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  description?: string;
  builtin?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  slashCommand: string; // e.g. "/commit"
  prompt: string;
  enabled: boolean;
  builtin?: boolean;
  category?: string;
  sourceDir?: string;
}

export interface McpImportPreview {
  token: string;
  sourceName: string;
  servers: Array<{
    id: string;
    name: string;
    transport: 'stdio' | 'http';
    endpoint: string;
    envKeys: string[];
    conflict: boolean;
  }>;
  warnings: string[];
}

export type McpImportPickResult =
  | { ok: true; preview: McpImportPreview }
  | { ok: false; cancelled?: boolean; error?: string };

export type McpImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string };

export interface SkillImportPreview {
  sourceDir: string;
  name: string;
  description: string;
  slashCommand: string;
  prompt: string;
  warnings: string[];
}

export type SkillImportPickResult =
  | { ok: true; preview: SkillImportPreview }
  | { ok: false; cancelled?: boolean; error?: string };

export type SkillImportResult =
  | { ok: true; skill: Skill }
  | { ok: false; error: string };

// Reusable prompt template (Prompt Library). Inserted via the "#" composer
// trigger; {{clipboard}} and {{date}} interpolate at insert time.
export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  icon: string;
  color?: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerId: string;
  model: string;
  systemPrompt?: string;
  pinned?: boolean;
  archived?: boolean;
  projectId?: string;
  parentId?: string;
  totalTokens?: number;
  messageCount: number;
  preview?: string;
  compactionCount?: number;
  lastCompactionAt?: number;
  tokensSavedByCompaction?: number;
}

export interface PermissionRule {
  id: string;
  toolName: string; // 'bash' | 'write_file' | 'mcp:server.tool' | '*'
  pattern?: string; // glob or regex
  action: 'allow' | 'deny' | 'ask';
  scope?: 'project' | 'global';
  projectPath?: string;
}

export type SwarmMode = 'research' | 'build';
export type SwarmRunStatus =
  | 'queued' | 'running' | 'verifying' | 'synthesizing'
  | 'awaiting_apply' | 'applying' | 'completed' | 'failed' | 'aborted'
  | 'interrupted' | 'applied';
export type SwarmTaskPhase = 'worker' | 'verifier' | 'synthesizer';
export type SwarmTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';

export interface SwarmTask {
  id: string;
  runId: string;
  phase: SwarmTaskPhase;
  index: number;
  status: SwarmTaskStatus;
  output?: string;
  error?: string;
  worktreePath?: string;
  branchName?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface SwarmRun {
  id: string;
  conversationId?: string;
  projectId?: string;
  prompt: string;
  mode: SwarmMode;
  status: SwarmRunStatus;
  providerId: string;
  model: string;
  workerCount: number;
  repoRoot?: string;
  baseBranch?: string;
  baseHead?: string;
  integrationBranch?: string;
  integrationPath?: string;
  integrationHead?: string;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  tasks: SwarmTask[];
}

export interface SwarmStartRequest {
  prompt: string;
  mode: SwarmMode;
  providerId: string;
  model: string;
  conversationId?: string;
  projectId?: string;
  workerCount?: number;
}

export interface SwarmProgressEvent { run: SwarmRun }

export type ToolApprovalMode = 'always' | 'session' | 'project' | 'never';

export function normalizeToolApprovalMode(value: unknown): ToolApprovalMode {
  return value === 'session' || value === 'project' || value === 'never' ? value : 'always';
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  interfaceFont?: 'inter' | 'system' | 'serif' | 'mono';
  codeFont?: 'jetbrains-mono' | 'fira-code' | 'consolas' | 'mono';
  interfaceFontSize?: number;
  terminalFontSize?: number;
  spacingDensity?: number;
  inputBarOffset?: number;
  sendOnEnter: boolean;
  showTokenUsage: boolean;
  showReasoning: boolean;
  autoTitle: boolean;
  defaultProviderId?: string;
  defaultModelId?: string;
  providerFallbackChain?: ProviderFallback[];
  favouriteModels?: string[]; // entries are "providerId:modelId"
  maxConcurrentToolCalls: number;
  /** Maximum model → tools → model cycles for one submitted task (1–50). */
  maxAgenticRounds: number;
  toolApprovalMode: ToolApprovalMode;
  workingDirectory?: string;
  codeFolder?: string; // last folder opened in the Code tab explorer (persists across sessions)
  codeTheme?: 'vscode' | 'onedark' | 'dracula' | 'monokai'; // editor syntax theme
  accentColor?: string; // hex override for the accent colour (empty = theme default)
  customCss?: string; // user CSS injected after app styles
  themePreset?: string; // preset theme name (e.g., 'solarized', 'nord', 'catppuccin', 'gruvbox')
  telemetry: boolean;
  experimentalFeatures: boolean;
  agentModeEnabled?: boolean;
  // Composer (per-session, but persists in settings)
  composerFocusMode?: boolean;
  composerPlanMode?: boolean;
  composerAgent?: string; // agent id: "default", "explore", "review", or a custom agent's id
  customAgents?: AgentDefinition[]; // user-defined composer agents (personas)
  composerReasoning?: ThinkingEffort;
  microphoneDeviceId?: string;
  voiceNotificationSounds?: boolean;
  voiceNotificationVolume?: number;
  desktopNotifications?: boolean; // native OS notification when a response finishes in the background (default true)
  voiceSttEndpoint?: string;
  // Composer spellcheck
  spellcheckEnabled?: boolean; // default true
  spellcheckLanguage?: string; // default 'en'
  // Focus mode extras
  focusModeTimerMinutes?: number; // default 25 (0 = off)
  focusModeWordGoal?: number; // default 0 (off)
  // Text-to-speech
  ttsEnabled?: boolean; // default false
  ttsVoiceUri?: string; // preferred voice URI
  // Local Whisper.cpp speech-to-text
  whisperEnabled?: boolean; // auto-start local server with the app (default true)
  whisperModel?: string; // model filename, e.g. "ggml-base.en.bin"
  // Usage budget alerts
  dailyTokenBudget?: number; // 0 = off
  monthlyTokenBudget?: number; // 0 = off
}

export type Attachment = StoredAttachment;

export interface Artifact {
  id: string;
  conversationId: string;
  messageId: string;
  type: 'code' | 'html' | 'svg' | 'react' | 'mermaid' | 'markdown';
  language?: string;
  title?: string;
  content: string;
  createdAt: number;
}

// Aggregated token usage for the dashboard (per model, per period)
export interface UsageModelRow {
  model: string;
  provider: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageStats {
  today: UsageModelRow[];
  week: UsageModelRow[];
  month: UsageModelRow[];
}

export interface SearchResult {
  conversationId: string;
  messageId: string;
  role: Role;
  snippet: string;
  score: number;
}

// IPC channel constants
export const IPC = {
  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_QUEUE_MESSAGE: 'chat:queue-message',
  CHAT_STREAM: 'chat:stream', // event from main -> renderer

  // Native swarm
  SWARM_START: 'swarm:start',
  SWARM_GET: 'swarm:get',
  SWARM_LIST: 'swarm:list',
  SWARM_ABORT: 'swarm:abort',
  SWARM_RESUME: 'swarm:resume',
  SWARM_APPLY: 'swarm:apply',
  SWARM_PROGRESS: 'swarm:progress',

  // Conversations
  CONV_LIST: 'conv:list',
  CONV_GET: 'conv:get',
  CONV_CREATE: 'conv:create',
  CONV_UPDATE: 'conv:update',
  CONV_DELETE: 'conv:delete',
  CONV_SEARCH: 'conv:search',
  CONV_FORK: 'conv:fork',
  CONV_REVERT: 'conv:revert',
  CONV_COMPACT: 'conv:compact',
  CONV_COMPACTED: 'conv:compacted',
  CONV_TITLE_GENERATED: 'conv:title-generated',

  // Usage / cost dashboard
  USAGE_STATS: 'usage:stats',

  // Message bookmarks
  MSG_BOOKMARK: 'msg:bookmark',
  MSG_UPDATE: 'msg:update',
  MSG_DELETE: 'msg:delete',
  BOOKMARK_LIST: 'bookmark:list',

  // Providers
  PROVIDER_LIST: 'provider:list',
  PROVIDER_SAVE: 'provider:save',
  PROVIDER_DELETE: 'provider:delete',
  PROVIDER_TEST: 'provider:test',
  PROVIDER_MODELS: 'provider:models',
  PROVIDER_REFRESH_MODELS: 'provider:refreshModels',
  PROVIDER_PROBE_MODELS: 'provider:probeModels',
  PROVIDER_MODELS_UPDATED: 'provider:models-updated', // event

  // MCP
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_DELETE: 'mcp:delete',
  MCP_CONNECT: 'mcp:connect',
  MCP_DISCONNECT: 'mcp:disconnect',
  MCP_STATUS: 'mcp:status',
  MCP_CHANGED: 'mcp:changed', // event
  MCP_REGISTRY: 'mcp:registry',
  MCP_IMPORT_PICK: 'mcp:import-pick',
  MCP_IMPORT: 'mcp:import',

  // Skills
  SKILL_LIST: 'skill:list',
  SKILL_SAVE: 'skill:save',
  SKILL_DELETE: 'skill:delete',
  SKILL_RESCAN: 'skill:rescan',
  SKILL_OPEN_DIR: 'skill:open-dir',
  SKILL_IMPORT_PICK: 'skill:import-pick',
  SKILL_IMPORT: 'skill:import',

  // Prompt library
  PROMPT_LIST: 'prompt:list',
  PROMPT_SAVE: 'prompt:save',
  PROMPT_DELETE: 'prompt:delete',

  // Projects
  PROJECT_LIST: 'project:list',
  PROJECT_SAVE: 'project:save',
  PROJECT_DELETE: 'project:delete',

  // Tools
  TOOL_LIST: 'tool:list',
  TOOL_PERMISSION_DECIDE: 'tool:permission:decide',
  TOOL_PERMISSION_REQUEST: 'tool:permission:request', // event

  // FS / Shell
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  FS_LIST: 'fs:list',
  FS_EXISTS: 'fs:exists',
  FS_MKDIR: 'fs:mkdir',
  FS_PICK_DIRECTORY: 'fs:pickDirectory',
  FS_PICK_FILE: 'fs:pickFile',
  FS_GLOB: 'fs:glob',
  SHELL_RUN: 'shell:run',
  TERMINAL_EXEC: 'terminal:exec',
  TERMINAL_DISPOSE: 'terminal:dispose',
  GH_FETCH_URL: 'gh:fetchUrl',

  // Agent mode (in-page GUI agent)
  AGENT_PROXY_START: 'agent:proxy-start',
  AGENT_PROXY_STOP: 'agent:proxy-stop',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Attachments
  ATTACH_FROM_FILE: 'attach:fromFile',

  // Artifacts (Vision workspace)
  ARTIFACT_SAVE: 'artifact:save',
  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_DELETE: 'artifact:delete',
  ARTIFACT_UPDATE: 'artifact:update',
  VISION_EXPORT: 'vision:export',
  VISION_OPEN_EXTERNAL: 'vision:openExternal',

  // App
  APP_OPEN_EXTERNAL: 'app:openExternal',
  APP_PLATFORM: 'app:platform',
  APP_VERSION: 'app:version',
  INTEGRATION_LIST: 'integration:list',
  INTEGRATION_START: 'integration:start',
  INTEGRATION_STOP: 'integration:stop',
  INTEGRATION_CHANGED: 'integration:changed', // event
  BROWSER_BRIDGE_SET_ENABLED: 'browserBridge:setEnabled',
  BROWSER_BRIDGE_STATUS: 'browserBridge:status',
  BROWSER_BRIDGE_REVOKE: 'browserBridge:revoke',
  BROWSER_BRIDGE_BIND: 'browserBridge:bind',
  BROWSER_BRIDGE_SELECTION: 'browserBridge:selection',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',

  // Whisper (local speech-to-text)
  WHISPER_STATUS: 'whisper:status',
  WHISPER_TRANSCRIBE: 'whisper:transcribe',
  WHISPER_START: 'whisper:start',
  WHISPER_STOP: 'whisper:stop',
  WHISPER_STATUS_CHANGED: 'whisper:status-changed', // event

  // Simulator (DERO blockchain simulator)
  SIMULATOR_STATUS: 'simulator:status',
  SIMULATOR_START: 'simulator:start',
  SIMULATOR_STOP: 'simulator:stop',
  SIMULATOR_RESTART: 'simulator:restart',
  SIMULATOR_OUTPUT: 'simulator:output',          // event: { stream, data }
  SIMULATOR_STATUS_CHANGED: 'simulator:status-changed' // event
} as const;

export interface WhisperStatus {
  installed: boolean; // binary + model present on disk
  running: boolean;
  loading: boolean;
  port: number | null;
  model: string | null;
  models: string[];
  error: string | null;
}

export interface SimulatorStatus {
  installed: boolean; // simulator binary found on disk
  running: boolean;
  starting: boolean;
  pid: number | null;
  binaryPath: string | null;
  args: string[];
  cwd: string | null;
  startedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface SimulatorStartOptions {
  binaryPath?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type IntegrationId = 'hologram' | 'purewolf' | 'hermes';
export type IntegrationKind = 'desktop-sidecar' | 'native-host' | 'gateway';
export type IntegrationLaunchMode = 'managed' | 'browser' | 'external';

export interface IntegrationStatus {
  id: IntegrationId;
  name: string;
  kind: IntegrationKind;
  launchMode: IntegrationLaunchMode;
  optional: true;
  installed: boolean;
  running: boolean;
  pid: number | null;
  binaryPath: string | null;
  endpoint: string | null;
  error: string | null;
}

export type IpcChannel = typeof IPC[keyof typeof IPC];
