import { z } from "zod";

import {
  AGENT_CONTRACT_SCHEMA_VERSION,
  agentContractSchema,
  type AgentContract,
  type ContractFact,
  type ContractRule,
  type SourceRef,
} from "./schema.js";
import { createContentHash } from "./source-hash.js";
import { getPreset } from "../presets/v1.js";
import { AgentGuardProviderError } from "../providers/types.js";

import type { LlmProvider } from "../providers/types.js";
import type { LoadedSources, KnowledgeChunk } from "../knowledge/loader.js";
import type { ResolvedAgentGuardConfig } from "../types.js";

export type ExtractContractInput = {
  config: ResolvedAgentGuardConfig;
  sources: LoadedSources;
  llmProvider?: LlmProvider;
  timestamp?: Date;
};

export interface ContractExtractor {
  extract(input: ExtractContractInput): Promise<AgentContract>;
}

const contractDraftSchema = z
  .object({
    objectives: z.array(z.string().min(1)).default([]),
    tone: z
      .object({
        summary: z.string().min(1).optional(),
        traits: z.array(z.string().min(1)).default([]),
      })
      .default({ traits: [] }),
    systemPromptInstructions: z.array(z.string().min(1)).default([]),
    requiredBehaviors: z.array(z.string().min(1)).default([]),
    forbiddenBehaviors: z.array(z.string().min(1)).default([]),
    supportedTopics: z.array(z.string().min(1)).default([]),
    outOfScopeTopics: z.array(z.string().min(1)).default([]),
    facts: z
      .array(
        z
          .object({
            statement: z.string().min(1),
            confidence: z.number().min(0).max(1).optional(),
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
          .strict(),
      )
      .default([]),
    businessRules: z.array(z.string().min(1)).default([]),
    leadQualification: z
      .object({
        signals: z.array(z.string().min(1)).default([]),
        requiredFields: z.array(z.string().min(1)).default([]),
        optionalFields: z.array(z.string().min(1)).default([]),
        unknowns: z.array(z.string().min(1)).default([]),
      })
      .default({}),
    schedulingPolicy: z
      .object({
        rules: z.array(z.string().min(1)).default([]),
        requiredFields: z.array(z.string().min(1)).default([]),
        unknowns: z.array(z.string().min(1)).default([]),
      })
      .default({}),
    escalationRules: z.array(z.string().min(1)).default([]),
    toolPolicies: z.array(z.string().min(1)).default([]),
    safetyPolicies: z.array(z.string().min(1)).default([]),
    unknownInformation: z
      .array(
        z
          .object({
            topic: z.string().min(1),
            reason: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export function createContractExtractor(): ContractExtractor {
  return {
    async extract(input: ExtractContractInput): Promise<AgentContract> {
      const heuristicContract = buildHeuristicContract(input);
      const role = input.config.llm?.generator;
      if (!input.llmProvider || !role.provider || !role.model) {
        return heuristicContract;
      }

      try {
        const draft = await input.llmProvider.generateStructured({
          model: role.model,
          systemPrompt:
            "You extract grounded, machine-readable agent contracts from a system prompt and knowledge documents. Do not invent capabilities, policies, or facts.",
          userInput: buildContractExtractionPrompt(input, heuristicContract),
          temperature: role.temperature,
          maxTokens: role.maxTokens,
          timeoutMs: role.timeoutMs,
          retries: role.retries,
          schemaName: "AgentContractDraft",
          schema: contractDraftSchema,
          instructions:
            "Prefer concise statements. Only include facts and rules supported by the provided materials.",
        });

        return mergeContractDraft({
          base: heuristicContract,
          draft: contractDraftSchema.parse(draft.object),
          sources: input.sources,
        });
      } catch (error) {
        if (
          error instanceof AgentGuardProviderError &&
          (error.code === "auth" || error.code === "config")
        ) {
          throw error;
        }
        return heuristicContract;
      }
    },
  };
}

function buildHeuristicContract(input: ExtractContractInput): AgentContract {
  const preset = getPreset(input.config.project.preset);
  const promptLines = extractMeaningfulLines(input.sources.systemPrompt.content);
  const systemPromptRef = createSystemPromptRef(input.sources);
  const promptRules = promptLines.map((line, index) =>
    createRule(`prompt-rule-${index + 1}`, line, [systemPromptRef]),
  );

  const requiredBehaviors = promptRules.filter((rule) =>
    looksRequiredBehavior(rule.statement),
  );
  const forbiddenBehaviors = promptRules.filter((rule) =>
    looksForbiddenBehavior(rule.statement),
  );
  const businessRules = promptRules.filter((rule) =>
    looksBusinessRule(rule.statement),
  );
  const escalationRules = promptRules.filter((rule) =>
    looksEscalationRule(rule.statement),
  );
  const toolPolicies = promptRules.filter((rule) =>
    looksToolPolicy(rule.statement),
  );
  const safetyPolicies = promptRules.filter((rule) =>
    looksSafetyPolicy(rule.statement),
  );

  const facts = extractFacts(input.sources.knowledgeChunks);
  const supportedTopics = collectSupportedTopics(facts);
  const outOfScopeTopics = dedupe(
    forbiddenBehaviors
      .map((rule) => inferTopicFromRule(rule.statement))
      .filter((topic): topic is string => Boolean(topic)),
  );
  const objectives = dedupe(
    promptLines.filter((line) => looksObjective(line)).map(cleanStatement),
  );
  const toneTraits = dedupe(promptLines.flatMap((line) => inferToneTraits(line)));

  const leadRequiredFields = inferFields(
    `${input.sources.systemPrompt.content}\n${input.sources.knowledgeDocuments
      .map((entry) => entry.content)
      .join("\n")}`,
    [
      "name",
      "email",
      "phone",
      "whatsapp",
      "insurance",
      "budget",
      "service",
      "preferred time",
    ],
  );

  const schedulingRules = dedupe(
    [
      ...businessRules.map((rule) => rule.statement),
      ...toolPolicies
        .map((rule) => rule.statement)
        .filter((statement) => looksSchedulingPolicy(statement)),
    ].filter((statement) => looksSchedulingPolicy(statement)),
  );

  const unknownInformation = dedupe([
    ...preset.expectedUnknownTopics.filter(
      (topic) => !contentMentionsTopic(input.sources, topic),
    ),
    ...(leadRequiredFields.length === 0
      ? ["required lead fields are not explicitly documented"]
      : []),
    ...(schedulingRules.length === 0
      ? ["scheduling confirmation rules are not explicitly documented"]
      : []),
  ]).map((topic, index) => ({
    id: `unknown-${index + 1}`,
    topic,
    reason: "No explicit support was found in the system prompt or knowledge sources.",
  }));

  return agentContractSchema.parse({
    schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
    generatedAt: (input.timestamp ?? new Date()).toISOString(),
    sourceHash: input.sources.sourceHash,
    identity: {
      projectName: input.config.project.name,
      locale: input.config.project.locale,
      preset: input.config.project.preset,
    },
    objectives,
    tone: {
      summary:
        toneTraits.length > 0
          ? `Observed tone traits: ${toneTraits.join(", ")}.`
          : "Tone is not explicitly specified in the available sources.",
      traits: toneTraits,
    },
    systemPromptInstructions: promptRules,
    requiredBehaviors,
    forbiddenBehaviors,
    supportedTopics,
    outOfScopeTopics,
    facts,
    businessRules,
    leadQualification: {
      signals: dedupe(
        facts
          .filter((fact) => fact.category === "lead-qualification")
          .map((fact) => fact.statement),
      ),
      requiredFields: leadRequiredFields,
      optionalFields: [],
      unknowns:
        leadRequiredFields.length > 0
          ? []
          : ["Required lead fields were not explicitly documented."],
    },
    schedulingPolicy: {
      rules: schedulingRules,
      requiredFields: inferFields(
        `${schedulingRules.join("\n")} ${facts
          .filter((fact) => fact.category === "scheduling")
          .map((fact) => fact.statement)
          .join("\n")}`,
        ["date", "time", "timezone", "service", "confirmation"],
      ),
      unknowns:
        schedulingRules.length > 0
          ? []
          : ["Scheduling policy rules were not explicitly documented."],
    },
    escalationRules,
    toolPolicies,
    safetyPolicies,
    unknownInformation,
  });
}

function buildContractExtractionPrompt(
  input: ExtractContractInput,
  heuristicContract: AgentContract,
): string {
  return [
    `Project: ${input.config.project.name}`,
    `Locale: ${input.config.project.locale}`,
    `Preset: ${input.config.project.preset}`,
    "",
    "System prompt:",
    input.sources.systemPrompt.content,
    "",
    "Knowledge documents:",
    ...input.sources.knowledgeDocuments.map(
      (document) => `## ${document.sourcePath}\n${document.content}`,
    ),
    "",
    "Heuristic baseline for reference:",
    JSON.stringify(
      {
        objectives: heuristicContract.objectives,
        tone: heuristicContract.tone,
        supportedTopics: heuristicContract.supportedTopics,
        outOfScopeTopics: heuristicContract.outOfScopeTopics,
        facts: heuristicContract.facts.map((fact) => ({
          statement: fact.statement,
          category: fact.category,
          confidence: fact.confidence,
        })),
        requiredBehaviors: heuristicContract.requiredBehaviors.map((rule) => rule.statement),
        forbiddenBehaviors: heuristicContract.forbiddenBehaviors.map((rule) => rule.statement),
      },
      null,
      2,
    ),
  ].join("\n");
}

function mergeContractDraft(input: {
  base: AgentContract;
  draft: z.output<typeof contractDraftSchema>;
  sources: LoadedSources;
}): AgentContract {
  const systemPromptRef = createSystemPromptRef(input.sources);
  const facts = dedupeFacts([
    ...input.draft.facts.map((fact, index) => ({
      id: `fact-llm-${index + 1}-${createContentHash(fact.statement).slice(0, 8)}`,
      statement: cleanStatement(fact.statement),
      sourceRefs: findSourceRefsForStatement(fact.statement, input.sources, systemPromptRef),
      confidence: fact.confidence ?? 0.8,
      category: fact.category,
    })),
    ...input.base.facts,
  ]);

  const merged: AgentContract = {
    ...input.base,
    objectives: pickNonEmpty(input.draft.objectives, input.base.objectives),
    tone: {
      summary:
        input.draft.tone.summary ??
        (input.draft.tone.traits.length > 0
          ? `Observed tone traits: ${input.draft.tone.traits.join(", ")}.`
          : input.base.tone.summary),
      traits: pickNonEmpty(input.draft.tone.traits, input.base.tone.traits),
    },
    systemPromptInstructions: mergeRuleStatements(
      "prompt-rule",
      pickNonEmpty(
        input.draft.systemPromptInstructions,
        input.base.systemPromptInstructions.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    requiredBehaviors: mergeRuleStatements(
      "required-rule",
      pickNonEmpty(
        input.draft.requiredBehaviors,
        input.base.requiredBehaviors.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    forbiddenBehaviors: mergeRuleStatements(
      "forbidden-rule",
      pickNonEmpty(
        input.draft.forbiddenBehaviors,
        input.base.forbiddenBehaviors.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    supportedTopics: pickNonEmpty(input.draft.supportedTopics, input.base.supportedTopics),
    outOfScopeTopics: pickNonEmpty(input.draft.outOfScopeTopics, input.base.outOfScopeTopics),
    facts,
    businessRules: mergeRuleStatements(
      "business-rule",
      pickNonEmpty(
        input.draft.businessRules,
        input.base.businessRules.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    leadQualification: {
      signals: pickNonEmpty(input.draft.leadQualification.signals, input.base.leadQualification.signals),
      requiredFields: pickNonEmpty(
        input.draft.leadQualification.requiredFields,
        input.base.leadQualification.requiredFields,
      ),
      optionalFields: pickNonEmpty(
        input.draft.leadQualification.optionalFields,
        input.base.leadQualification.optionalFields,
      ),
      unknowns: pickNonEmpty(input.draft.leadQualification.unknowns, input.base.leadQualification.unknowns),
    },
    schedulingPolicy: {
      rules: pickNonEmpty(input.draft.schedulingPolicy.rules, input.base.schedulingPolicy.rules),
      requiredFields: pickNonEmpty(
        input.draft.schedulingPolicy.requiredFields,
        input.base.schedulingPolicy.requiredFields,
      ),
      unknowns: pickNonEmpty(input.draft.schedulingPolicy.unknowns, input.base.schedulingPolicy.unknowns),
    },
    escalationRules: mergeRuleStatements(
      "escalation-rule",
      pickNonEmpty(
        input.draft.escalationRules,
        input.base.escalationRules.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    toolPolicies: mergeRuleStatements(
      "tool-policy",
      pickNonEmpty(
        input.draft.toolPolicies,
        input.base.toolPolicies.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    safetyPolicies: mergeRuleStatements(
      "safety-policy",
      pickNonEmpty(
        input.draft.safetyPolicies,
        input.base.safetyPolicies.map((rule) => rule.statement),
      ),
      input.sources,
      systemPromptRef,
    ),
    unknownInformation: pickNonEmpty(
      input.draft.unknownInformation.map((entry, index) => ({
        id: `unknown-llm-${index + 1}`,
        topic: entry.topic,
        reason: entry.reason,
      })),
      input.base.unknownInformation,
    ),
  };

  return agentContractSchema.parse(merged);
}

function mergeRuleStatements(
  idPrefix: string,
  statements: string[],
  sources: LoadedSources,
  fallbackRef: SourceRef,
): ContractRule[] {
  return dedupe(statements.map(cleanStatement)).map((statement, index) =>
    createRule(
      `${idPrefix}-${index + 1}`,
      statement,
      findSourceRefsForStatement(statement, sources, fallbackRef),
    ),
  );
}

function findSourceRefsForStatement(
  statement: string,
  sources: LoadedSources,
  fallbackRef: SourceRef,
): SourceRef[] {
  const normalized = statement.toLocaleLowerCase("en-US");
  const refs: SourceRef[] = [];

  if (sources.systemPrompt.content.toLocaleLowerCase("en-US").includes(normalized.slice(0, 24))) {
    refs.push(fallbackRef);
  }

  for (const chunk of sources.knowledgeChunks) {
    if (!chunk.content.toLocaleLowerCase("en-US").includes(normalized.slice(0, 24))) {
      continue;
    }
    refs.push({
      documentId: chunk.documentId,
      chunkId: chunk.id,
      sourcePath: chunk.sourcePath,
      excerpt: truncate(statement, 160),
    });
    if (refs.length >= 2) {
      break;
    }
  }

  return refs.length > 0 ? refs : [fallbackRef];
}

function pickNonEmpty<T>(preferred: T[], fallback: T[]): T[] {
  return preferred.length > 0 ? preferred : fallback;
}

function dedupeFacts(facts: ContractFact[]): ContractFact[] {
  const seen = new Set<string>();
  const deduped: ContractFact[] = [];
  for (const fact of facts) {
    const key = fact.statement.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(fact);
  }
  return deduped;
}

function extractFacts(chunks: KnowledgeChunk[]): ContractFact[] {
  const facts: ContractFact[] = [];

  for (const chunk of chunks) {
    const statements = extractMeaningfulLines(chunk.content);
    for (const statement of statements) {
      if (statement.length < 12 || isStructuralStatement(statement)) {
        continue;
      }

      const sourceRef: SourceRef = {
        documentId: chunk.documentId,
        chunkId: chunk.id,
        sourcePath: chunk.sourcePath,
        excerpt: truncate(statement, 160),
      };

      facts.push({
        id: `fact-${createContentHash(`${chunk.id}:${statement}`).slice(0, 12)}`,
        statement,
        sourceRefs: [sourceRef],
        confidence: 0.9,
        category: inferFactCategory(statement),
      });
    }
  }

  return dedupeByStatement(facts).slice(0, 80);
}

function collectSupportedTopics(facts: ContractFact[]): string[] {
  return dedupe(
    facts.flatMap((fact) => {
      const topic = inferTopicFromRule(fact.statement);
      return topic ? [topic] : [fact.category];
    }),
  );
}

function createSystemPromptRef(sources: LoadedSources): SourceRef {
  return {
    documentId: sources.systemPrompt.id,
    sourcePath: sources.systemPrompt.sourcePath,
    excerpt: truncate(sources.systemPrompt.content, 160),
  };
}

function createRule(idPrefix: string, statement: string, sourceRefs: SourceRef[]): ContractRule {
  return {
    id: `${idPrefix}-${createContentHash(statement).slice(0, 10)}`,
    statement: cleanStatement(statement),
    sourceRefs,
  };
}

function extractMeaningfulLines(content: string): string[] {
  return dedupe(
    content
      .split(/\n+/g)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/g))
      .map(cleanStatement)
      .filter((line) => line.length > 0)
      .filter((line) => !isStructuralStatement(line)),
  );
}

function cleanStatement(value: string): string {
  return value
    .replace(/^#+\s*/u, "")
    .replace(/^[-*]\s*/u, "")
    .replace(/^\d+[.)]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isStructuralStatement(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return (
    /^(faq(\s+\w+)?|regras obrigatorias|regras proibidas|objetivo principal|horario administrativo|horário administrativo)[:]?$/u.test(
      normalized,
    ) || /^[a-z0-9 ]{1,32}:$/u.test(normalized)
  );
}

function looksRequiredBehavior(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(must|always|deve|sempre|collect|qualify|confirm|maintain|responda)/u.test(
    normalized,
  );
}

function looksForbiddenBehavior(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(must not|never|nao deve|não deve|jamais|do not|avoid|nao ofereca|não ofereça|nao prometa|não prometa|promet)/u.test(
    normalized,
  );
}

function looksBusinessRule(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(only|before|after|policy|regra|process|workflow|confirmation|confirmacao|confirmação|required)/u.test(
    normalized,
  );
}

function looksObjective(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(objective|goal|objetivo|ajudar|help|qualify|qualificar|schedule|agendar)/u.test(
    normalized,
  );
}

function looksEscalationRule(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(human|escalat|handoff|atendimento humano|encaminh|emergency|urgenc)/u.test(
    normalized,
  );
}

function looksToolPolicy(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(tool|ferramenta|calendar|agenda|crm|call)/u.test(normalized);
}

function looksSafetyPolicy(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(sensitive|privacy|medical|prompt|instruction|dados|clinica|clínica|diagnos)/u.test(
    normalized,
  );
}

function looksSchedulingPolicy(statement: string): boolean {
  const normalized = statement.toLocaleLowerCase("en-US");
  return /(schedule|agend|appointment|confirm|calendar|time slot|horario|horário)/u.test(
    normalized,
  );
}

function inferFactCategory(statement: string): ContractFact["category"] {
  const normalized = statement.toLocaleLowerCase("en-US");
  if (/(price|pricing|cost|valor|preco|preço|payment)/u.test(normalized)) {
    return "pricing";
  }
  if (/(schedule|appointment|calendar|agenda|horario|horário|confirm)/u.test(normalized)) {
    return "scheduling";
  }
  if (/(address|location|local|clinic|office|unidade)/u.test(normalized)) {
    return "location";
  }
  if (/(email|phone|whatsapp|contact|contato)/u.test(normalized)) {
    return "contact";
  }
  if (/(lead|qualif|field|name|email|phone|insurance|service)/u.test(normalized)) {
    return "lead-qualification";
  }
  if (/(privacy|sensitive|emergency|medical|safety|urgent)/u.test(normalized)) {
    return "safety";
  }
  if (/(policy|rule|must|should|nao deve|não deve)/u.test(normalized)) {
    return "policy";
  }
  if (/(service|procedure|consulta|exam|feature)/u.test(normalized)) {
    return "service";
  }
  return "general";
}

function inferToneTraits(statement: string): string[] {
  const normalized = statement.toLocaleLowerCase("en-US");
  const traits: string[] = [];
  if (/(friendly|amig|acolhed|warm)/u.test(normalized)) {
    traits.push("friendly");
  }
  if (/(professional|profissional)/u.test(normalized)) {
    traits.push("professional");
  }
  if (/(empat|caring|human)/u.test(normalized)) {
    traits.push("empathetic");
  }
  if (/(short|concise|objetiv)/u.test(normalized)) {
    traits.push("concise");
  }
  return traits;
}

function inferFields(content: string, candidates: string[]): string[] {
  const normalized = content.toLocaleLowerCase("en-US");
  return candidates.filter((candidate) =>
    normalized.includes(candidate.toLocaleLowerCase("en-US")),
  );
}

function inferTopicFromRule(statement: string): string | undefined {
  const normalized = statement.toLocaleLowerCase("en-US");
  if (/(price|pricing|cost|valor|preco|preço)/u.test(normalized)) {
    return "pricing";
  }
  if (/(schedule|appointment|agenda|calendar|horario|horário)/u.test(normalized)) {
    return "scheduling";
  }
  if (/(prompt|instruction|system)/u.test(normalized)) {
    return "system instructions";
  }
  if (/(diagnos|medical|clinic|clinica|clínica)/u.test(normalized)) {
    return "clinical guidance";
  }
  if (/(refund|payment|billing)/u.test(normalized)) {
    return "billing";
  }
  if (/(lead|qualif|field)/u.test(normalized)) {
    return "lead qualification";
  }
  return undefined;
}

function contentMentionsTopic(sources: LoadedSources, topic: string): boolean {
  const normalized = `${sources.systemPrompt.content}\n${sources.knowledgeDocuments
    .map((entry) => entry.content)
    .join("\n")}`.toLocaleLowerCase("en-US");
  return normalized.includes(topic.toLocaleLowerCase("en-US"));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeByStatement(facts: ContractFact[]): ContractFact[] {
  const seen = new Set<string>();
  const deduped: ContractFact[] = [];
  for (const fact of facts) {
    const key = fact.statement.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(fact);
  }
  return deduped;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
