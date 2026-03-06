import { DurableObject } from 'cloudflare:workers';

export interface HitInput {
  limit: number;
}

export interface HitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
}

export class RateLimitDO extends DurableObject {
  private count = 0;
  private window = 0;
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.count = (await this.ctx.storage.get<number>('count')) ?? 0;
    this.window = (await this.ctx.storage.get<number>('window')) ?? 0;
    this.loaded = true;
  }

  async hit(input: HitInput): Promise<HitResult> {
    await this.load();

    const currentMinute = Math.floor(Date.now() / 60_000);

    if (currentMinute !== this.window) {
      this.window = currentMinute;
      this.count = 0;
    }

    if (this.count >= input.limit) {
      const secondsLeft = 60 - (Math.floor(Date.now() / 1000) % 60);
      return {
        allowed: false,
        count: this.count,
        limit: input.limit,
        remaining: 0,
        retryAfterSeconds: secondsLeft,
      };
    }

    this.count++;
    await this.ctx.storage.put({ count: this.count, window: this.window });

    return {
      allowed: true,
      count: this.count,
      limit: input.limit,
      remaining: input.limit - this.count,
    };
  }
}
