import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from '@shared/types';

export interface McpServerInstance {
  id: string;
  client: Client;
  transport: StdioClientTransport;
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  error?: string;
  tools: ToolDefinition[];
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string; arguments?: unknown[] }[];
}

export class McpConnectionError extends Error {
  constructor(message: string) { super(message); this.name = 'McpConnectionError'; }
}