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
  inputTokens: number;
  outputTokens: number;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-muted-foreground">{formatDateShort(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-mono" style={{ color: p.color }}>
          {p.name === 'inputTokens' ? 'Input' : 'Output'}: {formatTokens(p.value)}
        </p>
      ))}
    </div>
  );
}

export function TokenChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No token data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="inputGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="outputGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
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
          tickFormatter={formatTokens}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#333', strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="inputTokens"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#inputGradient)"
          stackId="tokens"
        />
        <Area
          type="monotone"
          dataKey="outputTokens"
          stroke="#06b6d4"
          strokeWidth={2}
          fill="url(#outputGradient)"
          stackId="tokens"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
