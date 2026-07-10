export interface CustomSlashCommand {
  id: string;
  name: string;
  slashCommand: string;
  description?: string;
  source: string; // JS function body: receives `context` and returns string
}

export interface SlashContext {
  text: string; // current composer text
  date: string;
  time: string;
}

export async function loadCustomSlashCommands(): Promise<CustomSlashCommand[]> {
  try {
    const files = await window.hive.fsGlob({ root: '.hive/commands', pattern: '*.js', limit: 100 });
    const commands: CustomSlashCommand[] = [];
    for (const f of files) {
      const { content } = await window.hive.fsRead(f.path, { encoding: 'utf-8' });
      const metadata = parseCommandMetadata(content);
      if (!metadata.name || !metadata.slashCommand) continue;
      commands.push({
        id: f.path,
        name: metadata.name,
        slashCommand: metadata.slashCommand,
        description: metadata.description,
        source: content
      });
    }
    return commands;
  } catch {
    return [];
  }
}

function parseCommandMetadata(source: string): Partial<CustomSlashCommand> {
  const name = source.match(/@name\s+(.+)$/)?.[1]?.trim();
  const slashCommand = source.match(/@command\s+(.+)$/)?.[1]?.trim();
  const description = source.match(/@description\s+(.+)$/)?.[1]?.trim();
  return { name, slashCommand, description };
}

export function executeCustomCommand(cmd: CustomSlashCommand, context: SlashContext): string {
  try {
    const fn = new Function('context', `${cmd.source}\nreturn execute(context);`);
    const result = fn(context);
    return typeof result === 'string' ? result : String(result ?? '');
  } catch (err) {
    return `// Custom command error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
