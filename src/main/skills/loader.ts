import { app } from 'electron';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { paths } from '../utils/paths';
import { logger } from '../utils/logger';

export interface ParsedSkill {
  name: string;
  description: string;
  prompt: string;
  license?: string;
}

export interface SkillSeed extends ParsedSkill {
  id: string;
  slashCommand: string;
  category: string;
  builtin: boolean;
  sourceDir: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Agent Skills spec (agentskills.io): name is lowercase kebab-case, max 64 chars,
// and must match the directory name; description is required, max 1024 chars.
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

export function bundledSkillsDir(): string {
  return join(app.getAppPath(), 'resources', 'skills');
}

export function userSkillsDir(): string {
  return paths.skills;
}

export function parseSkillMarkdown(raw: string): ParsedSkill | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;

  const [, fmBlock, body] = match;
  let meta: Record<string, unknown>;
  try {
    const parsed = parseYaml(fmBlock);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    meta = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (!name || name.length > NAME_MAX || !NAME_RE.test(name)) return null;
  if (!description || description.length > DESCRIPTION_MAX) return null;

  return {
    name,
    description,
    license: typeof meta.license === 'string' ? meta.license : undefined,
    prompt: body.trim()
  };
}

export function loadSkillsFrom(
  root: string,
  opts: { builtin: boolean; category: string; idPrefix: string }
): SkillSeed[] {
  if (!existsSync(root)) return [];

  const out: SkillSeed[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    let raw: string;
    try {
      raw = readFileSync(skillPath, 'utf8');
    } catch {
      continue;
    }

    const parsed = parseSkillMarkdown(raw);
    if (!parsed) {
      logger.warn('skills', `invalid SKILL.md skipped (needs name + description frontmatter): ${skillPath}`);
      continue;
    }
    if (parsed.name !== entry.name) {
      logger.warn('skills', `skill name "${parsed.name}" does not match directory "${entry.name}" — skipped: ${skillPath}`);
      continue;
    }

    out.push({
      ...parsed,
      id: `${opts.idPrefix}-${parsed.name}`,
      slashCommand: `/${parsed.name}`,
      category: opts.category,
      builtin: opts.builtin,
      sourceDir: dir
    });
  }

  return out;
}

export function loadBundledSkills(): SkillSeed[] {
  return loadSkillsFrom(bundledSkillsDir(), { builtin: true, category: 'DERO', idPrefix: 'bundled' });
}

export function loadUserSkills(): SkillSeed[] {
  return loadSkillsFrom(userSkillsDir(), { builtin: false, category: 'user', idPrefix: 'user' });
}
