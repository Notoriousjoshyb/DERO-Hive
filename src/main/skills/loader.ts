import { app } from 'electron';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ParsedSkill {
  name: string;
  description: string;
  prompt: string;
  license?: string;
}

export interface BundledSkillSeed extends ParsedSkill {
  id: string;
  slashCommand: string;
  category: 'DERO';
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function bundledSkillsDir(): string {
  return join(app.getAppPath(), 'resources', 'skills');
}

export function parseSkillMarkdown(raw: string): ParsedSkill | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;

  const [, fmBlock, body] = match;
  const meta: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[m[1].toLowerCase()] = value;
  }

  const name = meta.name;
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return null;

  return {
    name,
    description: meta.description ?? '',
    license: meta.license,
    prompt: body.trim()
  };
}

export function loadBundledSkills(): BundledSkillSeed[] {
  const root = bundledSkillsDir();
  if (!existsSync(root)) return [];

  const out: BundledSkillSeed[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(root, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    let raw: string;
    try {
      raw = readFileSync(skillPath, 'utf8');
    } catch {
      continue;
    }

    const parsed = parseSkillMarkdown(raw);
    if (!parsed) continue;
    if (parsed.name !== entry.name) continue;

    out.push({
      ...parsed,
      id: `bundled-${parsed.name}`,
      slashCommand: `/${parsed.name}`,
      category: 'DERO'
    });
  }

  return out;
}