# Changelog

## v1.0.0

Release date: 2026-05-05

### Highlights

- Stable CLI workflow for local and CI usage: `agentguard init`, `agentguard test`, CI exit-code contract, and deterministic reporters (`pretty`, `ci`, `json`, `markdown`).
- Provider adapters for OpenAI and DeepSeek under a normalized contract with explicit timeout/auth error handling.
- Layered assertion engine with text, Zod schema, tool-call, context-bound, snapshot-contract, and optional judge evaluations.
- Run-level guardrails for latency/cost accounting and predictable fail-close behavior in CI mode.
- Local artifact persistence (`.agentguard/results`) and snapshot persistence (`.agentguard/snapshots`) for regression tracking.
- Minimal versioned plugin API (`apiVersion: 1`) supporting external assertion registration with fail-fast validation.

### Notable Changes Since v0.1.0

- Added security preset helpers for prompt injection, data leakage, and tool misuse.
- Added `agentguard init --with-github-action` template and CI docs updates for copy-paste workflow setup.
- Added stable machine-readable JSON reporting for automation pipelines.
- Improved error clarity and status labeling (including explicit `INCONCLUSIVE` reporting in pretty output).

### Migration Notes

- See [docs/Migration-v1.0.md](docs/Migration-v1.0.md) for upgrade notes from `v0.1.x`.

## v0.1.0

- Added monorepo scaffold with `packages/core` and `packages/cli`.
- Implemented config loading with defaults and validation.
- Implemented test DSL registry and file collection.
- Implemented runner with deterministic execution, assertions, latency, and cost reporting.
- Added OpenAI and DeepSeek provider adapters with normalized contracts.
- Added CLI commands `agentguard init` and `agentguard test` with CI-friendly exit codes.
