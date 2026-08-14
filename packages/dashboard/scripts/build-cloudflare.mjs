import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { hkdfSync } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { sortPages } = require('next/dist/shared/lib/router/utils/sortable-routes');
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

const BUILD_MANIFESTS = [
  'app-build-manifest.json',
  'app-path-routes-manifest.json',
  'prerender-manifest.json',
  'server/app-paths-manifest.json',
  'server/pages-manifest.json',
  'server/server-reference-manifest.json',
];

function decodeBuildSecret(value) {
  assert(value, 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is required');
  const bytes = Buffer.from(value, 'base64');
  assert(
    [16, 24, 32].includes(bytes.length) && bytes.toString('base64') === value,
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be canonical base64 for a 16, 24, or 32 byte AES key',
  );
  return bytes;
}

function deriveHex(secret, label, length) {
  return Buffer.from(
    hkdfSync('sha256', secret, 'llmkit-next-build-v1', `preview:${label}`, length),
  ).toString('hex');
}

export function derivePreviewKeys(value) {
  const secret = decodeBuildSecret(value);
  return {
    previewModeId: deriveHex(secret, 'id', 16),
    previewModeSigningKey: deriveHex(secret, 'signing', 32),
    previewModeEncryptionKey: deriveHex(secret, 'encryption', 32),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableRouteMap(value) {
  return Object.fromEntries(
    sortPages(Object.keys(value)).map((route) => [route, stableValue(value[route])]),
  );
}

export function canonicalizeManifest(relativePath, manifest, previewKeys) {
  const canonical = stableValue(manifest);

  if (relativePath === 'app-build-manifest.json') {
    canonical.pages = stableRouteMap(manifest.pages);
  }

  if (
    relativePath === 'app-path-routes-manifest.json' ||
    relativePath === 'server/app-paths-manifest.json' ||
    relativePath === 'server/pages-manifest.json'
  ) {
    return stableRouteMap(manifest);
  }

  if (relativePath === 'prerender-manifest.json') {
    canonical.routes = stableRouteMap(manifest.routes);
    canonical.dynamicRoutes = stableRouteMap(manifest.dynamicRoutes);
    canonical.preview = previewKeys;
  }

  return canonical;
}

export function canonicalizeClientReferenceManifest(source) {
  const payloadIndex = source.indexOf(']={');
  assert(payloadIndex >= 0, 'Invalid Next.js client reference manifest');
  const jsonStart = payloadIndex + 2;
  return `${source.slice(0, jsonStart)}${JSON.stringify(stableValue(JSON.parse(source.slice(jsonStart))))}`;
}

async function findClientReferenceManifests(directory) {
  const manifests = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await findClientReferenceManifests(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('_client-reference-manifest.js')) {
      manifests.push(entryPath);
    }
  }
  return manifests.sort();
}

export async function canonicalizeBuildManifests(distDir, buildSecret) {
  const previewKeys = derivePreviewKeys(buildSecret);
  let serverReferenceManifest;

  for (const relativePath of BUILD_MANIFESTS) {
    const manifestPath = join(distDir, relativePath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const canonical = canonicalizeManifest(relativePath, manifest, previewKeys);
    const compact = relativePath === 'server/server-reference-manifest.json';
    await writeFile(manifestPath, JSON.stringify(canonical, null, compact ? undefined : 2));

    if (compact) serverReferenceManifest = canonical;
  }

  const serverReferenceScript = join(distDir, 'server/server-reference-manifest.js');
  await writeFile(
    serverReferenceScript,
    `self.__RSC_SERVER_MANIFEST=${JSON.stringify(JSON.stringify(serverReferenceManifest))}`,
  );

  for (const manifestPath of await findClientReferenceManifests(join(distDir, 'server/app'))) {
    const source = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, canonicalizeClientReferenceManifest(source));
  }
}

function runPnpm(args, env = process.env) {
  const pnpmCli = process.env.npm_execpath;
  assert(pnpmCli, 'Run this build through the package cloudflare:* scripts');
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function gitValue(args) {
  const result = spawnSync('git', args, {
    cwd: resolve(packageRoot, '../..'),
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function resolveSourceDateEpoch(value = process.env.SOURCE_DATE_EPOCH) {
  const resolved = value || gitValue(['show', '-s', '--format=%ct', 'HEAD']);
  assert(/^\d+$/.test(resolved), 'SOURCE_DATE_EPOCH must be the source revision Unix timestamp');
  return Number(resolved);
}

export function normalizeOpenNextInit(source, sourceDateEpoch) {
  const marker = /__BUILD_TIMESTAMP_MS__: \d+/g;
  assert.equal(source.match(marker)?.length, 1, 'Expected one OpenNext build timestamp');
  return source.replace(marker, `__BUILD_TIMESTAMP_MS__: ${sourceDateEpoch * 1000}`);
}

async function main() {
  const buildSecret = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  const outputTraceRoot = resolve(packageRoot, '../..');
  const sourceDateEpoch = resolveSourceDateEpoch();
  decodeBuildSecret(buildSecret);
  runPnpm(['run', 'build'], {
    ...process.env,
    NEXT_PRIVATE_STANDALONE: 'true',
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: outputTraceRoot,
  });
  const distDir = join(packageRoot, '.next');
  const standaloneDistDir = join(
    distDir,
    'standalone',
    relative(outputTraceRoot, packageRoot),
    '.next',
  );
  await canonicalizeBuildManifests(distDir, buildSecret);
  await canonicalizeBuildManifests(standaloneDistDir, buildSecret);
  runPnpm(
    ['exec', 'opennextjs-cloudflare', 'build', ...process.argv.slice(2), '--skipNextBuild'],
    { ...process.env, GOMAXPROCS: '1' },
  );
  const openNextInit = join(packageRoot, '.open-next/cloudflare/init.js');
  await writeFile(
    openNextInit,
    normalizeOpenNextInit(await readFile(openNextInit, 'utf8'), sourceDateEpoch),
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryPoint === import.meta.url) {
  await main();
}
