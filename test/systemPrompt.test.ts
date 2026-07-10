import { describe, expect, test } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from '../src/shared/defaults';
import { composeSystemPrompt } from '../src/main/utils/systemPrompt';

describe('system prompt composition', () => {
  test('always keeps the core prompt and appends every active layer in order', () => {
    const prompt = composeSystemPrompt({
      appInstructions: 'App instructions',
      conversationInstructions: 'Conversation instructions',
      projectPath: 'C:\\work\\hive',
      planMode: true
    });

    expect(prompt.startsWith(DEFAULT_SYSTEM_PROMPT.trim())).toBe(true);
    expect(prompt.indexOf('App instructions')).toBeLessThan(prompt.indexOf('Conversation instructions'));
    expect(prompt.indexOf('Conversation instructions')).toBeLessThan(prompt.indexOf('C:\\work\\hive'));
    expect(prompt.indexOf('C:\\work\\hive')).toBeLessThan(prompt.indexOf('Plan mode is enabled'));
  });

  test('ignores blank custom layers without losing the core prompt', () => {
    expect(composeSystemPrompt({ appInstructions: '  ', conversationInstructions: '' }))
      .toBe(DEFAULT_SYSTEM_PROMPT.trim());
  });
});
