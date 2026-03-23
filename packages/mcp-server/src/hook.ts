// Claude Code SessionEnd hook handler.
// Parses session transcript, prints cost summary to stderr (visible to user).
// Usage: npx @f3d1/llmkit-mcp-server --hook

import { homedir } from 'node:os';
import { getSessionCost } from './claude-code.js';

function isValidTranscriptPath(p: string): boolean {
  const claudeDir = `${homedir()}/.claude/`;
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith(claudeDir.replace(/\\/g, '/')) && norm.endsWith('.jsonl');
}

export async function runHook(): Promise<void> {
  let input: { session_id?: string; transcript_path?: string } = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    // no stdin or invalid JSON, still try local session data
  }

  const transcriptPath = input.transcript_path && isValidTranscriptPath(input.transcript_path)
    ? input.transcript_path
    : undefined;

  const session = await getSessionCost(transcriptPath);
  if (!session) return;

  const cost = session.totalCost;
  const tokens = session.totalInput + session.totalOutput;
  const models = Object.keys(session.models).join(', ');

  process.stderr.write(
    `\n  session cost: $${cost.toFixed(4)} | ${session.messages} msgs | ${(tokens / 1000).toFixed(0)}k tokens | ${models}\n`,
  );
}
