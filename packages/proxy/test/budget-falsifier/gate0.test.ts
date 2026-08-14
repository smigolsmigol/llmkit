import {
  createExecutionContext,
  evictAllDurableObjects,
  reset,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../src/crypto';
import { supabaseServiceHeaders } from '../../src/db';
import { type BudgetDO, type BudgetState, RESERVATION_TTL_MS } from '../../src/do/budget-do';
import { IDEMPOTENCY_PENDING_LEASE_MS } from '../../src/do/idempotency-do';
import {
  attachReceiptResponseHash,
  estimateCost,
  finalizeReservationFailure,
  recordUsage,
  sendAlert,
} from '../../src/middleware/budget';
import { trackRequest } from '../../src/middleware/logger';
import { resolveCost } from '../../src/pricing';
import { resolveProviderChain } from '../../src/providers/chain';
import {
  MAX_PROVIDER_EXECUTION_MS,
  PROVIDER_REQUEST_TIMEOUT_MS,
  providerRequestSignal,
} from '../../src/providers/request';
import type { FailingRecordBudgetDO, SoftBudgetDO, SoftSnapshot } from './worker';

declare const __GATE0_REPEAT_START__: number;
declare const __GATE0_REPEAT_COUNT__: number;

interface ReservationRecord {
  amount: number;
  sessionId?: string;
  createdAt: number;
}

interface HardSnapshot {
  root?: BudgetState;
  reservations: Array<{ id: string; amount: number }>;
}

interface ProviderCrossing {
  requestId: string;
  requestedMaxTokens?: number;
  actualOutputTokens: number;
  failed: boolean;
}

interface ProviderKeyFixture {
  id: string;
  user_id: string;
  provider: string;
  encrypted_key: string;
  iv: string;
  key_prefix: string;
  key_name: string;
  created_at: string;
}

interface HttpDecision {
  requestId: string;
  status: number;
}

interface ProofRun {
  scenario: string;
  repeat: number;
  variant: 'hard' | 'soft';
  budgetId: string;
  requestCount: number;
  limitCents: number;
  decisions: HttpDecision[];
  providerCrossings: ProviderCrossing[];
  beforeProviderCompletion: HardSnapshot | SoftSnapshot;
  finalLedger: HardSnapshot | SoftSnapshot;
  invariantBeforeProviderCompletion: boolean;
  invariantAtFinalLedger: boolean;
  capturedSettledCents: number;
  ledgerMatchesCapturedCost: boolean;
  supportedRequestShape: boolean;
  claimClassification: 'hard-dollar-boundary' | 'estimated-cost-boundary';
}

const receipt: {
  schemaVersion: number;
  gate: string;
  source: string;
  fixture: Record<string, unknown>;
  coordination: Record<string, unknown>;
  runs: ProofRun[];
  integrationChecks: Array<Record<string, unknown>>;
  computedVerdict?: Record<string, unknown>;
} = {
  schemaVersion: 1,
  gate: 'LLMKit Gate 0 captured-provider dollar boundary',
  source: 'origin/main 62d67ae baseline first, then bounded repair with hashed dirty material',
  fixture: {
    model: 'gpt-4o-mini',
    requestMaxOutputTokens: 150_000,
    expectedReservationCents: 10,
    burstRequests: 100,
    leaseReservations: 10,
    isolatedRepeats: 20,
  },
  coordination: {
    hard: 'production SQLite-backed BudgetDO using explicit storage transactions for admission and settlement',
    soft: 'test-only SQLite-backed SoftBudgetDO using the same per-budget identity and explicit storage transactions',
    soleDifference: 'hard reserves the upper bound before provider dispatch; soft records actual cost after provider response',
  },
  runs: [],
  integrationChecks: [],
};

const emitReceipt = console.log.bind(console);

class ProviderBarrier {
  readonly crossings: ProviderCrossing[] = [];
  readonly attempts: Array<{ host: string; authorization: string | null; hasAbortSignal: boolean }> = [];
  readonly persistedRequests: Array<Record<string, unknown>> = [];
  dbWriteAttempts = 0;
  private readonly failures: Set<string>;
  private readonly failedHosts: Set<string>;
  private readonly outputTokens: Map<string, number>;
  private readonly providerCosts: Map<string, number>;
  private readonly responseOutputs: Map<string, Array<{ type: string; name?: string; id?: string }>>;
  private dbWriteFailuresRemaining: number;
  private releaseProvider!: () => void;
  private readonly providerReleased = new Promise<void>((resolve) => {
    this.releaseProvider = resolve;
  });

  constructor(input?: {
    failures?: Iterable<string>;
    failedHosts?: Iterable<string>;
    outputTokens?: Map<string, number>;
    providerCosts?: Map<string, number>;
    responseOutputs?: Map<string, Array<{ type: string; name?: string; id?: string }>>;
    dbWriteFailures?: number;
  }) {
    this.failures = new Set(input?.failures);
    this.failedHosts = new Set(input?.failedHosts);
    this.outputTokens = input?.outputTokens ?? new Map();
    this.providerCosts = input?.providerCosts ?? new Map();
    this.responseOutputs = input?.responseOutputs ?? new Map();
    this.dbWriteFailuresRemaining = input?.dbWriteFailures ?? 0;
  }

  release(): void {
    this.releaseProvider();
  }

  restoreDatabase(): void {
    this.dbWriteFailuresRemaining = 0;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'proof-db.invalid') {
      if (request.method === 'POST' && url.pathname.endsWith('/requests')) {
        this.dbWriteAttempts += 1;
        if (this.dbWriteFailuresRemaining > 0) {
          this.dbWriteFailuresRemaining -= 1;
          return new Response('captured database outage', { status: 503 });
        }
        this.persistedRequests.push(await request.json<Record<string, unknown>>());
        return new Response(null, { status: 201 });
      }
      const filter = url.searchParams.get('provider');
      const provider = filter?.startsWith('eq.') ? filter.slice(3) : filter;
      const stored = provider ? storedProviderKeys.get(provider) : undefined;
      return Response.json(stored ? [stored] : []);
    }

    const path = url.pathname;
    const isChat = path.endsWith('/chat/completions');
    const isResponses = path.endsWith('/responses');
    if (!isChat && !isResponses) {
      throw new Error(`unexpected outbound request: ${request.url}`);
    }
    const body = await request.json<Record<string, unknown>>();
    const firstMessage = Array.isArray(body.messages) ? body.messages[0] as Record<string, unknown> | undefined : undefined;
    const requestId = typeof firstMessage?.content === 'string'
      ? firstMessage.content
      : typeof body.input === 'string'
        ? body.input
        : 'missing';
    const actualOutputTokens = this.outputTokens.get(requestId) ?? 150_000;
    const providerCostUsd = this.providerCosts.get(requestId);
    const providerCostUsage = providerCostUsd === undefined
      ? {}
      : { cost_in_usd_ticks: Math.round(providerCostUsd * 10_000_000_000) };
    const failed = this.failures.has(requestId) || this.failedHosts.has(url.hostname);
    this.attempts.push({
      host: url.hostname,
      authorization: request.headers.get('authorization'),
      hasAbortSignal: init?.signal instanceof AbortSignal,
    });
    this.crossings.push({
      requestId,
      requestedMaxTokens: typeof body.max_tokens === 'number'
        ? body.max_tokens
        : typeof body.max_output_tokens === 'number'
          ? body.max_output_tokens
          : undefined,
      actualOutputTokens,
      failed,
    });
    await this.providerReleased;

    if (failed) return new Response('captured provider failure', { status: 500 });
    const inputTokens = 1;
    const responseModel = typeof body.model === 'string' ? body.model : 'gpt-4o-mini';
    if (body.stream === true) {
      const id = `captured-${requestId}`;
      const chunks = [
        {
          id,
          model: responseModel,
          choices: [{ delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
        },
        {
          id,
          model: responseModel,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: actualOutputTokens,
            total_tokens: inputTokens + actualOutputTokens,
            ...providerCostUsage,
          },
        },
      ];
      return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (isResponses) {
      return Response.json({
        id: `captured-${requestId}`,
        object: 'response',
        model: responseModel,
        output: this.responseOutputs.get(requestId) ?? [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        }],
        usage: {
          input_tokens: inputTokens,
          output_tokens: actualOutputTokens,
          total_tokens: inputTokens + actualOutputTokens,
          ...providerCostUsage,
        },
      });
    }

    return Response.json({
      id: `captured-${requestId}`,
      model: responseModel,
      choices: [{
        message: { role: 'assistant', content: 'ok' },
        finish_reason: actualOutputTokens >= 150_000 ? 'length' : 'stop',
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: actualOutputTokens,
        total_tokens: inputTokens + actualOutputTokens,
        ...providerCostUsage,
      },
    });
  }
}

let activeProvider: ProviderBarrier | undefined;
const storedProviderKeys = new Map<string, ProviderKeyFixture>();
const PROOF_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

beforeEach(() => {
  storedProviderKeys.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (!activeProvider) throw new Error('captured provider is not configured');
    return activeProvider.fetch(input, init);
  });
});

afterEach(async () => {
  try {
    // Keep the outbound fetch capture installed until Durable Object waitUntil()
    // work has drained, then remove alarms and storage before the next shard.
    await evictAllDurableObjects();
    await reset();
  } finally {
    activeProvider = undefined;
    vi.restoreAllMocks();
  }
});

function hardStub(budgetId: string): DurableObjectStub<BudgetDO> {
  return env.BUDGET_DO.get(env.BUDGET_DO.idFromName(budgetId));
}

function softStub(budgetId: string): DurableObjectStub<SoftBudgetDO> {
  return env.SOFT_BUDGET_DO.get(env.SOFT_BUDGET_DO.idFromName(budgetId));
}

