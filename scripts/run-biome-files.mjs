import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const biomeLauncher = require.resolve('@biomejs/biome/bin/biome');
const policyScript = resolve(root, 'scripts', 'run-biome-policy.mjs');
const files = process.argv.slice(2);
const dormantPrefix = 'packages/plugin-eliza/';

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.startsWith('packages/') || !/\.(?:ts|tsx)$/.test(normalized)) {
    throw new Error(`Refusing unexpected Biome hook path: ${file}`);
  }
}

function runBiome(command, inputFiles) {
  if (inputFiles.length === 0) return 0;
  const result = spawnSync(
    process.execPath,
    [biomeLauncher, command, '--diagnostic-level=error', '--max-diagnostics=200', ...inputFiles],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const activeFiles = files.filter((file) => !file.replaceAll('\\', '/').startsWith(dormantPrefix));
const dormantFiles = files.filter((file) => file.replaceAll('\\', '/').startsWith(dormantPrefix));
const policyResult = activeFiles.length === 0 ? { status: 0 } : spawnSync(
  process.execPath,
  [policyScript, ...activeFiles],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (policyResult.error) throw policyResult.error;
const activeStatus = policyResult.status ?? 1;
const dormantStatus = runBiome('lint', dormantFiles);
process.exit(activeStatus || dormantStatus);
