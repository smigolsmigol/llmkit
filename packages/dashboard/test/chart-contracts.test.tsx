import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ChartOption {
  tooltip?: { formatter?: (params: unknown) => string };
  series?: Array<{ lineStyle?: { color?: string } }>;
}

const captured = vi.hoisted(() => [] as ChartOption[]);

vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option }: { option: ChartOption }) => {
    captured.push(option);
    return <div data-chart="captured" />;
  },
}));
vi.mock('@/lib/echarts', () => ({ default: {} }));

import { CostChart } from '@/components/charts/cost-chart';
import { PackageDownloadsChart } from '@/components/charts/package-downloads';
import { ProviderChart } from '@/components/charts/provider-chart';
import { RequestChart } from '@/components/charts/request-chart';
import { Sparkline } from '@/components/charts/sparkline';
import { TokenChart } from '@/components/charts/token-chart';
import {
  asTooltipData,
  bucketByHour,
  dataBounds,
  dataZoomConfig,
} from '@/components/charts/types';
import {
  classifyRecoveryPath,
  createHttpsRedirectResponse,
  getHttpsRedirectUrl,
  getWorkerVersionHeaders,
} from '@/lib/public-recovery';

const points = [
  { t: '2026-08-13T10:05:00Z', costCents: 20, inputTokens: 1000, outputTokens: 200 },
  { t: '2026-08-13T10:30:00Z', costCents: null, inputTokens: 300, outputTokens: 100 },
  { t: '2026-08-13T11:00:00Z', costCents: 0, inputTokens: 0, outputTokens: 0 },
  { t: '2026-08-13T12:00:00Z', costCents: 40, inputTokens: 500, outputTokens: 500 },
];

function render(component: React.ReactNode): string {
  return renderToStaticMarkup(component);
}

function lastOption(): ChartOption {
  const option = captured.at(-1);
  if (!option) throw new Error('chart option was not captured');
  return option;
}

function lastFormatter(): (params: unknown) => string {
  const formatter = lastOption().tooltip?.formatter;
  if (!formatter) throw new Error('chart tooltip formatter was not captured');
  return formatter;
}

beforeEach(() => {
  captured.length = 0;
});

