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
        "LLMKIT_SUPABASE_URL": "https://cwfjofyplyfjtanzavsm.supabase.co",
        "LLMKIT_SUPABASE_KEY": "your-anon-key",
        "LLMKIT_USER_ID": "your-user-id"
      }
    }
  }
}
```

Your user ID and Supabase credentials are on the Settings page in the dashboard.

## Tools

**llmkit_usage_stats** : Total spend, request count, top models, cache hit rate for a time period (today/week/month).

**llmkit_cost_query** : Cost breakdown grouped by provider, model, session, or day. Supports filtering by provider or model.

**llmkit_budget_status** : Current budget usage and remaining balance across all budgets or a specific one.

**llmkit_session_summary** : List recent agent sessions with request counts, costs, duration, and models used.

**llmkit_list_keys** : Show all API keys with status and creation date.

**llmkit_health** : Ping the LLMKit proxy to check if it's reachable (requires `LLMKIT_PROXY_URL` env var).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLMKIT_SUPABASE_URL` | Yes | Your Supabase project URL |
| `LLMKIT_SUPABASE_KEY` | Yes | Supabase anon key (read-only, safe to use locally) |
| `LLMKIT_USER_ID` | Yes | Your LLMKit account user ID |
| `LLMKIT_PROXY_URL` | No | Proxy URL for the health check tool |

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
