# Contributing to AgentGuard

Obrigado por contribuir com o AgentGuard.

## Setup local

```bash
npm ci
npm run build
npm run test
```

## Fluxo recomendado

1. Crie uma branch curta e descritiva.
2. Implemente uma mudanca pequena por PR.
3. Adicione ou ajuste testes para o comportamento novo.
4. Rode os checks relevantes antes do commit.
5. Abra PR explicando o problema, a solucao e tradeoffs.

## Regras de mudanca

- Nao invente APIs que nao existem nos docs/codigo.
- Evite mudar arquivos fora do escopo da issue.
- Prefira comportamento explicito a abstracoes complexas.
- Em regras criticas, use assercoes deterministicas (`mustInclude`, `mustNotInclude`, `zodSchema`).

## Padrao de qualidade

- TypeScript com tipagem forte.
- Mensagens de erro acionaveis.
- Testes passando em `npm run test`.
- Quando fizer mudanca na CLI, valide `npm run test:cli`.

## Boas primeiras contribuicoes

Procure issues com label `good first issue`.

## Seguranca

- Nunca commite chaves (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`).
- Se alguma chave vazar, revogue e gere outra.
