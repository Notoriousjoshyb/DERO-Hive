import type {
  BookmarkEntry,
  BrowserBridgeStatus,
  ChatRequest,
  Attachment,
  Conversation,
  Message,
  McpImportPickResult,
  McpImportResult,
  McpServerConfig,
  McpServerStatus,
  McpRegistry,
  ProviderConfig,
  ProviderModel,
  ProviderPreset,
  Project,
  KnowledgeAppendRequest,
  KnowledgeBootstrapResult,
  KnowledgeCaptureRequest,
  KnowledgeCaptureResult,
  KnowledgeListResult,
  KnowledgeOpenRequest,
  KnowledgePatchRequest,
  KnowledgeReadResult,
  KnowledgeRetryResult,
  KnowledgeSearchHit,
  KnowledgeStatus,
  KnowledgeWriteResult,
  PromptTemplate,
  Skill,
  SkillImportPickResult,
  SkillImportResult,
  AppSettings,
  Artifact,
  ToolDefinition,
  StreamEvent,
  SearchResult,
  UsageStats,
  WhisperStatus,
  SimulatorStatus,
  SimulatorStartOptions,
  IntegrationId,
  IntegrationStatus,
  SwarmProgressEvent,
  SwarmRun,
  SwarmStartRequest
} from '@shared/types';

