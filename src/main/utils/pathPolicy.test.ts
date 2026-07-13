import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { canonicalizePath, isPathWithin, resolveAndValidate } from './pathPolicy';

const tmpRoot = mkdtempSync(join(tmpdir(), 'pathPolicy-test-'));

function cleanup(): void {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
}

try {
  // ─── canonicalizePath ─────────────────────────────────────────────────
  // Existing absolute path is canonicalised through realpath
  const realDir = join(tmpRoot, 'real');
  mkdirSync(realDir);
  const realPath = canonicalizePath(realDir);
  assert.equal(typeof realPath, 'string');
  assert(realPath.length > 0);

  // Non-existent path keeps the lexical absolute path (no realpath hit)
  const missing = canonicalizePath(join(tmpRoot, 'never-created', 'file.txt'));
  assert.equal(missing, join(tmpRoot, 'never-created', 'file.txt'));

  // Symlink inside an existing dir resolves to the target
  const targetFile = join(tmpRoot, 'target.txt');
  writeFileSync(targetFile, 'hello');
  const linkFile = join(tmpRoot, 'link.txt');
  try {
    symlinkSync(targetFile, linkFile);
    const real = canonicalizePath(linkFile);
    assert.equal(real, targetFile);
  } catch {
    // Symlinks can fail on Windows without privilege — skip if so
  }

  // A non-existent file under an existing dir: realpath resolves the existing
  // ancestor and the missing leaf is re-appended (no lexically-deeper absolute
  // path is returned).
  const newFileUnderReal = join(realDir, 'newfile.txt');
  const newFileResult = canonicalizePath(newFileUnderReal);
  assert(newFileResult.endsWith(sep + 'newfile.txt'),
    'must preserve non-existent leaf suffix');
  assert.equal(newFileResult.replace(/[\\/]+newfile\.txt$/, ''),
    realPath.replace(/[\\/]+$/, ''),
    'ancestor must be the real dir');

  // ─── isPathWithin ─────────────────────────────────────────────────────
  // A path that is exactly the root is inside
  assert.equal(isPathWithin(realDir, realDir), true);

  // A path nested under the root is inside
  const child = join(realDir, 'child');
  mkdirSync(child);
  assert.equal(isPathWithin(child, realDir), true);

  // A sibling path is not inside
  const sibling = join(tmpRoot, 'sibling');
  mkdirSync(sibling);
  assert.equal(isPathWithin(sibling, realDir), false);

  // A parent path is not inside
  assert.equal(isPathWithin(tmpRoot, realDir), false);

  // ─── resolveAndValidate ───────────────────────────────────────────────
  // Absolute path inside the root: returned as-is (resolved)
  const absChild = resolveAndValidate(join(realDir, 'abs.txt'), realDir);
  assert(absChild.endsWith('abs.txt'));

  // Relative path joined against root
  const rel = resolveAndValidate('inside.txt', realDir);
  assert(rel.endsWith('inside.txt'));
  assert(rel.startsWith(realPath) || rel.includes(realPath));

  // Path outside the root: throws with input echo
  let thrown: Error | null = null;
  try {
    resolveAndValidate(sibling, realDir);
  } catch (e) {
    thrown = e as Error;
  }
  assert(thrown !== null, 'must throw for outside-root input');
  assert(thrown!.message.includes('outside allowed workspace'),
    'error mentions allowed workspace');
  assert(thrown!.message.includes(sibling),
    'error echoes the rejected input path');

  // Path-traversal attempt
  let traversalThrown = false;
  try {
    resolveAndValidate('..' + sep + '..' + sep + 'evil', realDir);
  } catch {
    traversalThrown = true;
  }
  assert(traversalThrown, 'must reject traversal attempts');

  // ─── existence-preserving canonicalisation of deeply nested new file ─
  const deepNew = join(realDir, 'a', 'b', 'c', 'd.txt');
  const deepResult = canonicalizePath(deepNew);
  assert(deepResult.endsWith(join('a', 'b', 'c', 'd.txt')),
    'must preserve multi-segment non-existent suffix');

  console.log('pathPolicy.test.ts — all assertions passed');
} finally {
  cleanup();
}