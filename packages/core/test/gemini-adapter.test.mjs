import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  AgentGuardProviderError,
  createGeminiProviderAdapter,
} from "../dist/index.js";

test("gemini adapter returns normalized text output and usage", async () => {
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => ({
          text: '{"answer":"ok"}',
          functionCalls: [{ name: "lookup", args: { id: "g-1" } }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 7,
            totalTokenCount: 17,
            cachedContentTokenCount: 2,
          },
          responseId: "resp-1",
          candidates: [{ finishReason: "STOP" }],
        }),
      },
    }),
  });

  const output = await adapter.invoke({
    model: "gemini-2.5-flash",
    userInput: "hello",
  });

  assert.equal(output.text, '{"answer":"ok"}');
  assert.deepEqual(output.json, { answer: "ok" });
  assert.deepEqual(output.toolCalls, [{ name: "lookup", arguments: { id: "g-1" } }]);
  assert.deepEqual(output.usage, {
    inputTokens: 10,
    outputTokens: 7,
    totalTokens: 17,
    cachedTokens: 2,
  });
  assert.equal(output.finishReason, "STOP");
  assert.equal(output.requestId, "resp-1");
});

test("gemini adapter validates structured output", async () => {
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => ({
          text: '{"answer":"ok"}',
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 3,
          },
        }),
      },
    }),
  });

  const output = await adapter.invokeStructured({
    model: "gemini-2.5-flash",
    userInput: "hello",
    schemaName: "Answer",
    schema: z.object({ answer: z.string() }),
  });

  assert.deepEqual(output.object, { answer: "ok" });
});

test("gemini adapter surfaces blocked content clearly", async () => {
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => ({
          text: "",
          promptFeedback: {
            blockReason: "SAFETY",
            blockReasonMessage: "blocked by policy",
          },
        }),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "gemini-2.5-flash",
        userInput: "forbidden",
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "blocked");
      assert.match(error.message, /blocked by policy/);
      return true;
    },
  );
});

test("gemini adapter times out for hanging sdk calls", async () => {
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => await new Promise(() => {}),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "gemini-2.5-flash",
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

test("gemini adapter retries recoverable errors and redacts secrets", async () => {
  let calls = 0;
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            const error = new Error("temporary gemini-secret outage");
            error.status = 503;
            throw error;
          }
          return { text: "ok" };
        },
      },
    }),
  });

  const output = await adapter.invoke({
    model: "gemini-2.5-flash",
    userInput: "hello",
    retries: 1,
  });

  assert.equal(calls, 2);
  assert.equal(output.text, "ok");
});

test("gemini adapter fails fast on invalid structured output", async () => {
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => ({
          text: '{"answer":123}',
        }),
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invokeStructured({
        model: "gemini-2.5-flash",
        userInput: "hello",
        schemaName: "Answer",
        schema: z.object({ answer: z.string() }),
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "invalid_response");
      return true;
    },
  );
});

test("gemini adapter does not retry non-recoverable sdk errors", async () => {
  let calls = 0;
  const adapter = createGeminiProviderAdapter({
    apiKey: "gemini-secret",
    clientFactory: () => ({
      models: {
        generateContent: async () => {
          calls += 1;
          const error = new Error("bad request for gemini-secret");
          error.status = 400;
          throw error;
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      adapter.invoke({
        model: "gemini-2.5-flash",
        userInput: "hello",
        retries: 2,
      }),
    (error) => {
      assert.ok(error instanceof AgentGuardProviderError);
      assert.equal(error.code, "provider");
      assert.doesNotMatch(error.message, /gemini-secret/);
      return true;
    },
  );
  assert.equal(calls, 1);
});