declare global {
  interface Window {
    hive: {
      chatSend: (req: ChatRequest) => Promise<{ messageId: string }>;
      chatQueueMessage: (conversationId: string, message: { id: string; role: 'user'; content: Message['content']; createdAt: number }) => Promise<void>;
      chatAbort: (id: string) => Promise<{ ok: boolean }>;
      onChatStream: (cb: (e: StreamEvent) => void) => () => void;
      swarmStart: (req: SwarmStartRequest) => Promise<SwarmRun>;
      swarmGet: (runId: string) => Promise<SwarmRun | null>;
      swarmList: (limit?: number) => Promise<SwarmRun[]>;
      swarmAbort: (runId: string) => Promise<SwarmRun>;
      swarmResume: (runId: string) => Promise<SwarmRun>;
      swarmApply: (runId: string) => Promise<SwarmRun>;
      onSwarmProgress: (cb: (event: SwarmProgressEvent) => void) => () => void;

      convList: (opts?: { archived?: boolean }) => Promise<Conversation[]>;
      convGet: (id: string) => Promise<(Conversation & { messages: Message[] }) | null>;
      convCreate: (data: Partial<Conversation>) => Promise<{ id: string }>;
      convUpdate: (id: string, data: Partial<Conversation>) => Promise<{ ok: boolean }>;
      convDelete: (id: string) => Promise<{ ok: boolean }>;
      convSearch: (q: string) => Promise<SearchResult[]>;
      usageStats: () => Promise<UsageStats>;
      msgBookmark: (messageId: string, bookmarked: boolean) => Promise<{ ok: boolean }>;
      msgUpdate: (messageId: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      bookmarkList: () => Promise<BookmarkEntry[]>;
      promptList: () => Promise<PromptTemplate[]>;
      promptSave: (p: PromptTemplate) => Promise<{ ok: boolean }>;
      promptDelete: (id: string) => Promise<{ ok: boolean }>;
      convFork: (conversationId: string, messageId?: string) => Promise<{ id: string } | null>;
      convRevert: (conversationId: string, messageId: string) => Promise<{ ok: boolean; error?: string; keptCount?: number }>;
      convCompact: (conversationId: string) => Promise<{ removedCount: number; summaryText: string; beforeTokens: number; afterTokens: number; tokensSaved: number } | null>;
      onConvCompacted: (cb: (data: { conversationId: string; removedCount: number; tokensSaved: number; beforeTokens: number; afterTokens: number }) => void) => () => void;
      onConvTitleGenerated: (cb: (data: { conversationId: string; title: string }) => void) => () => void;

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
      mcpRegistry: () => Promise<McpRegistry>;
      mcpImportPick: () => Promise<McpImportPickResult>;
      mcpImport: (token: string, replace: boolean) => Promise<McpImportResult>;
      onMcpChanged: (cb: (s: McpServerStatus[]) => void) => () => void;

      skillList: () => Promise<Skill[]>;
      skillSave: (s: Skill) => Promise<Skill>;
      skillDelete: (id: string) => Promise<{ ok: boolean }>;
      skillRescan: () => Promise<Skill[]>;
      skillOpenDir: () => Promise<{ ok: boolean; error?: string }>;
      skillImportPick: () => Promise<SkillImportPickResult>;
      skillImport: (sourceDir: string) => Promise<SkillImportResult>;

      agentProxyStart: (providerId: string) => Promise<{ ok: boolean; port?: number; token?: string; error?: string }>;
      agentProxyStop: () => Promise<{ ok: boolean }>;

      projectList: () => Promise<Project[]>;
      projectSave: (p: Project) => Promise<Project>;
      projectDelete: (id: string) => Promise<{ ok: boolean }>;
      knowledgeStatus: (projectId: string) => Promise<KnowledgeStatus>;
      knowledgeList: (projectId: string, path?: string) => Promise<KnowledgeListResult>;
      knowledgeRead: (projectId: string, path: string) => Promise<KnowledgeReadResult>;
      knowledgeSearch: (projectId: string, query: string, limit?: number, contextLength?: number) => Promise<KnowledgeSearchHit[]>;
      knowledgeBootstrap: (projectId: string) => Promise<KnowledgeBootstrapResult>;
      knowledgeCapture: (input: KnowledgeCaptureRequest) => Promise<KnowledgeCaptureResult>;
      knowledgeAppend: (input: KnowledgeAppendRequest) => Promise<KnowledgeWriteResult>;
      knowledgePatch: (input: KnowledgePatchRequest) => Promise<KnowledgeWriteResult>;
      knowledgeOpen: (input: KnowledgeOpenRequest) => Promise<KnowledgeWriteResult>;
      knowledgeRetryOutbox: (projectId?: string) => Promise<KnowledgeRetryResult>;

      toolList: () => Promise<ToolDefinition[]>;
      toolPermissionDecide: (rule: { requestId: string; decision: 'allow' | 'deny' }) => Promise<{ ok: boolean }>;
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

      attachFromFile: () => Promise<Attachment[] | null>;

      artifactSave: (a: { conversationId: string; messageId: string; type: string; content: string; language?: string; title?: string }) => Promise<{ id: string }>;
      artifactList: (conversationId?: string) => Promise<Artifact[]>;
      artifactDelete: (id: string) => Promise<{ ok: boolean }>;
      artifactUpdate: (a: { sourceId: string; content: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
      visionExport: (a: { title?: string; type: string; language?: string; content: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
      visionOpenExternal: (a: { html: string; id: string }) => Promise<{ ok: boolean; path?: string }>;

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

      integrationList: () => Promise<IntegrationStatus[]>;
      integrationStart: (id: IntegrationId) => Promise<IntegrationStatus>;
      integrationStop: (id: IntegrationId) => Promise<IntegrationStatus>;
      onIntegrationChanged: (cb: (status: IntegrationStatus) => void) => () => void;

      openExternal: (url: string) => Promise<void>;
      platform: () => Promise<NodeJS.Platform>;
      version: () => Promise<string>;
      updateCheck: () => Promise<{
        ok: boolean; current: string; latest?: string; updateAvailable?: boolean;
        url?: string; assetUrl?: string; assetName?: string; notes?: string;
        noReleases?: boolean; error?: string;
      }>;
      updateInstall: (a: { assetUrl?: string; assetName?: string; url: string }) => Promise<{ ok: boolean; launched?: boolean; error?: string }>;
      browserBridgeSetEnabled: (enabled: boolean) => Promise<BrowserBridgeStatus>;
      browserBridgeStatus: () => Promise<BrowserBridgeStatus>;
      browserBridgeRevokePairing: () => Promise<BrowserBridgeStatus>;
      browserBridgeBind: (requestId: string, conversationId: string) => Promise<{ ok: boolean }>;
      onBrowserBridgeContext: (cb: (data: { detail: string; requestId?: string; providerId?: string; model?: string }) => void) => () => void;
      browserBridgeReportSelection: (providerId?: string, model?: string) => Promise<{ ok: boolean }>;
      onBrowserBridgeSelectModel: (cb: (data: { providerId: string; model: string }) => void) => () => void;

      winMinimize: () => Promise<void>;
      winMaximize: () => Promise<boolean>;
      winClose: () => Promise<void>;
      winIsMaximized: () => Promise<boolean>;
      winToggleFullscreen: () => Promise<boolean>;
      onFullscreenChanged: (cb: (data: { fullscreen: boolean }) => void) => () => void;

      onMenu: (cb: (action: string) => void) => () => void;
      onProjectOpened: (cb: (path: string) => void) => () => void;
      onThemeChanged: (cb: (info: { shouldUseDarkColors: boolean }) => void) => () => void;
      onModelsUpdated: (cb: (data: { id: string; models: ProviderModel[]; fetchedAt: number }) => void) => () => void;
    };
  }
}

export const api = (): Window['hive'] => window.hive;
