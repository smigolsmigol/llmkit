import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DASHBOARD_HTML, DASHBOARD_URL, RESOURCE_MIME, RESOURCE_URI } from './app.js';
import { handleLocalAgents, handleLocalCache, handleLocalForecast, handleLocalProjects, handleLocalSession } from './local-handlers.js';
import { loadNotionConfig } from './notion.js';
import { handleNotionBudgetCheck, handleNotionCostSnapshot, handleNotionSessionReport } from './notion-handlers.js';
import { fail, handleBudgetStatus, handleCostQuery, handleHealth, handleListKeys, handleSessionSummary, handleUsageStats, type ok } from './proxy-handlers.js';

// --- Tool schemas ---

const HINTS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const PROXY_TOOLS = [
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

export const LOCAL_TOOLS = [
  {
    name: 'llmkit_local_session',
    description: 'Current session cost across all detected AI coding tools (Claude Code, Cline). No API key needed.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        sessions: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, id: { type: 'string' }, cost: { type: 'number' }, messages: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, topModel: { type: 'string' } } } },
        totalCostUsd: { type: 'number' },
        sourceCount: { type: 'number' },
      },
      required: ['totalCostUsd', 'sourceCount'],
    },
    annotations: { title: 'Session Cost', ...HINTS },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  {
    name: 'llmkit_local_projects',
    description: 'Cumulative cost across all projects and sessions from all detected AI coding tools, ranked by spend.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projects: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, project: { type: 'string' }, sessionCount: { type: 'number' }, totalCost: { type: 'number' }, totalMessages: { type: 'number' }, topModel: { type: 'string' } } } },
        totalCostUsd: { type: 'number' },
      },
      required: ['projects', 'totalCostUsd'],
    },
    annotations: { title: 'Project Costs', ...HINTS },
  },
  {
    name: 'llmkit_local_cache',
    description: 'Cache savings analysis across all detected AI coding tools. Shows how much prompt caching saved.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        savings: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, totalSaved: { type: 'number' }, readToWriteRatio: { type: 'number' } } } },
        totalSavedUsd: { type: 'number' },
      },
      required: ['totalSavedUsd'],
    },
    annotations: { title: 'Cache Savings', ...HINTS },
  },
  {
    name: 'llmkit_local_forecast',
    description: 'Monthly cost projection based on local AI tool usage. Compares to Max subscription.',
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        projectedMonthlyUsd: { type: 'number' },
        dailyAverageUsd: { type: 'number' },
        totalTrackedUsd: { type: 'number' },
        totalSessions: { type: 'number' },
        maxSubscriptionSavingsUsd: { type: 'number' },
      },
      required: ['projectedMonthlyUsd', 'dailyAverageUsd'],
    },
    annotations: { title: 'Cost Forecast', ...HINTS },
  },
  {
    name: 'llmkit_local_agents',
    description: 'Subagent cost attribution for the current Claude Code session. Shows which agents cost the most.',
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
      },
      required: ['sessionId', 'totalCostUsd', 'agentCount'],
    },
    annotations: { title: 'Agent Costs', ...HINTS },
  },
];

const NOTION_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export const NOTION_TOOLS = [
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

export const HANDLER_MAP: Record<string, Handler> = {
  llmkit_usage_stats: handleUsageStats,
  llmkit_cost_query: handleCostQuery,
  llmkit_list_keys: () => handleListKeys(),
  llmkit_budget_status: handleBudgetStatus,
  llmkit_health: () => handleHealth(),
  llmkit_session_summary: handleSessionSummary,
  llmkit_local_session: () => handleLocalSession(),
  llmkit_local_projects: () => handleLocalProjects(),
  llmkit_local_cache: () => handleLocalCache(),
  llmkit_local_forecast: () => handleLocalForecast(),
  llmkit_local_agents: () => handleLocalAgents(),
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
      ...(isDesktop ? [] : LOCAL_TOOLS),
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
