import type { Message, ToolDefinition, TokenUsage } from '@shared/types';

export interface ProviderStreamRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
  signal?: AbortSignal;
  // For multi-modal: raw base64 attachments the user uploaded
  attachments?: { type: 'image' | 'audio' | 'pdf' | 'file'; filename: string; mimeType: string; data: string }[];
}

export interface ProviderStreamEvent {
  type: 'delta' | 'reasoning' | 'tool_calls' | 'usage' | 'done' | 'error';
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: TokenUsage;
  error?: string;
}

export interface ProviderAdapter {
  readonly id: string;
  stream(req: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent>;
  testConnection(): Promise<{ ok: boolean; error?: string; models?: string[]; hint?: string }>;
}