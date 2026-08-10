import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertUnpublishedVersion,
  registryVersionUrl,
} from '../scripts/assert-unpublished-version.mjs';

const npmWorkflow = await readFile('.github/workflows/publish.yml', 'utf8');
const pypiWorkflow = await readFile('.github/workflows/publish-pypi.yml', 'utf8');

assert.match(npmWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(pypiWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(npmWorkflow, /assert-unpublished-version\.mjs npm/);
assert.match(pypiWorkflow, /assert-unpublished-version\.mjs pypi/);
assert.match(npmWorkflow, /pnpm exec publint \/tmp\/pkg-check\/package/);
assert.match(npmWorkflow, /tar -xzf \/tmp\/pkg\/\*\.tgz -C \/tmp\/pkg-check/);
assert.match(npmWorkflow, /source\.dependencies\?\.\['@f3d1\/llmkit-shared'\]/);
assert.match(npmWorkflow, /packed\.dependencies\?\.\['@f3d1\/llmkit-shared'\]/);
assert.match(npmWorkflow, /if \(sourceShared\)/);
assert.doesNotMatch(npmWorkflow, /publint[^\n]*--pack=npm/);
assert.match(pypiWorkflow, /python -m pytest/);
assert.match(pypiWorkflow, /python -m pip install --force-reinstall --no-deps dist\/\*\.whl/);
assert.match(pypiWorkflow, /packages-dir: packages\/python-sdk\/dist\//);

const packAt = npmWorkflow.indexOf('pnpm pack --pack-destination /tmp/pkg');
const verifyAt = npmWorkflow.indexOf('pnpm exec publint /tmp/pkg-check/package');
const attestAt = npmWorkflow.indexOf('subject-path: /tmp/pkg/*.tgz');
const publishAt = npmWorkflow.indexOf('npm publish /tmp/pkg/*.tgz');
assert(packAt >= 0 && packAt < verifyAt, 'artifact verification must follow the canonical pack');
assert(verifyAt < attestAt, 'the verified artifact must be attested');
assert(attestAt < publishAt, 'the attested artifact must be published');

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

console.log('RELEASE_WORKFLOW_CONTRACT PASS');
