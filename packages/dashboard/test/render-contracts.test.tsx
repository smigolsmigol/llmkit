import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import pricingSource from '../../shared/pricing.json';
import ComparePage, { generateMetadata as generateCompareMetadata } from '../src/app/(public)/compare/page';
import DocsPage from '../src/app/(public)/docs/page';
import McpPage from '../src/app/(public)/mcp/page';
import Home from '../src/app/(public)/page';
import PricingPage, { generateMetadata as generatePricingMetadata } from '../src/app/(public)/pricing/page';
import ProviderPage, {
  generateMetadata as generateProviderMetadata,
  generateStaticParams,
} from '../src/app/(public)/providers/[name]/page';
import ServiceRestoringPage from '../src/app/(public)/service-restoring/page';
import NotFound from '../src/app/not-found';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function render(component: React.ReactNode): string {
  return renderToStaticMarkup(component);
}

const pricingModelCount = Object.values(pricingSource.providers)
  .flatMap((models) => Object.keys(models)).length;

describe('public dashboard render contracts', () => {
  it('renders the public product, docs, MCP, pricing, calculator, and recovery surfaces', () => {
    const surfaces = [
      [render(<Home />), 'Cost control for agents that actually run.'],
      [render(<DocsPage />), 'Measure one run'],
      [render(<McpPage />), 'Eleven cost tools'],
      [render(<PricingPage />), 'Provider pricing without the tab graveyard.'],
      [render(<ComparePage />), 'Turn verified token volume'],
      [render(<ServiceRestoringPage />), 'Auth stays closed until it is proved.'],
    ];

    for (const [html, marker] of surfaces) {
      expect(html).toContain(marker);
      expect(html).toContain('LLMKit');
    }
    expect(render(<NotFound />)).toContain('Page not found');
  });

  it('derives pricing metadata, provider routes, robots, and sitemap from canonical data', async () => {
    expect(generatePricingMetadata().description).toContain(`${pricingModelCount} model entries`);
    expect(generateCompareMetadata().description).toContain(`${pricingModelCount} snapshot entries`);
    expect(generateStaticParams()).toHaveLength(9);

    const providerMetadata = await generateProviderMetadata({
      params: Promise.resolve({ name: 'openai' }),
    });
    expect(providerMetadata.title).toContain('OpenAI API pricing reference');

    const providerHtml = render(await ProviderPage({
      params: Promise.resolve({ name: 'anthropic' }),
    }));
    expect(providerHtml).toContain('Anthropic API pricing');

    await expect(generateProviderMetadata({
      params: Promise.resolve({ name: 'missing' }),
    })).resolves.toEqual({});
    await expect(ProviderPage({
      params: Promise.resolve({ name: 'missing' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(robots()).toMatchObject({
      sitemap: 'https://llmkit.sh/sitemap.xml',
    });
    expect(sitemap().map((entry) => entry.url)).toContain('https://llmkit.sh/docs');
  });
});
