import type { Metadata } from 'next';
import { JetBrains_Mono, Orbitron, Space_Grotesk } from 'next/font/google';
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
  title: 'LLMKit - Cost control for AI systems',
  description: 'Open-source cost attribution, request evidence, and pre-dispatch budget enforcement across local tools, SDKs, MCP, and gateway workflows.',
  keywords: ['AI cost tracking', 'LLM budget', 'API gateway', 'Claude Code cost', 'AI agent cost', 'OpenAI budget', 'MCP server', 'cost tracking', 'budget enforcement'],
  openGraph: {
    title: 'LLMKit - Cost control for AI systems',
    description: 'Give every AI request an identity, a budget decision, and an inspectable receipt.',
    url: 'https://llmkit.sh',
    siteName: 'LLMKit',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLMKit - Cost control for AI systems',
    description: 'Open-source cost attribution, request evidence, and pre-dispatch budget enforcement.',
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
      </body>
    </html>
  );
}
