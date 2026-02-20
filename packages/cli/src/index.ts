#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { startProxy } from './proxy.js';
import { printSummary } from './summary.js';

interface CliOpts {
  port: number;
  verbose: boolean;
  json: boolean;
  command: string[];
}

function parseArgs(): CliOpts {
  const argv = process.argv.slice(2);
  const dashIdx = argv.indexOf('--');

  if (dashIdx === -1 || dashIdx === argv.length - 1) {
    process.stderr.write(
      'Usage: npx @llmkit/cli [--port N] [--verbose] [--json] -- <command> [args...]\n' +
      '\nWraps any command, intercepts OpenAI/Anthropic API calls, prints cost summary.\n' +
      '\nExample: npx @llmkit/cli -- python my_agent.py\n',
    );
    process.exit(1);
  }

  const flags = argv.slice(0, dashIdx);
  const command = argv.slice(dashIdx + 1);

  let port = 0;
  let verbose = false;
  let json = false;

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--port' && flags[i + 1]) {
      port = parseInt(flags[++i]!, 10);
    } else if (flag === '--verbose' || flag === '-v') {
      verbose = true;
    } else if (flag === '--json') {
      json = true;
    }
  }

  return { port, verbose, json, command };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const proxy = await startProxy({ port: opts.port, verbose: opts.verbose });
  const startTime = Date.now();

  const env = {
    ...process.env,
    OPENAI_BASE_URL: `http://127.0.0.1:${proxy.port}/v1`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
  };

  const useShell = process.platform === 'win32';
  const child = spawn(opts.command[0]!, opts.command.slice(1), {
    stdio: 'inherit',
    env,
    shell: useShell,
  });

  let exiting = false;

  const cleanup = async (code: number): Promise<void> => {
    if (exiting) return;
    exiting = true;
    await proxy.stop();
    printSummary(proxy.records, opts.json, Date.now() - startTime);
    process.exit(code);
  };

  child.on('exit', (code) => {
    cleanup(code ?? 1);
  });

  child.on('error', (err) => {
    process.stderr.write(`failed to start command: ${err.message}\n`);
    cleanup(1);
  });

  // forward signals to child - let it exit gracefully, then we clean up
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      if (child.exitCode === null) {
        child.kill(sig);
      }
    });
  }
}

main().catch((err) => {
  process.stderr.write(`llmkit: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
