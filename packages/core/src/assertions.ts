import type { AgentTestSpec } from "./types.js";

export type TextAssertionContext = {
  spec: AgentTestSpec;
  responseText: string;
  toolCalls?: Array<{ name: string; arguments: unknown }>;
};

export type JudgeAssertionResult = {
  enabled: boolean;
  passed: boolean;
  nonCritical: boolean;
  score: number;
  threshold: number;
  rationale: string;
};

export type AssertionResult = {
  failures: string[];
  judge?: JudgeAssertionResult;
};

export function runTextAssertions(context: TextAssertionContext): string[] {
  return runAssertions(context).failures;
}

export function runAssertions(context: TextAssertionContext): AssertionResult {
  const failures: string[] = [];
  const normalizedResponse = normalizeTextForComparison(context.responseText);
  const expected = context.spec.expected;

  for (const entry of expected.mustInclude ?? []) {
    const normalizedEntry = normalizeTextForComparison(entry);
    if (!normalizedResponse.includes(normalizedEntry)) {
      failures.push(
        `Missing required text "${entry}". Response excerpt: "${createExcerpt(
          context.responseText,
        )}"`,
      );
    }
  }

  for (const entry of expected.mustNotInclude ?? []) {
    const normalizedEntry = normalizeTextForComparison(entry);
    if (normalizedEntry !== "" && normalizedResponse.includes(normalizedEntry)) {
      failures.push(
        `Found forbidden text "${entry}" (case-insensitive). Response excerpt: "${createExcerpt(
          context.responseText,
        )}"`,
      );
    }
  }

  failures.push(...runZodSchemaAssertion(expected.zodSchema, context.responseText));
  failures.push(...runToolCallAssertions(expected.toolCalls, context.toolCalls));

  const judge = runJudgeAssertion(context.spec, context.responseText);
  if (judge && !judge.passed && !judge.nonCritical) {
    failures.push(
      `Judge assertion failed (score=${judge.score.toFixed(2)} threshold=${judge.threshold.toFixed(
        2,
      )}): ${judge.rationale}`,
    );
  }

  return { failures, judge };
}

export function normalizeTextForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function createExcerpt(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117)}...`;
}

type ZodIssue = {
  path?: Array<string | number>;
  message?: string;
};

type ZodLikeSafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error?: { issues?: ZodIssue[] } };

type ZodLikeSchema = {
  safeParse: (input: unknown) => ZodLikeSafeParseResult;
};

function runZodSchemaAssertion(zodSchema: unknown, responseText: string): string[] {
  if (zodSchema === undefined) {
    return [];
  }

  if (!isZodLikeSchema(zodSchema)) {
    return [
      'Invalid "zodSchema": expected a Zod schema instance with safeParse(input).',
    ];
  }

  const candidate = parseResponseForSchema(responseText);
  if (candidate.parseError) {
    return [
      `Invalid JSON for zodSchema assertion: ${candidate.parseError}. Response excerpt: "${createExcerpt(
        responseText,
      )}"`,
    ];
  }

  const parsed = zodSchema.safeParse(candidate.value);
  if (parsed.success) {
    return [];
  }

  const issues = parsed.error?.issues ?? [];
  if (issues.length === 0) {
    return ["zodSchema validation failed with an unknown error."];
  }

  return issues.map((issue) => {
    const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    const message = issue.message ?? "validation failed";
    return `zodSchema validation failed at "${path}": ${message}`;
  });
}

function isZodLikeSchema(value: unknown): value is ZodLikeSchema {
  return typeof value === "object" && value !== null && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

function parseResponseForSchema(responseText: string): {
  value: unknown;
  parseError?: string;
} {
  if (!looksLikeJson(responseText)) {
    return { value: responseText };
  }

  try {
    return { value: JSON.parse(responseText) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { value: undefined, parseError: reason };
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function runToolCallAssertions(
  toolCallSpec: AgentTestSpec["expected"]["toolCalls"] | undefined,
  observedToolCalls: Array<{ name: string; arguments: unknown }> | undefined,
): string[] {
  if (!toolCallSpec) {
    return [];
  }

  const failures: string[] = [];
  const observed = observedToolCalls ?? [];
  const observedNames = observed.map((call) => call.name);
  const observedNormalized = new Set(observedNames.map((name) => normalizeToolName(name)));

  for (const requiredTool of toolCallSpec.mustCall ?? []) {
    const normalizedRequired = normalizeToolName(requiredTool);
    if (!observedNormalized.has(normalizedRequired)) {
      failures.push(
        `Tool assertion failed (mustCall): expected tool "${requiredTool}" to be called, but observed ${formatObservedTools(
          observedNames,
        )}.`,
      );
    }
  }

  for (const forbiddenTool of toolCallSpec.mustNotCall ?? []) {
    const normalizedForbidden = normalizeToolName(forbiddenTool);
    if (observedNormalized.has(normalizedForbidden)) {
      failures.push(
        `Tool assertion failed (mustNotCall): tool "${forbiddenTool}" was called. Observed ${formatObservedTools(
          observedNames,
        )}.`,
      );
    }
  }

  return failures;
}

function normalizeToolName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function formatObservedTools(toolNames: string[]): string {
  if (toolNames.length === 0) {
    return "<none>";
  }
  return `[${toolNames.join(", ")}]`;
}

function runJudgeAssertion(
  spec: AgentTestSpec,
  responseText: string,
): JudgeAssertionResult | undefined {
  const judgeSpec = spec.expected.judge;
  if (!judgeSpec) {
    return undefined;
  }

  const threshold = judgeSpec.threshold ?? 0.6;
  const score = estimateJudgeScore(judgeSpec.rule, responseText);
  const passed = score >= threshold;
  const deterministicGate = hasDeterministicGate(spec);
  const nonCritical = !deterministicGate;
  const rationale = buildJudgeRationale({
    rule: judgeSpec.rule,
    responseText,
    score,
    threshold,
    passed,
    nonCritical,
  });

  return {
    enabled: true,
    passed,
    nonCritical,
    score,
    threshold,
    rationale,
  };
}

function hasDeterministicGate(spec: AgentTestSpec): boolean {
  const expected = spec.expected;
  return Boolean(
    (expected.mustInclude && expected.mustInclude.length > 0) ||
      (expected.mustNotInclude && expected.mustNotInclude.length > 0) ||
      expected.zodSchema ||
      (expected.snapshot && (expected.snapshot.enabled ?? true)) ||
      (expected.toolCalls &&
        ((expected.toolCalls.mustCall && expected.toolCalls.mustCall.length > 0) ||
          (expected.toolCalls.mustNotCall &&
            expected.toolCalls.mustNotCall.length > 0))),
  );
}

function estimateJudgeScore(rule: string, responseText: string): number {
  const ruleTokens = tokenize(rule);
  if (ruleTokens.size === 0) {
    return 0;
  }
  const responseTokens = tokenize(responseText);
  let overlap = 0;
  for (const token of ruleTokens) {
    if (responseTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / ruleTokens.size;
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeTextForComparison(value);
  const tokens = normalized
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function buildJudgeRationale(input: {
  rule: string;
  responseText: string;
  score: number;
  threshold: number;
  passed: boolean;
  nonCritical: boolean;
}): string {
  const statusLabel = input.passed ? "pass" : "fail";
  const criticalLabel = input.nonCritical
    ? "non-critical (judge-only test by default policy)"
    : "critical (combined with deterministic assertions)";
  return `judge=${statusLabel}; policy=${criticalLabel}; rule="${input.rule}"; response="${createExcerpt(
    input.responseText,
  )}"`;
}
