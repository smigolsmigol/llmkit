'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { TimeseriesPoint } from './types';

export function RequestChart({ data }: { data: TimeseriesPoint[] }) {
  const option = useMemo(() => {
    if (!data.length) return null;

    const seriesData: [number, number][] = data.map((d) => [
      new Date(d.t).getTime(),
      1,
    ]);

    return {
      backgroundColor: 'transparent',
      grid: { left: 36, right: 12, top: 8, bottom: 44 },
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
        axisLabel: { color: '#555', fontSize: 10 },
        minInterval: 1,
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
          return `<div style="font-size:10px;color:#888;margin-bottom:2px">${label}</div>` +
            `<div style="font-size:11px;font-family:monospace;font-weight:600;color:#14b8a6">1 request</div>`;
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
          fillerColor: 'rgba(20, 184, 166, 0.15)',
          handleStyle: { color: '#14b8a6', borderColor: '#14b8a6' },
          textStyle: { color: '#666', fontSize: 9 },
          dataBackground: { lineStyle: { color: '#333' }, areaStyle: { color: '#1a1a2e' } },
        },
        { type: 'inside' as const, xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: false },
      ],
      series: [
        {
          name: 'Requests',
          type: 'bar' as const,
          data: seriesData,
          itemStyle: { color: '#14b8a6' },
          barMaxWidth: 20,
          emphasis: { itemStyle: { color: '#2dd4bf' } },
        },
      ],
    };
  }, [data]);

  if (!data.length || !option) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        No request data yet
      </div>
    );
  }

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 200, width: '100%' }} />;
}
