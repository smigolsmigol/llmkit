import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dockerfile = 'packages/dashboard/Dockerfile.cloudflare';
const receiptPath = join(root, 'audits', 'llmkit-dashboard-reproducibility.json');
const failureDiagnosticPath = join(root, 'audits', 'llmkit-dashboard-reproducibility-failure');
const retainedMismatchLimit = 64;
const retainedMismatchByteLimit = 32 * 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = options.stdio === 'inherit' ? '' : `\n${result.stdout || ''}${result.stderr || ''}`;
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${output}`);
  }
  return result;
}

function git(args) {
  return run('git', args, { maxBuffer: 8 * 1024 * 1024 }).stdout;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function dirtyMaterialHash() {
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const hash = createHash('sha256').update(raw);
  for (const entry of raw.split('\0').filter(Boolean).sort()) {
    const path = entry.slice(3).replace(/^.* -> /, '');
    const full = resolve(root, path);
    hash.update(path);
    hash.update(existsSync(full) && statSync(full).isFile() ? readFileSync(full) : '<missing>');
  }
  return hash.digest('hex');
}

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(full));
    else if (entry.isFile()) files.push(full);
    else throw new Error(`Dashboard artifact contains an unsupported path type: ${full}`);
  }
  return files;
}

function artifactManifest(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Dashboard artifact directory is missing: ${directory}`);
  }
  return new Map(filesBelow(directory).map((path) => {
    const bytes = readFileSync(path);
    return [
      relative(directory, path).replaceAll('\\', '/'),
      { sha256: sha256(bytes), bytes: bytes.length },
    ];
  }));
}

function treeHash(manifest) {
  const hash = createHash('sha256');
  for (const [path, file] of [...manifest.entries()].sort(([a], [b]) => (
    a < b ? -1 : a > b ? 1 : 0
  ))) {
    hash.update(path).update('\0').update(file.sha256).update('\0').update(String(file.bytes)).update('\n');
  }
  return hash.digest('hex');
}

function manifestSummary(manifest) {
  return {
    files: manifest.size,
    bytes: [...manifest.values()].reduce((sum, file) => sum + file.bytes, 0),
    treeSha256: treeHash(manifest),
  };
}

function artifactMismatches(first, second) {
  const paths = [...new Set([...first.keys(), ...second.keys()])].sort();
  return paths.flatMap((path) => {
    const a = first.get(path);
    const b = second.get(path);
    if (a && b && a.sha256 === b.sha256 && a.bytes === b.bytes) return [];
    return [{ path, first: a ?? null, second: b ?? null }];
  });
}

function compareArtifacts(first, second) {
  const mismatches = artifactMismatches(first, second);
  if (mismatches.length > 0) {
    throw new Error(
      `Dashboard artifacts are not bit-for-bit repeatable (${mismatches.length} mismatches): `
      + mismatches.slice(0, 10).map(({ path }) => path).join(', '),
    );
  }
  return manifestSummary(first);
}

function selectRetainedMismatches(
  mismatches,
  { fileLimit = retainedMismatchLimit, byteLimit = retainedMismatchByteLimit } = {},
) {
  const retained = [];
  let retainedBytes = 0;
  for (const mismatch of mismatches) {
    const pairBytes = (mismatch.first?.bytes ?? 0) + (mismatch.second?.bytes ?? 0);
    if (retained.length >= fileLimit || retainedBytes + pairBytes > byteLimit) continue;
    retained.push(mismatch);
    retainedBytes += pairBytes;
  }
  return { retained, retainedBytes };
}

function pathBelow(directory, path) {
  const base = resolve(directory);
  const candidate = resolve(base, path);
  if (!candidate.startsWith(`${base}${sep}`)) {
    throw new Error(`Dashboard diagnostic path escaped its root: ${path}`);
  }
  return candidate;
}

