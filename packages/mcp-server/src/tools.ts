import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DASHBOARD_HTML, DASHBOARD_URL, RESOURCE_MIME, RESOURCE_URI } from './app.js';
import { handleCCAgentCosts, handleCCCacheSavings, handleCCCostForecast, handleCCProjectCosts, handleCCSessionCost } from './cc-handlers.js';
import { loadNotionConfig } from './notion.js';
import { handleNotionBudgetCheck, handleNotionCostSnapshot, handleNotionSessionReport } from './notion-handlers.js';
import { fail, handleBudgetStatus, handleCostQuery, handleHealth, handleListKeys, handleSessionSummary, handleUsageStats, type ok } from './proxy-handlers.js';

// --- Tool schemas ---

const HINTS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const PROXY_TOOLS = [
  {
    name: 'llmkit_usage_stats',
    description: 'Get usage statistics (spend, requests, top models) for a time period',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Time period', default: 'month' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string' },
        requests: { type: 'number' },
        totalSpendUsd: { type: 'number' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        cacheReadTokens: { type: 'number' },
        cacheHitRate: { type: 'number' },
        topModels: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, requests: { type: 'number' } } } },
      },
      required: ['period', 'requests', 'totalSpendUsd'],
    },
    annotations: { title: 'Usage Stats', ...HINTS },
  },
  {
    name: 'llmkit_cost_query',
    description: 'Query cost breakdown grouped by provider, model, session, or day',
    inputSchema: {
      type: 'object' as const,
      properties: {
        groupBy: { type: 'string', enum: ['provider', 'model', 'session', 'day'], description: 'How to group results' },
        days: { type: 'number', description: 'Days to look back (default 30)' },
        provider: { type: 'string', description: 'Filter by provider' },
        model: { type: 'string', description: 'Filter by model' },
      },
      required: ['groupBy'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        groupBy: { type: 'string' },
        days: { type: 'number' },
        breakdown: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, costUsd: { type: 'number' }, requests: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' } } } },
      },
      required: ['groupBy', 'days', 'breakdown'],
    },
    annotations: { title: 'Cost Breakdown', ...HINTS },
  },
  {
    name: 'llmkit_list_keys',
    description: 'List all API keys with status and creation date',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        keys: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, prefix: { type: 'string' }, status: { type: 'string' }, created: { type: 'string' } } } },
      },
      required: ['keys'],
    },
    annotations: { title: 'API Keys', ...HINTS },
  },
  {
    name: 'llmkit_budget_status',
    description: 'Check budget limits and remaining balance',
    inputSchema: {
      type: 'object' as const,
      properties: {
        budgetId: { type: 'string', description: 'Specific budget ID, or omit for all' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        budgets: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, limitUsd: { type: 'number' }, period: { type: 'string' } } } },
      },
      required: ['budgets'],
    },
    annotations: { title: 'Budget Status', ...HINTS },
  },
  {
    name: 'llmkit_health',
    description: 'Check proxy health and response time',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded', 'unreachable'] },
        responseTimeMs: { type: 'number' },
      },
      required: ['status'],
    },
    annotations: { title: 'Health Check', ...HINTS },
  },
  {
    name: 'llmkit_session_summary',
    description: 'Get recent proxy sessions with cost, duration, and models used',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Specific session ID' },
        limit: { type: 'number', description: 'Number of sessions (default 10)' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessions: { type: 'array', items: { type: 'object', properties: { sessionId: { type: 'string' }, requests: { type: 'number' }, costUsd: { type: 'number' }, durationMinutes: { type: 'number' }, providers: { type: 'array', items: { type: 'string' } }, models: { type: 'array', items: { type: 'string' } } } } },
      },
      required: ['sessions'],
    },
    annotations: { title: 'Session Summary', ...HINTS },
  },
];

const CC_TOOLS = [
  {
    name: 'llmkit_cc_session_cost',
    description: 'Estimated cost of the current Claude Code session at API rates. Reads local token data.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        messages: { type: 'number' },
        totalCostUsd: { type: 'number' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        cacheReadTokens: { type: 'number' },
        cacheWriteTokens: { type: 'number' },
        models: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, costUsd: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' } } } },
      },
      required: ['sessionId', 'messages', 'totalCostUsd'],
    },
    annotations: { title: 'Session Cost', ...HINTS },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  {
    name: 'llmkit_cc_agent_costs',
    description: 'Cost attribution for subagents in the current session. Shows which agents cost the most.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        totalCostUsd: { type: 'number' },
        mainConversationCostUsd: { type: 'number' },
        subagentsTotalCostUsd: { type: 'number' },
        agentCount: { type: 'number' },
        byType: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, count: { type: 'number' }, costUsd: { type: 'number' }, tokens: { type: 'number' } } } },
        topAgents: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string' }, costUsd: { type: 'number' }, messages: { type: 'number' }, models: { type: 'array', items: { type: 'string' } } } } },
      },
      required: ['sessionId', 'totalCostUsd', 'agentCount'],
    },
    annotations: { title: 'Agent Costs', ...HINTS },
  },
  {
    name: 'llmkit_cc_cache_savings',
    description: 'How much prompt caching saved in the current session vs full-price tokens.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        totalSavedUsd: { type: 'number' },
        cacheEfficiency: { type: 'number' },
        models: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, savedUsd: { type: 'number' }, readToWriteRatio: { type: 'number' }, cacheReadTokens: { type: 'number' }, cacheWriteTokens: { type: 'number' } } } },
      },
      required: ['totalSavedUsd', 'cacheEfficiency'],
    },
    annotations: { title: 'Cache Savings', ...HINTS },
  },
  {
    name: 'llmkit_cc_cost_forecast',
    description: 'Monthly cost projection based on recent sessions. Compares to Max subscription.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projectedMonthlyUsd: { type: 'number' },
        dailyAverageUsd: { type: 'number' },
        daysAnalyzed: { type: 'number' },
        trend: { type: 'string', enum: ['increasing', 'decreasing', 'stable'] },
        maxSubscriptionSavingsUsd: { type: 'number' },
        topModels: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, monthlyCostUsd: { type: 'number' } } } },
        dataFreshness: { type: 'string' },
      },
      required: ['projectedMonthlyUsd', 'dailyAverageUsd', 'daysAnalyzed', 'trend'],
    },
    annotations: { title: 'Cost Forecast', ...HINTS },
  },
  {
    name: 'llmkit_cc_project_costs',
    description: 'Cumulative cost breakdown across all Claude Code projects and sessions, ranked by total spend.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projects: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sessionCount: { type: 'number' }, totalCostUsd: { type: 'number' }, totalMessages: { type: 'number' }, totalInputTokens: { type: 'number' }, totalOutputTokens: { type: 'number' }, latestCostUsd: { type: 'number' }, topModel: { type: 'string' }, date: { type: 'string' } } } },
      },
      required: ['projects'],
    },
    annotations: { title: 'Project Costs', ...HINTS },
  },
];

