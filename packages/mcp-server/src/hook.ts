// Claude Code SessionEnd hook handler.
// Parses session transcript, prints cost summary to stderr (visible to user).
// Usage: npx @f3d1/llmkit-mcp-server --hook

import { getSessionCost } from './claude-code.js';

export async function runHook(): Promise<void> {
  let input: { session_id?: string; transcript_path?: string } = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    // no stdin or invalid JSON, still try local session data
  }

  const session = await getSessionCost(input.transcript_path);
  if (!session) return;

  const cost = session.totalCost;
  const tokens = session.totalInput + session.totalOutput + session.totalCacheRead + session.totalCacheWrite;
  const models = Object.keys(session.models).join(', ');

  process.stderr.write(
    `\n  session cost: $${cost.toFixed(4)} | ${session.messages} msgs | ${(tokens / 1000).toFixed(0)}k tokens | ${models}\n`,
  );
}
