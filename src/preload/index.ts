import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC, type Attachment, type BrowserBridgeActiveProject, type BrowserBridgeStatus, type ChatRequest, type Message, type StreamEvent, type McpImportPickResult, type McpImportResult, type McpServerStatus, type AppSettings, type Conversation, type Skill, type SkillImportPickResult, type SkillImportResult, type ProviderConfig, type ProviderModel, type McpServerConfig, type McpRegistry, type Project, type SwarmProgressEvent, type SwarmRun, type SwarmStartRequest, type WhisperStatus, type SimulatorStatus, type SimulatorStartOptions, type IntegrationId, type IntegrationStatus, type KnowledgeAppendRequest, type KnowledgeAutomation, type KnowledgeAutomationKind, type KnowledgeAutomationRunResult, type KnowledgeAutomationSaveRequest, type KnowledgeAutomationStatus, type KnowledgeBootstrapResult, type KnowledgeCaptureRequest, type KnowledgeCaptureResult, type KnowledgeListResult, type KnowledgeOpenRequest, type KnowledgePatchRequest, type KnowledgeReadResult, type KnowledgeRetryResult, type KnowledgeSearchHit, type KnowledgeStatus, type KnowledgeWriteResult } from '../shared/types';

// Type-safe wrapper for renderer -> main IPC
const api = {
  // Chat
  chatSend: (req: ChatRequest) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, req),
  chatQueueMessage: (conversationId: string, message: { id: string; role: 'user'; content: Message['content']; createdAt: number }) =>
    ipcRenderer.invoke(IPC.CHAT_QUEUE_MESSAGE, conversationId, message),
  chatAbort: (conversationId: string) => ipcRenderer.invoke(IPC.CHAT_ABORT, conversationId),
  onChatStream: (cb: (e: StreamEvent) => void) => {
    const listener = (_: IpcRendererEvent, data: StreamEvent) => cb(data);
    ipcRenderer.on(IPC.CHAT_STREAM, listener);
    return () => ipcRenderer.off(IPC.CHAT_STREAM, listener);
  },

  // Native swarm
  swarmStart: (req: SwarmStartRequest): Promise<SwarmRun> => ipcRenderer.invoke(IPC.SWARM_START, req),
  swarmGet: (runId: string): Promise<SwarmRun | null> => ipcRenderer.invoke(IPC.SWARM_GET, runId),
  swarmList: (limit?: number): Promise<SwarmRun[]> => ipcRenderer.invoke(IPC.SWARM_LIST, limit),
  swarmAbort: (runId: string): Promise<SwarmRun> => ipcRenderer.invoke(IPC.SWARM_ABORT, runId),
  swarmResume: (runId: string): Promise<SwarmRun> => ipcRenderer.invoke(IPC.SWARM_RESUME, runId),
  swarmApply: (runId: string): Promise<SwarmRun> => ipcRenderer.invoke(IPC.SWARM_APPLY, runId),
  onSwarmProgress: (cb: (event: SwarmProgressEvent) => void) => {
    const listener = (_: IpcRendererEvent, event: SwarmProgressEvent) => cb(event);
    ipcRenderer.on(IPC.SWARM_PROGRESS, listener);
    return () => ipcRenderer.off(IPC.SWARM_PROGRESS, listener);
  },

  // Conversations
  convList: (opts?: { archived?: boolean }) => ipcRenderer.invoke(IPC.CONV_LIST, opts),
  convGet: (id: string) => ipcRenderer.invoke(IPC.CONV_GET, id),
  convCreate: (data: Partial<Conversation>) => ipcRenderer.invoke(IPC.CONV_CREATE, data),
  convUpdate: (id: string, data: Partial<Conversation>) => ipcRenderer.invoke(IPC.CONV_UPDATE, { id, data }),
  convDelete: (id: string) => ipcRenderer.invoke(IPC.CONV_DELETE, id),
  convSearch: (q: string) => ipcRenderer.invoke(IPC.CONV_SEARCH, q),
  convRevert: (conversationId: string, messageId: string) =>
    ipcRenderer.invoke(IPC.CONV_REVERT, { conversationId, messageId }) as Promise<{ ok: boolean; error?: string; keptCount?: number }>,
  convFork: (conversationId: string, messageId?: string) => ipcRenderer.invoke(IPC.CONV_FORK, { conversationId, messageId }),
  convCompact: (conversationId: string) => ipcRenderer.invoke(IPC.CONV_COMPACT, conversationId),
  usageStats: () => ipcRenderer.invoke(IPC.USAGE_STATS),
  msgBookmark: (messageId: string, bookmarked: boolean) => ipcRenderer.invoke(IPC.MSG_BOOKMARK, { messageId, bookmarked }),
  msgUpdate: (messageId: string, content: string) => ipcRenderer.invoke(IPC.MSG_UPDATE, { messageId, content }) as Promise<{ ok: boolean; error?: string }>,
  bookmarkList: () => ipcRenderer.invoke(IPC.BOOKMARK_LIST),
  onConvCompacted: (cb: (data: { conversationId: string; removedCount: number; tokensSaved: number; beforeTokens: number; afterTokens: number }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on(IPC.CONV_COMPACTED, l);
    return () => ipcRenderer.off(IPC.CONV_COMPACTED, l);
  },
  onConvTitleGenerated: (cb: (data: { conversationId: string; title: string }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on(IPC.CONV_TITLE_GENERATED, l);
    return () => ipcRenderer.off(IPC.CONV_TITLE_GENERATED, l);
  },

  // Providers
  providerList: () => ipcRenderer.invoke(IPC.PROVIDER_LIST),
  providerSave: (cfg: ProviderConfig) => ipcRenderer.invoke(IPC.PROVIDER_SAVE, cfg),
  providerDelete: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_DELETE, id),
  providerTest: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_TEST, id),
  providerModels: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_MODELS, id),
  providerRefreshModels: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_REFRESH_MODELS, id),
  providerProbeModels: (cfg: { baseUrl: string; apiKey: string; presetId?: string; customHeaders?: Record<string, string> }) =>
    ipcRenderer.invoke(IPC.PROVIDER_PROBE_MODELS, cfg),

  // MCP
  mcpList: () => ipcRenderer.invoke(IPC.MCP_LIST),
  mcpSave: (cfg: McpServerConfig) => ipcRenderer.invoke(IPC.MCP_SAVE, cfg),
  mcpDelete: (id: string) => ipcRenderer.invoke(IPC.MCP_DELETE, id),
  mcpConnect: (id: string) => ipcRenderer.invoke(IPC.MCP_CONNECT, id),
  mcpDisconnect: (id: string) => ipcRenderer.invoke(IPC.MCP_DISCONNECT, id),
  mcpStatus: () => ipcRenderer.invoke(IPC.MCP_STATUS),
  mcpRegistry: (): Promise<McpRegistry> => ipcRenderer.invoke(IPC.MCP_REGISTRY),
  mcpImportPick: (): Promise<McpImportPickResult> => ipcRenderer.invoke(IPC.MCP_IMPORT_PICK),
  mcpImport: (token: string, replace: boolean): Promise<McpImportResult> => ipcRenderer.invoke(IPC.MCP_IMPORT, { token, replace }),
  onMcpChanged: (cb: (statuses: McpServerStatus[]) => void) => {
    const l = (_: IpcRendererEvent, d: McpServerStatus[]) => cb(d);
    ipcRenderer.on(IPC.MCP_CHANGED, l);
    return () => ipcRenderer.off(IPC.MCP_CHANGED, l);
  },

  // Skills
  skillList: () => ipcRenderer.invoke(IPC.SKILL_LIST),
  skillSave: (s: Skill) => ipcRenderer.invoke(IPC.SKILL_SAVE, s),
  skillDelete: (id: string) => ipcRenderer.invoke(IPC.SKILL_DELETE, id),
  skillRescan: (): Promise<Skill[]> => ipcRenderer.invoke(IPC.SKILL_RESCAN),
  skillOpenDir: () => ipcRenderer.invoke(IPC.SKILL_OPEN_DIR),
  skillImportPick: (): Promise<SkillImportPickResult> => ipcRenderer.invoke(IPC.SKILL_IMPORT_PICK),
  skillImport: (sourceDir: string): Promise<SkillImportResult> => ipcRenderer.invoke(IPC.SKILL_IMPORT, sourceDir),

  // Prompt library
  promptList: () => ipcRenderer.invoke(IPC.PROMPT_LIST),
  promptSave: (p: unknown) => ipcRenderer.invoke(IPC.PROMPT_SAVE, p),
  promptDelete: (id: string) => ipcRenderer.invoke(IPC.PROMPT_DELETE, id),

  // Projects
  projectList: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
  projectSave: (p: Project) => ipcRenderer.invoke(IPC.PROJECT_SAVE, p),
  projectDelete: (id: string) => ipcRenderer.invoke(IPC.PROJECT_DELETE, id),

  // Project knowledge
  knowledgeStatus: (projectId: string): Promise<KnowledgeStatus> => ipcRenderer.invoke(IPC.KNOWLEDGE_STATUS, projectId),
  knowledgeList: (projectId: string, path?: string): Promise<KnowledgeListResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_LIST, { projectId, path }),
  knowledgeRead: (projectId: string, path: string): Promise<KnowledgeReadResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_READ, { projectId, path }),
  knowledgeSearch: (projectId: string, query: string, limit?: number, contextLength?: number): Promise<KnowledgeSearchHit[]> =>
    ipcRenderer.invoke(IPC.KNOWLEDGE_SEARCH, { projectId, query, limit, contextLength }),
  knowledgeBootstrap: (projectId: string): Promise<KnowledgeBootstrapResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_BOOTSTRAP, projectId),
  knowledgeCapture: (input: KnowledgeCaptureRequest): Promise<KnowledgeCaptureResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_CAPTURE, input),
  knowledgeAppend: (input: KnowledgeAppendRequest): Promise<KnowledgeWriteResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_APPEND, input),
  knowledgePatch: (input: KnowledgePatchRequest): Promise<KnowledgeWriteResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_PATCH, input),
  knowledgeOpen: (input: KnowledgeOpenRequest): Promise<KnowledgeWriteResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_OPEN, input),
  knowledgeRetryOutbox: (projectId?: string): Promise<KnowledgeRetryResult> => ipcRenderer.invoke(IPC.KNOWLEDGE_RETRY_OUTBOX, projectId),
  knowledgeAutomationList: (projectId?: string): Promise<KnowledgeAutomation[]> => ipcRenderer.invoke(IPC.KNOWLEDGE_AUTOMATION_LIST, projectId),
  knowledgeAutomationSave: (input: KnowledgeAutomationSaveRequest): Promise<KnowledgeAutomation> => ipcRenderer.invoke(IPC.KNOWLEDGE_AUTOMATION_SAVE, input),
  knowledgeAutomationDelete: (projectId: string, kind: KnowledgeAutomationKind): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.KNOWLEDGE_AUTOMATION_DELETE, { projectId, kind }),
  knowledgeAutomationRunNow: (projectId: string, kind: KnowledgeAutomationKind): Promise<KnowledgeAutomationRunResult> =>
    ipcRenderer.invoke(IPC.KNOWLEDGE_AUTOMATION_RUN_NOW, { projectId, kind }),
  knowledgeAutomationStatus: (projectId?: string): Promise<KnowledgeAutomationStatus[]> => ipcRenderer.invoke(IPC.KNOWLEDGE_AUTOMATION_STATUS, projectId),

  // Tools
  toolList: () => ipcRenderer.invoke(IPC.TOOL_LIST),
  toolPermissionDecide: (decision: { requestId: string; decision: 'allow' | 'deny' }) =>
    ipcRenderer.invoke(IPC.TOOL_PERMISSION_DECIDE, decision),
  onToolPermissionRequest: (cb: (req: { requestId: string; toolName: string; args: unknown; description?: string }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on(IPC.TOOL_PERMISSION_REQUEST, l);
    return () => ipcRenderer.off(IPC.TOOL_PERMISSION_REQUEST, l);
  },
  onToolResult: (cb: (data: { messageId: string; toolCallId: string; toolName?: string; result: string; isError: boolean; durationMs: number; meta?: Record<string, unknown> }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on('chat:tool-result', l);
    return () => ipcRenderer.off('chat:tool-result', l);
  },

  // FS / Shell
  fsRead: (path: string, opts?: { encoding?: 'utf-8' | 'base64'; limit?: number }) =>
    ipcRenderer.invoke(IPC.FS_READ, { path, ...opts }),
  fsWrite: (path: string, content: string) => ipcRenderer.invoke(IPC.FS_WRITE, { path, content }),
  fsList: (path: string) => ipcRenderer.invoke(IPC.FS_LIST, path),
  fsExists: (path: string) => ipcRenderer.invoke(IPC.FS_EXISTS, path),
  fsMkdir: (path: string) => ipcRenderer.invoke(IPC.FS_MKDIR, path),
  fsPickDirectory: () => ipcRenderer.invoke(IPC.FS_PICK_DIRECTORY),
  fsPickFile: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke(IPC.FS_PICK_FILE, filters),
  fsGlob: (req: { root?: string; pattern: string; limit?: number }) =>
    ipcRenderer.invoke(IPC.FS_GLOB, req),
  shellRun: (cmd: string, opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }) =>
    ipcRenderer.invoke(IPC.SHELL_RUN, { cmd, ...opts }),
  terminalExec: (sessionId: string, cmd: string, cwd?: string) =>
    ipcRenderer.invoke(IPC.TERMINAL_EXEC, { sessionId, cmd, cwd }),
  terminalDispose: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_DISPOSE, sessionId),
  ghFetchUrl: (url: string) => ipcRenderer.invoke(IPC.GH_FETCH_URL, url),

  // Agent mode
  agentProxyStart: (providerId: string): Promise<{ ok: boolean; port?: number; token?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.AGENT_PROXY_START, providerId),
  agentProxyStop: () => ipcRenderer.invoke(IPC.AGENT_PROXY_STOP),

  // Settings
  settingsGet: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (s: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SET, s),

  // Attachments
  attachFromFile: (): Promise<Attachment[] | null> => ipcRenderer.invoke(IPC.ATTACH_FROM_FILE),

  // Artifacts
  artifactSave: (a: { conversationId: string; messageId: string; type: string; content: string; language?: string; title?: string }) =>
    ipcRenderer.invoke(IPC.ARTIFACT_SAVE, a),
  artifactList: (conversationId?: string) => ipcRenderer.invoke(IPC.ARTIFACT_LIST, conversationId),
  artifactDelete: (id: string) => ipcRenderer.invoke(IPC.ARTIFACT_DELETE, id),
  artifactUpdate: (a: { sourceId: string; content: string }) => ipcRenderer.invoke(IPC.ARTIFACT_UPDATE, a),
  visionExport: (a: { title?: string; type: string; language?: string; content: string }) => ipcRenderer.invoke(IPC.VISION_EXPORT, a),
  visionOpenExternal: (a: { html: string; id: string }) => ipcRenderer.invoke(IPC.VISION_OPEN_EXTERNAL, a),

  // App
  openExternal: (url: string) => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),
  platform: () => ipcRenderer.invoke(IPC.APP_PLATFORM),
  version: () => ipcRenderer.invoke(IPC.APP_VERSION),
  updateCheck: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
  updateInstall: (a: { assetUrl?: string; assetName?: string; url: string }) => ipcRenderer.invoke(IPC.UPDATE_INSTALL, a),
  browserBridgeSetEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.BROWSER_BRIDGE_SET_ENABLED, enabled) as Promise<BrowserBridgeStatus>,
  browserBridgeStatus: () => ipcRenderer.invoke(IPC.BROWSER_BRIDGE_STATUS) as Promise<BrowserBridgeStatus>,
  browserBridgeRevokePairing: () => ipcRenderer.invoke(IPC.BROWSER_BRIDGE_REVOKE) as Promise<BrowserBridgeStatus>,
  browserBridgeBind: (requestId: string, conversationId: string) => ipcRenderer.invoke(IPC.BROWSER_BRIDGE_BIND, requestId, conversationId) as Promise<{ ok: boolean }>,
  onBrowserBridgeContext: (cb: (data: { detail: string; requestId?: string; providerId?: string; model?: string }) => void) => {
    const l = (_: IpcRendererEvent, data: { detail: string; requestId?: string; providerId?: string; model?: string }) => cb(data);
    ipcRenderer.on('browser-bridge:context', l);
    return () => ipcRenderer.off('browser-bridge:context', l);
  },
  browserBridgeReportSelection: (providerId?: string, model?: string, activeProject?: BrowserBridgeActiveProject) => ipcRenderer.invoke(IPC.BROWSER_BRIDGE_SELECTION, providerId, model, activeProject) as Promise<{ ok: boolean }>,
  onBrowserBridgeSelectModel: (cb: (data: { providerId: string; model: string }) => void) => {
    const l = (_: IpcRendererEvent, data: { providerId: string; model: string }) => cb(data);
    ipcRenderer.on('browser-bridge:select-model', l);
    return () => ipcRenderer.off('browser-bridge:select-model', l);
  },

  // Whisper (local STT)
  whisperStatus: () => ipcRenderer.invoke(IPC.WHISPER_STATUS),
  whisperStart: (model?: string) => ipcRenderer.invoke(IPC.WHISPER_START, model),
  whisperStop: () => ipcRenderer.invoke(IPC.WHISPER_STOP),
  whisperTranscribe: (wav: string, model?: string) => ipcRenderer.invoke(IPC.WHISPER_TRANSCRIBE, { wav, model }),
  onWhisperStatus: (cb: (status: WhisperStatus) => void) => {
    const l = (_: IpcRendererEvent, d: WhisperStatus) => cb(d);
    ipcRenderer.on(IPC.WHISPER_STATUS_CHANGED, l);
    return () => ipcRenderer.off(IPC.WHISPER_STATUS_CHANGED, l);
  },

  // Simulator (DERO blockchain simulator)
  simulatorStatus: () => ipcRenderer.invoke(IPC.SIMULATOR_STATUS),
  simulatorStart: (opts?: SimulatorStartOptions) => ipcRenderer.invoke(IPC.SIMULATOR_START, opts),
  simulatorStop: () => ipcRenderer.invoke(IPC.SIMULATOR_STOP),
  simulatorRestart: (opts?: SimulatorStartOptions) => ipcRenderer.invoke(IPC.SIMULATOR_RESTART, opts),
  onSimulatorOutput: (cb: (e: { stream: 'stdout' | 'stderr'; data: string }) => void) => {
    const l = (_: IpcRendererEvent, d: { stream: 'stdout' | 'stderr'; data: string }) => cb(d);
    ipcRenderer.on(IPC.SIMULATOR_OUTPUT, l);
    return () => ipcRenderer.off(IPC.SIMULATOR_OUTPUT, l);
  },
  onSimulatorStatus: (cb: (status: SimulatorStatus) => void) => {
    const l = (_: IpcRendererEvent, d: SimulatorStatus) => cb(d);
    ipcRenderer.on(IPC.SIMULATOR_STATUS_CHANGED, l);
    return () => ipcRenderer.off(IPC.SIMULATOR_STATUS_CHANGED, l);
  },

  // Optional integrations
  integrationList: (): Promise<IntegrationStatus[]> => ipcRenderer.invoke(IPC.INTEGRATION_LIST),
  integrationStart: (id: IntegrationId): Promise<IntegrationStatus> => ipcRenderer.invoke(IPC.INTEGRATION_START, id),
  integrationStop: (id: IntegrationId): Promise<IntegrationStatus> => ipcRenderer.invoke(IPC.INTEGRATION_STOP, id),
  onIntegrationChanged: (cb: (status: IntegrationStatus) => void) => {
    const l = (_: IpcRendererEvent, status: IntegrationStatus) => cb(status);
    ipcRenderer.on(IPC.INTEGRATION_CHANGED, l);
    return () => ipcRenderer.off(IPC.INTEGRATION_CHANGED, l);
  },

  // Window
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winMaximize: () => ipcRenderer.invoke('window:maximize'),
  winClose: () => ipcRenderer.invoke('window:close'),
  winIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  winToggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  onFullscreenChanged: (cb: (data: { fullscreen: boolean }) => void) => {
    const l = (_: IpcRendererEvent, d: { fullscreen: boolean }) => cb(d);
    ipcRenderer.on('window:fullscreen-changed', l);
    return () => ipcRenderer.off('window:fullscreen-changed', l);
  },

  // Menu events
  onMenu: (cb: (action: string) => void) => {
    const l = (_: IpcRendererEvent, data: { action: string }) => cb(data.action);
    ipcRenderer.on('app:menu', l);
    return () => ipcRenderer.off('app:menu', l);
  },
  onProjectOpened: (cb: (path: string) => void) => {
    const l = (_: IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on('app:project-opened', l);
    return () => ipcRenderer.off('app:project-opened', l);
  },
  onThemeChanged: (cb: (info: { shouldUseDarkColors: boolean }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on('app:theme-changed', l);
    return () => ipcRenderer.off('app:theme-changed', l);
  },
  onModelsUpdated: (cb: (data: { id: string; models: ProviderModel[]; fetchedAt: number }) => void) => {
    const l = (_: IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on(IPC.PROVIDER_MODELS_UPDATED, l);
    return () => ipcRenderer.off(IPC.PROVIDER_MODELS_UPDATED, l);
  }
};

contextBridge.exposeInMainWorld('hive', api);

export type HiveApi = typeof api;
