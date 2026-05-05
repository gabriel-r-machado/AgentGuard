import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import ts from "typescript";

import type { AgentTestSpec } from "./types.js";

export type RegisteredAgentTest = {
  name: string;
  spec: AgentTestSpec;
};

export type CollectAgentTestsOptions = {
  cwd?: string;
  resetRegistry?: boolean;
};

export class AgentGuardDslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGuardDslError";
  }
}

class AgentTestRegistry {
  #tests: RegisteredAgentTest[] = [];
  #names = new Set<string>();

  register(name: string, spec: AgentTestSpec): void {
    validateAgentTestName(name);
    validateAgentTestSpec(spec, name);

    if (this.#names.has(name)) {
      throw new AgentGuardDslError(
        `Duplicate test name "${name}". Each testAgent(name, spec) entry must have a unique name.`,
      );
    }

    this.#tests.push({
      name,
      spec: cloneSpec(spec),
    });
    this.#names.add(name);
  }

  list(): RegisteredAgentTest[] {
    return this.#tests.map((entry) => ({
      name: entry.name,
      spec: cloneSpec(entry.spec),
    }));
  }

  clear(): void {
    this.#tests = [];
    this.#names.clear();
  }
}

const registry = new AgentTestRegistry();
let importNonce = 0;
const SELF_PACKAGE_ENTRY_URL = new URL("./index.js", import.meta.url).href;

export function testAgent(name: string, spec: AgentTestSpec): void {
  registry.register(name, spec);
}

export function getRegisteredAgentTests(): RegisteredAgentTest[] {
  return registry.list();
}

export function clearAgentTestRegistry(): void {
  registry.clear();
}

export async function collectAgentTestsFromFiles(
  files: string[],
  options: CollectAgentTestsOptions = {},
): Promise<RegisteredAgentTest[]> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new AgentGuardDslError(
      "collectAgentTestsFromFiles(files) requires at least one test file path.",
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const resetRegistry = options.resetRegistry ?? true;

  if (resetRegistry) {
    registry.clear();
  }

  for (const file of files) {
    if (typeof file !== "string" || file.trim() === "") {
      throw new AgentGuardDslError(`Invalid test file path "${String(file)}".`);
    }

    const absolutePath = resolve(cwd, file);
    const source = readFileSync(absolutePath, "utf8");
    const rewrittenSource = rewriteAgentGuardImports(source);
    const output = ts.transpileModule(rewrittenSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: absolutePath,
    });

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(
      output.outputText,
      "utf8",
    ).toString("base64")}#${importNonce++}`;

    try {
      await import(moduleUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AgentGuardDslError(
        `Failed to load test file "${absolutePath}". Ensure it only contains valid testAgent(...) registrations.\nCause: ${reason}`,
      );
    }
  }

  return registry.list();
}

function rewriteAgentGuardImports(source: string): string {
  return source
    .replace(/from\s+["']agentguard["']/g, `from "${SELF_PACKAGE_ENTRY_URL}"`)
    .replace(/from\s+["']@agentguard\/core["']/g, `from "${SELF_PACKAGE_ENTRY_URL}"`);
}

function validateAgentTestName(name: string): void {
  if (typeof name !== "string" || name.trim() === "") {
    throw new AgentGuardDslError(
      `Invalid test name ${formatValue(name)}. testAgent(name, spec) requires a non-empty string name.`,
    );
  }
}

function validateAgentTestSpec(spec: AgentTestSpec, name: string): void {
  if (!isObject(spec)) {
    throw new AgentGuardDslError(
      `Invalid spec for test "${name}": spec must be an object.`,
    );
  }

  if (typeof spec.input !== "string" || spec.input.trim() === "") {
    throw new AgentGuardDslError(
      `Invalid spec for test "${name}" at "input": expected a non-empty string.`,
    );
  }

  if (spec.context !== undefined && !isStringOrStringArray(spec.context)) {
    throw new AgentGuardDslError(
      `Invalid spec for test "${name}" at "context": expected a string or string array.`,
    );
  }

  if (!isObject(spec.expected)) {
    throw new AgentGuardDslError(
      `Invalid spec for test "${name}" at "expected": expected an object.`,
    );
  }

  const expected = spec.expected;
  validateOptionalStringArray(expected.mustInclude, name, "expected.mustInclude");
  validateOptionalStringArray(expected.mustNotInclude, name, "expected.mustNotInclude");

  if (expected.judge !== undefined) {
    if (!isObject(expected.judge)) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.judge": expected an object.`,
      );
    }
    if (typeof expected.judge.rule !== "string" || expected.judge.rule.trim() === "") {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.judge.rule": expected a non-empty string.`,
      );
    }
    if (expected.judge.model !== undefined && typeof expected.judge.model !== "string") {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.judge.model": expected a string.`,
      );
    }
    if (
      expected.judge.threshold !== undefined &&
      (typeof expected.judge.threshold !== "number" || Number.isNaN(expected.judge.threshold))
    ) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.judge.threshold": expected a number.`,
      );
    }
  }

  if (expected.toolCalls !== undefined) {
    if (!isObject(expected.toolCalls)) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.toolCalls": expected an object.`,
      );
    }
    validateOptionalStringArray(expected.toolCalls.mustCall, name, "expected.toolCalls.mustCall");
    validateOptionalStringArray(
      expected.toolCalls.mustNotCall,
      name,
      "expected.toolCalls.mustNotCall",
    );
  }

  if (expected.snapshot !== undefined) {
    if (!isObject(expected.snapshot)) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.snapshot": expected an object.`,
      );
    }

    if (
      expected.snapshot.enabled !== undefined &&
      typeof expected.snapshot.enabled !== "boolean"
    ) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.snapshot.enabled": expected a boolean.`,
      );
    }

    if (
      expected.snapshot.mode !== undefined &&
      expected.snapshot.mode !== "contract" &&
      expected.snapshot.mode !== "text"
    ) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.snapshot.mode": expected "contract" or "text".`,
      );
    }

    if (
      expected.snapshot.id !== undefined &&
      (typeof expected.snapshot.id !== "string" || expected.snapshot.id.trim() === "")
    ) {
      throw new AgentGuardDslError(
        `Invalid spec for test "${name}" at "expected.snapshot.id": expected a non-empty string.`,
      );
    }
  }
}

function validateOptionalStringArray(
  value: unknown,
  testName: string,
  field: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new AgentGuardDslError(
      `Invalid spec for test "${testName}" at "${field}": expected a string array.`,
    );
  }
}

function isStringOrStringArray(value: unknown): value is string | string[] {
  return typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cloneSpec(spec: AgentTestSpec): AgentTestSpec {
  return {
    ...spec,
    context: Array.isArray(spec.context) ? [...spec.context] : spec.context,
    expected: {
      ...spec.expected,
      mustInclude: spec.expected.mustInclude ? [...spec.expected.mustInclude] : undefined,
      mustNotInclude: spec.expected.mustNotInclude ? [...spec.expected.mustNotInclude] : undefined,
      judge: spec.expected.judge
        ? {
            ...spec.expected.judge,
          }
        : undefined,
      toolCalls: spec.expected.toolCalls
        ? {
            mustCall: spec.expected.toolCalls.mustCall
              ? [...spec.expected.toolCalls.mustCall]
              : undefined,
            mustNotCall: spec.expected.toolCalls.mustNotCall
              ? [...spec.expected.toolCalls.mustNotCall]
              : undefined,
          }
        : undefined,
      snapshot: spec.expected.snapshot
        ? {
            ...spec.expected.snapshot,
          }
        : undefined,
    },
  };
}
