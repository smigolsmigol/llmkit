'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { type TimeseriesPoint, bucketByHour, dataBounds, dataZoomConfig, baseTooltip } from './types';

function formatCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 0.1) return `$${v.toFixed(3)}`;
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

export function CostChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    const buckets = bucketByHour(data);
    if (!buckets.length) return null;
    if (!buckets.some((b) => b.costCents > 0)) return null;

    const bounds = dataBounds(buckets);
    const zoom = dataZoomConfig('#7c3aed', buckets.length);
    const hasZoom = zoom.length > 0;
    const inputData: [number, number][] = [];
    const outputData: [number, number][] = [];

    for (const b of buckets) {
      const totalTokens = b.inputTokens + b.outputTokens;
      const cost = b.costCents / 100;
      if (totalTokens === 0) {
        inputData.push([b.ts, cost]);
        outputData.push([b.ts, 0]);
      } else {
        const ratio = b.inputTokens / totalTokens;
        inputData.push([b.ts, cost * ratio]);
        outputData.push([b.ts, cost * (1 - ratio)]);
      }
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 44, right: 8, top: 6, bottom: hasZoom ? 24 : 4 },
      xAxis: {
        type: 'time' as const,
        min: bounds.min, max: bounds.max,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const, min: 0,
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 9, formatter: formatCost },
      },
      tooltip: {
        ...baseTooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const date = new Date(params[0].value[0]);
          const label = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
          const total = params.reduce((s: number, p: { value?: [number, number] }) => s + (p.value?.[1] || 0), 0);
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          for (const p of params) {
            if (p.value?.[1] > 0) {
              html += `<div style="display:flex;justify-content:space-between;gap:16px;font-size:11px">` +
                `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
                `<span style="font-family:monospace">${formatCost(p.value[1])}</span></div>`;
            }
          }
          if (total > 0) {
            html += `<div style="border-top:1px solid #2a2a2a;margin-top:3px;padding-top:3px;display:flex;justify-content:space-between;font-size:11px">` +
              `<span style="font-weight:600">Total</span><span style="font-family:monospace;font-weight:600">${formatCost(total)}</span></div>`;
          }
          return html;
        },
      },
      ...(hasZoom ? { dataZoom: zoom } : {}),
      series: [
        {
          name: 'Input', type: 'bar' as const, stack: 'cost',
          data: inputData, itemStyle: { color: '#7c3aed' },
          barMinWidth: 6, barMaxWidth: 28,
          emphasis: { itemStyle: { color: '#8b5cf6' } },
        },
        {
          name: 'Output', type: 'bar' as const, stack: 'cost',
          data: outputData, itemStyle: { color: '#a78bfa', borderRadius: [2, 2, 0, 0] },
          barMinWidth: 6, barMaxWidth: 28,
          emphasis: { itemStyle: { color: '#c4b5fd' } },
        },
      ],
    };
  }, [data]);

  if (!option) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        No spend data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 160, width: '100%' }} />;
}
