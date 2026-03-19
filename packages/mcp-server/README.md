# @f3d1/llmkit-mcp-server

AI cost tracking for Claude Code, Claude Desktop, and Cursor. 11 tools for spend queries, budgets, session costs, and agent attribution across 11 LLM providers.

Part of [LLMKit](https://github.com/smigolsmigol/llmkit), an open-source API gateway with cost tracking and budget enforcement.

## Quick start

Add to your `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"],
      "env": {
        "LLMKIT_API_KEY": "lk_your_key_here"
      }
    }
  }
}
```

The Claude Code tools (`llmkit_cc_*`) work immediately with no API key. They read local session data from `~/.claude/`. For the proxy tools, create a free key at the [dashboard](https://llmkit-dashboard.vercel.app).

## Tools

### Proxy tools (need API key)

| Tool | Title | What it does |
|------|-------|-------------|
| `llmkit_usage_stats` | Usage Stats | Spend, requests, top models for a period |
| `llmkit_cost_query` | Cost Breakdown | Costs grouped by provider, model, session, or day |
| `llmkit_budget_status` | Budget Status | Budget limits and remaining balance |
| `llmkit_session_summary` | Session Summary | Recent sessions with cost, duration, models |
| `llmkit_list_keys` | API Keys | All keys with status and creation date |
| `llmkit_health` | Health Check | Proxy ping with response time |

### Claude Code tools (no key needed)

| Tool | Title | What it does |
|------|-------|-------------|
| `llmkit_cc_session_cost` | Session Cost | Current session cost and token breakdown |
| `llmkit_cc_agent_costs` | Agent Costs | Per-agent cost attribution for subagents |
| `llmkit_cc_cache_savings` | Cache Savings | Prompt caching ROI and efficiency |
| `llmkit_cc_cost_forecast` | Cost Forecast | Monthly projection vs Max subscription |
| `llmkit_cc_project_costs` | Project Costs | Costs ranked by project directory |

All tools return both human-readable text and typed JSON (`structuredContent`) with full `outputSchema` definitions. Tool annotations declare all tools as read-only and idempotent.

## Interactive dashboard

`llmkit_cc_session_cost` includes an MCP App that renders an interactive cost dashboard directly in the chat. Hosts that support MCP Apps (Claude, Claude Desktop, VS Code, Goose) display stat cards, token breakdowns, and cost-by-model bar charts inline.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLMKIT_API_KEY` | No | LLMKit API key for proxy tools. Claude Code tools work without it. |
| `LLMKIT_PROXY_URL` | No | Proxy URL (defaults to hosted service) |
| `LLMKIT_DASHBOARD_URL` | No | Dashboard link shown in MCP App |

## Environment detection

The server detects the MCP client via `clientInfo` during initialization. Claude Desktop sees only the 6 proxy tools. Claude Code and Cursor see all 11 tools including the local `cc_*` tools.

## Examples

Try these prompts in Claude Code:

1. **"How much is this session costing me?"** - calls `llmkit_cc_session_cost`, returns cost breakdown by model with token counts. Renders an interactive dashboard via MCP App.

2. **"Which agents in this session are using the most tokens?"** - calls `llmkit_cc_agent_costs`, shows main conversation vs subagent cost split with per-agent attribution.

3. **"Show me my AI spend for the week, broken down by model"** - calls `llmkit_cost_query` (needs API key), returns cost per model with request counts and token totals.

Prompts 1 and 2 work immediately with no API key. Prompt 3 requires a free key from the [dashboard](https://llmkit-dashboard.vercel.app).

Sample output for prompt 1:

```
Claude Code Session Cost (API rates)
─────────────────────────
Session: 47cc0ca3-588...
Messages: 172
Estimated cost: $13.6463

Tokens: 2,886 in, 56,790 out
Cache: 16,485,655 read, 635,093 write

claude-opus-4-6: $13.6463 (2,886 in, 56,790 out)

Costs up to the previous message. Max subscribers pay a flat rate.
```

## MCP features

- Tool annotations on all tools (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `title`)
- `outputSchema` and `structuredContent` on every tool response
- Content annotations with `audience` and `priority`
- `clientInfo` detection: Claude Desktop gets 6 proxy tools, Claude Code/Cursor get all 11
- MCP App resource: interactive HTML dashboard rendered inline in chat

## License

MIT
