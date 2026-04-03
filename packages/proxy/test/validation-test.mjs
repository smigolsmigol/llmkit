// input validation + sanitization security tests
// tests validateSessionId, validateEndUserId, countToolInvocations,
// assertModelName (path traversal), esc() (XSS), validateBody (prototype pollution)
// usage: node test/validation-test.mjs

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, substringOrCheck, msg) {
  try {
    fn();
    throw new Error(msg || 'expected to throw');
  } catch (err) {
    if (err.message === (msg || 'expected to throw')) throw err;
    if (typeof substringOrCheck === 'string') {
      if (!err.message.includes(substringOrCheck)) {
        throw new Error(`expected error containing "${substringOrCheck}", got: ${err.message}`);
      }
    }
  }
}

// ============================
// RE-IMPLEMENT PURE FUNCTIONS
// ============================

// from budget.ts
function validateSessionId(sessionId) {
  if (sessionId && !/^[\w-]{1,128}$/.test(sessionId)) {
    throw new Error('invalid session ID format');
  }
}

function validateEndUserId(endUserId) {
  if (endUserId && !/^[\w@.+\-]{1,256}$/.test(endUserId)) {
    throw new Error('invalid end user ID format');
  }
}

const IMAGE_CHAR_ESTIMATE = 12_800;

function countInputChars(messages) {
  if (!messages) return 0;
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'text' && block.text) chars += block.text.length;
        else if (block.type === 'image_url') chars += IMAGE_CHAR_ESTIMATE;
      }
    }
  }
  return chars;
}

// from responses.ts
function countToolInvocations(toolCalls) {
  if (!toolCalls?.length) return undefined;
  const counts = new Map();
  for (const tc of toolCalls) {
    const dim = tc.name;
    if (['web_search', 'x_search', 'code_execution', 'code_interpreter', 'attachment_search', 'collections_search', 'file_search'].includes(dim)) {
      counts.set(dim, (counts.get(dim) || 0) + 1);
    }
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([dimension, quantity]) => ({ dimension, quantity }));
}

// from gemini.ts
const MODEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertModelName(model) {
  if (!MODEL_NAME_RE.test(model)) {
    throw new Error(`invalid model name: ${model}`);
  }
}

// from notify.ts
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// from chat.ts
const VALID_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

function validateBody(body) {
  if (!body.model || typeof body.model !== 'string') {
    throw new Error('model is required and must be a string');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages is required and must be a non-empty array');
  }
  for (const msg of body.messages) {
    if (!msg || typeof msg !== 'object') throw new Error('each message must be an object');
    const m = msg;
    if (typeof m.role !== 'string' || !VALID_ROLES.has(m.role)) {
      throw new Error(`message role must be one of: ${[...VALID_ROLES].join(', ')}`);
    }
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content)) throw new Error('message content must be a string or array of content blocks');
    if (m.role === 'system') throw new Error('system messages must have string content');
    for (const block of m.content) {
      if (!block || typeof block !== 'object') throw new Error('each content block must be an object');
      if (block.type === 'text') {
        if (typeof block.text !== 'string') throw new Error('text block must have a text string');
      } else if (block.type === 'image_url') {
        const img = block.image_url;
        if (!img || typeof img.url !== 'string') throw new Error('image_url block must have a url string');
      } else {
        throw new Error(`unknown content block type: ${String(block.type)}`);
      }
    }
  }
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) {
      throw new Error('temperature must be a number between 0 and 2');
    }
  }
  const maxTokens = body.max_tokens ?? body.maxTokens;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || maxTokens < 1 || !Number.isInteger(maxTokens)) {
      throw new Error('max_tokens must be a positive integer');
    }
  }
}

// ============================
// validateSessionId
// ============================

test('sessionId: valid UUID', () => {
  validateSessionId('550e8400-e29b-41d4-a716-446655440000');
});

test('sessionId: valid short alphanumeric', () => {
  validateSessionId('session_123');
});

test('sessionId: valid with underscores and hyphens', () => {
  validateSessionId('my-session_2026-04-01_run-1');
});

