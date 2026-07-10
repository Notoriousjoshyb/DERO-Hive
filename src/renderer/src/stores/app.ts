import { create } from 'zustand';
import type { AppSettings, Conversation, Message, McpServerStatus, ProviderConfig, ProviderPreset, Project, Skill, ToolDefinition, Attachment } from '@shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 'medium',
  interfaceFont: 'inter',
  codeFont: 'jetbrains-mono',
  interfaceFontSize: 120,
  terminalFontSize: 15,
  spacingDensity: 100,
  inputBarOffset: 0,
  sendOnEnter: true,
  showTokenUsage: true,
  showReasoning: true,
  autoTitle: true,
  maxConcurrentToolCalls: 4,
  toolApprovalMode: 'always',
  telemetry: false,
  experimentalFeatures: false,
  voiceNotificationSounds: true,
  voiceNotificationVolume: 0.5
};

export interface QueueItem {
  id: string;
  text: string;
  attachments: Attachment[];
  createdAt: number;
  skillName?: string;
  systemPrompt?: string;
  planMode?: boolean;
  reasoning?: 'off' | 'low' | 'medium' | 'high';
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  active_form?: string;
}

export interface CompactionEvent {
  conversationId: string;
  removedCount: number;
  tokensSaved: number;
  beforeTokens: number;
  afterTokens: number;
  at: number;
}

export interface FileChange {
  path: string;
  kind: 'write' | 'edit';
  linesAdded: number;
  linesRemoved: number;
  bytesAdded: number;
  isNewFile?: boolean;
  at: number;
}

interface PendingPermission {
  requestId: string;
  toolName: string;
  args: unknown;
  description?: string;
}

export interface ChatTurn {
  messageId: string;
  content: string;
  reasoning?: string;
  toolCalls: Message['toolCalls'];
  status: 'streaming' | 'done' | 'error';
  error?: string;
  usage?: Message['usage'];
}

interface AppState {
  // Settings
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  toggleFavourite: (providerId: string, modelId: string) => Promise<void>;

  // Providers
  providers: ProviderConfig[];
  presets: ProviderPreset[];
  loadProviders: () => Promise<void>;
  saveProvider: (cfg: ProviderConfig & { apiKey?: string }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }>;

  // Selected provider/model
  selectedProviderId?: string;
  selectedModel?: string;
  setSelection: (providerId?: string, model?: string) => void;

  // Conversations
  conversations: Conversation[];
  currentConversationId?: string;
  currentMessages: Message[];
  loadConversations: () => Promise<void>;
  selectConversation: (id?: string) => Promise<void>;
  createConversation: (data?: Partial<Conversation>) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversation: (id: string, data: Partial<Conversation>) => Promise<void>;
  forkConversation: (conversationId: string, messageId?: string) => Promise<string>;
  revertConversation: (messageId: string) => Promise<void>;
  compactConversation: () => Promise<{ removedCount: number } | null>;

  // Streaming state
  streamingMessageId?: string;
  isStreaming: boolean;
  streamingReasoning: string;
  streamingContent: string;
  chatError?: string;
  setChatError: (msg: string | null) => void;
  pendingToolResults: Map<string, { result: string; isError: boolean; durationMs: number }>;
  startStreaming: (id: string) => void;
  abortChat: () => Promise<void>;
  appendStreamDelta: (content: string) => void;
  appendStreamReasoning: (r: string) => void;
  setStreamingMessageId: (id?: string) => void;
  finishStreaming: () => void;
  recordToolResult: (messageId: string, toolCallId: string, result: string, isError: boolean, durationMs: number) => void;

  // Pending permissions
  pendingPermissions: PendingPermission[];
  addPendingPermission: (p: PendingPermission) => void;
  removePendingPermission: (requestId: string) => void;
  // Session-only "don't ask again" — auto-allows tool calls until the app
  // restarts, without touching the persisted toolApprovalMode setting.
  sessionAutoAllowTools: boolean;
  setSessionAutoAllowTools: (v: boolean) => void;

  // MCP
  mcpStatuses: McpServerStatus[];
  loadMcpStatuses: () => Promise<void>;

  // Skills
  skills: Skill[];
  loadSkills: () => Promise<void>;

  // Projects
  projects: Project[];
  loadProjects: () => Promise<void>;
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // Tools
  tools: ToolDefinition[];
  loadTools: () => Promise<void>;

