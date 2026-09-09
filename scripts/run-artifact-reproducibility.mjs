import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pnpmVersion = '9.15.4';
const qualityPython = process.env.LLMKIT_QUALITY_PYTHON || (
  process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python')
);
const packages = ['shared', 'sdk', 'cli', 'ai-sdk-provider', 'mcp-server'];
const packageNames = packages.map((name) => JSON.parse(
  readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'),
).name);

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
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}${result.stderr || ''}`,
    );
  }
  return result;
}

function pnpm(args, cwd = root) {
  const allArgs = [`pnpm@${pnpmVersion}`, ...args.map((value) => value.replaceAll('\\', '/'))];
  if (process.platform === 'win32') {
    if (!allArgs.every((arg) => /^[A-Za-z0-9@._:/=+-]+$/.test(arg))) {
      throw new Error('Refusing to construct a Windows package command from an unsafe argument.');
    }
    return run(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `corepack ${allArgs.join(' ')}`],
      { cwd },
    );
  }
  return run('corepack', allArgs, { cwd });
}

function npm(args, cwd) {
  const normalized = args.map((value) => value.replaceAll('\\', '/'));
  if (process.platform === 'win32') {
    if (!normalized.every((arg) => /^[A-Za-z0-9@._:/=+-]+$/.test(arg))) {
      throw new Error('Refusing to construct a Windows npm command from an unsafe argument.');
    }
    return run(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `npm ${normalized.join(' ')}`],
      { cwd },
    );
  }
  return run('npm', normalized, { cwd });
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
  }
  return files;
}

function artifactManifest(directory) {
  return new Map(filesBelow(directory).map((path) => [
    relative(directory, path).replaceAll('\\', '/'),
    { sha256: sha256(readFileSync(path)), bytes: statSync(path).size },
  ]));
}

function assertSameArtifacts(first, second) {
  const firstNames = [...first.keys()].sort();
  const secondNames = [...second.keys()].sort();
  if (JSON.stringify(firstNames) !== JSON.stringify(secondNames)) {
    throw new Error(`Artifact sets differ: ${firstNames.join(', ')} != ${secondNames.join(', ')}`);
  }
  for (const name of firstNames) {
    if (first.get(name)?.sha256 !== second.get(name)?.sha256) {
      throw new Error(`Artifact is not bit-for-bit repeatable: ${name}`);
    }
  }
}

if (process.argv.includes('--self-test')) {
  const passA = new Map([['package.tgz', { sha256: 'same', bytes: 1 }]]);
  const passB = new Map([['package.tgz', { sha256: 'same', bytes: 1 }]]);
  assertSameArtifacts(passA, passB);
  let mismatchBlocked = false;
  try {
    assertSameArtifacts(passA, new Map([['package.tgz', { sha256: 'different', bytes: 1 }]]));
  } catch {
    mismatchBlocked = true;
  }
  if (!mismatchBlocked) throw new Error('Artifact mismatch fixture was accepted.');
  console.log('ARTIFACT_REPRODUCIBILITY_SELF_TEST PASS');
  process.exit(0);
}

if (!existsSync(qualityPython)) {
  throw new Error('Pinned quality Python is missing. Run quality:bootstrap first.');
}

const proofRoot = join(tmpdir(), `llmkit-artifact-proof-${randomUUID()}`);
const sourceDateEpoch = git(['show', '-s', '--format=%ct', 'HEAD']).trim();
const buildEnvironment = { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch };

function buildArtifacts(label) {
  console.log(`Building artifact set: ${label}`);
  const output = join(proofRoot, label);
  const npmOutput = join(output, 'npm');
  const pythonOutput = join(output, 'python');
  mkdirSync(npmOutput, { recursive: true });
  mkdirSync(pythonOutput, { recursive: true });

  for (const packageName of packages) {
    pnpm(['--filter', `@f3d1/llmkit-${packageName}`, 'build']);
    pnpm(['pack', '--pack-destination', npmOutput], join(root, 'packages', packageName));
  }
  run(
    qualityPython,
    ['-m', 'build', '--no-isolation', '--outdir', pythonOutput],
    { cwd: join(root, 'packages', 'python-sdk'), env: buildEnvironment },
  );
  return output;
}

function proveNodeInstall(artifactDirectory) {
  console.log('Checking isolated Node install/uninstall');
  const consumer = join(proofRoot, 'node-consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"name":"llmkit-install-proof","private":true,"type":"module"}\n');
  const tarballs = filesBelow(join(artifactDirectory, 'npm'))
    .filter((path) => path.endsWith('.tgz'))
    .map((path) => resolve(path));
  npm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--save-exact',
    ...tarballs,
  ], consumer);
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "await import('@f3d1/llmkit-shared'); await import('@f3d1/llmkit-sdk'); await import('@f3d1/llmkit-ai-sdk-provider');",
    ],
    { cwd: consumer },
  );
  run(process.execPath, [join(consumer, 'node_modules', '@f3d1', 'llmkit-cli', 'dist', 'index.js'), '--help']);
  run(process.execPath, [join(consumer, 'node_modules', '@f3d1', 'llmkit-mcp-server', 'dist', 'index.js'), '--help']);
  npm([
    'uninstall',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    ...packageNames,
  ], consumer);
  for (const packageName of packageNames) {
    const packageDirectory = join(consumer, 'node_modules', ...packageName.split('/'));
    if (existsSync(packageDirectory)) throw new Error(`Uninstall left package behind: ${packageName}`);
  }
}

function provePythonInstall(artifactDirectory) {
  console.log('Checking isolated Python install and native boundaries');
  const consumer = join(proofRoot, 'python-consumer');
  run(qualityPython, ['-m', 'venv', consumer]);
  const python = process.platform === 'win32'
    ? join(consumer, 'Scripts', 'python.exe')
    : join(consumer, 'bin', 'python');
  const wheels = filesBelow(join(artifactDirectory, 'python')).filter((path) => path.endsWith('.whl'));
  if (wheels.length !== 1) throw new Error(`Expected one Python wheel, found ${wheels.length}.`);
  const options = { cwd: consumer, timeout: 120_000 };
  const proof = join(consumer, 'check-python-boundary-install.py');
  copyFileSync(join(root, 'scripts', 'check-python-boundary-install.py'), proof);
  for (const example of [
    'boundary_review_fixture.py',
    'openai_agents_boundary_review.py',
    'pydantic_ai_boundary_review.py',
  ]) {
    copyFileSync(join(root, 'examples', example), join(consumer, example));
  }
  run(python, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check', wheels[0]], options);
  // Avoid optimized bytecode leftovers in the uninstall proof.
  run(python, ['-I', '-O', '-B', proof, '--without-adapters'], options);
  run(python, [
    '-I', '-m', 'pip', 'install', '--disable-pip-version-check',
    `${wheels[0]}[openai-agents,pydantic-ai]`,
  ], options);
  run(python, ['-I', '-O', '-B', proof], options);
  run(python, ['-I', '-m', 'pip', 'uninstall', '--yes', 'llmkit-sdk'], options);
  run(python, ['-I', '-c', "import importlib.util; assert importlib.util.find_spec('llmkit') is None"], options);
}

try {
  mkdirSync(proofRoot, { recursive: true });
  const firstDirectory = buildArtifacts('first');
  const secondDirectory = buildArtifacts('second');
  const first = artifactManifest(firstDirectory);
  const second = artifactManifest(secondDirectory);
  assertSameArtifacts(first, second);
  proveNodeInstall(firstDirectory);
  provePythonInstall(firstDirectory);

  const receipt = {
    schemaVersion: 1,
    result: 'PASS',
    evaluatedHead: git(['rev-parse', 'HEAD']).trim(),
    dirtyMaterialSha256: dirtyMaterialHash(),
    sourceDateEpoch,
    artifacts: Object.fromEntries([...first.entries()].sort(([a], [b]) => a.localeCompare(b))),
    installProof: {
      node: 'five tarballs installed with npm, imports and CLI help exercised, packages uninstalled',
      python: 'isolated wheel install; missing adapters fail closed; both native adapters join policy hashes, denial and approval; package uninstalled',
    },
  };
  mkdirSync(join(root, 'audits'), { recursive: true });
  writeFileSync(
    join(root, 'audits', 'llmkit-artifact-reproducibility.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(`ARTIFACT_REPRODUCIBILITY PASS (${first.size} bit-identical artifacts + install/uninstall)`);
} finally {
  rmSync(proofRoot, { recursive: true, force: true, maxRetries: 3 });
}
