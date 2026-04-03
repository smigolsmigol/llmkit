export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Requests - LLMKit' };
import { getRequestsPaginated, getDistinctProviders, getDistinctModels, getRequestSummary } from '@/lib/queries';
import type { RequestFilters } from '@/lib/queries';
import { formatCents, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { RequestFilters as Filters } from '@/components/request-filters';
import { Pagination } from '@/components/pagination';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 25;

  const filters: RequestFilters = {
    provider: params.provider,
    model: params.model,
    status: params.status,
    sessionId: params.session_id,
    sortBy: params.sort || 'created_at',
    sortOrder: (params.order as 'asc' | 'desc') || 'desc',
  };

  let result = { data: [] as Awaited<ReturnType<typeof getRequestsPaginated>>['data'], total: 0, page, pageSize };
  let providers: string[] = [];
  let models: string[] = [];
  let summary = { totalRequests: 0, totalSpendCents: 0, totalInputTokens: 0, totalOutputTokens: 0, avgCostCents: 0, avgLatencyMs: 0, projectedMonthlyCents: 0 };
  let connected = true;

  try {
    [result, providers, models, summary] = await Promise.all([
      getRequestsPaginated(userId, page, pageSize, filters),
      getDistinctProviders(userId),
      getDistinctModels(userId),
      getRequestSummary(userId),
    ]);
  } catch {
    connected = false;
  }

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  if (!connected) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Requests</h1>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Unable to load data. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Requests</h1>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export?format=detailed&days=30${filters.provider ? `&provider=${filters.provider}` : ''}${filters.model ? `&model=${filters.model}` : ''}${filters.sessionId ? `&session=${filters.sessionId}` : ''}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            download
          >
            Export CSV
          </a>
          <Filters providers={providers} models={models} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Total Spend</p>
          <p className="mt-0.5 font-mono text-lg font-semibold">{formatCents(summary.totalSpendCents)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Requests</p>
          <p className="mt-0.5 font-mono text-lg font-semibold">{summary.totalRequests.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Avg Cost</p>
          <p className="mt-0.5 font-mono text-lg font-semibold">{formatCents(summary.avgCostCents)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Avg Latency</p>
          <p className="mt-0.5 font-mono text-lg font-semibold">{summary.avgLatencyMs}ms</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Tokens</p>
          <p className="mt-0.5 font-mono text-lg font-semibold">
            {((summary.totalInputTokens + summary.totalOutputTokens) / 1000).toFixed(1)}k
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Provider</th>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-4 py-2.5 font-medium text-right">In / Out</th>
              <th className="px-4 py-2.5 font-medium text-right">Cost</th>
              <th className="px-4 py-2.5 font-medium text-right">Latency</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((req) => {
              const ok = !req.error_code;
              return (
                <tr key={req.id} className="border-b border-border/50 transition-colors hover:bg-secondary/50">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <Link href={`/dashboard/requests/${req.id}`} className="hover:underline">
                      {formatDate(req.created_at)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{req.provider}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{req.model}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {req.input_tokens.toLocaleString()} / {req.output_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {formatCents(Number(req.cost_cents))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {req.latency_ms}ms
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={ok ? 'success' : 'destructive'}>
                      {ok ? 'OK' : req.error_code || 'Error'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {result.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No requests yet. <a href="/docs" className="text-violet-400 hover:underline">See how to send your first request</a>.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>

      {result.total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={result.total} />
      )}
    </div>
  );
}
