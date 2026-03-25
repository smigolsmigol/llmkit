// smoke tests: verify the AI SDK provider imports and creates correctly
// usage: node packages/ai-sdk-provider/test/smoke-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const mod = await import('../dist/index.js');

test('createLLMKit is exported and is a function', () => {
  assert(typeof mod.createLLMKit === 'function', 'createLLMKit should be a function');
});

test('creates provider with chat and languageModel methods', () => {
  const provider = mod.createLLMKit({ apiKey: 'test-key' });
  assert(typeof provider.chat === 'function', 'should have chat method');
  assert(typeof provider.languageModel === 'function', 'should have languageModel method');
});

test('chat returns LanguageModelV3 shape', () => {
  const provider = mod.createLLMKit({ apiKey: 'test-key' });
  const model = provider.chat('gpt-4o-mini');
  assert(model.specificationVersion === 'v3', 'should be v3');
  assert(model.provider === 'llmkit', 'provider should be llmkit');
  assert(model.modelId === 'gpt-4o-mini', 'modelId should match');
  assert(typeof model.doGenerate === 'function', 'should have doGenerate');
  assert(typeof model.doStream === 'function', 'should have doStream');
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
