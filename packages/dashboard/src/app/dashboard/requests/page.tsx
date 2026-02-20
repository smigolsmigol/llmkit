import { auth } from '@clerk/nextjs/server';
import { getRequestsPaginated, getDistinctProviders, getDistinctModels } from '@/lib/queries';
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
    sortBy: params.sort || 'created_at',
    sortOrder: (params.order as 'asc' | 'desc') || 'desc',
  };

  let result = { data: [] as Awaited<ReturnType<typeof getRequestsPaginated>>['data'], total: 0, page, pageSize };
  let providers: string[] = [];
  let models: string[] = [];
  let connected = true;

  try {
    [result, providers, models] = await Promise.all([
      getRequestsPaginated(userId, page, pageSize, filters),
      getDistinctProviders(userId),
      getDistinctModels(userId),
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
            Supabase not connected. Add env vars to .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Requests</h1>
        <Filters providers={providers} models={models} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Provider</th>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-4 py-2.5 font-medium text-right">Tokens</th>
              <th className="px-4 py-2.5 font-medium text-right">Cost</th>
              <th className="px-4 py-2.5 font-medium text-right">Latency</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((req) => {
              const tokens = req.input_tokens + req.output_tokens;
              const ok = !req.error_code;
              return (
                <tr key={req.id} className="border-b border-border/50 transition-colors hover:bg-secondary/50">
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(req.created_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{req.provider}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{req.model}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {tokens.toLocaleString()}
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
                  No requests found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={result.total} />
      )}
    </div>
  );
}
