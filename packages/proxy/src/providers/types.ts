import type { LLMResponse, Message, ProviderName, TokenUsage } from '@llmkit/shared';

export interface ProviderAdapter {
  name: ProviderName;
  chat(req: ProviderRequest): Promise<ProviderResponse>;
  chatStream(req: ProviderRequest): Promise<ReadableStream>;
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
