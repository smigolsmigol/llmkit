export default function AdminLoading() {
  const tabSkeletons = [
    { id: 'overview', width: 'w-16' },
    { id: 'infrastructure', width: 'w-24' },
    { id: 'ecosystem', width: 'w-20' },
    { id: 'users', width: 'w-14' },
    { id: 'alerts', width: 'w-14' },
  ];
  const statSkeletons = ['spend', 'requests', 'accounts', 'tokens'];

  return (
    <div className="space-y-1.5 animate-pulse">
      {/* header row */}
      <div className="flex items-center justify-between">
        <div className="h-6 w-16 rounded bg-secondary" />
        <div className="h-8 w-40 rounded bg-secondary" />
      </div>

      {/* tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {tabSkeletons.map(({ id, width }) => (
          <div key={id} className={`${width} h-7 rounded-md bg-secondary`} />
        ))}
      </div>

      {/* stat cards row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {statSkeletons.map((id) => (
          <div key={`primary-${id}`} className="rounded-lg border border-border bg-card p-3">
            <div className="h-3 w-20 rounded bg-secondary" />
            <div className="mt-2 h-7 w-16 rounded bg-secondary" />
          </div>
        ))}
      </div>

      {/* stat cards row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {statSkeletons.map((id) => (
          <div key={`secondary-${id}`} className="rounded-lg border border-border bg-card p-3">
            <div className="h-3 w-20 rounded bg-secondary" />
            <div className="mt-2 h-7 w-16 rounded bg-secondary" />
          </div>
        ))}
      </div>

      {/* charts 2x2 */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="h-48 rounded-lg border border-border bg-card" />
        <div className="h-48 rounded-lg border border-border bg-card" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="h-48 rounded-lg border border-border bg-card" />
        <div className="h-48 rounded-lg border border-border bg-card" />
      </div>
    </div>
  );
}
