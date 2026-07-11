import { describe, expect, test, vi } from 'vitest';
import { CodexAcpAdapter, setNativeExecutionMode } from '../src/main/providers/codex-acp';

describe('Codex ACP native execution mode', () => {
  test('declares native tools unconfined so Swarm fails closed', () => {
    const adapter = new CodexAcpAdapter({
      id: 'codex', presetId: 'codex', name: 'Codex', baseUrl: '', models: [], enabled: true
    });
    expect(adapter.nativeToolScope).toBe('unconfined');
    expect(adapter.nativeExecutionModes).toContain('read-only');
  });

  test('sets read-only mode explicitly before Swarm prompting', async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    await setNativeExecutionMode({ setSessionMode }, 'session-1', 'read-only');
    expect(setSessionMode).toHaveBeenCalledOnce();
    expect(setSessionMode).toHaveBeenCalledWith({ sessionId: 'session-1', modeId: 'read-only' });
  });

  test('does not change ordinary chat sessions without an explicit mode', async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    await setNativeExecutionMode({ setSessionMode }, 'session-1');
    expect(setSessionMode).not.toHaveBeenCalled();
  });
});
