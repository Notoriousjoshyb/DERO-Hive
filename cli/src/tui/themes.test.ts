import assert from 'node:assert';
import { listThemes, TERMINAL_THEME_IDS } from './themes.js';

// listThemes — returns OPTIONS array directly (no env dependency)
const themes = listThemes();
assert(themes.length > 0, 'should return at least one theme');
assert(themes.length === TERMINAL_THEME_IDS.length, 'should match TERMINAL_THEME_IDS count');

// Each theme has required fields
for (const t of themes) {
  assert(typeof t.id === 'string' && t.id.length > 0, 'theme id required');
  assert(typeof t.name === 'string' && t.name.length > 0, 'theme name required');
  assert(typeof t.description === 'string' && t.description.length > 0, 'theme description required');
}

// All theme IDs are in TERMINAL_THEME_IDS
const ids = themes.map(t => t.id);
for (const id of ids) {
  assert((TERMINAL_THEME_IDS as readonly string[]).includes(id), `theme id ${id} should be in TERMINAL_THEME_IDS`);
}

// No duplicate IDs
const uniqueIds = new Set(ids);
assert.equal(uniqueIds.size, ids.length, 'no duplicate theme IDs');

// Specific known themes by id
const ids_list = themes.map(t => t.id);
assert(ids_list.includes('system'), 'system theme required');
assert(ids_list.includes('dark'), 'dark theme required');
assert(ids_list.includes('light'), 'light theme required');

// All themes have descriptions longer than 5 chars
for (const t of themes) {
  assert(t.description.length > 5, `theme ${t.id} should have a meaningful description`);
}

console.log('themes.test.ts — all assertions passed');
