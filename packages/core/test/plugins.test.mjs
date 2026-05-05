import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  AGENTGUARD_PLUGIN_API_VERSION,
  AgentGuardPluginError,
  createPluginRuntime,
  runAgentTests,
} from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-plugins-"));
}

test("external plugin can register a custom assertion", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("plugin-assertion", {
  input: "reply",
  expected: {}
});`,
      "utf8",
    );

    const plugin = {
      name: "sample-plugin",
      apiVersion: AGENTGUARD_PLUGIN_API_VERSION,
      setup(api) {
        api.registerAssertion({
          id: "requires-safe-tag",
          run(context) {
            if (!context.responseText.includes("[SAFE]")) {
              return ['response must include "[SAFE]" marker'];
            }
            return [];
          },
        });
      },
    };

    const result = await runAgentTests({
      cwd,
      plugins: [plugin],
      executor: async () => ({
        status: "passed",
        responseText: "plain response",
      }),
    });

    assert.equal(result.summary.failed, 1);
    assert.equal(result.results[0].status, "failed");
    assert.match(result.results[0].failures[0], /\[plugin:requires-safe-tag\]/);
    assert.match(result.results[0].failures[0], /\[SAFE\]/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plugin runtime fails fast on unsupported apiVersion", () => {
  assert.throws(
    () =>
      createPluginRuntime([
        {
          name: "legacy-plugin",
          apiVersion: 999,
          setup() {},
        },
      ]),
    (error) => {
      assert.ok(error instanceof AgentGuardPluginError);
      assert.match(error.message, /Unsupported plugin apiVersion/);
      return true;
    },
  );
});

test("plugin runtime reports setup failures with plugin name", () => {
  assert.throws(
    () =>
      createPluginRuntime([
        {
          name: "broken-plugin",
          apiVersion: AGENTGUARD_PLUGIN_API_VERSION,
          setup() {
            throw new Error("missing env var");
          },
        },
      ]),
    (error) => {
      assert.ok(error instanceof AgentGuardPluginError);
      assert.match(error.message, /Plugin "broken-plugin" setup failed/);
      assert.match(error.message, /missing env var/);
      return true;
    },
  );
});

test("plugin assertion output type errors are actionable", async () => {
  const cwd = createTempDir();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const testsDir = join(cwd, "ai-tests");
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(cwd, "agentguard.config.ts"),
      `export default {
  provider: "openai",
  model: "gpt-4.1-mini",
  testsDir: "./ai-tests"
};`,
      "utf8",
    );

    writeFileSync(
      join(testsDir, "suite.test.ts"),
      `import { testAgent } from "${coreEntry}";
testAgent("plugin-output-error", {
  input: "reply",
  expected: {}
});`,
      "utf8",
    );

    const result = await runAgentTests({
      cwd,
      plugins: [
        {
          name: "bad-output-plugin",
          apiVersion: AGENTGUARD_PLUGIN_API_VERSION,
          setup(api) {
            api.registerAssertion({
              id: "returns-string-not-array",
              run() {
                return "bad output";
              },
            });
          },
        },
      ],
      executor: async () => ({
        status: "passed",
        responseText: "ok",
      }),
    });

    assert.equal(result.summary.failed, 1);
    assert.match(
      result.results[0].failures[0],
      /invalid plugin assertion output from "returns-string-not-array"/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
