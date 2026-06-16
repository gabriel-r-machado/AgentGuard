import assert from "node:assert/strict";
import test from "node:test";

import { createHttpAgentTarget } from "../dist/index.js";

const baseConfig = {
  provider: undefined,
  model: undefined,
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  timeoutMs: 50,
  retries: 1,
  temperature: 0.1,
  ci: { failOnInconclusive: true },
  redaction: { enabled: true },
  project: {
    name: "demo",
    locale: "pt-BR",
    preset: "customer-support",
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

const baseInput = {
  scenarioId: "scenario-1",
  scenarioTitle: "Demo scenario",
  category: "factual-question",
  severity: "medium",
  repetition: 1,
  turnIndex: 0,
  sessionId: "session-1",
  dryRun: true,
  userMessage: "Hello",
  history: [],
  systemPrompt: "Be helpful",
  metadata: {},
  timeoutMs: 50,
  retries: 1,
};

test("http target retries once and normalizes response fields", async () => {
  let calls = 0;
  const target = createHttpAgentTarget({
    target: {
      type: "http",
      url: "http://example.test/chat",
      request: {
        method: "POST",
      },
      response: {
        textPath: "$.reply.text",
        toolCallsPath: "$.toolCalls",
        retrievedContextPath: "$.retrievedContext",
        metadataPath: "$.meta",
        inputTokensPath: "$.usage.input",
        outputTokensPath: "$.usage.output",
      },
    },
    config: baseConfig,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("temporary failure", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          reply: { text: "grounded response" },
          toolCalls: [{ name: "lookupAvailability", arguments: { dryRun: true } }],
          retrievedContext: [{ text: "Hours are 08:00-18:00.", sourcePath: "knowledge/faq.md" }],
          meta: { ok: true },
          usage: { input: 12, output: 34 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await target.executeTurn(baseInput);

  assert.equal(calls, 2);
  assert.equal(result.text, "grounded response");
  assert.equal(result.retryCount, 1);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 34);
  assert.equal(result.toolCalls[0].name, "lookupAvailability");
  assert.equal(result.retrievedContext[0].sourcePath, "knowledge/faq.md");
  assert.deepEqual(result.metadata, { ok: true });
});

test("http target reports timeout cleanly", async () => {
  const target = createHttpAgentTarget({
    target: {
      type: "http",
      url: "http://example.test/chat",
      request: {
        timeoutMs: 5,
      },
      response: {
        textPath: "$.text",
      },
    },
    config: baseConfig,
    fetchFn: async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  });

  const result = await target.executeTurn({
    ...baseInput,
    retries: 0,
    timeoutMs: 5,
  });

  assert.equal(result.text, "");
  assert.equal(result.timedOut, true);
  assert.match(result.error ?? "", /aborted/i);
});

test("http target redacts interpolated secrets from failures", async () => {
  process.env.AGENTGUARD_SECRET = "super-secret-token";
  try {
    const target = createHttpAgentTarget({
      target: {
        type: "http",
        url: "http://example.test/chat?token=${AGENTGUARD_SECRET}",
        headers: {
          authorization: "Bearer ${AGENTGUARD_SECRET}",
        },
        response: {
          textPath: "$.text",
        },
      },
      config: baseConfig,
      fetchFn: async (url, init) =>
        new Response(`boom ${String(url)} ${String(init.headers.authorization)}`, {
          status: 500,
        }),
    });

    const result = await target.executeTurn({
      ...baseInput,
      retries: 0,
    });

    assert.equal(result.text, "");
    assert.doesNotMatch(result.error ?? "", /super-secret-token/);
    assert.match(result.error ?? "", /\[REDACTED:/);
  } finally {
    delete process.env.AGENTGUARD_SECRET;
  }
});
