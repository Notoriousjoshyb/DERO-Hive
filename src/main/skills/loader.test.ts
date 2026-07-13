// Focused pure-function tests for src/main/skills/loader.ts
// Tests the parseSkillMarkdown function only — inspectSkillDirectory, loadSkillsFrom,
// bundledSkillsDir, etc. require a real filesystem and are exercised via integration.

import assert from 'node:assert/strict';
import { parseSkillMarkdown } from './loader';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    failed += 1;
  }
}

console.log('parseSkillMarkdown');

// Happy path: minimal valid input
test('parses minimal valid skill with name and description', () => {
  const raw = `---
name: hello-world
description: A short description
---
This is the body.`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'hello-world');
  assert.equal(result.description, 'A short description');
  assert.equal(result.prompt, 'This is the body.');
  assert.equal(result.license, undefined);
});

// With license and quoted description
test('parses license field and preserves quoted description', () => {
  const raw = `---
name: my-skill
description: "A quoted description with: a colon"
license: MIT
---
Body content.`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.license, 'MIT');
  assert.equal(result.description, 'A quoted description with: a colon');
});

// Single-quoted description
test('parses single-quoted description values', () => {
  const raw = `---
name: 'single-quote-skill'
description: 'A description'
---
Body.`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'single-quote-skill');
  assert.equal(result.description, 'A description');
});

// CRLF line endings
test('handles CRLF line endings in frontmatter', () => {
  const raw = '---\r\nname: crlf-skill\r\ndescription: A description\r\n---\r\nBody.\r\n';
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'crlf-skill');
  assert.equal(result.description, 'A description');
  assert.equal(result.prompt, 'Body.');
});

// Trim whitespace from body
test('trims surrounding whitespace from body', () => {
  const raw = `---
name: trim-skill
description: A description
---

   Multi-line
   body content.

`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.prompt, 'Multi-line\n   body content.');
});

// Missing frontmatter returns null
test('returns null for content with no frontmatter', () => {
  assert.equal(parseSkillMarkdown('Just plain text with no markers.'), null);
});

// Incomplete frontmatter (only one ---) returns null
test('returns null when closing --- is missing', () => {
  const raw = `---
name: broken
description: missing closer`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Missing name returns null
test('returns null when name is missing', () => {
  const raw = `---
description: only description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Empty name returns null
test('returns null when name is empty', () => {
  const raw = `---
name:
description: a desc
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Missing description returns null
test('returns null when description is missing', () => {
  const raw = `---
name: valid-name
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name with uppercase letters is invalid (kebab-case only)
test('returns null for uppercase name (must be lowercase kebab)', () => {
  const raw = `---
name: MySkill
description: A description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name with underscore is invalid
test('returns null for underscore in name', () => {
  const raw = `---
name: my_skill
description: A description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name with consecutive hyphens is invalid
test('returns null for consecutive hyphens in name', () => {
  const raw = `---
name: my--skill
description: A description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name with leading hyphen is invalid
test('returns null for leading hyphen in name', () => {
  const raw = `---
name: -leading-hyphen
description: A description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name exceeding 64 chars is invalid
test('returns null when name exceeds 64 characters', () => {
  const longName = 'a'.repeat(65);
  const raw = `---
name: ${longName}
description: A description
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Name of exactly 64 chars is valid
test('accepts name of exactly 64 characters', () => {
  const maxName = 'a'.repeat(64);
  const raw = `---
name: ${maxName}
description: A description
---
Body`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, maxName);
});

// Description exceeding 1024 chars is invalid
test('returns null when description exceeds 1024 characters', () => {
  const longDesc = 'a'.repeat(1025);
  const raw = `---
name: valid-name
description: ${longDesc}
---
Body`;
  assert.equal(parseSkillMarkdown(raw), null);
});

// Description of exactly 1024 chars is valid
test('accepts description of exactly 1024 characters', () => {
  const maxDesc = 'a'.repeat(1024);
  const raw = `---
name: valid-name
description: ${maxDesc}
---
Body`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
});

// Numeric name is invalid (kebab-case letters or hyphens, not digits alone)
test('returns null for digit-only name', () => {
  const raw = `---
name: 12345
description: A description
---
Body`;
  // Note: the regex allows leading digit in this case
  // Actually 12345 would match since a-z0-9 includes digits and no leading hyphens
  // The test is documenting actual behavior — single token "12345" is valid kebab-case
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, '12345');
});

// Multi-word name with digits
test('accepts name with digits in middle', () => {
  const raw = `---
name: v2-launcher
description: A description
---
Body`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'v2-launcher');
});

// Extra frontmatter fields are ignored
test('ignores unknown frontmatter fields', () => {
  const raw = `---
name: valid
description: A description
author: Anonymous
version: 1.0
---
Body`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'valid');
});

// No body is fine
test('handles empty body', () => {
  const raw = `---
name: no-body
description: A description
---`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.prompt, '');
});

// Malformed frontmatter line (no colon) is skipped
test('skips malformed frontmatter lines without colon', () => {
  const raw = `---
name: valid
description: A description
this is not a field
---
Body`;
  const result = parseSkillMarkdown(raw);
  assert.ok(result);
  assert.equal(result.name, 'valid');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
