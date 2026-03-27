# @f3d1/llmkit-mcp-server

AI cost tracking for Claude Code, Cline, Cursor, and Claude Desktop. 11 tools for spend queries, budgets, local session costs, and agent attribution across 11 LLM providers.

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
        "LLMKIT_API_KEY": "llmk_your_key_here"
      }
    }
  }
}
```

The local tools (`llmkit_local_*`) work immediately with no API key. They auto-detect Claude Code, Cline, and Cursor data on your machine. For the proxy tools, create a free key at the [dashboard](https://llmkit-dashboard.vercel.app).

## Tools

### Proxy tools (need API key)

| Tool | What it does |
|------|-------------|
| `llmkit_usage_stats` | Spend, requests, top models for a period |
| `llmkit_cost_query` | Costs grouped by provider, model, session, or day |
| `llmkit_budget_status` | Budget limits and remaining balance |
| `llmkit_session_summary` | Recent sessions with cost, duration, models |
| `llmkit_list_keys` | All keys with status and creation date |
| `llmkit_health` | Proxy ping with response time |

### Local tools (no key needed)

Auto-detect installed AI coding tools and aggregate data from all of them.

| Tool | What it does |
|------|-------------|
| `llmkit_local_session` | Current session cost across all detected tools |
| `llmkit_local_projects` | Cumulative cost across all projects and sessions |
| `llmkit_local_cache` | Prompt caching savings analysis |
| `llmkit_local_forecast` | Monthly projection vs Max subscription |
| `llmkit_local_agents` | Subagent cost attribution (Claude Code) |

### SessionEnd hook

Auto-log session costs when Claude Code exits:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "npx @f3d1/llmkit-mcp-server --hook"
      }
    ]
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLMKIT_API_KEY` | No | API key for proxy tools. Local tools work without it. |
| `LLMKIT_PROXY_URL` | No | Proxy URL (defaults to hosted service) |
| `LLMKIT_CLINE_DIR` | No | Override Cline data directory path |

## Supported tools

The local tools detect data from:
- Claude Code (`~/.claude/projects/`)
- Cline (VS Code, Insiders, VSCodium, Cursor, Windsurf globalStorage)
- WSL installations (scans all distros via UNC paths on Windows)
- VS Code Server / Cursor Server (remote SSH/WSL extensions)

## License

MIT
