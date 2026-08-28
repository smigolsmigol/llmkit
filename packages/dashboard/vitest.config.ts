import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  optimizeDeps: {
    include: ['react/jsx-dev-runtime'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          exclude: ['test/client-interactions.test.tsx'],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['test/client-interactions.test.tsx'],
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                channel: process.platform === 'win32' ? 'msedge' : 'chrome',
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary', 'lcovonly'],
      reportsDirectory: './coverage/dashboard',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
