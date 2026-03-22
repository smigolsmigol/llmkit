// Shared types for local AI tool cost tracking adapters.
// Each adapter (Claude Code, Cline, Aider) implements LocalAdapter.

export interface LocalSession {
  source: string;
  id: string;
  project: string;
  cost: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  topModel: string;
  timestamp: string;
}

export interface LocalProjectSummary {
  source: string;
  project: string;
  sessionCount: number;
  totalCost: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  latestTimestamp: string;
  topModel: string;
}

export interface LocalCacheSavings {
  source: string;
  totalSaved: number;
  readToWriteRatio: number;
  models: {
    model: string;
    saved: number;
    cacheRead: number;
    cacheWrite: number;
    ratio: number;
  }[];
}

export interface LocalAdapter {
  name: string;
  detect(): Promise<boolean>;
  getCurrentSession(): Promise<LocalSession | null>;
  getProjects(): Promise<LocalProjectSummary[]>;
  getCacheSavings(): Promise<LocalCacheSavings | null>;
}
