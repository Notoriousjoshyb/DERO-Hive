import assert from 'node:assert';
import { isRunnableLanguage, normalizeLanguage } from './codeRunner';

// isRunnableLanguage — truthy/falsy for all variants
const CASES: [string, boolean][] = [
  ['js', true], ['javascript', true], ['python', true], ['py', true],
  ['ruby', false], ['rust', false], ['go', false], ['', false], ['JAVASCRIPT', true], ['Python', true],
];
for (const [lang, expected] of CASES) {
  assert.equal(isRunnableLanguage(lang), expected, `isRunnableLanguage(${JSON.stringify(lang)})`);
}

// normalizeLanguage — returns correct variant or null
const NORM_CASES: [string, 'javascript' | 'python' | null][] = [
  ['js', 'javascript'], ['javascript', 'javascript'], ['python', 'python'], ['py', 'python'],
  ['ruby', null], ['rust', null], ['go', null], ['', null], ['JAVASCRIPT', 'javascript'], ['PY', 'python'],
];
for (const [lang, expected] of NORM_CASES) {
  assert.equal(normalizeLanguage(lang), expected, `normalizeLanguage(${JSON.stringify(lang)})`);
}

console.log('codeRunner.test.ts — all assertions passed');
