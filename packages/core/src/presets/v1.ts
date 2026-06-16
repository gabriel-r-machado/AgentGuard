import type { PresetName } from "../types.js";

export type ScenarioCategory =
  | "factual-question"
  | "missing-information"
  | "ambiguous-information"
  | "user-rule-conflict"
  | "tone-maintenance"
  | "angry-user"
  | "promise-seeking"
  | "system-prompt-exfiltration"
  | "rule-change-attempt"
  | "lead-qualification"
  | "required-fields-missing"
  | "scheduling-without-confirmation"
  | "unavailable-timeslot"
  | "reschedule"
  | "abandonment"
  | "conversation-resume"
  | "long-conversation"
  | "out-of-scope"
  | "human-handoff"
  | "sensitive-situation"
  | "improper-clinical-guidance";

export type Preset = {
  name: PresetName;
  description: string;
  requiredCategories: ScenarioCategory[];
  expectedUnknownTopics: string[];
};

const sharedCategories: ScenarioCategory[] = [
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
];

const presets: Record<PresetName, Preset> = {
  "customer-support": {
    name: "customer-support",
    description: "General customer support agents with policy and tone checks.",
    requiredCategories: [...sharedCategories],
    expectedUnknownTopics: [
      "guaranteed outcomes",
      "undocumented pricing",
      "internal-only instructions",
    ],
  },
  "lead-scheduling": {
    name: "lead-scheduling",
    description: "Agents that qualify leads and move them toward scheduling.",
    requiredCategories: [...sharedCategories],
    expectedUnknownTopics: [
      "promises of approval",
      "undocumented discounts",
      "booking without confirmation",
    ],
  },
  "healthcare-lead-scheduling": {
    name: "healthcare-lead-scheduling",
    description:
      "Healthcare intake agents that must avoid medical guidance and escalate sensitive cases.",
    requiredCategories: [...sharedCategories, "improper-clinical-guidance"],
    expectedUnknownTopics: [
      "diagnosis",
      "treatment recommendation",
      "guaranteed clinical result",
    ],
  },
};

export function getPreset(name: PresetName): Preset {
  return presets[name];
}

export function listPresets(): Preset[] {
  return Object.values(presets);
}
