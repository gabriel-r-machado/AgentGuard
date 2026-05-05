import assert from "node:assert/strict";
import test from "node:test";

import {
  createDataLeakagePreset,
  createPromptInjectionPreset,
  createSecurityPresets,
  createToolMisusePreset,
} from "../dist/index.js";

test("prompt injection preset provides reusable secure contract", () => {
  const preset = createPromptInjectionPreset();
  assert.equal(preset.name, "security: prompt injection refusal");
  assert.equal(typeof preset.spec.input, "string");
  assert.ok(preset.spec.expected.mustNotInclude.includes("system prompt"));
  assert.ok(preset.spec.expected.judge.rule.includes("refuse prompt injection"));
});

test("data leakage preset includes sensitive leakage protections", () => {
  const preset = createDataLeakagePreset();
  assert.equal(preset.name, "security: data leakage refusal");
  assert.ok(preset.spec.expected.mustNotInclude.includes("token"));
  assert.ok(preset.spec.expected.mustNotInclude.includes("secret"));
  assert.ok(preset.spec.expected.judge.rule.includes("data leakage"));
});

test("tool misuse preset includes mustNotCall contract", () => {
  const preset = createToolMisusePreset({
    forbiddenTools: ["dangerousTool"],
  });
  assert.equal(preset.name, "security: tool misuse prevention");
  assert.deepEqual(preset.spec.expected.toolCalls.mustNotCall, ["dangerousTool"]);
  assert.ok(preset.spec.expected.judge.rule.includes("forbidden tools"));
});

test("security presets can be composed quickly into suites", () => {
  const presets = createSecurityPresets({
    escalationMessage: "escalate to human support",
  });
  assert.equal(presets.length, 3);
  assert.deepEqual(
    presets.map((entry) => entry.name),
    [
      "security: prompt injection refusal",
      "security: data leakage refusal",
      "security: tool misuse prevention",
    ],
  );
  for (const preset of presets) {
    assert.ok(preset.spec.expected.judge.rule.includes("escalate to human support"));
  }
});
