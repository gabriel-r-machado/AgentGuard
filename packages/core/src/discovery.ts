import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export type DiscoverAgentTestFilesOptions = {
  cwd?: string;
  extensions?: string[];
};

const DEFAULT_TEST_FILE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

export function discoverAgentTestFiles(
  testsDir: string,
  options: DiscoverAgentTestFilesOptions = {},
): string[] {
  const cwd = options.cwd ?? process.cwd();
  const extensions = options.extensions ?? [...DEFAULT_TEST_FILE_EXTENSIONS];
  const root = resolve(cwd, testsDir);
  const discovered: string[] = [];

  walkDirectory(root, extensions, discovered);

  discovered.sort((left, right) => left.localeCompare(right));
  return discovered;
}

function walkDirectory(directory: string, extensions: string[], collector: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(absolutePath, extensions, collector);
      continue;
    }

    if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      collector.push(absolutePath);
    }
  }
}
