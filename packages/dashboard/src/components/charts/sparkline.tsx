'use client';

import ReactEChartsCore from 'echarts-for-react/lib/core';
import { useMemo } from 'react';
import echarts from '@/lib/echarts';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = '#7c3aed', height = 32 }: SparklineProps) {
  const option = useMemo(() => {
    if (!data.length || data.every((v) => v === 0)) return null;
    return {
      backgroundColor: 'transparent',
      grid: { left: 0, right: 0, top: 2, bottom: 0 },
      xAxis: { type: 'category' as const, show: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value' as const, show: false, min: 0 },
      series: [
        {
          type: 'line' as const,
          data,
          smooth: 0.3,
          symbol: 'none',
          lineStyle: { color, width: 1.5 },
          areaStyle: { color: { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}30` }, { offset: 1, color: 'transparent' }] } },
        },
      ],
    };
  }, [data, color]);

  if (!option) return null;
  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height, width: '100%' }} opts={{ renderer: 'canvas' }} />;
}
