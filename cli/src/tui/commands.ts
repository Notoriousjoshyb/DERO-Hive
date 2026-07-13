/** Pure command metadata and parsing helpers shared by the interactive TUI. */

export type CommandCategory =
  | 'conversation'
  | 'model'
  | 'workflow'
  | 'integration'
  | 'workspace'
  | 'view'
  | 'system'
  | 'skill';

export interface CommandItem {
  /** Command name without the leading slash. */
  readonly name: string;
  /** Ready-to-render command, including the leading slash. */
  readonly command: `/${string}`;
  /** Aliases without a leading slash. */
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage: `/${string}`;
  readonly category: CommandCategory;
  readonly keywords: readonly string[];
  readonly source: 'builtin' | 'skill';
}

/** Minimal shape accepted from either the database Skill type or SkillSeed. */
export interface CommandSkill {
  readonly name: string;
  readonly slashCommand?: string;
  readonly description?: string;
  readonly category?: string;
  readonly enabled?: boolean;
}

export interface ParsedSlashCommand {
  /** Canonical built-in name when an alias was entered; otherwise entered name. */
  readonly command: string;
  /** The actual name typed by the user, normalised to lowercase. */
  readonly invokedAs: string;
  readonly args: readonly string[];
  readonly argumentText: string;
  readonly item?: CommandItem;
}

export interface CommandSuggestion {
  readonly id: string;
  readonly label: `/${string}`;
  readonly value: `/${string}`;
  readonly description: string;
  readonly usage: `/${string}`;
  readonly category: CommandCategory;
  readonly aliases: readonly string[];
  readonly source: 'builtin' | 'skill';
}

