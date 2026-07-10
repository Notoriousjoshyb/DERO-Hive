import { useAppStore } from '../../stores/app';

function Row({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return <div className="flex items-start justify-between gap-3"><span className="text-fg-subtle">{label}</span><span className="font-medium text-right break-all">{value}</span></div>;
}

export function ContextPanel(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
  const conversations = useAppStore((s) => s.conversations);
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const currentMessages = useAppStore((s) => s.currentMessages);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const planMode = useAppStore((s) => s.composerPlanMode);
  const mcpStatuses = useAppStore((s) => s.mcpStatuses);

  const conversation = conversations.find((c) => c.id === currentConversationId);
  const project = projects.find((p) => p.id === conversation?.projectId);
  const provider = providers.find((p) => p.id === selectedProviderId);

  return (
    <div className="p-3 space-y-4 text-xs">
      <section>
        <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Active context</div>
        <div className="px-2 py-2 bg-bg-elev rounded space-y-1.5">
          <Row label="Provider" value={provider?.name || 'None'} />
          <Row label="Model" value={selectedModel || 'None'} />
          <Row label="Project" value={project ? `${project.icon} ${project.name}` : 'Global chat'} />
          {(project?.path || settings.workingDirectory) && <Row label="Directory" value={project?.path || settings.workingDirectory} />}
          <Row label="Messages" value={currentMessages.length} />
        </div>
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Instruction layers</div>
        <div className="px-2 py-2 bg-bg-elev rounded space-y-1.5">
          <Row label="Hive core" value="Active" />
          <Row label="Conversation" value={conversation?.systemPrompt ? 'Custom' : 'Default'} />
          <Row label="Project context" value={project ? 'Active' : 'None'} />
          <Row label="Plan mode" value={planMode ? 'Active' : 'Off'} />
          <Row label="Approvals" value={settings.toolApprovalMode === 'session' ? 'Once per chat' : settings.toolApprovalMode === 'never' ? 'Never ask' : 'Always ask'} />
        </div>
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">MCP servers</div>
        <div className="space-y-1">
          {mcpStatuses.length === 0 && <div className="px-2 py-2 bg-bg-elev rounded text-fg-subtle">No MCP servers configured</div>}
          {mcpStatuses.map((server) => (
            <div key={server.id} className="px-2 py-2 bg-bg-elev rounded">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{server.name}</span>
                <span className={server.connected ? 'text-success' : 'text-danger'}>{server.connected ? 'Connected' : 'Offline'}</span>
              </div>
              <div className="text-fg-subtle mt-0.5">{server.tools.length} tools</div>
              {server.error && <div className="text-danger mt-1 break-words">{server.error}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
