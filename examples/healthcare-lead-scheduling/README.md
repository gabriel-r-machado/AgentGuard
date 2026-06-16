# Healthcare Lead Scheduling Example

Exemplo sintetico para validar o fluxo completo de `doctor` + `scan` contra um alvo HTTP local.

Este exemplo inclui:

- `agent-data/system-prompt.md`
- `agent-data/knowledge/`
- `agentguard.config.ts`
- `mock-agent.mjs`
- `generated/` com artefatos de exemplo gerados em dry-run

Comandos:

```bash
npm run build
node mock-agent.mjs
```

Em outro terminal:

```bash
export MOCK_AGENT_URL=http://127.0.0.1:4010/chat
node ../../packages/cli/dist/index.js doctor --ci
node ../../packages/cli/dist/index.js scan --dry-run --ci
```

Observacoes:

- os dados sao ficticios;
- nao ha pacientes, clinicas, medicos ou empresas reais;
- o scan em `--dry-run` ainda executa o alvo HTTP, mas marca qualquer efeito externo como simulado;
- os relatorios ficam em `.agentguard/report.json` e `.agentguard/report.html`.
