#!/usr/bin/env node
import { createRequire } from 'node:module';
import { startServer } from './server.js';

const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require('../package.json') as { version: string }).version;

if (process.argv.includes('--hook')) {
  import('./hook.js').then(m => m.runHook()).catch(() => process.exit(1));
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
} else {
  // Print a short notice to stderr. MCP clients ignore stderr, but
  // a human running this directly will see it and know what's happening.
  process.stderr.write('llmkit: MCP server starting (stdin/stdout JSON-RPC). Run with --help for setup info.\n');

  // If stdin looks like a terminal (not piped from an MCP client),
  // also show full setup instructions and exit.
  if (process.stdin.isTTY) {
    process.stderr.write('\n');
    printUsage();
  } else {
    // Set a 3-second timeout: if no MCP protocol data arrives,
    // this is probably a human who ran it without a pipe.
    const timeout = setTimeout(() => {
      process.stderr.write('\nllmkit: no MCP client detected after 3s. Run with --help for setup instructions.\n');
      process.exit(0);
    }, 3000);
    // If stdin gets data (MCP client connected), cancel the timeout
    process.stdin.once('data', () => clearTimeout(timeout));
    process.stdin.once('end', () => clearTimeout(timeout));

    startServer().catch((err) => {
      clearTimeout(timeout);
      process.stderr.write(`llmkit: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
  }
}

function printUsage(): void {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const purple = (s: string) => `\x1b[38;5;177m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

  process.stderr.write(`
  ${purple('LLMKit MCP Server')} ${dim(`v${PKG_VERSION}`)}

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

  Then ask your AI assistant: ${dim('"how much did this session cost?"')}

  ${dim('Docs: https://llmkit-dashboard.vercel.app/mcp')}
  ${dim('Source: https://github.com/smigolsmigol/llmkit')}

`);
}
