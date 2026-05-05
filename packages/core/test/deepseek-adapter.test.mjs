import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentGuardProviderError,
  createDeepSeekProviderAdapter,
} from "../dist/index.js";

test("deepseek adapter returns normalized output", async () => {
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        usage: {
          prompt_tokens: 9,
          completion_tokens: 6,
        },
        choices: [
          {
            message: {
              content: '{"answer":"deepseek-ok"}',
              tool_calls: [
                {
                  function: {
                    name: "lookup",
                    arguments: '{"id":"456"}',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const adapter = createDeepSeekProviderAdapter({
    apiKey: "test-key",
    fetchFn,
  });

  const output = await adapter.invoke({
    model: "deepseek-chat",
    userInput: "hello",
    timeoutMs: 1000,
  });

  assert.equal(output.text, '{"answer":"deepseek-ok"}');
  assert.deepEqual(output.json, { answer: "deepseek-ok" });
  assert.deepEqual(output.toolCalls, [{ name: "lookup", arguments: { id: "456" } }]);
  assert.deepEqual(output.usage, { inputTokens: 9, outputTokens: 6 });
  assert.ok(output.raw);
});

test("deepseek adapter returns clear auth error", async () => {
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        error: { message: "invalid_api_key" },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );

  const adapter = createDeepSeekProviderAdapter({
    apiKey: "bad-key",
    fetchFn,
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "deepseek-chat",
        userInput: "hello",
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "auth");
      assert.match(error.message, /DeepSeek authentication failed/);
      return true;
    },
  );
});

test("deepseek adapter returns clear timeout error", async () => {
  const fetchFn = (_, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const adapter = createDeepSeekProviderAdapter({
    apiKey: "test-key",
    fetchFn,
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "deepseek-chat",
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
