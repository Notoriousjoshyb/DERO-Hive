import assert from 'node:assert/strict';
import {
  commandSuggestions,
  filterCommandItems,
  parseSlashCommand
} from './commands.js';

assert.equal(parseSlashCommand('hello'), null);

const parsed = parseSlashCommand('  /exit "when finished" now  ');
assert.equal(parsed?.command, 'quit');
assert.equal(parsed?.invokedAs, 'exit');
assert.deepEqual(parsed?.args, ['when finished', 'now']);

assert.equal(filterCommandItems('/thi')[0]?.name, 'thinking');
assert.equal(filterCommandItems('rewind')[0]?.name, 'undo');

const skills = [
  { name: 'review', slashCommand: '/review', description: 'Review the current diff', enabled: true },
  { name: 'disabled', enabled: false },
  { name: 'unsafe', slashCommand: '/bad command' }
];
assert.equal(filterCommandItems('/rev', skills)[0]?.name, 'review');
assert.equal(commandSuggestions('/', skills, 2).length, 2);
// Cycle 91: empty and incomplete slash-command input is rejected predictably.
assert.equal(parseSlashCommand(''), null);
assert.equal(parseSlashCommand('   '), null);
assert.equal(parseSlashCommand('/'), null);
// Cycle 92: command lookup is case-insensitive while retaining canonical metadata.
const cycle92 = parseSlashCommand('/HeLP');
assert.equal(cycle92?.command, 'help');
assert.equal(cycle92?.invokedAs, 'help');
assert.equal(cycle92?.item?.command, '/help');
// Cycle 93: quoted arguments preserve spaces and remain a single token.
const cycle93 = parseSlashCommand('/new "first message" tail');
assert.deepEqual(cycle93?.args, ['first message', 'tail']);
assert.equal(cycle93?.argumentText, '"first message" tail');
// Cycle 94: escaped quote and backslash characters inside quotes are decoded.
const cycle94 = parseSlashCommand('/goal "say \\"hello\\"" "C:\\\\tmp"');
assert.deepEqual(cycle94?.args, ['say "hello"', 'C:\\tmp']);
// Cycle 96: unfinished user quotes remain usable instead of crashing autocomplete.
const cycle96 = parseSlashCommand('/new "unfinished phrase');
assert.deepEqual(cycle96?.args, ['unfinished phrase']);
// Cycle 97: unknown commands are represented without pretending to be built-ins.
const cycle97 = parseSlashCommand('/mystery alpha beta');
assert.equal(cycle97?.command, 'mystery');
assert.equal(cycle97?.item, undefined);
assert.deepEqual(cycle97?.args, ['alpha', 'beta']);
// Cycle 98: raw argument text retains meaningful internal spacing.
const cycle98 = parseSlashCommand('  /goal   keep   exact spacing  ');
assert.equal(cycle98?.argumentText, 'keep   exact spacing');
assert.deepEqual(cycle98?.args, ['keep', 'exact', 'spacing']);
// Cycle 99: explicit empty quoted arguments are preserved for command handlers.
const cycle99 = parseSlashCommand('/system "" tail');
assert.deepEqual(cycle99?.args, ['', 'tail']);
// Cycle 101: exact command names outrank every fuzzy alternative.
assert.equal(filterCommandItems('/theme')[0]?.name, 'theme');
assert.equal(filterCommandItems('/model')[0]?.name, 'model');
// Cycle 102: exact aliases resolve to their canonical command first.
assert.equal(filterCommandItems('/exit')[0]?.name, 'quit');
assert.equal(filterCommandItems('/rewind')[0]?.name, 'undo');
// Cycle 103: command keywords make capabilities discoverable without exact names.
assert.equal(filterCommandItems('/clipboard')[0]?.name, 'copy');
assert.equal(filterCommandItems('/sandbox')[0]?.name, 'permissions');
// Cycle 104: descriptive prose participates in command discovery as the final tier.
assert.equal(filterCommandItems('/safely')[0]?.name, 'quit');
assert.equal(filterCommandItems('/colour')[0]?.name, 'theme');
// Cycle 106: dynamic skill commands strip slashes and normalise case.
const cycle106 = filterCommandItems('/aud', [{ name: 'Audit Helper', slashCommand: '///AuDiT' }]);
assert.equal(cycle106[0]?.name, 'audit');
assert.equal(cycle106[0]?.source, 'skill');
// Cycle 107: disabled skills never leak into the command catalog.
assert.equal(filterCommandItems('/hidden', [{ name: 'hidden', enabled: false }]).length, 0);
// Cycle 108: malformed skill slash commands are rejected by the safe-name policy.
assert.equal(filterCommandItems('/bad', [{ name: 'bad', slashCommand: '/bad command' }]).length, 0);
assert.equal(filterCommandItems('/bad', [{ name: 'bad', slashCommand: '/-bad' }]).length, 0);
// Cycle 109: duplicate dynamic command names are de-duplicated deterministically.
const cycle109 = filterCommandItems('/review', [
  { name: 'first', slashCommand: '/review' },
  { name: 'second', slashCommand: '/review' }
]);
assert.equal(cycle109.filter((item) => item.name === 'review').length, 1);
assert.match(cycle109.find((item) => item.name === 'review')?.description ?? '', /first/);
// Cycle 111: skills cannot shadow a safety-relevant built-in command.
const cycle111 = filterCommandItems('/help', [{ name: 'shadow', slashCommand: '/help' }]);
assert.equal(cycle111.filter((item) => item.name === 'help').length, 1);
assert.equal(cycle111[0]?.source, 'builtin');
// Cycle 112: dynamic skills receive useful fallback descriptions and usage metadata.
const cycle112 = filterCommandItems('/quality-review', [{ name: 'Quality Review', slashCommand: '/quality-review' }])[0];
assert.equal(cycle112?.description, 'Run the Quality Review skill');
assert.equal(cycle112?.usage, '/quality-review');
assert.equal(cycle112?.category, 'skill');
// Cycle 113: suggestion projection exposes stable IDs and executable values.
const cycle113 = commandSuggestions('/rev', skills, 1)[0];
assert.equal(cycle113?.id, 'skill:review');
assert.equal(cycle113?.label, '/review');
assert.equal(cycle113?.value, '/review');
assert.equal(cycle113?.source, 'skill');
// Cycle 114: an explicit zero limit produces no suggestions.
assert.deepEqual(commandSuggestions('/', [], 0), []);
// Cycle 116: negative limits are clamped rather than passed to Array.slice.
assert.deepEqual(commandSuggestions('/', [], -9), []);
// Cycle 117: fractional limits are floored to a deterministic row count.
assert.equal(commandSuggestions('/', [], 1.9).length, 1);
// Cycle 118: non-finite limits fall back to the documented default of ten.
assert.equal(commandSuggestions('/', [], Number.POSITIVE_INFINITY).length, 10);
assert.equal(commandSuggestions('/', [], Number.NaN).length, 10);
// Cycle 119: every built-in remains unique, executable, and parseable to itself.
const cycle119 = await import('./commands.js');
assert.equal(new Set(cycle119.COMMAND_ITEMS.map((item) => item.name)).size, cycle119.COMMAND_ITEMS.length);
for (const item of cycle119.COMMAND_ITEMS) {
  assert.equal(item.command, `/${item.name}`);
  assert.equal(parseSlashCommand(item.command)?.command, item.name);
  assert.ok(item.usage.startsWith(item.command));
}
// Cycle 121: friendly terminal theme aliases resolve to canonical options.
const theme121 = await import('./themes.js');
assert.equal(theme121.resolveTheme('auto', { prefersDark: false }).id, 'system');
assert.equal(theme121.resolveTheme('default', { prefersDark: true }).id, 'system');
assert.equal(theme121.resolveTheme('hive-dark', {}).resolvedId, 'dark');
assert.equal(theme121.resolveTheme('hive-light', {}).resolvedId, 'light');
// Cycle 122: HIVE_THEME selects a preset when no explicit ID is supplied.
const theme122 = await import('./themes.js');
assert.equal(theme122.resolveTheme(undefined, { HIVE_THEME: 'nord' }).id, 'nord');
assert.equal(theme122.resolveTheme(null, { HIVE_THEME: 'gruvbox' }).resolvedId, 'gruvbox');
// Cycle 123: explicit terminal colour-scheme hints resolve the system theme.
const theme123 = await import('./themes.js');
assert.equal(theme123.resolveTheme('system', { HIVE_COLOR_SCHEME: 'light' }).resolvedId, 'light');
assert.equal(theme123.resolveTheme('system', { TERM_BACKGROUND: 'dark' }).resolvedId, 'dark');
// Cycle 124: conventional COLORFGBG values drive a deterministic system palette.
const theme124 = await import('./themes.js');
assert.equal(theme124.resolveTheme('system', { COLORFGBG: '15;0' }).resolvedId, 'dark');
assert.equal(theme124.resolveTheme('system', { COLORFGBG: '0;15' }).resolvedId, 'light');
// Cycle 126: explicit accents take precedence and normalise to lowercase hex.
const theme126 = await import('./themes.js');
const accent126 = theme126.resolveTheme('dark', { accentColor: 'ABCDEF', HIVE_ACCENT_COLOR: '#123456' });
assert.equal(accent126.palette.accent, '#abcdef');
assert.match(accent126.palette.accentHover, /^rgb\(\d+, \d+, \d+\)$/);
assert.match(accent126.palette.accentGlow, /^rgba\(171, 205, 239, 0\.28\)$/);
// Cycle 127: every concrete palette is complete, non-empty, and immutable.
const theme127 = await import('./themes.js');
for (const id of theme127.TERMINAL_THEME_IDS.filter((value) => value !== 'system')) {
  const resolved = theme127.resolveTheme(id);
  assert.ok(Object.values(resolved.palette).every((value) => typeof value === 'string' && value.length > 0));
  assert.ok(Object.isFrozen(resolved.palette));
}
// Cycle 128: theme cycling handles invalid IDs and reverse traversal boundaries.
const theme128 = await import('./themes.js');
assert.equal(theme128.nextTheme('unknown'), 'system');
assert.equal(theme128.nextTheme('light', -1), 'dark');
assert.equal(theme128.nextTheme('system', -1), 'gruvbox');
// Cycle 129: ragged tables align present cells to the widest present column.
const format129 = await import('../utils/format.js');
assert.equal(format129.table([['Name'], ['Alice']]), 'Name\nAlice');
assert.equal(format129.table([['a'], ['b'], ['c']]), 'a\nb\nc');
const ragged129 = format129.table([['name'], ['Alice', '30'], ['Bob', '25', 'admin']]);
assert.equal(ragged129, 'name       \nAlice  30  \nBob    25  admin');
assert.ok(ragged129.includes('admin'));
