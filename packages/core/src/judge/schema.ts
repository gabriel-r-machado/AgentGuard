import { z } from "zod";

import { sourceRefSchema } from "../contract/schema.js";

export const semanticJudgeResultSchema = z
  .object({
    passed: z.boolean(),
    score: z.number().min(0).max(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string().min(1),
    evidence: z.array(z.string().min(1)),
    supportedClaims: z.array(z.string().min(1)),
    unsupportedClaims: z.array(z.string().min(1)),
    violatedRules: z.array(z.string().min(1)),
    sourceRefs: z.array(sourceRefSchema),
    confidence: z.number().min(0).max(1),
    recommendations: z.array(z.string().min(1)),
  })
  .strict();

export type SemanticJudgeResult = z.infer<typeof semanticJudgeResultSchema>;
