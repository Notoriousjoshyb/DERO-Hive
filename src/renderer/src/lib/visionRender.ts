// Build self-contained HTML documents for Vision previews (iframe srcdoc) and
// for "open in browser" sharing. React/mermaid/markdown wrappers pull their
// runtime from CDNs, so those two need internet access.

export type VisionRenderable = {
  type: 'code' | 'html' | 'svg' | 'react' | 'mermaid' | 'markdown';
  content: string;
  title?: string;
};

// Full HTML document for a renderable artifact; null when the type has no
// visual form (plain code) and should be shown as text instead.
export function renderVisionHtml(a: VisionRenderable): string | null {
  switch (a.type) {
    case 'html': return a.content;
    case 'svg': return wrapSvg(a.content);
    case 'mermaid': return wrapMermaid(a.content);
    case 'react': return wrapReact(a.content);
    case 'markdown': return wrapMarkdown(a.content, a.title);
    default: return null;
  }
}

function wrapSvg(svg: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:white;}body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}svg{max-width:100%;max-height:100%;}</style></head>
<body>${svg}</body></html>`;
}

function wrapMermaid(diagram: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:white;color:#222;padding:16px;display:flex;justify-content:center;}</style></head>
<body>
<pre class="mermaid">${escapeHtml(diagram)}</pre>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });
</script>
</body></html>`;
}

// React previews: React UMD + babel-standalone transpile the JSX in-browser.
function wrapReact(code: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui;background:white;color:#222;}#err{color:#b91c1c;font:12px ui-monospace,monospace;white-space:pre-wrap;padding:12px;}</style>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head><body><div id="root"></div><div id="err"></div>
<script>
window.addEventListener('error', (e) => { document.getElementById('err').textContent = String(e.message || e.error); });
</script>
<script type="text/babel" data-presets="react">
const { useState, useEffect, useMemo, useRef, useCallback, useReducer, useContext, createContext, Fragment } = React;
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

// Documents: marked renders the markdown; styling approximates a clean
// GitHub-like reading view so exports look like finished documents.
function wrapMarkdown(md: string, title?: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title || 'Document')}</title>
<style>
body{margin:0;background:white;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;line-height:1.6;}
main{max-width:780px;margin:0 auto;padding:32px 24px;}
h1,h2{border-bottom:1px solid #d1d9e0;padding-bottom:.3em;}
code{background:#f0f1f2;padding:.15em .35em;border-radius:4px;font:.9em ui-monospace,monospace;}
pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow-x:auto;}
pre code{background:none;padding:0;}
table{border-collapse:collapse;}th,td{border:1px solid #d1d9e0;padding:5px 12px;}
blockquote{border-left:4px solid #d1d9e0;margin-left:0;padding-left:14px;color:#59636e;}
img{max-width:100%;}
</style>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
</head><body><main id="doc"></main>
<script>
const src = ${JSON.stringify(md)};
document.getElementById('doc').innerHTML = marked.parse(src);
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
