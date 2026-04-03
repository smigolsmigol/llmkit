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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function createCostReportAction(tracker: CostTracker): Action {
  return {
    name: 'COST_REPORT',
    description: 'Generate a detailed cost report with per-session and per-model breakdowns',
    similes: [
      'cost report',
      'spending summary',
      'how much have I spent',
      'show costs',
      'cost breakdown',
    ],

    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

    handler: async (
      _runtime: IAgentRuntime,
      _message: Memory,
    ): Promise<ActionResult> => {
      const summary = tracker.getSummary();

      if (summary.totalRequests === 0) {
        return {
          success: true,
          text: 'No requests tracked yet. Cost data will appear after the first LLM call.',
        };
      }

      const lines: string[] = [
        `Cost report: ${formatUsd(summary.totalCost)} total across ${summary.totalRequests} requests.`,
        `Tokens used: ${formatTokens(summary.totalTokens)}`,
        '',
      ];

      // per-model breakdown
      const modelCosts = new Map<string, { cost: number; reqs: number; tokens: number }>();
      for (const sid of tracker.getSessionIds()) {
        const session = tracker.getSession(sid);
        if (!session) continue;
        for (const req of session.requests) {
          const key = `${req.provider}/${req.model}`;
          const existing = modelCosts.get(key) ?? { cost: 0, reqs: 0, tokens: 0 };
          existing.cost += req.cost.totalCost;
          existing.reqs += 1;
          existing.tokens += req.usage.totalTokens;
          modelCosts.set(key, existing);
        }
      }

      if (modelCosts.size > 0) {
        lines.push('By model:');
        const sorted = [...modelCosts.entries()].sort((a, b) => b[1].cost - a[1].cost);
        for (const [model, data] of sorted) {
          lines.push(`  ${model}: ${formatUsd(data.cost)} (${data.reqs} reqs, ${formatTokens(data.tokens)} tokens)`);
        }
        lines.push('');
      }

      // per-session summary
      const sessionIds = tracker.getSessionIds();
      if (sessionIds.length > 1) {
        lines.push(`Sessions: ${sessionIds.length}`);
        for (const sid of sessionIds) {
          const session = tracker.getSession(sid);
          if (!session) continue;
          const label = sid.length > 12 ? `${sid.slice(0, 12)}...` : sid;
          lines.push(`  ${label}: ${formatUsd(session.totalCost)} (${session.requests.length} reqs)`);
        }
      }

      return {
        success: true,
        text: lines.join('\n'),
        values: {
          totalCost: formatUsd(summary.totalCost),
          totalRequests: summary.totalRequests,
          totalTokens: summary.totalTokens,
          sessionCount: summary.sessionCount,
        },
        data: {
          totalCost: summary.totalCost,
          totalRequests: summary.totalRequests,
          totalTokens: summary.totalTokens,
          sessionCount: summary.sessionCount,
          modelBreakdown: Object.fromEntries(modelCosts),
        },
      };
    },

    examples: [
      [
        {
          name: 'user',
          content: { text: 'Give me a cost report' },
        },
        {
          name: 'agent',
          content: {
            text: 'Cost report: $1.2345 total across 47 requests.\nTokens used: 125.3K\n\nBy model:\n  openai/gpt-4o: $0.8900 (30 reqs, 98.1K tokens)\n  anthropic/claude-sonnet-4-20250514: $0.3445 (17 reqs, 27.2K tokens)',
          },
        },
      ],
    ],
  };
}
