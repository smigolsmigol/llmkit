import type { Message, ProviderName, TokenUsage } from '@f3d1/llmkit-shared';

export interface ProviderAdapter {
  name: ProviderName;
  chat(req: ProviderRequest): Promise<ProviderResponse>;
  chatStream(req: ProviderRequest): AsyncGenerator<StreamEvent>;
}

export interface ProviderRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
}

export interface ToolCall {
  name: string;
}

export interface ProviderResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason: string;
  toolCalls?: ToolCall[];
}

export interface StreamEvent {
  type: 'text' | 'tool' | 'end';
  text?: string;
  toolName?: string;
  usage?: TokenUsage;
  finishReason?: string;
  id?: string;
  model?: string;
}
