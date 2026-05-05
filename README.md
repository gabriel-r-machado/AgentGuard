# AgentGuard

Framework open source para testar respostas de agentes de IA em lote, com regras objetivas e relatorio acionavel.

## Quick Start (neste repositorio)

```bash
npm ci
npm run build
npm run agentguard:init:deepseek
npm run agentguard:test
```

Comandos de uso diario:

```bash
npm run agentguard:test
npm run agentguard:test:provider
npm run agentguard:test:ci
```

## Usar em qualquer outro repositorio (via GitHub)

No projeto alvo:

```bash
npm i -D github:gabriel-r-machado/AgentGuard
npx agentguard init --yes --provider deepseek --with-github-action
npx agentguard test
```

Para rodar com provider real:

```bash
# PowerShell
$env:DEEPSEEK_API_KEY="SUA_CHAVE"
npx agentguard test --execution provider
```

## O que o `init` gera

- `agentguard.config.ts`
- `ai-tests/example.test.ts`
- `.env.example`
- `.github/workflows/agentguard.yml` (quando usar `--with-github-action`)

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

## CLI suportada hoje

`agentguard init`

- `--yes`
- `--provider <openai|deepseek>`
- `--with-github-action`

`agentguard test`

- `--provider <openai|deepseek>`
- `--model <name>`
- `--grep <pattern>`
- `--ci`
- `--reporter <pretty|ci|json>`
- `--execution <stub|provider>`

## Variaveis de ambiente

Configure no `.env`:

- `DEEPSEEK_API_KEY`
- `OPENAI_API_KEY`

Boas praticas:

- nunca commitar `.env`
- nunca expor chave real em issue/PR/chat
- se a chave vazou, revogue e gere outra

## Exit codes

- `0`: suite passou
- `1`: ao menos um teste falhou
- `2`: erro de config/runtime (ex.: chave ausente)

## Scripts do repositorio

```bash
npm run build
npm run test
npm run agentguard
npm run agentguard:init:openai
npm run agentguard:init:deepseek
npm run agentguard:test
npm run agentguard:test:provider
npm run agentguard:test:ci
```
