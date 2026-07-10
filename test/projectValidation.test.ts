import { afterAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateProjectPath } from '../src/main/ipc/projects';

const root = mkdtempSync(join(tmpdir(), 'hive-project-'));
const file = join(root, 'not-a-directory.txt');
writeFileSync(file, 'x');

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('project path validation', () => {
  test('accepts an existing directory and normalizes it', () => {
    expect(validateProjectPath(`  ${root}  `)).toBe(resolve(root));
  });

  test.each(['', file, join(root, 'missing')])('rejects invalid project path %j', (path) => {
    expect(() => validateProjectPath(path)).toThrow(/Project path/);
  });
});
