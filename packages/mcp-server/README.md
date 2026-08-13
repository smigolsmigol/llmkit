# @f3d1/llmkit-mcp-server

AI cost inspection for supported Claude Code sessions and Cline task data discovered in VS Code-family storage. Eleven tools cover local session evidence plus authenticated gateway spend and budget queries.

Part of [LLMKit](https://github.com/smigolsmigol/llmkit), an open-source API gateway with cost tracking and budget enforcement.

## Quick start

Add to your `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["-y", "@f3d1/llmkit-mcp-server"]
    }
  }
}
```

The local tools (`llmkit_local_*`) need no API key. They read supported Claude Code sessions and Cline task data found in supported editor storage. Proxy tools require an existing LLMKit API key in `LLMKIT_API_KEY`; check [llmkit.sh](https://llmkit.sh) for current account and service availability.

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
| `llmkit_local_session` | Current Claude Code session or latest detected Cline task cost |
| `llmkit_local_projects` | Cumulative cost across all projects and sessions |
| `llmkit_local_cache` | Prompt caching savings analysis |
| `llmkit_local_forecast` | 30-day API-rate projection from detected local history |
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

The local tools read data from:
- Claude Code (`~/.claude/projects/`)
- Cline extension storage in VS Code, Insiders, VSCodium, Cursor, and Windsurf
- WSL installations (scans all distros via UNC paths on Windows)
- VS Code, Cursor, and Windsurf server directories for supported remote extension storage

## License

MIT
