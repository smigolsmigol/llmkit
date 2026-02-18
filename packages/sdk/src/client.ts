import type { LLMKitConfig, LLMRequest, LLMResponse } from '@llmkit/shared';

const DEFAULT_BASE_URL = 'https://api.llmkit.dev';

export class LLMKit {
  private config: Required<Pick<LLMKitConfig, 'apiKey' | 'baseUrl'>>;
  private sessionId?: string;

  constructor(config: LLMKitConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    };
    this.sessionId = config.sessionId;
  }

  // start a tracked agent session
  session(id?: string): LLMKit {
    const clone = new LLMKit({
      ...this.config,
      sessionId: id || crypto.randomUUID(),
    });
    return clone;
  }

  async chat(req: Omit<LLMRequest, 'provider'> & { provider?: string }): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['x-llmkit-session-id'] = this.sessionId;
    }
    if (req.provider) {
      headers['x-llmkit-provider'] = req.provider;
    }

    const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error((err as { message: string }).message);
    }

    return res.json() as Promise<LLMResponse>;
  }
}
