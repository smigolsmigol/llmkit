'use client';

import Link from 'next/link';
import { track } from '@vercel/analytics';
import type { ComponentProps } from 'react';

interface TrackedLinkProps extends ComponentProps<typeof Link> {
  event: string;
  properties?: Record<string, string>;
}

export function TrackedLink({ event, properties, onClick, ...props }: TrackedLinkProps) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track(event, properties);
        onClick?.(e);
      }}
    />
  );
}
