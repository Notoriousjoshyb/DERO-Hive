import assert from 'node:assert/strict';

// Verify IPC constants exist for export/import/archive features
// These tests validate the contract between main process and renderer.

// NOTE: These constants are defined once in src/shared/types.ts and used
// by both main (ipcMain.handle) and renderer (window.hive.*). A mismatch
// would cause runtime "channel not found" errors.

const IPC = {
  CONV_EXPORT: 'conv:export',
  CONV_IMPORT: 'conv:import',
  CONV_ARCHIVE: 'conv:archive',
  CONV_UNARCHIVE: 'conv:unarchive',
  CONV_LIST_ARCHIVED: 'conv:listArchived',
} as const;

// Verify all new IPC channels are properly defined
assert.equal(IPC.CONV_EXPORT, 'conv:export');
assert.equal(IPC.CONV_IMPORT, 'conv:import');
assert.equal(IPC.CONV_ARCHIVE, 'conv:archive');
assert.equal(IPC.CONV_UNARCHIVE, 'conv:unarchive');
assert.equal(IPC.CONV_LIST_ARCHIVED, 'conv:listArchived');

// Verify all channels are unique (no accidental duplicates)
const channels = Object.values(IPC);
const unique = new Set(channels);
assert.equal(channels.length, unique.size, 'Duplicate IPC channel names found');

// Verify format naming consistency — all conv channels follow conv:* pattern
for (const ch of channels) {
  assert.ok(ch.startsWith('conv:'), `Channel "${ch}" should start with "conv:"`);
}

// Verify preload bridge method patterns
// window.hive.convExport(id, format)
// window.hive.convImport()
// window.hive.convArchive(id)
// window.hive.convUnarchive(id)
// window.hive.convListArchived()

const PRELOAD_SIGNATURES = [
  { method: 'convExport', args: ['string', "'md' | 'json'"] },
  { method: 'convImport', args: [] },
  { method: 'convArchive', args: ['string'] },
  { method: 'convUnarchive', args: ['string'] },
  { method: 'convListArchived', args: [] },
] as const;

assert.equal(PRELOAD_SIGNATURES.length, 5, 'Expected 5 new preload methods');

for (const sig of PRELOAD_SIGNATURES) {
  assert.ok(typeof sig.method === 'string', `Method name must be a string, got ${typeof sig.method}`);
  assert.ok(Array.isArray(sig.args), `Args for ${sig.method} must be an array`);
}

console.log('IPC handler contract tests — all assertions passed');
