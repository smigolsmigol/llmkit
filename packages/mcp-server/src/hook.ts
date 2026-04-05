// Claude Code SessionEnd hook handler.
// Parses session transcript, prints cost summary to stderr (visible to user).
// Usage: npx @f3d1/llmkit-mcp-server --hook

import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { getSessionCost } from './claude-code.js';

function isValidTranscriptPath(p: string): boolean {
  const claudeDir = `${resolve(homedir(), '.claude').replace(/\\/g, '/')}/`;
  const norm = resolve(p).replace(/\\/g, '/');
  if (!norm.startsWith(claudeDir) || !norm.endsWith('.jsonl')) return false;
  try {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) return false;
    const real = realpathSync(p).replace(/\\/g, '/');
    return real.startsWith(claudeDir);
  } catch {
    return false;
  }
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
