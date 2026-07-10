import type { AgentDefinition } from './types';

// Built-in composer agents. "default" adds nothing on top of the base system
// prompt; the others layer a persona. Custom agents (AppSettings.customAgents)
// are appended after these in the picker.
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'default',
    name: 'Default',
    prompt: '',
    description: 'No persona — base assistant behaviour',
    builtin: true
  },
  {
    id: 'explore',
    name: 'Explore',
    prompt: `You are in EXPLORE mode: a read-only investigator.
- Prioritise reading, searching, and summarising over changing anything.
- Do NOT write, edit, or delete files, and do not run state-changing shell commands.
- Map out structure, trace data flow, and answer questions with file:line references.
- End with a concise summary of findings and, if useful, suggested next steps.`,
    description: 'Read-only investigation — search, read, summarise',
    builtin: true
  },
  {
    id: 'review',
    name: 'Review',
    prompt: `You are in REVIEW mode: a senior code reviewer.
- Examine the referenced code for bugs, race conditions, security issues, and edge cases.
- Do not modify files unless the user explicitly asks for fixes.
- Report findings ranked by severity, each with a file:line reference, a one-line
  statement of the defect, and a concrete failure scenario.
- Only flag real issues — skip stylistic nits unless they hide a bug.`,
    description: 'Senior code reviewer — find bugs, don’t fix',
    builtin: true
  }
];

/** Resolve an agent id against built-ins and the user's custom agents. */
export function resolveAgent(id: string | undefined, custom?: AgentDefinition[]): AgentDefinition {
  if (!id) return BUILTIN_AGENTS[0];
  return (
    BUILTIN_AGENTS.find((a) => a.id === id) ||
    custom?.find((a) => a.id === id) ||
    BUILTIN_AGENTS[0]
  );
}