function failingRecordStub(budgetId: string): DurableObjectStub<FailingRecordBudgetDO> {
  return env.FAIL_RECORD_BUDGET_DO.get(env.FAIL_RECORD_BUDGET_DO.idFromName(budgetId));
}

async function hardSnapshot(budgetId: string): Promise<HardSnapshot> {
  return runInDurableObject<BudgetDO, HardSnapshot>(
    hardStub(budgetId),
    async (_instance, state) => {
      const entries = await state.storage.list<ReservationRecord>({ prefix: 'r:' });
      return {
        root: await state.storage.get<BudgetState>('root'),
        reservations: [...entries].map(([key, value]) => ({
          id: key.slice(2),
          amount: value.amount,
        })),
      };
    },
  );
}

async function waitForHardSettlement(
  budgetId: string,
  read: (id: string) => Promise<HardSnapshot> = hardSnapshot,
): Promise<HardSnapshot> {
  let settled: HardSnapshot | undefined;
  await vi.waitFor(async () => {
    settled = await read(budgetId);
    expect(settled.reservations).toHaveLength(0);
  }, { timeout: 60_000, interval: 5 });
  return settled as HardSnapshot;
}

async function waitForTerminalReceipt(
  provider: ProviderBarrier,
  budgetId: string,
  receiptId: string | null,
): Promise<Record<string, unknown>> {
  expect(receiptId).toMatch(/^[0-9a-f-]{36}$/);
  const currentRows = () => provider.persistedRequests.filter((row) => row.budget_id === budgetId);
  await vi.waitFor(() => {
    expect(currentRows().some((row) => row.settlement_status !== 'pending')).toBe(true);
  }, { timeout: 60_000, interval: 10 });
  expect([...new Set(currentRows().map((row) => row.id))]).toEqual([receiptId]);
  const terminal = currentRows()
    .reverse()
    .find((row) => row.settlement_status !== 'pending');
  if (!terminal) throw new Error('Durable request receipt never reached a terminal settlement.');
  return terminal;
}

async function failingRecordSnapshot(budgetId: string): Promise<HardSnapshot> {
  return runInDurableObject<FailingRecordBudgetDO, HardSnapshot>(
    failingRecordStub(budgetId),
    async (_instance, state) => {
      const entries = await state.storage.list<ReservationRecord>({ prefix: 'r:' });
      return {
        root: await state.storage.get<BudgetState>('root'),
        reservations: [...entries].map(([key, value]) => ({
          id: key.slice(2),
          amount: value.amount,
        })),
      };
    },
  );
}

async function snapshot(variant: 'hard' | 'soft', budgetId: string): Promise<HardSnapshot | SoftSnapshot> {
  return variant === 'hard' ? hardSnapshot(budgetId) : softStub(budgetId).snapshot();
}

function isHardSnapshot(value: HardSnapshot | SoftSnapshot): value is HardSnapshot {
  return 'reservations' in value;
}

function ledgerInvariantHolds(value: HardSnapshot | SoftSnapshot): boolean {
  if (isHardSnapshot(value)) {
    if (!value.root) return false;
    return value.root.usedCents + value.root.reservedCents <= value.root.limitCents;
  }
  return value.usedCents <= value.limitCents;
}

function ledgerIsInternallyConsistent(value: HardSnapshot | SoftSnapshot): boolean {
  if (!isHardSnapshot(value)) return ledgerInvariantHolds(value);
  return ledgerInvariantHolds(value)
    && liveReservationCents(value) === (value.root?.reservedCents ?? 0);
}

function liveReservationCents(value: HardSnapshot | SoftSnapshot): number {
  return isHardSnapshot(value)
    ? value.reservations.reduce((total, reservation) => total + reservation.amount, 0)
    : 0;
}

function ledgerUsedCents(value: HardSnapshot | SoftSnapshot): number {
  return isHardSnapshot(value) ? (value.root?.usedCents ?? 0) : value.usedCents;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function capturedSettledCents(crossings: ProviderCrossing[]): Promise<number> {
  const costs = await Promise.all(crossings
    .filter((crossing) => !crossing.failed)
    .map(async (crossing) => {
      const cost = await resolveCost('openai', 'gpt-4o-mini', {
        inputTokens: 1,
        outputTokens: crossing.actualOutputTokens,
        totalTokens: crossing.actualOutputTokens + 1,
      });
      return Math.ceil(cost.totalCost * 100);
    }));
  return costs.reduce((total, cost) => total + cost, 0);
}

type ProofRequestInput = {
  variant: 'hard' | 'soft';
  budgetId: string;
  requestId: string;
  limitCents: number;
  settlementFailure?: boolean;
  noBudget?: boolean;
};

function proofHttpRequest(input: ProofRequestInput): Request {
  return new Request('https://proof.invalid/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-proof-variant': input.variant,
      'x-proof-budget-id': input.budgetId,
      'x-proof-request-id': input.requestId,
      'x-proof-limit-cents': String(input.limitCents),
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': 'captured-not-secret',
      ...(input.settlementFailure ? { 'x-proof-settlement-failure': 'true' } : {}),
      ...(input.noBudget ? { 'x-proof-no-budget': 'true' } : {}),
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: input.requestId }],
      max_tokens: 150_000,
    }),
  });
}

async function proofRequest(input: ProofRequestInput): Promise<Response> {
  return exports.default.fetch(proofHttpRequest(input));
}

async function proofIdempotentRequest(input: {
  budgetId: string;
  requestId: string;
  idempotencyKey: string;
  limitCents: number;
  content?: string;
  stream?: boolean;
  attribution?: {
    customerId: string;
    workflowId: string;
    agentId: string;
    sessionId: string;
    endUserId: string;
  };
}): Promise<Response> {
  return exports.default.fetch('https://proof.invalid/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
      'x-proof-variant': 'hard',
      'x-proof-budget-id': input.budgetId,
      'x-proof-request-id': input.requestId,
      'x-proof-limit-cents': String(input.limitCents),
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': 'captured-not-secret',
      ...(input.attribution && {
        'x-llmkit-customer-id': input.attribution.customerId,
        'x-llmkit-workflow-id': input.attribution.workflowId,
        'x-llmkit-agent-id': input.attribution.agentId,
        'x-llmkit-session-id': input.attribution.sessionId,
        'x-llmkit-user-id': input.attribution.endUserId,
      }),
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: input.content ?? input.requestId }],
      max_tokens: 150_000,
      ...(input.stream && { stream: true }),
    }),
  });
}

async function proofResponsesRequest(input: {
  budgetId: string;
  requestId: string;
  limitCents: number;
  idempotencyKey?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-proof-variant': 'hard',
    'x-proof-budget-id': input.budgetId,
    'x-proof-request-id': input.requestId,
    'x-proof-limit-cents': String(input.limitCents),
    'x-llmkit-provider': 'openai',
    'x-llmkit-provider-key': 'captured-not-secret',
  };
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
  return exports.default.fetch('https://proof.invalid/v1/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: input.requestId,
      max_output_tokens: 150_000,
    }),
  });
}

async function executeRun(input: {
  scenario: string;
  repeat: number;
  variant: 'hard' | 'soft';
  budgetId: string;
  requestIds: string[];
  limitCents: number;
  failures?: Iterable<string>;
  outputTokens?: Map<string, number>;
  supportedRequestShape?: boolean;
}): Promise<ProofRun> {
  const provider = new ProviderBarrier({ failures: input.failures, outputTokens: input.outputTokens });
  activeProvider = provider;
  let completed = 0;
  const pending = input.requestIds.map(async (requestId) => {
    try {
      const response = await proofRequest({
        variant: input.variant,
        budgetId: input.budgetId,
        requestId,
        limitCents: input.limitCents,
      });
      await response.text();
      return { requestId, status: response.status };
    } finally {
      completed += 1;
    }
  });

  try {
    await vi.waitFor(() => {
      expect(completed + provider.crossings.length).toBe(input.requestIds.length);
    }, { timeout: 60_000, interval: 5 });
  } catch (error) {
    // Never leave provider-blocked requests alive to contaminate a later test.
    provider.release();
    await Promise.allSettled(pending);
    throw error;
  }

  const beforeProviderCompletion = await snapshot(input.variant, input.budgetId);
  provider.release();
  const decisions = await Promise.all(pending);
  const finalLedger = input.variant === 'hard'
    ? await waitForHardSettlement(input.budgetId)
    : await snapshot(input.variant, input.budgetId);
  const settledCents = await capturedSettledCents(provider.crossings);
  const supportedRequestShape = input.supportedRequestShape ?? true;
  const run: ProofRun = {
    scenario: input.scenario,
    repeat: input.repeat,
    variant: input.variant,
    budgetId: input.budgetId,
    requestCount: input.requestIds.length,
    limitCents: input.limitCents,
    decisions,
    providerCrossings: [...provider.crossings],
    beforeProviderCompletion,
    finalLedger,
    invariantBeforeProviderCompletion: ledgerIsInternallyConsistent(beforeProviderCompletion),
    invariantAtFinalLedger: ledgerIsInternallyConsistent(finalLedger)
      && settledCents + liveReservationCents(finalLedger) <= input.limitCents,
    capturedSettledCents: settledCents,
    ledgerMatchesCapturedCost: ledgerUsedCents(finalLedger) === settledCents,
    supportedRequestShape,
    claimClassification: supportedRequestShape ? 'hard-dollar-boundary' : 'estimated-cost-boundary',
  };
  receipt.runs.push(run);
  return run;
}

function statusCount(run: ProofRun, status: number): number {
  return run.decisions.filter((decision) => decision.status === status).length;
}

