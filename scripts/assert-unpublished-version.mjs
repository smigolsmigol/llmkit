import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
  if (registry === 'pypi' && name === 'llmkit-sdk') assertStablePythonVersion(version);
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

export async function assertPublishedVersion(registry, name, version, fetchImpl = fetch) {
  const url = registryVersionUrl(registry, name, version);
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.ok) return url;
  throw new Error(`${name}@${version} is not available on ${registry}: HTTP ${response.status}.`);
}

export function assertExpectedSha(expectedSha, actualSha) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error('Expected SHA must be a full 40-character commit SHA.');
  }
  if (expectedSha !== actualSha) {
    throw new Error(`Expected SHA ${expectedSha} does not match checked-out SHA ${actualSha}.`);
  }
  return actualSha;
}

function assertStablePythonVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Python release version must be a stable major.minor.patch version.');
  }
}

async function assertDownloadedArtifact(artifact, url, fetchImpl) {
  const download = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!download.ok || !download.body) throw new Error('Could not download the published PyPI artifact bytes.');
  const digest = createHash('sha256');
  let size = 0;
  for await (const chunk of download.body) {
    size += chunk.length;
    if (size > artifact.size) throw new Error('Published PyPI artifact bytes exceed the expected size.');
    digest.update(chunk);
  }
  if (size !== artifact.size || digest.digest('hex') !== artifact.sha256) {
    throw new Error('Published PyPI artifact bytes do not match the local build files.');
  }
}

export async function assertPythonReleaseArtifacts(version, directory, fetchImpl = fetch) {
  assertStablePythonVersion(version);
  const names = [`llmkit_sdk-${version}-py3-none-any.whl`, `llmkit_sdk-${version}.tar.gz`];
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== names.length || entries.some((entry) => !entry.isFile() || !names.includes(entry.name))) {
    throw new Error('Release directory must contain exactly the expected wheel and source archive.');
  }
  const artifacts = [];
  for (const filename of names) {
    const path = join(directory, filename);
    const details = await stat(path);
    if (details.size === 0 || details.size > 64 * 1024 * 1024) {
      throw new Error('Python release artifact size is outside the supported bound.');
    }
    const bytes = await readFile(path);
    artifacts.push({ filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const response = await fetchImpl(registryVersionUrl('pypi', 'llmkit-sdk', version), {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Could not read the published PyPI release metadata.');
  const metadata = await response.json();
  if (metadata?.info?.name !== 'llmkit-sdk' || metadata.info.version !== version
    || !Array.isArray(metadata.urls) || metadata.urls.length !== artifacts.length) {
    throw new Error('Published PyPI release metadata does not match the expected package and file set.');
  }
  const urls = artifacts.map((artifact) => {
    const published = metadata.urls.find((entry) => entry?.filename === artifact.filename);
    if (published?.yanked !== false || published.size !== artifact.size
      || published.digests?.sha256 !== artifact.sha256) {
      throw new Error('Published PyPI artifact metadata does not match the local build files.');
    }
    const url = new URL(published.url);
    if (url.protocol !== 'https:' || url.hostname !== 'files.pythonhosted.org' || url.port
      || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith('/packages/') || !url.pathname.endsWith(`/${artifact.filename}`)) {
      throw new Error('Published PyPI artifact URL is outside the expected registry path.');
    }
    return url.href;
  });
  for (const [index, artifact] of artifacts.entries()) {
    await assertDownloadedArtifact(artifact, urls[index], fetchImpl);
  }
  return { name: 'llmkit-sdk', version, files: artifacts };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'pypi-artifacts') {
    if (args.length !== 3) {
      throw new Error('Usage: node scripts/assert-unpublished-version.mjs pypi-artifacts <version> <directory>');
    }
    console.log(JSON.stringify(await assertPythonReleaseArtifacts(args[1], args[2])));
    return;
  }
  if (args[0] === 'expected-sha') {
    const [, expectedSha, actualSha] = args;
    if (!expectedSha || !actualSha) {
      throw new Error('Usage: node scripts/assert-unpublished-version.mjs expected-sha <expected> <actual>');
    }
    assertExpectedSha(expectedSha, actualSha);
    console.log(`EXPECTED_SHA PASS ${actualSha}`);
    return;
  }

  const [registry, name, version] = args;
  if (!registry || !name || !version) {
    throw new Error('Usage: node scripts/assert-unpublished-version.mjs <npm|pypi> <name> <version>');
  }
  await assertUnpublishedVersion(registry, name, version);
  console.log(`UNPUBLISHED_VERSION PASS ${registry} ${name}@${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
