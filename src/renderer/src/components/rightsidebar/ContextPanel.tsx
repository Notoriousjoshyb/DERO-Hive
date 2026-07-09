import { useAppStore } from '../../stores/app';

export function ContextPanel(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
  const conversations = useAppStore((s) => s.conversations);
  const settings = useAppStore((s) => s.settings);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const currentMessages = useAppStore((s) => s.currentMessages);

  const linkedProject = projects.find((p) => p.id === conversations.find((c) => c.id === currentConversationId)?.projectId);
  const projectConversations = linkedProject
    ? conversations.filter((c) => c.projectId === linkedProject.id)
    : [];

  const recentMessages = currentMessages.slice(-5);
  const hasToolCalls = currentMessages.some((m) => m.toolCalls && m.toolCalls.length > 0);

  return (
    <div className="p-3 space-y-4 text-xs">
      {linkedProject && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Current Project</div>
          <div className="flex items-center gap-2 px-2 py-1 bg-bg-elev rounded">
            <span>{linkedProject.icon}</span>
            <span className="font-medium">{linkedProject.name}</span>
          </div>
          <div className="mt-1 text-fg-subtle">
            {projectConversations.length} conversation{projectConversations.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {settings.workingDirectory && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Working Directory</div>
          <div className="px-2 py-1 bg-bg-elev rounded font-mono text-fg-subtle truncate">
            {settings.workingDirectory}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Context Summary</div>
        <div className="px-2 py-2 bg-bg-elev rounded space-y-1">
          <div className="flex justify-between">
            <span className="text-fg-subtle">Messages</span>
            <span className="font-medium">{currentMessages.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-subtle">Tool calls</span>
            <span className="font-medium">{hasToolCalls ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-subtle">Projects</span>
            <span className="font-medium">{projects.length}</span>
          </div>
        </div>
      </div>

      {recentMessages.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Recent Messages</div>
          <div className="space-y-1">
            {recentMessages.map((m) => (
              <div key={m.id} className="px-2 py-1 bg-bg-elev rounded truncate">
                <span className="text-fg-subtle mr-1">{m.role}:</span>
                <span className="text-fg">
                  {typeof m.content === 'string' ? m.content.slice(0, 50) : '[content]'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">All Projects</div>
          <div className="space-y-1">
            {projects.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1 bg-bg-elev rounded">
                <span>{p.icon}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-fg-subtle">{conversations.filter((c) => c.projectId === p.id).length}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
