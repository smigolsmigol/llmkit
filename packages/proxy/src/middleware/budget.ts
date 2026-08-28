import type { ProviderName } from '@f3d1/llmkit-shared';
import { BudgetExceededError, inferProvider, PRICING, ValidationError } from '@f3d1/llmkit-shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { RequestInsert } from '../db';
import type { BudgetDO, FailureFinalizationResult } from '../do/budget-do';
import type { Env } from '../env';
import { resolveProviderChain } from '../providers/chain';

function validateSessionId(sessionId: string | undefined): void {
  if (sessionId && !/^[\w-]{1,128}$/.test(sessionId)) {
    throw new ValidationError('invalid session ID format');
  }
}

function validateEndUserId(endUserId: string | undefined): void {
  if (endUserId && !/^[\w@.+-]{1,256}$/.test(endUserId)) {
    throw new ValidationError('invalid end user ID format');
  }
}

async function parseBody(c: { req: { json(): Promise<Record<string, unknown>> } }): Promise<Record<string, unknown>> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
}

const BUDGETED_POST_PATHS = new Set(['/v1/chat/completions', '/v1/responses']);
const HARD_BUDGET_CHAT_FIELDS = new Set([
  'model', 'messages', 'temperature', 'max_completion_tokens', 'max_tokens', 'maxTokens',
  'tools', 'tool_choice', 'response_format', 'stream', 'stream_options', 'provider',
]);
const HARD_BUDGET_RESPONSES_FIELDS = new Set([
  'model', 'input', 'instructions', 'temperature', 'max_output_tokens',
  'tools', 'tool_choice', 'text', 'provider',
]);

function validateHardBudgetTopLevelFields(body: Record<string, unknown>, path: string): void {
  const allowed = path === '/v1/responses' ? HARD_BUDGET_RESPONSES_FIELDS : HARD_BUDGET_CHAT_FIELDS;
  const unsupported = Object.keys(body).filter((field) => !allowed.has(field)).sort();
  if (unsupported.length > 0) {
    throw new ValidationError(
      `hard budgets do not support unbounded or cost-affecting request fields: ${unsupported.join(', ')}`,
    );
  }
}

function containsUnsupportedHardBudgetContent(value: unknown): boolean {
  const pending = [value];
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    inspected += 1;
    if (inspected > 10_000) {
      throw new ValidationError('request content is too complex to validate for hard-budget tool safety');
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const item = current as Record<string, unknown>;
    if (
      item.type === 'input_file'
      || item.type === 'image_url'
      || item.type === 'input_image'
      || item.type === 'image'
      || item.type === 'document'
      || item.type === 'input_audio'
      || item.type === 'audio'
      || item.type === 'input_video'
      || item.type === 'video'
      || 'file_id' in item
      || 'file_url' in item
    ) return true;
    pending.push(...Object.values(item));
  }
  return false;
}

function validateHardBudgetToolBoundary(body: Record<string, unknown>): void {
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new ValidationError('tools must be an array');
    for (const tool of body.tools) {
      if (!tool || typeof tool !== 'object' || (tool as Record<string, unknown>).type !== 'function') {
        throw new ValidationError(
          'provider-managed tools are not supported by hard budgets because no enforceable pre-dispatch cost ceiling is available',
        );
      }
    }
  }
  if (containsUnsupportedHardBudgetContent(body.input) || containsUnsupportedHardBudgetContent(body.messages)) {
    throw new ValidationError(
      'images and provider-managed file attachments are not supported by hard budgets because no enforceable pre-dispatch token ceiling is available',
    );
  }
}

function requestedMaxOutputTokens(body: Record<string, unknown>, path?: string): number {
  const chatFields = [
    ['max_completion_tokens', body.max_completion_tokens],
    ['max_tokens', body.max_tokens],
    ['maxTokens', body.maxTokens],
  ] as const;
  const suppliedChatFields = chatFields.filter(([, candidate]) => candidate !== undefined);
  const chatMax = suppliedChatFields[0]?.[1];
  const value = path === '/v1/responses' ? body.max_output_tokens : path === '/v1/chat/completions' ? chatMax : chatMax ?? body.max_output_tokens;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    const field = path === '/v1/responses' ? 'max_output_tokens' : 'max_completion_tokens or max_tokens';
    throw new ValidationError(`hard budgets require an explicit positive integer ${field}`);
  }
  if (path === '/v1/chat/completions' && suppliedChatFields.some(([, candidate]) => candidate !== value)) {
    throw new ValidationError(
      'max_completion_tokens, max_tokens, and maxTokens must match when provided together',
    );
  }
  return value as number;
}

