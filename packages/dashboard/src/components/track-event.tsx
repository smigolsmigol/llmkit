'use client';

import { track } from '@vercel/analytics';
import { useEffect } from 'react';

export function TrackPageView({ page }: { page: string }) {
  useEffect(() => {
    track('page_view', { page });
  }, [page]);
  return null;
}

export function TrackClick({
  event,
  properties,
  children,
  className,
  href,
  target,
  rel,
}: {
  event: string;
  properties?: Record<string, string>;
  children: React.ReactNode;
  className?: string;
  href: string;
  target?: string;
  rel?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={className}
      onClick={() => track(event, properties)}
    >
      {children}
    </a>
  );
}
