import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Buffer } from "node:buffer";

import ts from "typescript";
import { z } from "zod";

import type {
  AgentGuardConfig,
  LlmRoleConfig,
  LlmRoleName,
  ResolvedAgentGuardConfig,
  ResolvedLlmRoleConfig,
} from "./types.js";

const DEFAULT_CONFIG_FILENAME = "agentguard.config.ts";
const SELF_PACKAGE_ENTRY_URL = new URL("./index.js", import.meta.url).href;

const DEFAULTS = {
  testsDir: "./ai-tests",
  maxCostPerRun: 0.2,
  timeoutMs: 30_000,
  retries: 1,
  temperature: 0.1,
  ciFailOnInconclusive: true,
  redactionEnabled: true,
  projectLocale: "en-US",
  projectPreset: "customer-support",
  generationScenarios: 24,
  generationMaxTurns: 4,
  generationSeed: 42,
  scanDryRunTools: true,
  scanConcurrency: 2,
  scanDefaultRepetitions: 1,
  scanHighRepetitions: 1,
  scanCriticalRepetitions: 2,
  scanReportHtml: true,
} as const;

const agentProviderSchema = z.enum(["openai", "deepseek", "gemini", "anthropic"]);
const stringRecordSchema = z.record(z.string(), z.string());
const llmRoleConfigSchema = z
  .object({
    provider: agentProviderSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().finite().optional(),
    maxTokens: z.number().int().min(1).optional(),
    timeoutMs: z.number().int().min(1).optional(),
    retries: z.number().int().min(0).optional(),
  })
  .strict();

const fileSourceSchema = z
  .object({
    type: z.literal("file"),
    path: z.string().min(1),
  })
  .strict();

const globSourceSchema = z
  .object({
    type: z.literal("glob"),
    pattern: z.string().min(1),
  })
  .strict();

const snapshotSourceSchema = z
  .object({
    type: z.literal("snapshot"),
    path: z.string().min(1),
  })
  .strict();

const systemPromptSourceSchema = z.union([fileSourceSchema, snapshotSourceSchema]);
const knowledgeSourceSchema = z.union([
  fileSourceSchema,
  globSourceSchema,
  snapshotSourceSchema,
]);

