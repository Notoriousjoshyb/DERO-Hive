import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { Artifact } from '@shared/types';

export function CanvasPanel(): JSX.Element {
  const currentId = useAppStore((s) => s.currentConversationId);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentId) { setArtifacts([]); return; }
    void window.hive.artifactList(currentId).then(setArtifacts);
  }, [currentId]);

  useEffect(() => {
    if (artifacts.length > 0 && !activeId) setActiveId(artifacts[0].id);
    if (artifacts.length === 0) setActiveId(null);
  }, [artifacts, activeId]);

  const active = artifacts.find((a) => a.id === activeId);

  return (
    <aside data-canvas-panel className="w-[480px] bg-bg-sidebar border-l border-border flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">Canvas</span>
        <button onClick={() => useAppStore.getState().toggleCanvas()} className="text-fg-muted hover:text-fg">×</button>
      </div>
      {artifacts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-fg-subtle text-sm px-8 text-center">
          Artifacts from the assistant's responses will appear here.
          <br /><br />
          Ask for code, HTML, SVG, or React components.
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto bg-white">
            {active && <ArtifactPreview artifact={active} />}
          </div>
          <div className="border-t border-border overflow-x-auto p-1 flex gap-1 max-h-24">
            {artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() => setActiveId(a.id)}
                className={`flex-shrink-0 px-2 py-1 rounded text-[10px] uppercase tracking-wide ${a.id === activeId ? 'bg-accent text-white' : 'bg-bg-elev text-fg-muted hover:text-fg'}`}
              >
                {a.type}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function ArtifactPreview({ artifact }: { artifact: Artifact }): JSX.Element {
  if (artifact.type === 'svg') {
    return (
      <iframe
        srcDoc={artifact.content}
        sandbox=""
        className="w-full h-full border-0 bg-white"
        title={artifact.title || 'svg'}
      />
    );
  }
  if (artifact.type === 'html') {
    const srcDoc = artifact.content.replace(/<\/script>/g, '<\\/script>');
    return (
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="w-full h-full border-0 bg-white"
        title={artifact.title || 'preview'}
      />
    );
  }
  if (artifact.type === 'react' || artifact.type === 'mermaid') {
    // Render React with esm.sh CDN; mermaid could be lazy loaded
    const html = wrapReactInHtml(artifact.content);
    return <iframe srcDoc={html} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" title={artifact.title || 'preview'} />;
  }
  return (
    <pre className="p-4 text-xs font-mono text-fg bg-bg overflow-auto h-full">
      <code>{artifact.content}</code>
    </pre>
  );
}

function wrapReactInHtml(code: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:white;color:#222;padding:12px;}</style>
<script type="module">
import React, { useState } from 'https://esm.sh/react@18';
import { createRoot } from 'https://esm.sh/react-dom@18/client';
window.React = React; window.useState = useState;
</script>
<script type="module">
const { useState } = window.React;
const e = React.createElement;
${transformReact(code)}
const root = createRoot(document.getElementById('root'));
root.render(e(App));
</script>
</head><body><div id="root"></div></body></html>`;
}

// Naive: strip "import" lines and replace JSX-free patterns. For full safety
// users should preview raw code via the toolbar.
function transformReact(code: string): string {
  return code
    .replace(/^import\s+.*?from\s+['"][^'"]+['"];?$/gm, '')
    .replace(/^export\s+default\s+/m, 'const __export = ');
}