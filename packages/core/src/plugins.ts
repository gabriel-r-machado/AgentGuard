import type { AgentTestSpec, RunSummary, TestResult } from "./types.js";
import type { ProviderAdapter } from "./providers/types.js";

export const AGENTGUARD_PLUGIN_API_VERSION = 1 as const;
export type AgentGuardPluginApiVersion = typeof AGENTGUARD_PLUGIN_API_VERSION;

export type PluginAssertionContext = {
  testId: string;
  spec: AgentTestSpec;
  responseText: string;
  toolCalls?: Array<{ name: string; arguments: unknown }>;
};

export type PluginAssertion = {
  id: string;
  run:
    | ((context: PluginAssertionContext) => string[] | void)
    | ((context: PluginAssertionContext) => Promise<string[] | void>);
};

export type PluginReporter = {
  id: string;
  format:
    | ((input: { summary: RunSummary; results: TestResult[] }) => string)
    | ((input: { summary: RunSummary; results: TestResult[] }) => Promise<string>);
};

export type AgentGuardPluginSetupApi = {
  registerAssertion: (assertion: PluginAssertion) => void;
  registerProvider: (provider: ProviderAdapter) => void;
  registerReporter: (reporter: PluginReporter) => void;
};

export type AgentGuardPlugin = {
  name: string;
  apiVersion: AgentGuardPluginApiVersion;
  setup: (api: AgentGuardPluginSetupApi) => void;
};

export type PluginRuntime = {
  assertions: PluginAssertion[];
  providers: Map<string, ProviderAdapter>;
  reporters: Map<string, PluginReporter>;
};

export class AgentGuardPluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGuardPluginError";
  }
}

export function createPluginRuntime(plugins: AgentGuardPlugin[] = []): PluginRuntime {
  const runtime: PluginRuntime = {
    assertions: [],
    providers: new Map<string, ProviderAdapter>(),
    reporters: new Map<string, PluginReporter>(),
  };

  const assertionIds = new Set<string>();
  const providerNames = new Set<string>();
  const reporterIds = new Set<string>();

  for (const plugin of plugins) {
    validatePlugin(plugin);

    const api: AgentGuardPluginSetupApi = {
      registerAssertion(assertion) {
        validateAssertion(plugin.name, assertion);
        if (assertionIds.has(assertion.id)) {
          throw new AgentGuardPluginError(
            `Duplicate plugin assertion id "${assertion.id}". Assertion ids must be unique across all plugins.`,
          );
        }
        runtime.assertions.push(assertion);
        assertionIds.add(assertion.id);
      },
      registerProvider(provider) {
        validateProvider(plugin.name, provider);
        if (providerNames.has(provider.name)) {
          throw new AgentGuardPluginError(
            `Duplicate plugin provider name "${provider.name}". Provider names must be unique across all plugins.`,
          );
        }
        runtime.providers.set(provider.name, provider);
        providerNames.add(provider.name);
      },
      registerReporter(reporter) {
        validateReporter(plugin.name, reporter);
        if (reporterIds.has(reporter.id)) {
          throw new AgentGuardPluginError(
            `Duplicate plugin reporter id "${reporter.id}". Reporter ids must be unique across all plugins.`,
          );
        }
        runtime.reporters.set(reporter.id, reporter);
        reporterIds.add(reporter.id);
      },
    };

    try {
      plugin.setup(api);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AgentGuardPluginError(
        `Plugin "${plugin.name}" setup failed: ${reason}`,
      );
    }
  }

  return runtime;
}

export async function runPluginAssertions(
  runtime: PluginRuntime,
  context: PluginAssertionContext,
): Promise<string[]> {
  const failures: string[] = [];

  for (const assertion of runtime.assertions) {
    try {
      const output = await assertion.run(context);
      const assertionFailures = normalizeAssertionFailures(assertion.id, output);
      for (const failure of assertionFailures) {
        failures.push(`[plugin:${assertion.id}] ${failure}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(
        `[plugin:${assertion.id}] assertion execution failed: ${reason}`,
      );
    }
  }

  return failures;
}

function normalizeAssertionFailures(
  assertionId: string,
  output: string[] | void,
): string[] {
  if (output === undefined) {
    return [];
  }

  if (!Array.isArray(output) || !output.every((entry) => typeof entry === "string")) {
    throw new Error(
      `invalid plugin assertion output from "${assertionId}": expected string[] or void.`,
    );
  }

  return output;
}

function validatePlugin(plugin: AgentGuardPlugin): void {
  if (typeof plugin !== "object" || plugin === null) {
    throw new AgentGuardPluginError("Invalid plugin: expected an object.");
  }
  if (typeof plugin.name !== "string" || plugin.name.trim() === "") {
    throw new AgentGuardPluginError("Invalid plugin: expected a non-empty plugin name.");
  }
  if (plugin.apiVersion !== AGENTGUARD_PLUGIN_API_VERSION) {
    throw new AgentGuardPluginError(
      `Unsupported plugin apiVersion "${String(
        plugin.apiVersion,
      )}" for plugin "${plugin.name}". Supported version: ${AGENTGUARD_PLUGIN_API_VERSION}.`,
    );
  }
  if (typeof plugin.setup !== "function") {
    throw new AgentGuardPluginError(
      `Invalid plugin "${plugin.name}": expected setup(api) function.`,
    );
  }
}

function validateAssertion(pluginName: string, assertion: PluginAssertion): void {
  if (typeof assertion !== "object" || assertion === null) {
    throw new AgentGuardPluginError(
      `Invalid assertion from plugin "${pluginName}": expected an object.`,
    );
  }
  if (typeof assertion.id !== "string" || assertion.id.trim() === "") {
    throw new AgentGuardPluginError(
      `Invalid assertion from plugin "${pluginName}": expected a non-empty id.`,
    );
  }
  if (typeof assertion.run !== "function") {
    throw new AgentGuardPluginError(
      `Invalid assertion "${assertion.id}" from plugin "${pluginName}": expected run(context) function.`,
    );
  }
}

function validateProvider(pluginName: string, provider: ProviderAdapter): void {
  if (typeof provider !== "object" || provider === null) {
    throw new AgentGuardPluginError(
      `Invalid provider from plugin "${pluginName}": expected an object.`,
    );
  }
  if (typeof provider.name !== "string" || provider.name.trim() === "") {
    throw new AgentGuardPluginError(
      `Invalid provider from plugin "${pluginName}": expected a non-empty name.`,
    );
  }
  if (typeof provider.invoke !== "function") {
    throw new AgentGuardPluginError(
      `Invalid provider "${provider.name}" from plugin "${pluginName}": expected invoke(input) function.`,
    );
  }
}

function validateReporter(pluginName: string, reporter: PluginReporter): void {
  if (typeof reporter !== "object" || reporter === null) {
    throw new AgentGuardPluginError(
      `Invalid reporter from plugin "${pluginName}": expected an object.`,
    );
  }
  if (typeof reporter.id !== "string" || reporter.id.trim() === "") {
    throw new AgentGuardPluginError(
      `Invalid reporter from plugin "${pluginName}": expected a non-empty id.`,
    );
  }
  if (typeof reporter.format !== "function") {
    throw new AgentGuardPluginError(
      `Invalid reporter "${reporter.id}" from plugin "${pluginName}": expected format(input) function.`,
    );
  }
}
