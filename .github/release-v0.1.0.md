# AgentGuard v0.1.0

Primeira versao publica do AgentGuard.

## O que entra nesta release

- Comandos principais: `agentguard init` e `agentguard test`.
- Execucao `stub` para smoke tests baratos e rapidos.
- Execucao `provider` para validar comportamento real com OpenAI/DeepSeek.
- Assercoes deterministicas (`mustInclude`, `mustNotInclude`, `zodSchema`).
- Reporter JSON para automacao em CI.
- Template de workflow GitHub Actions gerado por `init --with-github-action`.

## Instalacao

Nesta primeira versao, a instalacao e via GitHub:

```bash
npm i -D github:gabriel-r-machado/AgentGuard
```
