import { calculateCost, type ProviderName } from '@f3d1/llmkit-shared';

interface UsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  sessionId?: string;
}

export interface CostEntry {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number;
  sessionId?: string;
  timestamp: Date;
}

// lightweight shapes matching OpenAI/Anthropic SDK responses - no deps needed
interface OpenAILikeUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface AnthropicLikeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

type CostListener = (entry: CostEntry) => void;

interface TrackerConfig {
  log?: boolean;
  onTrack?: CostListener;
}

interface Bucket {
  cents: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private listeners: CostListener[] = [];
  private shouldLog: boolean;

  constructor(config: TrackerConfig = {}) {
    this.shouldLog = config.log ?? false;
    if (config.onTrack) this.listeners.push(config.onTrack);
  }

  track(provider: ProviderName, model: string, usage: UsageInput): CostEntry {
    const costDollars = calculateCost(
      provider, model,
      usage.inputTokens, usage.outputTokens,
      usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0,
    );

    const entry: CostEntry = {
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      costCents: +(costDollars * 100).toFixed(4),
      sessionId: usage.sessionId,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    this.emit(entry);
    return entry;
  }

  // accepts a raw response from OpenAI SDK (prompt_tokens) or Anthropic SDK (input_tokens)
  trackResponse(provider: ProviderName, response: { model: string; usage: OpenAILikeUsage | AnthropicLikeUsage }): CostEntry {
    const { model, usage } = response;

    if ('prompt_tokens' in usage) {
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      return this.track(provider, model, {
        inputTokens: cached ? usage.prompt_tokens - cached : usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        cacheReadTokens: cached,
      });
    }

    return this.track(provider, model, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
    });
  }

  on(listener: CostListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  get totalCents(): number {
    return this.entries.reduce((sum, e) => sum + e.costCents, 0);
  }

  get totalDollars(): string {
    return (this.totalCents / 100).toFixed(4);
  }

  get requestCount(): number {
    return this.entries.length;
  }

  byProvider(): Record<string, Bucket> {
    return this.groupBy((e) => e.provider);
  }

  byModel(): Record<string, Bucket> {
    return this.groupBy((e) => e.model);
  }

  bySession(): Record<string, Bucket> {
    return this.groupBy((e) => e.sessionId || 'default');
  }

  summary(): string {
    const lines = [
      `LLMKit Cost Summary`,
      `---`,
      `Total: $${this.totalDollars} (${this.requestCount} requests)`,
      '',
    ];

    const providers = this.byProvider();
    if (Object.keys(providers).length > 1) {
      lines.push('By provider:');
      for (const [name, b] of Object.entries(providers)) {
        lines.push(`  ${name}: $${fmtCents(b.cents)} (${b.requests} reqs)`);
      }
      lines.push('');
    }

    const models = this.byModel();
    lines.push('By model:');
    for (const [name, b] of Object.entries(models)) {
      lines.push(`  ${name}: $${fmtCents(b.cents)} (${b.requests} reqs)`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.entries = [];
  }

  private emit(entry: CostEntry): void {
    if (this.shouldLog) {
      const cache = entry.cacheReadTokens > 0 ? `, ${entry.cacheReadTokens} cached` : '';
      console.log(
        `[llmkit] ${entry.provider}/${entry.model}: $${fmtCents(entry.costCents)} ` +
        `(${entry.inputTokens} in, ${entry.outputTokens} out${cache})`
      );
    }
    for (const fn of this.listeners) fn(entry);
  }

  private groupBy(keyFn: (e: CostEntry) => string): Record<string, Bucket> {
    const out: Record<string, Bucket> = {};
    for (const e of this.entries) {
      const key = keyFn(e);
      const b = out[key] || { cents: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
      b.cents += e.costCents;
      b.requests++;
      b.inputTokens += e.inputTokens;
      b.outputTokens += e.outputTokens;
      out[key] = b;
    }
    return out;
  }
}

function fmtCents(cents: number): string {
  return (cents / 100).toFixed(4);
}
