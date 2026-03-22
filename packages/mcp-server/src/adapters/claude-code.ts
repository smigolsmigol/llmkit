// Claude Code adapter. Wraps existing claude-code.ts parsing logic.

import { getCacheSavings, getProjectCosts, getSessionCost } from '../claude-code.js';
import type { LocalAdapter, LocalCacheSavings, LocalProjectSummary, LocalSession } from './types.js';

export const claudeCodeAdapter: LocalAdapter = {
  name: 'Claude Code',

  async detect() {
    const session = await getSessionCost().catch(() => null);
    return session !== null;
  },

  async getCurrentSession() {
    const session = await getSessionCost();
    if (!session) return null;

    const topModel = Object.entries(session.models).sort(([, a], [, b]) => b.cost - a.cost)[0];

    return {
      source: 'Claude Code',
      id: session.sessionId,
      project: process.cwd().split(/[/\\]/).pop() ?? 'unknown',
      cost: session.totalCost,
      messages: session.messages,
      inputTokens: session.totalInput,
      outputTokens: session.totalOutput,
      cacheReadTokens: session.totalCacheRead,
      cacheWriteTokens: session.totalCacheWrite,
      topModel: topModel?.[0] ?? 'unknown',
      timestamp: new Date().toISOString(),
    } satisfies LocalSession;
  },

  async getProjects() {
    const projects = await getProjectCosts();
    return projects.map(p => ({
      source: 'Claude Code',
      project: p.project,
      sessionCount: p.sessionCount,
      totalCost: p.totalCostUsd,
      totalMessages: p.totalMessages,
      totalInputTokens: p.totalInputTokens,
      totalOutputTokens: p.totalOutputTokens,
      latestTimestamp: p.latestSession.date,
      topModel: p.latestSession.topModel,
    } satisfies LocalProjectSummary));
  },

  async getCacheSavings() {
    const savings = await getCacheSavings();
    if (!savings) return null;

    return {
      source: 'Claude Code',
      totalSaved: savings.totalSaved,
      readToWriteRatio: savings.overallReadToWrite,
      models: Object.entries(savings.models).map(([model, d]) => ({
        model,
        saved: d.savedUsd,
        cacheRead: d.cacheRead,
        cacheWrite: d.cacheWrite,
        ratio: d.readToWriteRatio,
      })),
    } satisfies LocalCacheSavings;
  },
};
