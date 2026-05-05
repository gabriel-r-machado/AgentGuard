# AgentGuard

Framework open source para testar respostas de agentes de IA em lote, com regras claras, sem precisar abrir chat manualmente toda vez.

## O que ele resolve

Se você tem um agente (suporte, vendas, FAQ, RAG etc.), em vez de testar pergunta por pergunta no chat:

1. você define uma suíte de testes
2. roda tudo de uma vez
3. recebe pass/fail com diagnóstico acionável

Isso permite detectar regressão rápido antes de publicar mudanças de prompt, contexto, ferramentas ou modelo.

## Fluxo rápido

```bash
npm ci
npm run build
node packages/cli/dist/index.js init --yes --provider openai --with-github-action
```

Esse comando gera:

- `agentguard.config.ts`
- `ai-tests/example.test.ts`
- `.env.example`
- `.github/workflows/agentguard.yml` (opcional com `--with-github-action`)

## Exemplo de teste

```ts
import { testAgent } from "agentguard";

testAgent("responde com saudacao", {
  input: "Diga oi",
  expected: {
    mustInclude: ["oi"],
    mustNotInclude: ["senha", "token"],
  },
});
```

## Como rodar

Modo local (`stub`, sem custo de API):

```bash
node packages/cli/dist/index.js test
```

Modo real (chama o provider de IA):

```bash
node packages/cli/dist/index.js test --execution provider --provider openai --model gpt-4.1-mini
```

CI com saída estável para automação:

```bash
node packages/cli/dist/index.js test --ci --reporter json
```

## Variáveis de ambiente

Crie `.env` com base no `.env.example` e configure a chave do provider que você usa:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`

Boas práticas:

- nunca commitar `.env`
- nunca expor chave real em issue/PR/chat

## Exit codes

- `0`: suíte passou
- `1`: houve falha de teste
- `2`: erro de config/runtime (ex.: chave ausente, erro de execução)

## Scripts úteis (repositório)

```bash
npm run build
npm run test --workspace @agentguard/core
npm run test --workspace @agentguard/cli
```
