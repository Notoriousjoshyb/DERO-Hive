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
