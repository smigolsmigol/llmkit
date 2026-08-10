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
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/budget-falsifier',
      include: [
        'src/index.ts',
        'src/do/budget-do.ts',
        'src/do/idempotency-do.ts',
        'src/do/ratelimit-do.ts',
        'src/middleware/budget.ts',
        'src/middleware/idempotency.ts',
        'src/middleware/logger.ts',
        'src/middleware/request-evidence.ts',
        'src/providers/chain.ts',
        'src/providers/request.ts',
        'src/providers/sse-lines.ts',
        'src/response-body.ts',
        'src/routes/chat.ts',
        'src/routes/responses.ts',
        'src/staging.ts',
      ],
    },
  },
});
