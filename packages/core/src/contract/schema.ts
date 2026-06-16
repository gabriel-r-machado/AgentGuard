import { z } from "zod";

import type { PresetName } from "../types.js";

export const AGENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const sourceRefSchema = z
  .object({
    documentId: z.string().min(1),
    chunkId: z.string().min(1).optional(),
    sourcePath: z.string().min(1),
    excerpt: z.string().min(1).optional(),
  })
  .strict();

export const contractRuleSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    sourceRefs: z.array(sourceRefSchema),
  })
  .strict();

export const contractFactSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    sourceRefs: z.array(sourceRefSchema).min(1),
    confidence: z.number().min(0).max(1),
    category: z.enum([
      "service",
      "pricing",
      "scheduling",
      "location",
      "policy",
      "contact",
      "lead-qualification",
      "safety",
      "general",
    ]),
  })
  .strict();

export const unknownInformationSchema = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export const agentContractSchema = z
  .object({
    schemaVersion: z.literal(AGENT_CONTRACT_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    sourceHash: z.string().min(1),
    identity: z
      .object({
        projectName: z.string().min(1),
        locale: z.string().min(1),
        preset: z.custom<PresetName>(),
      })
      .strict(),
    objectives: z.array(z.string().min(1)),
    tone: z
      .object({
        summary: z.string(),
        traits: z.array(z.string().min(1)),
      })
      .strict(),
    systemPromptInstructions: z.array(contractRuleSchema),
    requiredBehaviors: z.array(contractRuleSchema),
    forbiddenBehaviors: z.array(contractRuleSchema),
    supportedTopics: z.array(z.string().min(1)),
    outOfScopeTopics: z.array(z.string().min(1)),
    facts: z.array(contractFactSchema),
    businessRules: z.array(contractRuleSchema),
    leadQualification: z
      .object({
        signals: z.array(z.string().min(1)),
        requiredFields: z.array(z.string().min(1)),
        optionalFields: z.array(z.string().min(1)),
        unknowns: z.array(z.string().min(1)),
      })
      .strict(),
    schedulingPolicy: z
      .object({
        rules: z.array(z.string().min(1)),
        requiredFields: z.array(z.string().min(1)),
        unknowns: z.array(z.string().min(1)),
      })
      .strict(),
    escalationRules: z.array(contractRuleSchema),
    toolPolicies: z.array(contractRuleSchema),
    safetyPolicies: z.array(contractRuleSchema),
    unknownInformation: z.array(unknownInformationSchema),
  })
  .strict();

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type ContractRule = z.infer<typeof contractRuleSchema>;
export type ContractFact = z.infer<typeof contractFactSchema>;
export type UnknownInformation = z.infer<typeof unknownInformationSchema>;
export type AgentContract = z.infer<typeof agentContractSchema>;
