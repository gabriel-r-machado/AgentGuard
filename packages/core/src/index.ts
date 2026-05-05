export type {
  SnapshotMode,
  AgentProvider,
  AgentGuardConfig,
  ResolvedAgentGuardConfig,
  AgentTestSpec,
  TestStatus,
  TestResult,
  RunSummary,
} from "./types.js";

export {
  AgentGuardConfigError,
  loadAgentGuardConfig,
} from "./config.js";

export type { LoadAgentGuardConfigOptions } from "./config.js";

export {
  AgentGuardDslError,
  testAgent,
  getRegisteredAgentTests,
  clearAgentTestRegistry,
  collectAgentTestsFromFiles,
} from "./dsl.js";

export type {
  RegisteredAgentTest,
  CollectAgentTestsOptions,
} from "./dsl.js";

export { discoverAgentTestFiles } from "./discovery.js";
export type { DiscoverAgentTestFilesOptions } from "./discovery.js";

export { runAgentTests } from "./runner.js";
export type {
  StubExecutorOutput,
  StubExecutor,
  RunAgentTestsOptions,
  RunAgentTestsResult,
} from "./runner.js";

export {
  runAssertions,
  runTextAssertions,
  normalizeTextForComparison,
} from "./assertions.js";
export type {
  TextAssertionContext,
  AssertionResult,
  JudgeAssertionResult,
} from "./assertions.js";

export { runSnapshotAssertion } from "./snapshot.js";
export type { SnapshotAssertionResult } from "./snapshot.js";

export {
  AGENTGUARD_PLUGIN_API_VERSION,
  AgentGuardPluginError,
  createPluginRuntime,
  runPluginAssertions,
} from "./plugins.js";
export type {
  AgentGuardPluginApiVersion,
  PluginAssertionContext,
  PluginAssertion,
  PluginReporter,
  AgentGuardPluginSetupApi,
  AgentGuardPlugin,
  PluginRuntime,
} from "./plugins.js";

export { createOpenAIProviderAdapter } from "./providers/openai.js";
export { createDeepSeekProviderAdapter } from "./providers/deepseek.js";
export {
  AgentGuardProviderError,
} from "./providers/types.js";
export type {
  ProviderAdapter,
  ToolDefinition,
  NormalizedProviderInput,
  NormalizedProviderOutput,
  ProviderErrorCode,
} from "./providers/types.js";

export { estimateModelCostUsd, formatUsd } from "./cost.js";

export { persistRunArtifact } from "./results-store.js";
export type { RunArtifact, RunArtifactFailure } from "./results-store.js";

export {
  createPromptInjectionPreset,
  createDataLeakagePreset,
  createToolMisusePreset,
  createSecurityPresets,
} from "./security-presets.js";
export type {
  SecurityPresetCase,
  SecurityPresetOptions,
  ToolMisusePresetOptions,
} from "./security-presets.js";
