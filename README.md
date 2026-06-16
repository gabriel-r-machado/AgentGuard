![CI](https://github.com/gabriel-r-machado/AgentGuard/actions/workflows/agentguard.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/license-MIT-green)

# AgentGuard

Framework open source para testar respostas de agentes de IA com suites deterministicas, scans baseados em contrato e relatorios acionaveis.

> Status atual: branch preparada para `v0.2.0`.
> Instalacao publica continua via GitHub: `npm i -D github:gabriel-r-machado/AgentGuard`
> Pacote npm ainda nao foi publicado.

## Em 30 segundos

O AgentGuard existe para responder uma pergunta simples:

**"Se eu trocar prompt, modelo, ferramenta ou contexto, meu agente continua seguro e consistente?"**

Hoje o projeto cobre dois tipos de validacao:

- `agentguard test`: suite objetiva para checar texto, schema e regras claras.
- `agentguard scan`: fluxo mais completo para extrair contrato, gerar cenarios e avaliar o agente com relatorio final.

Entre eles, `agentguard doctor` verifica se o projeto esta pronto para rodar scan sem surpresa.

## O que ja funciona hoje

- Scaffold inicial com `agentguard init`
- Suites deterministicas com `mustInclude`, `mustNotInclude`, `zodSchema` e judge experimental
- Execucao local `stub` e execucao real com provider
- Providers `openai`, `deepseek`, `gemini` e `anthropic`
- Scan com contrato, suite gerada, hash de fontes, stale detection e baseline local
- Target HTTP multi-turn com retry, timeout, captura de tool calls e contexto recuperado
- Relatorios em terminal, JSON e HTML
- Workflow de GitHub Actions gerado no `init`

## Quando usar cada comando

### `agentguard test`

Use quando voce quer validar regras objetivas de resposta:

- a resposta precisa incluir certas palavras
- a resposta nao pode vazar segredo
- a saida precisa bater com um schema
- voce quer um smoke test rapido no CI

### `agentguard doctor`

Use antes de `scan` para validar:

- se `agentguard.config.ts` esta valido
- se as fontes do agente podem ser lidas
- se `.agentguard/` pode receber artefatos
- se `llm.generator`, `llm.judge` e `scan.target` estao prontos

### `agentguard scan`

Use quando voce quer avaliar comportamento do agente de ponta a ponta:

- ler system prompt e knowledge
- extrair contrato esperado
- gerar cenarios automaticamente
- executar conversas multi-turn
- salvar relatorio acionavel

## Quick Start neste repositorio

```bash
npm ci
npm run build
npm test
npm run agentguard:init:deepseek
npm run agentguard:doctor
npm run agentguard:scan:dryrun
```

Comandos de uso diario:

```bash
npm run agentguard:test
npm run agentguard:test:provider
npm run agentguard:test:ci
npm run agentguard:doctor
npm run agentguard:scan:dryrun
```

## Usar em outro repositorio

No projeto alvo:

```bash
npm i -D github:gabriel-r-machado/AgentGuard
npx agentguard init --yes --provider deepseek --with-github-action
```

Depois siga este fluxo:

```bash
npx agentguard test
npx agentguard doctor
npx agentguard scan --dry-run
```

Para execucao real com provider:

```powershell
$env:DEEPSEEK_API_KEY="SUA_CHAVE"
npx agentguard test --execution provider
```

## O que o `init` gera

- `agentguard.config.ts`
- `ai-tests/example.test.ts`
- `.env.example`
- `agent-data/system-prompt.md`
- `agent-data/knowledge/faq.md`
- `.github/workflows/agentguard.yml` quando usado com `--with-github-action`
- regras do AgentGuard no `.gitignore`

Esses arquivos deixam o repositorio pronto para dois caminhos:

- validar respostas com suite local em `ai-tests/`
- validar comportamento completo com `scan` a partir de `agent-data/`

## Exemplo simples de teste

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

Esse tipo de teste e ideal para regras deterministicas e baratas.

## Exemplo de configuracao

Configuracao minima gerada pelo scaffold:

```ts
import { defineConfig } from "agentguard";

export default defineConfig({
  provider: "deepseek",
  model: "deepseek-chat",
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  llm: {
    generator: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
    judge: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
  },
  project: {
    name: "my-agent",
    locale: "en-US",
    preset: "customer-support",
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md",
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.{md,txt,json}",
      },
    ],
  },
  generation: {
    scenarios: 24,
    maxTurns: 4,
    seed: 42,
  },
});
```

## Roles de LLM no scan

O scan separa tres responsabilidades:

- `scan.target`: agente ou endpoint sob teste
- `llm.generator`: modelo usado para extrair contrato e gerar cenarios
- `llm.judge`: modelo usado para avaliar semanticamente as respostas

Exemplo com roles separados:

```ts
llm: {
  generator: {
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
  judge: {
    provider: "anthropic",
    model: "claude-sonnet-4-0",
  },
}
```

## Exemplo de target HTTP

Quando o agente roda atras de uma API, o `scan.target` pode apontar para um endpoint HTTP:

```ts
scan: {
  target: {
    type: "http",
    url: "${MOCK_AGENT_URL}",
    request: {
      method: "POST",
      body: {
        message: "{{message}}",
        sessionId: "{{sessionId}}",
        history: "{{history}}",
        dryRun: "{{dryRun}}",
      },
    },
    response: {
      textPath: "$.reply.text",
      toolCallsPath: "$.toolCalls",
      retrievedContextPath: "$.retrievedContext",
      metadataPath: "$.meta",
    },
  },
}
```

Isso permite avaliar um agente real sem acoplar o AgentGuard ao framework interno do app.

## Como o scan funciona

`agentguard scan` segue este fluxo:

1. carrega `agentguard.config.ts`
2. le `sources.systemPrompt` e `sources.knowledge`
3. gera ou reaproveita `contract.json`, `suite.json` e `manifest.json`
4. executa cenarios contra `scan.target`
5. produz `report.json` e `report.html`

Comandos uteis:

```bash
npx agentguard doctor
npx agentguard scan --dry-run
npx agentguard scan --dry-run --regenerate
npx agentguard scan --dry-run --save-baseline
```

`--dry-run` ainda pode executar o alvo configurado. O que muda e a intencao do run: side effects devem ser simulados.

## Artefatos gerados

O AgentGuard grava artefatos locais em `.agentguard/`:

- `contract.json`: contrato extraido das fontes
- `suite.json`: cenarios gerados para o scan
- `manifest.json`: hash e metadata dos artefatos
- `report.json`: resultado estruturado do scan
- `report.html`: visualizacao local do scan
- `baseline.json`: snapshot salvo com `--save-baseline`
- `results/`: historico de runs da suite tradicional

Esses artefatos devem ficar fora do Git. O scaffold ja protege isso no `.gitignore`.

## Exemplo de saida no terminal

Suite tradicional:

```txt
PASS responde com saudacao (latencyMs=18, estimatedCostUsd=n/a)
PASS nao revela senha (latencyMs=17, estimatedCostUsd=n/a)
FAIL nao deve inventar preco (latencyMs=20, estimatedCostUsd=n/a)

Failed:
- [nao deve inventar preco] Forbidden text "R$ 299" found in output

Run summary:
- tests: 3
- passed: 2
- failed: 1
- inconclusive: 0
- costUsd: n/a
- latencyMs: 55
```

Scan:

```txt
Scan summary:
- mode: dry-run
- contract: created (.agentguard/contract.json)
- suite: created (.agentguard/suite.json)
- manifest: .agentguard/manifest.json
- result: pass
- executedScenarios: 24
- failedScenarios: 0
- overallScore: 100.0%
- reportJson: .agentguard/report.json
- reportHtml: .agentguard/report.html
```

## CLI suportada hoje

### `agentguard init`

Cria scaffold inicial para `test` e `scan`.

Flags:

- `--yes`
- `--provider <openai|deepseek|gemini|anthropic>`
- `--generator-provider <openai|deepseek|gemini|anthropic>`
- `--generator-model <name>`
- `--judge-provider <openai|deepseek|gemini|anthropic>`
- `--judge-model <name>`
- `--with-github-action`

### `agentguard test`

Executa suite local em `testsDir`.

Flags:

- `--provider <openai|deepseek|gemini|anthropic>`
- `--model <name>`
- `--grep <pattern>`
- `--ci`
- `--reporter <pretty|ci|json>`
- `--execution <stub|provider>`

### `agentguard doctor`

Valida se o projeto esta pronto para `scan`.

Flags:

- `--ci`

Notas:

- warnings nao quebram o comando
- erros de config e execucao retornam exit code `2`

### `agentguard scan`

Executa avaliacao guiada por contrato.

Flags:

- `--dry-run`
- `--regenerate`
- `--save-baseline`
- `--ci`

Notas:

- se as fontes mudarem e os artefatos ficarem stale, o comando retorna exit code `1`
- `--regenerate` reconstrui contrato e suite

## Variaveis de ambiente

Configure no ambiente local ou no CI:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `AGENTGUARD_GENERATOR_MODEL`
- `AGENTGUARD_JUDGE_MODEL`

Boas praticas:

- nunca commitar `.env`
- nunca expor chave real em issue, PR ou chat
- se uma chave vazou, revogue e gere outra

## Exit codes

- `0`: execucao aprovada
- `1`: falha de teste, falha de scenario ou artefato stale que precisa `--regenerate`
- `2`: erro de config, runtime ou infraestrutura

## Exemplo completo

O exemplo mais completo fica em [examples/healthcare-lead-scheduling](examples/healthcare-lead-scheduling/README.md).

Ele inclui:

- target HTTP fake local
- `agent-data/` com system prompt e knowledge
- config pronta para `doctor` e `scan`
- artefatos de referencia gerados em dry-run

## Release e publicacao

Esta branch esta preparada para `v0.2.0`.

Checklist recomendado antes de publicar:

1. rodar `npm test`
2. rodar `npm pack --dry-run`
3. confirmar que o nome `agentguard` esta disponivel no npm
4. publicar com `npm publish`
5. criar tag Git correspondente a versao

Enquanto o pacote npm publico nao existir, a instalacao recomendada continua sendo via GitHub.

## Scripts deste repositorio

```bash
npm run build
npm run test
npm run agentguard
npm run agentguard:init:openai
npm run agentguard:init:deepseek
npm run agentguard:test
npm run agentguard:test:provider
npm run agentguard:test:ci
npm run agentguard:doctor
npm run agentguard:scan:dryrun
```