export function budgetCheck() {
  return createMiddleware<Env>(async (c, next) => {
    if (c.req.method !== 'POST' || !BUDGETED_POST_PATHS.has(c.req.path)) return await next();
    const budgetId: string | undefined = c.get('budgetId');
    if (!budgetId) return await next();

    const sessionId = c.req.header('x-llmkit-session-id');
    validateSessionId(sessionId);
    validateEndUserId(c.req.header('x-llmkit-user-id'));

    const body = await parseBody(c);
    validateHardBudgetTopLevelFields(body, c.req.path);
    validateHardBudgetToolBoundary(body);
    const model = body.model as string;
    const provider = (c.req.header('x-llmkit-provider') || body.provider || inferProvider(model) || 'openai') as ProviderName;
    const providers = c.req.path === '/v1/chat/completions'
      ? resolveProviderChain(provider, c.req.header('x-llmkit-fallback'))
      : [provider];
    requestedMaxOutputTokens(body, c.req.path);
    await Promise.all(providers.map((providerName) => estimateCost(body, providerName)));
    c.set('requestProvider', providers[0]);
    if (body.model) c.set('requestModel', body.model as string);
    await next();
  });
}

export async function admitBudgetForDispatch(
  c: Context<Env>,
  body: Record<string, unknown>,
  providers: ProviderName[],
): Promise<void> {
  const budgetId = c.get('budgetId');
  if (!budgetId || c.get('budgetReservationId')) return;

  const sessionId = c.req.header('x-llmkit-session-id') || undefined;
  const estimates = await Promise.all(providers.map((providerName) => estimateCost(body, providerName)));
  // A failed dispatched attempt may still be billable. Reserve every possible
  // attempt before the first dispatch so fallback cannot cross the hard limit.
  const estimated = estimates.reduce((total, cost) => total + cost, 0);
  const requestId = c.get('requestId');
  const apiKeyId = c.get('apiKeyId');
  const userId = c.get('userId');
  const customerId = c.get('customerId');
  if (!requestId || !apiKeyId || !userId || !customerId) {
    throw new Error('hard budget admission requires a durable request evidence identity');
  }
  const receipt: RequestInsert = {
    id: requestId,
    user_id: userId,
    api_key_id: apiKeyId,
    customer_id: customerId,
    workflow_id: c.get('workflowId') || null,
    agent_id: c.get('agentId') || null,
    session_id: c.get('sessionId') || null,
    end_user_id: c.get('endUserId') || null,
    budget_id: budgetId,
    budget_reservation_id: null,
    reserved_cost_cents: estimated,
    settlement_status: 'pending',
    idempotency_key_hash: c.get('idempotencyKeyHash') || null,
    response_sha256: null,
    provider: providers[0] || 'unknown',
    model: typeof body.model === 'string' ? body.model : 'unknown',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_cents: null,
    latency_ms: 0,
    status: 'pending',
    error_code: null,
    source: 'proxy',
    tool_calls: null,
  };
  const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(budgetId));
  const result = await stub.check({
    sessionId,
    estimatedCents: estimated,
    budgetConfig: c.get('budgetConfig'),
    dispatching: true,
    receipt,
  });

  if (!result.allowed) {
    throw new BudgetExceededError(budgetId, result.limitCents, result.usedCents);
  }
  if (!result.reservationId) {
    throw new Error('hard budget admission did not create a reservation');
  }

  c.set('budgetScope', result.scope);
  c.set('budgetReservationId', result.reservationId);
  c.set('budgetReservedCostCents', estimated);
}