test('sessionId: undefined is allowed (optional)', () => {
  validateSessionId(undefined);
});

test('sessionId: empty string is allowed (falsy)', () => {
  validateSessionId('');
});

test('sessionId: max length 128 chars', () => {
  validateSessionId('a'.repeat(128));
});

test('sessionId: 129 chars rejected', () => {
  assertThrows(() => validateSessionId('a'.repeat(129)), 'invalid session ID');
});

test('sessionId: SQL injection attempt', () => {
  assertThrows(() => validateSessionId("'; DROP TABLE requests; --"), 'invalid session ID');
});

test('sessionId: CRLF injection', () => {
  assertThrows(() => validateSessionId('session\r\nX-Admin: true'), 'invalid session ID');
});

test('sessionId: null byte injection', () => {
  assertThrows(() => validateSessionId('session\x00evil'), 'invalid session ID');
});

test('sessionId: spaces not allowed', () => {
  assertThrows(() => validateSessionId('session with spaces'), 'invalid session ID');
});

test('sessionId: path traversal', () => {
  assertThrows(() => validateSessionId('../../etc/passwd'), 'invalid session ID');
});

test('sessionId: unicode not allowed', () => {
  assertThrows(() => validateSessionId('\u{1F680}rocket'), 'invalid session ID');
});

test('sessionId: HTML tags not allowed', () => {
  assertThrows(() => validateSessionId('<script>alert(1)</script>'), 'invalid session ID');
});

// ============================
// validateEndUserId
// ============================

test('endUserId: valid email-like', () => {
  validateEndUserId('user@example.com');
});

test('endUserId: valid with plus addressing', () => {
  validateEndUserId('user+test@example.com');
});

test('endUserId: valid simple ID', () => {
  validateEndUserId('user_12345');
});

test('endUserId: valid dotted path', () => {
  validateEndUserId('org.team.user-1');
});

test('endUserId: undefined is allowed', () => {
  validateEndUserId(undefined);
});

test('endUserId: empty string is allowed', () => {
  validateEndUserId('');
});

test('endUserId: max length 256', () => {
  validateEndUserId('u'.repeat(256));
});

test('endUserId: 257 chars rejected', () => {
  assertThrows(() => validateEndUserId('u'.repeat(257)), 'invalid end user ID');
});

test('endUserId: SQL injection', () => {
  assertThrows(() => validateEndUserId("admin' OR '1'='1"), 'invalid end user ID');
});

test('endUserId: semicolons not allowed', () => {
  assertThrows(() => validateEndUserId('user;rm -rf /'), 'invalid end user ID');
});

test('endUserId: CRLF injection', () => {
  assertThrows(() => validateEndUserId('user\r\nSet-Cookie: admin=true'), 'invalid end user ID');
});

test('endUserId: null byte', () => {
  assertThrows(() => validateEndUserId('user\x00admin'), 'invalid end user ID');
});

test('endUserId: backtick command injection', () => {
  assertThrows(() => validateEndUserId('user`whoami`'), 'invalid end user ID');
});

test('endUserId: curly braces (template injection)', () => {
  assertThrows(() => validateEndUserId('user${7*7}'), 'invalid end user ID');
});

// ============================
// countInputChars
// ============================

test('countInputChars: string messages', () => {
  const messages = [
    { content: 'hello' },
    { content: 'world' },
  ];
  assert(countInputChars(messages) === 10, 'should count 10 chars');
});

test('countInputChars: multimodal with text blocks', () => {
  const messages = [
    { content: [{ type: 'text', text: 'describe this' }] },
  ];
  assert(countInputChars(messages) === 13, 'should count text block chars');
});

test('countInputChars: image_url adds 12800 chars estimate', () => {
  const messages = [
    { content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }] },
  ];
  assert(countInputChars(messages) === 12_800, `expected 12800, got ${countInputChars(messages)}`);
});

test('countInputChars: mixed text + image', () => {
  const messages = [
    { content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:...' } },
    ]},
  ];
  assert(countInputChars(messages) === 13 + 12_800, 'text + image estimate');
});

