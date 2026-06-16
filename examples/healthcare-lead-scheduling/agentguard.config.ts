import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "healthcare-lead-scheduling-example",
    locale: "pt-BR",
    preset: "healthcare-lead-scheduling",
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md",
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.{md,txt,json}",
      },
    ],
  },
  generation: {
    scenarios: 40,
    maxTurns: 6,
    seed: 42,
  },
  scan: {
    target: {
      type: "http",
      url: "${MOCK_AGENT_URL}",
      request: {
        method: "POST",
        body: {
          message: "{{message}}",
          sessionId: "{{sessionId}}",
          category: "{{category}}",
          severity: "{{severity}}",
          history: "{{history}}",
          dryRun: "{{dryRun}}",
        },
      },
      response: {
        textPath: "$.reply.text",
        toolCallsPath: "$.toolCalls",
        retrievedContextPath: "$.retrievedContext",
        metadataPath: "$.meta",
      },
    },
  },
});
