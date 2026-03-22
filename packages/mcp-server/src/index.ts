#!/usr/bin/env node
import { startServer } from './server.js';

if (process.argv.includes('--hook')) {
  import('./hook.js').then(m => m.runHook()).catch(() => process.exit(1));
} else {
  startServer().catch((err) => {
    console.error('llmkit mcp server failed to start:', err);
    process.exit(1);
  });
}
