'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { TimeseriesPoint } from './types';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TokenChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    if (!data.length) return null;

    const inputData: [number, number][] = data.map((d) => [
      new Date(d.t).getTime(),
      d.inputTokens,
    ]);
    const outputData: [number, number][] = data.map((d) => [
      new Date(d.t).getTime(),
      d.outputTokens,
    ]);

    return {
      backgroundColor: 'transparent',
      grid: { left: 44, right: 12, top: 8, bottom: 44 },
      xAxis: {
        type: 'time' as const,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 10, formatter: formatTokens },
      },
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        backgroundColor: 'rgba(15,15,20,0.95)',
        borderColor: '#333',
        textStyle: { color: '#e0e0e0', fontSize: 11 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const date = new Date(params[0].value[0]);
          const label = date.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          for (const p of params) {
            if (p.value?.[1] > 0) {
              html += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">` +
                `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
                `<span style="font-family:monospace">${formatTokens(p.value[1])}</span></div>`;
            }
          }
          return html;
        },
      },
      dataZoom: [
        {
          type: 'slider' as const,
          xAxisIndex: 0,
          height: 18,
          bottom: 2,
          borderColor: 'transparent',
          backgroundColor: '#111',
          fillerColor: 'rgba(59, 130, 246, 0.15)',
          handleStyle: { color: '#3b82f6', borderColor: '#3b82f6' },
          textStyle: { color: '#666', fontSize: 9 },
          dataBackground: { lineStyle: { color: '#333' }, areaStyle: { color: '#1a1a2e' } },
        },
        { type: 'inside' as const, xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: false },
      ],
      series: [
        {
          name: 'Input',
          type: 'bar' as const,
          stack: 'tokens',
          data: inputData,
          itemStyle: { color: '#3b82f6' },
          barMaxWidth: 20,
          emphasis: { itemStyle: { color: '#60a5fa' } },
        },
        {
          name: 'Output',
          type: 'bar' as const,
          stack: 'tokens',
          data: outputData,
          itemStyle: { color: '#06b6d4', borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 20,
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
