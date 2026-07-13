import assert from 'node:assert/strict';
import {
  automationId,
  automationMarker,
  automationTarget,
  errorMessage,
  isoWeekKey,
  isKnowledgeAutomationDue,
  isInterruptedCurrentRun,
  knowledgeAutomationRunKey,
  localDateKey,
  requiredString,
  rowToAutomation,
  validateKind,
  wikiLink
} from './automation';
import type { KnowledgeAutomation } from '@shared/types';

const baseAutomation: KnowledgeAutomation = {
  projectId: 'p1',
  kind: 'morning-digest',
  enabled: true,
  localHour: 8,
  localMinute: 0,
  providerId: 'prov',
  model: 'gpt-4o'
};

const tests: Array<[string, () => void]> = [];

// knowledgeAutomationRunKey
tests.push(['runKey morning-digest returns local date key', () => {
  const now = new Date(2026, 6, 13, 9, 30);
  assert.equal(knowledgeAutomationRunKey('morning-digest', now), '2026-07-13');
}]);
tests.push(['runKey weekly-synthesis returns ISO week key', () => {
  const now = new Date(2026, 6, 13, 9, 30);
  // 2026-07-13 is a Monday in ISO week 29
  assert.equal(knowledgeAutomationRunKey('weekly-synthesis', now), '2026-W29');
}]);
tests.push(['runKey pads single-digit months and days', () => {
  const now = new Date(2026, 0, 5, 0, 0);
  assert.equal(knowledgeAutomationRunKey('morning-digest', now), '2026-01-05');
}]);

// isKnowledgeAutomationDue
tests.push(['due returns false when disabled', () => {
  const now = new Date(2026, 6, 13, 8, 0);
  const a = { ...baseAutomation, enabled: false };
  assert.equal(isKnowledgeAutomationDue(a, now), false);
}]);
tests.push(['due returns false when same runKey already ran today', () => {
  const now = new Date(2026, 6, 13, 8, 0);
  const a = { ...baseAutomation, lastRunKey: '2026-07-13' };
  assert.equal(isKnowledgeAutomationDue(a, now), false);
}]);
tests.push(['due morning-digest true when current >= scheduled', () => {
  const now = new Date(2026, 6, 13, 8, 30);
  const a = { ...baseAutomation, localHour: 8, localMinute: 0 };
  assert.equal(isKnowledgeAutomationDue(a, now), true);
}]);
tests.push(['due morning-digest false when current < scheduled', () => {
  const now = new Date(2026, 6, 13, 7, 59);
  const a = { ...baseAutomation, localHour: 8, localMinute: 0 };
  assert.equal(isKnowledgeAutomationDue(a, now), false);
}]);
tests.push(['due weekly-synthesis true on scheduled weekday after time', () => {
  // 2026-07-13 is a Monday (weekday 1)
  const now = new Date(2026, 6, 13, 9, 0);
  const a = { ...baseAutomation, kind: 'weekly-synthesis' as const, localHour: 9, localMinute: 0, weeklyWeekday: 1 };
  assert.equal(isKnowledgeAutomationDue(a, now), true);
}]);
tests.push(['due weekly-synthesis false on non-scheduled weekday', () => {
  // 2026-07-14 is a Tuesday (weekday 2)
  const now = new Date(2026, 6, 14, 9, 0);
  const a = { ...baseAutomation, kind: 'weekly-synthesis' as const, localHour: 9, localMinute: 0, weeklyWeekday: 1 };
  assert.equal(isKnowledgeAutomationDue(a, now), false);
}]);
tests.push(['due weekly-synthesis treats weekday 0 (Sunday) as 7', () => {
  // 2026-07-12 is a Sunday (weekday 0)
  const now = new Date(2026, 6, 12, 9, 0);
  const a = { ...baseAutomation, kind: 'weekly-synthesis' as const, localHour: 9, localMinute: 0, weeklyWeekday: 0 };
  assert.equal(isKnowledgeAutomationDue(a, now), true);
}]);

// isInterruptedCurrentRun
tests.push(['isInterruptedCurrentRun true when lastRunKey matches and error matches', () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const a = { ...baseAutomation, lastRunKey: '2026-07-13', error: 'Run interrupted before completion' };
  assert.equal(isInterruptedCurrentRun(a, now), true);
}]);
tests.push(['isInterruptedCurrentRun false when disabled', () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const a = { ...baseAutomation, enabled: false, lastRunKey: '2026-07-13', error: 'Run interrupted before completion' };
  assert.equal(isInterruptedCurrentRun(a, now), false);
}]);
tests.push(['isInterruptedCurrentRun false when error differs', () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const a = { ...baseAutomation, lastRunKey: '2026-07-13', error: 'Some other error' };
  assert.equal(isInterruptedCurrentRun(a, now), false);
}]);
tests.push(['isInterruptedCurrentRun false when runKey differs', () => {
  const now = new Date(2026, 6, 13, 9, 0);
  const a = { ...baseAutomation, lastRunKey: '2026-07-12', error: 'Run interrupted before completion' };
  assert.equal(isInterruptedCurrentRun(a, now), false);
}]);

// validateKind
tests.push(['validateKind accepts morning-digest', () => {
  validateKind('morning-digest');
  assert.ok(true);
}]);
tests.push(['validateKind accepts weekly-synthesis', () => {
  validateKind('weekly-synthesis');
  assert.ok(true);
}]);
tests.push(['validateKind throws for unknown', () => {
  assert.throws(() => validateKind('nope'), /Invalid knowledge automation kind/);
}]);