test('countInputChars: undefined messages -> 0', () => {
  assert(countInputChars(undefined) === 0, 'undefined should return 0');
});

test('countInputChars: empty messages -> 0', () => {
  assert(countInputChars([]) === 0, 'empty array should return 0');
});

test('countInputChars: text block with empty text -> 0 (falsy check)', () => {
  const messages = [{ content: [{ type: 'text', text: '' }] }];
  assert(countInputChars(messages) === 0, 'empty text block should add 0');
});

test('countInputChars: text block with no text field -> 0', () => {
  const messages = [{ content: [{ type: 'text' }] }];
  assert(countInputChars(messages) === 0, 'missing text field should add 0');
});

// ============================
// countToolInvocations
// ============================

test('toolInvocations: all 7 recognized types', () => {
  const tools = [
    { id: '1', name: 'web_search', arguments: '' },
    { id: '2', name: 'x_search', arguments: '' },
    { id: '3', name: 'code_execution', arguments: '' },
    { id: '4', name: 'code_interpreter', arguments: '' },
    { id: '5', name: 'attachment_search', arguments: '' },
    { id: '6', name: 'collections_search', arguments: '' },
    { id: '7', name: 'file_search', arguments: '' },
  ];
  const result = countToolInvocations(tools);
  assert(result, 'should return results');
  assert(result.length === 7, `expected 7 dimensions, got ${result.length}`);
  for (const r of result) {
    assert(r.quantity === 1, `each dimension should have quantity 1, got ${r.quantity} for ${r.dimension}`);
  }
});

test('toolInvocations: multiple of same type', () => {
  const tools = [
    { id: '1', name: 'web_search', arguments: '' },
    { id: '2', name: 'web_search', arguments: '' },
    { id: '3', name: 'web_search', arguments: '' },
  ];
  const result = countToolInvocations(tools);
  assert(result.length === 1, 'should aggregate into one dimension');
  assert(result[0].dimension === 'web_search', 'dimension name');
  assert(result[0].quantity === 3, `expected 3, got ${result[0].quantity}`);
});

test('toolInvocations: unrecognized tools ignored', () => {
  const tools = [
    { id: '1', name: 'my_custom_tool', arguments: '' },
    { id: '2', name: 'another_tool', arguments: '' },
  ];
  const result = countToolInvocations(tools);
  assert(result === undefined, 'unrecognized tools should return undefined');
});

test('toolInvocations: mixed recognized and unrecognized', () => {
  const tools = [
    { id: '1', name: 'web_search', arguments: '' },
    { id: '2', name: 'my_tool', arguments: '' },
    { id: '3', name: 'file_search', arguments: '' },
  ];
  const result = countToolInvocations(tools);
  assert(result.length === 2, 'should only count recognized tools');
});

test('toolInvocations: empty array -> undefined', () => {
  assert(countToolInvocations([]) === undefined, 'empty array should return undefined');
});

test('toolInvocations: undefined -> undefined', () => {
  assert(countToolInvocations(undefined) === undefined, 'undefined should return undefined');
});

test('toolInvocations: null -> undefined', () => {
  assert(countToolInvocations(null) === undefined, 'null should return undefined');
});

// ============================
// assertModelName (PATH TRAVERSAL)
// ============================

test('modelName: valid simple name', () => {
  assertModelName('gemini-pro');
});

test('modelName: valid with dots', () => {
  assertModelName('gemini-1.5-flash');
});

test('modelName: valid with underscore', () => {
  assertModelName('gemini_2.0_flash_001');
});

test('modelName: max length 128', () => {
  assertModelName('a' + 'b'.repeat(127));
});

test('modelName: path traversal ../../etc/passwd', () => {
  assertThrows(() => assertModelName('../../etc/passwd'), 'invalid model name');
});

test('modelName: path traversal ..\\..\\windows\\system32', () => {
  assertThrows(() => assertModelName('..\\..\\windows\\system32'), 'invalid model name');
});

test('modelName: URL-encoded traversal %2e%2e%2f', () => {
  assertThrows(() => assertModelName('%2e%2e%2fetc%2fpasswd'), 'invalid model name');
});

