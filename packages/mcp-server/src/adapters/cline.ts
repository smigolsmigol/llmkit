// Cline (VS Code extension) adapter. Reads task data from VS Code globalStorage.
// Zero coupling to claude-code.ts or any other adapter.

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LocalAdapter, LocalCacheSavings, LocalProjectSummary, LocalSession } from './types.js';

// Cline's ClineApiReqInfo shape (from ExtensionMessage.ts)
interface ClineApiReq {
  tokensIn?: number;
  tokensOut?: number;
  cacheReads?: number;
  cacheWrites?: number;
  cost?: number;
}

interface ClineMessage {
  ts: number;
  type: 'ask' | 'say';
  say?: string;
  text?: string;
}

// --- Path detection ---

function getBasePath(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

const VARIANTS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];
const EXTENSION_ID = 'saoudrizwan.claude-dev';

function findClineDataDirs(): { variant: string; path: string }[] {
  const override = process.env.LLMKIT_CLINE_DIR;
  if (override && existsSync(join(override, 'tasks'))) {
    return [{ variant: 'custom', path: override }];
  }

  const base = getBasePath();
  const found: { variant: string; path: string }[] = [];
  for (const v of VARIANTS) {
    const p = join(base, v, 'User', 'globalStorage', EXTENSION_ID);
    if (existsSync(join(p, 'tasks'))) found.push({ variant: v, path: p });
  }
  return found;
}

let cachedDirs: { variant: string; path: string }[] | null = null;

function getClineDirs(): { variant: string; path: string }[] {
  if (cachedDirs !== null) return cachedDirs;
  cachedDirs = findClineDataDirs();
  return cachedDirs;
}

// --- Task parsing ---

interface ParsedTask {
  taskId: string;
  variant: string;
  cost: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheReads: number;
  cacheWrites: number;
  model: string;
  timestamp: string;
}

async function parseTask(taskDir: string, taskId: string, variant: string): Promise<ParsedTask | null> {
  const uiPath = join(taskDir, 'ui_messages.json');
  let raw: string;
  try { raw = await readFile(uiPath, 'utf-8'); } catch { return null; }

  let msgs: ClineMessage[];
  try { msgs = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(msgs) || msgs.length === 0) return null;

  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let reqCount = 0;
  let model = 'unknown';

  for (const msg of msgs) {
    if (msg.say !== 'api_req_finished' || !msg.text) continue;

    let info: ClineApiReq;
    try { info = JSON.parse(msg.text); } catch { continue; }

    reqCount++;
    totalCost += info.cost ?? 0;
    totalIn += info.tokensIn ?? 0;
    totalOut += info.tokensOut ?? 0;
    totalCacheRead += info.cacheReads ?? 0;
    totalCacheWrite += info.cacheWrites ?? 0;
  }

  // extract model from api_req_started messages
  for (const msg of msgs) {
    if (msg.say !== 'api_req_started' || !msg.text) continue;
    try {
      const info = JSON.parse(msg.text);
      if (info.model) { model = info.model; break; }
    } catch { /* skip */ }
  }

  if (reqCount === 0) return null;

  const s = await stat(uiPath).catch(() => null);
  return {
    taskId,
    variant,
    cost: totalCost,
    messages: reqCount,
    tokensIn: totalIn,
    tokensOut: totalOut,
    cacheReads: totalCacheRead,
    cacheWrites: totalCacheWrite,
    model,
    timestamp: s ? new Date(s.mtimeMs).toISOString().slice(0, 10) : 'unknown',
  };
}

async function getAllTasks(): Promise<ParsedTask[]> {
  const dirs = getClineDirs();
  const all: ParsedTask[] = [];

  for (const { variant, path } of dirs) {
    const tasksDir = join(path, 'tasks');
    let taskIds: string[];
    try { taskIds = await readdir(tasksDir); } catch { continue; }

    const parsed = await Promise.allSettled(
      taskIds.map(id => Promise.race([
        parseTask(join(tasksDir, id), id, variant),
        new Promise<null>(r => { setTimeout(() => r(null), 10000); }),
      ])),
    );

    for (const r of parsed) {
      if (r.status === 'fulfilled' && r.value) all.push(r.value);
    }
  }

  return all;
}

// --- Adapter ---

export const clineAdapter: LocalAdapter = {
  name: 'Cline',

  async detect() {
    return getClineDirs().length > 0;
  },

  async getCurrentSession() {
    // Cline doesn't have a "current session" concept like Claude Code.
    // Return the most recently modified task.
    const tasks = await getAllTasks();
    if (tasks.length === 0) return null;

    tasks.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const t = tasks[0]!;

    return {
      source: `Cline (${t.variant})`,
      id: t.taskId,
      project: process.cwd().split(/[/\\]/).pop() ?? 'unknown',
      cost: t.cost,
      messages: t.messages,
      inputTokens: t.tokensIn,
      outputTokens: t.tokensOut,
      cacheReadTokens: t.cacheReads,
      cacheWriteTokens: t.cacheWrites,
      topModel: t.model,
      timestamp: t.timestamp,
    } satisfies LocalSession;
  },

  async getProjects() {
    // Cline tasks don't map to "projects" the same way CC does.
    // Group tasks by VS Code variant as a project proxy.
    const tasks = await getAllTasks();
    if (tasks.length === 0) return [];

    const byVariant = new Map<string, ParsedTask[]>();
    for (const t of tasks) {
      const key = t.variant;
      const arr = byVariant.get(key) ?? [];
      arr.push(t);
      byVariant.set(key, arr);
    }

    const results: LocalProjectSummary[] = [];
    for (const [variant, vtasks] of byVariant) {
      let totalCost = 0;
      let totalMessages = 0;
      let totalIn = 0;
      let totalOut = 0;
      let latestTs = '';
      let topModel = 'unknown';
      let topCost = 0;

      for (const t of vtasks) {
        totalCost += t.cost;
        totalMessages += t.messages;
        totalIn += t.tokensIn;
        totalOut += t.tokensOut;
        if (t.timestamp > latestTs) latestTs = t.timestamp;
        if (t.cost > topCost) { topCost = t.cost; topModel = t.model; }
      }

      results.push({
        source: `Cline (${variant})`,
        project: `Cline (${variant})`,
        sessionCount: vtasks.length,
        totalCost,
        totalMessages,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        latestTimestamp: latestTs,
        topModel,
      });
    }

    return results;
  },

  async getCacheSavings() {
    const tasks = await getAllTasks();
    if (tasks.length === 0) return null;

    let totalRead = 0;
    let totalWrite = 0;
    for (const t of tasks) {
      totalRead += t.cacheReads;
      totalWrite += t.cacheWrites;
    }

    if (totalWrite === 0) return null;

    // approximate savings: cache reads cost 0.1x input price, vs 1x if not cached
    const savedFactor = 0.9; // 90% savings per cached token
    const avgInputPrice = 5 / 1_000_000; // rough average, $5 per 1M
    const saved = totalRead * avgInputPrice * savedFactor;

    return {
      source: 'Cline',
      totalSaved: saved,
      readToWriteRatio: totalWrite > 0 ? totalRead / totalWrite : 0,
      models: [], // Cline doesn't break down cache by model in the task data
    } satisfies LocalCacheSavings;
  },
};
