// unit tests for AI SDK provider pure functions
// usage: node packages/ai-sdk-provider/test/unit-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const { mapFinishReason, parseUsage, flattenPrompt, buildHeaders } = await import('../dist/index.js');

// mapFinishReason
test('mapFinishReason: stop', () => {
  const r = mapFinishReason('stop');
  assert(r.unified === 'stop', `expected stop, got ${r.unified}`);
  assert(r.raw === 'stop', `raw should be stop`);
});

test('mapFinishReason: end_turn (anthropic)', () => {
  const r = mapFinishReason('end_turn');
  assert(r.unified === 'stop', 'end_turn maps to stop');
});

test('mapFinishReason: length (truncated)', () => {
  const r = mapFinishReason('length');
  assert(r.unified === 'length', `expected length, got ${r.unified}`);
});

test('mapFinishReason: max_tokens (truncated)', () => {
  const r = mapFinishReason('max_tokens');
  assert(r.unified === 'length', `max_tokens should map to length`);
});

test('mapFinishReason: tool_calls', () => {
  const r = mapFinishReason('tool_calls');
  assert(r.unified === 'tool-calls', `expected tool-calls, got ${r.unified}`);
});

test('mapFinishReason: undefined defaults to other', () => {
  const r = mapFinishReason(undefined);
  assert(r.unified === 'other', 'undefined should default to other, not stop');
  assert(r.raw === 'unknown', 'raw should be unknown');
});

test('mapFinishReason: content_filter', () => {
  const r = mapFinishReason('content_filter');
  assert(r.unified === 'content-filter', `expected content-filter`);
});

// parseUsage
test('parseUsage: LLMKit format', () => {
  const u = parseUsage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 });
  assert(u.inputTokens.total === 100, 'inputTokens.total');
  assert(u.outputTokens.total === 50, 'outputTokens.total');
  assert(u.inputTokens.cacheRead === 20, 'cacheRead');
});

test('parseUsage: OpenAI format', () => {
  const u = parseUsage({ prompt_tokens: 200, completion_tokens: 100 });
  assert(u.inputTokens.total === 200, 'prompt_tokens maps to inputTokens');
  assert(u.outputTokens.total === 100, 'completion_tokens maps to outputTokens');
});

test('parseUsage: undefined returns empty', () => {
  const u = parseUsage(undefined);
  assert(u.inputTokens.total === undefined, 'should be undefined');
  assert(u.outputTokens.total === undefined, 'should be undefined');
});

// flattenPrompt
test('flattenPrompt: system message', () => {
  const result = flattenPrompt([{ role: 'system', content: 'you are helpful' }]);
  assert(result[0].role === 'system', 'role should be system');
  assert(result[0].content === 'you are helpful', 'content should match');
});

test('flattenPrompt: single user text part collapsed to string', () => {
  const result = flattenPrompt([{
    role: 'user',
    content: [{ type: 'text', text: 'hello world' }],
  }]);
  assert(result[0].content === 'hello world', `expected "hello world", got "${result[0].content}"`);
});

test('flattenPrompt: multiple user text parts kept as array', () => {
  const result = flattenPrompt([{
    role: 'user',
    content: [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ],
  }]);
  assert(Array.isArray(result[0].content), 'multi-part content stays as array');
  assert(result[0].content.length === 2, 'should have 2 parts');
  assert(result[0].content[0].text === 'hello ', 'first part text');
  assert(result[0].content[1].text === 'world', 'second part text');
});

test('flattenPrompt: assistant message', () => {
  const result = flattenPrompt([{
    role: 'assistant',
    content: [{ type: 'text', text: 'hi there' }],
  }]);
  assert(result[0].role === 'assistant', 'role');
  assert(result[0].content === 'hi there', 'content');
});

test('flattenPrompt: tool message with output array', () => {
  const result = flattenPrompt([{
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'x', output: [{ type: 'text', text: 'result data' }] }],
  }]);
  assert(result[0].role === 'tool', 'role');
  assert(result[0].tool_call_id === 'x', 'tool_call_id');
  assert(result[0].content === 'result data', `expected "result data", got "${result[0].content}"`);
});

test('flattenPrompt: tool message without output defaults to {}', () => {
  const result = flattenPrompt([{
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'y' }],
  }]);
  assert(result[0].role === 'tool', 'role');
  assert(result[0].content === '{}', 'empty output defaults to {}');
});

// buildHeaders
test('buildHeaders: base headers', () => {
  const h = buildHeaders({ apiKey: 'test-key' });
  assert(h['Authorization'] === 'Bearer test-key', 'auth header');
  assert(h['Content-Type'] === 'application/json', 'content type');
  assert(h['x-llmkit-format'] === 'llmkit', 'format header');
});

test('buildHeaders: with all options', () => {
  const h = buildHeaders({
    apiKey: 'k',
    sessionId: 's1',
    userId: 'u1',
    provider: 'anthropic',
    providerKey: 'pk',
  });
  assert(h['x-llmkit-session-id'] === 's1', 'sessionId');
  assert(h['x-llmkit-user-id'] === 'u1', 'userId');
  assert(h['x-llmkit-provider'] === 'anthropic', 'provider');
  assert(h['x-llmkit-provider-key'] === 'pk', 'providerKey');
});

test('buildHeaders: optional fields omitted when empty', () => {
  const h = buildHeaders({ apiKey: 'k' });
  assert(!h['x-llmkit-session-id'], 'no sessionId header');
  assert(!h['x-llmkit-user-id'], 'no userId header');
  assert(!h['x-llmkit-provider'], 'no provider header');
  assert(!h['x-llmkit-provider-key'], 'no providerKey header');
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
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
