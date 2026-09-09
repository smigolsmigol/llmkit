import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertExpectedSha,
  assertPublishedVersion,
  assertPythonReleaseArtifacts,
  assertUnpublishedVersion,
  registryVersionUrl,
} from '../scripts/assert-unpublished-version.mjs';

const npmWorkflow = await readFile('.github/workflows/publish.yml', 'utf8');
const pypiWorkflow = await readFile('.github/workflows/publish-pypi.yml', 'utf8');
const sbomWorkflow = await readFile('.github/workflows/sbom.yml', 'utf8');
const slsaWorkflow = await readFile('.github/workflows/slsa-provenance.yml', 'utf8');

assert.match(pypiWorkflow, /environment: pypi/);
assert.match(pypiWorkflow, /working-directory: packages\/python-sdk/);
assert.match(pypiWorkflow, /id: release[\s\S]*version=\$VERSION.*GITHUB_OUTPUT/);
assert.match(pypiWorkflow, /id: attest\n\s+uses: actions\/attest-build-provenance@[a-f0-9]{40}/);
const pythonAttestAt = pypiWorkflow.indexOf('      - name: attest artifacts');
const pythonPublishAt = pypiWorkflow.indexOf('uses: pypa/gh-action-pypi-publish@');
const pythonVerifyAt = pypiWorkflow.indexOf('      - name: verify published artifact bytes');
const pythonRetainAt = pypiWorkflow.indexOf('      - name: retain attested release artifacts');
assert(pythonAttestAt >= 0 && pythonPublishAt > pythonAttestAt);
assert(pythonVerifyAt > pythonPublishAt && pythonRetainAt > pythonVerifyAt);
const pythonVerifyStep = pypiWorkflow.slice(pythonVerifyAt, pythonRetainAt);
assert.match(pythonVerifyStep, /RELEASE_VERSION: \$\{\{ steps\.release\.outputs\.version \}\}/);
assert.match(pythonVerifyStep, /run: node ..\/..\/scripts\/assert-unpublished-version\.mjs pypi-artifacts "\$RELEASE_VERSION" dist/);
const pythonRetainStep = pypiWorkflow.slice(pythonRetainAt, pypiWorkflow.indexOf('\n      - name:', pythonRetainAt + 1));
assert.match(pythonRetainStep, /if: always\(\) && steps\.attest\.outcome == 'success'/);
assert.match(pythonRetainStep, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
assert.match(pythonRetainStep, /name: llmkit-sdk-\$\{\{ steps\.release\.outputs\.version \}\}-dist/);
assert.match(pythonRetainStep, /path: \|\n\s+packages\/python-sdk\/dist\/\*\.whl\n\s+packages\/python-sdk\/dist\/\*\.tar\.gz/);
assert.match(pythonRetainStep, /if-no-files-found: error/);
assert.match(pythonRetainStep, /retention-days: 90/);
assert.match(slsaWorkflow, /build:\n\s+if: \$\{\{ !startsWith\(github\.event\.release\.tag_name, 'python-sdk-v'\) \}\}/);
assert.match(sbomWorkflow, /sbom:\n\s+if: github\.event_name != 'release' \|\| !startsWith\(github\.event\.release\.tag_name, 'python-sdk-v'\)/);

const sbomActions = [...sbomWorkflow.matchAll(/^\s*-?\s*uses:\s*[^@\s]+@([^\s#]+)/gm)];
assert.ok(sbomActions.length >= 3, 'SBOM workflow must expose its action revisions');
for (const [, revision] of sbomActions) {
  assert.match(revision, /^[0-9a-f]{40}$/, 'SBOM actions must remain pinned to full commit SHAs');
}
assert.match(
  sbomWorkflow,
  /permissions:\n\s+contents: read[\s\S]*jobs:\n\s+sbom:[\s\S]*permissions:\n\s+contents: write/,
  'SBOM write permission must stay scoped to its job',
);

assert.match(npmWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(pypiWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(npmWorkflow, /expected_sha:/);
assert.match(pypiWorkflow, /expected_sha:/);
assert.match(npmWorkflow, /expected-sha[\s\S]*\$\{\{ github\.sha \}\}/);
assert.match(pypiWorkflow, /expected-sha[\s\S]*\$\{\{ github\.sha \}\}/);
assert.match(npmWorkflow, /assert-unpublished-version\.mjs npm/);
assert.match(pypiWorkflow, /assert-unpublished-version\.mjs pypi/);
assert.match(npmWorkflow, /id-token: write/);
assert.doesNotMatch(npmWorkflow, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/);
assert.match(npmWorkflow, /pnpm exec publint \/tmp\/pkg-check\/package/);
assert.match(npmWorkflow, /tar -xzf \/tmp\/pkg\/\*\.tgz -C \/tmp\/pkg-check/);
assert.match(npmWorkflow, /source\.dependencies\?\.\['@f3d1\/llmkit-shared'\]/);
assert.match(npmWorkflow, /packed\.dependencies\?\.\['@f3d1\/llmkit-shared'\]/);
assert.match(npmWorkflow, /if \(sourceShared\)/);
assert.match(npmWorkflow, /if: inputs\.package == 'mcp-server'[\s\S]*run: pnpm mcpb:build/);
assert.match(npmWorkflow, /subject-path: packages\/mcp-server\/mcp-server\.mcpb/);
assert.match(npmWorkflow, /name: llmkit-mcp-server-\$\{\{ steps\.release\.outputs\.version \}\}-mcpb/);
assert.match(npmWorkflow, /readFile\('\/tmp\/pkg-check\/package\/mcp-server\.mcpb'\)/);
assert.match(npmWorkflow, /readFile\('packages\/mcp-server\/mcp-server\.mcpb'\)/);
assert.match(npmWorkflow, /continue-on-error: true/);

const verifyPackedStart = npmWorkflow.indexOf('      - name: verify packed artifact');
const verifyPackedEnd = npmWorkflow.indexOf('\n      - name:', verifyPackedStart + 1);
assert(verifyPackedStart >= 0 && verifyPackedEnd > verifyPackedStart, 'verify packed artifact step must exist');
const verifyPackedStep = npmWorkflow.slice(verifyPackedStart, verifyPackedEnd);
assert.match(
  verifyPackedStep,
  /import \{ assertPublishedVersion \} from '\.\/scripts\/assert-unpublished-version\.mjs';/,
);
assert.match(verifyPackedStep, /await assertPublishedVersion\('npm', '@f3d1\/llmkit-shared', expected\)/);
assert.doesNotMatch(npmWorkflow, /publint[^\n]*--pack=npm/);
const pythonFloorStart = pypiWorkflow.indexOf('      - name: test declared Python floor');
const pythonFloorEnd = pypiWorkflow.indexOf('\n      - name:', pythonFloorStart + 1);
assert(pythonFloorStart >= 0 && pythonFloorEnd > pythonFloorStart, 'Python floor step must exist');
const pythonFloorStep = pypiWorkflow.slice(pythonFloorStart, pythonFloorEnd);
assert.match(pythonFloorStep, /env:\n\s+PYTHONPATH: src\n\s+run: python -m pytest/);
assert.match(pypiWorkflow, /python -m pip install --force-reinstall --no-deps dist\/\*\.whl/);
assert.match(pypiWorkflow, /packages-dir: packages\/python-sdk\/dist\//);

const packAt = npmWorkflow.indexOf('pnpm pack --pack-destination /tmp/pkg');
const verifyAt = npmWorkflow.indexOf('pnpm exec publint /tmp/pkg-check/package');
const attestAt = npmWorkflow.indexOf('subject-path: /tmp/pkg/*.tgz');
const mcpbBuildAt = npmWorkflow.indexOf('run: pnpm mcpb:build');
const mcpbAttestAt = npmWorkflow.indexOf('subject-path: packages/mcp-server/mcp-server.mcpb');
const publishAt = npmWorkflow.indexOf('npm publish /tmp/pkg/*.tgz');
const mcpbRetainAt = npmWorkflow.indexOf(
  ['name: llmkit-mcp-server-', '$', '{{ steps.release.outputs.version }}', '-mcpb'].join(''),
);
assert(packAt >= 0 && packAt < verifyAt, 'artifact verification must follow the canonical pack');
assert(mcpbBuildAt < packAt, 'MCPB must be built before the durable npm tarball is packed');
assert(verifyAt < attestAt, 'the verified artifact must be attested');
assert(verifyAt < mcpbAttestAt, 'MCPB artifact must be attested after its packed hash is verified');
assert(attestAt < publishAt, 'the attested artifact must be published');
assert(mcpbAttestAt < publishAt, 'the attested MCPB must be bound before npm publication');
assert(publishAt < mcpbRetainAt, 'MCPB retention must follow successful npm publication');

const publishStepStart = npmWorkflow.indexOf('      - name: publish with provenance');
const publishStepEnd = npmWorkflow.indexOf('\n      - name:', publishStepStart + 1);
assert(publishStepStart >= 0 && publishStepEnd > publishStepStart, 'publish step must exist');
const publishStep = npmWorkflow.slice(publishStepStart, publishStepEnd);
assert.match(publishStep, /npm publish \/tmp\/pkg\/\*\.tgz --provenance --access public/);
assert.doesNotMatch(publishStep, /env:|NODE_AUTH_TOKEN|NPM_TOKEN/);

assert.equal(
  registryVersionUrl('npm', '@f3d1/llmkit-sdk', '0.0.8'),
  'https://registry.npmjs.org/%40f3d1%2Fllmkit-sdk/0.0.8',
);
assert.equal(
  registryVersionUrl('pypi', 'llmkit-sdk', '0.1.10'),
  'https://pypi.org/pypi/llmkit-sdk/0.1.10/json',
);

await assertUnpublishedVersion('npm', '@f3d1/llmkit-sdk', '0.0.8', async () => ({ status: 404 }));
await assert.rejects(
  assertUnpublishedVersion('npm', '@f3d1/llmkit-sdk', '0.0.8', async () => ({ status: 200, ok: true })),
  /already exists/,
);
await assert.rejects(
  assertUnpublishedVersion('pypi', 'llmkit-sdk', '0.1.10', async () => ({ status: 503, ok: false })),
  /Could not verify/,
);

await assertPublishedVersion('npm', '@f3d1/llmkit-shared', '0.0.7', async () => ({ status: 200, ok: true }));
await assert.rejects(
  assertPublishedVersion('npm', '@f3d1/llmkit-shared', '0.0.7', async () => ({ status: 404, ok: false })),
  /not available/,
);

const sha = '5caac332faaf1938ff144594760dd9958fafeb91';
assert.equal(assertExpectedSha(sha, sha), sha);
assert.throws(
  () => assertExpectedSha(sha, 'ddd3f5034002fcd2d326640cb00b791f26a96494'),
  /does not match/,
);
assert.throws(
  () => assertExpectedSha('not-a-sha', sha),
  /full 40-character/,
);

const artifactDirectory = await mkdtemp(join(tmpdir(), 'llmkit-release-test-'));
try {
  const version = '0.1.12';
  const names = [`llmkit_sdk-${version}-py3-none-any.whl`, `llmkit_sdk-${version}.tar.gz`];
  const bytes = [Buffer.from('wheel fixture'), Buffer.from('source archive fixture')];
  for (const [index, name] of names.entries()) await writeFile(join(artifactDirectory, name), bytes[index]);
  const metadata = {
    info: { name: 'llmkit-sdk', version },
    urls: names.map((filename, index) => ({
      filename,
      size: bytes[index].length,
      digests: { sha256: createHash('sha256').update(bytes[index]).digest('hex') },
      url: `https://files.pythonhosted.org/packages/fixture/${filename}`,
      yanked: false,
    })),
  };
  const makeFetch = (record = metadata, downloads = bytes, calls = []) => async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal, 'every registry request needs a deadline');
    if (url === registryVersionUrl('pypi', 'llmkit-sdk', version)) return Response.json(record);
    const index = metadata.urls.findIndex((entry) => entry.url === url);
    assert(index >= 0, 'only the validated PyPI artifact host may be read');
    return new Response(downloads[index]);
  };
  const calls = [];
  const result = await assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch(metadata, bytes, calls));
  assert.equal(result.version, version);
  assert.deepEqual(result.files.map((file) => file.filename), names);
  assert.equal(calls.length, 3, 'verify metadata and both downloaded artifacts');

  for (const mutate of [
    (record) => { record.info.name = 'another-package'; },
    (record) => { record.info.version = '0.1.11'; },
    (record) => { record.urls = null; },
    (record) => { record.urls.pop(); },
    (record) => { record.urls.push(record.urls[0]); },
    (record) => { record.urls[1] = record.urls[0]; },
    (record) => { record.urls[0] = null; },
    (record) => { record.urls[0].yanked = true; },
    (record) => { record.urls[0].size += 1; },
    (record) => { record.urls[0].digests.sha256 = '0'.repeat(64); },
    (record) => { record.urls[0].digests = null; },
    (record) => { record.urls[0].url = 'https://example.com/artifact'; },
    (record) => { record.urls[0].url = 'http://files.pythonhosted.org/artifact'; },
    (record) => { record.urls[0].url = 'not a URL'; },
  ]) {
    const record = structuredClone(metadata);
    mutate(record);
    await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch(record)));
  }
  for (const url of [
    `https://files.pythonhosted.org:444/packages/${names[0]}`,
    `https://user:pass@files.pythonhosted.org/packages/${names[0]}`,
    `${metadata.urls[0].url}?download=1`,
    `${metadata.urls[0].url}#fragment`,
    `https://files.pythonhosted.org/other/${names[0]}`,
    'https://files.pythonhosted.org/packages/other.whl',
  ]) {
    const record = structuredClone(metadata);
    record.urls[0].url = url;
    await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch(record)), /URL/);
  }
  for (const record of [null, {}, { info: null }]) {
    await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch(record)), /metadata/);
  }
  for (const altered of [Buffer.alloc(bytes[0].length, 65), Buffer.from('short'), Buffer.alloc(100)]) {
    await assert.rejects(
      assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch(metadata, [altered, bytes[1]])),
      /artifact bytes/,
    );
  }
  await assert.rejects(
    assertPythonReleaseArtifacts(version, artifactDirectory, async () => new Response('', { status: 503 })),
    /metadata/,
  );
  for (const response of [new Response('', { status: 503 }), new Response(null)]) {
    await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory,
      async (url) => url.endsWith('/json') ? Response.json(metadata) : response), /download/);
  }
  await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, async () => {
    throw new DOMException('Timed out', 'TimeoutError');
  }), { name: 'TimeoutError' });
  for (const invalid of ['../bad', '', '0.1.12rc1', '01.1.12', '0.1', '1.2.3.4']) {
    await assert.rejects(assertPythonReleaseArtifacts(invalid, artifactDirectory, makeFetch()), /version/);
    const preflightCalls = [];
    await assert.rejects(assertUnpublishedVersion('pypi', 'llmkit-sdk', invalid,
      makeFetch(metadata, bytes, preflightCalls)), /stable major.minor.patch/);
    assert.equal(preflightCalls.length, 0, 'unsupported versions must fail before registry access or publication');
  }
  for (const args of [[], [version], [version, artifactDirectory, 'extra']]) {
    const cli = spawnSync(process.execPath, ['scripts/assert-unpublished-version.mjs', 'pypi-artifacts', ...args],
      { encoding: 'utf8', timeout: 10_000 });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Usage:/);
  }
  for (const size of [0, 64 * 1024 * 1024 + 1]) {
    await truncate(join(artifactDirectory, names[0]), size);
    await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch()), /size/);
  }
  await writeFile(join(artifactDirectory, names[0]), bytes[0]);
  await writeFile(join(artifactDirectory, 'unexpected.txt'), 'not part of the release');
  await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch()), /exactly/);
  await rm(join(artifactDirectory, 'unexpected.txt'));
  await rm(join(artifactDirectory, names[0]));
  await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch()), /exactly/);
  await mkdir(join(artifactDirectory, names[0]));
  await assert.rejects(assertPythonReleaseArtifacts(version, artifactDirectory, makeFetch()), /exactly/);
} finally {
  await rm(artifactDirectory, { recursive: true, force: true });
}

console.log('RELEASE_WORKFLOW_CONTRACT PASS');
