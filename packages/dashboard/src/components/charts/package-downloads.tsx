'use client';

import ReactEChartsCore from 'echarts-for-react/lib/core';
import { useMemo } from 'react';
import echarts from '@/lib/echarts';
import { baseTooltip } from './types';

interface PackageDailyData {
  name: string;
  daily: Array<{ day: string; count: number }>;
}

const COLORS = [
  '#7c3aed', // violet (mcp-server, usually highest)
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber (PyPI)
  '#ef4444', // red
  '#8b5cf6', // purple
];

function shortName(name: string): string {
  return name.replace('@f3d1/llmkit-', '').replace('llmkit-', '');
}

interface PackageDownloadsChartProps {
  packages: PackageDailyData[];
  pypiDaily?: Array<{ day: string; count: number }>;
  pypiName?: string;
}

export function PackageDownloadsChart({ packages, pypiDaily, pypiName }: PackageDownloadsChartProps) {
  const option = useMemo(() => {
    if (!packages.length) return null;

    // collect all days across packages
    const daySet = new Set<string>();
    for (const pkg of packages) for (const d of pkg.daily) daySet.add(d.day);
    if (pypiDaily) for (const d of pypiDaily) daySet.add(d.day);
    const days = Array.from(daySet).sort();

    if (!days.length) return null;

    const labels = days.map((d) => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    // build lookup maps per package
    const pkgMaps = packages.map((pkg) => {
      const map = new Map(pkg.daily.map((d) => [d.day, d.count]));
      return { name: shortName(pkg.name), map };
    });

    // sort by total downloads descending so biggest package is at the bottom of the stack
    pkgMaps.sort((a, b) => {
      const totalA = days.reduce((s, d) => s + (a.map.get(d) ?? 0), 0);
      const totalB = days.reduce((s, d) => s + (b.map.get(d) ?? 0), 0);
      return totalB - totalA;
    });

    const series = pkgMaps.map((pkg, i) => ({
      name: pkg.name,
      type: 'bar' as const,
      stack: 'downloads',
      data: days.map((d) => pkg.map.get(d) ?? 0),
      itemStyle: { color: COLORS[i % COLORS.length], borderRadius: i === pkgMaps.length - 1 ? [2, 2, 0, 0] : 0 },
      emphasis: { itemStyle: { shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.3)' } },
    }));

    if (pypiDaily?.length) {
      const pypiMap = new Map(pypiDaily.map((d) => [d.day, d.count]));
      series.push({
        name: pypiName ?? 'PyPI',
        type: 'bar' as const,
        stack: 'downloads',
        data: days.map((d) => pypiMap.get(d) ?? 0),
        itemStyle: { color: '#f59e0b', borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.3)' } },
      });
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 32, right: 8, top: 8, bottom: 24 },
      xAxis: {
        type: 'category' as const,
        data: labels,
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
        // biome-ignore lint/suspicious/noExplicitAny: echarts callback typing
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const label = params[0].axisValue;
          let html = `<div style="font-size:10px;color:#888;margin-bottom:3px">${label}</div>`;
          let total = 0;
          for (const p of params) {
            const val = p.value ?? 0;
            if (val === 0) continue;
            total += val;
            html += `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">` +
              `<span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}</span>` +
              `<span style="font-family:monospace">${val}</span></div>`;
          }
          html += `<div style="border-top:1px solid #2a2a2a;margin-top:3px;padding-top:3px;font-size:11px;font-weight:600">${total} total</div>`;
          return html;
        },
      },
      series,
    };
  }, [packages, pypiDaily, pypiName]);

  if (!option) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        No download data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 180, width: '100%' }} />;
}
