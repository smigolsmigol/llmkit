import { Hono } from 'hono';

export const providerRouter = new Hono();

providerRouter.post('/chat/completions', async (c) => {
  const body = await c.req.json();
  const provider = c.req.header('x-llmkit-provider') || 'anthropic';

  // TODO: route to provider, handle fallback chain, stream responses
  return c.json({ message: 'not implemented', provider, model: body.model });
});
