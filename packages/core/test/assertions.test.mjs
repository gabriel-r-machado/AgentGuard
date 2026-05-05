import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  normalizeTextForComparison,
  runAssertions,
  runTextAssertions,
} from "../dist/index.js";

test("passes mustInclude and mustNotInclude with case-insensitive normalized comparison", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        mustInclude: ["cafe\u0301 pronto", "hello world"],
        mustNotInclude: ["do not show"],
      },
    },
    responseText: "  cafe\u0301   PRONTO \n\n HeLLo    WORLD  ",
  });

  assert.deepEqual(failures, []);
});

test("reports missing required text with clear message", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        mustInclude: ["required token"],
      },
    },
    responseText: "safe response",
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /Missing required text "required token"/);
  assert.match(failures[0], /Response excerpt:/);
});

test("reports forbidden text with clear message", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        mustNotInclude: ["Top Secret"],
      },
    },
    responseText: "This output contains top   secret material.",
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /Found forbidden text "Top Secret"/);
  assert.match(failures[0], /case-insensitive/);
});

test("keeps assertions independent and returns one error per violation", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        mustInclude: ["first required", "second required"],
        mustNotInclude: ["forbidden one", "forbidden two"],
      },
    },
    responseText: "forbidden one appears here",
  });

  assert.equal(failures.length, 3);
  assert.match(failures[0], /first required/);
  assert.match(failures[1], /second required/);
  assert.match(failures[2], /forbidden one/);
});

test("normalization is stable for unicode and whitespace", () => {
  assert.equal(
    normalizeTextForComparison("  cafe\u0301\tWORLD  "),
    "caf\u00e9 world",
  );
});

test("reports invalid JSON clearly for zodSchema assertion", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        zodSchema: z.object({
          answer: z.string(),
        }),
      },
    },
    responseText: "{ invalid json",
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /Invalid JSON for zodSchema assertion/);
  assert.match(failures[0], /Response excerpt:/);
});

test("reports field-level zodSchema mismatch errors", () => {
  const failures = runTextAssertions({
    spec: {
      input: "any",
      expected: {
        zodSchema: z.object({
          answer: z.string(),
          shouldEscalateToHuman: z.boolean(),
        }),
      },
    },
    responseText: '{"answer":123,"shouldEscalateToHuman":"no"}',
  });

  assert.equal(failures.length, 2);
  assert.match(failures[0], /zodSchema validation failed at "answer"/);
  assert.match(failures[1], /zodSchema validation failed at "shouldEscalateToHuman"/);
});

test("judge assertion is experimental and non-critical when used alone", () => {
  const result = runAssertions({
    spec: {
      input: "any",
      expected: {
        judge: {
          rule: "response should mention refunds",
          threshold: 0.9,
        },
      },
    },
    responseText: "hello world",
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.judge.enabled, true);
  assert.equal(result.judge.passed, false);
  assert.equal(result.judge.nonCritical, true);
  assert.match(result.judge.rationale, /non-critical/);
});

test("judge assertion can fail critically when combined with deterministic assertions", () => {
  const result = runAssertions({
    spec: {
      input: "any",
      expected: {
        mustInclude: ["hello"],
        judge: {
          rule: "response should mention refunds",
          threshold: 0.9,
        },
      },
    },
    responseText: "hello world",
  });

  assert.equal(result.judge.enabled, true);
  assert.equal(result.judge.nonCritical, false);
  assert.equal(result.judge.passed, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /Judge assertion failed/);
});

test("tool call assertions pass when mustCall and mustNotCall contracts are respected", () => {
  const result = runAssertions({
    spec: {
      input: "any",
      expected: {
        toolCalls: {
          mustCall: ["lookupUser"],
          mustNotCall: ["deleteAccount"],
        },
      },
    },
    responseText: "ok",
    toolCalls: [
      { name: "lookupUser", arguments: { id: "u1" } },
      { name: "searchCatalog", arguments: { query: "a" } },
    ],
  });

  assert.deepEqual(result.failures, []);
});

test("tool call assertions report missing mustCall with actionable diagnostics", () => {
  const result = runAssertions({
    spec: {
      input: "any",
      expected: {
        toolCalls: {
          mustCall: ["lookupUser"],
        },
      },
    },
    responseText: "ok",
    toolCalls: [{ name: "searchCatalog", arguments: {} }],
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /mustCall/);
  assert.match(result.failures[0], /lookupUser/);
  assert.match(result.failures[0], /\[searchCatalog\]/);
});

test("tool call assertions report forbidden mustNotCall with actionable diagnostics", () => {
  const result = runAssertions({
    spec: {
      input: "any",
      expected: {
        toolCalls: {
          mustNotCall: ["deleteAccount"],
        },
      },
    },
    responseText: "ok",
    toolCalls: [{ name: "deleteAccount", arguments: { id: "u1" } }],
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /mustNotCall/);
  assert.match(result.failures[0], /deleteAccount/);
  assert.match(result.failures[0], /\[deleteAccount\]/);
});
