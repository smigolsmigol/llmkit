import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';

export const dynamic = 'force-dynamic';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'LLMKit Dashboard',
  description: 'AI API gateway with cost tracking and budget enforcement. Python, TypeScript, and any language via CLI.',
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
