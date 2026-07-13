import assert from 'node:assert/strict';
import { artifactGroupKey, artifactLabel } from './artifacts';
import { renderVisionHtml } from './visionRender';

const html = '<main>Hello</main>';
assert.equal(renderVisionHtml({ type: 'html', content: html }), html);
assert.equal(renderVisionHtml({ type: 'code', content: 'const answer = 42;' }), null);

const svgPreview = renderVisionHtml({ type: 'svg', content: '<svg><title>Chart</title></svg>' });
assert.ok(svgPreview?.includes('<body><svg><title>Chart</title></svg></body>'));

const mermaidPreview = renderVisionHtml({ type: 'mermaid', content: 'graph TD\nA-->B & C' });
assert.ok(mermaidPreview?.includes('A--&gt;B &amp; C'));
assert.ok(mermaidPreview?.includes("mermaid@11/dist/mermaid.esm.min.mjs"));

const reactPreview = renderVisionHtml({
  type: 'react',
  content: "import React from 'react';\nexport default function Card() { return <div />; }"
});
assert.ok(reactPreview?.includes('function Card()'));
assert.ok(!reactPreview?.includes("import React from 'react'"));

const markdownPreview = renderVisionHtml({ type: 'markdown', title: 'A < B', content: '# Hello' });
assert.ok(markdownPreview?.includes('<title>A &lt; B</title>'));
assert.ok(markdownPreview?.includes('const src = "# Hello";'));

assert.equal(artifactGroupKey({ type: 'html', title: '  Landing Page  ' }), 'html|landing page');
assert.equal(artifactGroupKey({ type: 'svg' }), 'svg|');
assert.equal(artifactLabel({ type: 'mermaid' }), 'Diagram');
assert.equal(artifactLabel({ type: 'html', title: 'Dashboard' }), 'Dashboard');
assert.equal(artifactLabel({ type: 'unknown' }), 'unknown');
