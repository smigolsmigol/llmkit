import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

function sourceRevision(): string {
  const declared = process.env.LLMKIT_BUILD_ID || process.env.GITHUB_SHA;
  if (declared) return declared;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(import.meta.dirname, '../..'),
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return 'llmkit-local-build';
  }
}

const config: NextConfig = {
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
  transpilePackages: ['@f3d1/llmkit-shared'],
  generateBuildId: async () => sourceRevision(),
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

export default config;
