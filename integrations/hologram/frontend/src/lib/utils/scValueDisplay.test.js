import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSCDisplayKey, formatSCDisplayValue } from './scValueDisplay.js';

test('decodes printable hex string values shown in SC variables', () => {
  const cases = [
    ['53696567', 'Sieg'],
    ['536965676672696564', 'Siegfried'],
    ['5465737453696567', 'TestSieg'],
    ['736563726574', 'secret'],
    ['5369656746', 'SiegF'],
  ];

  for (const [raw, display] of cases) {
    assert.deepEqual(formatSCDisplayValue(raw), {
      display,
      raw,
      wasDecoded: true,
    });
  }
});

test('keeps numeric score and time values numeric-looking', () => {
  for (const value of [40, 50, 60, 55, 132]) {
    assert.deepEqual(formatSCDisplayValue(value), {
      display: String(value),
      raw: String(value),
      wasDecoded: false,
    });
  }

  for (const value of ['40', '50', '60', '55', '132', '6962919']) {
    assert.deepEqual(formatSCDisplayValue(value), {
      display: value,
      raw: value,
      wasDecoded: false,
    });
  }
});

test('trims null padding after decoding printable hex strings', () => {
  assert.deepEqual(formatSCDisplayValue('48656c6c6f00'), {
    display: 'Hello',
    raw: '48656c6c6f00',
    wasDecoded: true,
  });
});

test('leaves invalid or non-printable hex values raw', () => {
  for (const value of ['not-hex', '123', '00ff', '48656c6c6g']) {
    assert.deepEqual(formatSCDisplayValue(value), {
      display: value,
      raw: value,
      wasDecoded: false,
    });
  }
});

test('formats keys independently from values', () => {
  assert.deepEqual(formatSCDisplayKey('6e616d65'), {
    display: 'name',
    raw: '6e616d65',
    wasDecoded: true,
  });

  assert.deepEqual(formatSCDisplayKey('name_0'), {
    display: 'name_0',
    raw: 'name_0',
    wasDecoded: false,
  });
});
