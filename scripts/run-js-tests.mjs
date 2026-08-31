import { spawnSync } from 'node:child_process';

const pnpmVersion = '9.15.4';
const buildPackages = [
  '@f3d1/llmkit-shared',
  '@f3d1/llmkit-sdk',
  '@f3d1/llmkit-cli',
  '@f3d1/llmkit-ai-sdk-provider',
  '@f3d1/llmkit-mcp-server',
];
const tests = [
  'packages/proxy/test/unit-test.mjs',
  'packages/proxy/test/crypto-test.mjs',
  'packages/proxy/test/xai-cost-test.mjs',
  'packages/proxy/test/auth-test.mjs',
  'packages/proxy/test/ratelimit-test.mjs',
  'packages/proxy/test/validation-test.mjs',
  'packages/proxy/test/log-secret-boundary-test.mjs',
  'packages/proxy/test/log-secret-runtime-proof.mjs',
  'packages/proxy/test/worker-deploy-guard-test.mjs',
  'packages/dashboard/test/recovery-boundary-test.mjs',
  'packages/dashboard/test/public-content-contract-test.mjs',
  'packages/dashboard/test/https-redirect-runtime-test.mjs',
  'packages/cli/test/parser-test.mjs',
  'packages/cli/test/proxy-test.mjs',
  'packages/sdk/test/client-test.mjs',
  'packages/sdk/test/tracker-test.mjs',
  'packages/mcp-server/test/smoke-test.mjs',
  'packages/ai-sdk-provider/test/smoke-test.mjs',
  'packages/cli/test/smoke-test.mjs',
  'packages/mcp-server/test/unit-test.mjs',
  'packages/mcp-server/test/local-adapters-test.mjs',
  'packages/ai-sdk-provider/test/unit-test.mjs',
  'packages/shared/test/exports-test.mjs',
  'packages/mcp-server/test/integration-test.mjs',
  'scripts/build-mcpb.mjs',
  'test/contract-test.mjs',
  'test/health-check-workflow-test.mjs',
  'test/pricing-source-test.mjs',
  'test/notification-signal-workflow-test.mjs',
  'test/package-build-clean-test.mjs',
  'test/quality-gate-contract-test.mjs',
  'test/release-workflow-contract-test.mjs',
  'test/silver-regression-audit-test.mjs',
];
const typedTests = [
  {
    packageName: '@f3d1/llmkit-proxy',
    file: 'test/pricing-route.test.ts',
  },
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function pnpm(args) {
  const allArgs = [`pnpm@${pnpmVersion}`, ...args];
  if (process.platform === 'win32') {
    if (!allArgs.every((arg) => /^[A-Za-z0-9@._:/=-]+$/.test(arg))) {
      throw new Error('Refusing to construct a Windows package command from an unsafe argument.');
    }
    run(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `corepack ${allArgs.join(' ')}`],
    );
    return;
  }
  run('corepack', allArgs);
}

for (const packageName of buildPackages) {
  console.log(`\nBUILD ${packageName}`);
  pnpm(['--filter', packageName, 'build']);
}

for (const testFile of tests) {
  console.log(`\nTEST ${testFile}`);
  run(process.execPath, [testFile]);
}

for (const { packageName, file } of typedTests) {
  console.log(`\nTEST ${packageName}/${file}`);
  pnpm(['--filter', packageName, 'exec', 'vitest', 'run', file, '--environment', 'node']);
}

console.log(`\nJS_TEST_GATE PASS (${tests.length + typedTests.length} test programs)`);
