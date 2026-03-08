import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

export async function startServer(): Promise<void> {
  // Server constructor takes: identity + capabilities
  // capabilities.tools = {} means "I expose tools" (no extra config needed)
  const server = new Server(
    { name: 'llmkit', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerTools(server);

  // stdio transport: reads JSON-RPC from stdin, writes to stdout
  // this is the standard transport for CLI-spawned MCP servers
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