test('modelName: slash in name (would break URL interpolation)', () => {
  assertThrows(() => assertModelName('models/gemini-pro'), 'invalid model name');
});

test('modelName: empty string rejected', () => {
  assertThrows(() => assertModelName(''), 'invalid model name');
});

test('modelName: 129 chars rejected', () => {
  assertThrows(() => assertModelName('a' + 'b'.repeat(128)), 'invalid model name');
});

test('modelName: starts with dot rejected', () => {
  assertThrows(() => assertModelName('.hidden'), 'invalid model name');
});

test('modelName: starts with hyphen rejected', () => {
  assertThrows(() => assertModelName('-gemini'), 'invalid model name');
});

test('modelName: spaces rejected', () => {
  assertThrows(() => assertModelName('gemini pro'), 'invalid model name');
});

test('modelName: newline injection', () => {
  assertThrows(() => assertModelName('gemini\n/admin'), 'invalid model name');
});

test('modelName: null byte', () => {
  assertThrows(() => assertModelName('gemini\x00evil'), 'invalid model name');
});

test('modelName: colon (protocol injection)', () => {
  assertThrows(() => assertModelName('http:evil'), 'invalid model name');
});

test('modelName: query string injection', () => {
  assertThrows(() => assertModelName('gemini?key=stolen'), 'invalid model name');
});

test('modelName: hash fragment injection', () => {
  assertThrows(() => assertModelName('gemini#fragment'), 'invalid model name');
});

// ============================
// esc() HTML ESCAPING (XSS)
// ============================

test('esc: plain text unchanged', () => {
  assert(esc('hello world') === 'hello world', 'plain text should pass through');
});

test('esc: ampersand', () => {
  assert(esc('a&b') === 'a&amp;b', 'should escape &');
});

test('esc: less than', () => {
  assert(esc('a<b') === 'a&lt;b', 'should escape <');
});

test('esc: greater than', () => {
  assert(esc('a>b') === 'a&gt;b', 'should escape >');
});

test('esc: script tag (XSS)', () => {
  const result = esc('<script>alert(1)</script>');
  assert(!result.includes('<script>'), 'should not contain raw script tag');
  assert(result === '&lt;script&gt;alert(1)&lt;/script&gt;', `got: ${result}`);
});

test('esc: img onerror (XSS)', () => {
  const result = esc('<img src=x onerror=alert(1)>');
  assert(!result.includes('<img'), 'should escape img tag');
});

test('esc: nested escaping (double encode prevention)', () => {
  // already-escaped & should get double-escaped (correct behavior for Telegram HTML)
  const result = esc('&amp;');
  assert(result === '&amp;amp;', `double escape: ${result}`);
});

test('esc: all three characters together', () => {
  assert(esc('<>&') === '&lt;&gt;&amp;', 'should escape all three');
});

test('esc: empty string', () => {
  assert(esc('') === '', 'empty should stay empty');
});

test('esc: HTML attributes (event handlers)', () => {
  const result = esc('" onmouseover="alert(1)');
  // esc() only escapes &, <, > - quotes are NOT escaped
  // this is fine for Telegram HTML which only uses these three
  assert(!result.includes('<'), 'should not have unescaped angle brackets');
});

test('esc: repeated special chars', () => {
  assert(esc('<<<>>>') === '&lt;&lt;&lt;&gt;&gt;&gt;', 'should escape all occurrences');
});

// ============================
// validateBody (PROTOTYPE POLLUTION)
// ============================

const validBase = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
};

test('validateBody: valid minimal body passes', () => {
  validateBody(validBase);
});

test('validateBody: missing model', () => {
  assertThrows(() => validateBody({ messages: [{ role: 'user', content: 'hi' }] }), 'model is required');
});

test('validateBody: model is number', () => {
  assertThrows(() => validateBody({ model: 42, messages: [{ role: 'user', content: 'hi' }] }), 'model is required');
});

test('validateBody: empty messages', () => {
  assertThrows(() => validateBody({ model: 'gpt-4o', messages: [] }), 'non-empty array');
});

