interface ThresholdStatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  rawValue: number;
  thresholds: { amber: number; red: number };
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[10px] text-zinc-500">unchanged</span>;
  const positive = delta > 0;
  const color = positive ? 'text-emerald-400' : 'text-red-400';
  const arrow = positive ? '\u2191' : '\u2193';
  return <span className={`text-[10px] font-medium ${color}`}>{arrow}{Math.abs(delta)}%</span>;
}

export function ThresholdStatCard({ label, value, sublabel, delta, rawValue, thresholds }: ThresholdStatCardProps) {
  const level = rawValue >= thresholds.red ? 'red' : rawValue >= thresholds.amber ? 'amber' : 'normal';
  const borderColor = level === 'red' ? 'border-red-500/30' : level === 'amber' ? 'border-amber-500/30' : 'border-border';
  const bgColor = level === 'red' ? 'bg-red-500/5' : level === 'amber' ? 'bg-amber-500/5' : 'bg-card';

  return (
    <div className="group relative">
      <div className="absolute -inset-px rounded-lg bg-gradient-to-b from-white/[0.06] to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
      <div className={`relative glow-hover rounded-lg border ${borderColor} ${bgColor} p-4`}>
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">{label}</p>
          {delta != null && <DeltaBadge delta={delta} />}
        </div>
        <p className={`mt-1 font-mono text-2xl font-semibold ${level === 'red' ? 'text-red-400' : level === 'amber' ? 'text-amber-400' : 'text-gradient-primary'}`}>
          {value}
        </p>
        {sublabel && <p className="mt-1 text-xs text-zinc-500">{sublabel}</p>}
      </div>
    </div>
  );
}
