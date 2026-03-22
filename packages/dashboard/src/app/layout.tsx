import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'LLMKit - Know exactly what your AI agents cost',
  description: 'Open-source API gateway with cost tracking and budget enforcement. Per-request logging, per-key budgets across 11 AI providers. Free during beta.',
  keywords: ['AI cost tracking', 'LLM budget', 'API gateway', 'Claude Code cost', 'AI agent cost', 'OpenAI budget', 'MCP server', 'cost tracking', 'budget enforcement'],
  openGraph: {
    title: 'LLMKit - Know exactly what your AI agents cost',
    description: 'Open-source API gateway with cost tracking and budget enforcement. 11 providers, 45+ models, budget limits that actually reject requests.',
    url: 'https://llmkit-dashboard.vercel.app',
    siteName: 'LLMKit',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLMKit - AI cost tracking and budget enforcement',
    description: 'Open-source API gateway that tracks what your AI agents cost and stops them from overspending.',
  },
  metadataBase: new URL('https://llmkit-dashboard.vercel.app'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body
          className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} min-h-screen bg-background text-foreground antialiased`}
        >
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
