import assert from 'node:assert/strict';
import { DEFAULT_VISION_ARTIFACT_FILTERS } from './visionFilters';

assert.deepEqual(DEFAULT_VISION_ARTIFACT_FILTERS, {
  query: '',
  type: 'all',
  scope: 'all'
});
assert.equal(DEFAULT_VISION_ARTIFACT_FILTERS.query.length, 0);
assert.equal(DEFAULT_VISION_ARTIFACT_FILTERS.type, 'all');
assert.equal(DEFAULT_VISION_ARTIFACT_FILTERS.scope, 'all');
