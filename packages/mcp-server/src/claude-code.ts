import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// per-million token rates (USD). only models used by Claude Code.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5-20251101': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
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

function resolvePricing(model: string) {
  let pricing = PRICING[model];
  if (!pricing) {
    const base = model.replace(/-\d{8}$/, '');
    pricing = PRICING[base];
  }
  return pricing ?? null;
}

function costForTokens(model: string, usage: TokenUsage): number {
  const pricing = resolvePricing(model);
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
    const model = msg.message.model ?? '';
    if (!model || model.startsWith('<')) return null;
    const u = msg.message.usage;
    return {
      model,
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
    const m = result.models[usage.model];
    if (m) {
      m.input += usage.input;
      m.output += usage.output;
      m.cacheRead += usage.cacheRead;
      m.cacheWrite += usage.cacheWrite;
      m.cost += cost;
    }

    result.totalInput += usage.input;
    result.totalOutput += usage.output;
    result.totalCacheRead += usage.cacheRead;
    result.totalCacheWrite += usage.cacheWrite;
    result.totalCost += cost;
  }

  return result;
}

async function parseOneAgent(subagentDir: string, filename: string): Promise<AgentCost | null> {
  const agentId = filename.replace('.jsonl', '');
  let agentType = 'unknown';

  try {
    const meta = await readFile(join(subagentDir, `${agentId}.meta.json`), 'utf-8');
    agentType = JSON.parse(meta).agentType ?? 'unknown';
  } catch { /* no meta file */ }

  let messages = 0;
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const modelsUsed = new Set<string>();

  const stream = createReadStream(join(subagentDir, filename), { encoding: 'utf-8' });
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

  if (messages === 0) return null;
  return { agentId: agentId.slice(0, 12), agentType, messages, totalCost, totalInput, totalOutput, models: [...modelsUsed] };
}

async function parseSubagents(projectDir: string, sessionId: string): Promise<AgentCost[]> {
  const subagentDir = join(projectDir, sessionId, 'subagents');
  const agents: AgentCost[] = [];

  try {
    const files = await readdir(subagentDir);
    const jsonls = files.filter(f => f.endsWith('.jsonl'));

    for (const f of jsonls) {
      const agent = await parseOneAgent(subagentDir, f);
      if (agent) agents.push(agent);
    }
  } catch { /* no subagents directory */ }

  agents.sort((a, b) => b.totalCost - a.totalCost);
  return agents;
}