export async function recordUsage(
  doNamespace: DurableObjectNamespace<BudgetDO>,
  budgetId: string,
  sessionId: string | undefined,
  costCents: number,
  reservationId?: string,
  receipt?: RequestInsert,
): Promise<{ webhookUrl: string; body: Record<string, unknown> } | null> {
  const stub = doNamespace.get(doNamespace.idFromName(budgetId));
  const result = await stub.record({ reservationId: reservationId || '', sessionId, costCents, receipt });
  if (result.settlementAccepted === false) throw new Error('budget settlement was not accepted');

  if (result.alert) {
    const body: Record<string, unknown> = {
      type: result.alert.anomaly ? 'budget.anomaly' : 'budget.threshold',
      budgetId: result.alert.budgetId,
      usedCents: result.alert.usedCents,
      limitCents: result.alert.limitCents,
      percentage: result.alert.percentage,
      period: result.alert.period,
      timestamp: new Date().toISOString(),
    };
    if (result.alert.anomaly) {
      body.anomaly = result.alert.anomaly;
    }
    return { webhookUrl: result.alert.webhookUrl, body };
  }

  return null;
}

export async function releaseReservation(
  doNamespace: DurableObjectNamespace<BudgetDO>,
  budgetId: string,
  reservationId: string,
): Promise<void> {
  const stub = doNamespace.get(doNamespace.idFromName(budgetId));
  await stub.release(reservationId);
}

export async function finalizeReservationFailure(
  doNamespace: DurableObjectNamespace<BudgetDO>,
  budgetId: string | undefined,
  reservationId: string | undefined,
  receipt?: RequestInsert,
): Promise<FailureFinalizationResult> {
  if (!budgetId || !reservationId) {
    return { disposition: 'missing', committedCents: 0, usedCents: 0, limitCents: 0 };
  }
  const stub = doNamespace.get(doNamespace.idFromName(budgetId));
  return stub.finalizeFailure(reservationId, receipt);
}

export async function attachReceiptResponseHash(
  doNamespace: DurableObjectNamespace<BudgetDO>,
  budgetId: string | undefined,
  requestId: string,
  responseSha256: string,
): Promise<void> {
  if (!budgetId) return;
  const stub = doNamespace.get(doNamespace.idFromName(budgetId));
  const attached = await stub.attachResponseHash(requestId, responseSha256);
  if (!attached) throw new Error('request receipt response hash could not be attached');
}

export async function sendAlert(alert: { webhookUrl: string; body: Record<string, unknown> }): Promise<void> {
  try {
    if (!alert.webhookUrl.startsWith('https://')) return;
    await fetch(alert.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert.body),
    });
  } catch (err) {
    console.error('budget alert webhook failed:', err);
  }
}

// pure functions for cost estimation (exported for testing)

const HARD_BUDGET_INPUT_OVERHEAD_TOKENS = 1024;

function estimateInputTokenCeiling(body: Record<string, unknown>): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new ValidationError('request body must be JSON-serializable for hard-budget admission');
  }
  // Supported hard-budget requests are text plus optional client-side function
  // schemas. Counting every UTF-8 request byte as a token includes schemas and
  // structural fields, then adds an explicit allowance for provider wrappers.
  return new TextEncoder().encode(serialized).byteLength + HARD_BUDGET_INPUT_OVERHEAD_TOKENS;
}

export async function estimateCost(body: Record<string, unknown>, provider: ProviderName): Promise<number> {
  const model = body.model as string;
  if (!model) throw new ValidationError('model is required for hard-budget admission');

  const pricing = PRICING[provider]?.[model];
  if (!pricing) {
    throw new ValidationError(
      `hard budgets require pinned pricing for ${provider}/${model}; update the pricing snapshot before dispatch`,
    );
  }

  const inputTokens = estimateInputTokenCeiling(body);
  const maxOutput = requestedMaxOutputTokens(body);
  const inputRate = Math.max(
    pricing.inputPerMillion,
    pricing.cacheReadPerMillion ?? 0,
    pricing.cacheWritePerMillion ?? 0,
  );

  const costUsd =
    (inputTokens / 1_000_000) * inputRate +
    (maxOutput / 1_000_000) * pricing.outputPerMillion;

  return Math.ceil(costUsd * 100);
}