const NOTION_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

const NOTION_TOOLS = [
  {
    name: 'llmkit_notion_cost_snapshot',
    description: 'Sync cost data to a Notion page. Creates a formatted snapshot with spend, tokens, and model breakdown.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Time period', default: 'month' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        notionUrl: { type: 'string' },
        period: { type: 'string' },
        spendUsd: { type: 'number' },
        requests: { type: 'number' },
      },
      required: ['notionUrl', 'period', 'spendUsd'],
    },
    annotations: { title: 'Notion: Cost Snapshot', ...NOTION_HINTS },
  },
  {
    name: 'llmkit_notion_budget_check',
    description: 'Sync budget status to Notion with approval workflow. Creates a page with budget limits, usage, and a checkbox for human approval.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        budgetId: { type: 'string', description: 'Specific budget ID, or omit for all' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        notionUrl: { type: 'string' },
        budgetCount: { type: 'number' },
        warnings: { type: 'number' },
      },
      required: ['notionUrl', 'budgetCount'],
    },
    annotations: { title: 'Notion: Budget Check', ...NOTION_HINTS },
  },
  {
    name: 'llmkit_notion_session_report',
    description: 'Sync session cost report to Notion. Creates a page with per-session breakdown, duration, and model usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', enum: ['proxy', 'local'], description: 'Data source: proxy API or local Claude Code data', default: 'proxy' },
        sessionId: { type: 'string', description: 'Specific session ID (proxy only)' },
        limit: { type: 'number', description: 'Max sessions to include (default 10)' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        notionUrl: { type: 'string' },
        source: { type: 'string' },
        sessionCount: { type: 'number' },
        totalCostUsd: { type: 'number' },
      },
      required: ['notionUrl', 'source', 'sessionCount'],
    },
    annotations: { title: 'Notion: Session Report', ...NOTION_HINTS },
  },
];

// --- Routing ---

type Args = Record<string, unknown> | undefined;
type ToolResponse = ReturnType<typeof ok> | ReturnType<typeof fail>;
type Handler = (args: Args) => Promise<ToolResponse>;

const HANDLER_MAP: Record<string, Handler> = {
  llmkit_usage_stats: handleUsageStats,
  llmkit_cost_query: handleCostQuery,
  llmkit_list_keys: () => handleListKeys(),
  llmkit_budget_status: handleBudgetStatus,
  llmkit_health: () => handleHealth(),
  llmkit_session_summary: handleSessionSummary,
  llmkit_cc_session_cost: () => handleCCSessionCost(),
  llmkit_cc_agent_costs: () => handleCCAgentCosts(),
  llmkit_cc_cache_savings: () => handleCCCacheSavings(),
  llmkit_cc_cost_forecast: () => handleCCCostForecast(),
  llmkit_cc_project_costs: () => handleCCProjectCosts(),
  llmkit_notion_cost_snapshot: handleNotionCostSnapshot,
  llmkit_notion_budget_check: handleNotionBudgetCheck,
  llmkit_notion_session_report: handleNotionSessionReport,
};

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const clientInfo = server.getClientVersion();
    const clientName = clientInfo?.name?.toLowerCase() ?? '';
    const isDesktop = clientName.includes('desktop') && !clientName.includes('code');
    const tools = [
      ...PROXY_TOOLS,
      ...(isDesktop ? [] : CC_TOOLS),
      ...(loadNotionConfig() ? NOTION_TOOLS : []),
    ];
    return { tools };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: RESOURCE_URI, name: 'Session Cost Dashboard', mimeType: RESOURCE_MIME }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === RESOURCE_URI) {
      const html = DASHBOARD_HTML.replace('__DASHBOARD_URL__', DASHBOARD_URL);
      return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME, text: html }] };
    }
    throw new Error(`Unknown resource: ${request.params.uri}`);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLER_MAP[name];
    if (!handler) return fail(`Unknown tool: ${name}`);
    try {
      return await handler(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
