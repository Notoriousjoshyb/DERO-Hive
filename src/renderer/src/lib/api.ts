import type {
  ChatRequest,
  Conversation,
  Message,
  McpServerConfig,
  McpServerStatus,
  ProviderConfig,
  ProviderModel,
  ProviderPreset,
  Project,
  Skill,
  AppSettings,
  Artifact,
  ToolDefinition,
  StreamEvent,
  WhisperStatus,
  SimulatorStatus,
  SimulatorStartOptions
} from '@shared/types';

declare global {
  interface Window {
    hive: {
      chatSend: (req: ChatRequest & { attachments?: Array<{ type: string; filename: string; mimeType: string; data: string }> }) => Promise<{ messageId: string }>;
      chatAbort: (id: string) => Promise<{ ok: boolean }>;
      onChatStream: (cb: (e: StreamEvent) => void) => () => void;

      convList: () => Promise<Conversation[]>;
      convGet: (id: string) => Promise<(Conversation & { messages: Message[] }) | null>;
      convCreate: (data: Partial<Conversation>) => Promise<{ id: string }>;
      convUpdate: (id: string, data: Partial<Conversation>) => Promise<{ ok: boolean }>;
      convDelete: (id: string) => Promise<{ ok: boolean }>;
      convSearch: (q: string) => Promise<Array<{ conversationId: string; messageId: string; role: string; snippet: string; score: number }>>;
      convFork: (conversationId: string, messageId?: string) => Promise<{ id: string } | null>;
      convRevert: (conversationId: string, messageId: string) => Promise<{ ok: boolean; error?: string; keptCount?: number }>;
      convCompact: (conversationId: string) => Promise<{ removedCount: number; summaryText: string; beforeTokens: number; afterTokens: number; tokensSaved: number } | null>;
      onConvCompacted: (cb: (data: { conversationId: string; removedCount: number; tokensSaved: number; beforeTokens: number; afterTokens: number }) => void) => () => void;

      providerList: () => Promise<{ configured: ProviderConfig[]; presets: ProviderPreset[] }>;
      providerSave: (cfg: ProviderConfig & { apiKey?: string }) => Promise<ProviderConfig>;
      providerDelete: (id: string) => Promise<{ ok: boolean }>;
      providerTest: (id: string) => Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }>;
      providerModels: (id: string) => Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }>;
      providerRefreshModels: (id: string) => Promise<{ ok: boolean; error?: string; models?: string[]; fetchedAt?: number }>;
      providerProbeModels: (cfg: { baseUrl: string; apiKey: string; presetId?: string; customHeaders?: Record<string, string> }) =>
        Promise<{ ok: boolean; error?: string; models?: string[] }>;

      mcpList: () => Promise<McpServerConfig[]>;
      mcpSave: (cfg: McpServerConfig) => Promise<{ ok: boolean; cancelled?: boolean }>;
      mcpDelete: (id: string) => Promise<{ ok: boolean }>;
      mcpConnect: (id: string) => Promise<{ ok: boolean }>;
      mcpDisconnect: (id: string) => Promise<{ ok: boolean }>;
      mcpStatus: () => Promise<McpServerStatus[]>;
      onMcpChanged: (cb: (s: McpServerStatus[]) => void) => () => void;

      skillList: () => Promise<Skill[]>;
      skillSave: (s: Skill) => Promise<Skill>;
      skillDelete: (id: string) => Promise<{ ok: boolean }>;

      projectList: () => Promise<Project[]>;
      projectSave: (p: Project) => Promise<Project>;
      projectDelete: (id: string) => Promise<{ ok: boolean }>;

      toolList: () => Promise<ToolDefinition[]>;
      toolPermissionDecide: (rule: { requestId: string; decision: 'allow' | 'deny'; remember?: boolean }) => Promise<{ ok: boolean }>;
      onToolPermissionRequest: (cb: (req: { requestId: string; toolName: string; args: unknown; description?: string }) => void) => () => void;
      onToolResult: (cb: (data: { messageId: string; toolCallId: string; toolName?: string; result: string; isError: boolean; durationMs: number; meta?: Record<string, unknown> }) => void) => () => void;

      fsRead: (path: string, opts?: { encoding?: 'utf-8' | 'base64'; limit?: number }) => Promise<{ content: string; encoding: string; size: number }>;
      fsWrite: (path: string, content: string) => Promise<{ ok: boolean; size: number }>;
      fsList: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>>;
      fsExists: (path: string) => Promise<boolean>;
      fsMkdir: (path: string) => Promise<{ ok: boolean }>;
      fsPickDirectory: () => Promise<string | null>;
      fsPickFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
      fsGlob: (req: { root?: string; pattern: string; limit?: number }) =>
        Promise<Array<{ path: string; rel: string; filename: string; isText: boolean }>>;

      shellRun: (cmd: string, opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }) =>
        Promise<{ ok: boolean; stdout: string; stderr: string; code?: number; error?: string }>;
      terminalExec: (sessionId: string, cmd: string, cwd?: string) =>
        Promise<{ stdout: string; stderr: string; cwd: string; code: number; timedOut?: boolean }>;
      terminalDispose: (sessionId: string) => Promise<{ ok: boolean }>;

      ghFetchUrl: (url: string) =>
        Promise<{ type: 'issue' | 'pr'; number: number; title: string; state: 'open' | 'closed' | 'merged'; author: string; url: string; repo: string; body: string; labels: string[]; createdAt: string; commentCount: number } | { error: string }>;

      settingsGet: () => Promise<AppSettings>;
      settingsSet: (s: Partial<AppSettings>) => Promise<AppSettings>;

      attachFromFile: () => Promise<Array<{ type: string; filename: string; mimeType: string; data: string }> | null>;

      artifactSave: (a: { conversationId: string; messageId: string; type: string; content: string; language?: string; title?: string }) => Promise<{ id: string }>;
      artifactList: (conversationId?: string) => Promise<Artifact[]>;
      artifactDelete: (id: string) => Promise<{ ok: boolean }>;

      whisperStatus: () => Promise<WhisperStatus>;
      whisperStart: (model?: string) => Promise<WhisperStatus>;
      whisperStop: () => Promise<WhisperStatus>;
      whisperTranscribe: (wav: string, model?: string) => Promise<{ text: string } | { error: string }>;
      onWhisperStatus: (cb: (status: WhisperStatus) => void) => () => void;

      simulatorStatus: () => Promise<SimulatorStatus>;
      simulatorStart: (opts?: SimulatorStartOptions) => Promise<SimulatorStatus>;
      simulatorStop: () => Promise<SimulatorStatus>;
      simulatorRestart: (opts?: SimulatorStartOptions) => Promise<SimulatorStatus>;
      onSimulatorOutput: (cb: (e: { stream: 'stdout' | 'stderr'; data: string }) => void) => () => void;
      onSimulatorStatus: (cb: (status: SimulatorStatus) => void) => () => void;

      openExternal: (url: string) => Promise<void>;
      platform: () => Promise<NodeJS.Platform>;
      version: () => Promise<string>;

      winMinimize: () => Promise<void>;
      winMaximize: () => Promise<boolean>;
      winClose: () => Promise<void>;
      winIsMaximized: () => Promise<boolean>;

      onMenu: (cb: (action: string) => void) => () => void;
      onProjectOpened: (cb: (path: string) => void) => () => void;
      onThemeChanged: (cb: (info: { shouldUseDarkColors: boolean }) => void) => () => void;
      onModelsUpdated: (cb: (data: { id: string; models: ProviderModel[]; fetchedAt: number }) => void) => () => void;
    };
  }
}

export const api = (): Window['hive'] => window.hive;