export const COMMAND_ITEMS = [
  {
    name: 'help',
    command: '/help',
    aliases: ['?', 'commands'],
    description: 'Show commands, shortcuts, or help for one command',
    usage: '/help [command]',
    category: 'system',
    keywords: ['discover', 'shortcuts', 'guide'],
    source: 'builtin'
  },
  {
    name: 'new',
    command: '/new',
    aliases: ['chat'],
    description: 'Start a fresh conversation in the current project',
    usage: '/new [first message]',
    category: 'conversation',
    keywords: ['conversation', 'session', 'fresh'],
    source: 'builtin'
  },
  {
    name: 'resume',
    command: '/resume',
    aliases: ['continue', 'open'],
    description: 'Resume a recent conversation or one selected by ID',
    usage: '/resume [session-id]',
    category: 'conversation',
    keywords: ['conversation', 'session', 'recent'],
    source: 'builtin'
  },
  {
    name: 'sessions',
    command: '/sessions',
    aliases: ['chats', 'history', 'list'],
    description: 'Browse and switch between saved conversations',
    usage: '/sessions [query]',
    category: 'conversation',
    keywords: ['conversation', 'resume', 'recent'],
    source: 'builtin'
  },
  {
    name: 'rename',
    command: '/rename',
    aliases: ['title'],
    description: 'Rename the current conversation',
    usage: '/rename <title>',
    category: 'conversation',
    keywords: ['conversation', 'session', 'title'],
    source: 'builtin'
  },
  {
    name: 'fork',
    command: '/fork',
    aliases: ['branch'],
    description: 'Branch the conversation from the current point',
    usage: '/fork [message]',
    category: 'conversation',
    keywords: ['conversation', 'branch', 'duplicate'],
    source: 'builtin'
  },
  {
    name: 'undo',
    command: '/undo',
    aliases: ['rewind'],
    description: 'Rewind the latest conversation turn',
    usage: '/undo [turns]',
    category: 'conversation',
    keywords: ['revert', 'remove', 'message'],
    source: 'builtin'
  },
  {
    name: 'compact',
    command: '/compact',
    aliases: ['summarize', 'summarise'],
    description: 'Summarise older context to free token space',
    usage: '/compact [instructions]',
    category: 'conversation',
    keywords: ['context', 'tokens', 'compress'],
    source: 'builtin'
  },
  {
    name: 'model',
    command: '/model',
    aliases: ['models', 'provider'],
    description: 'Choose the provider and model for the next turn',
    usage: '/model [provider/model]',
    category: 'model',
    keywords: ['provider', 'llm', 'switch'],
    source: 'builtin'
  },
  {
    name: 'thinking',
    command: '/thinking',
    aliases: ['think'],
    description: 'Show, hide, or disable the model thinking stream',
    usage: '/thinking [show|hide|off]',
    category: 'model',
    keywords: ['reasoning', 'stream', 'visibility'],
    source: 'builtin'
  },
  {
    name: 'reasoning',
    command: '/reasoning',
    aliases: ['effort'],
    description: 'Set how much reasoning effort the model should use',
    usage: '/reasoning [low|medium|high|max]',
    category: 'model',
    keywords: ['thinking', 'effort', 'budget'],
    source: 'builtin'
  },
  {
    name: 'agent',
    command: '/agent',
    aliases: ['agents', 'mode'],
    description: 'Choose an agent profile or inspect available agents',
    usage: '/agent [name|list]',
    category: 'workflow',
    keywords: ['profile', 'persona', 'delegate'],
    source: 'builtin'
  },
  {
    name: 'plan',
    command: '/plan',
    aliases: ['planning'],
    description: 'Enter or leave read-only planning mode',
    usage: '/plan [on|off|task]',
    category: 'workflow',
    keywords: ['mode', 'design', 'steps'],
    source: 'builtin'
  },
  {
    name: 'permissions',
    command: '/permissions',
    aliases: ['perms', 'permission'],
    description: 'Review or change tool approval rules',
    usage: '/permissions [list|preset|allow|ask|deny|remove]',
    category: 'workflow',
    keywords: ['approval', 'sandbox', 'safety'],
    source: 'builtin'
  },
  {
    name: 'theme',
    command: '/theme',
    aliases: ['themes', 'appearance'],
    description: 'Preview or switch the terminal colour theme',
    usage: '/theme [name|next|previous]',
    category: 'view',
    keywords: ['color', 'colour', 'dark', 'light'],
    source: 'builtin'
  },
  {
    name: 'tools',
    command: '/tools',
    aliases: ['tool'],
    description: 'Browse tools and their current availability',
    usage: '/tools [query]',
    category: 'integration',
    keywords: ['functions', 'capabilities', 'actions'],
    source: 'builtin'
  },
  {
    name: 'mcp',
    command: '/mcp',
    aliases: ['servers'],
    description: 'Inspect and manage Model Context Protocol servers',
    usage: '/mcp [list|connect|disconnect]',
    category: 'integration',
    keywords: ['server', 'connector', 'protocol'],
    source: 'builtin'
  },
  {
    name: 'skills',
    command: '/skills',
    aliases: ['skill'],
    description: 'Browse, run, or reload installed skills',
    usage: '/skills [name|reload]',
    category: 'integration',
    keywords: ['prompts', 'workflows', 'installed'],
    source: 'builtin'
  },
  {
    name: 'attach',
    command: '/attach',
    aliases: ['file'],
    description: 'Queue a file for the next turn, or include a message to send now',
    usage: '/attach <path> [message]',
    category: 'integration',
    keywords: ['upload', 'image', 'pdf', 'file'],
    source: 'builtin'
  },
  {
    name: 'project',
    command: '/project',
    aliases: ['workspace'],
    description: 'Select a Hive project and its working context',
    usage: '/project [name|path]',
    category: 'workspace',
    keywords: ['folder', 'workspace', 'repository'],
    source: 'builtin'
  },
  {
    name: 'cd',
    command: '/cd',
    aliases: ['cwd'],
    description: 'Change the active working directory',
    usage: '/cd <path>',
    category: 'workspace',
    keywords: ['directory', 'folder', 'path'],
    source: 'builtin'
  },
  {
    name: 'status',
    command: '/status',
    aliases: ['info'],
    description: 'Show session, model, project, and connection status',
    usage: '/status',
    category: 'view',
    keywords: ['session', 'provider', 'summary'],
    source: 'builtin'
  },
  {
    name: 'context',
    command: '/context',
    aliases: ['ctx', 'tokens'],
    description: 'Inspect context-window and token usage',
    usage: '/context',
    category: 'view',
    keywords: ['usage', 'window', 'budget'],
    source: 'builtin'
  },
  {
    name: 'diff',
    command: '/diff',
    aliases: ['changes'],
    description: 'Review working-tree changes made in this project',
    usage: '/diff [path]',
    category: 'workspace',
    keywords: ['git', 'patch', 'files'],
    source: 'builtin'
  },
  {
    name: 'copy',
    command: '/copy',
    aliases: ['yank'],
    description: 'Copy the latest answer or code block to the clipboard',
    usage: '/copy [last|code|response-number]',
    category: 'conversation',
    keywords: ['clipboard', 'answer', 'code'],
    source: 'builtin'
  },
  {
    name: 'export',
    command: '/export',
    aliases: ['save'],
    description: 'Export the current conversation to a file',
    usage: '/export [markdown|json] [path]',
    category: 'conversation',
    keywords: ['download', 'markdown', 'json'],
    source: 'builtin'
  },
  {
    name: 'search',
    command: '/search',
    aliases: ['find'],
    description: 'Search messages across saved conversations',
    usage: '/search <query>',
    category: 'conversation',
    keywords: ['messages', 'history', 'query'],
    source: 'builtin'
  },
  {
    name: 'clear',
    command: '/clear',
    aliases: ['cls'],
    description: 'Clear the terminal view without deleting the conversation',
    usage: '/clear',
    category: 'view',
    keywords: ['screen', 'display', 'reset'],
    source: 'builtin'
  },
  {
    name: 'details',
    command: '/details',
    aliases: ['raw'],
    description: 'Toggle expanded reasoning and tool output',
    usage: '/details [on|off]',
    category: 'view',
    keywords: ['tools', 'reasoning', 'transcript'],
    source: 'builtin'
  },
  {
    name: 'stop',
    command: '/stop',
    aliases: ['cancel', 'abort'],
    description: 'Stop the active model response',
    usage: '/stop',
    category: 'workflow',
    keywords: ['interrupt', 'stream', 'cancel'],
    source: 'builtin'
  },
  {
    name: 'focus',
    command: '/focus',
    aliases: ['zen'],
    description: 'Toggle a quieter view focused on the latest work',
    usage: '/focus [on|off]',
    category: 'view',
    keywords: ['mode', 'quiet', 'distraction'],
    source: 'builtin'
  },
  {
    name: 'goal',
    command: '/goal',
    aliases: ['objective'],
    description: 'Set, inspect, or clear the current session goal',
    usage: '/goal [text|clear]',
    category: 'workflow',
    keywords: ['task', 'objective', 'completion'],
    source: 'builtin'
  },
  {
    name: 'system',
    command: '/system',
    aliases: ['prompt'],
    description: 'View, replace, or reset the session system prompt',
    usage: '/system [prompt|reset]',
    category: 'model',
    keywords: ['instructions', 'prompt', 'behavior'],
    source: 'builtin'
  },
  {
    name: 'quit',
    command: '/quit',
    aliases: ['exit', 'q'],
    description: 'Exit Hive safely',
    usage: '/quit',
    category: 'system',
    keywords: ['close', 'leave', 'exit'],
    source: 'builtin'
  }
] as const satisfies readonly CommandItem[];

