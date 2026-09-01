import type { CostBreakdown, TokenUsage } from '@f3d1/llmkit-shared';
import type { ExecutionContext as HonoExecutionContext } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { RequestInsert } from '../db';
import { logRequest, supabaseServiceHeaders } from '../db';
import type { Env, ResponseMeta } from '../env';
import { formatFirstSuccess, formatRequestLog, notifyTelegram } from '../notify';
import { finalizeReservationFailure, recordUsage, sendAlert } from './budget';

// per-isolate dedup (warm-start only, DB check is source of truth)
const seenUsers = new Set<string>();

async function hasSuccessfulRequest(supabaseUrl: string, supabaseKey: string, apiKeyId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/requests?select=id&api_key_id=eq.${encodeURIComponent(apiKeyId)}&error_code=is.null&limit=1`,
      { headers: supabaseServiceHeaders(supabaseKey) },
    );
    const data = await res.json() as unknown[];
    return data.length > 0;
  } catch {
    return false;
  }
}

export interface TrackParams {
  requestId: string | undefined;
  customerId: string | undefined;
  workflowId: string | undefined;
  agentId: string | undefined;
  sessionId: string | undefined;
  endUserId: string | undefined;
  idempotencyKeyHash: string | undefined;
  responseSha256: string | undefined;
  requestedProvider?: string;
  requestedModel?: string;
  providerResponseId?: string;
  toolCalls: { name: string }[] | undefined;
  providerCostUsd: number | undefined;
  apiKeyId: string | undefined;
  userId: string | undefined;
  budgetId: string | undefined;
  budgetReservationId: string | undefined;
  budgetReservedCostCents: number | undefined;
  budgetSettlementMode: 'actual' | 'ceiling' | undefined;
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  env: Env['Bindings'];
  ctx: HonoExecutionContext;
}

export interface FailedTrackParams {
  requestId: string | undefined;
  customerId: string | undefined;
  workflowId: string | undefined;
  agentId: string | undefined;
  sessionId: string | undefined;
  endUserId: string | undefined;
  idempotencyKeyHash: string | undefined;
  apiKeyId: string | undefined;
  userId: string | undefined;
  budgetId: string | undefined;
  budgetReservationId: string | undefined;
  requestedProvider?: string;
  requestedModel?: string;
  lastDispatchedProvider?: string;
  lastDispatchedModel?: string;
  provider: string;
  model: string;
  errorCode: string;
  env: Env['Bindings'];
  ctx: HonoExecutionContext;
}

export interface FailedTrackResult {
  disposition: 'not-applicable' | 'committed' | 'released' | 'unknown';
  committedCostCents: number | null;
}

function chargedCostUsd(p: Pick<TrackParams, 'cost' | 'providerCostUsd'>): number {
  return p.providerCostUsd != null && Number.isFinite(p.providerCostUsd) && p.providerCostUsd >= 0
    ? p.providerCostUsd
    : p.cost.totalCost;
}

function ceilingCostCents(costUsd: number): number {
  return Math.ceil(Number((costUsd * 100).toFixed(8)));
}

function receiptIdentity(p: {
  requestId: string | undefined;
  userId: string | undefined;
  apiKeyId: string | undefined;
  customerId: string | undefined;
}): p is typeof p & { requestId: string; userId: string; apiKeyId: string; customerId: string } {
  return !!p.requestId && !!p.userId && !!p.apiKeyId && !!p.customerId;
}

type DispatchReceiptFields = Pick<
  RequestInsert,
  | 'requested_provider'
  | 'requested_model'
  | 'last_dispatched_provider'
  | 'last_dispatched_model'
  | 'provider_response_id'
  | 'dispatch_status'
>;

function failedDispatchReceiptFields(p: FailedTrackParams): DispatchReceiptFields {
  return {
    requested_provider: p.requestedProvider || p.provider,
    requested_model: p.requestedModel || p.model,
    last_dispatched_provider: p.lastDispatchedProvider || null,
    last_dispatched_model: p.lastDispatchedModel || null,
    provider_response_id: null,
    dispatch_status: p.lastDispatchedProvider ? 'dispatched' : p.budgetReservationId ? 'admitted' : null,
  };
}

function successfulDispatchReceiptFields(p: TrackParams): DispatchReceiptFields {
  return {
    requested_provider: p.requestedProvider || p.provider,
    requested_model: p.requestedModel || p.model,
    last_dispatched_provider: p.provider,
    last_dispatched_model: p.model,
    provider_response_id: p.providerResponseId || null,
    dispatch_status: 'dispatched',
  };
}

function failedReceipt(p: FailedTrackParams): RequestInsert | undefined {
  if (!receiptIdentity(p)) return undefined;
  return {
    id: p.requestId,
    user_id: p.userId,
    api_key_id: p.apiKeyId,
    customer_id: p.customerId,
    workflow_id: p.workflowId || null,
    agent_id: p.agentId || null,
    session_id: p.sessionId || null,
    end_user_id: p.endUserId || null,
    budget_id: p.budgetId || null,
    budget_reservation_id: p.budgetReservationId || null,
    reserved_cost_cents: null,
    settlement_status: p.budgetId && p.budgetReservationId ? 'unknown' : 'not_applicable',
    idempotency_key_hash: p.idempotencyKeyHash || null,
    response_sha256: null,
    ...failedDispatchReceiptFields(p),
    provider: p.provider,
    model: p.model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_cents: p.budgetId && p.budgetReservationId ? null : 0,
    latency_ms: 0,
    status: 'error',
    error_code: p.errorCode,
    source: 'proxy',
    tool_calls: null,
  };
}

function successfulReceipt(
  p: TrackParams,
  committedCostCents: number,
  settlementStatus: RequestInsert['settlement_status'],
): RequestInsert | undefined {
  if (!receiptIdentity(p)) return undefined;
  return {
    id: p.requestId,
    user_id: p.userId,
    api_key_id: p.apiKeyId,
    customer_id: p.customerId,
    workflow_id: p.workflowId || null,
    agent_id: p.agentId || null,
    session_id: p.sessionId || null,
    end_user_id: p.endUserId || null,
    budget_id: p.budgetId || null,
    budget_reservation_id: p.budgetReservationId || null,
    reserved_cost_cents: p.budgetReservedCostCents || null,
    settlement_status: settlementStatus,
    idempotency_key_hash: p.idempotencyKeyHash || null,
    response_sha256: p.responseSha256 || null,
    ...successfulDispatchReceiptFields(p),
    provider: p.provider,
    model: p.model,
    input_tokens: p.usage.inputTokens,
    output_tokens: p.usage.outputTokens,
    cache_read_tokens: p.usage.cacheReadTokens || 0,
    cache_write_tokens: p.usage.cacheWriteTokens || 0,
    cost_cents: committedCostCents,
    latency_ms: p.latencyMs,
    status: 'success',
    error_code: null,
    source: 'proxy',
    tool_calls: p.toolCalls?.length ? p.toolCalls : null,
  };
}

export async function trackFailedRequest(p: FailedTrackParams): Promise<FailedTrackResult> {
  const receipt = failedReceipt(p);
  let result: FailedTrackResult = {
    disposition: 'not-applicable',
    committedCostCents: 0,
  };

  if (p.budgetId && p.budgetReservationId) {
    try {
      const finalization = await finalizeReservationFailure(
        p.env.BUDGET_DO,
        p.budgetId,
        p.budgetReservationId,
        receipt,
      );
      result = finalization.disposition === 'missing'
        ? { disposition: 'unknown', committedCostCents: null }
        : {
            disposition: finalization.disposition,
            committedCostCents: finalization.committedCents,
          };
    } catch (error) {
      result = { disposition: 'unknown', committedCostCents: null };
      console.error('budget failure finalization failed:', error);
    }
  }

  if (!p.budgetReservationId && receipt && p.env.SUPABASE_URL && p.env.SUPABASE_KEY) {
    p.ctx.waitUntil(logRequest(p.env.SUPABASE_URL, p.env.SUPABASE_KEY, receipt));
  }

  return result;
}

export async function trackRequest(p: TrackParams): Promise<'not-applicable' | 'settled' | 'estimated'> {
  const chargedCost = chargedCostUsd(p);
  let committedCostUsd = chargedCost;
  let settlementStatus: 'not-applicable' | 'settled' | 'estimated' = 'not-applicable';
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: p.sessionId,
    provider: p.provider,
    model: p.model,
    latencyMs: p.latencyMs,
    usage: p.usage,
    cost: p.cost,
    providerCostUsd: p.providerCostUsd,
    budgetSettlementMode: p.budgetSettlementMode,
  }));

  if (chargedCost === 0 && (p.usage.inputTokens > 0 || p.usage.outputTokens > 0)) {
    console.warn(
      `ZERO COST WARNING: ${p.provider}/${p.model} processed ${p.usage.inputTokens + p.usage.outputTokens} tokens but cost is $0. Model likely missing from pricing data.`,
    );
  }

  if (p.providerCostUsd != null && p.cost.totalCost > 0) {
    const diff = Math.abs(p.cost.totalCost - p.providerCostUsd) / p.cost.totalCost;
    if (diff > 0.1) {
      console.warn(
        `COST MISMATCH: ${p.provider}/${p.model} - ours=$${p.cost.totalCost.toFixed(6)}, provider=$${p.providerCostUsd.toFixed(6)} (diff ${(diff * 100).toFixed(1)}%)`,
      );
    }
  }

  if (p.budgetId && (p.cost.totalCost > 0 || p.budgetReservationId)) {
    if (p.budgetSettlementMode === 'ceiling') {
      const ceilingReceipt = successfulReceipt(
        p,
        p.budgetReservedCostCents || 0,
        'committed_ceiling',
      );
      const conservative = await finalizeReservationFailure(
        p.env.BUDGET_DO,
        p.budgetId,
        p.budgetReservationId,
        ceilingReceipt,
      );
      if (conservative.disposition !== 'committed') {
        throw new Error('fallback-chain ceiling settlement was not committed');
      }
      committedCostUsd = conservative.committedCents / 100;
      settlementStatus = 'estimated';
      console.warn('fallback chain included a failed dispatched attempt; committed the reserved upper bound');
    } else {
      const costCents = ceilingCostCents(chargedCost);
      try {
        const alert = await recordUsage(
          p.env.BUDGET_DO,
          p.budgetId,
          p.sessionId,
          costCents,
          p.budgetReservationId,
          successfulReceipt(p, costCents, 'settled_actual'),
        );
        settlementStatus = 'settled';
        if (alert) {
          p.ctx.waitUntil(sendAlert(alert));
        }
      } catch (error) {
        const fallback = await finalizeReservationFailure(
          p.env.BUDGET_DO,
          p.budgetId,
          p.budgetReservationId,
          successfulReceipt(p, p.budgetReservedCostCents || 0, 'committed_ceiling'),
        );
        if (fallback.disposition !== 'committed') throw error;
        committedCostUsd = fallback.committedCents / 100;
        settlementStatus = 'estimated';
        console.error('budget actual-cost settlement failed; committed the reserved upper bound:', error);
      }
    }
  }

  if (p.apiKeyId && p.userId && p.env.SUPABASE_URL && p.env.SUPABASE_KEY) {
    persistAndNotify(p as TrackParams & { userId: string; apiKeyId: string }, committedCostUsd);
  }
  return settlementStatus;
}

function persistAndNotify(
  p: TrackParams & { userId: string; apiKeyId: string },
  committedCostUsd: number,
) {
  const url = p.env.SUPABASE_URL;
  const key = p.env.SUPABASE_KEY;
  if (!url || !key) return;

  const row = successfulReceipt(
    p,
    +(committedCostUsd * 100).toFixed(4),
    p.budgetId ? 'unknown' : 'not_applicable',
  );
  if (!p.budgetId && row) p.ctx.waitUntil(logRequest(url, key, row));

  const botToken = p.env.TELEGRAM_BOT_TOKEN;
  const chatId = p.env.TELEGRAM_CHAT_ID;
  const dbUrl = p.env.SUPABASE_URL;
  const dbKey = p.env.SUPABASE_KEY;
  if (botToken && chatId && dbUrl && dbKey && !seenUsers.has(p.userId)) {
    seenUsers.add(p.userId);
    p.ctx.waitUntil(
      hasSuccessfulRequest(dbUrl, dbKey, p.apiKeyId).then((exists) => {
        if (!exists) {
          return notifyTelegram(botToken, chatId, formatFirstSuccess(p.userId, p.provider, p.model, committedCostUsd));
        }
      }),
    );
  }

  if (botToken && chatId && p.env.TELEGRAM_VERBOSE) {
    p.ctx.waitUntil(notifyTelegram(botToken, chatId, formatRequestLog(
      p.userId, p.provider, p.model,
      p.usage.inputTokens, p.usage.outputTokens,
      committedCostUsd, p.latencyMs, null,
    )));
  }
}

export function costLogger() {
  return createMiddleware<Env>(async (c, next) => {
    const start = Date.now();
    await next();

    const meta: ResponseMeta | undefined = c.get('llmkit_response');
    if (!meta) return;

    const tracking = trackRequest({
      requestId: c.get('requestId'),
      customerId: c.get('customerId'),
      workflowId: c.get('workflowId'),
      agentId: c.get('agentId'),
      sessionId: c.get('sessionId'),
      endUserId: c.get('endUserId'),
      idempotencyKeyHash: c.get('idempotencyKeyHash'),
      responseSha256: c.get('responseSha256'),
      requestedProvider: c.get('requestProvider'),
      requestedModel: c.get('requestModel'),
      providerResponseId: meta.providerResponseId,
      toolCalls: meta.toolCalls,
      providerCostUsd: meta.providerCostUsd,
      apiKeyId: c.get('apiKeyId'),
      userId: c.get('userId'),
      budgetId: c.get('budgetId'),
      budgetReservationId: c.get('budgetReservationId'),
      budgetReservedCostCents: c.get('budgetReservedCostCents'),
      budgetSettlementMode: c.get('budgetSettlementMode'),
      provider: meta.provider,
      model: meta.model || 'unknown',
      usage: meta.usage,
      cost: meta.cost,
      latencyMs: Date.now() - start,
      env: c.env,
      ctx: c.executionCtx,
    });
    const settlementApplies = !!c.get('budgetId')
      && (meta.cost.totalCost > 0 || !!c.get('budgetReservationId'));
    if (settlementApplies) {
      c.header('x-llmkit-settlement-status', 'pending');
      c.executionCtx.waitUntil(tracking.then((status) => {
        if (status === 'estimated') {
          console.error('budget settlement completed with the reserved upper bound');
        }
      }).catch((error) => {
        // The dispatched reservation remains charged against available budget,
        // and the Durable Object alarm is the final conservative backstop.
        console.error('background budget settlement failed; reservation remains protected:', error);
      }));
      return;
    }
    await tracking;
  });
}
