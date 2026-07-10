import { DEFAULT_SYSTEM_PROMPT } from '@shared/defaults';

const PLAN_MODE_INSTRUCTIONS =
  'Plan mode is enabled. Think step-by-step and present a plan before taking any action. Wait for user confirmation before executing tools.';

export function composeSystemPrompt(options: {
  appInstructions?: string;
  conversationInstructions?: string;
  projectPath?: string;
  planMode?: boolean;
}): string {
  const layers = [DEFAULT_SYSTEM_PROMPT.trim()];
  const append = (value?: string): void => {
    const trimmed = value?.trim();
    if (trimmed) layers.push(trimmed);
  };

  append(options.appInstructions);
  append(options.conversationInstructions);
  if (options.projectPath) {
    append(`The user has selected a project folder: ${options.projectPath}
Treat this directory as the working context for file operations, shell commands, and code-related tasks. When the user refers to "the project" or "the codebase", they mean this folder.`);
  }
  if (options.planMode) append(PLAN_MODE_INSTRUCTIONS);

  return layers.join('\n\n');
}