test('validateBody: messages is string', () => {
  assertThrows(() => validateBody({ model: 'gpt-4o', messages: 'hi' }), 'non-empty array');
});

test('validateBody: invalid role', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'admin', content: 'hi' }] }),
    'message role must be one of'
  );
});

test('validateBody: role injection with __proto__', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: '__proto__', content: 'hi' }] }),
    'message role must be one of'
  );
});

test('validateBody: system message with array content rejected', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'system', content: [{ type: 'text', text: 'hi' }] }] }),
    'system messages must have string content'
  );
});

test('validateBody: unknown content block type', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'audio', data: '...' }] }] }),
    'unknown content block type'
  );
});

test('validateBody: text block without text field', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'text' }] }] }),
    'text block must have a text string'
  );
});

test('validateBody: image_url block without url', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }),
    'image_url block must have a url string'
  );
});

test('validateBody: temperature below 0', () => {
  assertThrows(
    () => validateBody({ ...validBase, temperature: -0.1 }),
    'temperature must be a number'
  );
});

test('validateBody: temperature above 2', () => {
  assertThrows(
    () => validateBody({ ...validBase, temperature: 2.1 }),
    'temperature must be a number'
  );
});

test('validateBody: temperature as string', () => {
  assertThrows(
    () => validateBody({ ...validBase, temperature: '0.5' }),
    'temperature must be a number'
  );
});

test('validateBody: temperature exactly 0 passes', () => {
  validateBody({ ...validBase, temperature: 0 });
});

test('validateBody: temperature exactly 2 passes', () => {
  validateBody({ ...validBase, temperature: 2 });
});

test('validateBody: max_tokens as float rejected', () => {
  assertThrows(
    () => validateBody({ ...validBase, max_tokens: 100.5 }),
    'max_tokens must be a positive integer'
  );
});

test('validateBody: max_tokens = 0 rejected', () => {
  assertThrows(
    () => validateBody({ ...validBase, max_tokens: 0 }),
    'max_tokens must be a positive integer'
  );
});

test('validateBody: max_tokens negative rejected', () => {
  assertThrows(
    () => validateBody({ ...validBase, max_tokens: -1 }),
    'max_tokens must be a positive integer'
  );
});

test('validateBody: max_tokens as string rejected', () => {
  assertThrows(
    () => validateBody({ ...validBase, max_tokens: '100' }),
    'max_tokens must be a positive integer'
  );
});

test('validateBody: max_tokens = 1 passes (minimum)', () => {
  validateBody({ ...validBase, max_tokens: 1 });
});

test('validateBody: message is null', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [null] }),
    'each message must be an object'
  );
});

test('validateBody: message content is number', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 42 }] }),
    'message content must be a string or array'
  );
});

test('validateBody: content block is null', () => {
  assertThrows(
    () => validateBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [null] }] }),
    'each content block must be an object'
  );
});

test('validateBody: all valid roles accepted', () => {
  for (const role of ['system', 'developer', 'user', 'assistant', 'tool']) {
    validateBody({ model: 'gpt-4o', messages: [{ role, content: 'test' }] });
  }
});

// ============================
// PROTOTYPE POLLUTION via blocked fields (chat.ts)
// ============================

// re-implement the blockedFields filter from chat.ts
const blockedFields = new Set([
  'model', 'messages', 'temperature', 'max_tokens', 'maxTokens',
  'tools', 'tool_choice', 'response_format', 'stream', 'stream_options', 'provider',
  'apiKey', 'api_key', 'Authorization', 'authorization', 'secret', 'token',
  'x-api-key', 'x-goog-api-key', 'x-llmkit-provider-key', 'anthropic-version',
  '__proto__', 'constructor', 'prototype',
]);

function filterExtra(body) {
  const extra = {};
  for (const [k, v] of Object.entries(body)) {
    if (!blockedFields.has(k)) extra[k] = v;
  }
  return extra;
}

