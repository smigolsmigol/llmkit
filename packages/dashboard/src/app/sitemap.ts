import type { MetadataRoute } from 'next';
import { getPublicPricingProviders, PRICING_SNAPSHOT_DATE } from '@/lib/public-pricing';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://llmkit.sh';
  const providers = getPublicPricingProviders();
  return [
    { url: base, priority: 1.0 },
    { url: `${base}/mcp`, priority: 0.8 },
    { url: `${base}/docs`, priority: 0.8 },
    { url: `${base}/pricing`, lastModified: PRICING_SNAPSHOT_DATE, priority: 0.9 },
    { url: `${base}/compare`, lastModified: PRICING_SNAPSHOT_DATE, priority: 0.9 },
    ...providers.map((name) => ({
      url: `${base}/providers/${name}`,
      lastModified: PRICING_SNAPSHOT_DATE,
      priority: 0.8 as const,
    })),
  ];
}
