import { describe, test, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { isPathWithin, resolveAndValidate } from '../src/main/utils/pathPolicy';

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
