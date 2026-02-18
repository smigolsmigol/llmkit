import { Hono } from 'hono';
import { auth } from './middleware/auth';
import { budgetCheck } from './middleware/budget';
import { costLogger } from './middleware/logger';
import { providerRouter } from './routes/chat';

type Bindings = {
  RATE_LIMIT: KVNamespace;
  BUDGET: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// health check - no auth
app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }));

// all /v1/* routes go through the middleware chain
app.use('/v1/*', auth());
app.use('/v1/*', budgetCheck());
app.use('/v1/*', costLogger());

// chat completions
app.route('/v1', providerRouter);

export default app;
