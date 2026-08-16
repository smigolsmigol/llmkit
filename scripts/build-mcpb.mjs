import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = resolve(root, 'packages/mcp-server');
const packageManifest = JSON.parse(readFileSync(resolve(packageDirectory, 'package.json'), 'utf8'));
const bundleManifest = JSON.parse(readFileSync(resolve(packageDirectory, 'manifest.json'), 'utf8'));
const stageRelative = `tmp/mcpb-stage-${process.pid}`;
const stageDirectory = resolve(root, stageRelative);
const bundleEntry = resolve(stageDirectory, 'server/index.js');
const unpackRelative = `tmp/mcpb-unpack-${process.pid}`;
const unpackDirectory = resolve(root, unpackRelative);
const artifact = resolve(packageDirectory, 'mcp-server.mcpb');
const artifactRelative = 'packages/mcp-server/mcp-server.mcpb';
const shouldPack = process.argv.includes('--pack');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--pack');

if (unknownArguments.length > 0) {
  throw new Error(`Unknown MCPB build argument: ${unknownArguments.join(', ')}`);
}

function assertSafeGeneratedPath(path, expectedPrefix) {
  const pathRelative = relative(root, path).replaceAll('\\', '/');
  if (pathRelative.startsWith('../') || !pathRelative.startsWith(expectedPrefix)) {
    throw new Error(`Refusing unsafe generated path: ${path}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${detail}`);
  }
  return result;
}

function pnpm(args) {
  const allArgs = ['pnpm@9.15.4', ...args];
  if (process.platform === 'win32') {
    if (!allArgs.every((arg) => /^[A-Za-z0-9@._:/=-]+$/.test(arg))) {
      throw new Error('Refusing to construct a Windows package command from an unsafe argument.');
    }
    return run(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `corepack ${allArgs.join(' ')}`],
    );
  }
  return run('corepack', allArgs);
}

function collectFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryRelative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(join(directory, entry.name), entryRelative));
    else if (entry.isFile()) files.push(entryRelative);
    else throw new Error(`MCPB stage contains an unsupported entry: ${entryRelative}`);
  }
  return files.sort();
}

function request(child, pending, method, params) {
  const id = pending.nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.requests.delete(id);
      rejectRequest(new Error(`Timed out waiting for MCP ${method}`));
    }, 5000);
    pending.requests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolveRequest(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        rejectRequest(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;

  const exit = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.stdin.end();
  let exited = await Promise.race([
    exit.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 1000)),
  ]);
  if (!exited) {
    child.kill();
    exited = await Promise.race([
      exit.then(() => true),
      new Promise((resolveWait) => setTimeout(() => resolveWait(false), 2000)),
    ]);
  }
  if (!exited) throw new Error('Timed out stopping the staged MCP server.');
}

async function smokeDirectory(directory) {
  const environment = { ...process.env };
  delete environment.LLMKIT_API_KEY;
  delete environment.LLMKIT_PROXY_URL;

  const child = spawn(process.execPath, [resolve(directory, 'server/index.js')], {
    cwd: directory,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = { nextId: 1, requests: new Map() };
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });

  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!Object.hasOwn(message, 'id')) return;
    const waiting = pending.requests.get(message.id);
    if (!waiting) return;
    pending.requests.delete(message.id);
    if (message.error) waiting.reject(new Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  });

  try {
    await request(child, pending, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const result = await request(child, pending, 'tools/list', {});
    const names = new Set(result.tools.map((tool) => tool.name));
    const expectedLocal = [
      'llmkit_local_session',
      'llmkit_local_projects',
      'llmkit_local_cache',
      'llmkit_local_forecast',
      'llmkit_local_agents',
    ];
    if (result.tools.length !== 11 || expectedLocal.some((name) => !names.has(name))) {
      throw new Error(`MCPB desktop smoke exposed ${result.tools.length} tools, expected all 11.`);
    }
    return result.tools.length;
  } catch (error) {
    throw new Error(`${error.message}\n${stderr}`);
  } finally {
    lines.close();
    await stopChild(child);
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

assertSafeGeneratedPath(stageDirectory, 'tmp/mcpb-stage-');
assertSafeGeneratedPath(unpackDirectory, 'tmp/mcpb-unpack-');
assertSafeGeneratedPath(artifact, 'packages/mcp-server/');
if (packageManifest.version !== bundleManifest.version) {
  throw new Error(`MCPB version ${bundleManifest.version} does not match package ${packageManifest.version}.`);
}

try {
  rmSync(stageDirectory, { recursive: true, force: true });
  rmSync(unpackDirectory, { recursive: true, force: true });
  if (shouldPack) rmSync(artifact, { force: true });
  mkdirSync(dirname(bundleEntry), { recursive: true });

  pnpm(['--filter', '@f3d1/llmkit-mcp-server', 'build']);
  await build({
    bundle: true,
    entryPoints: [resolve(packageDirectory, 'dist/index.js')],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'warning',
    outfile: bundleEntry,
    platform: 'node',
    target: 'node18',
    treeShaking: true,
  });

  for (const file of ['manifest.json', 'LICENSE', 'MCP_PRIVACY.md', 'README.md']) {
    copyFileSync(resolve(packageDirectory, file), resolve(stageDirectory, file));
  }
  writeFileSync(resolve(stageDirectory, 'package.json'), `${JSON.stringify({
    name: packageManifest.name,
    private: true,
    type: 'module',
    version: packageManifest.version,
  }, null, 2)}\n`);

  const stagedFiles = collectFiles(stageDirectory);
  const expectedFiles = [
    'LICENSE',
    'MCP_PRIVACY.md',
    'README.md',
    'manifest.json',
    'package.json',
    'server/index.js',
  ];
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected MCPB stage contents: ${stagedFiles.join(', ')}`);
  }

  const toolCount = await smokeDirectory(stageDirectory);
  if (shouldPack) {
    pnpm(['exec', 'mcpb', 'pack', stageRelative, artifactRelative]);
    pnpm(['exec', 'mcpb', 'unpack', artifactRelative, unpackRelative]);
    const unpackedFiles = collectFiles(unpackDirectory);
    if (JSON.stringify(unpackedFiles) !== JSON.stringify(stagedFiles)) {
      throw new Error(`Packed MCPB contents differ from the verified stage: ${unpackedFiles.join(', ')}`);
    }
    const packedToolCount = await smokeDirectory(unpackDirectory);
    if (packedToolCount !== toolCount) {
      throw new Error(`Packed MCPB exposed ${packedToolCount} tools after staging exposed ${toolCount}.`);
    }
    const receipt = {
      artifact: relative(root, artifact).replaceAll('\\', '/'),
      bytes: statSync(artifact).size,
      files: stagedFiles.length,
      package: packageManifest.name,
      sha256: await sha256(artifact),
      tools: toolCount,
      version: packageManifest.version,
    };
    console.log(`MCPB PASS ${JSON.stringify(receipt)}`);
  } else {
    console.log(`MCPB STAGE PASS ${JSON.stringify({
      files: stagedFiles.length,
      package: packageManifest.name,
      tools: toolCount,
      version: packageManifest.version,
    })}`);
  }
} finally {
  rmSync(unpackDirectory, { recursive: true, force: true });
  rmSync(stageDirectory, { recursive: true, force: true });
}
