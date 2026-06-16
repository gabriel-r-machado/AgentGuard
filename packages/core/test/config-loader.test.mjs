import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { AgentGuardConfigError, loadAgentGuardConfig } from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-config-"));
}

test("loads valid config and applies defaults", async () => {
  const cwd = createTempDir();
  try {
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini"
};`,
      "utf8",
    );

    const config = await loadAgentGuardConfig({ cwd });

    assert.equal(config.provider, "openai");
    assert.equal(config.model, "gpt-4.1-mini");
    assert.deepEqual(config.llm, {
      generator: {
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.1,
        timeoutMs: 30000,
        retries: 1,
      },
      judge: {
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.1,
        timeoutMs: 30000,
        retries: 1,
      },
    });
    assert.equal(config.testsDir, "./ai-tests");
    assert.equal(config.maxCostPerRun, 0.2);
    assert.equal(config.timeoutMs, 30000);
    assert.equal(config.retries, 1);
    assert.equal(config.temperature, 0.1);
    assert.deepEqual(config.ci, { failOnInconclusive: true });
    assert.deepEqual(config.redaction, { enabled: true });
    assert.deepEqual(config.project, {
      name: cwd.split(/[/\\]/u).pop(),
      locale: "en-US",
      preset: "customer-support",
    });
    assert.deepEqual(config.sources, {
      systemPrompt: undefined,
      knowledge: [],
    });
    assert.deepEqual(config.generation, {
      scenarios: 24,
      maxTurns: 4,
      seed: 42,
    });
    assert.deepEqual(config.scan, {
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
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("supports defineConfig with V1 scan fields", async () => {
  const cwd = createTempDir();
  try {
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "clinic-lead-agent",
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
        pattern: "./agent-data/knowledge/**/*.{md,txt,json}"
      }
    ]
  },
  generation: {
    scenarios: 40,
    maxTurns: 6,
    seed: 42
  }
});`,
      "utf8",
    );

    const config = await loadAgentGuardConfig({ cwd });
    assert.equal(config.project.name, "clinic-lead-agent");
    assert.equal(config.project.locale, "pt-BR");
    assert.equal(config.project.preset, "healthcare-lead-scheduling");
    assert.equal(config.sources.systemPrompt.type, "file");
    assert.equal(config.sources.systemPrompt.path, "./agent-data/system-prompt.md");
    assert.equal(config.sources.knowledge.length, 1);
    assert.equal(config.sources.knowledge[0].type, "glob");
    assert.equal(config.generation.scenarios, 40);
    assert.equal(config.generation.maxTurns, 6);
    assert.equal(config.generation.seed, 42);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("supports distinct llm generator and judge roles", async () => {
  const cwd = createTempDir();
  try {
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  llm: {
    generator: {
      provider: "gemini",
      model: "gemini-2.5-flash",
      retries: 3
    },
    judge: {
      provider: "anthropic",
      model: "claude-sonnet-4-0",
      timeoutMs: 45000
    }
  }
};`,
      "utf8",
    );

    const config = await loadAgentGuardConfig({ cwd });
    assert.deepEqual(config.llm.generator, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      temperature: 0.1,
      timeoutMs: 30000,
      retries: 3,
    });
    assert.deepEqual(config.llm.judge, {
      provider: "anthropic",
      model: "claude-sonnet-4-0",
      temperature: 0.1,
      timeoutMs: 45000,
      retries: 1,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("throws actionable error for invalid config", async () => {
  const cwd = createTempDir();
  try {
    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "invalid-provider",
  model: "gpt-4.1-mini"
};`,
      "utf8",
    );

    await assert.rejects(
      () => loadAgentGuardConfig({ cwd }),
      (error) => {
        assert.ok(error instanceof AgentGuardConfigError);
        assert.match(error.message, /config\.provider/);
        assert.match(error.message, /openai/);
        assert.match(error.message, /deepseek/);
        return true;
      },
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
