import { describe, expect, it } from 'vitest';
import app from '../../src/index';

describe('public MCP discovery', () => {
  it('advertises the canonical hosted MCP endpoint', async () => {
    const response = await app.request('/.well-known/mcp/server-card.json');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: 'llmkit',
      url: 'https://api.llmkit.sh/mcp',
      authentication: { type: 'bearer' },
      capabilities: { tools: true },
    });
  });
});
