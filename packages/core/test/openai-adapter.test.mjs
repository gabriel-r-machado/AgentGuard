import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentGuardProviderError,
  createOpenAIProviderAdapter,
} from "../dist/index.js";

test("openai adapter returns normalized output", async () => {
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
        },
        choices: [
          {
            message: {
              content: '{"answer":"ok"}',
              tool_calls: [
                {
                  function: {
                    name: "lookup",
                    arguments: '{"id":"123"}',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const adapter = createOpenAIProviderAdapter({
    apiKey: "test-key",
    fetchFn,
  });

  const output = await adapter.invoke({
    model: "gpt-4.1-mini",
    userInput: "hello",
    timeoutMs: 1000,
  });

  assert.equal(output.text, '{"answer":"ok"}');
  assert.deepEqual(output.json, { answer: "ok" });
  assert.deepEqual(output.toolCalls, [{ name: "lookup", arguments: { id: "123" } }]);
  assert.deepEqual(output.usage, { inputTokens: 12, outputTokens: 8 });
  assert.ok(output.raw);
});

test("openai adapter returns clear auth error", async () => {
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        error: { message: "invalid_api_key" },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );

  const adapter = createOpenAIProviderAdapter({
    apiKey: "bad-key",
    fetchFn,
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "gpt-4.1-mini",
        userInput: "hello",
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "auth");
      assert.match(error.message, /OpenAI authentication failed/);
      return true;
    },
  );
});

test("openai adapter returns clear timeout error", async () => {
  const fetchFn = (_, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const adapter = createOpenAIProviderAdapter({
    apiKey: "test-key",
    fetchFn,
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "gpt-4.1-mini",
        userInput: "hello",
        timeoutMs: 5,
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "timeout");
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});
