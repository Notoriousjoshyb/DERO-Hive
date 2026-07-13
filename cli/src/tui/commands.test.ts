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
