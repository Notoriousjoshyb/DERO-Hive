import assert from 'node:assert/strict';
import { extractArtifacts, hasPreviewableArtifact } from './artifacts';

const filler = 'This artifact body is deliberately long enough to be saved.';

const extracted = extractArtifacts([
  '# Landing page',
  '```html',
  `<main>${filler}</main>`,
  '```',
  '',
  '**Chart:**',
  '```svg',
  `<svg><title>Ignored fallback</title><text>${filler}</text></svg>`,
  '```',
  '',
  '```mermaid',
  `graph TD\nA[${filler}] --> B`,
  '```',
  '',
  '```tsx',
  `export default function Dashboard() { return <main>${filler}</main>; }`,
  '```',
  '',
  '```md',
  `# Notes\n\n${filler}`,
  '```'
].join('\n'));

assert.equal(extracted.length, 5);
assert.deepEqual(extracted.map((artifact) => artifact.type), ['html', 'svg', 'mermaid', 'react', 'markdown']);
assert.equal(extracted[0].title, 'Landing page');
assert.equal(extracted[1].title, 'Chart:');
assert.equal(extracted[3].title, 'Dashboard');
assert.equal(extracted[4].title, 'Notes');
assert.equal(extracted[3].language, 'tsx');

assert.deepEqual(extractArtifacts(`\`\`\`html\nshort\n\`\`\``), []);
assert.deepEqual(extractArtifacts(`\`\`\`python\n${filler}\n\`\`\``), []);
assert.deepEqual(extractArtifacts(`\`\`\`html\n${filler}`), []);

const standaloneSvg = `<svg><title>Standalone</title><text>${filler}</text></svg>`;
const standalone = extractArtifacts(`Before the image.\n${standaloneSvg}`);
assert.equal(standalone.length, 1);
assert.equal(standalone[0].type, 'svg');
assert.equal(standalone[0].title, 'Standalone');

assert.deepEqual(extractArtifacts(`\`\`\`text\n${standaloneSvg}\n\`\`\``), []);
assert.equal(hasPreviewableArtifact(`\`\`\`html\n<main>${filler}</main>\n\`\`\``), true);
assert.equal(hasPreviewableArtifact(`\`\`\`html\nshort\n\`\`\``), false);
assert.equal(hasPreviewableArtifact(`\`\`\`python\n${filler}\n\`\`\``), false);