test('proto pollution: __proto__ filtered from JSON.parse payload', () => {
  // JSON.parse creates __proto__ as an own enumerable property (unlike object literals).
  // The blockedFields check must strip it before passing to the provider.
  const parsed = JSON.parse('{"__proto__": {"isAdmin": true}, "model": "x", "custom": "ok"}');
  const extra = filterExtra(parsed);
  // use Object.hasOwn because `in` checks prototype chain (always true for __proto__)
  assert(!Object.hasOwn(extra, '__proto__'), '__proto__ should be stripped as own property');
  assert(extra.custom === 'ok', 'custom should still pass');
});

test('proto pollution: constructor filtered from JSON.parse payload', () => {
  const parsed = JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}, "model": "x"}');
  const extra = filterExtra(parsed);
  assert(!Object.hasOwn(extra, 'constructor'), 'constructor should be stripped as own property');
});

test('proto pollution: prototype blocked', () => {
  const body = { prototype: { evil: true }, model: 'x' };
  const extra = filterExtra(body);
  assert(!('prototype' in extra), 'prototype should be filtered');
});

test('proto pollution: apiKey blocked (credential leak)', () => {
  const extra = filterExtra({ apiKey: 'sk-stolen', model: 'x' });
  assert(!('apiKey' in extra), 'apiKey should not leak to provider');
});

test('proto pollution: api_key blocked', () => {
  const extra = filterExtra({ api_key: 'sk-stolen', model: 'x' });
  assert(!('api_key' in extra), 'api_key should not leak');
});

test('proto pollution: Authorization blocked', () => {
  const extra = filterExtra({ Authorization: 'Bearer sk-stolen', model: 'x' });
  assert(!('Authorization' in extra), 'Authorization should not leak');
});

test('proto pollution: x-goog-api-key blocked', () => {
  const extra = filterExtra({ 'x-goog-api-key': 'AIza...', model: 'x' });
  assert(!('x-goog-api-key' in extra), 'Google API key should not leak');
});

test('proto pollution: secret blocked', () => {
  const extra = filterExtra({ secret: 'mysecret', model: 'x' });
  assert(!('secret' in extra), 'secret should not leak');
});

test('proto pollution: token blocked', () => {
  const extra = filterExtra({ token: 'mytoken', model: 'x' });
  assert(!('token' in extra), 'token should not leak');
});

test('proto pollution: custom fields pass through', () => {
  const extra = filterExtra({
    model: 'x',
    messages: [],
    top_p: 0.9,
    frequency_penalty: 0.5,
    presence_penalty: 0.3,
    user: 'test',
    seed: 42,
  });
  assert(extra.top_p === 0.9, 'top_p should pass');
  assert(extra.frequency_penalty === 0.5, 'frequency_penalty should pass');
  assert(extra.seed === 42, 'seed should pass');
  assert(!('model' in extra), 'model should be filtered');
  assert(!('messages' in extra), 'messages should be filtered');
});

// ============================
// ALERT WEBHOOK URL VALIDATION (budget.ts sendAlert)
// ============================

// from budget.ts sendAlert: only https:// URLs are called
function isValidWebhookUrl(url) {
  return url.startsWith('https://');
}

test('webhook: https allowed', () => {
  assert(isValidWebhookUrl('https://hooks.slack.com/xxx'), 'https should pass');
});

test('webhook: http blocked', () => {
  assert(!isValidWebhookUrl('http://evil.com/collect'), 'http should be blocked');
});

test('webhook: javascript: blocked', () => {
  assert(!isValidWebhookUrl('javascript:alert(1)'), 'javascript: should be blocked');
});

test('webhook: file:// blocked', () => {
  assert(!isValidWebhookUrl('file:///etc/passwd'), 'file:// should be blocked');
});

test('webhook: data: blocked', () => {
  assert(!isValidWebhookUrl('data:text/html,<script>alert(1)</script>'), 'data: should be blocked');
});

test('webhook: empty string blocked', () => {
  assert(!isValidWebhookUrl(''), 'empty should be blocked');
});

// --- RUN ---

async function run() {
  console.log(`\nrunning ${tests.length} validation + security tests\n`);

  for (const t of tests) {
    try {
      await t.fn();
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
