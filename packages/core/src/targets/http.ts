import { performance } from "node:perf_hooks";

import {
  collectEnvTemplateSecrets,
  interpolateEnvTemplate,
  redactSecrets,
  renderTemplateValue,
  resolveJsonPath,
} from "./utils.js";

import type { HttpAgentTargetConfig, ResolvedAgentGuardConfig } from "../types.js";
import type { AgentTarget, AgentTargetTurnInput, AgentTargetTurnOutput, ObservedToolCall, RetrievedContextEntry } from "./types.js";

export type CreateHttpAgentTargetOptions = {
  target: HttpAgentTargetConfig;
  config: ResolvedAgentGuardConfig;
  fetchFn?: typeof fetch;
};

export function createHttpAgentTarget(
  options: CreateHttpAgentTargetOptions,
): AgentTarget {
  const fetchFn = options.fetchFn ?? fetch;
  const secretValues = collectEnvTemplateSecrets(
    {
      url: options.target.url,
      headers: options.target.headers,
      body: options.target.request?.body,
    },
    process.env,
  );

  return {
    name: "http",
    async executeTurn(input: AgentTargetTurnInput): Promise<AgentTargetTurnOutput> {
      const maxAttempts = Math.max(1, input.retries + 1);
      let attempt = 0;
      let lastError: Error | undefined;

      while (attempt < maxAttempts) {
        attempt += 1;
        const startedAt = performance.now();
        const controller = new AbortController();
        const timeoutMs = options.target.request?.timeoutMs ?? input.timeoutMs;
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const context = {
            message: input.userMessage,
            sessionId: input.sessionId,
            dryRun: input.dryRun,
            scenarioId: input.scenarioId,
            scenarioTitle: input.scenarioTitle,
            category: input.category,
            severity: input.severity,
            turnIndex: input.turnIndex,
            repetition: input.repetition,
            history: input.history,
            metadata: input.metadata,
          };

          const url = interpolateEnvTemplate(options.target.url, process.env);
          const headers = Object.fromEntries(
            Object.entries(options.target.headers ?? {}).map(([key, value]) => [
              key,
              interpolateEnvTemplate(value, process.env),
            ]),
          );
          const method = options.target.request?.method ?? "POST";
          const bodyTemplate = options.target.request?.body ?? {
            message: "{{message}}",
            sessionId: "{{sessionId}}",
            metadata: {
              agentguard: true,
              dryRun: "{{dryRun}}",
              scenarioId: "{{scenarioId}}",
              repetition: "{{repetition}}",
            },
          };
          const renderedBody = renderTemplateValue(bodyTemplate, context);

          const response = await fetchFn(url, {
            method,
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(renderedBody),
            signal: controller.signal,
          });

          const rawText = await response.text();
          const parsedBody = tryParseJson(rawText);
          const body = parsedBody ?? rawText;

          const textValue = options.target.response?.textPath
            ? resolveJsonPath(body, options.target.response.textPath)
            : typeof body === "string"
              ? body
              : rawText;
          const toolCalls = normalizeToolCalls(
            resolveJsonPath(body, options.target.response?.toolCallsPath),
          );
          const retrievedContext = normalizeRetrievedContext(
            resolveJsonPath(body, options.target.response?.retrievedContextPath),
          );
          const metadata = normalizeMetadata(
            resolveJsonPath(body, options.target.response?.metadataPath),
          );
          const inputTokens = readOptionalNumber(
            resolveJsonPath(body, options.target.response?.inputTokensPath),
          );
          const outputTokens = readOptionalNumber(
            resolveJsonPath(body, options.target.response?.outputTokensPath),
          );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${redactSecrets(rawText, secretValues)}`,
            );
          }

          return {
            text: typeof textValue === "string" ? textValue : JSON.stringify(textValue),
            latencyMs: Math.round(performance.now() - startedAt),
            retryCount: attempt - 1,
            inputTokens,
            outputTokens,
            httpStatus: response.status,
            toolCalls,
            retrievedContext,
            metadata,
            raw: body,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = isAbortLikeError(error);
          lastError = new Error(redactSecrets(message, secretValues));
          if (attempt >= maxAttempts) {
            return {
              text: "",
              latencyMs: Math.round(performance.now() - startedAt),
              retryCount: attempt - 1,
              httpStatus: undefined,
              toolCalls: [],
              retrievedContext: [],
              error: lastError.message,
              timedOut,
              raw: undefined,
            };
          }
        } finally {
          clearTimeout(timeoutHandle);
        }
      }

      return {
        text: "",
        latencyMs: 0,
        retryCount: maxAttempts - 1,
        toolCalls: [],
        retrievedContext: [],
        error: lastError?.message ?? "Unknown HTTP target failure.",
        raw: undefined,
      };
    },
  };
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeToolCalls(value: unknown): ObservedToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const toolCalls: ObservedToolCall[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.tool === "string"
          ? record.tool
          : undefined;
    if (!name) {
      continue;
    }
    toolCalls.push({
      name,
      arguments: record.arguments ?? record.args ?? {},
      raw: entry,
    });
  }
  return toolCalls;
}

function normalizeRetrievedContext(value: unknown): RetrievedContextEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const contextEntries: RetrievedContextEntry[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      contextEntries.push({
        text: entry,
        raw: entry,
      });
      continue;
    }
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : undefined;
    if (!text) {
      continue;
    }
    contextEntries.push({
      text,
      sourcePath:
        typeof record.sourcePath === "string"
          ? record.sourcePath
          : undefined,
      score: readOptionalNumber(record.score),
      raw: entry,
    });
  }
  return contextEntries;
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error
    ? error.name === "AbortError" || error.message.toLocaleLowerCase("en-US").includes("aborted")
    : false;
}
