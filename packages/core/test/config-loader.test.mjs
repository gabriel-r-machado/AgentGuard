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
    assert.equal(config.testsDir, "./ai-tests");
    assert.equal(config.maxCostPerRun, 0.2);
    assert.equal(config.timeoutMs, 30000);
    assert.equal(config.retries, 1);
    assert.equal(config.temperature, 0.1);
    assert.deepEqual(config.ci, { failOnInconclusive: true });
    assert.deepEqual(config.redaction, { enabled: true });
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