export type BuiltInCommandName = (typeof COMMAND_ITEMS)[number]['name'];

const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUILTIN_NAMES = new Set<string>(COMMAND_ITEMS.map((item) => item.name));
const COMMAND_LOOKUP = new Map<string, CommandItem>();

for (const item of COMMAND_ITEMS) {
  COMMAND_LOOKUP.set(item.name, item);
  for (const alias of item.aliases) COMMAND_LOOKUP.set(alias, item);
}

function tokeniseArguments(input: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let tokenStarted = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === '\\' && (input[index + 1] === quote || input[index + 1] === '\\')) {
        token += input[index + 1];
        index += 1;
      } else {
        token += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = '';
        tokenStarted = false;
      }
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  if (tokenStarted) tokens.push(token);
  return tokens;
}

/** Parse a slash command without executing it. Non-command input returns null. */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const value = input.trimStart();
  if (!value.startsWith('/')) return null;

  const commandMatch = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(value.trimEnd());
  if (!commandMatch) return null;

  const invokedAs = commandMatch[1].toLowerCase();
  const item = COMMAND_LOOKUP.get(invokedAs);
  const argumentText = (commandMatch[2] ?? '').trim();
  return {
    command: item?.name ?? invokedAs,
    invokedAs,
    args: tokeniseArguments(argumentText),
    argumentText,
    item
  };
}

function skillItems(skills: readonly CommandSkill[]): CommandItem[] {
  const seen = new Set<string>();
  const items: CommandItem[] = [];

  for (const skill of skills) {
    if (skill.enabled === false) continue;
    const candidate = (skill.slashCommand ?? skill.name).trim().replace(/^\/+/, '').toLowerCase();
    if (!COMMAND_NAME_PATTERN.test(candidate) || BUILTIN_NAMES.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    items.push({
      name: candidate,
      command: `/${candidate}`,
      aliases: [],
      description: skill.description?.trim() || `Run the ${skill.name} skill`,
      usage: `/${candidate}`,
      category: 'skill',
      keywords: ['skill', skill.name, skill.category ?? ''].filter(Boolean),
      source: 'skill'
    });
  }

  return items;
}

function commandQuery(query: string): string {
  return query.trimStart().replace(/^\/+/, '').split(/\s/, 1)[0].toLowerCase();
}

function matchScore(item: CommandItem, query: string): number | undefined {
  if (!query) return 0;
  if (item.name === query) return 0;
  if (item.name.startsWith(query)) return 1;
  if (item.aliases.some((alias) => alias === query)) return 2;
  if (item.aliases.some((alias) => alias.startsWith(query))) return 3;
  if (item.name.includes(query)) return 4;
  if (item.aliases.some((alias) => alias.includes(query))) return 5;
  if (item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) return 6;
  if (item.description.toLowerCase().includes(query)) return 7;
  return undefined;
}

/**
 * Filter and rank built-ins plus optional dynamic skills. The catalog and the
 * supplied skill array are never mutated.
 */
export function filterCommandItems(
  query: string,
  skills: readonly CommandSkill[] = []
): CommandItem[] {
  const term = commandQuery(query);
  const candidates: CommandItem[] = [...COMMAND_ITEMS, ...skillItems(skills)];
  return candidates
    .map((item, index) => ({ item, index, score: matchScore(item, term) }))
    .filter((entry): entry is { item: CommandItem; index: number; score: number } => entry.score !== undefined)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }) => item);
}

/** Build structured autocomplete rows ready for an Ink command menu. */
export function commandSuggestions(
  input: string,
  skills: readonly CommandSkill[] = [],
  limit = 10
): CommandSuggestion[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
  return filterCommandItems(input, skills).slice(0, safeLimit).map((item) => ({
    id: `${item.source}:${item.name}`,
    label: item.command,
    value: item.command,
    description: item.description,
    usage: item.usage,
    category: item.category,
    aliases: item.aliases,
    source: item.source
  }));
}
