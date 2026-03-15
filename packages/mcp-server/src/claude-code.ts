import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

// per-million token rates (USD). only models used by Claude Code.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5-20251022': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

export interface TokenUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SessionCost {
  sessionId: string;
  messages: number;
  models: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
}

export interface AgentCost {
  agentId: string;
  agentType: string;
  messages: number;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  models: string[];
}

function claudeDir(): string {
  return join(homedir(), '.claude');
}

function costForTokens(model: string, usage: TokenUsage): number {
  // strip date suffixes for matching (e.g. claude-opus-4-6-20260101 -> claude-opus-4-6)
  let pricing = PRICING[model];
  if (!pricing) {
    const base = model.replace(/-\d{8}$/, '');
    pricing = PRICING[base];
  }
  if (!pricing) return 0;

  return (
    (usage.input / 1_000_000) * pricing.input +
    (usage.output / 1_000_000) * pricing.output +
    (usage.cacheRead / 1_000_000) * pricing.cacheRead +
    (usage.cacheWrite / 1_000_000) * pricing.cacheWrite
  );
}

function extractUsage(line: string): TokenUsage | null {
  try {
    const msg = JSON.parse(line);
    if (msg?.type !== 'assistant' || !msg?.message?.usage) return null;
    const u = msg.message.usage;
    return {
      model: msg.message.model ?? 'unknown',
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

async function findProjectDir(): Promise<string | null> {
  const projectsDir = join(claudeDir(), 'projects');
  try {
    const dirs = await readdir(projectsDir);
    const cwd = process.cwd();
    const encoded = encodePath(cwd);

    // exact match first
    for (const dir of dirs) {
      if (dir === encoded) return join(projectsDir, dir);
    }

    // case-insensitive match
    for (const dir of dirs) {
      if (dir.toLowerCase() === encoded.toLowerCase()) return join(projectsDir, dir);
    }

    // partial match fallback (handles slight encoding differences)
    for (const dir of dirs) {
      if (dir.toLowerCase().includes(encoded.toLowerCase().slice(-20))) {
        return join(projectsDir, dir);
      }
    }
  } catch { /* projects dir doesn't exist */ }
  return null;
}

async function findCurrentSessionFile(projectDir: string): Promise<string | null> {
  try {
    const files = await readdir(projectDir);
    const jsonls = files.filter(f => f.endsWith('.jsonl') && !f.includes('/'));

    if (!jsonls.length) return null;

    // find most recently modified
    let latest = '';
    let latestTime = 0;
    for (const f of jsonls) {
      const s = await stat(join(projectDir, f));
      if (s.mtimeMs > latestTime) {
        latestTime = s.mtimeMs;
        latest = f;
      }
    }
    return latest ? join(projectDir, latest) : null;
  } catch {
    return null;
  }
}

async function parseSessionJsonl(filePath: string): Promise<SessionCost> {
  const sessionId = filePath.split(/[/\\]/).pop()?.replace('.jsonl', '') ?? 'unknown';
  const result: SessionCost = {
    sessionId,
    messages: 0,
    models: {},
    totalCost: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    // fast check before JSON.parse
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;

    const usage = extractUsage(line);
    if (!usage) continue;

    result.messages++;
    const cost = costForTokens(usage.model, usage);

    if (!result.models[usage.model]) {
      result.models[usage.model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    }
    const m = result.models[usage.model]!;
    m.input += usage.input;
    m.output += usage.output;
    m.cacheRead += usage.cacheRead;
    m.cacheWrite += usage.cacheWrite;
    m.cost += cost;

    result.totalInput += usage.input;
    result.totalOutput += usage.output;
    result.totalCacheRead += usage.cacheRead;
    result.totalCacheWrite += usage.cacheWrite;
    result.totalCost += cost;
  }

  return result;
}

async function parseSubagents(projectDir: string, sessionId: string): Promise<AgentCost[]> {
  const subagentDir = join(projectDir, sessionId, 'subagents');
  const agents: AgentCost[] = [];

  try {
    const files = await readdir(subagentDir);
    const jsonls = files.filter(f => f.endsWith('.jsonl'));

    for (const f of jsonls) {
      const agentId = f.replace('.jsonl', '');
      let agentType = 'unknown';

      // read meta file for agent type
      try {
        const meta = await readFile(join(subagentDir, `${agentId}.meta.json`), 'utf-8');
        const parsed = JSON.parse(meta);
        agentType = parsed.agentType ?? 'unknown';
      } catch { /* no meta file */ }

      const filePath = join(subagentDir, f);
      let messages = 0;
      let totalCost = 0;
      let totalInput = 0;
      let totalOutput = 0;
      const modelsUsed = new Set<string>();

      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
        const usage = extractUsage(line);
        if (!usage) continue;

        messages++;
        totalCost += costForTokens(usage.model, usage);
        totalInput += usage.input;
        totalOutput += usage.output;
        modelsUsed.add(usage.model);
      }

      if (messages > 0) {
        agents.push({
          agentId: agentId.slice(0, 12),
          agentType,
          messages,
          totalCost,
          totalInput,
          totalOutput,
          models: [...modelsUsed],
        });
      }
    }
  } catch { /* no subagents directory */ }

  // sort by cost descending
  agents.sort((a, b) => b.totalCost - a.totalCost);
  return agents;
}

export async function getSessionCost(): Promise<SessionCost | null> {
  const projectDir = await findProjectDir();
  if (!projectDir) return null;

  const sessionFile = await findCurrentSessionFile(projectDir);
  if (!sessionFile) return null;

  return parseSessionJsonl(sessionFile);
}

export async function getAgentCosts(): Promise<{ session: SessionCost; agents: AgentCost[]; mainConversationCost: number } | null> {
  const projectDir = await findProjectDir();
  if (!projectDir) return null;

  const sessionFile = await findCurrentSessionFile(projectDir);
  if (!sessionFile) return null;

  const session = await parseSessionJsonl(sessionFile);
  const sessionId = session.sessionId;
  const agents = await parseSubagents(projectDir, sessionId);

  const agentTotalCost = agents.reduce((s, a) => s + a.totalCost, 0);
  const mainConversationCost = session.totalCost - agentTotalCost;

  return { session, agents, mainConversationCost };
}
