import assert from 'node:assert';
import { table } from './format.js';

// table — pure column-width algorithm
assert.equal(table([]), '');
assert.equal(table([['a']]), 'a');
assert.equal(table([['hello', 'world']]), 'hello  world');
assert.equal(table([['a', 'b'], ['ccc', 'd']]), 'a    b\nccc  d');

// Content-preservation checks (padding adds spaces, not truncation)
const rows = table([['name', 'age'], ['Alice', '30'], ['Bob', '25']]);
assert(rows.includes('name'), 'col0 header preserved');
assert(rows.includes('Alice'), 'col0 row1 preserved');
assert(rows.includes('Bob'), 'col0 row2 preserved');
assert(rows.includes('age'), 'col1 header preserved');
assert(rows.includes('30'), 'col1 row1 preserved');
assert(rows.includes('25'), 'col1 row2 preserved');
assert(rows.includes('\n'), 'multiline structure');

// Empty table
assert.equal(table([['x', '']]).includes('x'), true);

// Wide columns dominate
const wide = table([['short', 'verylonger']]);
assert(wide.includes('verylonger'));
assert(wide.startsWith('short'));

console.log('format.test.ts — all assertions passed');
