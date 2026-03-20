'use client';

import ReactEChartsCore from 'echarts-for-react/lib/core';
import { useMemo } from 'react';
import echarts from '@/lib/echarts';
import { baseTooltip } from './types';

interface DailyPoint {
  day: string;
  count: number;
}

interface DownloadTrendProps {
  npmDaily: DailyPoint[];
  pypiDaily?: DailyPoint[];
}

export function DownloadTrendChart({ npmDaily, pypiDaily }: DownloadTrendProps) {
  const option = useMemo(() => {
    if (!npmDaily.length) return null;

    const days = npmDaily.map((d) => {
      const dt = new Date(d.day);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const series: Array<{
      name: string;
      type: 'line';
      data: number[];
      smooth: number;
      symbol: string;
      symbolSize: number;
      lineStyle: { color: string; width: number };
      itemStyle: { color: string };
      areaStyle: { color: { type: 'linear'; x: number; y: number; x2: number; y2: number; colorStops: Array<{ offset: number; color: string }> } };
    }> = [
      {
        name: 'npm',
        type: 'line' as const,
        data: npmDaily.map((d) => d.count),
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: '#7c3aed', width: 2 },
        itemStyle: { color: '#7c3aed' },
        areaStyle: {
          color: {
            type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.15)' }, { offset: 1, color: 'transparent' }],
          },
        },
      },
    ];

    if (pypiDaily?.length) {
      series.push({
        name: 'PyPI',
        type: 'line' as const,
        data: pypiDaily.map((d) => d.count),
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b' },
        areaStyle: {
          color: {
            type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(245,158,11,0.1)' }, { offset: 1, color: 'transparent' }],
          },
        },
      });
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 32, right: 8, top: 8, bottom: 24 },
      xAxis: {
        type: 'category' as const,
        data: days,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 9, interval: 1 },
      },
      yAxis: {
        type: 'value' as const,
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 9 },
      },
      tooltip: {
        ...baseTooltip,
        // biome-ignore lint/suspicious/noExplicitAny: echarts callback
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const label = params[0].axisValue;
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          let total = 0;
          for (const p of params) {
            const val = p.value ?? 0;
            total += val;
            html += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">` +
              `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
              `<span style="font-family:monospace">${val}</span></div>`;
          }
          if (params.length > 1) {
            html += `<div style="border-top:1px solid #2a2a2a;margin-top:3px;padding-top:3px;font-size:11px;font-weight:600">${total} total</div>`;
          }
          return html;
        },
      },
      series,
    };
  }, [npmDaily, pypiDaily]);

  if (!option) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        No download data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 160, width: '100%' }} />;
}
