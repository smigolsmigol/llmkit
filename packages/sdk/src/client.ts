import type { CostBreakdown, LLMKitConfig, LLMRequest, LLMResponse, TokenUsage } from '@llmkit/shared';

const DEFAULT_BASE_URL = 'https://api.llmkit.dev';

type ChatRequest = Omit<LLMRequest, 'provider'> & { provider?: string };

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

  session(id?: string): LLMKit {
    const clone = new LLMKit({
      ...this.config,
      sessionId: id || crypto.randomUUID(),
    });
    return clone;
  }

  async chat(req: ChatRequest): Promise<LLMResponse> {
    const res = await this.fetch(req);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message || body?.message || res.statusText;
      throw new Error(msg);
    }

    return res.json() as Promise<LLMResponse>;
  }

  async chatStream(req: ChatRequest): Promise<ChatStream> {
    const res = await this.fetch({ ...req, stream: true });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message || body?.message || res.statusText;
      throw new Error(msg);
    }

    return new ChatStream(res);
  }

  private fetch(req: ChatRequest & { stream?: boolean }): Promise<Response> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'x-llmkit-format': 'llmkit',
    };

    if (this.sessionId) {
      headers['x-llmkit-session-id'] = this.sessionId;
    }
    if (req.provider) {
      headers['x-llmkit-provider'] = req.provider;
    }

    return fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
  }
}

// async iterable that yields text chunks and exposes metadata after completion
export class ChatStream {
  private _usage?: TokenUsage;
  private _cost?: CostBreakdown;
  private _model?: string;
  private _provider?: string;
  private _id?: string;

  constructor(private response: Response) {}

  get usage() { return this._usage; }
  get cost() { return this._cost; }
  get model() { return this._model; }
  get provider() { return this._provider; }
  get id() { return this._id; }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    if (!this.response.body) throw new Error('No response body');

    const reader = this.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith('data: ')) {
            if (line === '') currentEvent = '';
            continue;
          }

          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const data = JSON.parse(raw);

            if (currentEvent === 'delta' && data.text !== undefined) {
              yield data.text as string;
            }

            if (currentEvent === 'done') {
              this._usage = data.usage;
              this._cost = data.cost;
              this._model = data.model;
              this._provider = data.provider;
              this._id = data.id;
            }
          } catch {
            // partial JSON, will be completed in next chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
