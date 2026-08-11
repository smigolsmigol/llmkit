import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

export function registryVersionUrl(registry, name, version) {
  if (!PACKAGE_NAME.test(name)) throw new Error(`Invalid package name: ${name}`);
  if (!VERSION.test(version)) throw new Error(`Invalid package version: ${version}`);

  if (registry === 'npm') {
    return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  }
  if (registry === 'pypi') {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  }
  throw new Error(`Unsupported registry: ${registry}`);
}

export async function assertUnpublishedVersion(registry, name, version, fetchImpl = fetch) {
  const url = registryVersionUrl(registry, name, version);
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) return url;
  if (response.ok) {
    throw new Error(`${name}@${version} already exists on ${registry}; refusing to overwrite it.`);
  }
  throw new Error(`Could not verify ${name}@${version} on ${registry}: HTTP ${response.status}.`);
}

async function main() {
  const [registry, name, version] = process.argv.slice(2);
  if (!registry || !name || !version) {
    throw new Error('Usage: node scripts/assert-unpublished-version.mjs <npm|pypi> <name> <version>');
  }
  await assertUnpublishedVersion(registry, name, version);
  console.log(`UNPUBLISHED_VERSION PASS ${registry} ${name}@${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
