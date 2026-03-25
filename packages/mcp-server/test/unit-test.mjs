// unit tests: verify tool definitions and handler map integrity
// usage: node packages/mcp-server/test/unit-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const { PROXY_TOOLS, LOCAL_TOOLS, NOTION_TOOLS, HANDLER_MAP } = await import('../dist/tools.js');

test('PROXY_TOOLS has 6 entries', () => {
  assert(PROXY_TOOLS.length === 6, `expected 6, got ${PROXY_TOOLS.length}`);
});

test('LOCAL_TOOLS has 5 entries', () => {
  assert(LOCAL_TOOLS.length === 5, `expected 5, got ${LOCAL_TOOLS.length}`);
});

test('NOTION_TOOLS has 3 entries', () => {
  assert(NOTION_TOOLS.length === 3, `expected 3, got ${NOTION_TOOLS.length}`);
});

test('total tool count is 14', () => {
  const total = PROXY_TOOLS.length + LOCAL_TOOLS.length + NOTION_TOOLS.length;
  assert(total === 14, `expected 14, got ${total}`);
});

test('all tool names start with llmkit_', () => {
  const all = [...PROXY_TOOLS, ...LOCAL_TOOLS, ...NOTION_TOOLS];
  for (const tool of all) {
    assert(tool.name.startsWith('llmkit_'), `${tool.name} does not start with llmkit_`);
  }
});

test('every tool has description and inputSchema', () => {
  const all = [...PROXY_TOOLS, ...LOCAL_TOOLS, ...NOTION_TOOLS];
  for (const tool of all) {
    assert(tool.description, `${tool.name} missing description`);
    assert(tool.inputSchema, `${tool.name} missing inputSchema`);
    assert(tool.inputSchema.type === 'object', `${tool.name} inputSchema type should be object`);
  }
});

test('HANDLER_MAP has entry for every tool', () => {
  const all = [...PROXY_TOOLS, ...LOCAL_TOOLS, ...NOTION_TOOLS];
  for (const tool of all) {
    assert(HANDLER_MAP[tool.name], `${tool.name} missing from HANDLER_MAP`);
    assert(typeof HANDLER_MAP[tool.name] === 'function', `${tool.name} handler should be a function`);
  }
});

test('no extra handlers in HANDLER_MAP', () => {
  const allNames = new Set([...PROXY_TOOLS, ...LOCAL_TOOLS, ...NOTION_TOOLS].map(t => t.name));
  for (const key of Object.keys(HANDLER_MAP)) {
    assert(allNames.has(key), `HANDLER_MAP has extra key: ${key}`);
  }
});

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}: ${e.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
