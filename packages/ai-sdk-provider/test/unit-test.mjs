// unit tests for AI SDK provider pure functions
// usage: node packages/ai-sdk-provider/test/unit-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function assertRejects(operation, expected) {
  try {
    await operation();
  } catch (error) {
    assert(error.message.includes(expected), `expected ${expected}, got ${error.message}`);
    return;
  }
  throw new Error(`expected rejection containing ${expected}`);
}

async function withFetch(responder, operation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = responder;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function collect(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

const { createLLMKit, mapFinishReason, parseUsage, flattenPrompt, buildHeaders } = await import('../dist/index.js');

async function captureGenerateRequest(config) {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      content: 'ok',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const model = createLLMKit(config).chat('gpt-4.1');
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    return request;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('createLLMKit uses the canonical hosted API origin', async () => {
  const request = await captureGenerateRequest({ apiKey: 'llmk_test' });
  assert(
    request?.url === 'https://api.llmkit.sh/v1/chat/completions',
    `unexpected URL: ${request?.url}`,
  );
});

test('createLLMKit preserves an explicit self-hosted origin', async () => {
  const request = await captureGenerateRequest({
    apiKey: 'llmk_test',
    baseUrl: 'http://127.0.0.1:8787/',
  });
  assert(
    request?.url === 'http://127.0.0.1:8787/v1/chat/completions',
    `unexpected URL: ${request?.url}`,
  );
});

test('doGenerate maps rich AI SDK options and LLMKit response metadata', async () => {
  let request;
  const result = await withFetch(async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      content: 'done',
      finishReason: 'tool_use',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
      },
      cost: { totalUsd: 0.001 },
      toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    const model = createLLMKit({
      apiKey: 'llmk_test',
      sessionId: 'session-1',
      userId: 'user-1',
      provider: 'anthropic',
      providerKey: 'provider-key',
    }).languageModel('claude-sonnet-4');
    return model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'find it' }] }],
      maxOutputTokens: 128,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      frequencyPenalty: 0.1,
      presencePenalty: 0.3,
      seed: 7,
      stopSequences: ['STOP'],
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'look up a value',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
        { type: 'provider-defined', id: 'ignored' },
      ],
      toolChoice: { type: 'tool', toolName: 'lookup' },
      responseFormat: {
        type: 'json',
        name: 'answer',
        schema: { type: 'object', properties: { value: { type: 'string' } } },
      },
    });
  });

  const body = JSON.parse(request.init.body);
  assert(request.url.endsWith('/v1/chat/completions'), 'generate URL');
  assert(request.init.headers['x-llmkit-session-id'] === 'session-1', 'session header');
  assert(body.model === 'claude-sonnet-4', 'model mapping');
  assert(body.top_p === 0.9 && body.top_k === 20 && body.seed === 7, 'sampling options');
  assert(body.frequency_penalty === 0.1 && body.presence_penalty === 0.3, 'penalties');
  assert(body.stop[0] === 'STOP', 'stop sequence');
  assert(body.tools.length === 1 && body.tools[0].function.name === 'lookup', 'tool mapping');
  assert(body.tool_choice.function.name === 'lookup', 'tool choice');
  assert(body.response_format.json_schema.name === 'answer', 'JSON schema response format');
  assert(result.content.some((part) => part.type === 'text' && part.text === 'done'), 'text result');
  assert(result.content.some((part) => part.type === 'tool-call'), 'tool result');
  assert(result.finishReason.unified === 'tool-calls', 'finish reason');
  assert(result.usage.inputTokens.cacheWrite === 2, 'cache write usage');
  assert(result.providerMetadata.llmkit.totalUsd === 0.001, 'cost metadata');
});

test('doGenerate accepts OpenAI response shape and rejects upstream errors', async () => {
  const openAI = await withFetch(async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: 'openai result',
        tool_calls: [{ id: 'call_2', function: { name: 'calc', arguments: '{"n":2}' } }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => (
    createLLMKit({ apiKey: 'k' }).chat('gpt-4.1').doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      toolChoice: { type: 'auto' },
      responseFormat: { type: 'json' },
    })
  ));
  assert(openAI.content[0].text === 'openai result', 'OpenAI text');
  assert(openAI.content[1].toolName === 'calc', 'OpenAI tool call');
  assert(openAI.usage.inputTokens.total === 5, 'OpenAI usage');

  await withFetch(async () => new Response('upstream refused', { status: 429 }), async () => {
    await assertRejects(
      () => createLLMKit({ apiKey: 'k' }).chat('gpt-4.1').doGenerate({ prompt: [] }),
      'LLMKit 429: upstream refused',
    );
  });
});

