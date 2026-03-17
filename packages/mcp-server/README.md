# @f3d1/llmkit-mcp-server

Query your AI API costs from Claude Code or Cursor. See spend by model, session, or time range without leaving your editor.

Part of [LLMKit](https://github.com/smigolsmigol/llmkit), an open-source API gateway that tracks costs and enforces budgets across 11 LLM providers.

## Setup

1. Create a free account at [dashboard-two-zeta-54.vercel.app](https://dashboard-two-zeta-54.vercel.app)
2. Create an API key in the Keys tab
3. Add the server to your Claude Code or Cursor config:

```json
{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"],
      "env": {
        "LLMKIT_API_KEY": "llmk_your_key_here"
      }
    }
  }
}
```

Paste into `.mcp.json` (project root) for Claude Code, or `.cursor/mcp.json` for Cursor.

## Tools

### Proxy tools (require LLMKIT_API_KEY)

**llmkit_usage_stats** : Total spend, request count, top models, cache hit rate for a time period (today/week/month).

**llmkit_cost_query** : Cost breakdown grouped by provider, model, session, or day. Supports filtering by provider or model.

**llmkit_budget_status** : Current budget usage and remaining balance across all budgets or a specific one.

**llmkit_session_summary** : List recent agent sessions with request counts, costs, duration, and models used.

**llmkit_list_keys** : Show all API keys with status and creation date.

**llmkit_health** : Ping the LLMKit proxy to check if it's reachable.

### Claude Code tools (no API key needed)

**llmkit_cc_session_cost** : Current Claude Code session cost and token usage.

**llmkit_cc_agent_costs** : Cost breakdown per agent/task in the current session.

**llmkit_cc_cache_savings** : Prompt caching savings and hit rate for the session.

**llmkit_cc_cost_forecast** : Projected cost for the session based on current usage rate.

**llmkit_cc_project_costs** : Historical Claude Code costs for the current project.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLMKIT_API_KEY` | Yes | Your LLMKit API key |
| `LLMKIT_PROXY_URL` | No | Proxy URL (defaults to `https://llmkit-proxy.smigolsmigol.workers.dev`) |

## Example

Ask Claude Code: "How much have I spent on AI this week?"

```
LLMKit Usage (week)
---
Requests: 47
Total spend: $0.34
Input tokens: 128,400
Output tokens: 24,100
Cache hit rate: 42.1%

Top models:
  gpt-4o-mini: 31 requests
  claude-sonnet-4-20250514: 12 requests
  deepseek-chat: 4 requests
```

## License

MIT
