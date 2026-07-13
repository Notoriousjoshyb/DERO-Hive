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
