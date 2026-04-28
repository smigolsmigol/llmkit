// f3dx-bench beacon emission. Mirrors the python f3dx.bench wire format
// at https://github.com/smigolsmigol/f3dx/blob/main/python/f3dx/bench/__init__.py
//
// Default OFF. Enable by setting these in the worker env (wrangler secret):
//   BENCH_ENABLED=1
//   BENCH_INSTALL_ID=<uuid v4 generated locally, registered TOFU on first beacon>
//   BENCH_INSTALL_HMAC=<32-byte hex token, paired with install_id>
//   BENCH_INGEST_URL=<defaults to f3dx-bench-ingest.smigolsmigol.workers.dev>
//
// Wire format is anonymized: ts, install_id, install_hmac, model, provider,
// status_code, latency_ms_total, input_tokens, output_tokens, region,
// latency_ms_to_first_token, cost_usd_estimate. NO prompts, responses,
// API keys, customer-identifying headers, or hostnames cross the wire.
//
// V0 = one install_id for the whole llmkit deployment. V0.2 will key off
// tenantId so per-customer opt-in works through the dashboard toggle.

const DEFAULT_INGEST_URL = "https://f3dx-bench-ingest.smigolsmigol.workers.dev";
const SCHEMA_VERSION = "v1";

export interface BenchEnv {
  BENCH_ENABLED?: string;
  BENCH_INSTALL_ID?: string;
  BENCH_INSTALL_HMAC?: string;
  BENCH_INGEST_URL?: string;
}

export interface BenchBeaconInput {
  model: string;
  provider: string;
  status_code: number;
  latency_ms_total: number;
  input_tokens: number;
  output_tokens: number;
  region?: string;
  latency_ms_to_first_token?: number;
  cost_usd_estimate?: number;
}

export function isBenchEnabled(env: BenchEnv): boolean {
  return (
    env.BENCH_ENABLED === "1" &&
    !!env.BENCH_INSTALL_ID &&
    !!env.BENCH_INSTALL_HMAC
  );
}

export async function emitBeacon(
  env: BenchEnv,
  input: BenchBeaconInput,
): Promise<void> {
  if (!isBenchEnabled(env)) return;

  const url =
    (env.BENCH_INGEST_URL || DEFAULT_INGEST_URL).replace(/\/$/, "") +
    "/v1/beacon";

  const beacon: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    install_id: env.BENCH_INSTALL_ID,
    install_hmac: env.BENCH_INSTALL_HMAC,
    model: input.model,
    provider: input.provider,
    status_code: Math.trunc(input.status_code),
    latency_ms_total: Math.trunc(input.latency_ms_total),
    input_tokens: Math.trunc(input.input_tokens),
    output_tokens: Math.trunc(input.output_tokens),
  };
  if (input.region) beacon.region = input.region;
  if (input.latency_ms_to_first_token != null) {
    beacon.latency_ms_to_first_token = Math.trunc(
      input.latency_ms_to_first_token,
    );
  }
  if (input.cost_usd_estimate != null) {
    beacon.cost_usd_estimate = Number(input.cost_usd_estimate);
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Identify ourselves so the bench Worker's WAF doesn't 1010 us.
        "user-agent": "llmkit-bench/0.0.1 (+https://github.com/smigolsmigol/llmkit)",
      },
      body: JSON.stringify(beacon),
    });
  } catch {
    // Telemetry must never break user code.
  }
}
