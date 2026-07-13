import assert from 'node:assert/strict';
import { table } from './format.js';

assert.equal(table([]), '');
assert.equal(table([['a']]), 'a');
assert.equal(table([['hello', 'world']]), 'hello  world');
assert.equal(table([['a', 'b'], ['ccc', 'd']]), 'a    b\nccc  d');

const ragged = table([['name'], ['Alice', '30'], ['Bob', '25', 'admin']]);
assert.equal(ragged, 'name       \nAlice  30  \nBob    25  admin');
assert.ok(ragged.includes('admin'));

console.log('format.test.ts — all assertions passed');
