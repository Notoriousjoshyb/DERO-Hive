import type { ProviderPreset } from './types';

// Minimal preset metadata. The actual model list is fetched live from each
// provider's /models endpoint on save — these are just fallbacks for first-run
// UX so the dropdown isn't empty before refresh completes.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyUrl: 'https://opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs',
    defaultModel: 'big-pickle',
    supportsTools: true,
    supportsVision: true,
    notes: 'OpenCode Zen — curated multi-model gateway. The model list is fetched live when you save.',
    models: []
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyUrl: 'https://opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs',
    defaultModel: 'gpt-4o-mini',
    supportsTools: true,
    notes: 'OpenCode Go gateway — same endpoint as Zen. Model list fetched live on save.',
    models: []
  },
  {
    id: 'minimax',
    name: 'MiniMax M3',
    baseUrl: 'https://api.MiniMax.io/v1',
    apiKeyUrl: 'https://platform.MiniMax.io',
    defaultModel: 'MiniMax-M3',
    supportsTools: true,
    supportsReasoning: true,
    notes: 'MiniMax M-series. Model list fetched live when you save.',
    models: []
  },
  {
    id: 'kimi',
    name: 'Kimi Code (Moonshot)',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiKeyUrl: 'https://platform.moonshot.cn',
    defaultModel: 'kimi-k2-0711-preview',
    supportsTools: true,
    notes: 'Moonshot Kimi K2 (OpenAI-compatible coding endpoint). Model list fetched live when you save.',
    models: []
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    supportsTools: true,
    supportsVision: true,
    supportsAudio: true,
    notes: 'OpenAI. Model list fetched live when you save.',
    models: []
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-4-5',
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    notes: 'Native Anthropic Messages API. Model list fetched live when you save.',
    models: []
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsTools: true,
    notes: 'Groq inference. Model list fetched live when you save.',
    models: []
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    supportsTools: true,
    notes: 'Routes to any model. Model list fetched live when you save.',
    models: []
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    supportsTools: false,
    notes: 'Local Ollama. Models fetched dynamically from /api/tags.',
    models: []
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: '',
    defaultModel: '',
    supportsTools: true,
    notes: 'Any OpenAI Chat Completions endpoint. Models auto-fetched on save.',
    models: []
  }
];

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}