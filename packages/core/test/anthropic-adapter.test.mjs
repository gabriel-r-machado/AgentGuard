import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  AgentGuardProviderError,
  createAnthropicProviderAdapter,
} from "../dist/index.js";

test("anthropic adapter returns normalized text output and usage", async () => {
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        create: async () => ({
          id: "msg-1",
          stop_reason: "end_turn",
          stop_details: null,
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", name: "lookup", input: { id: "a-1" } },
          ],
          usage: {
            input_tokens: 8,
            output_tokens: 5,
            cache_creation_input_tokens: 1,
            cache_read_input_tokens: 2,
          },
        }),
      },
    }),
  });

  const output = await adapter.invoke({
    model: "claude-sonnet-4-0",
    userInput: "hello",
  });

  assert.equal(output.text, "hello");
  assert.deepEqual(output.toolCalls, [{ name: "lookup", arguments: { id: "a-1" } }]);
  assert.deepEqual(output.usage, {
    inputTokens: 11,
    outputTokens: 5,
    cachedTokens: 3,
  });
  assert.equal(output.requestId, "msg-1");
});

test("anthropic adapter validates structured output", async () => {
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        parse: async () => ({
          id: "msg-2",
          stop_reason: "end_turn",
          stop_details: null,
          content: [{ type: "text", text: '{"answer":"ok"}' }],
          parsed_output: { answer: "ok" },
          usage: {
            input_tokens: 4,
            output_tokens: 3,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      },
    }),
  });

  const output = await adapter.invokeStructured({
    model: "claude-sonnet-4-0",
    userInput: "hello",
    schemaName: "Answer",
    schema: z.object({ answer: z.string() }),
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
    },
  });

  assert.deepEqual(output.object, { answer: "ok" });
});

test("anthropic adapter surfaces refusals clearly", async () => {
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        create: async () => ({
          id: "msg-3",
          stop_reason: "refusal",
          stop_details: {
            type: "refusal",
            category: "bio",
            explanation: "refused by policy",
          },
          content: [],
          usage: {
            input_tokens: 1,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "claude-sonnet-4-0",
        userInput: "forbidden",
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "blocked");
      assert.match(error.message, /refused by policy/);
      return true;
    },
  );
});

test("anthropic adapter times out for hanging sdk calls", async () => {
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        create: async () => await new Promise(() => {}),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "claude-sonnet-4-0",
        userInput: "hello",
        timeoutMs: 5,
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "timeout");
      return true;
    },
  );
});

test("anthropic adapter retries recoverable errors", async () => {
  let calls = 0;
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        create: async () => {
          calls += 1;
          if (calls === 1) {
            const error = new Error("server exploded anthropic-secret");
            error.status = 503;
            throw error;
          }
          return {
            id: "msg-4",
            stop_reason: "end_turn",
            stop_details: null,
            content: [{ type: "text", text: "" }],
            usage: {
              input_tokens: 2,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        },
      },
    }),
  });

  const output = await adapter.invoke({
    model: "claude-sonnet-4-0",
    userInput: "hello",
    retries: 1,
  });

  assert.equal(calls, 2);
  assert.equal(output.text, "");
});

test("anthropic adapter fails fast on invalid structured output and redacts secrets", async () => {
  const adapter = createAnthropicProviderAdapter({
    apiKey: "anthropic-secret",
    clientFactory: () => ({
      messages: {
        parse: async () => ({
          id: "msg-5",
          stop_reason: "end_turn",
          stop_details: null,
          content: [{ type: "text", text: '{"answer":123}' }],
          parsed_output: { answer: 123 },
          usage: {
            input_tokens: 4,
            output_tokens: 3,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invokeStructured({
        model: "claude-sonnet-4-0",
        userInput: "hello",
        schemaName: "Answer",
        schema: z.object({ answer: z.string() }),
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
          },
          required: ["answer"],
        },
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "invalid_response");
      assert.doesNotMatch(error.message, /anthropic-secret/);
      return true;
    },
  );
});
