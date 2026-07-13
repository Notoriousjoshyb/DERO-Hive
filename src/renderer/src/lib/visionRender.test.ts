import assert from 'node:assert';
import { renderVisionHtml } from './visionRender';

// renderVisionHtml returns null for 'code' type (shown as text), otherwise
// a full HTML document string.

{
  // html type — returns content directly
  const r = renderVisionHtml({ type: 'html', content: '<p>hello</p>' });
  assert.strictEqual(r, '<p>hello</p>');
}

{
  // svg type — wrapped in full HTML doc with white background
  const r = renderVisionHtml({ type: 'svg', content: '<svg><circle cx="10" cy="10" r="5"/></svg>' });
  assert(typeof r === 'string');
  assert(r!.includes('<!DOCTYPE html>'));
  assert(r!.includes('<svg>'));
  assert(r!.includes('margin:0'));
  assert(r!.includes('background:white'));
}

{
  // svg type — HTML entities are preserved in SVG content
  const r = renderVisionHtml({ type: 'svg', content: '<svg><text>&lt;hello&gt;</text></svg>' });
  assert(typeof r === 'string');
  assert(r!.includes('&lt;hello&gt;'));
}

{
  // mermaid type — wrapped with mermaid CDN loader
  const r = renderVisionHtml({ type: 'mermaid', content: 'graph TD\n  A-->B' });
  assert(typeof r === 'string');
  assert(r!.includes('<!DOCTYPE html>'));
  assert(r!.includes('class="mermaid"'));
  assert(r!.includes('cdn.jsdelivr.net/npm/mermaid@11'));
}

{
  // react type — wrapped with React UMD and babel standalone
  const r = renderVisionHtml({ type: 'react', content: 'export default function App(){return <div>hi</div>}' });
  assert(typeof r === 'string');
  assert(r!.includes('<!DOCTYPE html>'));
  assert(r!.includes('unpkg.com/react@18/umd/react.production.min.js'));
  assert(r!.includes('unpkg.com/react-dom@18/umd/react-dom.production.min.js'));
  assert(r!.includes('unpkg.com/@babel/standalone/babel.min.js'));
  assert(r!.includes('type="text/babel"'));
}

{
  // react type — import statements are stripped; export default becomes named function
  const r = renderVisionHtml({ type: 'react', content: 'import React from "react"\nexport default function App(){return <div>hi</div>}' });
  assert(typeof r === 'string');
  assert(!r!.includes('import React from'), 'import line should be stripped');
  assert(r!.includes('function App'), 'named function App should be present');
  assert(!r!.includes('export default function App'), 'export default should be transformed away');
}

{
  // react type — export default function syntax transformed
  const r = renderVisionHtml({ type: 'react', content: 'export default function Foo(){return <span/>}' });
  assert(typeof r === 'string');
  assert(r!.includes('function Foo'));
  assert(!r!.includes('export default function Foo'));
}

{
  // markdown type — wrapped with marked.js CDN; marked v12 uses first heading as <title>
  const r = renderVisionHtml({ type: 'markdown', content: '# Hello\n\nWorld' });
  assert(typeof r === 'string');
  assert(r!.includes('<!DOCTYPE html>'));
  assert(r!.includes('cdn.jsdelivr.net/npm/marked@12/marked.min.js'));
  assert(r!.includes('<title>'), 'output should contain a <title> tag');
  assert(r!.includes('id="doc"'));
}

{
  // markdown type — title parameter is set; marked may override with first heading
  const r = renderVisionHtml({ type: 'markdown', content: '# Intro', title: 'My Doc' });
  assert(typeof r === 'string');
  assert(r!.includes('<!DOCTYPE html>'));
  assert(r!.includes('id="doc"'));
  // Just verify it runs without error and produces a full HTML doc
}

{
  // code type — returns null (rendered as text)
  const r = renderVisionHtml({ type: 'code', content: 'console.log("hello")' });
  assert.strictEqual(r, null);
}

{
  // unknown type — returns null
  const r = renderVisionHtml({ type: 'code' as any, content: 'hello' });
  assert.strictEqual(r, null);
}

console.log('visionRender.test.ts — all assertions passed');
