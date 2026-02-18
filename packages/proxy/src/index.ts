import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { LLMKitError } from '@llmkit/shared';
import type { Env } from './env';
import { auth } from './middleware/auth';
import { budgetCheck } from './middleware/budget';
import { costLogger } from './middleware/logger';
import { providerRouter } from './routes/chat';

const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof LLMKitError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.statusCode as ContentfulStatusCode,
    );
  }
  console.error('unhandled:', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
});

app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }));

app.use('/v1/*', auth());
app.use('/v1/*', budgetCheck());
app.use('/v1/*', costLogger());

app.route('/v1', providerRouter);

export default app;
