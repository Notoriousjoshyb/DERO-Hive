import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isPathWithin, resolveAndValidate } from '../src/main/utils/pathPolicy';
import { builtinExecutors } from '../src/main/tools/builtin';

// A concrete root on whichever platform the suite runs on.
const ROOT = resolve('/work');

describe('isPathWithin', () => {
  test('accepts a file directly inside the root', () => {
    expect(isPathWithin(join(ROOT, 'src', 'index.ts'), ROOT)).toBe(true);
  });

  test('accepts the root itself', () => {
    expect(isPathWithin(ROOT, ROOT)).toBe(true);
  });

  test('rejects a sibling directory that merely shares the root prefix', () => {
    expect(isPathWithin(resolve('/work-evil/secrets'), ROOT)).toBe(false);
  });

  test('rejects a parent directory', () => {
    expect(isPathWithin(resolve('/'), ROOT)).toBe(false);
  });

  test('rejects an escape built from .. segments', () => {
    expect(isPathWithin(join(ROOT, '..', 'etc', 'passwd'), ROOT)).toBe(false);
  });

  test('is unaffected by a trailing separator on the root', () => {
    expect(isPathWithin(join(ROOT, 'a.txt'), `${ROOT}/`)).toBe(true);
  });
});

describe('resolveAndValidate', () => {
  test('resolves a relative path against the root', () => {
    expect(resolveAndValidate('src/index.ts', ROOT)).toBe(join(ROOT, 'src', 'index.ts'));
  });

  test('normalises .. segments that stay inside the root', () => {
    expect(resolveAndValidate('src/../lib/x.ts', ROOT)).toBe(join(ROOT, 'lib', 'x.ts'));
  });

  test('throws on a relative path that climbs out of the root', () => {
    expect(() => resolveAndValidate('../etc/passwd', ROOT)).toThrow(/outside allowed workspace/);
  });

  test('throws on an absolute path outside the root', () => {
    expect(() => resolveAndValidate(resolve('/etc/passwd'), ROOT)).toThrow(/outside allowed workspace/);
  });

  test('accepts an absolute path that is inside the root', () => {
    const target = join(ROOT, 'notes.md');
    expect(resolveAndValidate(target, ROOT)).toBe(target);
  });
});

describe('resolveAndValidate against a real filesystem', () => {
  let tmp: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    // realpath the temp dir: macOS hands out /var, which is a symlink to /private/var.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hive-pathpolicy-')));
    root = join(tmp, 'workspace');
    outside = join(tmp, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'top secret');
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('refuses to follow a symlink out of the workspace', () => {
    // A directory symlink (junction on Windows) planted inside the workspace.
    symlinkSync(outside, join(root, 'link'), 'junction');

    expect(() => resolveAndValidate('link/secret.txt', root)).toThrow(/outside allowed workspace/);
  });

  test('still allows writing a file that does not exist yet', () => {
    // The naive fix — realpath the whole target — throws ENOENT here, which
    // would break every write_file to a new path.
    expect(resolveAndValidate('newdir/new-file.txt', root)).toBe(join(root, 'newdir', 'new-file.txt'));
  });

  test('still works when the workspace root is itself a symlink', () => {
    const realRoot = join(tmp, 'real-root');
    mkdirSync(realRoot);
    writeFileSync(join(realRoot, 'a.txt'), 'hi');
    const linkedRoot = join(tmp, 'linked-root');
    symlinkSync(realRoot, linkedRoot, 'junction');

    // Resolving through the symlinked root must not be mistaken for an escape.
    expect(() => resolveAndValidate('a.txt', linkedRoot)).not.toThrow();
  });

  // The boundary matters at the tool, not just at the primitive.
  test('the read_file tool cannot be walked out of the workspace', async () => {
    symlinkSync(outside, join(root, 'link'), 'junction');

    await expect(
      builtinExecutors.read_file({ path: 'link/secret.txt' }, { cwd: root, conversationId: 'c1' })
    ).rejects.toThrow(/outside allowed workspace/);
  });

  test('the read_file tool still reads a file inside the workspace', async () => {
    writeFileSync(join(root, 'inside.txt'), 'hello');

    const result = await builtinExecutors.read_file(
      { path: 'inside.txt' },
      { cwd: root, conversationId: 'c1' }
    );
    expect(result.content).toContain('hello');
    expect(result.isError).toBeFalsy();
  });
});
