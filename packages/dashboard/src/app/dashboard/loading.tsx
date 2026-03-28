export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-7 w-32 rounded bg-secondary" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-5">
            <div className="h-4 w-20 rounded bg-secondary" />
            <div className="mt-2 h-8 w-24 rounded bg-secondary" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="col-span-2 h-[360px] rounded-lg border border-border bg-card" />
        <div className="h-[360px] rounded-lg border border-border bg-card" />
      </div>

      <div className="h-[240px] rounded-lg border border-border bg-card" />
    </div>
  );
}
