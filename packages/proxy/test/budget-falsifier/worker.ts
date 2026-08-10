import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { BudgetDO, type RecordInput, type RecordResult } from '../../src/do/budget-do';
import { IdempotencyDO } from '../../src/do/idempotency-do';
import { RateLimitDO } from '../../src/do/ratelimit-do';
import type { Env } from '../../src/env';
import { handleAppError } from '../../src/index';
import { budgetCheck, estimateCost } from '../../src/middleware/budget';
import { idempotency } from '../../src/middleware/idempotency';
import { costLogger } from '../../src/middleware/logger';
import { requestEvidence } from '../../src/middleware/request-evidence';
import { providerRouter } from '../../src/routes/chat';
import { responsesRouter } from '../../src/routes/responses';

export { BudgetDO, IdempotencyDO, RateLimitDO };

export class FailingRecordBudgetDO extends BudgetDO {
  override async record(_input: RecordInput): Promise<RecordResult> {
    return { usedCents: 0, limitCents: 0, settlementAccepted: false };
  }
}

interface SoftState {
  limitCents: number;
  usedCents: number;
}

interface SoftAdmission {
  allowed: boolean;
  limitCents: number;
  usedCents: number;
}

export interface SoftSnapshot extends SoftState {
  settlementCount: number;
}

export class SoftBudgetDO extends DurableObject {
  async admit(input: { limitCents: number; estimatedCents: number }): Promise<SoftAdmission> {
    return this.ctx.storage.transaction(async (storage) => {
      let state = await storage.get<SoftState>('root');
      if (!state) {
        state = { limitCents: input.limitCents, usedCents: 0 };
        await storage.put('root', state);
      }

      return {
        allowed: state.usedCents + input.estimatedCents <= state.limitCents,
        limitCents: state.limitCents,
        usedCents: state.usedCents,
      };
    });
  }

  async settle(input: { settlementId: string; costCents: number }): Promise<SoftSnapshot> {
    await this.ctx.storage.transaction(async (storage) => {
      const duplicate = await storage.get<boolean>(`settled:${input.settlementId}`);
      const state = (await storage.get<SoftState>('root')) ?? {
        limitCents: 0,
        usedCents: 0,
      };
      if (!duplicate) {
        state.usedCents += Math.max(0, input.costCents);
        await storage.put('root', state);
        await storage.put(`settled:${input.settlementId}`, true);
      }
    });
    return this.snapshot();
  }

  async snapshot(): Promise<SoftSnapshot> {
    const state = (await this.ctx.storage.get<SoftState>('root')) ?? {
      limitCents: 0,
      usedCents: 0,
    };
    const settlementCount = (await this.ctx.storage.list({ prefix: 'settled:' })).size;
    return { ...state, settlementCount };
  }
}

type ProofBindings = Env['Bindings'] & {
  FAIL_RECORD_BUDGET_DO: DurableObjectNamespace<FailingRecordBudgetDO>;
  SOFT_BUDGET_DO: DurableObjectNamespace<SoftBudgetDO>;
};

function requiredPositiveInteger(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

const injectProofIdentity = createMiddleware<Env>(async (c, next) => {
  const budgetId = c.req.header('x-proof-budget-id');
  const requestId = c.req.header('x-proof-request-id');
  const variant = c.req.header('x-proof-variant');
  if (!budgetId || !requestId || (variant !== 'hard' && variant !== 'soft')) {
    return c.json({ error: 'missing proof identity' }, 400);
  }
  const limitCents = requiredPositiveInteger(c.req.header('x-proof-limit-cents'), 'limit');
  c.set('budgetId', budgetId);
  c.set('budgetConfig', { limitCents, period: 'total' });
  if (c.req.header('x-proof-no-api-key') !== 'true') c.set('apiKeyId', 'proof-api-key');
  if (c.req.header('x-proof-no-user') !== 'true') c.set('userId', 'proof-user');
  await next();
});

const softBudgetCheck = createMiddleware<Env>(async (c, next) => {
  const body = await c.req.json<Record<string, unknown>>();
  const provider = c.req.header('x-llmkit-provider') || 'openai';
  const estimatedCents = await estimateCost(body, provider as 'openai');
  const budgetId = c.get('budgetId');
  const limitCents = c.get('budgetConfig')?.limitCents;
  if (!budgetId || !limitCents) throw new Error('soft proof budget identity missing');

  const softNamespace = (c.env as ProofBindings).SOFT_BUDGET_DO;
  const stub = softNamespace.get(softNamespace.idFromName(budgetId));
  const admission = await stub.admit({ limitCents, estimatedCents });
  if (!admission.allowed) {
    return c.json({ error: 'soft budget exceeded', admission }, 429);
  }

  // The soft reference owns its test-only ledger and must not enter the
  // production hard-admission helper in the routed provider handler.
  c.set('budgetId', undefined);
  await next();
  const meta = c.get('llmkit_response');
  if (meta) {
    await stub.settle({
      settlementId: c.req.header('x-proof-request-id') || 'missing',
      costCents: Math.ceil(meta.cost.totalCost * 100),
    });
  }
});

const hardBudget = budgetCheck();
const hardCostLogger = costLogger();
const app = new Hono<Env>();

app.onError(handleAppError);

app.use('/v1/*', injectProofIdentity);
app.use('/v1/*', requestEvidence());
app.use('/v1/*', idempotency());
app.use('/v1/*', async (c, next) => {
  if (c.req.header('x-proof-predispatch-throw') === 'true') {
    throw new Error('controlled pre-dispatch proof failure');
  }
  if (c.req.header('x-proof-no-budget') === 'true') {
    c.set('budgetId', undefined);
    return next();
  }
  if (c.req.header('x-proof-variant') === 'soft') return softBudgetCheck(c, next);
  return hardBudget(c, next);
});
app.use('/v1/*', async (c, next) => {
  if (c.req.header('x-proof-no-budget') === 'true') return next();
  if (c.req.header('x-proof-variant') === 'hard') return hardCostLogger(c, next);
  return next();
});
app.route('/v1', providerRouter);
app.route('/v1', responsesRouter);
app.post('/v1/control', (c) => c.json({ ok: true }));

const proofWorker: ExportedHandler<ProofBindings> = {
  fetch(request, env, ctx) {
    const selectedEnv: Env['Bindings'] = request.headers.get('x-proof-settlement-failure') === 'true'
      ? { ...env, BUDGET_DO: env.FAIL_RECORD_BUDGET_DO }
      : env;
    return app.fetch(request, selectedEnv, ctx);
  },
};

export default proofWorker;