const httpTargetSchema = z
  .object({
    type: z.literal("http"),
    url: z.string().min(1),
    headers: stringRecordSchema.optional(),
    request: z
      .object({
        method: z.enum(["POST", "PUT", "PATCH"]).optional(),
        body: z.unknown().optional(),
        timeoutMs: z.number().int().min(1).optional(),
        retries: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    response: z
      .object({
        textPath: z.string().min(1),
        toolCallsPath: z.string().min(1).optional(),
        retrievedContextPath: z.string().min(1).optional(),
        metadataPath: z.string().min(1).optional(),
        inputTokensPath: z.string().min(1).optional(),
        outputTokensPath: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const directProviderTargetSchema = z
  .object({
    type: z.literal("provider"),
    provider: agentProviderSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().finite().optional(),
    timeoutMs: z.number().int().min(1).optional(),
  })
  .strict();

const configSchema = z
  .object({
    provider: agentProviderSchema.optional(),
    model: z.string().min(1).optional(),
    llm: z
      .object({
        generator: llmRoleConfigSchema.optional(),
        judge: llmRoleConfigSchema.optional(),
      })
      .strict()
      .optional(),
    testsDir: z.string().min(1).optional(),
    maxCostPerRun: z.number().finite().optional(),
    timeoutMs: z.number().finite().optional(),
    retries: z.number().int().min(0).optional(),
    temperature: z.number().finite().optional(),
    ci: z
      .object({
        failOnInconclusive: z.boolean().optional(),
      })
      .strict()
      .optional(),
    redaction: z
      .object({
        enabled: z.boolean().optional(),
        patterns: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    project: z
      .object({
        name: z.string().min(1),
        locale: z.string().min(1).optional(),
        preset: z
          .enum([
            "customer-support",
            "lead-scheduling",
            "healthcare-lead-scheduling",
          ])
          .optional(),
      })
      .strict()
      .optional(),
    sources: z
      .object({
        systemPrompt: systemPromptSourceSchema.optional(),
        knowledge: z.array(knowledgeSourceSchema).optional(),
      })
      .strict()
      .optional(),
    generation: z
      .object({
        scenarios: z.number().int().min(1).optional(),
        maxTurns: z.number().int().min(1).optional(),
        seed: z.number().int().optional(),
      })
      .strict()
      .optional(),
    scan: z
      .object({
        dryRunTools: z.boolean().optional(),
        llmProvider: agentProviderSchema.optional(),
        llmModel: z.string().min(1).optional(),
        target: z.union([httpTargetSchema, directProviderTargetSchema]).optional(),
        concurrency: z.number().int().min(1).optional(),
        repetitions: z
          .object({
            default: z.number().int().min(1).optional(),
            high: z.number().int().min(1).optional(),
            critical: z.number().int().min(1).optional(),
          })
          .strict()
          .optional(),
        reportHtml: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

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

export function defineConfig<T extends AgentGuardConfig>(config: T): T {
  return config;
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
  return resolveAndValidateConfig(config, configPath, cwd);
}

async function loadConfigModule(source: string, filePath: string): Promise<unknown> {
  const rewrittenSource = rewriteAgentGuardImports(source);
  const transpileResult = ts.transpileModule(rewrittenSource, {
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

function rewriteAgentGuardImports(source: string): string {
  return source
    .replace(/from\s+["']agentguard["']/g, `from "${SELF_PACKAGE_ENTRY_URL}"`)
    .replace(/from\s+["']@agentguard\/core["']/g, `from "${SELF_PACKAGE_ENTRY_URL}"`);
}

function resolveAndValidateConfig(
  value: unknown,
  filePath: string,
  cwd: string,
): ResolvedAgentGuardConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw buildConfigError(parsed.error.issues[0], filePath);
  }

  const config = parsed.data;
  const projectName = config.project?.name ?? basename(cwd);

  return {
    provider: config.provider,
    model: config.model,
    llm: {
      generator: resolveLlmRoleConfig(config, "generator"),
      judge: resolveLlmRoleConfig(config, "judge"),
    },
    testsDir: config.testsDir ?? DEFAULTS.testsDir,
    maxCostPerRun: config.maxCostPerRun ?? DEFAULTS.maxCostPerRun,
    timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
    retries: config.retries ?? DEFAULTS.retries,
    temperature: config.temperature ?? DEFAULTS.temperature,
    ci: {
      failOnInconclusive:
        config.ci?.failOnInconclusive ?? DEFAULTS.ciFailOnInconclusive,
    },
    redaction: {
      enabled: config.redaction?.enabled ?? DEFAULTS.redactionEnabled,
      ...(config.redaction?.patterns
        ? { patterns: config.redaction.patterns }
        : {}),
    },
    project: {
      name: projectName,
      locale: config.project?.locale ?? DEFAULTS.projectLocale,
      preset: config.project?.preset ?? DEFAULTS.projectPreset,
    },
    sources: {
      systemPrompt: config.sources?.systemPrompt,
      knowledge: config.sources?.knowledge ?? [],
    },
    generation: {
      scenarios: config.generation?.scenarios ?? DEFAULTS.generationScenarios,
      maxTurns: config.generation?.maxTurns ?? DEFAULTS.generationMaxTurns,
      seed: config.generation?.seed ?? DEFAULTS.generationSeed,
    },
    scan: {
      dryRunTools: config.scan?.dryRunTools ?? DEFAULTS.scanDryRunTools,
      llmProvider: config.scan?.llmProvider,
      llmModel: config.scan?.llmModel,
      target: config.scan?.target,
      concurrency: config.scan?.concurrency ?? DEFAULTS.scanConcurrency,
      repetitions: {
        default:
          config.scan?.repetitions?.default ?? DEFAULTS.scanDefaultRepetitions,
        high: config.scan?.repetitions?.high ?? DEFAULTS.scanHighRepetitions,
        critical:
          config.scan?.repetitions?.critical ?? DEFAULTS.scanCriticalRepetitions,
      },
      reportHtml: config.scan?.reportHtml ?? DEFAULTS.scanReportHtml,
    },
  };
}

function resolveLlmRoleConfig(
  config: AgentGuardConfig,
  role: LlmRoleName,
): ResolvedLlmRoleConfig {
  const roleConfig = config.llm?.[role];
  const resolved: ResolvedLlmRoleConfig = {
    provider: roleConfig?.provider ?? config.scan?.llmProvider ?? config.provider,
    model: readRoleModelOverride(role) ?? roleConfig?.model ?? config.scan?.llmModel ?? config.model,
    temperature: roleConfig?.temperature ?? config.temperature ?? DEFAULTS.temperature,
    timeoutMs: roleConfig?.timeoutMs ?? config.timeoutMs ?? DEFAULTS.timeoutMs,
    retries: roleConfig?.retries ?? config.retries ?? DEFAULTS.retries,
  };
  if (roleConfig?.maxTokens !== undefined) {
    resolved.maxTokens = roleConfig.maxTokens;
  }
  return resolved;
}

function readRoleModelOverride(role: LlmRoleName): string | undefined {
  const envName =
    role === "generator"
      ? "AGENTGUARD_GENERATOR_MODEL"
      : "AGENTGUARD_JUDGE_MODEL";
  const value = process.env[envName]?.trim();
  return value ? value : undefined;
}

function buildConfigError(
  issue: z.ZodIssue | undefined,
  filePath: string,
): AgentGuardConfigError {
  if (!issue) {
    return new AgentGuardConfigError(
      `Invalid config in "${filePath}".`,
    );
  }

  const path = issue.path.length > 0 ? issue.path.join(".") : "config";
  return new AgentGuardConfigError(
    `Invalid config at "config.${path}" in "${filePath}": ${issue.message}`,
  );
}
