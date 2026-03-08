'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { baseTooltip } from './types';

const COLORS = ['#7c3aed', '#14b8a6', '#3b82f6', '#a855f7', '#06b6d4'];

interface DataPoint {
  provider: string;
  cost: number;
  count: number;
}

function formatCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

export function ProviderChart({ data }: { data: DataPoint[] }) {
  const option = useMemo(() => {
    if (!data.length) return null;

    const hasCost = data.some((d) => d.cost > 0);
    if (!hasCost) return null;

    return {
      backgroundColor: 'transparent',
      grid: { left: 44, right: 8, top: 6, bottom: 16 },
      xAxis: {
        type: 'category' as const,
        data: data.map((d) => d.provider),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 9 },
      },
      yAxis: {
        type: 'value' as const,
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 9, formatter: formatCost },
      },
      tooltip: {
        ...baseTooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const idx = params[0].dataIndex;
          const d = data[idx];
          return `<div style="font-size:11px;font-weight:500;margin-bottom:2px">${d.provider}</div>` +
            `<div style="font-family:monospace;color:#7c3aed">${formatCost(d.cost)}</div>` +
            `<div style="font-size:10px;color:#888">${d.count} requests</div>`;
        },
      },
      series: [
        {
          type: 'bar' as const,
          data: data.map((d, i) => ({
            value: d.cost,
            itemStyle: { color: COLORS[i % COLORS.length] },
          })),
          barMaxWidth: 32,
          itemStyle: { borderRadius: [2, 2, 0, 0] },
        },
      ],
    };
  }, [data]);

  if (!data.length || !option) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
        No provider data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 160, width: '100%' }} />;
}
