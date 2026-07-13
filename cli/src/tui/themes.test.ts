import assert from 'node:assert/strict';
import { listThemes, nextTheme, resolveTheme, TERMINAL_THEME_IDS } from './themes.js';

const themes = listThemes();
assert.equal(themes.length, TERMINAL_THEME_IDS.length);
assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length);
assert.ok(themes.every((theme) => theme.name && theme.description));

assert.equal(resolveTheme('dark', { prefersDark: false }).resolvedId, 'dark');
assert.equal(resolveTheme('light', { prefersDark: true }).resolvedId, 'light');
assert.equal(resolveTheme('system', { prefersDark: true }).resolvedId, 'dark');
assert.equal(resolveTheme('system', { prefersDark: false }).resolvedId, 'light');
assert.equal(resolveTheme('invalid', { prefersDark: true }).id, 'system');

const accented = resolveTheme('dark', { accentColor: '#336699' });
assert.equal(accented.palette.accent, '#336699');
assert.match(accented.palette.accentSoft, /51, 102, 153/);
const invalidAccent = resolveTheme('dark', { accentColor: 'not-a-colour' });
assert.notEqual(invalidAccent.palette.accent, 'not-a-colour');

assert.equal(nextTheme(undefined), TERMINAL_THEME_IDS[0]);
assert.equal(nextTheme(TERMINAL_THEME_IDS[0], -1), TERMINAL_THEME_IDS.at(-1));
assert.equal(nextTheme(TERMINAL_THEME_IDS.at(-1), 1), TERMINAL_THEME_IDS[0]);

console.log('themes.test.ts — all assertions passed');
