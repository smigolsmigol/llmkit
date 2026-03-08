'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DataPoint {
  date: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

interface ProcessedPoint {
  date: string;
  inputCost: number;
  outputCost: number;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 0.1) return `$${v.toFixed(3)}`;
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-md">
      <p className="text-muted-foreground">{formatDateShort(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-mono" style={{ color: p.color }}>
          {p.name === 'inputCost' ? 'Input' : 'Output'}: {formatCost(p.value)}
        </p>
      ))}
      <p className="mt-0.5 border-t border-border pt-0.5 font-mono font-semibold text-primary">
        Total: {formatCost(total)}
      </p>
    </div>
  );
}

export function CostChart({ data }: { data: DataPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">
        No spend data yet
      </div>
    );
  }

  const processed: ProcessedPoint[] = data.map((d) => {
    const totalTokens = d.inputTokens + d.outputTokens;
    if (totalTokens === 0) return { date: d.date, inputCost: d.cost, outputCost: 0 };
    const ratio = d.inputTokens / totalTokens;
    return {
      date: d.date,
      inputCost: d.cost * ratio,
      outputCost: d.cost * (1 - ratio),
    };
  });

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={processed} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="#555"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDateShort}
        />
        <YAxis
          stroke="#555"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCost}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="inputCost" stackId="cost" fill="#7c3aed" radius={[0, 0, 0, 0]} />
        <Bar dataKey="outputCost" stackId="cost" fill="#a78bfa" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
