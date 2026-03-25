// integration test: full MCP protocol via InMemoryTransport
// verifies the server registers tools and handles requests correctly
// usage: node packages/mcp-server/test/integration-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { registerTools } = await import('../dist/tools.js');

let client;
let server;

// setup: create server + client via InMemoryTransport
async function setup() {
  server = new Server(
    { name: 'llmkit-test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
}

await setup();

test('client connects successfully', () => {
  assert(client, 'client should exist');
});

test('tools/list returns tools', async () => {
  const result = await client.listTools();
  assert(result.tools.length >= 11, `expected 11+ tools, got ${result.tools.length}`);
});

test('every tool has name, description, inputSchema', async () => {
  const result = await client.listTools();
  for (const tool of result.tools) {
    assert(tool.name, 'tool missing name');
    assert(tool.description, `${tool.name} missing description`);
    assert(tool.inputSchema, `${tool.name} missing inputSchema`);
  }
});

test('all tool names start with llmkit_', async () => {
  const result = await client.listTools();
  for (const tool of result.tools) {
    assert(tool.name.startsWith('llmkit_'), `${tool.name} does not start with llmkit_`);
  }
});

test('llmkit_health without API key returns error', async () => {
  const result = await client.callTool({ name: 'llmkit_health', arguments: {} });
  const text = result.content[0]?.text ?? '';
  assert(text.includes('LLMKIT_API_KEY'), `expected API key error, got: ${text.slice(0, 100)}`);
});

test('unknown tool returns error content', async () => {
  const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
  const hasError = result.isError || result.content?.some(c => c.text?.includes('Unknown'));
  assert(hasError, 'should return error for unknown tool');
});

test('local session tool returns structured content', async () => {
  const result = await client.callTool({ name: 'llmkit_local_session', arguments: {} });
  assert(result.content, 'should have content');
  assert(result.content.length > 0, 'should have at least one content block');
});

// run
for (const t of tests) {
  try {
    await t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}: ${e.message}`);
  }
}

await client.close();
await server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