describe('Gate 0 captured-provider dollar-boundary falsifier', () => {
  it('keeps modern Supabase secret keys out of the Bearer header while preserving legacy service-role JWTs', () => {
    const modern = supabaseServiceHeaders('sb_secret_proof');
    const legacy = supabaseServiceHeaders('legacy-service-role-jwt');
    const passed = modern.apikey === 'sb_secret_proof'
      && modern.Authorization === undefined
      && legacy.apikey === 'legacy-service-role-jwt'
      && legacy.Authorization === 'Bearer legacy-service-role-jwt';
    receipt.integrationChecks.push({ scenario: 'supabase-service-key-header-contract', passed });
    expect(passed).toBe(true);
  });

  it('persists an unbudgeted request without inventing a settlement while retaining tool attribution', async () => {
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;
    const ctx = createExecutionContext();
    const cost = await resolveCost('openai', 'gpt-4o-mini', { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    const status = await trackRequest({
      requestId: 'unbudgeted-receipt-proof',
      customerId: 'customer-proof',
      workflowId: undefined,
      agentId: undefined,
      sessionId: 'session-proof',
      endUserId: 'end-user-proof',
      idempotencyKeyHash: undefined,
      responseSha256: 'a'.repeat(64),
      toolCalls: [{ name: 'local_lookup' }],
      providerCostUsd: undefined,
      apiKeyId: 'api-key-proof',
      userId: 'user-proof',
      budgetId: undefined,
      budgetReservationId: undefined,
      budgetReservedCostCents: undefined,
      budgetSettlementMode: undefined,
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost,
      latencyMs: 1,
      env,
      ctx,
    });
    await waitOnExecutionContext(ctx);
    const row = provider.persistedRequests.find((candidate) => candidate.id === 'unbudgeted-receipt-proof');
    const passed = status === 'not-applicable'
      && row?.settlement_status === 'not_applicable'
      && row?.budget_id === null
      && row?.budget_reservation_id === null
      && row?.reserved_cost_cents === null
      && Array.isArray(row?.tool_calls)
      && row.tool_calls.length === 1;
    receipt.integrationChecks.push({ scenario: 'unbudgeted-request-receipt', passed });
    expect(passed, JSON.stringify(row)).toBe(true);
  });

  it('derives repeated Responses tool usage from provider output metadata', async () => {
    const budgetId = `responses-tools-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier({
      outputTokens: new Map([['responses-tools', 1]]),
      responseOutputs: new Map([['responses-tools', [
        { type: 'web_search_call', name: 'web_search', id: 'search-1' },
        { type: 'web_search_call', name: 'web_search', id: 'search-2' },
        { type: 'message' },
      ]]]),
    });
    provider.release();
    activeProvider = provider;
    const response = await exports.default.fetch('https://proof.invalid/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'responses-tools',
        'x-proof-limit-cents': '1000',
        'x-llmkit-format': 'llmkit',
        'x-llmkit-provider': 'openai',
        'x-llmkit-provider-key': 'captured-not-secret',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: 'responses-tools',
        max_output_tokens: 1,
      }),
    });
    const body = await response.json<{ extraUsage?: Array<{ dimension: string; quantity: number }> }>();
    const ledger = await waitForHardSettlement(budgetId);
    const persisted = await waitForTerminalReceipt(
      provider,
      budgetId,
      response.headers.get('x-llmkit-request-id'),
    );
    const passed = response.status === 200
      && body.extraUsage?.length === 1
      && body.extraUsage[0]?.dimension === 'web_search'
      && body.extraUsage[0]?.quantity === 2
      && ledger.root?.reservedCents === 0
      && persisted.settlement_status === 'settled_actual';
    receipt.integrationChecks.push({ scenario: 'responses-output-tool-usage', passed });
    expect(passed, JSON.stringify(body)).toBe(true);
  });

  it('prices the full supported request body and rejects unbounded or unpriced shapes', async () => {
    const text = await estimateCost({
      model: 'gpt-4o-mini',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'x' }] }],
      max_output_tokens: 1,
    }, 'openai');
    const withFunctionSchema = await estimateCost({
      model: 'gpt-4o-mini',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'x' }] }],
      max_output_tokens: 1,
      tools: [{
        type: 'function',
        name: 'lookup',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'x'.repeat(100_000) } } },
      }],
    }, 'openai');

    expect(text).toBeGreaterThan(0);
    expect(withFunctionSchema).toBeGreaterThan(text);
    await expect(estimateCost({ model: 'gpt-4o-mini', input: 'x' }, 'openai')).rejects.toThrow(
      'hard budgets require an explicit positive integer max_tokens',
    );
    await expect(estimateCost({ model: 'future-unpriced-model', input: 'x', max_output_tokens: 1 }, 'openai')).rejects.toThrow(
      'hard budgets require pinned pricing',
    );
    await expect(estimateCost({ max_tokens: 1 }, 'openai')).rejects.toThrow(
      'model is required for hard-budget admission',
    );
    const circular: Record<string, unknown> = { model: 'gpt-4o-mini', max_tokens: 1 };
    circular.self = circular;
    await expect(estimateCost(circular, 'openai')).rejects.toThrow(
      'request body must be JSON-serializable for hard-budget admission',
    );
  });

  it('fails closed before provider dispatch when a hard-budget request has no enforceable price or token ceiling', async () => {
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;
    const send = (path: '/v1/chat/completions' | '/v1/responses', requestId: string, body: Record<string, unknown>) => (
      exports.default.fetch(`https://proof.invalid${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-proof-variant': 'hard',
          'x-proof-budget-id': `${requestId}-${crypto.randomUUID()}`,
          'x-proof-request-id': requestId,
          'x-proof-limit-cents': '1000',
          'x-llmkit-provider': 'openai',
          'x-llmkit-provider-key': 'captured-not-secret',
        },
        body: JSON.stringify(body),
      })
    );

    const missingChatMax = await send('/v1/chat/completions', 'missing-chat-max', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
    });
    const missingResponsesMax = await send('/v1/responses', 'missing-responses-max', {
      model: 'gpt-4o-mini',
      input: 'x',
    });
    const unpriced = await send('/v1/chat/completions', 'unpriced-model', {
      model: 'future-unpriced-model',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
    });
    const unknownPrefixVariant = await send('/v1/chat/completions', 'unknown-prefix-variant', {
      model: 'gpt-4o-mini-future-premium',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
    });
    const image = await send('/v1/responses', 'unbounded-image', {
      model: 'gpt-4o-mini',
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.invalid/image.png' }] }],
      max_output_tokens: 1,
    });
    const conflictingMax = await send('/v1/chat/completions', 'conflicting-max', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      maxTokens: 2,
    });
    const anthropicDocument = await send('/v1/responses', 'unbounded-document', {
      model: 'claude-opus-4-6',
      input: [{
        role: 'user',
        content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'eA==' } }],
      }],
      max_output_tokens: 1,
    });
    const alternateMax = await send('/v1/chat/completions', 'alternate-max', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      max_completion_tokens: 10_000,
    });
    const multipliedOutput = await send('/v1/chat/completions', 'multiplied-output', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      n: 2,
      best_of: 2,
    });
    const audioOutput = await send('/v1/chat/completions', 'audio-output', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      modalities: ['text', 'audio'],
      audio: { voice: 'alloy', format: 'wav' },
    });
    const serviceTier = await send('/v1/chat/completions', 'service-tier', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      service_tier: 'priority',
    });
    const previousResponse = await send('/v1/responses', 'previous-response', {
      model: 'gpt-4o-mini',
      input: 'x',
      max_output_tokens: 1,
      previous_response_id: 'resp_unbounded_context',
    });
    const malformedTools = await send('/v1/chat/completions', 'malformed-tools', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      tools: { type: 'function' },
    });
    const nullTool = await send('/v1/chat/completions', 'null-tool', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      tools: [null],
    });
    const scalarTool = await send('/v1/chat/completions', 'scalar-tool', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 1,
      tools: ['function'],
    });
    const statuses = [
      missingChatMax.status,
      missingResponsesMax.status,
      unpriced.status,
      unknownPrefixVariant.status,
      image.status,
      conflictingMax.status,
      anthropicDocument.status,
      alternateMax.status,
      multipliedOutput.status,
      audioOutput.status,
      serviceTier.status,
      previousResponse.status,
      malformedTools.status,
      nullTool.status,
      scalarTool.status,
    ];
    const passed = statuses.every((status) => status === 400) && provider.crossings.length === 0;
    receipt.integrationChecks.push({
      scenario: 'hard-budget-shape-fail-closed',
      statuses,
      providerCrossings: provider.crossings.length,
      passed,
    });

    expect(passed).toBe(true);
  });

  it('validates fallback chain structure before dispatch', () => {
    expect(resolveProviderChain('openai', undefined)).toEqual(['openai']);
    expect(resolveProviderChain('groq', 'groq,together')).toEqual(['groq', 'together']);
    expect(() => resolveProviderChain('openai', 'openai,')).toThrow('empty provider');
    expect(() => resolveProviderChain('openai', 'openai,groq,together,fireworks,mistral,xai')).toThrow('cannot exceed 5');
    expect(() => resolveProviderChain('openai', 'openai,invalid')).toThrow('unsupported provider');
    expect(() => resolveProviderChain('openai', 'openai,openai')).toThrow('duplicate provider');
  });

  it('keeps the provider timeout inside the reservation crash lease', async () => {
    const signal = providerRequestSignal(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const passed = PROVIDER_REQUEST_TIMEOUT_MS < RESERVATION_TTL_MS
      && MAX_PROVIDER_EXECUTION_MS < RESERVATION_TTL_MS
      && MAX_PROVIDER_EXECUTION_MS < IDEMPOTENCY_PENDING_LEASE_MS
      && signal.aborted;
    receipt.integrationChecks.push({
      scenario: 'provider-timeout-boundary',
      providerTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      maximumFallbackExecutionMs: MAX_PROVIDER_EXECUTION_MS,
      reservationLeaseMs: RESERVATION_TTL_MS,
      idempotencyLeaseMs: IDEMPOTENCY_PENDING_LEASE_MS,
      shortSignalAborted: signal.aborted,
      passed,
    });

    expect(MAX_PROVIDER_EXECUTION_MS).toBeLessThan(RESERVATION_TTL_MS);
    expect(MAX_PROVIDER_EXECUTION_MS).toBeLessThan(IDEMPOTENCY_PENDING_LEASE_MS);
    expect(signal.aborted).toBe(true);
  });

  it('schedules crash cleanup at the reservation lease deadline', async () => {
    const budgetId = `reservation-alarm-${crypto.randomUUID()}`;
    const stub = hardStub(budgetId);
    const before = Date.now();
    const reservation = await stub.check({
      estimatedCents: 10,
      budgetConfig: { limitCents: 100, period: 'total' },
    });
    const alarm = await runInDurableObject(stub, async (_instance, state) => state.storage.getAlarm());
    const leaseMs = RESERVATION_TTL_MS;
    const passed = reservation.allowed
      && typeof alarm === 'number'
      && alarm >= before + leaseMs - 1_000
      && alarm <= before + leaseMs + 1_000;
    receipt.integrationChecks.push({
      scenario: 'crash-cleanup-deadline',
      allowed: reservation.allowed,
      scheduledDelayMs: typeof alarm === 'number' ? alarm - before : null,
      reservationLeaseMs: leaseMs,
      passed,
    });

    expect(passed).toBe(true);
  });

  it('deduplicates concurrent client request idempotency before provider dispatch and replays the exact response', async () => {
    const budgetId = `idempotency-${crypto.randomUUID()}`;
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    const attribution = {
      customerId: 'customer-idempotency',
      workflowId: 'workflow-idempotency',
      agentId: 'agent-idempotency',
      sessionId: 'session-idempotency',
      endUserId: 'end-user-idempotency',
    };
    activeProvider = provider;
    let completed = 0;
    const pending = Array.from({ length: 20 }, () => (
      proofIdempotentRequest({
        budgetId,
        requestId: 'idempotent-chat',
        idempotencyKey,
        limitCents: 100,
        attribution,
      }).then(async (response) => ({
        status: response.status,
        body: await response.text(),
        idempotencyStatus: response.headers.get('x-llmkit-idempotency-status'),
        receiptId: response.headers.get('x-llmkit-request-id'),
      })).finally(() => {
        completed += 1;
      })
    ));

    try {
      await vi.waitFor(() => {
        expect(completed + provider.crossings.length).toBe(20);
      }, { timeout: 60_000, interval: 5 });
    } catch (error) {
      provider.release();
      await Promise.allSettled(pending);
      throw error;
    }

    const beforeProviderCompletion = await hardSnapshot(budgetId);
    provider.release();
    const decisions = await Promise.all(pending);
    const original = decisions.find((decision) => decision.status === 200);
    const replay = await proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-chat',
      idempotencyKey,
      limitCents: 100,
      attribution,
    });
    const replayBody = await replay.text();
    const replayReceiptId = replay.headers.get('x-llmkit-request-id');
    const conflict = await proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-chat',
      idempotencyKey,
      limitCents: 100,
      content: 'different payload',
      attribution,
    });
    const finalLedger = await waitForHardSettlement(budgetId);
    const passed = provider.crossings.length === 1
      && decisions.filter((decision) => decision.status === 200).length === 1
      && decisions.filter((decision) => decision.status === 409).length === 19
      && original?.idempotencyStatus === 'created'
      && replay.status === 200
      && replay.headers.get('x-llmkit-idempotency-status') === 'replayed'
      && replay.headers.get('x-llmkit-settlement-status') === null
      && !!original.receiptId
      && replayReceiptId === original.receiptId
      && replayBody === original.body
      && conflict.status === 409
      && beforeProviderCompletion.root?.reservedCents === 10
      && beforeProviderCompletion.reservations.length === 1
      && finalLedger.root?.usedCents === 10
      && finalLedger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'client-request-idempotency',
      concurrentRequests: decisions.length,
      providerCrossings: provider.crossings.length,
      accepted: decisions.filter((decision) => decision.status === 200).length,
      inProgressConflicts: decisions.filter((decision) => decision.status === 409).length,
      replayStatus: replay.status,
      replayMatches: replayBody === original?.body,
      replaySettlementStatus: replay.headers.get('x-llmkit-settlement-status'),
      originalReceiptId: original?.receiptId,
      replayReceiptId,
      payloadConflictStatus: conflict.status,
      beforeProviderCompletion,
      finalLedger,
      passed,
    });

    expect(passed).toBe(true);
  });

  it('retries durable receipt evidence after a database outage for client request idempotency', async () => {
    const budgetId = `receipt-outbox-${crypto.randomUUID()}`;
    const idempotencyKey = `receipt-outbox-${crypto.randomUUID()}`;
    const attribution = {
      customerId: 'customer-margin-control',
      workflowId: 'workflow-margin-control',
      agentId: 'agent-margin-control',
      sessionId: 'session-margin-control',
      endUserId: 'end-user-margin-control',
    };
    const provider = new ProviderBarrier({ dbWriteFailures: 20 });
    activeProvider = provider;

    const pending = proofIdempotentRequest({
      budgetId,
      requestId: 'durable-receipt-request',
      idempotencyKey,
      limitCents: 100,
      attribution,
    });
    await vi.waitFor(() => expect(provider.crossings).toHaveLength(1), { timeout: 60_000, interval: 5 });
    provider.release();
    const response = await pending;
    const responseBody = await response.text();
    const requestId = response.headers.get('x-llmkit-request-id');
    expect(response.status).toBe(200);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    await vi.waitFor(async () => {
      const state = await runInDurableObject(hardStub(budgetId), async (_instance, durableState) => ({
        snapshot: await _instance.stagingProofSnapshot(),
        evidence: requestId
          ? await durableState.storage.get<{ row?: Record<string, unknown> }>(`e:${requestId}`)
          : undefined,
      }));
      expect(provider.dbWriteAttempts).toBeGreaterThan(0);
      expect(provider.persistedRequests).toHaveLength(0);
      expect(state.snapshot.outbox).toBe(1);
      expect(state.evidence?.row?.response_sha256).toMatch(/^[0-9a-f]{64}$/);
    }, { timeout: 60_000, interval: 10 });

    provider.restoreDatabase();
    const recovered = await runInDurableObject(hardStub(budgetId), async (instance, durableState) => {
      const jobs = await durableState.storage.list<Record<string, unknown>>({ prefix: 'o:' });
      for (const [key, job] of jobs) {
        await durableState.storage.put(key, { ...job, nextAttemptAt: Date.now() - 1 });
      }
      await instance.alarm();
      return instance.stagingProofSnapshot();
    });

    await vi.waitFor(() => expect(provider.persistedRequests).toHaveLength(1), { timeout: 60_000, interval: 10 });
    const finalReceipt = provider.persistedRequests[0];
    const replay = await proofIdempotentRequest({
      budgetId,
      requestId: 'durable-receipt-request',
      idempotencyKey,
      limitCents: 100,
      attribution,
    });
    const replayBody = await replay.text();
    const expectedResponseSha256 = await sha256Hex(responseBody);
    const expectedIdempotencyHash = await sha256Hex(`proof-api-key\n${idempotencyKey}`);
    const passed = recovered.outbox === 0
      && recovered.evidence === 1
      && provider.crossings.length === 1
      && finalReceipt?.id === requestId
      && finalReceipt?.customer_id === attribution.customerId
      && finalReceipt?.workflow_id === attribution.workflowId
      && finalReceipt?.agent_id === attribution.agentId
      && finalReceipt?.session_id === attribution.sessionId
      && finalReceipt?.end_user_id === attribution.endUserId
      && finalReceipt?.budget_id === budgetId
      && typeof finalReceipt?.budget_reservation_id === 'string'
      && finalReceipt?.reserved_cost_cents === 10
      && finalReceipt?.cost_cents === 10
      && finalReceipt?.settlement_status === 'settled_actual'
      && finalReceipt?.status === 'success'
      && finalReceipt?.idempotency_key_hash === expectedIdempotencyHash
      && finalReceipt?.response_sha256 === expectedResponseSha256
      && replay.status === 200
      && replay.headers.get('x-llmkit-request-id') === requestId
      && replay.headers.get('x-llmkit-idempotency-status') === 'replayed'
      && replayBody === responseBody;
    receipt.integrationChecks.push({
      scenario: 'durable-request-receipt-outbox',
      databaseFailures: provider.dbWriteAttempts - provider.persistedRequests.length,
      providerCrossings: provider.crossings.length,
      receiptId: requestId,
      outboxAfterRecovery: recovered.outbox,
      evidenceAfterRecovery: recovered.evidence,
      settlementStatus: finalReceipt?.settlement_status,
      responseHashMatches: finalReceipt?.response_sha256 === expectedResponseSha256,
      replayReceiptMatches: replay.headers.get('x-llmkit-request-id') === requestId,
      passed,
    });

    expect(passed, JSON.stringify({ recovered, finalReceipt })).toBe(true);
  });

  it('replays an idempotent Responses API request without a second provider crossing or settlement', async () => {
    const budgetId = `idempotent-responses-${crypto.randomUUID()}`;
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    activeProvider = provider;
    const firstPending = proofResponsesRequest({
      budgetId,
      requestId: 'idempotent-responses',
      idempotencyKey,
      limitCents: 100,
    });
    await vi.waitFor(() => expect(provider.crossings).toHaveLength(1), { timeout: 60_000, interval: 5 });
    provider.release();
    const first = await firstPending;
    const firstBody = await first.text();
    const replay = await proofResponsesRequest({
      budgetId,
      requestId: 'idempotent-responses',
      idempotencyKey,
      limitCents: 100,
    });
    const replayBody = await replay.text();
    const ledger = await waitForHardSettlement(budgetId);
    const passed = first.status === 200
      && first.headers.get('x-llmkit-idempotency-status') === 'created'
      && replay.status === 200
      && replay.headers.get('x-llmkit-idempotency-status') === 'replayed'
      && replayBody === firstBody
      && provider.crossings.length === 1
      && ledger.root?.usedCents === 10
      && ledger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'responses-request-idempotency',
      providerCrossings: provider.crossings.length,
      firstStatus: first.status,
      replayStatus: replay.status,
      replayMatches: replayBody === firstBody,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('fails closed on streaming idempotency before budget reservation or provider dispatch', async () => {
    const budgetId = `idempotent-stream-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    activeProvider = provider;
    const response = await proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-stream',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      limitCents: 100,
      stream: true,
    });
    const body = await response.json<{ error?: { code?: string } }>();
    const ledger = await hardSnapshot(budgetId);
    const passed = response.status === 400
      && body.error?.code === 'IDEMPOTENCY_STREAM_UNSUPPORTED'
      && provider.crossings.length === 0
      && ledger.root === undefined
      && ledger.reservations.length === 0;
    receipt.integrationChecks.push({
      scenario: 'streaming-idempotency-fail-closed',
      status: response.status,
      errorCode: body.error?.code,
      providerCrossings: provider.crossings.length,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('keeps a failed idempotent execution terminal when the provider outcome may be unknown', async () => {
    const budgetId = `idempotent-failure-${crypto.randomUUID()}`;
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier({ failures: ['idempotent-failure'] });
    activeProvider = provider;
    const firstPending = proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-failure',
      idempotencyKey,
      limitCents: 100,
    });
    await vi.waitFor(() => expect(provider.crossings).toHaveLength(1), { timeout: 60_000, interval: 5 });
    provider.release();
    const first = await firstPending;
    await first.text();
    const retry = await proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-failure',
      idempotencyKey,
      limitCents: 100,
    });
    const retryBody = await retry.json<{ error?: { code?: string } }>();
    const ledger = await hardSnapshot(budgetId);
    const passed = first.status === 503
      && retry.status === 409
      && retryBody.error?.code === 'IDEMPOTENCY_INDETERMINATE'
      && provider.crossings.length === 1
      && ledger.root?.usedCents === 10
      && ledger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'idempotency-unknown-outcome',
      firstStatus: first.status,
      retryStatus: retry.status,
      retryErrorCode: retryBody.error?.code,
      providerCrossings: provider.crossings.length,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('releases an idempotency key after a deterministic pre-dispatch rejection', async () => {
    const budgetId = `idempotent-predispatch-${crypto.randomUUID()}`;
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;

    const rejected = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'idempotent-predispatch-invalid',
        'x-proof-limit-cents': '100',
        'x-llmkit-provider': 'openai',
        'x-llmkit-provider-key': 'captured-not-secret',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'missing-model' }],
        max_tokens: 150_000,
      }),
    });
    const rejectedBody = await rejected.json<{ error?: { code?: string } }>();
    const accepted = await proofIdempotentRequest({
      budgetId,
      requestId: 'idempotent-predispatch-valid',
      idempotencyKey,
      limitCents: 100,
    });
    const acceptedBody = await accepted.text();
    const ledger = await waitForHardSettlement(budgetId);
    const passed = rejected.status === 400
      && rejectedBody.error?.code === 'INVALID_REQUEST'
      && rejected.headers.get('x-llmkit-idempotency-status') === 'released'
      && accepted.status === 200
      && accepted.headers.get('x-llmkit-idempotency-status') === 'created'
      && acceptedBody.includes('captured-idempotent-predispatch-valid')
      && provider.crossings.length === 1
      && ledger.root?.usedCents === 10
      && ledger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'idempotency-predispatch-release',
      rejectedStatus: rejected.status,
      rejectedErrorCode: rejectedBody.error?.code,
      rejectedIdempotencyStatus: rejected.headers.get('x-llmkit-idempotency-status'),
      acceptedStatus: accepted.status,
      acceptedIdempotencyStatus: accepted.headers.get('x-llmkit-idempotency-status'),
      providerCrossings: provider.crossings.length,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('releases an idempotency key when pre-dispatch middleware throws', async () => {
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;
    const budgetId = `idempotent-predispatch-throw-${crypto.randomUUID()}`;
    const idempotencyKey = `predispatch-throw-${crypto.randomUUID()}`;
    const headers = {
      'content-type': 'application/json',
      'x-proof-variant': 'hard',
      'x-proof-budget-id': budgetId,
      'x-proof-limit-cents': '100',
      'x-llmkit-provider': 'openai',
      'x-llmkit-provider-key': 'captured-not-secret',
      'Idempotency-Key': idempotencyKey,
    };
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'predispatch throw' }],
      max_tokens: 1,
    });

    const failed = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        ...headers,
        'x-proof-request-id': 'idempotent-predispatch-throw-failed',
        'x-proof-predispatch-throw': 'true',
      },
      body,
    });
    const accepted = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        ...headers,
        'x-proof-request-id': 'idempotent-predispatch-throw-retry',
      },
      body,
    });
    const acceptedBody = await accepted.text();
    const ledger = await waitForHardSettlement(budgetId);
    const passed = failed.status === 500
      && accepted.status === 200
      && accepted.headers.get('x-llmkit-idempotency-status') === 'created'
      && acceptedBody.includes('captured-predispatch throw')
      && provider.crossings.length === 1
      && ledger.root?.usedCents === 10
      && ledger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'idempotency-predispatch-thrown-release',
      failedStatus: failed.status,
      acceptedStatus: accepted.status,
      acceptedIdempotencyStatus: accepted.headers.get('x-llmkit-idempotency-status'),
      providerCrossings: provider.crossings.length,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('does not reserve budget for non-inference control-plane POST routes', async () => {
    const budgetId = `control-${crypto.randomUUID()}`;
    const response = await exports.default.fetch('https://proof.invalid/v1/control', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'control',
        'x-proof-limit-cents': '100',
      },
      body: JSON.stringify({ operation: 'rotate-key' }),
    });

    const responseBody = await response.text();
    const snapshot = await hardSnapshot(budgetId);
    receipt.integrationChecks.push({
      scenario: 'control-plane-budget-isolation',
      status: response.status,
      responseBody,
      rootCreated: snapshot.root !== undefined,
      liveReservations: snapshot.reservations.length,
      passed: response.status === 200 && snapshot.root === undefined && snapshot.reservations.length === 0,
    });
    expect(response.status, responseBody).toBe(200);
    expect(snapshot).toEqual({ root: undefined, reservations: [] });
  });

  it('fails closed on hard-budget request helper and idempotency identity boundaries', async () => {
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;

    const missingEvidenceBudget = `missing-evidence-${crypto.randomUUID()}`;
    const missingEvidence = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': missingEvidenceBudget,
        'x-proof-request-id': 'missing-evidence',
        'x-proof-limit-cents': '100',
        'x-proof-no-user': 'true',
        'x-llmkit-provider': 'openai',
        'x-llmkit-provider-key': 'captured-not-secret',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'missing-evidence' }],
        max_tokens: 1,
      }),
    });
    expect(missingEvidence.status).toBe(503);
    expect(provider.crossings).toHaveLength(0);
    expect(await hardSnapshot(missingEvidenceBudget)).toEqual({ root: undefined, reservations: [] });

    const invalidKey = await proofIdempotentRequest({
      budgetId: `invalid-idempotency-${crypto.randomUUID()}`,
      requestId: 'invalid-idempotency',
      idempotencyKey: 'bad key',
      limitCents: 100,
    });
    expect(invalidKey.status).toBe(400);

    const missingApiIdentity = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `valid-${crypto.randomUUID()}`,
        'x-proof-variant': 'hard',
        'x-proof-budget-id': `missing-api-${crypto.randomUUID()}`,
        'x-proof-request-id': 'missing-api',
        'x-proof-limit-cents': '100',
        'x-proof-no-api-key': 'true',
        'x-llmkit-provider': 'openai',
        'x-llmkit-provider-key': 'captured-not-secret',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'missing-api' }],
        max_tokens: 1,
      }),
    });
    expect(missingApiIdentity.status).toBe(400);

    const helperBudget = `helper-boundaries-${crypto.randomUUID()}`;
    await hardStub(helperBudget).configure({ limitCents: 100, usedCents: 0, period: 'total', resetAt: 0 });
    await expect(recordUsage(env.BUDGET_DO, helperBudget, undefined, 1)).resolves.toBeNull();
    await expect(finalizeReservationFailure(env.BUDGET_DO, undefined, undefined)).resolves.toMatchObject({
      disposition: 'missing',
    });
    await expect(attachReceiptResponseHash(env.BUDGET_DO, undefined, crypto.randomUUID(), 'a'.repeat(64)))
      .resolves.toBeUndefined();
    await expect(attachReceiptResponseHash(env.BUDGET_DO, helperBudget, crypto.randomUUID(), 'a'.repeat(64)))
      .rejects.toThrow('request receipt response hash could not be attached');
    await expect(sendAlert({ webhookUrl: 'http://alerts.invalid', body: { type: 'test' } }))
      .resolves.toBeUndefined();
  });

  it('enforces and settles the Responses API money path exactly once', async () => {
    const budgetId = `responses-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    activeProvider = provider;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logCountBefore = logSpy.mock.calls.length;
    let completed = 0;
    const pending = Array.from({ length: 10 }, (_, index) => (
      proofResponsesRequest({ budgetId, requestId: `responses-${index}`, limitCents: 10 })
        .then(async (response) => {
          await response.text();
          return response.status;
        })
        .finally(() => {
          completed += 1;
        })
    ));

    try {
      await vi.waitFor(() => {
        expect(completed + provider.crossings.length).toBe(10);
      }, { timeout: 60_000, interval: 5 });
    } catch (error) {
      provider.release();
      await Promise.allSettled(pending);
      throw error;
    }

    const before = await hardSnapshot(budgetId);
    provider.release();
    const statuses = await Promise.all(pending);
    const after = await waitForHardSettlement(budgetId);
    const requestLogs = logSpy.mock.calls
      .slice(logCountBefore)
      .filter(([message]) => typeof message === 'string' && message.includes('"model":"gpt-4o-mini"'));

    receipt.integrationChecks.push({
      scenario: 'responses-api-money-path',
      statuses,
      providerCrossings: provider.crossings.length,
      requestedMaxTokens: provider.crossings[0]?.requestedMaxTokens,
      beforeProviderCompletion: before,
      finalLedger: after,
      requestLogCount: requestLogs.length,
      passed: statuses.filter((status) => status === 200).length === 1
        && statuses.filter((status) => status === 402).length === 9
        && provider.crossings.length === 1
        && before.root?.reservedCents === 10
        && after.root?.usedCents === 10
        && after.root?.reservedCents === 0
        && requestLogs.length === 1,
    });

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 402)).toHaveLength(9);
    expect(provider.crossings).toHaveLength(1);
    expect(provider.crossings[0]?.requestedMaxTokens).toBe(150_000);
    expect(before.root).toMatchObject({ usedCents: 0, reservedCents: 10, limitCents: 10 });
    expect(after.root).toMatchObject({ usedCents: 10, reservedCents: 0, limitCents: 10 });
    expect(requestLogs).toHaveLength(1);
  });

  it('settles Chat and Responses requests from exact provider-reported cost when present', async () => {
    const chatBudgetId = `provider-cost-chat-${crypto.randomUUID()}`;
    const chatProvider = new ProviderBarrier({
      outputTokens: new Map([['provider-cost-chat', 1]]),
      providerCosts: new Map([['provider-cost-chat', 0.07]]),
    });
    chatProvider.release();
    activeProvider = chatProvider;
    const chatResponse = await proofRequest({
      variant: 'hard',
      budgetId: chatBudgetId,
      requestId: 'provider-cost-chat',
      limitCents: 10,
    });
    const chatBody = await chatResponse.text();
    const chatLedger = await waitForHardSettlement(chatBudgetId);

    const responsesBudgetId = `provider-cost-responses-${crypto.randomUUID()}`;
    const responsesProvider = new ProviderBarrier({
      outputTokens: new Map([['provider-cost-responses', 1]]),
      providerCosts: new Map([['provider-cost-responses', 0.07]]),
    });
    responsesProvider.release();
    activeProvider = responsesProvider;
    const responsesResponse = await proofResponsesRequest({
      budgetId: responsesBudgetId,
      requestId: 'provider-cost-responses',
      limitCents: 10,
    });
    const responsesBody = await responsesResponse.text();
    const responsesLedger = await waitForHardSettlement(responsesBudgetId);
    receipt.integrationChecks.push({
      scenario: 'provider-reported-cost-settlement',
      chatStatus: chatResponse.status,
      responsesStatus: responsesResponse.status,
      chatLedger,
      responsesLedger,
      passed: chatResponse.status === 200
        && responsesResponse.status === 200
        && chatLedger.root?.usedCents === 7
        && responsesLedger.root?.usedCents === 7
        && chatProvider.attempts[0]?.hasAbortSignal === true
        && responsesProvider.attempts[0]?.hasAbortSignal === true,
    });

    expect(chatResponse.status, chatBody).toBe(200);
    expect(responsesResponse.status, responsesBody).toBe(200);
    expect(chatLedger.root).toMatchObject({ usedCents: 7, reservedCents: 0, limitCents: 10 });
    expect(responsesLedger.root).toMatchObject({ usedCents: 7, reservedCents: 0, limitCents: 10 });
    expect(chatProvider.attempts[0]?.hasAbortSignal).toBe(true);
    expect(responsesProvider.attempts[0]?.hasAbortSignal).toBe(true);
  });

  it('fails closed on provider-managed tools and attachments without a pre-dispatch cost ceiling', async () => {
    const provider = new ProviderBarrier({
      outputTokens: new Map([
        ['server-tool', 1],
        ['attachment-tool', 1],
        ['client-function', 1],
      ]),
    });
    provider.release();
    activeProvider = provider;
    const request = (requestId: string, payload: Record<string, unknown>) => exports.default.fetch(
      'https://proof.invalid/v1/responses',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-proof-variant': 'hard',
          'x-proof-budget-id': `${requestId}-${crypto.randomUUID()}`,
          'x-proof-request-id': requestId,
          'x-proof-limit-cents': '1000',
          'x-llmkit-provider': 'xai',
          'x-llmkit-provider-key': 'xai-proof-key',
        },
        body: JSON.stringify({
          model: 'grok-4',
          input: requestId,
          max_output_tokens: 1,
          ...payload,
        }),
      },
    );

    const serverTool = await request('server-tool', { tools: [{ type: 'web_search' }] });
    const serverToolBody = await serverTool.text();
    const attachment = await request('attachment-tool', {
      input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'file-proof' }] }],
    });
    const attachmentBody = await attachment.text();
    const clientFunction = await request('client-function', {
      tools: [{ type: 'function', name: 'local_lookup', parameters: { type: 'object' } }],
    });
    const clientFunctionBody = await clientFunction.text();
    receipt.integrationChecks.push({
      scenario: 'provider-managed-tool-fail-closed',
      serverToolStatus: serverTool.status,
      attachmentStatus: attachment.status,
      clientFunctionStatus: clientFunction.status,
      providerCrossings: provider.crossings.map((crossing) => crossing.requestId),
      passed: serverTool.status === 400
        && attachment.status === 400
        && clientFunction.status === 200
        && provider.crossings.length === 1
        && provider.crossings[0]?.requestId === 'client-function',
    });

    expect(serverTool.status, serverToolBody).toBe(400);
    expect(attachment.status, attachmentBody).toBe(400);
    expect(clientFunction.status, clientFunctionBody).toBe(200);
    expect(provider.crossings.map((crossing) => crossing.requestId)).toEqual(['client-function']);
  });

  it('prices the full fallback chain before any provider dispatch', async () => {
    const budgetId = `fallback-price-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;

    const response = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'fallback-price',
        'x-proof-limit-cents': '3',
        'x-llmkit-provider': 'together',
        'x-llmkit-fallback': 'together,groq',
        'x-llmkit-provider-key': 'primary-proof-key',
      },
      body: JSON.stringify({
        model: 'gpt-oss-20b',
        messages: [{ role: 'user', content: 'fallback-price' }],
        max_tokens: 150_000,
      }),
    });
    const responseBody = await response.text();
    const state = await hardSnapshot(budgetId);
    receipt.integrationChecks.push({
      scenario: 'fallback-chain-pricing',
      status: response.status,
      providerCrossings: provider.crossings.length,
      ledger: state,
      passed: response.status === 402 && provider.crossings.length === 0 && state.root?.reservedCents === 0,
    });

    expect(response.status, responseBody).toBe(402);
    expect(provider.crossings).toHaveLength(0);
    expect(state.root).toMatchObject({ usedCents: 0, reservedCents: 0, limitCents: 3 });
  });

  it('never reuses a direct provider credential across fallback domains', async () => {
    const encrypted = await encrypt('together-proof-key', PROOF_ENCRYPTION_KEY, 'proof-user:together');
    storedProviderKeys.set('together', {
      id: 'proof-together-key',
      user_id: 'proof-user',
      provider: 'together',
      encrypted_key: encrypted.ciphertext,
      iv: encrypted.iv,
      key_prefix: 'tog_',
      key_name: 'proof',
      created_at: new Date(0).toISOString(),
    });

    const budgetId = `fallback-key-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier({ failedHosts: ['api.groq.com'] });
    provider.release();
    activeProvider = provider;
    const requestBody = {
      model: 'gpt-oss-20b',
      messages: [{ role: 'user', content: 'fallback-key' }],
      max_tokens: 10,
    };
    const expectedReservedCents = (await Promise.all([
      estimateCost(requestBody, 'groq'),
      estimateCost(requestBody, 'together'),
    ])).reduce((total, cost) => total + cost, 0);
    const response = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'fallback-key',
        'x-proof-limit-cents': '1000',
        'x-llmkit-provider': 'groq',
        'x-llmkit-fallback': 'groq,together',
        'x-llmkit-provider-key': 'primary-proof-key',
      },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.text();
    const ledger = await waitForHardSettlement(budgetId);
    const persisted = await waitForTerminalReceipt(
      provider,
      budgetId,
      response.headers.get('x-llmkit-request-id'),
    );
    const persistedCostCents = persisted.cost_cents;
    const attemptContract = provider.attempts.map((attempt) => ({
      host: attempt.host,
      credential: attempt.authorization === 'Bearer primary-proof-key'
        ? 'direct-primary'
        : attempt.authorization === 'Bearer together-proof-key'
          ? 'stored-provider'
          : 'unexpected',
    }));
    receipt.integrationChecks.push({
      scenario: 'fallback-provider-credential-isolation',
      status: response.status,
      attempts: attemptContract,
      reservedCeilingCents: expectedReservedCents,
      persistedCostCents,
      ledger,
      passed: response.status === 200
        && attemptContract.length === 2
        && attemptContract[0]?.credential === 'direct-primary'
        && attemptContract[1]?.credential === 'stored-provider'
        && ledger.root?.usedCents === expectedReservedCents
        && ledger.root.reservedCents === 0
        && persistedCostCents === expectedReservedCents,
    });

    expect(response.status, responseBody).toBe(200);
    expect(attemptContract).toEqual([
      { host: 'api.groq.com', credential: 'direct-primary' },
      { host: 'api.together.xyz', credential: 'stored-provider' },
    ]);
    expect(ledger.root).toMatchObject({ usedCents: expectedReservedCents, reservedCents: 0 });
    expect(persistedCostCents).toBe(expectedReservedCents);
  });

  it('keeps provider credentials isolated for streaming fallback', async () => {
    const encrypted = await encrypt('together-proof-key', PROOF_ENCRYPTION_KEY, 'proof-user:together');
    storedProviderKeys.set('together', {
      id: 'proof-together-stream-key',
      user_id: 'proof-user',
      provider: 'together',
      encrypted_key: encrypted.ciphertext,
      iv: encrypted.iv,
      key_prefix: 'tog_',
      key_name: 'proof-stream',
      created_at: new Date(0).toISOString(),
    });

    const provider = new ProviderBarrier({
      failedHosts: ['api.groq.com'],
      outputTokens: new Map([['fallback-stream', 10]]),
    });
    provider.release();
    activeProvider = provider;
    const budgetId = `fallback-stream-${crypto.randomUUID()}`;
    const requestBody = {
      model: 'gpt-oss-20b',
      messages: [{ role: 'user', content: 'fallback-stream' }],
      max_tokens: 10,
      stream: true,
    };
    const expectedReservedCents = (await Promise.all([
      estimateCost(requestBody, 'groq'),
      estimateCost(requestBody, 'together'),
    ])).reduce((total, cost) => total + cost, 0);
    const response = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'fallback-stream',
        'x-proof-limit-cents': '1000',
        'x-llmkit-provider': 'groq',
        'x-llmkit-fallback': 'groq,together',
        'x-llmkit-provider-key': 'primary-proof-key',
      },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.text();
    const ledger = await waitForHardSettlement(budgetId);
    const persisted = await waitForTerminalReceipt(
      provider,
      budgetId,
      response.headers.get('x-llmkit-request-id'),
    );
    const persistedCostCents = persisted.cost_cents;
    const attemptContract = provider.attempts.map((attempt) => ({
      host: attempt.host,
      credential: attempt.authorization === 'Bearer primary-proof-key'
        ? 'direct-primary'
        : attempt.authorization === 'Bearer together-proof-key'
          ? 'stored-provider'
          : 'unexpected',
    }));
    receipt.integrationChecks.push({
      scenario: 'streaming-fallback-provider-credential-isolation',
      status: response.status,
      attempts: attemptContract,
      completed: responseBody.includes('data: [DONE]'),
      reservedCeilingCents: expectedReservedCents,
      persistedCostCents,
      ledger,
      passed: response.status === 200
        && responseBody.includes('data: [DONE]')
        && attemptContract[0]?.credential === 'direct-primary'
        && attemptContract[1]?.credential === 'stored-provider'
        && ledger.root?.usedCents === expectedReservedCents
        && ledger.root.reservedCents === 0
        && persistedCostCents === expectedReservedCents,
    });

    expect(response.status, responseBody).toBe(200);
    expect(responseBody).toContain('data: [DONE]');
    expect(attemptContract).toEqual([
      { host: 'api.groq.com', credential: 'direct-primary' },
      { host: 'api.together.xyz', credential: 'stored-provider' },
    ]);
    expect(ledger.root).toMatchObject({ usedCents: expectedReservedCents, reservedCents: 0 });
    expect(persistedCostCents).toBe(expectedReservedCents);
  });

  it('fails closed and persists the committed ceiling when a fallback provider has no stored credential', async () => {
    const provider = new ProviderBarrier({ failedHosts: ['api.groq.com'] });
    provider.release();
    activeProvider = provider;
    const budgetId = `fallback-missing-${crypto.randomUUID()}`;
    const requestBody = {
      model: 'gpt-oss-20b',
      messages: [{ role: 'user', content: 'fallback-missing' }],
      max_tokens: 10,
    };
    const expectedReservedCents = (await Promise.all([
      estimateCost(requestBody, 'groq'),
      estimateCost(requestBody, 'together'),
    ])).reduce((total, cost) => total + cost, 0);
    const response = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': budgetId,
        'x-proof-request-id': 'fallback-missing',
        'x-proof-limit-cents': '1000',
        'x-llmkit-provider': 'groq',
        'x-llmkit-fallback': 'groq,together',
        'x-llmkit-provider-key': 'primary-proof-key',
      },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.text();
    const ledger = await waitForHardSettlement(budgetId);
    const persisted = await waitForTerminalReceipt(
      provider,
      budgetId,
      response.headers.get('x-llmkit-request-id'),
    );
    const passed = response.status === 503
      && provider.attempts.length === 1
      && ledger.root?.usedCents === expectedReservedCents
      && ledger.root.reservedCents === 0
      && persisted?.cost_cents === expectedReservedCents
      && persisted?.status === 'error'
      && persisted?.error_code === 'ALL_PROVIDERS_FAILED';
    receipt.integrationChecks.push({
      scenario: 'post-dispatch-failure-attribution',
      status: response.status,
      providerAttempts: provider.attempts.length,
      expectedCommittedCents: expectedReservedCents,
      persistedCostCents: persisted?.cost_cents,
      persistedStatus: persisted?.status,
      persistedErrorCode: persisted?.error_code,
      ledger,
      passed,
    });

    expect(response.status, responseBody).toBe(503);
    expect(responseBody).toContain('no stored together API key');
    expect(provider.attempts).toHaveLength(1);
    expect(ledger.root).toMatchObject({ usedCents: expectedReservedCents, reservedCents: 0 });
    expect(persisted).toMatchObject({
      cost_cents: expectedReservedCents,
      status: 'error',
      error_code: 'ALL_PROVIDERS_FAILED',
    });
  });

  it('fails closed when the primary credential is unavailable or corrupt', async () => {
    const provider = new ProviderBarrier();
    provider.release();
    activeProvider = provider;
    const missingBudgetId = `primary-missing-${crypto.randomUUID()}`;
    const missingResponse = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': missingBudgetId,
        'x-proof-request-id': 'primary-missing',
        'x-proof-limit-cents': '1000',
        'x-proof-no-user': 'true',
        'x-llmkit-provider': 'groq',
      },
      body: JSON.stringify({
        model: 'gpt-oss-20b',
        messages: [{ role: 'user', content: 'primary-missing' }],
        max_tokens: 10,
      }),
    });
    expect(missingResponse.status, await missingResponse.text()).toBe(400);
    expect(await hardSnapshot(missingBudgetId)).toEqual({
      root: undefined,
      reservations: [],
    });

    storedProviderKeys.set('groq', {
      id: 'proof-corrupt-key',
      user_id: 'proof-user',
      provider: 'groq',
      encrypted_key: 'not-ciphertext',
      iv: 'not-an-iv',
      key_prefix: 'gsk_',
      key_name: 'corrupt',
      created_at: new Date(0).toISOString(),
    });
    const corruptBudgetId = `primary-corrupt-${crypto.randomUUID()}`;
    const corruptResponse = await exports.default.fetch('https://proof.invalid/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-variant': 'hard',
        'x-proof-budget-id': corruptBudgetId,
        'x-proof-request-id': 'primary-corrupt',
        'x-proof-limit-cents': '1000',
        'x-llmkit-provider': 'groq',
      },
      body: JSON.stringify({
        model: 'gpt-oss-20b',
        messages: [{ role: 'user', content: 'primary-corrupt' }],
        max_tokens: 10,
      }),
    });
    const corruptBody = await corruptResponse.text();
    expect(corruptResponse.status, corruptBody).toBe(400);
    expect(corruptBody).toContain('could not be decrypted');
    expect(provider.attempts).toHaveLength(0);
    expect(await hardSnapshot(corruptBudgetId)).toEqual({
      root: undefined,
      reservations: [],
    });
  });

  it('admits a distinct ten-request exact-fit control through the full production money path', async () => {
    const id = crypto.randomUUID();
    const run = await executeRun({
      scenario: 'exact-fit',
      repeat: 0,
      variant: 'hard',
      budgetId: `exact-${id}`,
      requestIds: Array.from({ length: 10 }, (_, index) => `exact-${index}`),
      limitCents: 100,
    });

    expect(statusCount(run, 200)).toBe(10);
    expect(run.providerCrossings).toHaveLength(10);
    expect(run.invariantBeforeProviderCompletion).toBe(true);
    expect(run.invariantAtFinalLedger).toBe(true);
    expect(run.ledgerMatchesCapturedCost).toBe(true);
  });

  it('admits exactly ten of one hundred hard-boundary requests in twenty isolated repeats', async () => {
    const end = __GATE0_REPEAT_START__ + __GATE0_REPEAT_COUNT__;
    for (let repeat = __GATE0_REPEAT_START__; repeat < end; repeat += 1) {
      const id = crypto.randomUUID();
      const run = await executeRun({
        scenario: 'hard-burst',
        repeat,
        variant: 'hard',
        budgetId: `hard-${id}`,
        requestIds: Array.from({ length: 100 }, (_, index) => `hard-${repeat}-${index}`),
        limitCents: 100,
      });
      expect(statusCount(run, 200)).toBe(10);
      expect(statusCount(run, 402)).toBe(90);
      expect(run.providerCrossings).toHaveLength(10);
      expect(run.invariantBeforeProviderCompletion).toBe(true);
      expect(run.invariantAtFinalLedger).toBe(true);
      expect(run.ledgerMatchesCapturedCost).toBe(true);
    }
  });

  it('makes the same-atom post-response reference overshoot for the measured reason', async () => {
    const end = __GATE0_REPEAT_START__ + __GATE0_REPEAT_COUNT__;
    for (let repeat = __GATE0_REPEAT_START__; repeat < end; repeat += 1) {
      const id = crypto.randomUUID();
      const run = await executeRun({
        scenario: 'soft-burst',
        repeat,
        variant: 'soft',
        budgetId: `soft-${id}`,
        requestIds: Array.from({ length: 100 }, (_, index) => `soft-${repeat}-${index}`),
        limitCents: 100,
      });
      expect(statusCount(run, 200)).toBe(100);
      expect(run.providerCrossings.length).toBeGreaterThan(10);
      expect(run.invariantBeforeProviderCompletion).toBe(true);
      expect(run.invariantAtFinalLedger).toBe(false);
      expect(run.ledgerMatchesCapturedCost).toBe(true);
    }
  });

  it('commits a captured-provider unknown outcome before admitting only the remaining budget', async () => {
    const id = crypto.randomUUID();
    const budgetId = `release-${id}`;
    const failed = await executeRun({
      scenario: 'provider-failure',
      repeat: 0,
      variant: 'hard',
      budgetId,
      requestIds: ['failed'],
      limitCents: 20,
      failures: ['failed'],
    });
    expect(statusCount(failed, 503)).toBe(1);
    expect((failed.finalLedger as HardSnapshot).root).toMatchObject({
      usedCents: 10,
      reservedCents: 0,
    });

    const replacement = await executeRun({
      scenario: 'provider-failure-replacement',
      repeat: 0,
      variant: 'hard',
      budgetId,
      requestIds: ['replacement'],
      limitCents: 20,
    });
    expect(statusCount(replacement, 200)).toBe(1);
    expect(replacement.providerCrossings).toHaveLength(1);
    expect(replacement.invariantAtFinalLedger).toBe(true);
    expect((replacement.finalLedger as HardSnapshot).root).toMatchObject({
      usedCents: 20,
      reservedCents: 0,
    });
  });

  it('commits the reserved upper bound when actual-cost settlement fails after provider success', async () => {
    const budgetId = `settlement-failure-${crypto.randomUUID()}`;
    const provider = new ProviderBarrier();
    activeProvider = provider;
    const pending = proofRequest({
      variant: 'hard',
      budgetId,
      requestId: 'settlement-failure',
      limitCents: 100,
      settlementFailure: true,
    });
    await vi.waitFor(() => expect(provider.crossings).toHaveLength(1), { timeout: 60_000, interval: 5 });
    provider.release();
    const response = await pending;
    await response.text();
    const ledger = await waitForHardSettlement(budgetId, failingRecordSnapshot);
    const passed = response.status === 200
      && response.headers.get('x-llmkit-settlement-status') === 'pending'
      && provider.crossings.length === 1
      && ledger.root?.usedCents === 10
      && ledger.root.reservedCents === 0;
    receipt.integrationChecks.push({
      scenario: 'settlement-failure-conservative-commit',
      status: response.status,
      settlementStatus: response.headers.get('x-llmkit-settlement-status'),
      providerCrossings: provider.crossings.length,
      ledger,
      passed,
    });
    expect(passed).toBe(true);
  });

  it('refunds an under-bound settlement and rejects duplicate delivery', async () => {
    const id = crypto.randomUUID();
    const budgetId = `settlement-${id}`;
    const run = await executeRun({
      scenario: 'under-bound-settlement',
      repeat: 0,
      variant: 'hard',
      budgetId,
      requestIds: ['under-bound'],
      limitCents: 100,
      outputTokens: new Map([['under-bound', 80_000]]),
    });
    const before = run.beforeProviderCompletion as HardSnapshot;
    const after = run.finalLedger as HardSnapshot;
    const reservation = before.reservations[0];
    expect(reservation?.amount).toBe(10);
    expect(after.root).toMatchObject({ usedCents: 5, reservedCents: 0 });
    expect(reservation).toBeDefined();

    await recordUsage(env.BUDGET_DO, budgetId, undefined, 5, reservation?.id);
    const replayed = await hardSnapshot(budgetId);
    receipt.runs.push({
      ...run,
      scenario: 'duplicate-settlement-replay',
      beforeProviderCompletion: after,
      finalLedger: replayed,
      invariantBeforeProviderCompletion: ledgerInvariantHolds(after),
      invariantAtFinalLedger: ledgerInvariantHolds(replayed),
      ledgerMatchesCapturedCost: ledgerUsedCents(replayed) === run.capturedSettledCents,
    });
    expect(replayed.root).toMatchObject({ usedCents: 5, reservedCents: 0 });
  });

  it('detects a provider that violates the reserved output clamp and narrows the claim', async () => {
    const id = crypto.randomUUID();
    const run = await executeRun({
      scenario: 'provider-exceeds-reservation',
      repeat: 0,
      variant: 'hard',
      budgetId: `over-bound-${id}`,
      requestIds: ['over-bound'],
      limitCents: 10,
      outputTokens: new Map([['over-bound', 200_000]]),
      supportedRequestShape: false,
    });
    const before = run.beforeProviderCompletion as HardSnapshot;
    const after = run.finalLedger as HardSnapshot;
    expect(statusCount(run, 200)).toBe(1);
    expect(before.reservations[0]?.amount).toBe(10);
    expect(after.root?.usedCents).toBeGreaterThan(10);
    expect(run.invariantAtFinalLedger).toBe(false);
    expect(run.claimClassification).toBe('estimated-cost-boundary');
  });

});

