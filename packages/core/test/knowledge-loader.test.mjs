import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourceLoader, loadAgentGuardConfig } from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-knowledge-"));
}

test("loads markdown, txt, json, glob, and snapshot knowledge sources", async () => {
  const cwd = createTempDir();
  try {
    mkdirSync(join(cwd, "agent-data", "knowledge"), { recursive: true });

    writeFileSync(
      join(cwd, "agent-data", "system-prompt.md"),
      "Always be clear.\nNever invent unsupported information.",
      "utf8",
    );
    writeFileSync(
      join(cwd, "agent-data", "knowledge", "faq.md"),
      "Horario de atendimento\n\nSegunda a sexta, das 08:00 as 18:00.",
      "utf8",
    );
    writeFileSync(
      join(cwd, "agent-data", "knowledge", "policy.txt"),
      "Nao agendar antes da confirmacao final do usuario.",
      "utf8",
    );
    writeFileSync(
      join(cwd, "agent-data", "knowledge", "services.json"),
      JSON.stringify({
        title: "Servicos",
        content: "Oferecemos triagem inicial, orientacao administrativa e agendamento.",
      }),
      "utf8",
    );
    writeFileSync(
      join(cwd, "agent-data", "snapshot.json"),
      JSON.stringify({
        systemPrompt: "Use linguagem acolhedora.",
        knowledgeDocuments: [
          {
            title: "Snapshot extra",
            content: "Encaminhe situacoes sensiveis para atendimento humano.",
          },
        ],
      }),
      "utf8",
    );

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "loader-example",
    preset: "lead-scheduling"
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md"
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.{md,txt,json}"
      },
      {
        type: "snapshot",
        path: "./agent-data/snapshot.json"
      }
    ]
  }
});`,
      "utf8",
    );

    const config = await loadAgentGuardConfig({ cwd });
    const loader = createSourceLoader();
    const loaded = await loader.load({ cwd, config });

    assert.equal(loaded.systemPrompt.sourcePath, "agent-data/system-prompt.md");
    assert.equal(loaded.knowledgeDocuments.length, 4);
    assert.ok(loaded.knowledgeChunks.length >= 4);
    assert.ok(loaded.knowledgeDocuments.every((entry) => entry.contentHash.length > 10));
    assert.ok(loaded.sourceHash.length > 10);
    assert.ok(
      loaded.knowledgeDocuments.some((entry) => entry.sourcePath.includes("snapshot.json")),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
