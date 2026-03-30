import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GetPromptRequestSchema, ListPromptsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools.js';

const PROMPTS = [
  {
    name: 'cost-report',
    description: 'Generate a cost report for a time period',
    arguments: [{ name: 'period', description: 'Time period: today, week, or month', required: false }],
  },
  {
    name: 'budget-check',
    description: 'Check all budgets and warn about any approaching limits',
    arguments: [],
  },
  {
    name: 'session-summary',
    description: 'Summarize costs and usage for the current coding session',
    arguments: [],
  },
];

const PROMPT_MESSAGES: Record<string, (args: Record<string, string>) => { role: string; content: { type: string; text: string } }[]> = {
  'cost-report': (args) => [
    { role: 'user', content: { type: 'text', text: `Generate a cost report for ${args.period || 'this month'}. Use llmkit_usage_stats to get spend data, then llmkit_cost_query grouped by model to show where money is going. Highlight the most expensive models and any anomalies.` } },
  ],
  'budget-check': () => [
    { role: 'user', content: { type: 'text', text: 'Check all my budgets using llmkit_budget_status. For any budget above 70% usage, warn me. For any above 90%, flag it as critical. Suggest adjustments if needed.' } },
  ],
  'session-summary': () => [
    { role: 'user', content: { type: 'text', text: 'Summarize my current coding session costs using llmkit_session_cost. Show total spend, tokens used, cache savings, and cost per model. Compare to my typical session if you have historical data from llmkit_usage_stats.' } },
  ],
};

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: 'llmkit', version: '0.4.5' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerTools(server);

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const name = req.params.name;
    const fn = PROMPT_MESSAGES[name];
    if (!fn) throw new Error(`Unknown prompt: ${name}`);
    return { messages: fn(req.params.arguments ?? {}) };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