afterAll(() => {
  const hardBursts = receipt.runs.filter((run) => run.scenario === 'hard-burst');
  const softBursts = receipt.runs.filter((run) => run.scenario === 'soft-burst');
  const exact = receipt.runs.find((run) => run.scenario === 'exact-fit');
  const replay = receipt.runs.find((run) => run.scenario === 'duplicate-settlement-replay');
  const controlPlane = receipt.integrationChecks.find((check) => check.scenario === 'control-plane-budget-isolation');
  const responsesApi = receipt.integrationChecks.find((check) => check.scenario === 'responses-api-money-path');
  const fallbackPricing = receipt.integrationChecks.find((check) => check.scenario === 'fallback-chain-pricing');
  const fallbackCredentials = receipt.integrationChecks.find((check) => check.scenario === 'fallback-provider-credential-isolation');
  const streamingFallbackCredentials = receipt.integrationChecks.find((check) => check.scenario === 'streaming-fallback-provider-credential-isolation');
  const providerReportedCost = receipt.integrationChecks.find((check) => check.scenario === 'provider-reported-cost-settlement');
  const managedTools = receipt.integrationChecks.find((check) => check.scenario === 'provider-managed-tool-fail-closed');
  const hardBudgetShapes = receipt.integrationChecks.find((check) => check.scenario === 'hard-budget-shape-fail-closed');
  const supabaseHeaders = receipt.integrationChecks.find((check) => check.scenario === 'supabase-service-key-header-contract');
  const providerTimeout = receipt.integrationChecks.find((check) => check.scenario === 'provider-timeout-boundary');
  const crashCleanup = receipt.integrationChecks.find((check) => check.scenario === 'crash-cleanup-deadline');
  const clientIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'client-request-idempotency');
  const responsesIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'responses-request-idempotency');
  const streamingIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'streaming-idempotency-fail-closed');
  const unknownIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'idempotency-unknown-outcome');
  const predispatchIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'idempotency-predispatch-release');
  const thrownPredispatchIdempotency = receipt.integrationChecks.find((check) => check.scenario === 'idempotency-predispatch-thrown-release');
  const settlementFailure = receipt.integrationChecks.find((check) => check.scenario === 'settlement-failure-conservative-commit');
  const failureAttribution = receipt.integrationChecks.find((check) => check.scenario === 'post-dispatch-failure-attribution');
  const unbudgetedReceipt = receipt.integrationChecks.find((check) => check.scenario === 'unbudgeted-request-receipt');
  const responsesToolUsage = receipt.integrationChecks.find((check) => check.scenario === 'responses-output-tool-usage');
  receipt.computedVerdict = {
    exactFit: exact?.providerCrossings.length === 10 && statusCount(exact, 200) === 10,
    hardBurst: hardBursts.length === 20 && hardBursts.every((run) => (
      run.providerCrossings.length === 10 && statusCount(run, 200) === 10 && statusCount(run, 402) === 90 && run.ledgerMatchesCapturedCost
    )),
    softReference: softBursts.length === 20 && softBursts.every((run) => (
      run.providerCrossings.length > 10 && !run.invariantAtFinalLedger
    )),
    duplicateSettlement: replay && 'root' in replay.finalLedger
      ? replay.finalLedger.root?.usedCents === 5
      : false,
    controlPlaneIsolation: controlPlane?.passed === true,
    responsesApiBoundary: responsesApi?.passed === true,
    fallbackPricingBoundary: fallbackPricing?.passed === true,
    fallbackCredentialIsolation: fallbackCredentials?.passed === true,
    streamingFallbackCredentialIsolation: streamingFallbackCredentials?.passed === true,
    providerReportedCostSettlement: providerReportedCost?.passed === true,
    providerManagedToolsFailClosed: managedTools?.passed === true,
    hardBudgetShapesFailClosed: hardBudgetShapes?.passed === true,
    supabaseServiceKeyHeaders: supabaseHeaders?.passed === true,
    providerTimeoutBoundary: providerTimeout?.passed === true,
    crashCleanupDeadline: crashCleanup?.passed === true,
    clientRequestIdempotency: clientIdempotency?.passed === true,
    responsesRequestIdempotency: responsesIdempotency?.passed === true,
    streamingIdempotencyFailClosed: streamingIdempotency?.passed === true,
    idempotencyUnknownOutcome: unknownIdempotency?.passed === true,
    idempotencyPredispatchRelease: predispatchIdempotency?.passed === true,
    idempotencyPredispatchThrownRelease: thrownPredispatchIdempotency?.passed === true,
    settlementFailureConservativeCommit: settlementFailure?.passed === true,
    postDispatchFailureAttribution: failureAttribution?.passed === true,
    unbudgetedRequestReceipt: unbudgetedReceipt?.passed === true,
    responsesOutputToolUsage: responsesToolUsage?.passed === true,
  };
  emitReceipt(`LLMKIT_GATE0_RECEIPT=${JSON.stringify(receipt)}`);
});
