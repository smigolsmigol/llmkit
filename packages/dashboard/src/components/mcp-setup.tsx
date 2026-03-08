'use client';

import { useState } from 'react';

interface McpSetupProps {
  userId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function McpSetup({ userId, supabaseUrl, supabaseAnonKey }: McpSetupProps) {
  const [copied, setCopied] = useState(false);

  const config = JSON.stringify({
    mcpServers: {
      llmkit: {
        command: 'npx',
        args: ['@f3d1/llmkit-mcp-server'],
        env: {
          LLMKIT_SUPABASE_URL: supabaseUrl,
          LLMKIT_SUPABASE_KEY: supabaseAnonKey,
          LLMKIT_USER_ID: userId,
        },
      },
    },
  }, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!supabaseUrl || !supabaseAnonKey) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">MCP Server</h2>
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Add this to your Claude Code or Cursor MCP config to query costs from your editor.
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
