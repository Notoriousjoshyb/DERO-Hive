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
  if (artifact.type === 'mermaid') {
    return <iframe srcDoc={wrapMermaidInHtml(artifact.content)} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" title={artifact.title || 'diagram'} />;
  }
  if (artifact.type === 'react') {
    return <iframe srcDoc={wrapReactInHtml(artifact.content)} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" title={artifact.title || 'preview'} />;
  }
  return (
    <pre className="p-4 text-xs font-mono text-fg bg-bg overflow-auto h-full">
      <code>{artifact.content}</code>
    </pre>
  );
}

function wrapMermaidInHtml(diagram: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:white;color:#222;padding:12px;display:flex;justify-content:center;}</style></head>
<body>
<pre class="mermaid">${escapeHtml(diagram)}</pre>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });
</script>
</body></html>`;
}

// React previews run in a sandboxed iframe: React UMD + babel-standalone
// transpile the JSX in-browser. Requires internet access for the CDN scripts.
function wrapReactInHtml(code: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:white;color:#222;padding:12px;}#err{color:#b91c1c;font:12px ui-monospace,monospace;white-space:pre-wrap;}</style>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head><body><div id="root"></div><div id="err"></div>
<script>
window.addEventListener('error', (e) => { document.getElementById('err').textContent = String(e.message || e.error); });
</script>
<script type="text/babel" data-presets="react">
const { useState, useEffect, useMemo, useRef, useCallback, useReducer, Fragment } = React;
${transformReact(code)}
const __Component =
  (typeof __export !== 'undefined' && __export) ||
  (typeof App !== 'undefined' && App) ||
  (typeof Component !== 'undefined' && Component) ||
  null;
const __root = ReactDOM.createRoot(document.getElementById('root'));
if (__Component) __root.render(React.createElement(__Component));
else document.getElementById('err').textContent = 'No component found — export default a component or name it App.';
</script>
</body></html>`;
}

// Strip module syntax so the code runs as a plain babel script: imports are
// satisfied by the UMD globals above; the default export becomes __export.
function transformReact(code: string): string {
  return code
    .replace(/^import\s+[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+function\s+(\w+)/m, 'function $1')
    .replace(/^export\s+default\s+/m, 'const __export = ')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}