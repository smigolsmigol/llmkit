#!/usr/bin/env node
import { startServer } from './server.js';

startServer().catch((err) => {
  console.error('llmkit mcp server failed to start:', err);
  process.exit(1);
});
