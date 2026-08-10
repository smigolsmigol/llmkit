export interface TimeseriesPoint {
  t: string;
  costCents: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface HourBucket {
  ts: number;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  pricedInputTokens: number;
  pricedOutputTokens: number;
  pricedRequests: number;
  unknownCostRequests: number;
  count: number;
}

export interface TooltipDatum {
  color: string;
  dataIndex: number;
  seriesName: string;
  value: [number, number];
}

export function asTooltipData(params: unknown): TooltipDatum[] {
  if (!Array.isArray(params)) return [];

  return params.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const value = item.value;
    if (
      !Array.isArray(value) ||
      typeof value[0] !== 'number' ||
      typeof value[1] !== 'number'
    ) {
      return [];
    }

    return [{
      color: typeof item.color === 'string' ? item.color : 'currentColor',
      dataIndex: typeof item.dataIndex === 'number' ? item.dataIndex : -1,
      seriesName: typeof item.seriesName === 'string' ? item.seriesName : '',
      value: [value[0], value[1]],
    }];
  });
}

const HOUR_MS = 3600_000;

export function bucketByHour(data: TimeseriesPoint[]): HourBucket[] {
  if (!data.length) return [];

  const map = new Map<number, HourBucket>();
  for (const d of data) {
    const raw = new Date(d.t).getTime();
    const hour = Math.floor(raw / HOUR_MS) * HOUR_MS;
    const b = map.get(hour) || {
      ts: hour,
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
      pricedInputTokens: 0,
      pricedOutputTokens: 0,
      pricedRequests: 0,
      unknownCostRequests: 0,
      count: 0,
    };
    if (d.costCents === null) {
      b.unknownCostRequests++;
    } else {
      b.costCents += d.costCents;
      b.pricedInputTokens += d.inputTokens;
      b.pricedOutputTokens += d.outputTokens;
      b.pricedRequests++;
    }
    b.inputTokens += d.inputTokens;
    b.outputTokens += d.outputTokens;
    b.count++;
    map.set(hour, b);
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

export function dataBounds(buckets: HourBucket[]): { min: number; max: number } {
  if (!buckets.length) return { min: 0, max: 0 };
  const pad = HOUR_MS * 2;
  return {
    min: buckets[0].ts - pad,
    max: buckets[buckets.length - 1].ts + pad,
  };
}

export function dataZoomConfig(accentColor: string, bucketCount: number) {
  if (bucketCount < 3) return [];
  return [
    {
      type: 'slider' as const,
      xAxisIndex: 0,
      height: 12,
      bottom: 2,
      borderColor: 'transparent',
      backgroundColor: 'rgba(255,255,255,0.03)',
      fillerColor: `${accentColor}22`,
      handleSize: '60%',
      handleStyle: { color: accentColor, borderColor: accentColor, borderWidth: 1 },
      textStyle: { color: '#555', fontSize: 9 },
      dataBackground: { lineStyle: { color: '#222' }, areaStyle: { color: 'transparent' } },
      selectedDataBackground: { lineStyle: { color: '#333' }, areaStyle: { color: 'transparent' } },
    },
    {
      type: 'inside' as const,
      xAxisIndex: 0,
      zoomOnMouseWheel: true,
      moveOnMouseMove: false,
    },
  ];
}

export const baseTooltip = {
  trigger: 'axis' as const,
  axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(255,255,255,0.03)' } },
  backgroundColor: 'rgba(12,12,16,0.96)',
  borderColor: '#2a2a2a',
  borderWidth: 1,
  textStyle: { color: '#ccc', fontSize: 11 },
};
