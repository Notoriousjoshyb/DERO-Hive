import assert from 'node:assert/strict';
import { BUILTIN_SKILLS, DEFAULT_SYSTEM_PROMPT } from './defaults';

// ─── BUILTIN_SKILLS ─────────────────────────────────────────────────────────

const skillCount = BUILTIN_SKILLS.length;
assert(skillCount > 0, 'BUILTIN_SKILLS must be non-empty');

// Required fields on every skill
for (const skill of BUILTIN_SKILLS) {
  assert(typeof skill.id === 'string' && skill.id.length > 0, `skill missing id: ${JSON.stringify(skill)}`);
  assert(typeof skill.name === 'string' && skill.name.length > 0, `skill missing name`);
  assert(typeof skill.description === 'string' && skill.description.length > 0, `skill missing description`);
  assert(typeof skill.slashCommand === 'string' && skill.slashCommand.startsWith('/'), `skill missing slashCommand`);
  assert(typeof skill.prompt === 'string' && skill.prompt.length > 0, `skill missing prompt`);
  assert(typeof skill.enabled === 'boolean', `skill missing enabled`);
  assert(typeof skill.builtin === 'boolean', `skill missing builtin`);
  assert(typeof skill.category === 'string' && skill.category.length > 0, `skill missing category`);
}

// Unique ids
const ids = BUILTIN_SKILLS.map((s) => s.id);
assert(new Set(ids).size === ids.length, 'duplicate skill ids');

// Unique slash commands
const cmds = BUILTIN_SKILLS.map((s) => s.slashCommand);
assert(new Set(cmds).size === cmds.length, 'duplicate slash commands');

// All enabled and builtin
for (const skill of BUILTIN_SKILLS) {
  assert(skill.enabled === true, `skill ${skill.id} not enabled`);
  assert(skill.builtin === true, `skill ${skill.id} not builtin`);
}

// Expected categories present
const categories = new Set(BUILTIN_SKILLS.map((s) => s.category));
assert(categories.has('git'), 'missing git category');
assert(categories.has('code'), 'missing code category');
assert(categories.has('docs'), 'missing docs category');

// Commit skill content
const commit = BUILTIN_SKILLS.find((s) => s.id === 'skill-commit');
assert(commit != null, 'skill-commit not found');
assert(commit!.prompt.toLowerCase().includes('conventional commit'), 'commit skill missing conventional commit guidance');
assert(commit!.prompt.includes('feat'), 'commit skill missing feat prefix');

// Review skill content
const review = BUILTIN_SKILLS.find((s) => s.id === 'skill-review');
assert(review != null, 'skill-review not found');
assert(review!.prompt.toLowerCase().includes('security'), 'review skill missing security guidance');

// Fix-bug skill content
const fix = BUILTIN_SKILLS.find((s) => s.id === 'skill-fix-bug');
assert(fix != null, 'skill-fix-bug not found');
assert(fix!.prompt.toLowerCase().includes('unified diff'), 'fix-bug skill missing unified diff reference');

// ─── DEFAULT_SYSTEM_PROMPT ──────────────────────────────────────────────────

assert(typeof DEFAULT_SYSTEM_PROMPT === 'string' && DEFAULT_SYSTEM_PROMPT.length > 0, 'DEFAULT_SYSTEM_PROMPT must be non-empty');

assert(DEFAULT_SYSTEM_PROMPT.includes('tools'), 'DEFAULT_SYSTEM_PROMPT missing tools guidance');
assert(DEFAULT_SYSTEM_PROMPT.includes('DAEMON EVIDENCE'), 'DEFAULT_SYSTEM_PROMPT missing DAEMON EVIDENCE labeling');
assert(DEFAULT_SYSTEM_PROMPT.includes('DOCUMENTATION'), 'DEFAULT_SYSTEM_PROMPT missing DOCUMENTATION labeling');
assert(DEFAULT_SYSTEM_PROMPT.includes('MODEL INFERENCE'), 'DEFAULT_SYSTEM_PROMPT missing MODEL INFERENCE labeling');
assert(DEFAULT_SYSTEM_PROMPT.includes('Vision workspace'), 'DEFAULT_SYSTEM_PROMPT missing Vision workspace guidance');
assert(DEFAULT_SYSTEM_PROMPT.includes('fenced code block'), 'DEFAULT_SYSTEM_PROMPT missing fenced code block guidance');
assert(DEFAULT_SYSTEM_PROMPT.includes('path:line'), 'DEFAULT_SYSTEM_PROMPT missing citation guidance');

console.log(`defaults.test.ts — ${skillCount} skills, all assertions passed`);
