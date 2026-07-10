import type { PageAgent } from 'page-agent';
import { useAppStore } from '../stores/app';

// In-page GUI agent (page-agent) wired to the main-process loopback LLM proxy,
// so the provider API key never enters the renderer. Lazy-loaded on first use.

let agent: PageAgent | null = null;
let agentKey = '';

export interface AgentRunResult {
  ok: boolean;
  message: string;
}

export async function executeInstruction(task: string): Promise<AgentRunResult> {
  const { selectedProviderId, selectedModel } = useAppStore.getState();
  if (!selectedProviderId || !selectedModel) {
    return { ok: false, message: 'Select a provider and model in the composer first.' };
  }

  const proxy = await window.hive.agentProxyStart(selectedProviderId);
  if (!proxy.ok || !proxy.port || !proxy.token) {
    return { ok: false, message: proxy.error || 'Could not start the agent proxy.' };
  }

  const key = `${proxy.port}:${proxy.token}:${selectedModel}`;
  if (!agent || agent.disposed || agentKey !== key) {
    if (agent && !agent.disposed) agent.dispose();
    const { PageAgent } = await import('page-agent');
    agent = new PageAgent({
      model: selectedModel,
      baseURL: `http://127.0.0.1:${proxy.port}/v1`,
      apiKey: proxy.token
    });
    agentKey = key;
  }

  const result = await agent.execute(task);
  return { ok: result.success, message: result.data };
}

export function disposeAgent(): void {
  if (agent && !agent.disposed) agent.dispose();
  agent = null;
  agentKey = '';
  void window.hive.agentProxyStop();
}
