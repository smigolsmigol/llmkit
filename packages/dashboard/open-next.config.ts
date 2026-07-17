import { defineCloudflareConfig, type OpenNextConfig } from '@opennextjs/cloudflare';

export default {
  ...defineCloudflareConfig(),
  buildCommand: 'corepack pnpm@9.15.4 build',
} satisfies OpenNextConfig;
