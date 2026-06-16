import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadAgentGuardConfig } from "../config.js";
import { createSourceLoader } from "../knowledge/loader.js";
import { getProviderApiKeyEnv } from "../providers/catalog.js";
import { resolveJsonPath } from "../targets/utils.js";

import type { DoctorCheck, DoctorResult } from "./types.js";
import type { ResolvedLlmRoleConfig } from "../types.js";

export type RunDoctorOptions = {
  cwd?: string;
  configFile?: string;
};

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  let config;
  try {
    config = await loadAgentGuardConfig({
      cwd,
      configFile: options.configFile,
    });
    checks.push({
      id: "config",
      status: "ok",
      message: "Configuration file loaded successfully.",
    });
  } catch (error) {
    checks.push({
      id: "config",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return finalizeDoctorResult(checks);
  }

  if (config.sources.systemPrompt && config.sources.knowledge.length > 0) {
    try {
      await createSourceLoader().load({ cwd, config });
      checks.push({
        id: "sources",
        status: "ok",
        message: "System prompt and knowledge sources are readable.",
      });
    } catch (error) {
      checks.push({
        id: "sources",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    checks.push({
      id: "sources",
      status: "error",
      message:
        'Scan readiness requires both "sources.systemPrompt" and at least one "sources.knowledge" entry.',
    });
  }

  try {
    const artifactsDir = join(cwd, ".agentguard");
    mkdirSync(artifactsDir, { recursive: true });
    const checkPath = join(artifactsDir, ".doctor-write-check");
    writeFileSync(checkPath, "ok\n", "utf8");
    rmSync(checkPath, { force: true });
    checks.push({
      id: "write-permission",
      status: "ok",
      message: "AgentGuard can write artifacts under .agentguard/.",
    });
  } catch (error) {
    checks.push({
      id: "write-permission",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const providerChecks = buildProviderChecks(config);
  checks.push(...providerChecks);

  checks.push(...buildTargetChecks(config));

  return finalizeDoctorResult(checks);
}

function buildProviderChecks(
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(buildRoleCheck("generator", config.llm.generator));
  checks.push(buildRoleCheck("judge", config.llm.judge));
  return checks;
}

function buildTargetChecks(
  config: Awaited<ReturnType<typeof loadAgentGuardConfig>>,
): DoctorCheck[] {
  const target = config.scan.target;
  if (!target) {
    return [
      {
        id: "target",
        status: "warn",
        message: "No target is configured yet. Dry-run artifact generation is still available.",
      },
    ];
  }

  if (target.type === "provider") {
    const provider = target.provider ?? config.provider;
    if (!provider) {
      return [
        {
          id: "target-provider",
          status: "warn",
          message: 'Direct provider target is configured, but no provider was resolved from "scan.target.provider" or top-level "provider".',
        },
      ];
    }

    const envName = getProviderApiKeyEnv(provider);
    return [
      {
        id: "target-provider",
        status: process.env[envName] ? "ok" : "warn",
        message: process.env[envName]
          ? `Direct provider target is ready for "${provider}".`
          : `Direct provider target expects ${envName} to be set.`,
      },
    ];
  }

  const checks: DoctorCheck[] = [
    {
      id: "target",
      status: "ok",
      message: `HTTP target is configured as ${target.request?.method ?? "POST"} ${target.url}.`,
    },
  ];

  const missingEnvNames = collectMissingEnvNames([
    target.url,
    ...Object.values(target.headers ?? {}),
    JSON.stringify(target.request?.body ?? null),
  ]);
  if (missingEnvNames.length > 0) {
    checks.push({
      id: "target-env",
      status: "warn",
      message: `HTTP target references missing environment variables: ${missingEnvNames.join(", ")}.`,
    });
  } else {
    checks.push({
      id: "target-env",
      status: "ok",
      message: "HTTP target environment placeholders are resolvable.",
    });
  }

  try {
    if (target.response?.textPath) {
      resolveJsonPath({}, target.response.textPath);
    }
    for (const path of [
      target.response?.toolCallsPath,
      target.response?.retrievedContextPath,
      target.response?.metadataPath,
      target.response?.inputTokensPath,
      target.response?.outputTokensPath,
    ]) {
      resolveJsonPath({}, path);
    }
    checks.push({
      id: "target-response-paths",
      status: "ok",
      message: "HTTP target response paths are syntactically valid.",
    });
  } catch (error) {
    checks.push({
      id: "target-response-paths",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

function collectMissingEnvNames(values: string[]): string[] {
  const missing = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      if (!process.env[match[1]]) {
        missing.add(match[1]);
      }
    }
  }
  return [...missing];
}

function buildRoleCheck(
  role: "generator" | "judge",
  config: ResolvedLlmRoleConfig,
): DoctorCheck {
  if (!config.provider && !config.model) {
    return {
      id: `llm-${role}`,
      status: "warn",
      message: `No ${role} model is configured. AgentGuard will use heuristic ${role === "generator" ? "contract/scenario generation" : "semantic judging"} for scan.`,
    };
  }

  if (config.provider && !config.model) {
    return {
      id: `llm-${role}`,
      status: "error",
      message: `LLM role "${role}" resolved provider "${config.provider}" but no model. Set "llm.${role}.model" or ${role === "generator" ? "AGENTGUARD_GENERATOR_MODEL" : "AGENTGUARD_JUDGE_MODEL"}.`,
    };
  }

  if (!config.provider && config.model) {
    return {
      id: `llm-${role}`,
      status: "error",
      message: `LLM role "${role}" resolved model "${config.model}" but no provider. Set "llm.${role}.provider" or use the legacy fallback provider fields.`,
    };
  }

  const provider = config.provider as NonNullable<typeof config.provider>;
  const envName = getProviderApiKeyEnv(provider);
  if (process.env[envName]) {
    return {
      id: `llm-${role}`,
      status: "ok",
      message: `LLM role "${role}" is ready with provider "${provider}" and model "${config.model}".`,
    };
  }

  return {
    id: `llm-${role}`,
    status: "warn",
    message: `LLM role "${role}" expects ${envName} for provider "${provider}".`,
  };
}

function finalizeDoctorResult(checks: DoctorCheck[]): DoctorResult {
  if (checks.some((check) => check.status === "error")) {
    return { status: "error", checks };
  }
  if (checks.some((check) => check.status === "warn")) {
    return { status: "warn", checks };
  }
  return { status: "ok", checks };
}
