# LLMKit quality gates

The local gate is the source of truth for pull-request readiness. CI bootstraps the same pinned
tools and runs the same `quality:pr` command. Run commands from the repository root through the
declared pnpm version:

```bash
corepack pnpm@9.15.4 install --frozen-lockfile
corepack pnpm@9.15.4 quality:bootstrap:all
corepack pnpm@9.15.4 quality:pr
```

`quality:bootstrap:all` creates the ignored `.venv`, hydrates pinned pre-commit environments, and
pulls the digest-pinned Semgrep image. Docker must be available for Semgrep and the local Supabase
proof. No quality command deploys or mutates the hosted Supabase project.

## Gate levels

| Command | Contract |
| --- | --- |
| `quality:fast` | Repository hygiene, secret checks, GitHub Actions lint, Ruff, Bandit, Biome, dormant-package boundary, and the proxy logging guard. |
| `quality:static` | Fast gate plus workspace build/typecheck, Knip, Publint, generated pricing check, strict Mypy, Semgrep rules and scan, and KeyGuard fixtures. |
| `quality:pr` | Static gate plus deterministic JavaScript tests, Python tests and fuzzing, Python statement/branch coverage, zero-known-vulnerability npm and Python audits, the local data-preserving Supabase migration proof, and a real Worker/database compatibility request. |
| `quality:dashboard-reproducibility` | Two no-cache dashboard container builds with one ephemeral pair secret, followed by an exact path and byte comparison. |

The pre-PR gate also rebuilds all five npm tarballs and the Python wheel twice, requires each pair
to be bit-identical, installs the first set into isolated Node and Python consumers, exercises the
public imports and CLI help paths, and verifies uninstall. Its ignored machine receipt is bound to
the exact Git head and dirty worktree bytes at `audits/llmkit-artifact-reproducibility.json`.

Biome runs through `scripts/run-biome-policy.mjs`. All errors and all warning categories other than
the existing cognitive-complexity advisory baseline fail. The baseline is capped per file and is
exact during the full gate, so removing an advisory requires lowering its cap and adding one or
moving debt to a new file fails. This exception keeps refactor debt visible without forcing risky,
behavior-changing rewrites into unrelated changes.

`quality:pr` expects the local Supabase proof stack to be running. GitHub CI owns that lifecycle with
`db:start` before the contract and an always-run `db:stop` cleanup step.

GitHub CI also runs two repository-manifest supply-chain proofs. The current OSV scanner must find
zero vulnerabilities, and the exact OpenSSF workflow engine must score both Vulnerabilities and
Pinned-Dependencies at 10/10. This closes the gap where an installed Python environment is clean
while a declared transitive dependency remains affected.

Dashboard reproducibility is a separate CI job because it intentionally performs two clean Docker
builds. It is not part of routine `quality:pr` runs. Its ignored receipt is bound to the exact Git
head and dirty worktree bytes at `audits/llmkit-dashboard-reproducibility.json`. A byte mismatch
writes a FAIL receipt and retains at most 64 mismatched file pairs, capped at 32 MiB, under
`audits/llmkit-dashboard-reproducibility-failure/`. The next run refuses to overwrite that evidence.

The Python gate independently requires at least 90% statement and branch coverage. The JavaScript
gate aggregates the shipped JavaScript from all five public packages with every production
TypeScript or TSX source file in the proxy and dashboard, then fails below 80% statement coverage.
The proxy and dashboard also retain their local 80% floors so a large well-tested surface cannot
hide a regression in either application. Changed money-path code remains subject to the stricter
90% statements, branches, functions, and lines gate. Repository-wide 90% across all four
JavaScript metrics remains a longer-term objective and is not implied by a green `quality:pr`.
Absolute Miniflare wall-clock timings are not correctness assertions because benchmark results vary
by machine, operating system, and runner load. The local gate still proves budget admission,
release, retry, and replay behavior. The hosted staging proof owns the server-side coordination
performance contract: median at most 50 ms and p95 at most 150 ms, recorded in its environment-bound
receipt.
The Python environment is resolved from `requirements-ci.in` into the hash-locked
`requirements-ci.txt`; editable SDK installation and wheel builds run without dependency or build
isolation fetches. Regenerate the lock with pip-tools 7.5.3 in the immutable Python 3.11 builder
declared by `.clusterfuzzlite/Dockerfile`, then prove it in clean Python 3.11 and Windows
environments before committing it.

## Intentional Knip boundaries

The package test programs are explicit Knip entries because the root test runner invokes them by
path. Biome, c8, KeyGuard, and the pinned Supabase CLI are intentional root development dependencies
invoked by exact paths or quality scripts, which are excluded from Knip's product-source graph. New
exceptions require the same narrow explanation and a real execution gate.

## Fail-closed checks

```bash
node scripts/run-quality-gate.mjs --self-test
node scripts/run-ts-quality.mjs --self-test
node scripts/run-biome-policy.mjs --self-test
node scripts/assert-scorecard-supply-chain.mjs --self-test
node packages/proxy/test/worker-deploy-guard-test.mjs
```

The full test runner also exercises the deployment guard, secret-log boundary, and adjacent valid
fixtures. Production deployment remains a separate manual workflow with an exact target string and
protected environment approval.

## Repeatable dashboard artifact

The Cloudflare dashboard image requires Next.js's Server Function encryption key as a BuildKit
secret. Next.js embeds that key in the build output, so two builds of the same revision must use the
same secret to produce compatible artifacts. The dashboard build also derives Next.js preview keys
from that secret with domain-separated HKDF labels, canonicalizes only Next's JSON and client
reference build manifests in both the primary and standalone build trees, then asks OpenNext to
bundle the existing build through its supported `--skipNextBuild` path. Array order and values are
preserved. A version-pinned OpenNext patch sorts the manifest paths that its generator otherwise
reads in filesystem order. OpenNext's wall-clock cache timestamp is then replaced with the source
revision epoch, and its esbuild process runs with one Go scheduler thread.

Use a canonical base64 value representing a 16, 24, or 32 byte AES key. Keep the deployment value
in the deployment secret manager, rotate it deliberately, and never commit it or pass it through a
Docker build argument. Rotating the secret deliberately changes both the Server Function and
preview keys, so it also changes the artifact.

```bash
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker buildx build \
  --file packages/dashboard/Dockerfile.cloudflare \
  --build-arg LLMKIT_BUILD_ID="$(git rev-parse HEAD)" \
  --build-arg SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)" \
  --secret id=next_server_actions_encryption_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  --target artifact \
  --output type=local,dest=.cache/dashboard-artifact \
  .
unset NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
```

The automated repeatability command creates and reuses one temporary secret for both clean builds,
then deletes its guarded temporary outputs. A new secret is a deliberate artifact change, even when
the source revision is unchanged.
