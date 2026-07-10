import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectSkillDirectory } from '../src/main/skills/loader';

const roots: string[] = [];

function makeSkill(folderName: string, body = 'Follow the workflow.'): string {
  const root = mkdtempSync(join(tmpdir(), 'hive-skill-'));
  roots.push(root);
  const dir = join(root, folderName);
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${folderName}\ndescription: Test skill\n---\n\n${body}\n`);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('skill folder import validation', () => {
  test('previews a self-contained SKILL.md', () => {
    const result = inspectSkillDirectory(makeSkill('test-skill'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview).toMatchObject({
      name: 'test-skill',
      slashCommand: '/test-skill',
      warnings: []
    });
  });

  test('warns about unsupported resources without loading them', () => {
    const dir = makeSkill('test-skill', 'Read references/guide.md and run scripts/check.js.');
    mkdirSync(join(dir, 'references'));
    mkdirSync(join(dir, 'scripts'));

    const result = inspectSkillDirectory(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.warnings).toEqual([
      'references/ is unsupported and will not be copied or executed.',
      'scripts/ is unsupported and will not be copied or executed.'
    ]);
  });

  test('rejects a frontmatter name that does not match its folder', () => {
    const dir = makeSkill('folder-name');
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: other-name\ndescription: Test skill\n---\nBody');

    expect(inspectSkillDirectory(dir)).toEqual({
      ok: false,
      error: 'Skill name "other-name" must match folder name "folder-name".'
    });
  });
});
