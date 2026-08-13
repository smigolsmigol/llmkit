# LLMKit roadmap

Planning window: August 2026 through August 2027
Last reviewed: 2026-08-13

This roadmap communicates direction. It is not a release promise. Security, correctness, and
maintainability gates can change the order or remove work.

## August through October 2026: restore verified hosted operation

Intended work:

- Complete isolated hosted concurrency, outage-recovery, latency, and cleanup proof.
- Keep signup, dashboard key management, and authenticated hosted routes closed until the proof
  passes without weakening the preregistered thresholds.
- Reconcile npm, PyPI, GitHub releases, MCP registries, package documentation, and deployed metadata
  to one reviewed release state.
- Publish the governance, architecture, security requirements, accessibility status, maintenance
  policy, and evidence needed for an honest OpenSSF Best Practices Silver assessment.
- Replace unverifiable release signatures and tags with a documented verification path.

## November 2026 through February 2027: reduce integration friction

Intended work:

- Move the AI SDK provider to the current supported provider contract after consumer proof.
- Package existing MCP and lifecycle-hook behavior for first-class coding-agent installation where
  the target platform has a maintained public integration path.
- Make upgrade and deprecation guidance explicit across the SDKs, CLI, MCP server, and gateway.
- Improve request-evidence export and replay only after the hosted money path is proved.
- Keep local tools useful without requiring an LLMKit account or sending LLMKit telemetry.

## March through August 2027: harden adoption and operations

Intended work:

- Stabilize the public API and package compatibility policy around observed users and integrations.
- Add operational evidence for deployment, rollback, request settlement, and provider failure modes.
- Improve contributor ownership and work toward a second qualified maintainer or enforceable access
  continuity arrangement.
- Extend cost attribution only where provider usage and pricing semantics can be represented without
  inventing precision.

## Not planned in this window

- A model recommender or automatic "cheapest model" ranking across incomparable modalities.
- Treating the bundled pricing catalog as a live quote, provider invoice, or billing ledger.
- Restoring hosted account creation before tenant isolation and the complete staging proof pass.
- Capturing prompts, provider keys, or local coding-session data as LLMKit telemetry by default.
- Supporting every agent framework or provider at the expense of the core request-evidence and
  budget-admission contract.
- Enterprise compliance, uptime, or data-residency guarantees that have not been independently
  implemented and verified.

## How this roadmap changes

Roadmap changes follow [GOVERNANCE.md](GOVERNANCE.md). A proposal should name the user outcome, the
current evidence, compatibility and security boundaries, the proof required, and the work it
displaces. Completed work belongs in release notes and current documentation, not in a rewritten
history of this roadmap.
