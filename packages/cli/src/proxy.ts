import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { calculateCost, type ProviderName } from '@f3d1/llmkit-shared';
import {
  type ParsedUsage,
  parseAnthropicResponse,
  parseAnthropicStream,
  parseOpenAIResponse,
  parseOpenAIStream,
} from './parsers.js';
import { printVerbose, type RequestRecord } from './summary.js';

interface ProxyTarget {
  protocol: 'http:' | 'https:';
  hostname: string;
  port?: number;
  provider: ProviderName;
  basePath: string;
  clientBasePath: string;
  tracked: boolean;
}

const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

function inferProvider(host: string): ProviderName {
  if (host.includes('x.ai')) return 'xai';
  if (host.includes('anthropic')) return 'anthropic';
  if (host.includes('groq')) return 'groq';
  if (host.includes('together')) return 'together';
  if (host.includes('deepseek')) return 'deepseek';
  if (host.includes('mistral')) return 'mistral';
  if (host.includes('fireworks')) return 'fireworks';
  if (host.includes('openrouter')) return 'openrouter';
  return 'openai';
}

function targetFromUrl(
  value: string | undefined,
  fallback: string,
  clientBasePath: string,
  tracked: boolean,
  provider?: ProviderName,
): ProxyTarget {
  let parsed: URL;
  try {
    parsed = new URL(value || fallback);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    parsed = new URL(fallback);
  }
  return {
    protocol: parsed.protocol as 'http:' | 'https:',
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    provider: provider ?? inferProvider(parsed.hostname),
    basePath: parsed.pathname.replace(/\/$/, ''),
    clientBasePath,
    tracked,
  };
}

function resolveTarget(url: string, authHeader: string): ProxyTarget | null {
  const openaiUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE;
  const openaiTarget = (tracked: boolean) => targetFromUrl(openaiUrl, 'https://api.openai.com/v1', '/v1', tracked);
  const anthropicTarget = (tracked: boolean) => targetFromUrl(
    process.env.ANTHROPIC_BASE_URL,
    'https://api.anthropic.com',
    '',
    tracked,
    'anthropic',
  );

  // tracked routes: cost tracking enabled
  if (url.startsWith('/v1/chat/completions')) return openaiTarget(true);
  if (url.startsWith('/v1/responses')) return openaiTarget(true);
  if (url.startsWith('/v1/messages')) return anthropicTarget(true);

  // untracked pass-through
  if (authHeader.includes('sk-ant-')) {
    return anthropicTarget(false);
  }
  if (url.startsWith('/v1/')) {
    return openaiTarget(false);
  }
  return null;
}

function upstreamPath(target: ProxyTarget, requestPath: string): string {
  const suffix = target.clientBasePath && requestPath.startsWith(target.clientBasePath)
    ? requestPath.slice(target.clientBasePath.length)
    : requestPath;
  const path = `${target.basePath}${suffix}`;
  return path.startsWith('/') ? path : `/${path}`;
}

export interface ProxyHandle {
  port: number;
  records: RequestRecord[];
  stop: () => Promise<void>;
}

interface ProxyOptions {
  port: number;
  verbose: boolean;
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
}

interface ForwardOptions {
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  verbose: boolean;
}

function requestIsStreaming(body: Buffer): boolean {
  try {
    return JSON.parse(body.toString()).stream === true;
  } catch {
    return false;
  }
}

function upstreamHeaders(clientReq: IncomingMessage, target: ProxyTarget): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(clientReq.headers)) {
    if (!value) continue;
    const normalized = key.toLowerCase();
    if (normalized === 'host' || normalized === 'accept-encoding' || normalized === 'connection') continue;
    headers[normalized] = value;
  }
  const defaultPort = target.protocol === 'https:' ? 443 : 80;
  headers.host = target.port && target.port !== defaultPort
    ? `${target.hostname}:${target.port}`
    : target.hostname;
  headers['accept-encoding'] = 'identity';
  return headers;
}

