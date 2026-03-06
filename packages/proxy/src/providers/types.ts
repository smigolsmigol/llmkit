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

export interface ProviderResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason: string;
}

export interface StreamEvent {
  type: 'text' | 'end';
  text?: string;
  usage?: TokenUsage;
  id?: string;
  model?: string;
}
