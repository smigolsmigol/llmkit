import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRequestById } from '@/lib/queries';
import { formatCents } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { getModelPricing, type ProviderName } from '@f3d1/llmkit-shared';

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
  const req = await getRequestById(userId, id);
  if (!req) notFound();

  const ok = !req.error_code;
  const totalTokens = req.input_tokens + req.output_tokens;
  const pricing = getModelPricing(req.provider as ProviderName, req.model);
  const perM = 1_000_000;
  const inputCost = pricing ? (req.input_tokens / perM) * pricing.inputPerMillion : 0;
  const outputCost = pricing ? (req.output_tokens / perM) * pricing.outputPerMillion : 0;
  const cacheReadCost = pricing?.cacheReadPerMillion ? (req.cache_read_tokens / perM) * pricing.cacheReadPerMillion : 0;
  const cacheWriteCost = pricing?.cacheWritePerMillion ? (req.cache_write_tokens / perM) * pricing.cacheWritePerMillion : 0;

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
        <Badge variant={ok ? 'success' : 'destructive'} className="ml-auto">
          {ok ? 'OK' : req.error_code || 'Error'}
        </Badge>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Overview</h2>
        <Row label="Time">{new Date(req.created_at).toLocaleString()}</Row>
        <Row label="Provider">{req.provider}</Row>
        <Row label="Model">{req.model}</Row>
        <Row label="Latency">{req.latency_ms.toLocaleString()}ms</Row>
        {req.session_id && <Row label="Session">{req.session_id}</Row>}
        <Row label="Request ID">
          <span className="text-xs text-muted-foreground">{req.id}</span>
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
        <Row label="Total">{formatCents(Number(req.cost_cents))}</Row>
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
        {totalTokens > 0 && (
          <Row label="Per 1k Tokens">
            ${((Number(req.cost_cents) / 100 / totalTokens) * 1000).toFixed(4)}
          </Row>
        )}
      </div>
    </div>
  );
}
