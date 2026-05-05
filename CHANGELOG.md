# Changelog

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