export async function getSessionCost(transcriptPath?: string): Promise<SessionCost | null> {
  if (transcriptPath) return parseSessionJsonl(transcriptPath);

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

export interface CacheSavingsResult {
  totalSaved: number;
  overallReadToWrite: number;
  models: Record<string, { cacheRead: number; cacheWrite: number; savedUsd: number; readToWriteRatio: number }>;
}

export async function getCacheSavings(): Promise<CacheSavingsResult | null> {
  const projectDir = await findProjectDir();
  if (!projectDir) return null;

  const sessionFile = await findCurrentSessionFile(projectDir);
  if (!sessionFile) return null;

  const session = await parseSessionJsonl(sessionFile);
  const models: CacheSavingsResult['models'] = {};
  let totalSaved = 0;
  let totalRead = 0;
  let totalWrite = 0;

  for (const [model, data] of Object.entries(session.models)) {
    const pricing = resolvePricing(model);
    if (!pricing) continue;

    const fullCost = (data.cacheRead / 1_000_000) * pricing.input;
    const actualCost = (data.cacheRead / 1_000_000) * pricing.cacheRead;
    const saved = fullCost - actualCost;
    const ratio = data.cacheWrite > 0 ? data.cacheRead / data.cacheWrite : 0;

    models[model] = { cacheRead: data.cacheRead, cacheWrite: data.cacheWrite, savedUsd: saved, readToWriteRatio: ratio };
    totalSaved += saved;
    totalRead += data.cacheRead;
    totalWrite += data.cacheWrite;
  }

  return { totalSaved, overallReadToWrite: totalWrite > 0 ? totalRead / totalWrite : 0, models };
}

export interface CostForecastResult {
  projectedMonthly: number;
  dailyAverage: number;
  daysAnalyzed: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  savingsVsApi: number;
  topModels: Array<{ model: string; monthlyCost: number }>;
  dataFreshness: string;
}

interface ForecastAccumulator {
  modelTotals: Map<string, number>;
  totalCost: number;
  earliestDate: string;
  latestDate: string;
}

function accumulateSession(acc: ForecastAccumulator, session: SessionCost, mtimeMs: number): void {
  for (const [model, data] of Object.entries(session.models)) {
    acc.modelTotals.set(model, (acc.modelTotals.get(model) ?? 0) + data.cost);
  }
  acc.totalCost += session.totalCost;
  const dateStr = new Date(mtimeMs).toISOString().slice(0, 10);
  if (!acc.earliestDate || dateStr < acc.earliestDate) acc.earliestDate = dateStr;
  if (!acc.latestDate || dateStr > acc.latestDate) acc.latestDate = dateStr;
}

async function collectRecentSessionCosts(projectsDir: string, dirs: string[]): Promise<ForecastAccumulator> {
  const acc: ForecastAccumulator = { modelTotals: new Map(), totalCost: 0, earliestDate: '', latestDate: '' };
  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  for (const dir of dirs) {
    const sessionFile = await findCurrentSessionFile(join(projectsDir, dir));
    if (!sessionFile) continue;

    const s = await stat(sessionFile).catch(() => null);
    if (!s || s.mtimeMs < thirtyDaysAgo) continue;

    const session = await parseSessionJsonl(sessionFile);
    if (session.messages === 0) continue;

    accumulateSession(acc, session, s.mtimeMs);
  }

  return acc;
}

export async function getCostForecast(): Promise<CostForecastResult | null> {
  const projectsDir = join(claudeDir(), 'projects');
  let dirs: string[];
  try { dirs = await readdir(projectsDir); } catch { return null; }

  const acc = await collectRecentSessionCosts(projectsDir, dirs);
  if (acc.totalCost === 0) return null;

  const daySpan = acc.earliestDate && acc.latestDate
    ? Math.max(1, Math.ceil((new Date(acc.latestDate).getTime() - new Date(acc.earliestDate).getTime()) / 86400000) + 1)
    : 1;

  const dailyAverage = acc.totalCost / daySpan;
  const projectedMonthly = dailyAverage * 30;

  const topModels = [...acc.modelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([model, cost]) => ({ model, monthlyCost: (cost / daySpan) * 30 }));

  return {
    projectedMonthly,
    dailyAverage,
    daysAnalyzed: daySpan,
    trend: 'stable',
    savingsVsApi: Math.max(0, projectedMonthly - 200),
    topModels,
    dataFreshness: acc.latestDate ? `most recent data from ${acc.latestDate}` : 'no recent data',
  };
}

export interface ProjectCostResult {
  project: string;
  sessionCount: number;
  totalCostUsd: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  latestSession: { id: string; cost: number; messages: number; topModel: string; date: string };
}

function decodeProjectName(encoded: string): string {
  // Windows: C--user-project -> project
  const winMatch = encoded.match(/^[A-Z]--[^-]+-(.+)$/);
  if (winMatch?.[1]) return winMatch[1];
  // WSL: -mnt-c-f3d1-llmkit -> llmkit
  const wslMatch = encoded.match(/^-mnt-[a-z]-[^-]+-(.+)$/);
  if (wslMatch?.[1]) return wslMatch[1];
  return encoded;
}

function findAllProjectDirs(): string[] {
  const dirs: string[] = [];
  const primary = join(claudeDir(), 'projects');
  if (existsSync(primary)) dirs.push(primary);

  // on Windows, also check WSL distros via UNC paths
  if (process.platform === 'win32') {
    // path.resolve preserves UNC prefix, path.join does not
    const wslRoot = resolve('//wsl.localhost');
    try {
      const distros = readdirSync(wslRoot);
      for (const distro of distros) {
        try {
          const homesDir = resolve('//wsl.localhost', distro, 'home');
          const homes = readdirSync(homesDir);
          for (const user of homes) {
            const wslProjects = resolve('//wsl.localhost', distro, 'home', user, '.claude', 'projects');
            if (existsSync(wslProjects)) dirs.push(wslProjects);
          }
        } catch { /* can't read this distro's home */ }
      }
    } catch { /* WSL not available */ }
  }

  return dirs;
}

export async function getProjectCosts(): Promise<ProjectCostResult[]> {
  const projectDirs = findAllProjectDirs();
  if (projectDirs.length === 0) return [];

  const allResults: ProjectCostResult[] = [];
  for (const projectsDir of projectDirs) {
    let dirs: string[];
    try { dirs = await readdir(projectsDir); } catch { continue; }

  const parseProject = async (dir: string): Promise<ProjectCostResult | null> => {
    const projectDir = join(projectsDir, dir);
    let files: string[];
    try { files = await readdir(projectDir); } catch { return null; }

    const jsonls = files.filter(f => f.endsWith('.jsonl'));
    if (jsonls.length === 0) return null;

    // parse all sessions with a per-file timeout
    const parsed = await Promise.allSettled(
      jsonls.map(f => Promise.race([
        parseSessionJsonl(join(projectDir, f)),
        new Promise<null>(r => { setTimeout(() => r(null), 60000); }),
      ])),
    );

    const sessions = parsed
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter((s): s is SessionCost => s !== null && s.messages > 0);

    if (sessions.length === 0) return null;

    let totalCost = 0;
    let totalMessages = 0;
    let totalInput = 0;
    let totalOutput = 0;
    for (const s of sessions) {
      totalCost += s.totalCost;
      totalMessages += s.messages;
      totalInput += s.totalInput;
      totalOutput += s.totalOutput;
    }

    // latest session by mtime for the "latest" field
    const mtimes = await Promise.all(
      jsonls.map(async f => {
        const s = await stat(join(projectDir, f)).catch(() => null);
        return { file: f, mtime: s?.mtimeMs ?? 0 };
      }),
    );
    mtimes.sort((a, b) => b.mtime - a.mtime);
    const latest = sessions.find(s => mtimes[0]?.file.includes(s.sessionId)) ?? sessions[0]!;
    const latestMtime = mtimes[0]?.mtime ?? 0;
    const topModel = Object.entries(latest.models).sort(([, a], [, b]) => b.cost - a.cost)[0];

    return {
      project: decodeProjectName(dir),
      sessionCount: sessions.length,
      totalCostUsd: totalCost,
      totalMessages,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      latestSession: {
        id: latest.sessionId.slice(0, 12),
        cost: latest.totalCost,
        messages: latest.messages,
        topModel: topModel?.[0] ?? 'unknown',
        date: latestMtime ? new Date(latestMtime).toISOString().slice(0, 10) : 'unknown',
      },
    };
  };

    const settled = await Promise.allSettled(dirs.map(parseProject));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) allResults.push(r.value);
    }
  }

  // merge projects with the same decoded name (Windows + WSL duplicates)
  const merged = new Map<string, ProjectCostResult>();
  for (const p of allResults) {
    const existing = merged.get(p.project);
    if (existing) {
      existing.sessionCount += p.sessionCount;
      existing.totalCostUsd += p.totalCostUsd;
      existing.totalMessages += p.totalMessages;
      existing.totalInputTokens += p.totalInputTokens;
      existing.totalOutputTokens += p.totalOutputTokens;
      if (p.latestSession.date > existing.latestSession.date) {
        existing.latestSession = p.latestSession;
      }
    } else {
      merged.set(p.project, { ...p });
    }
  }

  const results = Array.from(merged.values());
  results.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return results;
}
