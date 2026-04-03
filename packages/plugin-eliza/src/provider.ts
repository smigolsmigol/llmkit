import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { CostTracker } from './cost-tracker.js';

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function createCostProvider(tracker: CostTracker): Provider {
  return {
    name: 'llmkit-cost',
    description: 'Injects LLMKit cost tracking data into agent context',
    dynamic: true,

    get: async (
      _runtime: IAgentRuntime,
      message: Memory,
      _state: State,
    ): Promise<ProviderResult> => {
      const summary = tracker.getSummary();
      const budget = tracker.getBudget();

      // derive session from roomId if present
      const roomId = message.roomId ?? 'default';
      const session = tracker.getSession(roomId);
      const sessionCost = session?.totalCost ?? 0;
      const sessionRequests = session?.requests.length ?? 0;

      let budgetStatus = 'OK';
      if (tracker.isOverBudget()) {
        budgetStatus = 'EXCEEDED';
      } else if (tracker.isNearBudget()) {
        budgetStatus = `WARNING (${summary.budgetUsedPct.toFixed(1)}% used)`;
      }

      const text = [
        '# LLMKit Cost Tracking',
        `- Total spend: ${formatUsd(summary.totalCost)}`,
        `- Budget: ${formatUsd(budget.limitUsd)} (${budgetStatus})`,
        `- Remaining: ${formatUsd(summary.remainingUsd)}`,
        `- This session: ${formatUsd(sessionCost)} across ${sessionRequests} requests`,
        `- All sessions: ${summary.sessionCount} sessions, ${summary.totalRequests} requests, ${summary.totalTokens} tokens`,
      ].join('\n');

      return {
        text,
        values: {
          costSoFar: formatUsd(summary.totalCost),
          costBudget: formatUsd(budget.limitUsd),
          costRemaining: formatUsd(summary.remainingUsd),
          costBudgetPct: summary.budgetUsedPct.toFixed(1),
          costBudgetStatus: budgetStatus,
          costSessionTotal: formatUsd(sessionCost),
          costSessionRequests: sessionRequests,
          costTotalRequests: summary.totalRequests,
          costTotalTokens: summary.totalTokens,
        },
        data: {
          totalCost: summary.totalCost,
          budgetLimit: budget.limitUsd,
          remaining: summary.remainingUsd,
          budgetUsedPct: summary.budgetUsedPct,
          overBudget: tracker.isOverBudget(),
          sessionCost,
          sessionRequests,
          totalRequests: summary.totalRequests,
          totalTokens: summary.totalTokens,
          sessionCount: summary.sessionCount,
        },
      };
    },
  };
}
