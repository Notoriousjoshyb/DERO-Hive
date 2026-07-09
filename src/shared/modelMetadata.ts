import type { ProviderModel } from '@shared/types';

export interface ModelMetadata {
  contextWindow: number;
  maxOutput?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsAudio?: boolean;
  supportsReasoning?: boolean;
}

export const KNOWN_MODELS: Record<string, ModelMetadata> = {
  // OpenAI
  'gpt-5.5': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'gpt-5.4': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'gpt-5.4-mini': { contextWindow: 400_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'gpt-4o': { contextWindow: 128_000, maxOutput: 16_384, supportsVision: true, supportsTools: true },
  'gpt-4o-mini': { contextWindow: 128_000, maxOutput: 16_384, supportsVision: true, supportsTools: true },
  'gpt-4-turbo': { contextWindow: 128_000, maxOutput: 4_096, supportsVision: true, supportsTools: true },
  'gpt-4': { contextWindow: 8_192, maxOutput: 4_096, supportsVision: false, supportsTools: true },
  'gpt-3.5-turbo': { contextWindow: 16_385, maxOutput: 4_096, supportsVision: false, supportsTools: true },

  // Anthropic
  'claude-opus-4.8': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-opus-4.7': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-opus-4.6': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-opus-4.5': { contextWindow: 200_000, maxOutput: 65_536, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-sonnet-5': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-sonnet-4.6': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-sonnet-4.5': { contextWindow: 200_000, maxOutput: 65_536, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-sonnet-4': { contextWindow: 200_000, maxOutput: 65_536, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-haiku-4.5': { contextWindow: 200_000, maxOutput: 65_536, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-3-5-sonnet-latest': { contextWindow: 200_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-3-5-haiku-latest': { contextWindow: 200_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-3-opus-latest': { contextWindow: 200_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-3-sonnet-latest': { contextWindow: 200_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'claude-3-haiku-latest': { contextWindow: 200_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },

  // Google Gemini
  'gemini-2.5-pro': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-2.5-flash': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-2.0-flash': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-1.5-flash': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-1.5-pro': { contextWindow: 2_097_152, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-1.5-flash-8b': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'gemini-pro': { contextWindow: 32_768, maxOutput: 8_192, supportsVision: false, supportsTools: true },
  'gemini-pro-vision': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: true, supportsTools: true },

  // Groq
  'llama-3.3-70b-versatile': { contextWindow: 131_072, maxOutput: 32_768, supportsVision: false, supportsTools: true },
  'llama-3.1-8b-instant': { contextWindow: 131_072, maxOutput: 131_072, supportsVision: false, supportsTools: true },
  'mixtral-8x7b-32768': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: false, supportsTools: true },

  // OpenCode Zen / Go
  'big-pickle': { contextWindow: 128_000, maxOutput: 8_192, supportsVision: true, supportsTools: true },

  // MiniMax M-series
  'MiniMax-M3': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'MiniMax-M3-mini': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'MiniMax-M2.7': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'MiniMax-M2.5': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'MiniMax-M2': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'MiniMax-M2-mini': { contextWindow: 1_000_000, maxOutput: 8_192, supportsVision: true, supportsTools: true, supportsReasoning: true },

  // Kimi / Moonshot
  'kimi-k2.7-code': { contextWindow: 262_144, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'kimi-k2.7-code-highspeed': { contextWindow: 262_144, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'kimi-k2.6': { contextWindow: 262_144, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'kimi-k2-0711-preview': { contextWindow: 262_144, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'moonshot-v1-8k': { contextWindow: 8_192, maxOutput: 8_192, supportsVision: false, supportsTools: true },
  'moonshot-v1-32k': { contextWindow: 32_768, maxOutput: 8_192, supportsVision: false, supportsTools: true },
  'moonshot-v1-128k': { contextWindow: 131_072, maxOutput: 8_192, supportsVision: false, supportsTools: true },

  // Ollama (local)
  'llama3.2': { contextWindow: 128_000, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'llama3.1': { contextWindow: 128_000, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'llama3': { contextWindow: 128_000, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'mistral': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'codellama': { contextWindow: 128_000, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'mixtral': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'qwen2.5-coder': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: false, supportsTools: false },
  'qwen2.5': { contextWindow: 32_768, maxOutput: 4_096, supportsVision: false, supportsTools: false },

  // OpenRouter known models
  'anthropic/claude-sonnet-4.5': { contextWindow: 200_000, maxOutput: 65_536, supportsVision: true, supportsTools: true, supportsReasoning: true },
  'openai/gpt-4o': { contextWindow: 128_000, maxOutput: 16_384, supportsVision: true, supportsTools: true },
  'openai/gpt-5.5': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'openai/gpt-5.4': { contextWindow: 1_000_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'openai/gpt-5.4-mini': { contextWindow: 400_000, maxOutput: 131_072, supportsVision: true, supportsTools: true },
  'google/gemini-2.0-flash': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'google/gemini-2.5-pro': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
  'google/gemini-2.5-flash': { contextWindow: 1_048_576, maxOutput: 8_192, supportsVision: true, supportsTools: true },
};

export function getModelMetadata(modelId: string): ModelMetadata | null {
  return KNOWN_MODELS[modelId] ?? null;
}

export function applyKnownMetadata(models: ProviderModel[]): ProviderModel[] {
  return models.map((m) => {
    const known = getModelMetadata(m.id);
    if (!known) return m;
    return {
      ...m,
      contextWindow: m.contextWindow ?? known.contextWindow,
      maxOutput: m.maxOutput ?? known.maxOutput,
      supportsVision: m.supportsVision ?? known.supportsVision,
      supportsTools: m.supportsTools ?? known.supportsTools,
      supportsAudio: m.supportsAudio ?? known.supportsAudio,
      supportsReasoning: m.supportsReasoning ?? known.supportsReasoning
    };
  });
}
