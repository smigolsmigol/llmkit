#!/usr/bin/env node
import { startServer } from './server.js';

if (process.argv.includes('--hook')) {
  import('./hook.js').then(m => m.runHook()).catch(() => process.exit(1));
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
} else if (process.stdin.isTTY) {
  printUsage();
} else {
  startServer().catch((err) => {
    process.stderr.write(`llmkit: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

function printUsage(): void {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const purple = (s: string) => `\x1b[38;5;177m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

  process.stderr.write(`
  ${purple('LLMKit MCP Server')} ${dim('v0.4.1')}

  ${bold('This is an MCP server.')} It connects to Claude Code, Cursor, or Cline
  through the MCP protocol. It's not meant to be run directly.

  ${cyan('Setup for Claude Code:')}

  Add to ${dim('.mcp.json')} in your project root:

  ${dim('{')}
    ${dim('"mcpServers": {')}
      ${dim('"llmkit": {')}
        ${dim('"command": "npx",')}
        ${dim('"args": ["@f3d1/llmkit-mcp-server"]')}
      ${dim('}')}
    ${dim('}')}
  ${dim('}')}

  ${cyan('Setup for Cursor:')}

  Add to ${dim('.cursor/mcp.json')} in your project root (same format).

  ${cyan('What you get:')}

  5 local tools (no API key needed):
    session cost, project costs, cache savings, monthly forecast, subagent attribution

  6 proxy tools (needs LLMKIT_API_KEY):
    usage stats, cost query, budget status, session summary, API keys, health check

  3 Notion tools (needs NOTION_TOKEN):
    cost snapshot, budget check, session report

  Then ask your AI assistant: ${dim('"how much did this session cost?"')}

  ${dim('Docs: https://llmkit-dashboard.vercel.app/mcp')}
  ${dim('Source: https://github.com/smigolsmigol/llmkit')}

`);
}
