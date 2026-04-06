import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Space_Grotesk, JetBrains_Mono, Orbitron } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-logo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LLMKit - Track what your AI agents spend',
  description: 'Open-source API gateway with cost tracking and budget enforcement. Per-request logging, per-key budgets across 11 AI providers. Free during beta.',
  keywords: ['AI cost tracking', 'LLM budget', 'API gateway', 'Claude Code cost', 'AI agent cost', 'OpenAI budget', 'MCP server', 'cost tracking', 'budget enforcement'],
  openGraph: {
    title: 'LLMKit - Track what your AI agents spend',
    description: 'Open-source API gateway with cost tracking and budget enforcement. 11 providers, 730+ models, budget limits that actually reject requests.',
    url: 'https://llmkit.sh',
    siteName: 'LLMKit',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'LLMKit - Track what your AI agents spend',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLMKit - AI cost tracking and budget enforcement',
    description: 'Open-source API gateway that tracks what your AI agents cost and stops them from overspending.',
    images: ['/opengraph-image'],
  },
  metadataBase: new URL('https://llmkit.sh'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${orbitron.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