test('doStream emits LLMKit text, metadata, usage, and finish parts', async () => {
  const sse = [
    'event: delta',
    'data: {"id":"resp-1","model":"gpt-4.1","text":"hello"}',
    '',
    'event: delta',
    'data: {bad json',
    '',
    'event: done',
    'data: {"finishReason":"stop","usage":{"inputTokens":3,"outputTokens":1},"cost":{"totalUsd":0.01}}',
  ].join('\n');
  const parts = await withFetch(async () => new Response(sse, { status: 200 }), async () => {
    const result = await createLLMKit({ apiKey: 'k' }).chat('gpt-4.1').doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      toolChoice: { type: 'none' },
      responseFormat: { type: 'text' },
    });
    return collect(result.stream);
  });
  assert(parts[0].type === 'stream-start', 'stream start');
  assert(parts.some((part) => part.type === 'response-metadata' && part.id === 'resp-1'), 'metadata');
  assert(parts.some((part) => part.type === 'text-delta' && part.delta === 'hello'), 'text delta');
  const finish = parts.find((part) => part.type === 'finish');
  assert(finish.finishReason.unified === 'stop', 'stream finish');
  assert(finish.providerMetadata.llmkit.totalUsd === 0.01, 'stream cost');
});

test('doStream accumulates OpenAI tool calls across chunks', async () => {
  const sse = [
    'data: {"id":"resp-2","model":"gpt-4.1","choices":[{"delta":{"content":"a"}}]}',
    '',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_3","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}',
    '',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const parts = await withFetch(async () => new Response(sse, { status: 200 }), async () => {
    const result = await createLLMKit({ apiKey: 'k' }).chat('gpt-4.1').doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'required' },
    });
    return collect(result.stream);
  });
  assert(parts.some((part) => part.type === 'tool-input-start' && part.toolName === 'lookup'), 'tool start');
  assert(parts.filter((part) => part.type === 'tool-input-delta').length === 2, 'tool deltas');
  const call = parts.find((part) => part.type === 'tool-call');
  assert(call.input === '{"q":"x"}', `tool input: ${call.input}`);
  assert(parts.some((part) => part.type === 'finish'), 'tool stream finish');
});

test('doStream rejects HTTP errors and missing bodies', async () => {
  await withFetch(async () => new Response('bad gateway', { status: 502 }), async () => {
    await assertRejects(
      () => createLLMKit({ apiKey: 'k' }).chat('gpt').doStream({ prompt: [] }),
      'LLMKit 502: bad gateway',
    );
  });
  await withFetch(async () => new Response(null, { status: 200 }), async () => {
    await assertRejects(
      () => createLLMKit({ apiKey: 'k' }).chat('gpt').doStream({ prompt: [] }),
      'No response body',
    );
  });
});

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

test('flattenPrompt maps images, assistant tools, and structured tool results', () => {
  const result = flattenPrompt([
    {
      role: 'user',
      content: [
        { type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' },
        { type: 'file', mediaType: 'image/jpeg', data: new URL('https://example.test/a.jpg') },
        { type: 'file', mediaType: 'text/plain', data: 'ignored' },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'working' },
        { type: 'tool-call', toolCallId: 'call_4', toolName: 'lookup', input: { q: 'x' } },
      ],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_4',
        output: [
          { type: 'text', value: 'value=' },
          { type: 'json', value: { ok: true } },
          { type: 'error-text', value: 'warning' },
        ],
      }],
    },
  ]);
  assert(result[0].content[0].image_url.url.startsWith('data:image/png;base64,'), 'base64 image');
  assert(result[0].content[1].image_url.url === 'https://example.test/a.jpg', 'URL image');
  assert(result[1].tool_calls[0].function.arguments === '{"q":"x"}', 'assistant tool input');
  assert(result[2].content === 'value={"ok":true}warning', 'structured tool output');
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
