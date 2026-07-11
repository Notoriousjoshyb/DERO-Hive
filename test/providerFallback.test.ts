import { describe, expect, test } from 'vitest';
import type { ProviderConfig, ProviderFallback } from '../src/shared/types';
import type { ProviderStreamEvent } from '../src/main/providers/base';
import { resolveProviderChain, streamWithFallback } from '../src/main/ipc/chat';

const primary = { providerId: 'primary', model: 'model-a' };
const backup = { providerId: 'backup', model: 'model-b' };

async function collect(stream: AsyncIterable<{ target: ProviderFallback; event: ProviderStreamEvent }>) {
  const events: Array<{ target: ProviderFallback; event: ProviderStreamEvent }> = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('provider fallback streaming', () => {
  test('fails over only after the primary same-provider retries are exhausted before streaming', async () => {
    let primaryCalls = 0;
    let backupCalls = 0;
    const events = await collect(streamWithFallback(
      [primary, backup],
      (target) => (async function* () {
        if (target.providerId === 'primary') {
          primaryCalls++;
          throw new Error('primary offline');
        }
        backupCalls++;
        yield { type: 'delta', content: 'backup answer' } as ProviderStreamEvent;
      })(),
      new AbortController().signal,
      () => true,
      () => true,
      1,
      0
    ));

    expect(primaryCalls).toBe(2);
    expect(backupCalls).toBe(1);
    expect(events).toEqual([{ target: backup, event: { type: 'delta', content: 'backup answer' } }]);
  });

  test('does not fail over after a token was emitted', async () => {
    let backupCalls = 0;
    const stream = streamWithFallback(
      [primary, backup],
      (target) => (async function* () {
        if (target.providerId === 'primary') {
          yield { type: 'delta', content: 'partial' } as ProviderStreamEvent;
          throw new Error('disconnected');
        }
        backupCalls++;
      })(),
      new AbortController().signal,
      () => true,
      () => true,
      0,
      0
    );

    await expect(collect(stream)).rejects.toThrow('disconnected');
    expect(backupCalls).toBe(0);
  });

  test('does not fail over after a tool call or permission side effect', async () => {
    let backupCalls = 0;
    const toolStream = streamWithFallback(
      [primary, backup],
      (target) => (async function* () {
        if (target.providerId === 'primary') {
          yield { type: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'write_file', arguments: '{}' }] } as ProviderStreamEvent;
          throw new Error('tool stream failed');
        }
        backupCalls++;
      })(),
      new AbortController().signal,
      () => true,
      () => true,
      0,
      0
    );
    await expect(collect(toolStream)).rejects.toThrow('tool stream failed');

    let fallbackAllowed = true;
    const sideEffectStream = streamWithFallback(
      [primary, backup],
      (target) => (async function* () {
        if (target.providerId === 'primary') {
          fallbackAllowed = false;
          throw new Error('failed after permission');
        }
        backupCalls++;
      })(),
      new AbortController().signal,
      () => fallbackAllowed,
      () => fallbackAllowed,
      0,
      0
    );
    await expect(collect(sideEffectStream)).rejects.toThrow('failed after permission');
    expect(backupCalls).toBe(0);
  });

  test('treats reasoning and usage as committed output', async () => {
    for (const event of [
      { type: 'reasoning', reasoning: 'thinking' },
      { type: 'usage', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }
    ] satisfies ProviderStreamEvent[]) {
      let backupCalls = 0;
      const stream = streamWithFallback(
        [primary, backup],
        (target) => (async function* () {
          if (target.providerId === 'primary') {
            yield event;
            throw new Error('failed after output');
          }
          backupCalls++;
        })(),
        new AbortController().signal,
        () => true,
        () => true,
        0,
        0
      );
      await expect(collect(stream)).rejects.toThrow('failed after output');
      expect(backupCalls).toBe(0);
    }
  });

  test('reports an exhausted chain without retrying a fallback twice', async () => {
    const calls: string[] = [];
    const stream = streamWithFallback(
      [primary, backup],
      (target) => (async function* () {
        calls.push(target.providerId);
        if (target.providerId === 'primary') {
          yield { type: 'error', error: 'primary unavailable' } as ProviderStreamEvent;
          return;
        }
        throw new Error(`${target.providerId} unavailable`);
      })(),
      new AbortController().signal,
      () => true,
      () => true,
      0,
      0
    );

    await expect(collect(stream)).rejects.toThrow(/primary\/model-a: primary unavailable.*backup\/model-b: backup unavailable/);
    expect(calls).toEqual(['primary', 'backup']);
  });

  test('skips missing providers and models while preserving the next configured target', () => {
    const providers: ProviderConfig[] = [{
      id: 'backup',
      name: 'Backup',
      baseUrl: 'https://backup.invalid',
      enabled: true,
      models: [{ id: 'model-b', name: 'Model B' }]
    }];
    const resolved = resolveProviderChain(
      { providerId: 'missing', model: 'model-a' },
      [
        { providerId: 'backup', model: 'missing-model' },
        backup
      ],
      providers
    );

    expect(resolved.targets).toEqual([{ ...backup, modelDef: { id: 'model-b', name: 'Model B' } }]);
    expect(resolved.unavailable).toEqual([
      'Provider "missing" is not configured or enabled.',
      'Model "missing-model" is not configured for provider "Backup".'
    ]);
  });
});
