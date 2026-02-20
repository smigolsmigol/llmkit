import http from 'node:http';
import https from 'node:https';
import { calculateCost, type ProviderName } from '@llmkit/shared';
import {
  parseOpenAIResponse,
  parseAnthropicResponse,
  parseOpenAIStream,
  parseAnthropicStream,
} from './parsers.js';
import { type RequestRecord, printVerbose } from './summary.js';

interface ProxyTarget {
  host: string;
  provider: ProviderName;
  basePath: string;
}

const OPENAI_TARGET: ProxyTarget = { host: 'api.openai.com', provider: 'openai', basePath: '' };
const ANTHROPIC_TARGET: ProxyTarget = { host: 'api.anthropic.com', provider: 'anthropic', basePath: '' };

function resolveTarget(url: string): ProxyTarget | null {
  if (url.startsWith('/v1/chat/completions')) return OPENAI_TARGET;
  if (url.startsWith('/v1/messages')) return ANTHROPIC_TARGET;
  return null;
}

export interface ProxyHandle {
  port: number;
  records: RequestRecord[];
  stop: () => Promise<void>;
}

export function startProxy(opts: { port: number; verbose: boolean }): Promise<ProxyHandle> {
  const records: RequestRecord[] = [];

  const server = http.createServer((clientReq, clientRes) => {
    const target = resolveTarget(clientReq.url ?? '');
    if (!target) {
      clientRes.writeHead(404, { 'content-type': 'text/plain' });
      clientRes.end('not found');
      return;
    }

    const bodyChunks: Buffer[] = [];
    clientReq.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    clientReq.on('end', () => {
      const body = Buffer.concat(bodyChunks);
      let isStream = false;
      try {
        const parsed = JSON.parse(body.toString());
        isStream = parsed.stream === true;
      } catch {
        // not JSON or parse error - forward anyway
      }

      const headers: Record<string, string | string[]> = {};
      for (const [key, val] of Object.entries(clientReq.headers)) {
        if (!val) continue;
        const k = key.toLowerCase();
        if (k === 'host' || k === 'accept-encoding' || k === 'connection') continue;
        headers[k] = val;
      }
      headers['host'] = target.host;
      headers['accept-encoding'] = 'identity';

      const start = Date.now();

      const proxyReq = https.request(
        {
          hostname: target.host,
          port: 443,
          path: clientReq.url,
          method: clientReq.method,
          headers,
        },
        (proxyRes) => {
          const resHeaders = { ...proxyRes.headers };
          // remove transfer-encoding if we're buffering non-stream responses
          // (we write the full body at once, so chunked encoding would be wrong)
          if (!isStream) delete resHeaders['transfer-encoding'];

          clientRes.writeHead(proxyRes.statusCode ?? 502, resHeaders);

          // only track 2xx responses
          const ok = (proxyRes.statusCode ?? 0) >= 200 && (proxyRes.statusCode ?? 0) < 300;

          if (isStream) {
            const sseChunks: string[] = [];
            proxyRes.on('data', (chunk: Buffer) => {
              clientRes.write(chunk);
              if (ok) sseChunks.push(chunk.toString());
            });
            proxyRes.on('end', () => {
              clientRes.end();
              if (!ok) return;
              const buffer = sseChunks.join('');
              const parsed = target.provider === 'anthropic'
                ? parseAnthropicStream(buffer)
                : parseOpenAIStream(buffer);
              if (parsed) {
                trackUsage(records, parsed, Date.now() - start, opts.verbose);
              }
            });
          } else {
            const resChunks: Buffer[] = [];
            proxyRes.on('data', (chunk: Buffer) => resChunks.push(chunk));
            proxyRes.on('end', () => {
              const resBody = Buffer.concat(resChunks);
              clientRes.end(resBody);
              if (!ok) return;
              const text = resBody.toString();
              const parsed = target.provider === 'anthropic'
                ? parseAnthropicResponse(text)
                : parseOpenAIResponse(text);
              if (parsed) {
                trackUsage(records, parsed, Date.now() - start, opts.verbose);
              }
            });
          }
        },
      );

      proxyReq.on('error', (err) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'content-type': 'text/plain' });
        }
        clientRes.end(`proxy error: ${err.message}`);
      });

      proxyReq.write(body);
      proxyReq.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        port,
        records,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

interface ParsedUsage {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function trackUsage(records: RequestRecord[], usage: ParsedUsage, latencyMs: number, verbose: boolean): void {
  const costUsd = calculateCost(
    usage.provider,
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  );

  const rec: RequestRecord = {
    provider: usage.provider as 'openai' | 'anthropic',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd,
    latencyMs,
  };

  records.push(rec);
  if (verbose) printVerbose(rec);
}
