import { testAgent } from "agentguard";

testAgent("profile-analysis: should include confidence and assumptions", {
  input:
    "Analyze this profile and summarize strengths, risks, and next steps. " +
    "Profile: Product analyst with 4 years of experience in SQL, A/B testing, and stakeholder communication. " +
    "Respond in English and include the exact words 'confidence' and 'assumptions'.",
  expected: {
    mustInclude: ["confidence", "assumptions"],
    mustNotInclude: ["salary guarantee"],
  },
});
