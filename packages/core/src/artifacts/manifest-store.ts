import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { stablePrettyJson } from "../contract/source-hash.js";
import type { PresetName } from "../types.js";

export const MANIFEST_SCHEMA_VERSION = 1 as const;

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    preset: z.custom<PresetName>(),
    seed: z.number().int(),
    sourceHash: z.string().min(1),
    contractHash: z.string().min(1),
    suiteHash: z.string().min(1),
    contractSchemaVersion: z.number().int().min(1),
    suiteSchemaVersion: z.number().int().min(1),
    generation: z
      .object({
        scenarios: z.number().int().min(1),
        maxTurns: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;

export function getManifestPath(cwd: string): string {
  return join(cwd, ".agentguard", "manifest.json");
}

export function writeManifest(cwd: string, manifest: Manifest): string {
  const filePath = getManifestPath(cwd);
  mkdirSync(join(cwd, ".agentguard"), { recursive: true });
  writeFileSync(filePath, stablePrettyJson(manifest), "utf8");
  return filePath;
}

export function readManifest(cwd: string): Manifest | undefined {
  const filePath = getManifestPath(cwd);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return manifestSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}
