import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { agentContractSchema, type AgentContract } from "../contract/schema.js";
import { stablePrettyJson } from "../contract/source-hash.js";

export function getContractPath(cwd: string): string {
  return join(cwd, ".agentguard", "contract.json");
}

export function writeAgentContract(cwd: string, contract: AgentContract): string {
  const filePath = getContractPath(cwd);
  mkdirSync(join(cwd, ".agentguard"), { recursive: true });
  writeFileSync(filePath, stablePrettyJson(contract), "utf8");
  return filePath;
}

export function readAgentContract(cwd: string): AgentContract | undefined {
  const filePath = getContractPath(cwd);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return agentContractSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}
