import assert from 'node:assert/strict';
import { shouldCloseVisionArtifactViewer } from './visionViewer';

assert.equal(shouldCloseVisionArtifactViewer('Escape'), true);
assert.equal(shouldCloseVisionArtifactViewer('Enter'), false);
assert.equal(shouldCloseVisionArtifactViewer(' '), false);
