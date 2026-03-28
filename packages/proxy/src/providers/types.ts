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
  tools?: unknown[];
  toolChoice?: unknown;
  responseFormat?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason: string;
  toolCalls?: ToolCall[];
  providerCostUsd?: number;
}

export interface StreamEvent {
  type: 'text' | 'tool' | 'end';
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: string;
  toolIndex?: number;
  usage?: TokenUsage;
  finishReason?: string;
  id?: string;
  model?: string;
  providerCostUsd?: number;
}
