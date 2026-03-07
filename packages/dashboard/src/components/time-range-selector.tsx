'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';

const ranges = [
  { label: 'Today', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'All', days: 0 },
] as const;

const DEFAULT_DAYS = 30;

export function TimeRangeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get('days');
  const activeDays = raw !== null ? Number(raw) : DEFAULT_DAYS;

  const setRange = useCallback(
    (days: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (days === DEFAULT_DAYS) {
        params.delete('days');
      } else {
        params.set('days', String(days));
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex items-center gap-1">
      {ranges.map(({ label, days }) => (
        <button
          key={days}
          onClick={() => setRange(days)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            activeDays === days
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
