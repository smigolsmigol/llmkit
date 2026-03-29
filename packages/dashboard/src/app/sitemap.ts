import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://llmkit-dashboard.vercel.app';
  return [
    { url: base, lastModified: new Date(), priority: 1.0 },
    { url: `${base}/mcp`, lastModified: new Date(), priority: 0.8 },
    { url: `${base}/docs`, lastModified: new Date(), priority: 0.8 },
    { url: `${base}/pricing`, lastModified: new Date(), priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/compare`, lastModified: new Date(), priority: 0.9, changeFrequency: 'weekly' },
  ];
}
