import {
  calculateCostBreakdown,
  inferProvider,
} from '@f3d1/llmkit-shared';
import type {
  CostBreakdown,
  ProviderName,
  TokenUsage,
} from '@f3d1/llmkit-shared';

export interface TrackedRequest {
  model: string;
  provider: ProviderName;
  usage: TokenUsage;
  cost: CostBreakdown;
  timestamp: number;
  sessionId: string;
}

export interface SessionCosts {
  sessionId: string;
  requests: TrackedRequest[];
  totalCost: number;
  totalTokens: number;
  startedAt: number;
}

export interface BudgetConfig {
  limitUsd: number;
  warnAtPct: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  limitUsd: 10,
  warnAtPct: 80,
};

export class CostTracker {
  private sessions = new Map<string, SessionCosts>();
  private budget: BudgetConfig;
  private globalCost = 0;

  constructor(budget?: Partial<BudgetConfig>) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  /**
   * Record a cost from the x-llmkit-cost response header (proxy mode).
   * Returns the tracked request for chaining.
   */
  recordFromHeader(
    sessionId: string,
    model: string,
    costUsd: number,
    usage: TokenUsage,
    provider?: ProviderName,
  ): TrackedRequest {
    const resolved = provider ?? inferProvider(model) ?? 'openai';
    const cost: CostBreakdown = {
      inputCost: 0,
      outputCost: 0,
      totalCost: costUsd,
      currency: 'USD',
    };
    return this.record(sessionId, model, resolved, usage, cost);
  }

  /**
   * Estimate cost locally from token usage (local mode).
   * Uses @f3d1/llmkit-shared pricing tables.
   */
  recordFromUsage(
    sessionId: string,
    model: string,
    usage: TokenUsage,
    provider?: ProviderName,
  ): TrackedRequest {
    const resolved = provider ?? inferProvider(model) ?? 'openai';
    const cost = calculateCostBreakdown(resolved, model, usage);
    return this.record(sessionId, model, resolved, usage, cost);
  }

  private record(
    sessionId: string,
    model: string,
    provider: ProviderName,
    usage: TokenUsage,
    cost: CostBreakdown,
  ): TrackedRequest {
    const entry: TrackedRequest = {
      model,
      provider,
      usage,
      cost,
      timestamp: Date.now(),
      sessionId,
    };

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        requests: [],
        totalCost: 0,
        totalTokens: 0,
        startedAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    }

    session.requests.push(entry);
    session.totalCost += cost.totalCost;
    session.totalTokens += usage.totalTokens;
    this.globalCost += cost.totalCost;

    return entry;
  }

  getSession(sessionId: string): SessionCosts | undefined {
    return this.sessions.get(sessionId);
  }

  getGlobalCost(): number {
    return this.globalCost;
  }

  getBudget(): BudgetConfig {
    return { ...this.budget };
  }

  setBudget(budget: Partial<BudgetConfig>): void {
    this.budget = { ...this.budget, ...budget };
  }

  getRemainingBudget(): number {
    return Math.max(0, this.budget.limitUsd - this.globalCost);
  }

  getBudgetPct(): number {
    if (this.budget.limitUsd <= 0) return 100;
    return (this.globalCost / this.budget.limitUsd) * 100;
  }

  isOverBudget(): boolean {
    return this.globalCost >= this.budget.limitUsd;
  }

  isNearBudget(): boolean {
    return this.getBudgetPct() >= this.budget.warnAtPct;
  }

  getSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  getSummary(): {
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
    sessionCount: number;
    budgetUsedPct: number;
    remainingUsd: number;
  } {
    let totalRequests = 0;
    let totalTokens = 0;
    for (const session of this.sessions.values()) {
      totalRequests += session.requests.length;
      totalTokens += session.totalTokens;
    }
    return {
      totalCost: this.globalCost,
      totalRequests,
      totalTokens,
      sessionCount: this.sessions.size,
      budgetUsedPct: Math.min(100, this.getBudgetPct()),
      remainingUsd: this.getRemainingBudget(),
    };
  }

  reset(): void {
    this.sessions.clear();
    this.globalCost = 0;
  }
}
