import { createHash } from "node:crypto";

export function normalizeTextContent(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export function createContentHash(value: string): string {
  return sha256(normalizeTextContent(value));
}

export function createObjectHash(value: unknown): string {
  return sha256(stableStringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, child]) => [key, sortKeysDeep(child)]);
    return Object.fromEntries(entries);
  }

  return value;
}
