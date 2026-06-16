import type { AgentContract, SourceRef } from "../contract/schema.js";
import type { RetrievedContextEntry } from "../targets/types.js";
import type { SuiteScenario } from "../suite/schema.js";

export type SemanticJudgeInput = {
  contract: AgentContract;
  scenario: SuiteScenario;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  agentResponse: string;
  toolCalls: Array<{ name: string; arguments: unknown }>;
  retrievedContext: RetrievedContextEntry[];
  relevantSourceRefs: SourceRef[];
  technicalFailures: string[];
};

export interface SemanticJudge {
  evaluate(input: SemanticJudgeInput): Promise<import("./schema.js").SemanticJudgeResult>;
}
