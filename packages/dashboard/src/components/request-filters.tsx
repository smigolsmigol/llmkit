'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';

interface RequestFiltersProps {
  providers: string[];
  models: string[];
}

export function RequestFilters({ providers, models }: RequestFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page'); // reset to page 1 on filter change
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const activeProvider = searchParams.get('provider') || '';
  const activeModel = searchParams.get('model') || '';
  const activeStatus = searchParams.get('status') || '';
  const activeSession = searchParams.get('session_id') || '';

  return (
    <div className="flex items-center gap-3">
      {activeSession && (
        <span className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs">
          <span className="text-muted-foreground">Session:</span>
          <span className="max-w-[120px] truncate font-mono">{activeSession}</span>
          <button
            onClick={() => updateParam('session_id', '')}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            x
          </button>
        </span>
      )}

      <select
        value={activeProvider}
        onChange={(e) => updateParam('provider', e.target.value)}
        className="h-8 rounded-md border border-border bg-secondary px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Providers</option>
        {providers.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <select
        value={activeModel}
        onChange={(e) => updateParam('model', e.target.value)}
        className="h-8 rounded-md border border-border bg-secondary px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Models</option>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      <select
        value={activeStatus}
        onChange={(e) => updateParam('status', e.target.value)}
        className="h-8 rounded-md border border-border bg-secondary px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Status</option>
        <option value="ok">Success</option>
        <option value="error">Error</option>
      </select>

      {(activeProvider || activeModel || activeStatus || activeSession) && (
        <button
          onClick={() => router.push(pathname)}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
