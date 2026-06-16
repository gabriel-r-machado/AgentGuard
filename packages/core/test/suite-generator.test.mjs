import assert from "node:assert/strict";
import test from "node:test";

import {
  createScenarioGenerator,
  testSuiteSchema,
} from "../dist/index.js";

const baseContract = {
  schemaVersion: 1,
  generatedAt: "2026-06-08T00:00:00.000Z",
  sourceHash: "source-hash",
  identity: {
    projectName: "demo",
    locale: "pt-BR",
    preset: "healthcare-lead-scheduling",
  },
  objectives: ["Qualificar e encaminhar o usuario com seguranca."],
  tone: {
    summary: "Tone summary",
    traits: ["friendly", "professional"],
  },
  systemPromptInstructions: [],
  requiredBehaviors: [{ id: "rb-1", statement: "Seja claro", sourceRefs: [] }],
  forbiddenBehaviors: [{ id: "fb-1", statement: "Nao invente", sourceRefs: [] }],
  supportedTopics: ["scheduling"],
  outOfScopeTopics: ["diagnosis"],
  facts: [
    {
      id: "fact-1",
      statement: "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
      sourceRefs: [
        {
          documentId: "doc-1",
          chunkId: "doc-1-chunk-001",
          sourcePath: "knowledge/faq.md",
          excerpt: "Horarios disponiveis",
        },
      ],
      confidence: 0.9,
      category: "scheduling",
    },
  ],
  businessRules: [],
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
  escalationRules: [],
  toolPolicies: [],
  safetyPolicies: [],
  unknownInformation: [
    {
      id: "unknown-1",
      topic: "diagnosis",
      reason: "Not documented",
    },
  ],
};

const baseConfig = {
  provider: undefined,
  model: undefined,
  llm: {
    generator: {
      provider: undefined,
      model: undefined,
      temperature: 0.1,
      timeoutMs: 30000,
      retries: 1,
    },
    judge: {
      provider: undefined,
      model: undefined,
      temperature: 0.1,
      timeoutMs: 30000,
      retries: 1,
    },
  },
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  timeoutMs: 30000,
  retries: 1,
  temperature: 0.1,
  ci: { failOnInconclusive: true },
  redaction: { enabled: true },
  project: {
    name: "demo",
    locale: "pt-BR",
    preset: "healthcare-lead-scheduling",
  },
  sources: {
    systemPrompt: undefined,
    knowledge: [],
  },
  generation: {
    scenarios: 24,
    maxTurns: 4,
    seed: 42,
  },
  scan: {
    dryRunTools: true,
    llmProvider: undefined,
    llmModel: undefined,
    target: undefined,
    concurrency: 2,
    repetitions: {
      default: 1,
      high: 1,
      critical: 2,
    },
    reportHtml: true,
  },
};

test("scenario generator is deterministic for the same seed", async () => {
  const generator = createScenarioGenerator();
  const first = await generator.generate({
    config: baseConfig,
    contract: baseContract,
    sources: {
      systemPrompt: {
        id: "system-prompt",
        title: "Prompt",
        content: "Seja claro",
        sourcePath: "system-prompt.md",
        metadata: {},
        contentHash: "hash",
      },
      knowledgeDocuments: [],
      knowledgeChunks: [],
      sourceHash: "source-hash",
    },
    timestamp: new Date("2026-06-08T00:00:00.000Z"),
  });
  const second = await generator.generate({
    config: baseConfig,
    contract: baseContract,
    sources: {
      systemPrompt: {
        id: "system-prompt",
        title: "Prompt",
        content: "Seja claro",
        sourcePath: "system-prompt.md",
        metadata: {},
        contentHash: "hash",
      },
      knowledgeDocuments: [],
      knowledgeChunks: [],
      sourceHash: "source-hash",
    },
    timestamp: new Date("2026-06-08T00:00:00.000Z"),
  });

  testSuiteSchema.parse(first);
  testSuiteSchema.parse(second);
  assert.deepEqual(first.scenarios, second.scenarios);
  assert.equal(first.scenarios.length, 24);
});
