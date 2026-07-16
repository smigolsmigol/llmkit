import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2];
const semgrepVersion = '1.156.0';
const semgrepImage = `semgrep/semgrep:${semgrepVersion}@sha256:a3d49dc967b8534a6a76628e50c51cbfe33eb7195dc2feab1fdc0f100852c8ef`;
const scanReportPath = join(root, '.cache', 'semgrep-scan.json');
const requiredScannedPaths = [
  'packages/dashboard/src/lib/supabase.ts',
  'packages/proxy/src/middleware/logger.ts',
  'packages/python-sdk/src/llmkit/_client.py',
];

if (!['scan', 'test'].includes(mode)) {
  throw new Error('Usage: node scripts/run-semgrep.mjs <scan|test>');
}

function probe(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

function commandArgs(jsonOutput) {
  return mode === 'test'
    ? ['test', '.semgrep']
    : [
      'scan',
      '--config', '.semgrep/llmkit-security.yml',
      '--config', 'p/security-audit',
      '--config', 'p/secrets',
      '--error',
      '--no-git-ignore',
      '--json-output', jsonOutput,
      '--exclude', '.semgrep/llmkit-security.ts',
      '--exclude', '.cache',
      '--exclude', '.next',
      '--exclude', '.turbo',
      '--exclude', '.venv',
      '--exclude', 'coverage',
      '--exclude', 'dist',
      '--exclude', 'node_modules',
      '--exclude', 'supabase/.temp',
      '.',
    ];
}

function assertScanCoverage() {
  const report = JSON.parse(readFileSync(scanReportPath, 'utf8'));
  const scanned = new Set(
    (report.paths?.scanned ?? []).map((path) => path.replaceAll('\\', '/')),
  );
  const missing = requiredScannedPaths.filter((path) => !scanned.has(path));
  if (scanned.size === 0 || missing.length > 0) {
    throw new Error(
      `Semgrep target coverage failed: scanned=${scanned.size}, missing=${missing.join(',') || 'none'}.`,
    );
  }
  console.log(`SEMGREP_TARGETS PASS (${scanned.size} files, critical paths present)`);
}

if (mode === 'scan') {
  mkdirSync(dirname(scanReportPath), { recursive: true });
  rmSync(scanReportPath, { force: true });
}

const local = probe('semgrep', ['--version']);
if (!local.error && local.status === 0) {
  const version = `${local.stdout}${local.stderr}`.trim();
  if (!version.includes(semgrepVersion)) {
    throw new Error(`Expected Semgrep ${semgrepVersion}, got ${version}.`);
  }
  run('semgrep', commandArgs(scanReportPath));
  if (mode === 'scan') assertScanCoverage();
  console.log(`SEMGREP_${mode.toUpperCase()} PASS (${semgrepVersion})`);
  process.exit(0);
}

const docker = process.platform === 'win32'
  ? join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Docker',
      'Docker',
      'resources',
      'bin',
      'docker.exe',
    )
  : 'docker';
const dockerEnvironment = {
  ...process.env,
  PATH: `${dirname(docker)}${delimiter}${process.env.PATH || ''}`,
};
const gitMetadataPath = join(root, '.git');
const linkedWorktreeMask = existsSync(gitMetadataPath) && lstatSync(gitMetadataPath).isFile()
  ? ['--volume', '/dev/null:/src/.git:ro']
  : [];
if (!existsSync(docker) && process.platform === 'win32') {
  throw new Error('Semgrep and Docker are both unavailable. Run pnpm quality:bootstrap.');
}

const image = probe(docker, ['image', 'inspect', semgrepImage], { env: dockerEnvironment });
if (image.status !== 0) {
  throw new Error(`Pinned image ${semgrepImage} is missing. Run pnpm quality:bootstrap.`);
}

run(docker, [
  'run',
  '--rm',
  '--volume', `${root}:/src`,
  // A linked-worktree .git file points to a host-only path that is invalid inside Linux.
  ...linkedWorktreeMask,
  '--workdir', '/src',
  semgrepImage,
  'semgrep',
  ...commandArgs('/src/.cache/semgrep-scan.json'),
], { env: dockerEnvironment });
if (mode === 'scan') assertScanCoverage();
console.log(`SEMGREP_${mode.toUpperCase()} PASS (${semgrepImage})`);
