# Changelog

## v0.2.0

Release date: 2026-06-16

### Added

- `agentguard doctor` for config, source, target, and writable-artifact checks.
- `agentguard scan` execution path with contract reuse, suite reuse, stale-hash detection, baseline save, JSON report, and HTML report output.
- HTTP target support for multi-turn scenario execution with retries, timeout handling, tool-call capture, and retrieved-context capture.
- Executable healthcare scheduling example with a local fake server for end-to-end scan validation.
- Native Gemini and Anthropic provider adapters for text and structured generation.
- Separate `llm.generator` and `llm.judge` roles for contract extraction, scenario generation, semantic evaluation, and recommendations.

### Changed

- `agentguard init` now creates a scan-ready `agent-data/` fixture in addition to the classic `ai-tests/` example.
- `agentguard init` now scaffolds role-specific LLM config plus `.env.example` entries for OpenAI, DeepSeek, Gemini, and Anthropic.
- `agentguard doctor` now reports `llm.generator`, `llm.judge`, and target readiness independently.
- Generated GitHub Actions workflow now runs `doctor` plus `scan --dry-run --ci` and uploads `.agentguard/` artifacts.

## v0.1.0

Release date: 2026-05-05

### Highlights

- CLI inicial para regressao de agentes: `agentguard init` e `agentguard test`.
- Execucao deterministica (`stub`) e execucao real de provider (`openai` e `deepseek`).
- Assercoes objetivas: `mustInclude`, `mustNotInclude`, `zodSchema` e relatorio de falhas.
- Modo CI com exit codes previsiveis (`0`, `1`, `2`) e reporter JSON.
- Template de GitHub Actions via `--with-github-action`.

### Instalacao nesta primeira versao

- Npm publico ainda nao foi publicado.
- Instalacao recomendada: `npm i -D github:gabriel-r-machado/AgentGuard`.