function copyMismatchFiles(sourceRoot, destinationRoot, side, mismatches) {
  for (const mismatch of mismatches) {
    if (!mismatch[side]) continue;
    const source = pathBelow(sourceRoot, mismatch.path);
    const destination = pathBelow(join(destinationRoot, side), mismatch.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function retainFailureDiagnostic(firstDirectory, secondDirectory, mismatches) {
  if (existsSync(failureDiagnosticPath)) {
    throw new Error(
      `Previous dashboard failure diagnostic still exists: ${failureDiagnosticPath}. `
      + 'Inspect and remove it before another clean-build pair.',
    );
  }
  const { retained, retainedBytes } = selectRetainedMismatches(mismatches);
  mkdirSync(failureDiagnosticPath, { recursive: true });
  copyMismatchFiles(firstDirectory, failureDiagnosticPath, 'first', retained);
  copyMismatchFiles(secondDirectory, failureDiagnosticPath, 'second', retained);
  const manifest = {
    schemaVersion: 1,
    mismatchCount: mismatches.length,
    retainedMismatchCount: retained.length,
    retainedBytes,
    limits: {
      mismatchCount: retainedMismatchLimit,
      bytes: retainedMismatchByteLimit,
    },
    truncated: retained.length !== mismatches.length,
    retained,
    mismatchSample: mismatches.slice(0, retainedMismatchLimit),
  };
  writeFileSync(
    join(failureDiagnosticPath, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    path: relative(root, failureDiagnosticPath).replaceAll('\\', '/'),
    retainedMismatchCount: retained.length,
    retainedBytes,
    truncated: retained.length !== mismatches.length,
  };
}

function reproducibilityReceipt(buildId, sourceDateEpoch, secretBytes) {
  return {
    schemaVersion: 1,
    gate: 'dashboard clean-build reproducibility',
    evaluatedHead: buildId,
    dirtyMaterialSha256: dirtyMaterialHash(),
    sourceDateEpoch,
    pairSecretSha256: sha256(secretBytes),
    tools: {
      node: process.version,
      dockerBuildx: run('docker', ['buildx', 'version']).stdout.trim(),
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
    },
    inputs: {
      dockerfile: { path: dockerfile, sha256: sha256(readFileSync(join(root, dockerfile))) },
      lockfile: { path: 'pnpm-lock.yaml', sha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))) },
      openNextPatch: {
        path: 'patches/@opennextjs__cloudflare@1.20.2.patch',
        sha256: sha256(readFileSync(join(root, 'patches/@opennextjs__cloudflare@1.20.2.patch'))),
      },
    },
    build: {
      count: 2,
      noCache: true,
      target: 'artifact',
      pairSecretReused: true,
    },
  };
}

function writeReceipt(receipt) {
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function runSelfTest() {
  const sameA = new Map([
    ['handler.mjs', { sha256: 'handler', bytes: 10 }],
    ['manifest.json', { sha256: 'manifest', bytes: 20 }],
  ]);
  const sameB = new Map([...sameA].reverse());
  const summary = compareArtifacts(sameA, sameB);
  if (summary.files !== 2 || summary.bytes !== 30 || summary.treeSha256 !== treeHash(sameB)) {
    throw new Error('Dashboard reproducibility pass fixture was rejected.');
  }

  for (const violation of [
    new Map([['handler.mjs', { sha256: 'different', bytes: 10 }]]),
    new Map([
      ['handler.mjs', { sha256: 'handler', bytes: 11 }],
      ['manifest.json', { sha256: 'manifest', bytes: 20 }],
    ]),
    new Map([...sameA, ['extra.js', { sha256: 'extra', bytes: 1 }]]),
  ]) {
    let blocked = false;
    try {
      compareArtifacts(sameA, violation);
    } catch {
      blocked = true;
    }
    if (!blocked) throw new Error('Dashboard reproducibility violation fixture was accepted.');
  }

  const bounded = selectRetainedMismatches([
    { path: 'a.js', first: { sha256: 'a', bytes: 10 }, second: { sha256: 'b', bytes: 10 } },
    { path: 'b.js', first: { sha256: 'a', bytes: 10 }, second: { sha256: 'b', bytes: 10 } },
    { path: 'c.js', first: { sha256: 'a', bytes: 1 }, second: { sha256: 'b', bytes: 1 } },
  ], { fileLimit: 2, byteLimit: 25 });
  if (bounded.retained.map(({ path }) => path).join(',') !== 'a.js,c.js'
      || bounded.retainedBytes !== 22) {
    throw new Error('Dashboard failure diagnostic limits were not enforced.');
  }

  let escaped = false;
  try {
    pathBelow(join(tmpdir(), 'llmkit-dashboard-diagnostic-root'), join('..', 'escape.js'));
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error('Dashboard failure diagnostic path escape was accepted.');

  const copyFixtureRoot = resolve(
    tmpdir(),
    `llmkit-dashboard-diagnostic-self-test-${randomUUID()}`,
  );
  try {
    const firstDirectory = join(copyFixtureRoot, 'source-first');
    const secondDirectory = join(copyFixtureRoot, 'source-second');
    const diagnosticDirectory = join(copyFixtureRoot, 'diagnostic');
    mkdirSync(join(firstDirectory, 'server'), { recursive: true });
    mkdirSync(join(secondDirectory, 'server'), { recursive: true });
    writeFileSync(join(firstDirectory, 'server', 'page.js'), 'first');
    writeFileSync(join(secondDirectory, 'server', 'page.js'), 'second');
    const mismatches = artifactMismatches(
      artifactManifest(firstDirectory),
      artifactManifest(secondDirectory),
    );
    copyMismatchFiles(firstDirectory, diagnosticDirectory, 'first', mismatches);
    copyMismatchFiles(secondDirectory, diagnosticDirectory, 'second', mismatches);
    if (readFileSync(join(diagnosticDirectory, 'first', 'server', 'page.js'), 'utf8') !== 'first'
        || readFileSync(join(diagnosticDirectory, 'second', 'server', 'page.js'), 'utf8') !== 'second') {
      throw new Error('Dashboard failure diagnostic did not retain both mismatch files.');
    }
  } finally {
    rmSync(copyFixtureRoot, { recursive: true, force: true, maxRetries: 3 });
  }
  console.log('DASHBOARD_REPRODUCIBILITY_SELF_TEST PASS');
}

function compareExisting(firstPath, secondPath) {
  const summary = compareArtifacts(
    artifactManifest(resolve(root, firstPath)),
    artifactManifest(resolve(root, secondPath)),
  );
  console.log(
    `DASHBOARD_REPRODUCIBILITY PASS (${summary.files} files, ${summary.bytes} bytes, `
    + `tree ${summary.treeSha256}; existing artifacts)`,
  );
}

function buildArtifact(output, buildId, sourceDateEpoch, buildSecret) {
  if (existsSync(output)) throw new Error(`Refusing to overwrite dashboard proof output: ${output}`);
  run(
    'docker',
    [
      'buildx',
      'build',
      '--no-cache',
      '--progress=plain',
      '--file',
      dockerfile,
      '--build-arg',
      `LLMKIT_BUILD_ID=${buildId}`,
      '--build-arg',
      `SOURCE_DATE_EPOCH=${sourceDateEpoch}`,
      '--secret',
      'id=next_server_actions_encryption_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
      '--target',
      'artifact',
      '--output',
      `type=local,dest=${output.replaceAll('\\', '/')}`,
      '.',
    ],
    {
      env: { ...process.env, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: buildSecret },
      stdio: 'inherit',
    },
  );
}

function proveCleanBuildPair() {
  const temporaryRoot = resolve(tmpdir());
  const proofRoot = resolve(temporaryRoot, `llmkit-dashboard-proof-${randomUUID()}`);
  if (dirname(proofRoot) !== temporaryRoot) {
    throw new Error(`Dashboard proof path escaped the system temp directory: ${proofRoot}`);
  }

  const buildId = git(['rev-parse', 'HEAD']).trim();
  const sourceDateEpoch = git(['show', '-s', '--format=%ct', 'HEAD']).trim();
  if (!/^\d+$/.test(sourceDateEpoch)) throw new Error('Invalid source revision epoch.');
  const secretBytes = randomBytes(32);
  const buildSecret = secretBytes.toString('base64');

  if (existsSync(failureDiagnosticPath)) {
    throw new Error(
      `Previous dashboard failure diagnostic still exists: ${failureDiagnosticPath}. `
      + 'Inspect and remove it before another clean-build pair.',
    );
  }
  const receiptBase = reproducibilityReceipt(buildId, sourceDateEpoch, secretBytes);

  let failureRecorded = false;
  let phase = 'proof-directory';
  try {
    mkdirSync(proofRoot);
    const firstDirectory = join(proofRoot, 'first');
    const secondDirectory = join(proofRoot, 'second');
    phase = 'first-build';
    buildArtifact(firstDirectory, buildId, sourceDateEpoch, buildSecret);
    phase = 'second-build';
    buildArtifact(secondDirectory, buildId, sourceDateEpoch, buildSecret);
    phase = 'artifact-comparison';
    const firstManifest = artifactManifest(firstDirectory);
    const secondManifest = artifactManifest(secondDirectory);
    const mismatches = artifactMismatches(firstManifest, secondManifest);
    if (mismatches.length > 0) {
      const diagnostic = retainFailureDiagnostic(
        firstDirectory,
        secondDirectory,
        mismatches,
      );
      writeReceipt({
        ...receiptBase,
        result: 'FAIL',
        failure: { phase: 'artifact-comparison' },
        artifacts: {
          first: manifestSummary(firstManifest),
          second: manifestSummary(secondManifest),
        },
        mismatchCount: mismatches.length,
        mismatchSample: mismatches.slice(0, retainedMismatchLimit),
        diagnostic,
      });
      failureRecorded = true;
      throw new Error(
        `Dashboard artifacts are not bit-for-bit repeatable (${mismatches.length} mismatches). `
        + `Retained ${diagnostic.retainedMismatchCount} mismatch pairs at ${diagnostic.path}.`,
      );
    }
    const summary = manifestSummary(firstManifest);

    writeReceipt({
      ...receiptBase,
      result: 'PASS',
      artifact: summary,
      mismatchCount: 0,
    });
    console.log(
      `DASHBOARD_REPRODUCIBILITY PASS (${summary.files} files, ${summary.bytes} bytes, `
      + `tree ${summary.treeSha256}; two clean builds)`,
    );
  } catch (error) {
    if (!failureRecorded) {
      writeReceipt({
        ...receiptBase,
        result: 'FAIL',
        failure: {
          phase,
          message: String(error instanceof Error ? error.message : error).slice(0, 2_000),
        },
        mismatchCount: null,
      });
    }
    throw error;
  } finally {
    rmSync(proofRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else if (process.argv[2] === '--compare') {
  if (process.argv.length !== 5) {
    throw new Error('Usage: node scripts/run-dashboard-reproducibility.mjs --compare <first> <second>');
  }
  compareExisting(process.argv[3], process.argv[4]);
} else if (process.argv.length === 2) {
  proveCleanBuildPair();
} else {
  throw new Error('Unknown dashboard reproducibility arguments.');
}