// rowToAutomation
tests.push(['rowToAutomation maps snake_case to camelCase minimal', () => {
  const row = {
    project_id: 'p1',
    kind: 'morning-digest',
    enabled: 1,
    local_hour: 8,
    local_minute: 30,
    provider_id: 'prov',
    model: 'gpt-4o'
  };
  const result = rowToAutomation(row);
  assert.deepEqual(result, {
    projectId: 'p1',
    kind: 'morning-digest',
    enabled: true,
    localHour: 8,
    localMinute: 30,
    providerId: 'prov',
    model: 'gpt-4o'
  });
}]);
tests.push(['rowToAutomation enabled 0 -> false', () => {
  const row = { project_id: 'p', kind: 'morning-digest', enabled: 0, local_hour: 0, local_minute: 0, provider_id: 'x', model: 'y' };
  assert.equal(rowToAutomation(row).enabled, false);
}]);
tests.push(['rowToAutomation includes optional fields when present', () => {
  const row = {
    project_id: 'p', kind: 'weekly-synthesis', enabled: 1,
    local_hour: 9, local_minute: 0,
    weekly_weekday: 3, provider_id: 'x', model: 'y',
    last_run_key: 'k', last_run_at: 12345, last_error: 'oops'
  };
  const result = rowToAutomation(row);
  assert.equal(result.weeklyWeekday, 3);
  assert.equal(result.lastRunKey, 'k');
  assert.equal(result.lastRunAt, 12345);
  assert.equal(result.error, 'oops');
}]);
tests.push(['rowToAutomation omits optional fields when absent', () => {
  const row = { project_id: 'p', kind: 'morning-digest', enabled: 1, local_hour: 0, local_minute: 0, provider_id: 'x', model: 'y' };
  const result = rowToAutomation(row);
  assert.equal('weeklyWeekday' in result, false);
  assert.equal('lastRunKey' in result, false);
  assert.equal('lastRunAt' in result, false);
  assert.equal('error' in result, false);
}]);

// automationId
tests.push(['automationId composes projectId:kind', () => {
  assert.equal(automationId({ projectId: 'p', kind: 'morning-digest' }), 'p:morning-digest');
}]);

// automationTarget
tests.push(['automationTarget morning-digest -> Daily', () => {
  assert.equal(automationTarget('morning-digest', '2026-07-13'), 'Daily/2026-07-13.md');
}]);
tests.push(['automationTarget weekly-synthesis -> Weekly', () => {
  assert.equal(automationTarget('weekly-synthesis', '2026-W29'), 'Weekly/2026-W29.md');
}]);

// automationMarker
tests.push(['automationMarker HTML comment with kind and runKey', () => {
  assert.equal(automationMarker('morning-digest', '2026-07-13'), '<!-- dero-hive:morning-digest:2026-07-13 -->');
}]);

// localDateKey
tests.push(['localDateKey pads single-digit month and day', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), '2026-01-05');
}]);
tests.push(['localDateKey zero-pads correctly', () => {
  assert.equal(localDateKey(new Date(2026, 11, 31)), '2026-12-31');
}]);

// isoWeekKey
tests.push(['isoWeekKey 2026-01-01 is week 1', () => {
  assert.equal(isoWeekKey(new Date(2026, 0, 1)), '2026-W01');
}]);
tests.push(['isoWeekKey 2026-07-13 (Monday) is week 29', () => {
  assert.equal(isoWeekKey(new Date(2026, 6, 13)), '2026-W29');
}]);
tests.push(['isoWeekKey 2025-12-29 (Monday) belongs to 2026-W01', () => {
  // ISO week: Mon 2025-12-29 is in week 1 of 2026
  assert.equal(isoWeekKey(new Date(2025, 11, 29)), '2026-W01');
}]);
tests.push(['isoWeekKey 2026-12-31 (Thursday) is week 53', () => {
  // 2026-12-31 is a Thursday, ISO week 53 of 2026
  assert.equal(isoWeekKey(new Date(2026, 11, 31)), '2026-W53');
}]);

// wikiLink
tests.push(['wikiLink strips .md extension', () => {
  assert.equal(wikiLink('folder/note.md'), '[[folder/note]]');
}]);
tests.push(['wikiLink case-insensitive .md strip', () => {
  assert.equal(wikiLink('note.MD'), '[[note]]');
}]);
tests.push(['wikiLink leaves non-md path unchanged', () => {
  assert.equal(wikiLink('note.txt'), '[[note.txt]]');
}]);

// requiredString
tests.push(['requiredString trims and returns string', () => {
  assert.equal(requiredString('  hello  ', 'X'), 'hello');
}]);
tests.push(['requiredString throws for empty', () => {
  assert.throws(() => requiredString('   ', 'X'), /X is required/);
}]);
tests.push(['requiredString throws for non-string', () => {
  assert.throws(() => requiredString(42, 'X'), /X is required/);
}]);
tests.push(['requiredString throws for too long', () => {
  assert.throws(() => requiredString('a'.repeat(301), 'X'), /X is too long/);
}]);

// errorMessage
tests.push(['errorMessage from Error', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
}]);
tests.push(['errorMessage from string', () => {
  assert.equal(errorMessage('oops'), 'oops');
}]);
tests.push(['errorMessage from object', () => {
  assert.equal(errorMessage({ msg: 'x' }), '[object Object]');
}]);
tests.push(['errorMessage from null', () => {
  assert.equal(errorMessage(null), 'null');
}]);

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(error as Error).message}`);
  }
}
console.log(`\nautomation.test.ts — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
