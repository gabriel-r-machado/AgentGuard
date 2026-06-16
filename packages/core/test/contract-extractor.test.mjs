import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  agentContractSchema,
  createContractExtractor,
  createSourceLoader,
  loadAgentGuardConfig,
} from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-contract-"));
}

test("extractor produces a validated contract with grounded facts and unknowns", async () => {
  const cwd = createTempDir();
  try {
    mkdirSync(join(cwd, "agent-data", "knowledge"), { recursive: true });

    writeFileSync(
      join(cwd, "agent-data", "system-prompt.md"),
      [
        "Sempre responda com clareza e tom acolhedor.",
        "Nao prometa resultados.",
        "Encaminhe situacoes sensiveis para atendimento humano.",
        "Colete nome e telefone antes de tentar agendar.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "agent-data", "knowledge", "faq.md"),
      [
        "Atendimento inicial por mensagem.",
        "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
        "Nao realizamos orientacao clinica por chat.",
      ].join("\n\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "contract-example",
    locale: "pt-BR",
    preset: "healthcare-lead-scheduling"
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md"
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.md"
      }
    ]
  }
});`,
      "utf8",
    );

    const config = await loadAgentGuardConfig({ cwd });
    const sources = await createSourceLoader().load({ cwd, config });
    const contract = await createContractExtractor().extract({ config, sources });

    agentContractSchema.parse(contract);
    assert.equal(contract.identity.preset, "healthcare-lead-scheduling");
    assert.ok(contract.requiredBehaviors.length > 0);
    assert.ok(contract.forbiddenBehaviors.length > 0);
    assert.ok(contract.facts.length > 0);
    assert.ok(contract.facts.every((fact) => fact.sourceRefs.length > 0));
    assert.ok(
      contract.unknownInformation.some((entry) => entry.topic.includes("diagnosis")),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
