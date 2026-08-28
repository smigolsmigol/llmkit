import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __GATE0_REPEAT_START__: JSON.stringify(Number(process.env.GATE0_REPEAT_START ?? 0)),
    __GATE0_REPEAT_COUNT__: JSON.stringify(Number(process.env.GATE0_REPEAT_COUNT ?? 20)),
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.budget-falsifier.toml' },
    }),
  ],
  test: {
    include: ['test/budget-falsifier/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary', 'lcovonly'],
      reportsDirectory: './coverage/budget-falsifier',
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
