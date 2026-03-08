'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { type TimeseriesPoint, bucketByHour, dataBounds, slimSlider, insideZoom, baseTooltip } from './types';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TokenChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    const buckets = bucketByHour(data);
    if (!buckets.length) return null;

    const bounds = dataBounds(buckets);
    const inputData: [number, number][] = buckets.map((b) => [b.ts, b.inputTokens]);
    const outputData: [number, number][] = buckets.map((b) => [b.ts, b.outputTokens]);

    return {
      backgroundColor: 'transparent',
      grid: { left: 40, right: 8, top: 8, bottom: 28 },
      xAxis: {
        type: 'time' as const,
        min: bounds.min,
        max: bounds.max,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 9, formatter: formatTokens },
      },
      tooltip: {
        ...baseTooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const date = new Date(params[0].value[0]);
          const label = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          for (const p of params) {
            if (p.value?.[1] > 0) {
              html += `<div style="display:flex;justify-content:space-between;gap:16px;font-size:11px">` +
                `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
                `<span style="font-family:monospace">${formatTokens(p.value[1])}</span></div>`;
            }
          }
          return html;
        },
      },
      dataZoom: [slimSlider('#3b82f6'), insideZoom],
      series: [
        {
          name: 'Input',
          type: 'bar' as const,
          stack: 'tokens',
          data: inputData,
          itemStyle: { color: '#3b82f6' },
          barMinWidth: 6,
          barMaxWidth: 28,
          emphasis: { itemStyle: { color: '#60a5fa' } },
        },
        {
          name: 'Output',
          type: 'bar' as const,
          stack: 'tokens',
          data: outputData,
          itemStyle: { color: '#06b6d4', borderRadius: [2, 2, 0, 0] },
          barMinWidth: 6,
          barMaxWidth: 28,
          emphasis: { itemStyle: { color: '#22d3ee' } },
        },
      ],
    };
  }, [data]);

  if (!data.length || !option) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        No token data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 200, width: '100%' }} />;
}
