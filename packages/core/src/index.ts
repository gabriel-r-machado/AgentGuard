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
  defineConfig,
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
export { createGeminiProviderAdapter } from "./providers/gemini.js";
export { createAnthropicProviderAdapter } from "./providers/anthropic.js";
export {
  createLlmProvider,
  createProviderAdapter,
} from "./providers/factory.js";
export { getProviderApiKeyEnv } from "./providers/catalog.js";
export {
  AgentGuardProviderError,
  AuthenticationProviderError,
  ContentBlockedError,
  ConfigurationProviderError,
  InvalidStructuredOutputError,
  ProviderUnavailableError,
  RateLimitProviderError,
  TimeoutProviderError,
} from "./providers/types.js";
export type {
  ProviderAdapter,
  LlmProvider,
  ToolDefinition,
  NormalizedProviderInput,
  NormalizedProviderOutput,
  ProviderErrorCode,
  ProviderMessage,
  StructuredGenerationInput,
  StructuredGenerationResult,
  TextGenerationInput,
  TextGenerationResult,
  TokenUsage,
} from "./providers/types.js";
export {
  createLlmProviderFromAdapter,
  isRecoverableProviderError,
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

export {
  AGENT_CONTRACT_SCHEMA_VERSION,
  agentContractSchema,
} from "./contract/schema.js";
export type {
  AgentContract,
  ContractFact,
  ContractRule,
  SourceRef,
  UnknownInformation,
} from "./contract/schema.js";
export {
  createContentHash,
  createObjectHash,
  normalizeTextContent,
  stablePrettyJson,
  stableStringify,
} from "./contract/source-hash.js";
export {
  createContractExtractor,
} from "./contract/extractor.js";
export type {
  ContractExtractor,
  ExtractContractInput,
} from "./contract/extractor.js";

export {
  createSourceLoader,
} from "./knowledge/loader.js";
export type {
  SourceLoader,
  LoadSourcesInput,
  LoadedSources,
  SystemPromptSnapshot,
  KnowledgeDocument,
  KnowledgeChunk,
} from "./knowledge/loader.js";

export {
  getPreset,
  listPresets,
} from "./presets/v1.js";
export type {
  Preset,
  ScenarioCategory,
} from "./presets/v1.js";

export {
  TEST_SUITE_SCHEMA_VERSION,
  deterministicAssertionSchema,
  regexAssertionSchema,
  scenarioCategorySchema,
  scenarioExpectationsSchema,
  scenarioTurnSchema,
  suiteScenarioSchema,
  toolArgumentAssertionSchema,
  testSuiteSchema,
} from "./suite/schema.js";
export type {
  DeterministicAssertion,
  RegexAssertion,
  ScenarioExpectation,
  SuiteScenario,
  TestSuite,
  ToolArgumentAssertion,
} from "./suite/schema.js";
export {
  createScenarioGenerator,
} from "./suite/generator.js";
export type {
  ScenarioGenerator,
  GenerateSuiteInput,
} from "./suite/generator.js";

export {
  getContractPath,
  readAgentContract,
  writeAgentContract,
} from "./artifacts/contract-store.js";
export {
  getSuitePath,
  readTestSuite,
  writeTestSuite,
} from "./artifacts/suite-store.js";
export {
  getReportHtmlPath,
  getReportJsonPath,
  getRunDirectory,
  getRunsDirectory,
  readBaselineReport,
  scanReportSchema,
  writeBaselineReport,
  writeScanReport,
} from "./artifacts/report-store.js";
export type { ScanReport } from "./artifacts/report-store.js";
export {
  MANIFEST_SCHEMA_VERSION,
  getManifestPath,
  manifestSchema,
  readManifest,
  writeManifest,
} from "./artifacts/manifest-store.js";
export type { Manifest } from "./artifacts/manifest-store.js";

export {
  createSemanticJudge,
} from "./judge/llm.js";
export type { SemanticJudge } from "./judge/types.js";
export type { SemanticJudgeInput } from "./judge/types.js";
export { semanticJudgeResultSchema } from "./judge/schema.js";
export type { SemanticJudgeResult } from "./judge/schema.js";

export {
  runDoctor,
} from "./scan/doctor.js";
export type { RunDoctorOptions } from "./scan/doctor.js";
export {
  evaluateScenarioExecution,
} from "./scan/evaluate.js";
export type {
  DeterministicFinding,
  ScenarioEvaluation,
  TurnEvaluation,
} from "./scan/evaluate.js";
export {
  runScan,
} from "./scan/orchestrator.js";
export type { RunScanOptions } from "./scan/orchestrator.js";
export type {
  ArtifactGenerationStatus,
  DoctorCheck,
  DoctorCheckStatus,
  DoctorResult,
  ScanRunResult,
  ScenarioExecutionResult,
  ScenarioTurnRun,
} from "./scan/types.js";

export {
  createHttpAgentTarget,
} from "./targets/http.js";
export {
  createProviderAgentTarget,
} from "./targets/provider.js";
export {
  collectEnvTemplateSecrets,
  interpolateEnvTemplate,
  redactSecrets,
  renderTemplateValue,
  resolveJsonPath,
} from "./targets/utils.js";
export type {
  AgentTarget,
  AgentTargetTurnInput,
  AgentTargetTurnOutput,
  ConversationMessage,
  ObservedToolCall,
  RetrievedContextEntry,
} from "./targets/types.js";
