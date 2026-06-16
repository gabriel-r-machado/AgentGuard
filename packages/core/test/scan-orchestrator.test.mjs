import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runScan } from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-scan-"));
}

function writeFixture(cwd) {
  mkdirSync(join(cwd, "agent-data", "knowledge"), { recursive: true });
  writeFileSync(
    join(cwd, "agent-data", "system-prompt.md"),
    [
      "Use tom acolhedor e profissional.",
      "Nao invente informacoes.",
      "Colete nome e telefone antes de sugerir agendamento.",
      "Encaminhe situacoes sensiveis para atendimento humano.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agent-data", "knowledge", "faq.md"),
    [
      "Atendimento inicial por mensagem.",
      "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
      "Nao oferecemos orientacao clinica por chat.",
    ].join("\n\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agentguard.config.ts"),
    `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "scan-example",
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
  },
  generation: {
    scenarios: 30,
    maxTurns: 5,
    seed: 42
  }
});`,
    "utf8",
  );
}

test("scan creates artifacts, reuses them, and detects stale sources", async () => {
  const cwd = createTempDir();
  try {
    writeFixture(cwd);

    const first = await runScan({ cwd, dryRun: true });
    assert.equal(first.contractStatus, "created");
    assert.equal(first.suiteStatus, "created");
    assert.equal(first.requiresRegenerate, false);
    assert.match(readFileSync(first.artifactPaths.contract, "utf8"), /"schemaVersion": 1/);
    assert.match(readFileSync(first.artifactPaths.suite, "utf8"), /"schemaVersion": 1/);
    assert.match(readFileSync(first.artifactPaths.manifest, "utf8"), /"schemaVersion": 1/);

    const second = await runScan({ cwd, dryRun: true });
    assert.equal(second.contractStatus, "reused");
    assert.equal(second.suiteStatus, "reused");
    assert.equal(second.requiresRegenerate, false);

    const forced = await runScan({ cwd, dryRun: true, regenerate: true });
    assert.equal(forced.contractStatus, "regenerated");
    assert.equal(forced.suiteStatus, "regenerated");
    assert.equal(forced.requiresRegenerate, false);

    writeFileSync(
      join(cwd, "agent-data", "knowledge", "faq.md"),
      [
        "Atendimento inicial por mensagem.",
        "Horarios disponiveis: segunda a sabado, 08:00-18:00.",
        "Nao oferecemos orientacao clinica por chat.",
      ].join("\n\n"),
      "utf8",
    );

    const stale = await runScan({ cwd, dryRun: true });
    assert.equal(stale.contractStatus, "stale");
    assert.equal(stale.suiteStatus, "stale");
    assert.equal(stale.requiresRegenerate, true);
    assert.match(stale.warnings[0], /Source content changed/);

    const regenerated = await runScan({ cwd, dryRun: true, regenerate: true });
    assert.equal(regenerated.contractStatus, "regenerated");
    assert.equal(regenerated.suiteStatus, "regenerated");
    assert.equal(regenerated.requiresRegenerate, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scan routes generator and judge work through separate llm roles", async () => {
  const cwd = createTempDir();
  try {
    writeFixture(cwd);
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `import { defineConfig } from "agentguard";

export default defineConfig({
  provider: "openai",
  model: "gpt-4.1-mini",
  llm: {
    generator: {
      provider: "gemini",
      model: "gemini-gen-model"
    },
    judge: {
      provider: "anthropic",
      model: "claude-judge-model"
    }
  },
  project: {
    name: "scan-example",
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
  },
  generation: {
    scenarios: 2,
    maxTurns: 2,
    seed: 42
  },
  scan: {
    target: {
      type: "http",
      url: "http://example.test/chat",
      response: {
        textPath: "$.text"
      }
    }
  }
});`,
      "utf8",
    );

    const generatorCalls = [];
    const judgeCalls = [];
    const generatorProvider = {
      name: "generator-stub",
      provider: "gemini",
      generate: async () => ({ text: "", raw: {} }),
      generateText: async () => ({ text: "", raw: {} }),
      generateStructured: async (input) => {
        generatorCalls.push({ schemaName: input.schemaName, model: input.model });
        if (input.schemaName === "AgentContractDraft") {
          return {
            text: "",
            raw: {},
            object: {
              objectives: ["Grounded objective"],
              tone: { summary: "Friendly", traits: ["friendly"] },
              systemPromptInstructions: ["Use tom acolhedor e profissional."],
              requiredBehaviors: ["Colete nome e telefone antes de sugerir agendamento."],
              forbiddenBehaviors: ["Nao invente informacoes."],
              supportedTopics: ["scheduling"],
              outOfScopeTopics: ["diagnosis"],
              facts: [
                {
                  statement: "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
                  confidence: 0.9,
                  category: "scheduling",
                },
              ],
              businessRules: ["Encaminhe situacoes sensiveis para atendimento humano."],
              leadQualification: {
                signals: [],
                requiredFields: ["name", "phone"],
                optionalFields: [],
                unknowns: [],
              },
              schedulingPolicy: {
                rules: ["Nao agendar antes da confirmacao."],
                requiredFields: ["confirmation"],
                unknowns: [],
              },
              escalationRules: ["Encaminhe situacoes sensiveis para atendimento humano."],
              toolPolicies: [],
              safetyPolicies: ["Nao ofereca orientacao clinica por chat."],
              unknownInformation: [{ topic: "diagnosis", reason: "Not documented" }],
            },
          };
        }

        return {
          text: "",
          raw: {},
          object: {
            scenarios: [
              {
                title: "Grounded factual check",
                category: "factual-question",
                severity: "medium",
                description: "Checks grounded answers.",
                turns: [
                  { role: "user", message: "Quais horarios voces atendem?" },
                  { role: "user", message: "Responda somente com base no material." },
                ],
                expectations: {
                  requiredBehaviors: ["Colete nome e telefone antes de sugerir agendamento."],
                  forbiddenBehaviors: ["Nao invente informacoes."],
                  requiredFields: [],
                  shouldEscalate: false,
                  shouldRefuse: false,
                  shouldMaintainTone: true,
                  mustUseKnownFacts: true,
                  expectedUnknownTopics: [],
                  notes: ["Stay grounded."],
                  deterministic: {
                    mustInclude: [],
                    mustNotInclude: [],
                    regex: [],
                    allowEmptyResponse: false,
                    toolCallOrder: [],
                    toolArgumentAssertions: [],
                  },
                },
                requiredToolCalls: [],
                forbiddenToolCalls: [],
                tags: ["grounded"],
              },
            ],
          },
        };
      },
    };
    const judgeProvider = {
      name: "judge-stub",
      provider: "anthropic",
      generate: async () => ({ text: "", raw: {} }),
      generateText: async () => ({ text: "", raw: {} }),
      generateStructured: async (input) => {
        judgeCalls.push({ schemaName: input.schemaName, model: input.model });
        return {
          text: "",
          raw: {},
          object: {
            passed: true,
            score: 0.9,
            severity: "low",
            reason: "Grounded",
            evidence: ["Used the configured judge role."],
            supportedClaims: ["Horarios disponiveis: segunda a sexta, 08:00-18:00."],
            unsupportedClaims: [],
            violatedRules: [],
            confidence: 0.9,
            recommendations: ["Keep grounding answers in the documented schedule."],
          },
        };
      },
    };

    const result = await runScan({
      cwd,
      dryRun: true,
      regenerate: true,
      generatorLlmProvider: generatorProvider,
      judgeLlmProvider: judgeProvider,
      targetFetch: async () =>
        new Response(JSON.stringify({ text: "Atendemos de segunda a sexta, 08:00-18:00." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    assert.deepEqual(generatorCalls, [
      { schemaName: "AgentContractDraft", model: "gemini-gen-model" },
      { schemaName: "GeneratedScenarioSuiteDraft", model: "gemini-gen-model" },
    ]);
    assert.equal(judgeCalls.every((entry) => entry.model === "claude-judge-model"), true);
    assert.equal(result.scenarioResults.length > 0, true);
    assert.equal(result.config.scan.target.type, "http");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
