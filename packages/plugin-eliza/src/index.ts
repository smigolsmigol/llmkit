import type { Plugin } from '@elizaos/core';
import { CostTracker } from './cost-tracker.js';
import type { BudgetConfig } from './cost-tracker.js';
import { createCostProvider } from './provider.js';
import { createCheckBudgetAction } from './actions/check-budget.js';
import { createCostReportAction } from './actions/cost-report.js';

export type { TrackedRequest, SessionCosts, BudgetConfig } from './cost-tracker.js';
export { CostTracker } from './cost-tracker.js';

export interface LLMKitPluginConfig {
  /** Budget limit in USD. Default: 10 */
  budgetLimitUsd?: number;
  /** Warn when budget usage exceeds this percentage. Default: 80 */
  budgetWarnPct?: number;
  /** LLMKit proxy base URL. When set, enables proxy mode (reads x-llmkit-cost header). */
  proxyUrl?: string;
}

/**
 * Create the LLMKit cost tracking plugin for ElizaOS.
 *
 * The returned tracker instance can be used to record costs from
 * either proxy headers or local estimation. The plugin injects a
 * CostProvider into agent state and registers budget/report actions.
 */
export function createLLMKitPlugin(config?: LLMKitPluginConfig): {
  plugin: Plugin;
  tracker: CostTracker;
} {
  const budget: Partial<BudgetConfig> = {};
  if (config?.budgetLimitUsd !== undefined) budget.limitUsd = config.budgetLimitUsd;
  if (config?.budgetWarnPct !== undefined) budget.warnAtPct = config.budgetWarnPct;

  const tracker = new CostTracker(budget);

  const plugin: Plugin = {
    name: 'llmkit',
    description: 'LLMKit cost tracking, budget enforcement, and spending reports for ElizaOS agents',

    config: {
      proxyUrl: config?.proxyUrl ?? '',
      budgetLimitUsd: config?.budgetLimitUsd ?? 10,
      budgetWarnPct: config?.budgetWarnPct ?? 80,
    },

    providers: [createCostProvider(tracker)],

    actions: [
      createCheckBudgetAction(tracker),
      createCostReportAction(tracker),
    ],
  };

  return { plugin, tracker };
}

/** Convenience: pre-built plugin with default config ($10 budget) */
export const llmkitPlugin = createLLMKitPlugin().plugin;
