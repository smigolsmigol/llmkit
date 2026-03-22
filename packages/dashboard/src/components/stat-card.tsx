interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[10px] text-zinc-500">unchanged</span>;
  const positive = delta > 0;
  const color = positive ? 'text-emerald-400' : 'text-red-400';
  const arrow = positive ? '\u2191' : '\u2193';
  return <span className={`text-[10px] font-medium ${color}`}>{arrow}{Math.abs(delta)}%</span>;
}

export function StatCard({ label, value, sublabel, delta }: StatCardProps) {
  return (
    <div className="group relative">
      <div className="absolute -inset-px rounded-lg bg-gradient-to-b from-white/[0.06] to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
      <div className="relative glow-hover rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">{label}</p>
          {delta != null && <DeltaBadge delta={delta} />}
        </div>
        <p className="text-gradient-primary mt-1 font-mono text-2xl font-semibold">{value}</p>
        {sublabel && <p className="mt-1 text-xs text-zinc-500">{sublabel}</p>}
      </div>
    </div>
  );
}
