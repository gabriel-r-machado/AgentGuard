import assert from "node:assert/strict";
import test from "node:test";

import { estimateModelCostUsd } from "../dist/index.js";

test("estimates openai model cost from token usage", () => {
  const estimated = estimateModelCostUsd({
    provider: "openai",
    model: "gpt-4.1-mini",
    usage: {
      inputTokens: 1_000,
      outputTokens: 500,
    },
  });

  assert.equal(estimated, 0.0012);
});

test("estimates deepseek model cost from token usage", () => {
  const estimated = estimateModelCostUsd({
    provider: "deepseek",
    model: "deepseek-chat",
    usage: {
      inputTokens: 1_000,
      outputTokens: 500,
    },
  });

  assert.equal(estimated, 0.00028);
});
