'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import { type TimeseriesPoint, bucketByHour, dataBounds, dataZoomConfig, baseTooltip } from './types';

export function RequestChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    const buckets = bucketByHour(data);
    if (!buckets.length) return null;

    const bounds = dataBounds(buckets);
    const zoom = dataZoomConfig('#14b8a6', buckets.length);
    const hasZoom = zoom.length > 0;
    const seriesData: [number, number][] = buckets.map((b) => [b.ts, b.count]);

    return {
      backgroundColor: 'transparent',
      grid: { left: 28, right: 8, top: 6, bottom: hasZoom ? 38 : 4 },
      xAxis: {
        type: 'time' as const,
        min: bounds.min, max: bounds.max,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#555', fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const, min: 0, minInterval: 1,
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: '#1a1a1a', type: 'dashed' as const } },
        axisLabel: { color: '#555', fontSize: 9 },
      },
      tooltip: {
        ...baseTooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const date = new Date(params[0].value[0]);
          const label = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
          const count = params[0].value[1];
          return `<div style="font-size:10px;color:#888;margin-bottom:2px">${label}</div>` +
            `<div style="font-size:11px;font-family:monospace;font-weight:600;color:#14b8a6">${count} request${count !== 1 ? 's' : ''}</div>`;
        },
      },
      ...(hasZoom ? { dataZoom: zoom } : {}),
      series: [
        {
          name: 'Requests', type: 'bar' as const,
          data: seriesData, itemStyle: { color: '#14b8a6' },
          barMinWidth: 6, barMaxWidth: 28,
          emphasis: { itemStyle: { color: '#2dd4bf' } },
        },
      ],
    };
  }, [data]);

  if (!option) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        No request data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 160, width: '100%' }} />;
}
