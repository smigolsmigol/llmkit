#!/usr/bin/env python3
"""LLMKit Stack Audit - security probes, cost accuracy, attack surface analysis.

Penetration-style audit for the full LLMKit stack. Probes auth bypass,
injection vectors, budget enforcement, rate limits, cost drift, and
information leakage. Saves timestamped reports for regression tracking.

Usage:
    python scripts/audit.py                         # full audit
    python scripts/audit.py -s injection            # one section
    python scripts/audit.py --diff audits/prev.json # compare runs
    python scripts/audit.py --json                  # CI mode

Env vars:
    OPENAI_API_KEY        - enables cost accuracy probes
    ANTHROPIC_API_KEY     - enables anthropic cost probes
    LLMKIT_API_KEY        - enables proxy, budget, rate limit probes
    LLMKIT_PROXY_URL      - target proxy (default: prod)
    LLMKIT_DASHBOARD_URL  - target dashboard (default: prod)
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path

_sdk_src = Path(__file__).resolve().parent.parent / "packages" / "python-sdk" / "src"
if _sdk_src.exists():
    sys.path.insert(0, str(_sdk_src))

from llmkit import CostInfo, tracked, tracked_async
from llmkit._pricing import _FLAT, _PRICING, calculate_cost, lookup_pricing

PROXY = os.environ.get("LLMKIT_PROXY_URL", "https://llmkit-proxy.smigolsmigol.workers.dev")
DASHBOARD = os.environ.get("LLMKIT_DASHBOARD_URL", "https://dashboard-two-zeta-54.vercel.app")
AUDITS_DIR = Path(__file__).resolve().parent.parent / "audits"

OPENAI_MODEL = "gpt-4o-mini"
ANTHROPIC_MODEL = "claude-3-haiku-20240307"
PROBE_PROMPT = "Say 'ok' and nothing else."


# -- Severity & output primitives -------------------------------------------

class Sev:
    CRIT = "CRIT"
    HIGH = "HIGH"
    MED = "MED"
    LOW = "LOW"
    INFO = "INFO"
    PASS = "PASS"

_SEV_ORDER = {Sev.CRIT: 0, Sev.HIGH: 1, Sev.MED: 2, Sev.LOW: 3, Sev.INFO: 4, Sev.PASS: 5}

def _tty() -> bool:
    return sys.stdout.isatty()

def _c(code: int, t: str) -> str:
    return f"\033[{code}m{t}\033[0m" if _tty() else t

def _red(t: str) -> str: return _c(31, t)
def _green(t: str) -> str: return _c(32, t)
def _yellow(t: str) -> str: return _c(33, t)
def _cyan(t: str) -> str: return _c(36, t)
def _magenta(t: str) -> str: return _c(35, t)
def _dim(t: str) -> str: return _c(90, t)
def _bold(t: str) -> str: return _c(1, t)
def _white(t: str) -> str: return _c(37, t)

_SEV_COLOR = {
    Sev.CRIT: lambda t: _c(41, _c(1, f" {t} ")),  # red bg
    Sev.HIGH: lambda t: _red(_bold(f" {t} ")),
    Sev.MED: lambda t: _yellow(f" {t}  "),
    Sev.LOW: lambda t: _cyan(f" {t}  "),
    Sev.INFO: lambda t: _dim(f" {t} "),
    Sev.PASS: lambda t: _green(f" {t} "),
}

def _mask(key: str) -> str:
    if len(key) <= 8:
        return key[:2] + "..." + key[-2:]
    return key[:6] + "..." + key[-4:]


@dataclass
class Finding:
    section: str
    name: str
    severity: str
    detail: str = ""
    latency_ms: float = 0
    cost_usd: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    skipped: bool = False
    meta: dict = field(default_factory=dict)


class Audit:
    def __init__(self, verbose: bool = False, json_out: bool = False) -> None:
        self.findings: list[Finding] = []
        self.verbose = verbose
        self.json_out = json_out
        self._section = ""
        self._t0 = time.perf_counter()

    def section(self, name: str) -> None:
        self._section = name
        if not self.json_out:
            print(f"\n  {_bold(_white(f'[ {name.upper()} ]'))}")

    def _add(self, name: str, sev: str, detail: str = "", skipped: bool = False, **kw) -> Finding:
        f = Finding(self._section, name, sev, detail, skipped=skipped, **kw)
        self.findings.append(f)
        if not self.json_out:
            tag = _SEV_COLOR.get(sev, lambda t: t)(sev)
            parts = [f"  {tag}  {name:<32}"]
            if detail:
                parts.append(f" {_dim(detail)}")
            if f.cost_usd > 0:
                parts.append(f"  {_dim('$')}{f.cost_usd:.6f}")
            if f.latency_ms > 0:
                parts.append(f"  {f.latency_ms:.0f}ms")
            print("".join(parts))
            if self.verbose and f.meta:
                for k, v in f.meta.items():
                    print(f"           {_dim(k)}: {v}")
        return f

    def passed(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.PASS, detail, **kw)

    def info(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.INFO, detail, **kw)

    def low(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.LOW, detail, **kw)

    def med(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.MED, detail, **kw)

    def high(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.HIGH, detail, **kw)

    def crit(self, name: str, detail: str = "", **kw) -> Finding:
        return self._add(name, Sev.CRIT, detail, **kw)

    def skip(self, name: str, reason: str) -> Finding:
        return self._add(name, Sev.INFO, reason, skipped=True)

    def elapsed(self) -> float:
        return time.perf_counter() - self._t0

    def by_severity(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for f in self.findings:
            if not f.skipped:
                counts[f.severity] = counts.get(f.severity, 0) + 1
        return counts

    @property
    def total_cost(self) -> float:
        return sum(f.cost_usd for f in self.findings)

    @property
    def worst(self) -> str:
        active = [f.severity for f in self.findings if not f.skipped and f.severity != Sev.PASS]
        if not active:
            return Sev.PASS
        return min(active, key=lambda s: _SEV_ORDER.get(s, 99))

    def summary_dict(self) -> dict:
        return {
            "target": PROXY,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "elapsed_s": round(self.elapsed(), 1),
            "total_cost_usd": round(self.total_cost, 8),
            "severity_counts": self.by_severity(),
            "worst_severity": self.worst,
            "findings": [asdict(f) for f in self.findings],
        }


# -- HTTP helper ------------------------------------------------------------

def _http(method: str, url: str, headers: dict | None = None,
          body: bytes | None = None, timeout: int = 15) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:
        return 0, {}, str(e).encode(), (time.perf_counter() - t0) * 1000


def _post_chat(headers: dict, body: dict, timeout: int = 15) -> tuple[int, dict, bytes, float]:
    return _http("POST", f"{PROXY}/v1/chat/completions",
                 {**headers, "Content-Type": "application/json"},
                 json.dumps(body).encode(), timeout)


# -- RECON ------------------------------------------------------------------

def probe_recon(a: Audit) -> None:
    a.section("recon")

    # TLS fingerprint
    try:
        host = PROXY.replace("https://", "").split("/")[0]
        ctx = ssl.create_default_context()
        with ctx.wrap_socket(socket.create_connection((host, 443), timeout=5), server_hostname=host) as sock:
            proto = sock.version()
            cipher = sock.cipher()
            a.info("tls version", f"{proto}, {cipher[0] if cipher else '?'}")
    except Exception as exc:
        a.med("tls version", f"probe failed: {exc}")

    # server headers
    status, hdrs, _, ms = _http("GET", f"{PROXY}/health")
    server = hdrs.get("Server", hdrs.get("server", ""))
    powered = hdrs.get("X-Powered-By", hdrs.get("x-powered-by", ""))
    cf_ray = hdrs.get("Cf-Ray", hdrs.get("cf-ray", ""))

    a.info("server fingerprint", f"server={server or 'none'}, powered={powered or 'none'}", latency_ms=ms)
    if cf_ray:
        a.info("infrastructure", f"cloudflare (ray: {cf_ray[:12]}...)")

    # enumerate endpoints
    for path in ["/health", "/v1/chat/completions", "/v1/models", "/.env", "/admin", "/../etc/passwd"]:
        status, _, _, ms = _http("GET", f"{PROXY}{path}")
        a.info(f"GET {path}", f"{status}", latency_ms=ms)


# -- AUTH -------------------------------------------------------------------

def probe_auth(a: Audit) -> None:
    a.section("auth")

    # no auth header
    status, _, body, ms = _post_chat({}, {"model": "gpt-4o", "messages": []})
    if status in (401, 403):
        a.passed("missing auth -> reject", f"{status}", latency_ms=ms)
    else:
        a.high("missing auth -> reject", f"expected 401/403, got {status}", latency_ms=ms)

    # garbage key
    status, _, body, ms = _post_chat({"Authorization": "Bearer garbage_key_1234"}, {"model": "gpt-4o", "messages": []})
    if status in (401, 403):
        a.passed("invalid key -> reject", f"{status}", latency_ms=ms)
    else:
        a.high("invalid key -> reject", f"expected 401/403, got {status}", latency_ms=ms)

    # key format probes
    for label, key in [
        ("empty bearer", "Bearer "),
        ("sql in key", "Bearer ' OR 1=1--"),
        ("null bytes", "Bearer \x00\x00\x00"),
        ("oversized key", "Bearer " + "A" * 10000),
    ]:
        status, _, body, ms = _post_chat({"Authorization": key}, {"model": "x", "messages": []})
        decoded = body.decode("utf-8", errors="replace").lower()
        leaks = [w for w in ["stack", "traceback", "exception", "at object", "node_modules", "postgres"] if w in decoded]
        if status in (400, 401, 403) and not leaks:
            a.passed(label, f"{status}, no leak", latency_ms=ms)
        elif leaks:
            a.high(label, f"{status}, leaked: {leaks}", latency_ms=ms)
        else:
            a.med(label, f"unexpected {status}", latency_ms=ms)

    # check error body doesn't contain key echo
    status, _, body, ms = _post_chat({"Authorization": "Bearer secret_canary_token"}, {"model": "x", "messages": []})
    decoded = body.decode("utf-8", errors="replace")
    if "secret_canary_token" in decoded:
        a.high("key echo in error", "API key reflected in error response")
    else:
        a.passed("key echo in error", "key not reflected")


# -- INJECTION --------------------------------------------------------------

def probe_injection(a: Audit) -> None:
    a.section("injection")

    llmkit_key = os.environ.get("LLMKIT_API_KEY", "")
    auth = {"Authorization": f"Bearer {llmkit_key}"} if llmkit_key else {"Authorization": "Bearer probe_key"}

    # session ID injection
    payloads = [
        ("sqli in session", '"; DROP TABLE requests;--'),
        ("xss in session", '<script>alert(1)</script>'),
        ("path traversal session", '../../../etc/passwd'),
        ("null byte session", 'session\x00evil'),
        ("oversized session", 'A' * 500),
        ("unicode session", '\u202e\u0000\ufeff'),
    ]

    for label, session_id in payloads:
        status, _, body, ms = _post_chat(
            {**auth, "x-llmkit-session-id": session_id},
            {"model": OPENAI_MODEL, "messages": [{"role": "user", "content": "hi"}]},
        )
        decoded = body.decode("utf-8", errors="replace")

        if status == 0:
            a.passed(label, "blocked by http client (never sent)", latency_ms=ms)
        elif status == 400:
            a.passed(label, f"rejected ({status})", latency_ms=ms)
        elif status in (401, 403):
            a.passed(label, f"auth blocked first ({status})", latency_ms=ms)
        elif session_id in decoded:
            a.high(label, f"payload reflected in response!", latency_ms=ms)
        else:
            a.low(label, f"accepted ({status}) but not reflected", latency_ms=ms)

    # header injection (CRLF)
    status, _, body, ms = _http(
        "POST", f"{PROXY}/v1/chat/completions",
        {"Authorization": auth.get("Authorization", ""), "Content-Type": "application/json",
         "X-Custom": "value\r\nX-Injected: true"},
        json.dumps({"model": "gpt-4o", "messages": []}).encode(),
    )
    if status == 0:
        a.passed("crlf header injection", "blocked by http client (never sent)", latency_ms=ms)
    elif status in (400, 401, 403):
        a.passed("crlf header injection", f"rejected ({status})", latency_ms=ms)
    else:
        a.med("crlf header injection", f"not rejected ({status})", latency_ms=ms)

    # model name injection
    evil_models = ["../../etc/passwd", "gpt-4o; rm -rf /", "{{7*7}}", "${env.SECRET}"]
    for model in evil_models:
        status, _, body, ms = _post_chat(auth, {"model": model, "messages": [{"role": "user", "content": "hi"}]})
        decoded = body.decode("utf-8", errors="replace")
        if status in (400, 401, 403, 404, 422):
            a.passed(f"model: {model[:25]}", f"rejected ({status})", latency_ms=ms)
        else:
            a.low(f"model: {model[:25]}", f"accepted ({status})", latency_ms=ms)

    # JSON body attacks
    evil_bodies = [
        ("malformed json", b"not json at all"),
        ("nested bomb", json.dumps({"a": {"b": {"c": {"d": {"e": {"f": "deep"}}}}}}).encode()),
        ("huge body", b'{"model":"x","messages":[' + b'{"role":"user","content":"x"},' * 5000 + b']}'),
    ]
    for label, body_bytes in evil_bodies:
        status, _, resp_body, ms = _http(
            "POST", f"{PROXY}/v1/chat/completions",
            {**auth, "Content-Type": "application/json"}, body_bytes,
        )
        decoded = resp_body.decode("utf-8", errors="replace").lower()
        leaks = [w for w in ["stack", "traceback", "unhandled", "internal server"] if w in decoded]
        if status in (400, 401, 403, 413, 422) and not leaks:
            a.passed(label, f"{status}, clean error", latency_ms=ms)
        elif leaks:
            a.med(label, f"{status}, leaked: {leaks}", latency_ms=ms)
        else:
            a.low(label, f"{status}", latency_ms=ms)


# -- COST ACCURACY ----------------------------------------------------------

def probe_cost(a: Audit) -> None:
    a.section("cost accuracy")

    has_openai = bool(os.environ.get("OPENAI_API_KEY"))
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))

    if has_openai:
        for label, fn in [("openai/sync", _cost_openai_sync), ("openai/stream", _cost_openai_stream),
                          ("openai/async", _cost_openai_async)]:
            try:
                fn(a)
            except Exception as exc:
                a.med(label, f"probe failed: {exc}")
    else:
        a.skip("openai/*", "OPENAI_API_KEY not set")

    if has_anthropic:
        for label, fn in [("anthropic/sync", _cost_anthropic_sync), ("anthropic/stream", _cost_anthropic_stream),
                          ("anthropic/async", _cost_anthropic_async)]:
            try:
                fn(a)
            except Exception as exc:
                a.med(label, f"probe failed: {exc}")
    else:
        a.skip("anthropic/*", "ANTHROPIC_API_KEY not set")

    # pricing table sanity
    zeros = [m for m, (i, o) in _FLAT.items() if i == 0 and o == 0]
    if zeros:
        a.med("zero-price models", f"{len(zeros)}: {zeros[:3]}")
    else:
        a.passed("zero-price check", f"0 of {len(_FLAT)} models")

    cost = calculate_cost("gpt-4o-mini", 1000, 100)
    expected = (1000 / 1e6) * 0.15 + (100 / 1e6) * 0.6
    if cost and abs(cost - expected) < 1e-10:
        a.passed("calc sanity", f"${cost:.8f} (exact match)")
    else:
        a.high("calc sanity", f"expected ${expected:.8f}, got ${cost}")


def _cost_check(a: Audit, label: str, costs: list[CostInfo], model: str,
                input_t: int, output_t: int, ms: float) -> None:
    if not costs or costs[0].total_cost is None:
        a.med(label, "no cost captured", latency_ms=ms)
        return
    pricing = lookup_pricing(model)
    if not pricing:
        a.med(label, f"no pricing for {model}", latency_ms=ms)
        return
    expected = (input_t / 1e6) * pricing[0] + (output_t / 1e6) * pricing[1]
    drift = abs(costs[0].total_cost - expected)
    meta = {"expected": f"${expected:.8f}", "actual": f"${costs[0].total_cost:.8f}",
            "tokens": f"{input_t} in / {output_t} out", "drift": f"${drift:.8f}"}
    if drift < 0.0001:
        a.passed(label, f"drift ${drift:.8f}", cost_usd=costs[0].total_cost,
                 input_tokens=input_t, output_tokens=output_t, latency_ms=ms, meta=meta)
    else:
        a.high(label, f"drift ${drift:.6f}", cost_usd=costs[0].total_cost, latency_ms=ms, meta=meta)


def _cost_openai_sync(a: Audit) -> None:
    from openai import OpenAI
    costs: list[CostInfo] = []
    client = OpenAI(http_client=tracked(on_cost=costs.append))
    t0 = time.perf_counter()
    resp = client.chat.completions.create(model=OPENAI_MODEL, messages=[{"role": "user", "content": PROBE_PROMPT}], max_tokens=10)
    ms = (time.perf_counter() - t0) * 1000
    u = resp.usage
    _cost_check(a, "openai/sync", costs, OPENAI_MODEL, u.prompt_tokens if u else 0, u.completion_tokens if u else 0, ms)


def _cost_openai_stream(a: Audit) -> None:
    from openai import OpenAI
    costs: list[CostInfo] = []
    client = OpenAI(http_client=tracked(on_cost=costs.append))
    t0 = time.perf_counter()
    stream = client.chat.completions.create(
        model=OPENAI_MODEL, messages=[{"role": "user", "content": PROBE_PROMPT}],
        max_tokens=10, stream=True, stream_options={"include_usage": True})
    for _ in stream:
        pass
    ms = (time.perf_counter() - t0) * 1000
    if costs and costs[0].total_cost and costs[0].total_cost > 0:
        a.passed("openai/stream", f"${costs[0].total_cost:.6f}", cost_usd=costs[0].total_cost, latency_ms=ms)
    else:
        a.med("openai/stream", "no cost from stream", latency_ms=ms)


def _cost_openai_async(a: Audit) -> None:
    import asyncio
    from openai import AsyncOpenAI
    costs: list[CostInfo] = []
    async def run():
        client = AsyncOpenAI(http_client=tracked_async(on_cost=costs.append))
        t0 = time.perf_counter()
        await client.chat.completions.create(model=OPENAI_MODEL, messages=[{"role": "user", "content": PROBE_PROMPT}], max_tokens=10)
        return (time.perf_counter() - t0) * 1000
    ms = asyncio.run(run())
    if costs and costs[0].total_cost and costs[0].total_cost > 0:
        a.passed("openai/async", f"${costs[0].total_cost:.6f}", cost_usd=costs[0].total_cost, latency_ms=ms)
    else:
        a.med("openai/async", "no cost captured", latency_ms=ms)


def _cost_anthropic_sync(a: Audit) -> None:
    import anthropic
    costs: list[CostInfo] = []
    client = anthropic.Anthropic(http_client=tracked(on_cost=costs.append))
    t0 = time.perf_counter()
    msg = client.messages.create(model=ANTHROPIC_MODEL, max_tokens=10, messages=[{"role": "user", "content": PROBE_PROMPT}])
    ms = (time.perf_counter() - t0) * 1000
    _cost_check(a, "anthropic/sync", costs, ANTHROPIC_MODEL, msg.usage.input_tokens, msg.usage.output_tokens, ms)


def _cost_anthropic_stream(a: Audit) -> None:
    import anthropic
    costs: list[CostInfo] = []
    client = anthropic.Anthropic(http_client=tracked(on_cost=costs.append))
    t0 = time.perf_counter()
    with client.messages.stream(model=ANTHROPIC_MODEL, max_tokens=10, messages=[{"role": "user", "content": PROBE_PROMPT}]) as stream:
        for _ in stream.text_stream:
            pass
    ms = (time.perf_counter() - t0) * 1000
    if costs and costs[0].total_cost and costs[0].total_cost > 0:
        a.passed("anthropic/stream", f"${costs[0].total_cost:.6f}", cost_usd=costs[0].total_cost, latency_ms=ms)
    else:
        a.med("anthropic/stream", "no cost from stream", latency_ms=ms)


def _cost_anthropic_async(a: Audit) -> None:
    import asyncio, anthropic
    costs: list[CostInfo] = []
    async def run():
        client = anthropic.AsyncAnthropic(http_client=tracked_async(on_cost=costs.append))
        t0 = time.perf_counter()
        await client.messages.create(model=ANTHROPIC_MODEL, max_tokens=10, messages=[{"role": "user", "content": PROBE_PROMPT}])
        return (time.perf_counter() - t0) * 1000
    ms = asyncio.run(run())
    if costs and costs[0].total_cost and costs[0].total_cost > 0:
        a.passed("anthropic/async", f"${costs[0].total_cost:.6f}", cost_usd=costs[0].total_cost, latency_ms=ms)
    else:
        a.med("anthropic/async", "no cost captured", latency_ms=ms)


# -- EXPOSURE ---------------------------------------------------------------

def probe_exposure(a: Audit) -> None:
    a.section("exposure")

    # dashboard security headers
    status, hdrs, _, ms = _http("GET", DASHBOARD)
    hdr_map = {k.lower(): v for k, v in hdrs.items()}
    checks = {
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": None,
    }
    for hdr, expected in checks.items():
        actual = hdr_map.get(hdr)
        if actual and (expected is None or actual.strip().upper() == expected.upper()):
            a.passed(f"dashboard {hdr}", actual.strip())
        elif actual:
            a.low(f"dashboard {hdr}", f"got {actual.strip()}, want {expected}")
        else:
            a.med(f"dashboard {hdr}", "missing")

    # proxy error body scan across multiple error codes
    for path in ["/v1/chat/completions", "/nonexistent", "/"]:
        _, _, body, ms = _http("GET", f"{PROXY}{path}")
        decoded = body.decode("utf-8", errors="replace").lower()
        leaks = [w for w in ["stack trace", "traceback", "node_modules", "at object.",
                             "supabase", "postgres", "wrangler", "worker.js"] if w in decoded]
        if leaks:
            a.high(f"info leak {path}", f"exposed: {', '.join(leaks)}", latency_ms=ms)
        else:
            a.passed(f"error body {path}", "clean", latency_ms=ms)

    # sensitive paths
    for path in ["/.env", "/.git/config", "/wrangler.toml", "/.dev.vars", "/package.json"]:
        status, _, body, ms = _http("GET", f"{PROXY}{path}")
        decoded = body.decode("utf-8", errors="replace").lower()
        if status == 200 and ("password" in decoded or "secret" in decoded or "token" in decoded):
            a.crit(f"exposed {path}", "sensitive content accessible!")
        elif status in (401, 403, 404):
            a.passed(f"blocked {path}", f"{status}", latency_ms=ms)
        else:
            a.info(f"GET {path}", f"{status}", latency_ms=ms)

    # secret file audit (local repo)
    repo = Path(__file__).resolve().parent.parent
    gitignore = repo / ".gitignore"
    gi = gitignore.read_text() if gitignore.exists() else ""

    secret_patterns = [".env", ".env.local", ".env.production", ".dev.vars",
                       "*.pem", "*.key", "*.p12"]
    found = []
    for pat in secret_patterns:
        if pat.startswith("*"):
            matches = list(repo.glob(pat))
            found.extend(m.name for m in matches)
        else:
            p = repo / pat
            if p.exists():
                found.append(pat)

    if found:
        all_covered = all(any(f in line or f.split(".")[-1] in line for line in gi.splitlines()) for f in found)
        if all_covered:
            a.passed("local secrets", f"{len(found)} files, all gitignored")
        else:
            a.high("local secrets", f"not all gitignored: {found}")
    else:
        a.passed("local secrets", "none found")


# -- RATE LIMIT -------------------------------------------------------------

def probe_ratelimit(a: Audit) -> None:
    a.section("rate limit")

    llmkit_key = os.environ.get("LLMKIT_API_KEY", "")
    if not llmkit_key:
        a.skip("rate limit", "LLMKIT_API_KEY not set")
        return

    # check rate limit headers exist
    status, hdrs, _, ms = _post_chat(
        {"Authorization": f"Bearer {llmkit_key}"},
        {"model": OPENAI_MODEL, "messages": [{"role": "user", "content": PROBE_PROMPT}], "max_tokens": 5},
    )

    rl_limit = hdrs.get("X-RateLimit-Limit", hdrs.get("x-ratelimit-limit", ""))
    rl_remaining = hdrs.get("X-RateLimit-Remaining", hdrs.get("x-ratelimit-remaining", ""))

    if rl_limit:
        a.passed("rate limit headers", f"limit={rl_limit}, remaining={rl_remaining}", latency_ms=ms)
    else:
        a.low("rate limit headers", "no X-RateLimit headers in response", latency_ms=ms)


# -- BUDGET -----------------------------------------------------------------

def probe_budget(a: Audit) -> None:
    a.section("budget")

    llmkit_key = os.environ.get("LLMKIT_API_KEY", "")
    if not llmkit_key:
        a.skip("budget enforcement", "LLMKIT_API_KEY not set")
        return

    import httpx
    try:
        resp = httpx.post(
            f"{PROXY}/v1/chat/completions",
            headers={"Authorization": f"Bearer {llmkit_key}"},
            json={"model": OPENAI_MODEL, "messages": [{"role": "user", "content": PROBE_PROMPT}], "max_tokens": 5},
            timeout=30,
        )
        cost_hdr = resp.headers.get("x-llmkit-cost")
        budget_hdr = resp.headers.get("x-llmkit-budget-remaining")

        if resp.status_code == 200 and cost_hdr:
            a.passed("proxy cost tracking", f"${cost_hdr}", cost_usd=float(cost_hdr))
        elif resp.status_code == 200:
            a.low("proxy cost tracking", "200 but no x-llmkit-cost header")
        else:
            a.info("proxy cost tracking", f"status {resp.status_code}")

        if budget_hdr:
            a.passed("budget headers", f"remaining: ${budget_hdr}")
        else:
            a.info("budget headers", "no budget configured")
    except Exception as exc:
        a.med("proxy budget probe", str(exc))


# -- Banner & Report -------------------------------------------------------

BANNER = """
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   ██╗     ██╗     ███╗   ███╗██╗  ██╗██╗████████╗        ║
  ║   ██║     ██║     ████╗ ████║██║ ██╔╝██║╚══██╔══╝        ║
  ║   ██║     ██║     ██╔████╔██║█████╔╝ ██║   ██║           ║
  ║   ██║     ██║     ██║╚██╔╝██║██╔═██╗ ██║   ██║           ║
  ║   ███████╗███████╗██║ ╚═╝ ██║██║  ██╗██║   ██║           ║
  ║   ╚══════╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝           ║
  ║                                                           ║
  ║   STACK AUDIT                                             ║
  ║   security probes | cost accuracy | attack surface        ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝"""


def print_banner() -> None:
    print(_magenta(BANNER))
    print()
    print(f"  {_dim('target')}:  {PROXY}")
    print(f"  {_dim('date')}:    {time.strftime('%Y-%m-%d %H:%M:%S')}")


def print_report(a: Audit) -> None:
    sev = a.by_severity()
    n_pass = sev.get(Sev.PASS, 0)
    n_crit = sev.get(Sev.CRIT, 0)
    n_high = sev.get(Sev.HIGH, 0)
    n_med = sev.get(Sev.MED, 0)
    n_low = sev.get(Sev.LOW, 0)
    n_info = sev.get(Sev.INFO, 0)
    total_ran = sum(1 for f in a.findings if not f.skipped)
    skipped = sum(1 for f in a.findings if f.skipped)

    print(f"\n  {'=' * 59}")
    print()
    print(f"  {_bold('RESULTS')}")
    print()

    # severity breakdown
    parts = []
    if n_crit: parts.append(_red(f"{n_crit} critical"))
    if n_high: parts.append(_red(f"{n_high} high"))
    if n_med: parts.append(_yellow(f"{n_med} medium"))
    if n_low: parts.append(_cyan(f"{n_low} low"))
    parts.append(_green(f"{n_pass} passed"))
    if n_info: parts.append(_dim(f"{n_info} info"))

    print(f"  {_bold('Findings')}:  {', '.join(parts)}")
    if skipped:
        print(f"  {_bold('Skipped')}:   {skipped} (missing env vars)")
    print(f"  {_bold('Cost')}:      ${a.total_cost:.6f}")
    print(f"  {_bold('Duration')}:  {a.elapsed():.1f}s")

    latencies = [f.latency_ms for f in a.findings if f.latency_ms > 0]
    if latencies:
        avg = sum(latencies) / len(latencies)
        mx = max(latencies)
        print(f"  {_bold('Latency')}:   avg {avg:.0f}ms, max {mx:.0f}ms")

    total_in = sum(f.input_tokens for f in a.findings)
    total_out = sum(f.output_tokens for f in a.findings)
    if total_in or total_out:
        print(f"  {_bold('Tokens')}:    {total_in} in / {total_out} out")

    # verdict
    worst = a.worst
    print()
    if worst == Sev.PASS:
        print(f"  {_green(_bold('VERDICT: ALL CLEAR'))}")
    elif worst in (Sev.CRIT, Sev.HIGH):
        print(f"  {_red(_bold(f'VERDICT: {n_crit + n_high} ISSUE(S) REQUIRE ATTENTION'))}")
        for f in a.findings:
            if f.severity in (Sev.CRIT, Sev.HIGH):
                print(f"    {_red('>')} [{f.section}] {f.name}: {f.detail}")
    else:
        print(f"  {_yellow(_bold('VERDICT: ACCEPTABLE'))}")

    print(f"\n  {'=' * 59}\n")


def save_report(a: Audit) -> Path | None:
    AUDITS_DIR.mkdir(exist_ok=True)
    path = AUDITS_DIR / f"{time.strftime('%Y-%m-%d_%H%M%S')}.json"
    path.write_text(json.dumps(a.summary_dict(), indent=2))
    return path


def diff_reports(current: dict, prev_path: str) -> None:
    prev = json.loads(Path(prev_path).read_text())
    print(f"\n  {_bold('DIFF')}: {prev.get('timestamp', '?')} -> {current.get('timestamp', '?')}")
    print()

    prev_findings = {f"{d['section']}/{d['name']}": d for d in prev.get("findings", []) if not d.get("skipped")}
    curr_findings = {f"{d['section']}/{d['name']}": d for d in current.get("findings", []) if not d.get("skipped")}

    # new findings
    for key in curr_findings:
        if key not in prev_findings:
            f = curr_findings[key]
            print(f"  {_green('+ NEW')}  {key}: {f['severity']} - {f['detail']}")

    # removed findings
    for key in prev_findings:
        if key not in curr_findings:
            f = prev_findings[key]
            print(f"  {_red('- GONE')} {key}: was {f['severity']}")

    # severity changes
    for key in curr_findings:
        if key in prev_findings:
            old_sev = prev_findings[key]["severity"]
            new_sev = curr_findings[key]["severity"]
            if old_sev != new_sev:
                arrow = _green("improved") if _SEV_ORDER.get(new_sev, 99) > _SEV_ORDER.get(old_sev, 99) else _red("regressed")
                print(f"  {_yellow('~ CHG')}  {key}: {old_sev} -> {new_sev} ({arrow})")

    prev_sev = prev.get("severity_counts", {})
    curr_sev = current.get("severity_counts", {})
    print(f"\n  {_dim('prev')}: {prev_sev}")
    print(f"  {_dim('curr')}: {curr_sev}")
    print()


# -- Main -------------------------------------------------------------------

SECTIONS = {
    "recon": probe_recon,
    "auth": probe_auth,
    "injection": probe_injection,
    "cost": probe_cost,
    "exposure": probe_exposure,
    "ratelimit": probe_ratelimit,
    "budget": probe_budget,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="LLMKit Stack Audit")
    parser.add_argument("--section", "-s", choices=list(SECTIONS.keys()), help="run one section")
    parser.add_argument("--json", "-j", action="store_true", dest="json_out", help="JSON output")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--diff", "-d", metavar="PREV.json", help="compare against previous report")
    parser.add_argument("--no-save", action="store_true", help="don't save report to audits/")
    args = parser.parse_args()

    a = Audit(verbose=args.verbose, json_out=args.json_out)

    if not args.json_out:
        print_banner()

    sections = [args.section] if args.section else list(SECTIONS.keys())
    for sec in sections:
        SECTIONS[sec](a)

    if args.json_out:
        print(json.dumps(a.summary_dict(), indent=2))
    else:
        print_report(a)

        if not args.no_save:
            path = save_report(a)
            if path:
                print(f"  {_dim(f'Report saved: {path.relative_to(path.parent.parent)}')}")
                print()

        if args.diff:
            diff_reports(a.summary_dict(), args.diff)

    has_issues = any(f.severity in (Sev.CRIT, Sev.HIGH) for f in a.findings)
    sys.exit(1 if has_issues else 0)


if __name__ == "__main__":
    main()