describe('chart data contracts', () => {
  it('normalizes tooltip values and hourly known/unknown cost buckets', () => {
    expect(asTooltipData(null)).toEqual([]);
    expect(asTooltipData([null, { value: ['bad', 1] }, { value: [1] }])).toEqual([]);
    expect(asTooltipData([{ value: [1, 2] }])).toEqual([{
      color: 'currentColor', dataIndex: -1, seriesName: '', value: [1, 2],
    }]);
    expect(asTooltipData([{
      color: '#fff', dataIndex: 3, seriesName: 'Input', value: [1, 2],
    }])).toEqual([{
      color: '#fff', dataIndex: 3, seriesName: 'Input', value: [1, 2],
    }]);

    expect(bucketByHour([])).toEqual([]);
    const buckets = bucketByHour(points);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({
      costCents: 20,
      inputTokens: 1300,
      outputTokens: 300,
      pricedRequests: 1,
      unknownCostRequests: 1,
      count: 2,
    });
    expect(dataBounds([])).toEqual({ min: 0, max: 0 });
    expect(dataBounds(buckets).min).toBeLessThan(buckets[0].ts);
    expect(dataZoomConfig('#fff', 2)).toEqual([]);
    expect(dataZoomConfig('#fff', 3)).toHaveLength(2);
  });

  it('renders cost, token, request, and provider options with safe tooltips', () => {
    expect(render(<CostChart data={[]} />)).toContain('No spend data yet');
    expect(render(<CostChart data={[points[1]]} />)).toContain('request cost unknown');
    render(<CostChart data={points} />);
    let formatter = lastFormatter();
    const firstBucket = Date.parse('2026-08-13T10:00:00Z');
    expect(formatter([])).toBe('');
    expect(formatter([
      { color: '#7c3aed', dataIndex: 0, seriesName: 'Input', value: [firstBucket, 0.15] },
      { color: '#a78bfa', dataIndex: 0, seriesName: 'Output', value: [firstBucket, 0.05] },
    ])).toContain('1 request cost unknown');

    expect(render(<TokenChart data={[]} />)).toContain('No token data yet');
    render(<TokenChart data={points} />);
    formatter = lastFormatter();
    expect(formatter([])).toBe('');
    expect(formatter([
      { color: '#3b82f6', dataIndex: 0, seriesName: 'Input', value: [Date.parse(points[0].t), 1_000_000] },
      { color: '#06b6d4', dataIndex: 0, seriesName: 'Output', value: [Date.parse(points[0].t), 1500] },
    ])).toContain('1.0M');

    expect(render(<RequestChart data={[]} />)).toContain('No request data yet');
    render(<RequestChart data={points} />);
    formatter = lastFormatter();
    expect(formatter([])).toBe('');
    expect(formatter([{
      color: '#14b8a6', dataIndex: 0, seriesName: 'Requests', value: [Date.parse(points[0].t), 2],
    }])).toContain('2 requests');

    expect(render(<ProviderChart data={[]} />)).toContain('No provider data yet');
    expect(render(<ProviderChart data={[{ provider: 'openai', cost: 0, count: 1 }]} />))
      .toContain('No provider data yet');
    render(<ProviderChart data={[
      { provider: 'openai', cost: 0.005, count: 1 },
      { provider: 'anthropic', cost: 2, count: 3 },
    ]} />);
    formatter = lastFormatter();
    expect(formatter([])).toBe('');
    expect(formatter([{
      color: '#7c3aed', dataIndex: 1, seriesName: '', value: [0, 2],
    }])).toContain('anthropic');
    expect(formatter([{
      color: '#7c3aed', dataIndex: 99, seriesName: '', value: [0, 2],
    }])).toBe('');
  });

  it('builds package-download and sparkline options across empty and populated inputs', () => {
    expect(render(<PackageDownloadsChart packages={[]} />)).toContain('No download data yet');
    expect(render(<PackageDownloadsChart packages={[{ name: 'llmkit-empty', daily: [] }]} />))
      .toContain('No download data yet');

    render(<PackageDownloadsChart
      packages={[
        { name: '@f3d1/llmkit-mcp-server', daily: [{ day: '2026-08-12', count: 20 }, { day: '2026-08-13', count: 30 }] },
        { name: 'llmkit-sdk', daily: [{ day: '2026-08-12', count: 0 }, { day: '2026-08-13', count: 5 }] },
      ]}
      pypiDaily={[{ day: '2026-08-13', count: 7 }]}
      pypiName="llmkit-sdk (PyPI)"
    />);
    const formatter = lastFormatter();
    expect(formatter(null)).toBe('');
    expect(formatter([
      { axisValue: 'Aug 13', value: 30, color: '#7c3aed', seriesName: 'mcp-server' },
      { axisValue: 'Aug 13', value: 0, color: '#3b82f6', seriesName: 'sdk' },
      { axisValue: 'Aug 13', value: 7, color: '#f59e0b', seriesName: 'llmkit-sdk (PyPI)' },
    ])).toContain('37 total');

    expect(render(<Sparkline data={[]} />)).toContain('margin-top:16px');
    expect(render(<Sparkline data={[0, 0]} height={40} />)).toContain('margin-top:20px');
    render(<Sparkline data={[1, 2, 3]} color="#00ff00" />);
    expect(lastOption().series?.[0]?.lineStyle?.color).toBe('#00ff00');
  });
});

describe('public recovery helpers', () => {
  it('classifies only exact or descendant recovery routes', () => {
    expect(classifyRecoveryPath('/dashboard')).toBe('blocked-ui');
    expect(classifyRecoveryPath('/dashboard/requests')).toBe('blocked-ui');
    expect(classifyRecoveryPath('/dashboardish')).toBe('public');
    expect(classifyRecoveryPath('/api/export')).toBe('blocked-api');
    expect(classifyRecoveryPath('/api/export/file')).toBe('blocked-api');
    expect(classifyRecoveryPath('/api/exported')).toBe('public');
  });

  it('builds HTTPS redirects and optional worker version receipts', () => {
    expect(getWorkerVersionHeaders(null)).toEqual({});
    expect(getWorkerVersionHeaders({})).toEqual({});
    expect(getWorkerVersionHeaders({ CF_VERSION_METADATA: {} })).toEqual({});
    expect(getWorkerVersionHeaders({ CF_VERSION_METADATA: { id: 'worker-123' } }))
      .toEqual({ 'X-LLMKit-Worker-Version': 'worker-123' });

    expect(getHttpsRedirectUrl(new URL('https://llmkit.sh/docs'))).toBeNull();
    expect(getHttpsRedirectUrl(new URL('http://example.com/docs'))).toBeNull();
    expect(getHttpsRedirectUrl(new URL('http://llmkit.sh/docs?q=1')))
      .toBe('https://llmkit.sh/docs?q=1');
    expect(createHttpsRedirectResponse(new URL('https://llmkit.sh/docs'))).toBeNull();
    const response = createHttpsRedirectResponse(new URL('http://www.llmkit.sh/docs?q=1'));
    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe('https://www.llmkit.sh/docs?q=1');
  });
});
