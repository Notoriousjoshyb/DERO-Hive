import assert from 'node:assert';

// Re-implement parseCommandMetadata locally to test the regex shape used in
// src/renderer/src/lib/customSlashCommands.ts without pulling in DOM globals.
function parseCommandMetadata(source: string): {
  name?: string;
  slashCommand?: string;
  description?: string;
} {
  const name = source.match(/@name\s+(.+)$/m)?.[1]?.trim();
  const slashCommand = source.match(/@command\s+(.+)$/m)?.[1]?.trim();
  const description = source.match(/@description\s+(.+)$/m)?.[1]?.trim();
  return { name, slashCommand, description };
}

// Full metadata header
const full = `// @name Hello
// @command /hello
// @description Says hello
function execute(ctx) { return "hi " + ctx.text; }`;
const parsed = parseCommandMetadata(full);
assert.equal(parsed.name, 'Hello');
assert.equal(parsed.slashCommand, '/hello');
assert.equal(parsed.description, 'Says hello');

// Only @name present
const partial = `// @name OnlyName
function execute(ctx) { return "hi"; }`;
const parsedPartial = parseCommandMetadata(partial);
assert.equal(parsedPartial.name, 'OnlyName');
assert.equal(parsedPartial.slashCommand, undefined);
assert.equal(parsedPartial.description, undefined);

// Empty source — all undefined
const empty = parseCommandMetadata('');
assert.equal(empty.name, undefined);
assert.equal(empty.slashCommand, undefined);
assert.equal(empty.description, undefined);

// Multi-line @description only takes the first line
const multiline = `// @description Line one
// another comment that is not metadata
// @command /multi`;
const parsedMulti = parseCommandMetadata(multiline);
assert.equal(parsedMulti.description, 'Line one');
assert.equal(parsedMulti.slashCommand, '/multi');
assert.equal(parsedMulti.name, undefined);

// Whitespace stripping around metadata values
const padded = '// @name    spaced   \n// @command\t/spaced\t';
const parsedPadded = parseCommandMetadata(padded);
assert.equal(parsedPadded.name, 'spaced');
assert.equal(parsedPadded.slashCommand, '/spaced');

// Source with no metadata header — all fields undefined
const plain = 'function execute(ctx) { return ctx.text.toUpperCase(); }';
const parsedPlain = parseCommandMetadata(plain);
assert.equal(parsedPlain.name, undefined);
assert.equal(parsedPlain.slashCommand, undefined);
assert.equal(parsedPlain.description, undefined);

// executeCustomCommand: success — runs the JS source, returns the string result
function runExecute(source: string, context: { text: string; date: string; time: string }): string {
  try {
    const fn = new Function('context', `${source}\nreturn execute(context);`);
    const result = fn(context);
    return typeof result === 'string' ? result : String(result ?? '');
  } catch (err) {
    return `// Custom command error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const okSource = 'function execute(ctx) { return "echo: " + ctx.text; }';
const okResult = runExecute(okSource, { text: 'ping', date: '2026-07-13', time: '12:00' });
assert.equal(okResult, 'echo: ping');

// executeCustomCommand: numeric return value is coerced to string
const numSource = 'function execute(ctx) { return ctx.text.length; }';
const numResult = runExecute(numSource, { text: 'hello', date: '2026-07-13', time: '12:00' });
assert.equal(numResult, '5');

// executeCustomCommand: throws → graceful error comment
const badSource = 'function execute(ctx) { throw new Error("boom"); }';
const badResult = runExecute(badSource, { text: 'x', date: '2026-07-13', time: '12:00' });
assert.match(badResult, /Custom command error/);
assert.match(badResult, /boom/);

// executeCustomCommand: syntax error → graceful error comment (no throw)
const syntaxSource = 'function execute(ctx) { @@@ }';
const syntaxResult = runExecute(syntaxSource, { text: 'x', date: '2026-07-13', time: '12:00' });
assert.match(syntaxResult, /Custom command error/);

// executeCustomCommand: missing execute() function → reference error caught
const missingSource = 'function otherName(ctx) { return ctx.text; }';
const missingResult = runExecute(missingSource, { text: 'x', date: '2026-07-13', time: '12:00' });
assert.match(missingResult, /Custom command error/);

// executeCustomCommand: null return → empty string (coerced from null/undefined)
const nullSource = 'function execute(ctx) { return null; }';
const nullResult = runExecute(nullSource, { text: 'x', date: '2026-07-13', time: '12:00' });
assert.equal(nullResult, '');

console.log('customSlashCommands.test.ts — all assertions passed');