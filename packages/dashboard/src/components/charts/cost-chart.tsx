'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { TimeseriesPoint } from './types';

function formatCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 0.1) return `$${v.toFixed(3)}`;
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}

export function CostChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    if (!data.length) return null;

    const inputData: [number, number][] = [];
    const outputData: [number, number][] = [];

    for (const d of data) {
      const ts = new Date(d.t).getTime();
      const totalTokens = d.inputTokens + d.outputTokens;
      const cost = d.costCents / 100;
      if (totalTokens === 0) {
        inputData.push([ts, cost]);
        outputData.push([ts, 0]);
      } else {
        const ratio = d.inputTokens / totalTokens;
        inputData.push([ts, cost * ratio]);
        outputData.push([ts, cost * (1 - ratio)]);
      }
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 48, right: 12, top: 8, bottom: 44 },
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
        axisLabel: { color: '#555', fontSize: 10, formatter: formatCost },
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
          const total = params.reduce((s: number, p: { value?: [number, number] }) =>
            s + (p.value?.[1] || 0), 0);
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          for (const p of params) {
            if (p.value?.[1] > 0) {
              html += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">` +
                `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
                `<span style="font-family:monospace">${formatCost(p.value[1])}</span></div>`;
            }
          }
          if (params.length > 1 && total > 0) {
            html += `<div style="border-top:1px solid #333;margin-top:3px;padding-top:3px;display:flex;justify-content:space-between;font-size:11px">` +
              `<span style="font-weight:600">Total</span>` +
              `<span style="font-family:monospace;font-weight:600">${formatCost(total)}</span></div>`;
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
          fillerColor: 'rgba(124, 58, 237, 0.15)',
          handleStyle: { color: '#7c3aed', borderColor: '#7c3aed' },
          textStyle: { color: '#666', fontSize: 9 },
          dataBackground: { lineStyle: { color: '#333' }, areaStyle: { color: '#1a1a2e' } },
        },
        { type: 'inside' as const, xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: false },
      ],
      series: [
        {
          name: 'Input',
          type: 'bar' as const,
          stack: 'cost',
          data: inputData,
          itemStyle: { color: '#7c3aed' },
          barMaxWidth: 20,
          emphasis: { itemStyle: { color: '#8b5cf6' } },
        },
        {
          name: 'Output',
          type: 'bar' as const,
          stack: 'cost',
          data: outputData,
          itemStyle: { color: '#a78bfa', borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 20,
          emphasis: { itemStyle: { color: '#c4b5fd' } },
        },
      ],
    };
  }, [data]);

  if (!data.length || !option) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        No spend data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 200, width: '100%' }} />;
}
