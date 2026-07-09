// Shared types between main, preload, and renderer

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }
  | { type: 'file'; file: { filename: string; data: string; mimeType: string } };

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
  systemPrompt?: string;
  stream?: boolean;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
  planMode?: boolean;
  toolApprovalModeOverride?: 'always' | 'project' | 'never';
  attachments?: { type: 'image' | 'audio' | 'pdf' | 'file'; filename: string; mimeType: string; data: string }[];
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
  inputPrice?: number; // $/1M tokens
  outputPrice?: number;
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

// MCP server config (matches Claude Desktop format)
export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  trust?: boolean; // skip tool confirmations
}

export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  error?: string;
  tools: ToolDefinition[];
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string; arguments?: unknown[] }[];
}

// Bundled server registry (resources/mcp-registry.json) shown in the Discover tab
export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  repo: string;
  license: string;
  runtime: 'node' | 'python';
  install: { command: string; args: string[] };
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

export interface Skill {
  id: string;
  name: string;
  description: string;
  slashCommand: string; // e.g. "/commit"
  prompt: string;
  enabled: boolean;
  builtin?: boolean;
  category?: string;
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
  favouriteModels?: string[]; // entries are "providerId:modelId"
  maxConcurrentToolCalls: number;
  toolApprovalMode: 'always' | 'project' | 'never';
  workingDirectory?: string;
  codeFolder?: string; // last folder opened in the Code tab explorer (persists across sessions)
  codeTheme?: 'vscode' | 'onedark' | 'dracula' | 'monokai'; // editor syntax theme
  telemetry: boolean;
  experimentalFeatures: boolean;
  // Composer (per-session, but persists in settings)
  composerFocusMode?: boolean;
  composerPlanMode?: boolean;
  composerAgent?: string; // "default" | other
  composerReasoning?: 'off' | 'low' | 'medium' | 'high';
  microphoneDeviceId?: string;
  voiceNotificationSounds?: boolean;
  voiceNotificationVolume?: number;
  voiceSttEndpoint?: string;
  // Local Whisper.cpp speech-to-text
  whisperEnabled?: boolean; // auto-start local server with the app (default true)
  whisperModel?: string; // model filename, e.g. "ggml-base.en.bin"
}

export interface Attachment {
  id: string;
  type: 'image' | 'audio' | 'pdf' | 'file';
  filename: string;
  mimeType: string;
  size: number;
  // base64 data
  data: string;
}

export interface Artifact {
  id: string;
  conversationId: string;
  messageId: string;
  type: 'code' | 'html' | 'svg' | 'react' | 'mermaid';
  language?: string;
  title?: string;
  content: string;
  createdAt: number;
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
  CHAT_STREAM: 'chat:stream', // event from main -> renderer

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

  // Skills
  SKILL_LIST: 'skill:list',
  SKILL_SAVE: 'skill:save',
  SKILL_DELETE: 'skill:delete',

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

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Attachments
  ATTACH_FROM_FILE: 'attach:fromFile',

  // Artifacts
  ARTIFACT_SAVE: 'artifact:save',
  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_DELETE: 'artifact:delete',

  // App
  APP_OPEN_EXTERNAL: 'app:openExternal',
  APP_PLATFORM: 'app:platform',
  APP_VERSION: 'app:version',

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

export type IpcChannel = typeof IPC[keyof typeof IPC];