import assert from "node:assert/strict";
import test from "node:test";

import {
  createContentHash,
  createObjectHash,
  normalizeTextContent,
} from "../dist/index.js";

test("normalizes text content before hashing", () => {
  const first = "Hello\r\nworld  \r\n\r\n";
  const second = "Hello\nworld";

  assert.equal(normalizeTextContent(first), "Hello\nworld");
  assert.equal(createContentHash(first), createContentHash(second));
});

test("object hash is stable across key order", () => {
  const left = {
    beta: 2,
    alpha: {
      y: true,
      x: "value",
    },
  };
  const right = {
    alpha: {
      x: "value",
      y: true,
    },
    beta: 2,
  };

  assert.equal(createObjectHash(left), createObjectHash(right));
});
