import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

import ts from "typescript";

import type { AgentGuardConfig, ResolvedAgentGuardConfig } from "./types.js";

const DEFAULT_CONFIG_FILENAME = "agentguard.config.ts";

const DEFAULTS = {
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  timeoutMs: 30_000,
  retries: 1,
  temperature: 0.1,
  ciFailOnInconclusive: true,
  redactionEnabled: true,
} as const;

const TOP_LEVEL_KEYS = new Set([
  "provider",
  "model",
  "testsDir",
  "maxCostPerRun",
  "timeoutMs",
  "retries",
  "temperature",
  "ci",
  "redaction",
]);

const CI_KEYS = new Set(["failOnInconclusive"]);
const REDACTION_KEYS = new Set(["enabled", "patterns"]);

export type LoadAgentGuardConfigOptions = {
  cwd?: string;
  configFile?: string;
};

export class AgentGuardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGuardConfigError";
  }
}

export async function loadAgentGuardConfig(
  options: LoadAgentGuardConfigOptions = {},
): Promise<ResolvedAgentGuardConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configFile = options.configFile ?? DEFAULT_CONFIG_FILENAME;
  const configPath = resolve(cwd, configFile);

  if (!existsSync(configPath)) {
    throw new AgentGuardConfigError(
      `Config file not found at "${configPath}". Create "${DEFAULT_CONFIG_FILENAME}" with a default export.`,
    );
  }

  const source = readFileSync(configPath, "utf8");
  const config = await loadConfigModule(source, configPath);
  return resolveAndValidateConfig(config, configPath);
}

async function loadConfigModule(source: string, filePath: string): Promise<unknown> {
  const transpileResult = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    transpileResult.outputText,
    "utf8",
  ).toString("base64")}`;

  try {
    const imported = await import(moduleUrl);
    return imported.default ?? imported;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AgentGuardConfigError(
      `Failed to evaluate "${filePath}". Ensure it has "export default { ... }".\nCause: ${reason}`,
    );
  }
}

function resolveAndValidateConfig(
  value: unknown,
  filePath: string,
): ResolvedAgentGuardConfig {
  assertObject(value, "config", filePath);
  assertNoUnknownKeys(value, TOP_LEVEL_KEYS, "config", filePath);

  const provider = value.provider;
  if (provider !== "openai" && provider !== "deepseek") {
    throw errorAt(
      "config.provider",
      `must be "openai" or "deepseek", received ${formatValue(provider)}`,
      filePath,
    );
  }

  const model = value.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw errorAt(
      "config.model",
      `must be a non-empty string, received ${formatValue(model)}`,
      filePath,
    );
  }

  const testsDir = readOptionalString(value.testsDir, "config.testsDir", filePath) ?? DEFAULTS.testsDir;
  const maxCostPerRun =
    readOptionalNumber(value.maxCostPerRun, "config.maxCostPerRun", filePath) ??
    DEFAULTS.maxCostPerRun;
  const timeoutMs =
    readOptionalNumber(value.timeoutMs, "config.timeoutMs", filePath) ?? DEFAULTS.timeoutMs;
  const retries = readOptionalNumber(value.retries, "config.retries", filePath) ?? DEFAULTS.retries;
  const temperature =
    readOptionalNumber(value.temperature, "config.temperature", filePath) ??
    DEFAULTS.temperature;

  const ci = resolveCi(value.ci, filePath);
  const redaction = resolveRedaction(value.redaction, filePath);

  return {
    provider,
    model,
    testsDir,
    maxCostPerRun,
    timeoutMs,
    retries,
    temperature,
    ci,
    redaction,
  };
}

function resolveCi(value: unknown, filePath: string): ResolvedAgentGuardConfig["ci"] {
  if (value === undefined) {
    return { failOnInconclusive: DEFAULTS.ciFailOnInconclusive };
  }

  assertObject(value, "config.ci", filePath);
  assertNoUnknownKeys(value, CI_KEYS, "config.ci", filePath);

  const failOnInconclusive =
    readOptionalBoolean(value.failOnInconclusive, "config.ci.failOnInconclusive", filePath) ??
    DEFAULTS.ciFailOnInconclusive;

  return { failOnInconclusive };
}

function resolveRedaction(
  value: unknown,
  filePath: string,
): ResolvedAgentGuardConfig["redaction"] {
  if (value === undefined) {
    return { enabled: DEFAULTS.redactionEnabled };
  }

  assertObject(value, "config.redaction", filePath);
  assertNoUnknownKeys(value, REDACTION_KEYS, "config.redaction", filePath);

  const enabled =
    readOptionalBoolean(value.enabled, "config.redaction.enabled", filePath) ??
    DEFAULTS.redactionEnabled;
  const patterns = readOptionalStringArray(value.patterns, "config.redaction.patterns", filePath);

  return patterns ? { enabled, patterns } : { enabled };
}

function readOptionalString(value: unknown, field: string, filePath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw errorAt(field, `must be a string, received ${formatValue(value)}`, filePath);
  }
  return value;
}

function readOptionalNumber(value: unknown, field: string, filePath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw errorAt(field, `must be a valid number, received ${formatValue(value)}`, filePath);
  }
  return value;
}

function readOptionalBoolean(value: unknown, field: string, filePath: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw errorAt(field, `must be a boolean, received ${formatValue(value)}`, filePath);
  }
  return value;
}

function readOptionalStringArray(
  value: unknown,
  field: string,
  filePath: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw errorAt(field, `must be an array of strings, received ${formatValue(value)}`, filePath);
  }
  return value;
}

function assertObject(value: unknown, field: string, filePath: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw errorAt(field, `must be an object, received ${formatValue(value)}`, filePath);
  }
}

function assertNoUnknownKeys(
  object: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
  filePath: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      const allowedKeys = [...allowed].join(", ");
      throw errorAt(
        `${field}.${key}`,
        `is not supported. Allowed keys: ${allowedKeys}`,
        filePath,
      );
    }
  }
}

function errorAt(field: string, reason: string, filePath: string): AgentGuardConfigError {
  return new AgentGuardConfigError(`Invalid config at "${field}" in "${filePath}": ${reason}`);
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
