'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#7c3aed', '#14b8a6', '#3b82f6', '#a855f7', '#06b6d4'];

interface DataPoint {
  provider: string;
  cost: number;
  count: number;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: DataPoint }[] }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{data.provider}</p>
      <p className="font-mono text-primary">
        ${data.cost < 0.01 ? data.cost.toFixed(4) : data.cost.toFixed(2)}
      </p>
      <p className="text-muted-foreground">{data.count} requests</p>
    </div>
  );
}

export function ProviderChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No provider data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
        <XAxis
          dataKey="provider"
          stroke="#a3a3a3"
          fontSize={12}
          tickLine={false}
          axisLine={false}
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
        <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
