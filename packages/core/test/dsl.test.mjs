import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  AgentGuardDslError,
  clearAgentTestRegistry,
  collectAgentTestsFromFiles,
  getRegisteredAgentTests,
  testAgent,
} from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-dsl-"));
}

test("throws on duplicate test names", () => {
  clearAgentTestRegistry();

  testAgent("duplicate-name", {
    input: "first",
    expected: {
      mustInclude: ["ok"],
    },
  });

  assert.throws(
    () =>
      testAgent("duplicate-name", {
        input: "second",
        expected: {
          mustInclude: ["ok"],
        },
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardDslError);
      assert.match(error.message, /Duplicate test name/);
      return true;
    },
  );
});

test("throws on invalid spec", () => {
  clearAgentTestRegistry();

  assert.throws(
    () =>
      testAgent("invalid-spec", {
        input: "",
        expected: {
          mustInclude: ["ok"],
        },
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardDslError);
      assert.match(error.message, /expected a non-empty string/);
      assert.match(error.message, /input/);
      return true;
    },
  );
});

test("throws on invalid snapshot spec", () => {
  clearAgentTestRegistry();

  assert.throws(
    () =>
      testAgent("invalid-snapshot", {
        input: "x",
        expected: {
          snapshot: {
            mode: "shape",
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardDslError);
      assert.match(error.message, /expected.snapshot.mode/);
      assert.match(error.message, /"contract" or "text"/);
      return true;
    },
  );
});

test("collects tests from files in predictable order", async () => {
  const cwd = createTempDir();
  clearAgentTestRegistry();
  try {
    const coreEntry = pathToFileURL(join(process.cwd(), "dist/index.js")).href;
    const first = join(cwd, "first.agentguard.test.ts");
    const second = join(cwd, "second.agentguard.test.ts");

    writeFileSync(
      first,
      `import { testAgent } from "${coreEntry}";
testAgent("test-1", {
  input: "a",
  expected: { mustInclude: ["x"] }
});
testAgent("test-2", {
  input: "b",
  expected: { mustNotInclude: ["y"] }
});`,
      "utf8",
    );

    writeFileSync(
      second,
      `import { testAgent } from "${coreEntry}";
testAgent("test-3", {
  input: "c",
  expected: { mustInclude: ["z"] }
});`,
      "utf8",
    );

    const collected = await collectAgentTestsFromFiles([first, second], { cwd: "." });

    assert.deepEqual(
      collected.map((entry) => entry.name),
      ["test-1", "test-2", "test-3"],
    );
    assert.deepEqual(
      getRegisteredAgentTests().map((entry) => entry.name),
      ["test-1", "test-2", "test-3"],
    );
  } finally {
    clearAgentTestRegistry();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collects tests from files that import testAgent from agentguard", async () => {
  const cwd = createTempDir();
  clearAgentTestRegistry();
  try {
    const sample = join(cwd, "agentguard-import.test.ts");

    writeFileSync(
      sample,
      `import { testAgent } from "agentguard";
testAgent("agentguard-import-ok", {
  input: "x",
  expected: { mustInclude: ["x"] }
});`,
      "utf8",
    );

    const collected = await collectAgentTestsFromFiles([sample], { cwd: "." });

    assert.equal(collected.length, 1);
    assert.equal(collected[0].name, "agentguard-import-ok");
  } finally {
    clearAgentTestRegistry();
    rmSync(cwd, { recursive: true, force: true });
  }
});
