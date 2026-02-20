export function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-5">
      <div className="h-4 w-20 rounded bg-secondary" />
      <div className="mt-2 h-8 w-28 rounded bg-secondary" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-5">
      <div className="mb-4 h-4 w-24 rounded bg-secondary" />
      <div className="h-[280px] rounded bg-secondary/50" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border p-4">
        <div className="flex gap-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 w-16 rounded bg-secondary" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border/50 p-4">
          <div className="flex gap-8">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="h-4 w-20 rounded bg-secondary/70" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="h-4 w-24 rounded bg-secondary" />
      </div>
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-secondary/50" style={{ width: `${70 + Math.random() * 30}%` }} />
        ))}
      </div>
    </div>
  );
}
