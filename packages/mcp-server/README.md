# @f3d1/llmkit-mcp-server

AI cost inspection for supported Claude Code sessions and Cline task data found in VS Code-family
storage. Eleven tools cover local session evidence, authenticated gateway spend, and budget queries.

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

The local tools (`llmkit_local_*`) need no API key. They read supported Claude Code sessions and
Cline task data from supported editor storage. Proxy tools require an existing LLMKit API key in
`LLMKIT_API_KEY`. Check [llmkit.sh](https://llmkit.sh) for current account and service availability.

See the [MCP guide](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/mcp.md) for all 11 tools, environment variables,
supported storage and the SessionEnd hook. Read the
[privacy policy](https://github.com/smigolsmigol/llmkit/blob/main/packages/mcp-server/MCP_PRIVACY.md) before enabling filesystem inspection.

## License

[MIT](https://github.com/smigolsmigol/llmkit/blob/main/LICENSE)
