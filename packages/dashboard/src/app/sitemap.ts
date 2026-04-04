import type { MetadataRoute } from 'next';

const PROVIDERS = [
  'openai', 'anthropic', 'gemini', 'xai', 'groq', 'together',
  'fireworks', 'deepseek', 'mistral', 'ollama', 'openrouter',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://llmkit.sh';
  return [
    { url: base, lastModified: new Date(), priority: 1.0 },
    { url: `${base}/mcp`, lastModified: new Date(), priority: 0.8 },
    { url: `${base}/docs`, lastModified: new Date(), priority: 0.8 },
    { url: `${base}/pricing`, lastModified: new Date(), priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/compare`, lastModified: new Date(), priority: 0.9, changeFrequency: 'weekly' },
    ...PROVIDERS.map((name) => ({
      url: `${base}/providers/${name}`,
      lastModified: new Date(),
      priority: 0.8 as const,
      changeFrequency: 'weekly' as const,
    })),
  ];
}
