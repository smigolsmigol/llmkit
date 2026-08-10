export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { calculateCostFromPricing, getModelPricing, type ProviderName } from '@f3d1/llmkit-shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { formatCents } from '@/lib/format';
import { getRequestById } from '@/lib/queries';

interface PageProps {
  params: Promise<{ id: string }>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/50 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{children}</span>
    </div>
  );
}

export default async function RequestDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { id } = await params;

  let req: Awaited<ReturnType<typeof getRequestById>>;
  try {
    req = await getRequestById(userId, id);
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Request Detail</h1>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Unable to load data. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  if (!req) notFound();

  const pending = req.status === 'pending';
  const ok = req.status === 'success' && !req.error_code;
  const totalTokens = req.input_tokens + req.output_tokens;
  const pricing = getModelPricing(req.provider as ProviderName, req.model);
  const committedCostCents = req.cost_cents === null ? null : Number(req.cost_cents);
  const toolCallRows: Array<{ key: string; label: string; name: string }> = [];
  const toolCallOccurrences = new Map<string, number>();
  for (const [ordinal, toolCall] of (req.tool_calls ?? []).entries()) {
    const occurrence = (toolCallOccurrences.get(toolCall.name) ?? 0) + 1;
    toolCallOccurrences.set(toolCall.name, occurrence);
    toolCallRows.push({
      key: `${toolCall.name}:${occurrence}`,
      label: `#${ordinal + 1}`,
      name: toolCall.name,
    });
  }
  const toolCallCount = toolCallRows.length;
  const costBreakdown = pricing && committedCostCents !== null
    ? calculateCostFromPricing(pricing, {
        inputTokens: req.input_tokens,
        outputTokens: req.output_tokens,
        cacheReadTokens: req.cache_read_tokens,
        cacheWriteTokens: req.cache_write_tokens,
        totalTokens: req.input_tokens + req.output_tokens,
      })
    : null;
  const inputCost = costBreakdown?.inputCost ?? 0;
  const outputCost = costBreakdown?.outputCost ?? 0;
  const cacheReadCost = costBreakdown?.cacheReadCost ?? 0;
  const cacheWriteCost = costBreakdown?.cacheWriteCost ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/requests"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Requests
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold">Request Detail</h1>
        <Badge variant={pending ? 'secondary' : ok ? 'success' : 'destructive'} className="ml-auto">
          {pending ? 'Pending' : ok ? 'OK' : req.error_code || 'Error'}
        </Badge>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Overview</h2>
        <Row label="Time">{new Date(req.created_at).toLocaleString()}</Row>
        <Row label="Provider">{req.provider}</Row>
        <Row label="Model">{req.model}</Row>
        <Row label="Latency">{req.latency_ms.toLocaleString()}ms</Row>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Receipt / Attribution</h2>
        <Row label="Request ID"><span className="break-all text-xs">{req.id}</span></Row>
        <Row label="Customer">{req.customer_id ?? 'Not recorded'}</Row>
        <Row label="Workflow">{req.workflow_id ?? 'Not recorded'}</Row>
        <Row label="Agent">{req.agent_id ?? 'Not recorded'}</Row>
        <Row label="Session">{req.session_id ?? 'Not recorded'}</Row>
        <Row label="End User">{req.end_user_id ?? 'Not recorded'}</Row>
        <Row label="Budget">
          <span className="break-all text-xs">{req.budget_id ?? 'Not recorded'}</span>
        </Row>
        <Row label="Reservation">
          <span className="break-all text-xs">{req.budget_reservation_id ?? 'Not recorded'}</span>
        </Row>
        <Row label="Reserved Ceiling">
          {req.reserved_cost_cents === null
            ? 'Unknown'
            : formatCents(Number(req.reserved_cost_cents))}
        </Row>
        <Row label="Settlement">{req.settlement_status}</Row>
        <Row label="Idempotency Scope Hash">
          <span className="break-all text-xs">{req.idempotency_key_hash ?? 'Not recorded'}</span>
        </Row>
        <Row label="Response SHA-256">
          <span className="break-all text-xs">{req.response_sha256 ?? 'Not recorded'}</span>
        </Row>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Tokens</h2>
        <Row label="Input">{req.input_tokens.toLocaleString()}</Row>
        <Row label="Output">{req.output_tokens.toLocaleString()}</Row>
        {req.cache_read_tokens > 0 && (
          <Row label="Cache Read">{req.cache_read_tokens.toLocaleString()}</Row>
        )}
        {req.cache_write_tokens > 0 && (
          <Row label="Cache Write">{req.cache_write_tokens.toLocaleString()}</Row>
        )}
        <Row label="Total">{totalTokens.toLocaleString()}</Row>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Cost</h2>
        <Row label="Committed Total">
          {committedCostCents === null ? 'Unknown' : formatCents(committedCostCents)}
        </Row>
        {inputCost > 0 && (
          <Row label="Input">${inputCost.toFixed(6)}</Row>
        )}
        {outputCost > 0 && (
          <Row label="Output">${outputCost.toFixed(6)}</Row>
        )}
        {cacheReadCost > 0 && (
          <Row label="Cache Read">${cacheReadCost.toFixed(6)}</Row>
        )}
        {cacheWriteCost > 0 && (
          <Row label="Cache Write">${cacheWriteCost.toFixed(6)}</Row>
        )}
        {costBreakdown?.extraCosts?.map((ec) => (
          <Row key={ec.dimension} label={`${ec.dimension.replace('_', ' ')} (${ec.quantity}x)`}>
            ${ec.totalCost.toFixed(6)}
          </Row>
        ))}
        {totalTokens > 0 && committedCostCents !== null && (
          <Row label="Per 1k Tokens">
            ${((committedCostCents / 100 / totalTokens) * 1000).toFixed(4)}
          </Row>
        )}
      </div>

      {toolCallCount > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Tool Calls ({toolCallCount})</h2>
          {toolCallRows.map((toolCall) => (
            <Row key={toolCall.key} label={toolCall.label}>{toolCall.name}</Row>
          ))}
        </div>
      )}
    </div>
  );
}
