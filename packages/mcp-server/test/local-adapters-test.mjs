import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertClose(actual, expected, message) {
  if (Math.abs(actual - expected) > 1e-12) throw new Error(`${message}: ${actual} != ${expected}`);
}

const root = await mkdtemp(join(tmpdir(), 'llmkit-mcp-adapters-'));
const clineRoot = join(root, 'cline');
const clineTasks = join(clineRoot, 'tasks');
const originalClineDir = process.env.LLMKIT_CLINE_DIR;
const originalWslScan = process.env.LLMKIT_SCAN_WSL;

await mkdir(clineTasks, { recursive: true });
process.env.LLMKIT_CLINE_DIR = clineRoot;
delete process.env.LLMKIT_SCAN_WSL;

const { getSessionCost } = await import('../dist/claude-code.js');
const { clineAdapter } = await import('../dist/adapters/cline.js');

test('Claude transcript parsing ignores malformed data and deduplicates content blocks', async () => {
  const transcript = join(root, 'session-123.jsonl');
  const assistant = (id, input, output, cacheRead, cacheWrite) => JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'claude-sonnet-4-5',
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
    },
  });
  await writeFile(transcript, [
    '{not-json',
    JSON.stringify({ type: 'user', message: { id: 'user-1' } }),
    assistant('msg-1', 1000, 200, 300, 400),
    assistant('msg-1', 1000, 200, 300, 400),
    assistant('msg-2', 500, 100, 0, 0),
  ].join('\n'));

  const result = await getSessionCost(transcript);
  assert(result?.sessionId === 'session-123', 'session ID did not come from the transcript name');
  assert(result.messages === 2, `expected two unique assistant messages, got ${result.messages}`);
  assert(result.totalInput === 1500, `unexpected input total ${result.totalInput}`);
  assert(result.totalOutput === 300, `unexpected output total ${result.totalOutput}`);
  assert(result.totalCacheRead === 300, `unexpected cache read total ${result.totalCacheRead}`);
  assert(result.totalCacheWrite === 400, `unexpected cache write total ${result.totalCacheWrite}`);
  assertClose(result.totalCost, 0.01059, 'unexpected model-bound session cost');
});

test('Cline adapter reads only the explicit directory and keeps full timestamps', async () => {
  const older = join(clineTasks, 'older-task');
  const newer = join(clineTasks, 'newer-task');
  const invalid = join(clineTasks, 'invalid-task');
  await Promise.all([mkdir(older), mkdir(newer), mkdir(invalid)]);

  const taskMessages = (model, cost, tokensIn, tokensOut) => JSON.stringify([
    { ts: 1, type: 'say', say: 'api_req_started', text: JSON.stringify({ model }) },
    { ts: 2, type: 'say', say: 'api_req_finished', text: JSON.stringify({ cost, tokensIn, tokensOut, cacheReads: 25, cacheWrites: 5 }) },
    { ts: 3, type: 'say', say: 'api_req_finished', text: '{malformed' },
  ]);

  const olderFile = join(older, 'ui_messages.json');
  const newerFile = join(newer, 'ui_messages.json');
  await writeFile(olderFile, taskMessages('old-model', 0.25, 100, 20));
  await writeFile(newerFile, taskMessages('new-model', 0.75, 300, 50));
  await writeFile(join(invalid, 'ui_messages.json'), '{malformed');
  await utimes(olderFile, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
  await utimes(newerFile, new Date('2026-02-03T04:05:06.000Z'), new Date('2026-02-03T04:05:06.000Z'));

  assert(await clineAdapter.detect(), 'explicit Cline directory was not detected');
  const current = await clineAdapter.getCurrentSession();
  assert(current?.id === 'newer-task', `unexpected current task ${current?.id}`);
  assert(current.timestamp === '2026-02-03T04:05:06.000Z', `timestamp lost precision: ${current.timestamp}`);
  assert(current.cost === 0.75, `unexpected current cost ${current.cost}`);
  assert(current.topModel === 'new-model', `unexpected current model ${current.topModel}`);

  const projects = await clineAdapter.getProjects();
  assert(projects.length === 1, `expected one explicit Cline source, got ${projects.length}`);
  assert(projects[0]?.sessionCount === 2, `malformed task was counted: ${projects[0]?.sessionCount}`);
  assert(projects[0]?.totalCost === 1, `unexpected aggregate cost ${projects[0]?.totalCost}`);
  assert(projects[0]?.latestTimestamp === '2026-02-03T04:05:06.000Z', 'aggregate timestamp lost precision');
});

test('Cline adapter does not invent cache dollar savings', async () => {
  assert(await clineAdapter.getCacheSavings() === null, 'Cline cache savings must remain unavailable without model-bound pricing');
});

for (const entry of tests) {
  try {
    await entry.fn();
    passed++;
    console.log(`  PASS  ${entry.name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${entry.name}: ${error.message}`);
  }
}

if (originalClineDir === undefined) delete process.env.LLMKIT_CLINE_DIR;
else process.env.LLMKIT_CLINE_DIR = originalClineDir;
if (originalWslScan === undefined) delete process.env.LLMKIT_SCAN_WSL;
else process.env.LLMKIT_SCAN_WSL = originalWslScan;
await rm(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
