'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DataPoint {
  date: string;
  cost: number;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground">{formatDateShort(label)}</p>
      <p className="font-mono font-semibold text-primary">
        ${payload[0].value < 0.01 ? payload[0].value.toFixed(4) : payload[0].value.toFixed(2)}
      </p>
    </div>
  );
}

export function CostChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No spend data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="#a3a3a3"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDateShort}
        />
        <YAxis
          stroke="#a3a3a3"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => {
            if (v === 0) return '$0';
            if (v < 0.01) return `$${v.toFixed(4)}`;
            if (v < 1) return `$${v.toFixed(2)}`;
            return `$${v.toFixed(0)}`;
          }}
          width={56}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="cost"
          stroke="#7c3aed"
          strokeWidth={2}
          fill="url(#costGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