function responseParser(target: ProxyTarget, isStream: boolean): (body: string) => ParsedUsage | null {
  if (target.provider === 'anthropic') return isStream ? parseAnthropicStream : parseAnthropicResponse;
  return isStream
    ? (body) => parseOpenAIStream(body, target.provider)
    : (body) => parseOpenAIResponse(body, target.provider);
}

function forwardTrackedResponse(
  proxyRes: IncomingMessage,
  clientRes: ServerResponse,
  parse: (body: string) => ParsedUsage | null,
  maxBodyBytes: number,
  onUsage: (usage: ParsedUsage) => void,
): void {
  const chunks: Buffer[] = [];
  let trackedBytes = 0;
  let trackable = true;

  proxyRes.on('data', (chunk: Buffer) => {
    clientRes.write(chunk);
    if (!trackable) return;
    trackedBytes += chunk.length;
    if (trackedBytes <= maxBodyBytes) chunks.push(chunk);
    else {
      trackable = false;
      chunks.length = 0;
    }
  });
  proxyRes.on('end', () => {
    clientRes.end();
    if (!trackable) return;
    const usage = parse(Buffer.concat(chunks).toString());
    if (usage) onUsage(usage);
  });
}

function handleUpstreamResponse(
  proxyRes: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  isStream: boolean,
  startedAt: number,
  records: RequestRecord[],
  options: ForwardOptions,
): void {
  const status = proxyRes.statusCode ?? 502;
  clientRes.writeHead(status, proxyRes.headers);
  const successful = status >= 200 && status < 300;

  if (!target.tracked || !successful) {
    proxyRes.pipe(clientRes);
    return;
  }

  forwardTrackedResponse(
    proxyRes,
    clientRes,
    responseParser(target, isStream),
    options.maxBodyBytes,
    (usage) => trackUsage(records, usage, Date.now() - startedAt, options.verbose),
  );
}

function forwardRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  body: Buffer,
  records: RequestRecord[],
  options: ForwardOptions,
): void {
  const transport = target.protocol === 'https:' ? https : http;
  const startedAt = Date.now();
  const proxyReq = transport.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: upstreamPath(target, clientReq.url ?? '/'),
      method: clientReq.method,
      headers: upstreamHeaders(clientReq, target),
    },
    (proxyRes) => handleUpstreamResponse(
      proxyRes,
      clientRes,
      target,
      requestIsStreaming(body),
      startedAt,
      records,
      options,
    ),
  );

  proxyReq.on('error', (error) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end(`proxy error: ${error.message}`);
    } else {
      clientRes.destroy(error);
    }
  });
  proxyReq.setTimeout(options.upstreamTimeoutMs, () => {
    proxyReq.destroy(new Error('upstream request timed out'));
  });
  proxyReq.end(body);
}

export function startProxy(opts: ProxyOptions): Promise<ProxyHandle> {
  const records: RequestRecord[] = [];
  const options: ForwardOptions = {
    maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    upstreamTimeoutMs: opts.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    verbose: opts.verbose,
  };

  const server = http.createServer((clientReq, clientRes) => {
    const authHeader = (clientReq.headers.authorization ?? clientReq.headers['x-api-key'] ?? '') as string;
    const target = resolveTarget(clientReq.url ?? '', authHeader);
    if (!target) {
      clientRes.writeHead(400, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'could not determine provider from request' }));
      return;
    }

    const declaredLength = Number(clientReq.headers['content-length'] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBodyBytes) {
      clientRes.writeHead(413, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'request body too large' }));
      clientReq.resume();
      return;
    }

    const bodyChunks: Buffer[] = [];
    let bodyBytes = 0;
    let bodyRejected = false;
    clientReq.on('data', (chunk: Buffer) => {
      if (bodyRejected) return;
      bodyBytes += chunk.length;
      if (bodyBytes > options.maxBodyBytes) {
        bodyRejected = true;
        bodyChunks.length = 0;
        clientRes.writeHead(413, { 'content-type': 'application/json' });
        clientRes.end(JSON.stringify({ error: 'request body too large' }));
        return;
      }
      bodyChunks.push(chunk);
    });
    clientReq.on('end', () => {
      if (bodyRejected) return;
      forwardRequest(clientReq, clientRes, target, Buffer.concat(bodyChunks), records, options);
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