  // Composer
  composerFocusMode: boolean;
  composerPlanMode: boolean;
  composerAgent: string;
  composerReasoning: 'off' | 'low' | 'medium' | 'high';
  toggleComposerFocus: () => void;
  toggleComposerPlan: () => void;
  cycleComposerReasoning: () => void;
  setComposerReasoning: (level: 'off' | 'low' | 'medium' | 'high') => void;
  setComposerAgent: (agent: string) => void;

  // Attachments for next send
  pendingAttachments: Attachment[];
  addAttachment: (a: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;

  // UI state
  sidebarOpen: boolean;
  visionOpen: boolean;
  settingsOpen: boolean;
  rightSidebarOpen: boolean;
  codeTabOpen: boolean;
  toggleSidebar: () => void;
  toggleVision: () => void;
  setVisionOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleRightSidebar: () => void;
  toggleCodeTab: () => void;
  visionTabOpen: boolean;
  toggleVisionTab: () => void;

  // Vision workspace
  artifactsChangedAt: number; // bump to make VisionPanel reload
  lastStreamFinishedAt: number; // used to auto-open Vision only for fresh responses
  notifyArtifactsChanged: () => void;

  // Task list (driven by todo_write tool calls)
  todos: TodoItem[];
  taskListExpanded: boolean;
  taskListVisible: boolean;
  setTodos: (todos: TodoItem[]) => void;
  toggleTaskListExpanded: () => void;
  setTaskListVisible: (visible: boolean) => void;
  clearTodos: () => void;

  // Compaction telemetry
  lastCompaction: CompactionEvent | null;
  compactionHistory: CompactionEvent[];
  recordCompaction: (event: Omit<CompactionEvent, 'at'>) => void;
  dismissLastCompaction: () => void;
  clearCompactionHistory: () => void;

  // File-change tracking (session-level, like a commit diff)
  fileChanges: FileChange[];
  recordFileChange: (change: Omit<FileChange, 'at'>) => void;
  clearFileChanges: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loadSettings: async () => {
    const saved = await window.hive.settingsGet();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...saved
    };
    set({
      settings,
      composerFocusMode: settings.composerFocusMode ?? false,
      composerPlanMode: settings.composerPlanMode ?? false,
      composerAgent: settings.composerAgent ?? 'default',
      composerReasoning: settings.composerReasoning ?? 'medium'
    });
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('focus-mode', settings.composerFocusMode ?? false);
    }
  },
  updateSettings: async (patch) => {
    const settings = await window.hive.settingsSet(patch);
    set({ settings });
  },

  providers: [],
  presets: [],
  loadProviders: async () => {
    const { configured, presets } = await window.hive.providerList();
    set({ providers: configured, presets });

    const cur = get();
    const settings = cur.settings;
    if (configured.length === 0) {
      if (cur.selectedProviderId || cur.selectedModel) set({ selectedProviderId: undefined, selectedModel: undefined });
      return;
    }

    let providerId = cur.selectedProviderId;
    let model = cur.selectedModel;

    // Provider missing or unselected → fall back through configured list, then settings default
    if (!providerId || !configured.find((p) => p.id === providerId)) {
      providerId = settings.defaultProviderId && configured.find((p) => p.id === settings.defaultProviderId)
        ? settings.defaultProviderId
        : configured[0].id;
    }

    const p = configured.find((pp) => pp.id === providerId)!;
    if (!p.models.find((m) => m.id === model)) {
      const defaultMatch = settings.defaultProviderId === providerId && settings.defaultModelId
        ? p.models.find((m) => m.id === settings.defaultModelId)
        : undefined;
      const first = p.models[0];
      model = (defaultMatch?.id) ?? first?.id;
    }

    if (providerId !== cur.selectedProviderId || model !== cur.selectedModel) {
      set({ selectedProviderId: providerId, selectedModel: model });
    }
  },
  saveProvider: async (cfg) => {
    await window.hive.providerSave(cfg);
    await get().loadProviders();
  },
  deleteProvider: async (id) => {
    await window.hive.providerDelete(id);
    await get().loadProviders();
    if (get().selectedProviderId === id) {
      const remaining = get().providers[0];
      set({ selectedProviderId: remaining?.id, selectedModel: remaining?.models[0]?.id });
    }
  },
  testProvider: async (id) => window.hive.providerTest(id),

  setSelection: (providerId, model) => {
    set({ selectedProviderId: providerId, selectedModel: model });
    // Persist for next session
    const state = get();
    if (model) {
      void state.updateSettings({ defaultProviderId: providerId, defaultModelId: model });
      // Also pin the choice to the open conversation so switching away and
      // back — or the post-stream refresh — keeps the model the user picked.
      const convId = state.currentConversationId;
      if (convId && providerId) {
        void window.hive.convUpdate(convId, { providerId, model }).then(() => state.loadConversations());
      }
    }
  },

  toggleFavourite: async (providerId, modelId) => {
    const state = get();
    const key = `${providerId}:${modelId}`;
    const list = state.settings.favouriteModels || [];
    const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
    await state.updateSettings({ favouriteModels: next });
  },

  conversations: [],
  currentConversationId: undefined,
  currentMessages: [],
  loadConversations: async () => {
    const conversations = await window.hive.convList();
    set({ conversations });
  },
  selectConversation: async (id) => {
    if (!id) {
      set({ currentConversationId: undefined, currentMessages: [], isStreaming: false, streamingContent: '', streamingReasoning: '', chatError: undefined });
      return;
    }
    const conv = await window.hive.convGet(id);
    if (conv) {
      // Adopt the conversation's provider/model only when actually switching
      // conversations. Re-selecting the current one (done after every stream
      // to refresh messages) must NOT clobber a model the user just picked —
      // conv.model is whatever was stored when the conversation was created.
      const switching = id !== get().currentConversationId;
      set({
        currentConversationId: id,
        currentMessages: conv.messages,
        selectedProviderId: switching ? (conv.providerId || get().selectedProviderId) : get().selectedProviderId,
        selectedModel: switching ? (conv.model || get().selectedModel) : get().selectedModel,
        isStreaming: false,
        streamingContent: '',
        streamingReasoning: '',
        chatError: undefined
      });
    }
  },
  createConversation: async (data) => {
    const { id } = await window.hive.convCreate({
      ...data,
      providerId: data?.providerId || get().selectedProviderId,
      model: data?.model || get().selectedModel
    });
    await get().loadConversations();
    await get().selectConversation(id);
    return id;
  },
  deleteConversation: async (id) => {
    await window.hive.convDelete(id);
    if (get().currentConversationId === id) {
      set({ currentConversationId: undefined, currentMessages: [] });
    }
    await get().loadConversations();
  },
  updateConversation: async (id, data) => {
    await window.hive.convUpdate(id, data);
    await get().loadConversations();
  },
  forkConversation: async (conversationId, messageId) => {
    const result = await window.hive.convFork(conversationId, messageId);
    if (!result) throw new Error('Failed to fork conversation');
    await get().loadConversations();
    await get().selectConversation(result.id);
    return result.id;
  },
  revertConversation: async (messageId) => {
    const id = get().currentConversationId;
    if (!id) return;
    const result = await window.hive.convRevert(id, messageId);
    if (!result?.ok) throw new Error(result?.error || 'Failed to revert conversation');
    await get().loadConversations();
    await get().selectConversation(id);
  },
  compactConversation: async () => {
    const id = get().currentConversationId;
    if (!id) return null;
    const result = await window.hive.convCompact(id);
    if (!result) return null;
    await get().selectConversation(id);
    return result;
  },

  isStreaming: false,
  streamingMessageId: undefined,
  streamingContent: '',
  streamingReasoning: '',
  chatError: undefined,
  setChatError: (msg) => set({ chatError: msg || undefined }),
  pendingToolResults: new Map(),
  startStreaming: (id) => set({
    isStreaming: true,
    streamingMessageId: id,
    streamingContent: '',
    streamingReasoning: '',
    chatError: undefined,
    pendingToolResults: new Map()
  }),
  abortChat: async () => {
    const id = get().currentConversationId;
    if (!id) return;
    await window.hive.chatAbort(id);
  },
  appendStreamDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
  appendStreamReasoning: (r) => set((s) => ({ streamingReasoning: s.streamingReasoning + r })),
  setStreamingMessageId: (id) => set({ streamingMessageId: id }),
  finishStreaming: () => set({
    isStreaming: false,
    streamingMessageId: undefined,
    streamingContent: '',
    streamingReasoning: '',
    lastStreamFinishedAt: Date.now()
  }),
  recordToolResult: (messageId, toolCallId, result, isError, durationMs) => {
    const map = new Map(get().pendingToolResults);
    map.set(`${messageId}:${toolCallId}`, { result, isError, durationMs });
    set({ pendingToolResults: map });
  },

  pendingPermissions: [],
  addPendingPermission: (p) => set((s) => ({ pendingPermissions: [...s.pendingPermissions, p] })),
  removePendingPermission: (requestId) =>
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.requestId !== requestId) })),
  sessionAutoAllowTools: false,
  setSessionAutoAllowTools: (v) => set({ sessionAutoAllowTools: v }),

  mcpStatuses: [],
  loadMcpStatuses: async () => {
    const mcpStatuses = await window.hive.mcpStatus();
    set({ mcpStatuses });
  },

  skills: [],
  loadSkills: async () => {
    const skills = await window.hive.skillList();
    set({ skills });
  },

  projects: [],
  loadProjects: async () => {
    const projects = await window.hive.projectList();
    set({ projects });
  },
  saveProject: async (p) => {
    // Guard against a missing id — an empty id collides on the primary key and
    // would overwrite an existing project instead of adding a new one.
    const project = p.id ? p : { ...p, id: crypto.randomUUID() };
    await window.hive.projectSave(project);
    await get().loadProjects();
  },
  deleteProject: async (id) => {
    await window.hive.projectDelete(id);
    await get().loadProjects();
  },

  tools: [],
  loadTools: async () => {
    const tools = await window.hive.toolList();
    set({ tools });
  },

  composerFocusMode: false,
  composerPlanMode: false,
  composerAgent: 'default',
  composerReasoning: 'medium',
  toggleComposerFocus: () => {
    const next = !get().composerFocusMode;
    set({ composerFocusMode: next });
    void get().updateSettings({ composerFocusMode: next });
    document.body.classList.toggle('focus-mode', next);
  },
  toggleComposerPlan: () => {
    const next = !get().composerPlanMode;
    set({ composerPlanMode: next });
    void get().updateSettings({ composerPlanMode: next });
  },
  cycleComposerReasoning: () => {
    const order: Array<'off' | 'low' | 'medium' | 'high'> = ['off', 'low', 'medium', 'high'];
    const cur = get().composerReasoning;
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length];
    set({ composerReasoning: next });
    void get().updateSettings({ composerReasoning: next });
  },
  setComposerReasoning: (level) => {
    set({ composerReasoning: level });
    void get().updateSettings({ composerReasoning: level });
  },
  setComposerAgent: (agent) => {
    set({ composerAgent: agent });
    void get().updateSettings({ composerAgent: agent });
  },

  pendingAttachments: [],
  addAttachment: (a) => set((s) => ({ pendingAttachments: [...s.pendingAttachments, a] })),
  removeAttachment: (id) => set((s) => ({ pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ pendingAttachments: [] }),

  sidebarOpen: true,
  visionOpen: false,
  settingsOpen: false,
  rightSidebarOpen: false,
  codeTabOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleVision: () => set((s) => ({ visionOpen: !s.visionOpen })),
  setVisionOpen: (open) => set({ visionOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  artifactsChangedAt: 0,
  lastStreamFinishedAt: 0,
  notifyArtifactsChanged: () => set({ artifactsChangedAt: Date.now() }),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  // Code and Vision are full-view tabs sharing the main column — exclusive.
  toggleCodeTab: () => set((s) => ({ codeTabOpen: !s.codeTabOpen, visionTabOpen: false })),
  visionTabOpen: false,
  toggleVisionTab: () => set((s) => ({ visionTabOpen: !s.visionTabOpen, codeTabOpen: false })),

  todos: [],
  taskListExpanded: false,
  taskListVisible: false,
  setTodos: (todos) => {
    const hasAny = todos.length > 0;
    // Preserve the user's expand/collapse choice — the panel shows a one-line
    // summary until they click to expand, rather than popping open on its own.
    set({
      todos,
      taskListVisible: hasAny,
      taskListExpanded: get().taskListExpanded
    });
  },
  toggleTaskListExpanded: () => set((s) => ({ taskListExpanded: !s.taskListExpanded })),
  setTaskListVisible: (visible) => set({ taskListVisible: visible }),
  clearTodos: () => set({ todos: [], taskListVisible: false }),

  lastCompaction: null,
  compactionHistory: [],
  recordCompaction: (event) => set((s) => ({
    lastCompaction: { ...event, at: Date.now() },
    compactionHistory: [...s.compactionHistory, { ...event, at: Date.now() }].slice(-50)
  })),
  dismissLastCompaction: () => set({ lastCompaction: null }),
  clearCompactionHistory: () => set({ compactionHistory: [], lastCompaction: null }),

  fileChanges: [],
  recordFileChange: (change) => set((s) => ({
    fileChanges: [...s.fileChanges, { ...change, at: Date.now() }].slice(-200)
  })),
  clearFileChanges: () => set({ fileChanges: [] })
}));