import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packages = ['shared', 'sdk', 'cli', 'ai-sdk-provider', 'mcp-server'];
const expectedBuild = 'node ../../scripts/clean-package-dist.mjs && tsc';

for (const packageName of packages) {
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(
    `packages/${packageName}/package.json`,
    'utf8',
  ));
  if (manifest.scripts?.build !== expectedBuild) {
    throw new Error(`${packageName} build does not clean stale distribution output`);
  }
}

const fixture = resolve('packages', '.clean-dist-fixture');
const stale = resolve(fixture, 'dist', 'removed-source.js');
await mkdir(resolve(fixture, 'dist'), { recursive: true });
await writeFile(resolve(fixture, 'package.json'), '{}\n');
await writeFile(stale, 'stale\n');

try {
  const result = spawnSync(process.execPath, [resolve('scripts/clean-package-dist.mjs')], {
    cwd: fixture,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const exists = await import('node:fs').then(({ existsSync }) => existsSync(stale));
  if (exists) throw new Error('cleaner left a removed-source artifact in dist');
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const refusal = spawnSync(process.execPath, [resolve('scripts/clean-package-dist.mjs')], {
  cwd: resolve('.'),
  encoding: 'utf8',
});
if (refusal.status === 0 || !`${refusal.stdout}${refusal.stderr}`.includes('Refusing to clean')) {
  throw new Error('cleaner did not reject a repository-root target');
}

console.log(`PACKAGE_BUILD_CLEAN PASS (${packages.length} active packages + violation/pass fixture)`);
