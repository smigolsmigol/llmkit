import type {
  Action,
  ActionResult,
  IAgentRuntime,
  Memory,
} from '@elizaos/core';
import type { CostTracker } from '../cost-tracker.js';

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function createCheckBudgetAction(tracker: CostTracker): Action {
  return {
    name: 'CHECK_BUDGET',
    description: 'Check current LLMKit budget status, remaining balance, and spending rate',
    similes: [
      'check my budget',
      'how much budget left',
      'budget status',
      'am I over budget',
      'spending limit',
    ],

    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

    handler: async (
      _runtime: IAgentRuntime,
      message: Memory,
    ): Promise<ActionResult> => {
      const summary = tracker.getSummary();
      const budget = tracker.getBudget();
      const roomId = message.roomId ?? 'default';
      const session = tracker.getSession(roomId);

      const lines: string[] = [];

      if (tracker.isOverBudget()) {
        lines.push(`Budget EXCEEDED. Spent ${formatUsd(summary.totalCost)} of ${formatUsd(budget.limitUsd)} limit.`);
      } else if (tracker.isNearBudget()) {
        lines.push(`Budget warning: ${summary.budgetUsedPct.toFixed(1)}% used. ${formatUsd(summary.remainingUsd)} remaining of ${formatUsd(budget.limitUsd)}.`);
      } else {
        lines.push(`Budget healthy. Spent ${formatUsd(summary.totalCost)} of ${formatUsd(budget.limitUsd)} (${summary.budgetUsedPct.toFixed(1)}%).`);
      }

      lines.push(`Remaining: ${formatUsd(summary.remainingUsd)}`);

      if (session) {
        lines.push(`This conversation: ${formatUsd(session.totalCost)} across ${session.requests.length} requests.`);
      }

      if (summary.totalRequests > 0) {
        const avgCost = summary.totalCost / summary.totalRequests;
        const estimatedLeft = budget.limitUsd > 0
          ? Math.floor(summary.remainingUsd / avgCost)
          : Infinity;
        lines.push(`Avg cost/request: ${formatUsd(avgCost)}. Estimated requests remaining: ${estimatedLeft === Infinity ? 'unlimited' : estimatedLeft}.`);
      }

      return {
        success: true,
        text: lines.join('\n'),
        values: {
          budgetLimit: formatUsd(budget.limitUsd),
          budgetUsed: formatUsd(summary.totalCost),
          budgetRemaining: formatUsd(summary.remainingUsd),
          budgetPct: summary.budgetUsedPct.toFixed(1),
          overBudget: tracker.isOverBudget(),
        },
        data: {
          totalCost: summary.totalCost,
          budgetLimit: budget.limitUsd,
          remaining: summary.remainingUsd,
          usedPct: summary.budgetUsedPct,
          overBudget: tracker.isOverBudget(),
          nearBudget: tracker.isNearBudget(),
        },
      };
    },

    examples: [
      [
        {
          name: 'user',
          content: { text: "What's my budget looking like?" },
        },
        {
          name: 'agent',
          content: { text: 'Budget healthy. Spent $0.1234 of $10.0000 (1.2%). Remaining: $9.8766' },
        },
      ],
    ],
  };
}
