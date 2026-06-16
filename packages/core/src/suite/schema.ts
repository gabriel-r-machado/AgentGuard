import { z } from "zod";

import { sourceRefSchema } from "../contract/schema.js";
import { type ScenarioCategory } from "../presets/v1.js";
import type { PresetName } from "../types.js";

export const TEST_SUITE_SCHEMA_VERSION = 1 as const;

const scenarioCategoryValues = [
  "factual-question",
  "missing-information",
  "ambiguous-information",
  "user-rule-conflict",
  "tone-maintenance",
  "angry-user",
  "promise-seeking",
  "system-prompt-exfiltration",
  "rule-change-attempt",
  "lead-qualification",
  "required-fields-missing",
  "scheduling-without-confirmation",
  "unavailable-timeslot",
  "reschedule",
  "abandonment",
  "conversation-resume",
  "long-conversation",
  "out-of-scope",
  "human-handoff",
  "sensitive-situation",
  "improper-clinical-guidance",
] as const satisfies readonly ScenarioCategory[];

export const scenarioCategorySchema = z.enum(scenarioCategoryValues);

export const scenarioTurnSchema = z
  .object({
    role: z.literal("user"),
    message: z.string().min(1),
  })
  .strict();

export const regexAssertionSchema = z
  .object({
    pattern: z.string().min(1),
    flags: z.string().optional(),
    mustMatch: z.boolean().default(true),
  })
  .strict();

export const toolArgumentAssertionSchema = z
  .object({
    tool: z.string().min(1),
    path: z.string().min(1),
    exists: z.boolean().optional(),
    equals: z.unknown().optional(),
    includes: z.string().min(1).optional(),
    regex: z.string().min(1).optional(),
  })
  .strict();

export const deterministicAssertionSchema = z
  .object({
    mustInclude: z.array(z.string().min(1)).default([]),
    mustNotInclude: z.array(z.string().min(1)).default([]),
    regex: z.array(regexAssertionSchema).default([]),
    maxLength: z.number().int().min(1).optional(),
    minLength: z.number().int().min(0).optional(),
    validJson: z.boolean().optional(),
    jsonSchema: z.unknown().optional(),
    allowEmptyResponse: z.boolean().default(false),
    expectHttpError: z.boolean().optional(),
    expectTimeout: z.boolean().optional(),
    toolCallOrder: z.array(z.string().min(1)).default([]),
    toolArgumentAssertions: z.array(toolArgumentAssertionSchema).default([]),
  })
  .strict();

export const scenarioExpectationsSchema = z
  .object({
    requiredBehaviors: z.array(z.string().min(1)),
    forbiddenBehaviors: z.array(z.string().min(1)),
    requiredFields: z.array(z.string().min(1)),
    shouldEscalate: z.boolean(),
    shouldRefuse: z.boolean(),
    shouldMaintainTone: z.boolean(),
    mustUseKnownFacts: z.boolean(),
    expectedUnknownTopics: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
    deterministic: deterministicAssertionSchema.default({}),
  })
  .strict();

export const suiteScenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: scenarioCategorySchema,
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: z.string().min(1),
    sourceRefs: z.array(sourceRefSchema),
    turns: z.array(scenarioTurnSchema).min(2),
    expectations: scenarioExpectationsSchema,
    requiredToolCalls: z.array(z.string().min(1)),
    forbiddenToolCalls: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
  })
  .strict();

export const testSuiteSchema = z
  .object({
    schemaVersion: z.literal(TEST_SUITE_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    preset: z.custom<PresetName>(),
    contractHash: z.string().min(1),
    sourceHash: z.string().min(1),
    seed: z.number().int(),
    maxTurns: z.number().int().min(1),
    scenariosRequested: z.number().int().min(1),
    scenarios: z.array(suiteScenarioSchema).min(1),
  })
  .strict();

export type ScenarioExpectation = z.infer<typeof scenarioExpectationsSchema>;
export type SuiteScenarioInput = z.input<typeof suiteScenarioSchema>;
export type SuiteScenario = z.infer<typeof suiteScenarioSchema>;
export type TestSuite = z.infer<typeof testSuiteSchema>;
export type DeterministicAssertion = z.infer<typeof deterministicAssertionSchema>;
export type RegexAssertion = z.infer<typeof regexAssertionSchema>;
export type ToolArgumentAssertion = z.infer<typeof toolArgumentAssertionSchema>;
