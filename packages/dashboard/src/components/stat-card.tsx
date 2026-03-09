interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[10px] text-muted-foreground">unchanged</span>;
  const positive = delta > 0;
  const color = positive ? 'text-emerald-400' : 'text-red-400';
  const arrow = positive ? '\u2191' : '\u2193';
  return <span className={`text-[10px] font-medium ${color}`}>{arrow}{Math.abs(delta)}%</span>;
}

export function StatCard({ label, value, sublabel, delta }: StatCardProps) {
  return (
    <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {delta != null && <DeltaBadge delta={delta} />}
      </div>
      <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
    </div>
  );
}
