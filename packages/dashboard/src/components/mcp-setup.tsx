'use client';

import { useState } from 'react';

interface McpSetupProps {
  apiKeyPlaceholder?: string;
}

export function McpSetup({ apiKeyPlaceholder }: McpSetupProps) {
  const [copied, setCopied] = useState(false);

  const config = JSON.stringify({
    mcpServers: {
      llmkit: {
        command: 'npx',
        args: ['@f3d1/llmkit-mcp-server'],
        env: {
          LLMKIT_API_KEY: apiKeyPlaceholder || 'llmk_your_key_here',
        },
      },
    },
  }, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">MCP Server</h2>
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Query your costs from Claude Code or Cursor. Use the same API key you created in the Keys tab.
        </p>
        <div className="relative mt-4">
          <pre className="overflow-x-auto rounded-md bg-secondary/50 p-4 text-xs font-mono text-primary">
            {config}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-2 top-2 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Paste into <code className="text-primary">.mcp.json</code> (project root) for
          Claude Code, or <code className="text-primary">.cursor/mcp.json</code> for Cursor.
        </p>
      </div>
    </div>
  );
}
