import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentTestSpec, SnapshotMode } from "./types.js";

export type SnapshotAssertionResult = {
  failures: string[];
  created: boolean;
  snapshotPath?: string;
};

type StoredSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  mode: SnapshotMode;
  updatedAt: string;
  value: SnapshotValue;
};

type SnapshotValue =
  | { kind: "text" }
  | {
      kind: "json";
      contract: JsonContractNode;
    }
  | {
      kind: "exact";
      value: string;
    };

type JsonContractNode =
  | { type: "null" }
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; itemShapes: JsonContractNode[] }
  | { type: "object"; keys: string[]; properties: Record<string, JsonContractNode> };

export function runSnapshotAssertion(options: {
  cwd: string;
  testId: string;
  spec: AgentTestSpec;
  responseText: string;
  timestamp?: Date;
}): SnapshotAssertionResult {
  const snapshotSpec = options.spec.expected.snapshot;
  if (!snapshotSpec) {
    return { failures: [], created: false };
  }

  const enabled = snapshotSpec.enabled ?? true;
  if (!enabled) {
    return { failures: [], created: false };
  }

  const mode: SnapshotMode = snapshotSpec.mode ?? "contract";
  const snapshotId = sanitizeSnapshotId(snapshotSpec.id ?? options.testId);
  const snapshotsDir = join(options.cwd, ".agentguard", "snapshots");
  const snapshotPath = join(snapshotsDir, `${snapshotId}.json`);

  const value =
    mode === "text"
      ? ({ kind: "exact", value: options.responseText } as const)
      : buildContractValue(options.responseText);

  const nextSnapshot: StoredSnapshot = {
    schemaVersion: 1,
    snapshotId,
    mode,
    updatedAt: (options.timestamp ?? new Date()).toISOString(),
    value,
  };

  if (!existsSync(snapshotPath)) {
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`, "utf8");
    return { failures: [], created: true, snapshotPath };
  }

  const current = readSnapshotFile(snapshotPath);
  if ("error" in current) {
    return { failures: [current.error], created: false, snapshotPath };
  }

  const previous = current.snapshot;
  const failures: string[] = [];

  if (previous.mode !== mode) {
    failures.push(
      `Snapshot mode mismatch for "${options.testId}": expected "${mode}" but snapshot file is "${previous.mode}" at "${snapshotPath}". Delete the snapshot file to recreate it with the new mode.`,
    );
    return { failures, created: false, snapshotPath };
  }

  if (!areValuesEqual(previous.value, value)) {
    failures.push(
      `Snapshot assertion failed for "${options.testId}" in "${mode}" mode. Stored snapshot does not match current response contract at "${snapshotPath}".`,
    );
  }

  return { failures, created: false, snapshotPath };
}

function readSnapshotFile(snapshotPath: string): { snapshot: StoredSnapshot } | { error: string } {
  try {
    const raw = readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as StoredSnapshot;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.snapshotId !== "string" ||
      (parsed.mode !== "contract" && parsed.mode !== "text")
    ) {
      return {
        error: `Invalid snapshot file format at "${snapshotPath}". Delete the file so AgentGuard can recreate it.`,
      };
    }
    return { snapshot: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      error: `Failed to read snapshot file "${snapshotPath}": ${reason}.`,
    };
  }
}

function areValuesEqual(left: SnapshotValue, right: SnapshotValue): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForComparison(value));
}

function sortForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForComparison);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, sortForComparison(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function buildContractValue(responseText: string): SnapshotValue {
  const parsed = parseJsonIfPresent(responseText);
  if (parsed.success) {
    return {
      kind: "json",
      contract: buildJsonContract(parsed.value),
    };
  }

  return { kind: "text" };
}

function parseJsonIfPresent(responseText: string): { success: true; value: unknown } | { success: false } {
  const trimmed = responseText.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return { success: false };
  }

  try {
    return { success: true, value: JSON.parse(trimmed) };
  } catch {
    return { success: false };
  }
}

function buildJsonContract(value: unknown): JsonContractNode {
  if (value === null) {
    return { type: "null" };
  }

  if (typeof value === "string") {
    return { type: "string" };
  }

  if (typeof value === "number") {
    return { type: "number" };
  }

  if (typeof value === "boolean") {
    return { type: "boolean" };
  }

  if (Array.isArray(value)) {
    const byShape = new Map<string, JsonContractNode>();
    for (const entry of value) {
      const shape = buildJsonContract(entry);
      byShape.set(stableStringify(shape), shape);
    }
    return {
      type: "array",
      itemShapes: [...byShape.values()].sort((a, b) =>
        stableStringify(a).localeCompare(stableStringify(b), "en-US"),
      ),
    };
  }

  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort((a, b) => a.localeCompare(b, "en-US"));
    const properties: Record<string, JsonContractNode> = {};
    for (const key of keys) {
      properties[key] = buildJsonContract(object[key]);
    }
    return {
      type: "object",
      keys,
      properties,
    };
  }

  return { type: "string" };
}

function sanitizeSnapshotId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (normalized.length === 0) {
    return "snapshot";
  }
  return normalized.toLocaleLowerCase("en-US");
}
