// CLI response parser tests
// usage: node test/parser-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const {
  parseOpenAIResponse,
  parseAnthropicResponse,
  parseOpenAIStream,
  parseAnthropicStream,
} = await import('../dist/parsers.js');

// ============================
// parseOpenAIResponse
// ============================

test('parseOpenAIResponse: valid response', () => {
  const body = JSON.stringify({
    model: 'gpt-4o-2024-08-06',
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
  const r = parseOpenAIResponse(body);
  assert(r !== null, 'should parse');
  assert(r.provider === 'openai', `provider: ${r.provider}`);
  assert(r.model === 'gpt-4o-2024-08-06', `model: ${r.model}`);
  assert(r.inputTokens === 100, `input: ${r.inputTokens}`);
  assert(r.outputTokens === 50, `output: ${r.outputTokens}`);
  assert(r.cacheReadTokens === 0, 'no cache tokens');
});

test('parseOpenAIResponse: missing usage -> null', () => {
  const r = parseOpenAIResponse(JSON.stringify({ model: 'gpt-4o' }));
  assert(r === null, 'should return null without usage');
});

test('parseOpenAIResponse: malformed JSON -> null', () => {
  assert(parseOpenAIResponse('{bad') === null, 'should return null');
});

test('parseOpenAIResponse: empty string -> null', () => {
  assert(parseOpenAIResponse('') === null, 'should return null');
});

test('parseOpenAIResponse: missing model defaults to unknown', () => {
  const body = JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const r = parseOpenAIResponse(body);
  assert(r.model === 'unknown', `model: ${r.model}`);
});

// ============================
// parseAnthropicResponse
// ============================

test('parseAnthropicResponse: valid response with cache', () => {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    usage: {
      input_tokens: 200,
      output_tokens: 80,
      cache_read_input_tokens: 150,
      cache_creation_input_tokens: 50,
    },
  });
  const r = parseAnthropicResponse(body);
  assert(r !== null, 'should parse');
  assert(r.provider === 'anthropic', `provider: ${r.provider}`);
  assert(r.model === 'claude-sonnet-4-20250514', `model: ${r.model}`);
  assert(r.inputTokens === 200, `input: ${r.inputTokens}`);
  assert(r.outputTokens === 80, `output: ${r.outputTokens}`);
  assert(r.cacheReadTokens === 150, `cacheRead: ${r.cacheReadTokens}`);
  assert(r.cacheWriteTokens === 50, `cacheWrite: ${r.cacheWriteTokens}`);
});

test('parseAnthropicResponse: no cache tokens -> 0', () => {
  const body = JSON.stringify({
    model: 'claude-haiku-3-5-20241022',
    usage: { input_tokens: 50, output_tokens: 20 },
  });
  const r = parseAnthropicResponse(body);
  assert(r.cacheReadTokens === 0, 'cache read should be 0');
  assert(r.cacheWriteTokens === 0, 'cache write should be 0');
});

test('parseAnthropicResponse: malformed -> null', () => {
  assert(parseAnthropicResponse('not json') === null, 'should return null');
});

// ============================
// parseOpenAIStream
// ============================

test('parseOpenAIStream: final chunk with usage', () => {
  const buffer = [
    'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"delta":{"content":"hi"}}]}',
    'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":8}}',
    'data: [DONE]',
  ].join('\n');

  const r = parseOpenAIStream(buffer);
  assert(r !== null, 'should parse stream');
  assert(r.provider === 'openai', `provider: ${r.provider}`);
  assert(r.model === 'gpt-4o', `model: ${r.model}`);
  assert(r.inputTokens === 15, `input: ${r.inputTokens}`);
  assert(r.outputTokens === 8, `output: ${r.outputTokens}`);
});

test('parseOpenAIStream: no usage chunk -> null', () => {
  const buffer = [
    'data: {"model":"gpt-4o","choices":[{"delta":{"content":"hello"}}]}',
    'data: [DONE]',
  ].join('\n');

  const r = parseOpenAIStream(buffer);
  assert(r === null, 'should return null without usage');
});

test('parseOpenAIStream: empty input -> null', () => {
  assert(parseOpenAIStream('') === null, 'should return null');
});

test('parseOpenAIStream: handles partial JSON gracefully', () => {
  const buffer = [
    'data: {"model":"gpt-4o","choices"',
    'data: {"model":"gpt-4o","usage":{"prompt_tokens":10,"completion_tokens":5}}',
    'data: [DONE]',
  ].join('\n');

  const r = parseOpenAIStream(buffer);
  assert(r !== null, 'should still parse valid chunks');
  assert(r.inputTokens === 10, `input: ${r.inputTokens}`);
});

// ============================
// parseAnthropicStream
// ============================

test('parseAnthropicStream: message_start + message_delta', () => {
  const buffer = [
    'event: message_start',
    'data: {"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"cache_read_input_tokens":50,"cache_creation_input_tokens":25}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"text":"hello"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":42}}',
  ].join('\n');

  const r = parseAnthropicStream(buffer);
  assert(r !== null, 'should parse');
  assert(r.provider === 'anthropic', `provider: ${r.provider}`);
  assert(r.model === 'claude-sonnet-4-20250514', `model: ${r.model}`);
  assert(r.inputTokens === 100, `input: ${r.inputTokens}`);
  assert(r.outputTokens === 42, `output: ${r.outputTokens}`);
  assert(r.cacheReadTokens === 50, `cacheRead: ${r.cacheReadTokens}`);
  assert(r.cacheWriteTokens === 25, `cacheWrite: ${r.cacheWriteTokens}`);
});

test('parseAnthropicStream: empty -> null', () => {
  assert(parseAnthropicStream('') === null, 'should return null');
});

test('parseAnthropicStream: no data lines -> null', () => {
  const buffer = 'event: ping\n\nevent: error\n';
  assert(parseAnthropicStream(buffer) === null, 'should return null');
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} parser tests\n`);

  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length}\n`);
  if (failed > 0) process.exit(1);
}

run();
