import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  getAccountPlan,
  getAdminRequestsPaginated,
  getAdminDistinctProviders,
  getAdminDistinctModels,
  getAdminDistinctUsers,
} from '@/lib/queries';
import type { AdminRequestFilters } from '@/lib/queries';
import { formatCents, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { RequestFilters as Filters } from '@/components/request-filters';
import { Pagination } from '@/components/pagination';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminRequestsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect('/dashboard');
  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') redirect('/dashboard');

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 50;

  const filters: AdminRequestFilters = {
    provider: params.provider,
    model: params.model,
    status: params.status,
    sessionId: params.session_id,
    userId: params.user,
    sortBy: params.sort || 'created_at',
    sortOrder: (params.order as 'asc' | 'desc') || 'desc',
  };

  const [result, providers, models, users] = await Promise.all([
    getAdminRequestsPaginated(page, pageSize, filters),
    getAdminDistinctProviders(),
    getAdminDistinctModels(),
    getAdminDistinctUsers(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/admin"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Admin
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-semibold">Request Explorer</h1>
        </div>
        <Filters providers={providers} models={models} />
      </div>

      {/* active filter badges */}
      {(filters.userId || filters.sessionId) && (
        <div className="flex items-center gap-2">
          {filters.userId && (
            <Link
              href={buildUrl(params, { user: undefined })}
              className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs hover:bg-primary/20"
            >
              <span className="text-muted-foreground">User:</span>
              <span className="max-w-[140px] truncate font-mono">{filters.userId}</span>
              <span className="ml-0.5 text-muted-foreground">x</span>
            </Link>
          )}
        </div>
      )}

      {/* user filter dropdown */}
      {users.length > 1 && !filters.userId && (
        <UserFilterSelect users={users} currentParams={params} />
      )}

      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2a2a] text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">User</th>
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
                  <td className="px-4 py-2.5">
                    <Link
                      href={buildUrl(params, { user: req.user_id, page: undefined })}
                      className="font-mono text-xs text-muted-foreground hover:text-foreground"
                      title={req.user_id}
                    >
                      {req.user_id.slice(0, 12)}...
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
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
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

function buildUrl(
  current: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  return `/dashboard/admin/requests?${params.toString()}`;
}

interface UserFilterSelectProps {
  users: { userId: string; keyCount: number }[];
  currentParams: Record<string, string | undefined>;
}

function UserFilterSelect({ users, currentParams }: UserFilterSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Filter by user:</span>
      <div className="flex flex-wrap gap-1.5">
        {users.map((u) => (
          <Link
            key={u.userId}
            href={buildUrl(currentParams, { user: u.userId, page: undefined })}
            className="rounded-md border border-border bg-secondary px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            {u.userId.slice(0, 12)}... ({u.keyCount} keys)
          </Link>
        ))}
      </div>
    </div>
  );
}
