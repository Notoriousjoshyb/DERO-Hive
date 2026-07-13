import assert from 'node:assert';
import { TERMINAL_SYSTEM_PROMPT } from './systemPrompt.js';
import { DEFAULT_SYSTEM_PROMPT } from '../../../src/shared/defaults.js';

// The terminal prompt must exist and be a non-empty string
assert.equal(typeof TERMINAL_SYSTEM_PROMPT, 'string');
assert(TERMINAL_SYSTEM_PROMPT.length > 0, 'TERMINAL_SYSTEM_PROMPT must be non-empty');

// Must extend the base default system prompt (DERO Hive identity)
assert(TERMINAL_SYSTEM_PROMPT.includes(DEFAULT_SYSTEM_PROMPT.slice(0, 50)),
  'TERMINAL_SYSTEM_PROMPT must inherit from DEFAULT_SYSTEM_PROMPT');

// Must mention Terminal workspace explicitly
assert(TERMINAL_SYSTEM_PROMPT.includes('Terminal workspace'),
  'Terminal workspace section must be present');

// Must declare the no-Vision-panel contract
assert(TERMINAL_SYSTEM_PROMPT.includes('no hidden artifact or Vision panel'),
  'Must assert no hidden artifact/Vision panel');

// Must not duplicate the Vision workspace paragraph from the base prompt
const visionIndex = TERMINAL_SYSTEM_PROMPT.indexOf('Vision workspace:');
assert.equal(visionIndex, -1, 'Vision workspace paragraph must be stripped');

// Must instruct use of workspace tools
assert(TERMINAL_SYSTEM_PROMPT.includes('workspace tools'),
  'Must instruct to use workspace tools');

// Must remind to keep responses terminal-readable
assert(TERMINAL_SYSTEM_PROMPT.includes('terminal'),
  'Must remind about terminal readability');

// Must forbid claiming a separate visual panel opened
assert(TERMINAL_SYSTEM_PROMPT.includes('never claim'),
  'Must forbid claiming a visual panel opened');

// No trailing whitespace from the strip-then-concat
assert(!TERMINAL_SYSTEM_PROMPT.startsWith(' '), 'no leading whitespace');
assert(!TERMINAL_SYSTEM_PROMPT.startsWith('\n'), 'no leading newline');

// Sections are separated by blank line
assert(TERMINAL_SYSTEM_PROMPT.includes('\n\nTerminal workspace:'),
  'Terminal workspace section is separated by a blank line');

console.log('systemPrompt.test.ts — all assertions passed');