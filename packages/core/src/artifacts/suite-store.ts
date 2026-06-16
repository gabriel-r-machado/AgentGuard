import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stablePrettyJson } from "../contract/source-hash.js";
import { testSuiteSchema, type TestSuite } from "../suite/schema.js";

export function getSuitePath(cwd: string): string {
  return join(cwd, ".agentguard", "suite.json");
}

export function writeTestSuite(cwd: string, suite: TestSuite): string {
  const filePath = getSuitePath(cwd);
  mkdirSync(join(cwd, ".agentguard"), { recursive: true });
  writeFileSync(filePath, stablePrettyJson(suite), "utf8");
  return filePath;
}

export function readTestSuite(cwd: string): TestSuite | undefined {
  const filePath = getSuitePath(cwd);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return testSuiteSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}
