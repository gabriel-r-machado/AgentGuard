import { globSync, readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

import { z } from "zod";

import {
  createContentHash,
  createObjectHash,
  normalizeTextContent,
  stablePrettyJson,
} from "../contract/source-hash.js";

import type {
  FileSource,
  GlobSource,
  KnowledgeSource,
  ResolvedAgentGuardConfig,
  SnapshotSource,
  SystemPromptSource,
} from "../types.js";

const snapshotDocumentSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    content: z.string(),
    sourcePath: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const snapshotFileSchema = z
  .object({
    systemPrompt: z.union([
      z.string(),
      z
        .object({
          content: z.string(),
          title: z.string().min(1).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ]),
    knowledgeDocuments: z.array(snapshotDocumentSchema).default([]),
  })
  .strict();

export type SourceMetadata = Record<string, unknown>;

export type SystemPromptSnapshot = {
  id: string;
  title?: string;
  content: string;
  sourcePath: string;
  metadata: SourceMetadata;
  contentHash: string;
};

export type KnowledgeDocument = {
  id: string;
  title?: string;
  content: string;
  sourcePath: string;
  metadata: SourceMetadata;
  contentHash: string;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  index: number;
  content: string;
  sourcePath: string;
  metadata: SourceMetadata;
  contentHash: string;
};

export type LoadedSources = {
  systemPrompt: SystemPromptSnapshot;
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeChunks: KnowledgeChunk[];
  sourceHash: string;
};

export type LoadSourcesInput = {
  cwd: string;
  config: ResolvedAgentGuardConfig;
};

export interface SourceLoader {
  load(input: LoadSourcesInput): Promise<LoadedSources>;
}

export function createSourceLoader(): SourceLoader {
  return {
    async load(input: LoadSourcesInput): Promise<LoadedSources> {
      const systemPromptSource = input.config.sources.systemPrompt;
      if (!systemPromptSource) {
        throw new Error(
          'Scan requires "sources.systemPrompt" in agentguard.config.ts.',
        );
      }

      if (input.config.sources.knowledge.length === 0) {
        throw new Error(
          'Scan requires at least one knowledge source in "sources.knowledge".',
        );
      }

      const systemPrompt = loadSystemPromptSource(input.cwd, systemPromptSource);
      const knowledgeDocuments = input.config.sources.knowledge.flatMap((source) =>
        loadKnowledgeSource(input.cwd, source),
      );

      const knowledgeChunks = knowledgeDocuments.flatMap((document) =>
        createKnowledgeChunks(document),
      );

      const sourceHash = createObjectHash({
        systemPrompt: {
          sourcePath: systemPrompt.sourcePath,
          contentHash: systemPrompt.contentHash,
        },
        knowledgeDocuments: knowledgeDocuments.map((document) => ({
          id: document.id,
          sourcePath: document.sourcePath,
          contentHash: document.contentHash,
        })),
      });

      return {
        systemPrompt,
        knowledgeDocuments,
        knowledgeChunks,
        sourceHash,
      };
    },
  };
}

function loadSystemPromptSource(
  cwd: string,
  source: SystemPromptSource,
): SystemPromptSnapshot {
  if (source.type === "snapshot") {
    const snapshot = readSnapshotFile(cwd, source);
    const systemPromptValue = snapshot.systemPrompt;
    const content =
      typeof systemPromptValue === "string"
        ? normalizeTextContent(systemPromptValue)
        : normalizeTextContent(systemPromptValue.content);
    const metadata =
      typeof systemPromptValue === "string"
        ? { format: "snapshot" }
        : {
            format: "snapshot",
            ...(systemPromptValue.metadata ?? {}),
          };
    const title =
      typeof systemPromptValue === "string"
        ? "System Prompt Snapshot"
        : systemPromptValue.title;

    return {
      id: "system-prompt",
      title,
      content,
      sourcePath: toRelativePath(cwd, resolve(cwd, source.path)),
      metadata,
      contentHash: createContentHash(content),
    };
  }

  return loadFileBackedDocument(cwd, source, "system-prompt");
}

function loadKnowledgeSource(
  cwd: string,
  source: KnowledgeSource,
): KnowledgeDocument[] {
  if (source.type === "snapshot") {
    const snapshot = readSnapshotFile(cwd, source);
    const snapshotPath = resolve(cwd, source.path);
    const snapshotRelativePath = toRelativePath(cwd, snapshotPath);
    return snapshot.knowledgeDocuments.map((entry, index) =>
      normalizeKnowledgeDocument({
        cwd,
        id: entry.id ?? `snapshot-doc-${index + 1}`,
        title: entry.title,
        content: entry.content,
        sourcePath:
          entry.sourcePath ?? `${snapshotRelativePath}#knowledgeDocuments[${index}]`,
        metadata: {
          format: "snapshot",
          ...(entry.metadata ?? {}),
        },
      }),
    );
  }

  if (source.type === "glob") {
    const matches = globSync(source.pattern, {
      cwd,
    }).sort((left, right) => left.localeCompare(right, "en-US"));

    if (matches.length === 0) {
      throw new Error(
        `Knowledge glob "${source.pattern}" did not match any files.`,
      );
    }

    return matches.map((match) =>
      loadFileBackedDocument(cwd, { type: "file", path: match }, "knowledge"),
    );
  }

  return [loadFileBackedDocument(cwd, source, "knowledge")];
}

function loadFileBackedDocument(
  cwd: string,
  source: FileSource,
  fallbackIdPrefix: string,
): KnowledgeDocument & SystemPromptSnapshot {
  const absolutePath = resolve(cwd, source.path);
  const relativePath = toRelativePath(cwd, absolutePath);
  const extension = extname(source.path).toLocaleLowerCase("en-US");
  const rawContent = readFileSync(absolutePath, "utf8");
  const normalized = normalizeFileContent(rawContent, extension);
  const baseTitle = basename(source.path, extension);

  return {
    id: `${fallbackIdPrefix}-${createContentHash(relativePath).slice(0, 10)}`,
    title: normalized.title ?? humanizeTitle(baseTitle),
    content: normalized.content,
    sourcePath: relativePath,
    metadata: {
      format: normalized.format,
      ...(normalized.metadata ?? {}),
    },
    contentHash: createContentHash(normalized.content),
  };
}

function normalizeFileContent(
  rawContent: string,
  extension: string,
): {
  content: string;
  title?: string;
  format: "markdown" | "text" | "json";
  metadata?: SourceMetadata;
} {
  if (extension === ".json") {
    const parsed = JSON.parse(rawContent) as unknown;
    if (isJsonObject(parsed) && typeof parsed.content === "string") {
      const { content, title, ...rest } = parsed;
      return {
        content: normalizeTextContent(content),
        title: typeof title === "string" ? title : undefined,
        format: "json",
        metadata: {
          jsonKeys: Object.keys(parsed).sort((left, right) =>
            left.localeCompare(right, "en-US"),
          ),
          ...(rest as SourceMetadata),
        },
      };
    }

    return {
      content: stablePrettyJson(parsed).trim(),
      format: "json",
      metadata: {
        jsonKeys:
          typeof parsed === "object" && parsed !== null
            ? Object.keys(parsed as Record<string, unknown>).sort((left, right) =>
                left.localeCompare(right, "en-US"),
              )
            : [],
      },
    };
  }

  return {
    content: normalizeTextContent(rawContent),
    format: extension === ".md" ? "markdown" : "text",
  };
}

function createKnowledgeChunks(document: KnowledgeDocument): KnowledgeChunk[] {
  const maxChunkLength = 600;
  const paragraphs = document.content
    .split(/\n\s*\n/g)
    .map((entry) => normalizeTextContent(entry))
    .filter((entry) => entry.length > 0);

  const rawChunks: string[] = [];
  let buffer = "";

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [document.content]) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChunkLength) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      rawChunks.push(buffer);
      buffer = "";
    }

    if (paragraph.length <= maxChunkLength) {
      buffer = paragraph;
      continue;
    }

    rawChunks.push(...splitLongParagraph(paragraph, maxChunkLength));
  }

  if (buffer) {
    rawChunks.push(buffer);
  }

  return rawChunks.map((content, index) => ({
    id: `${document.id}-chunk-${String(index + 1).padStart(3, "0")}`,
    documentId: document.id,
    index,
    content,
    sourcePath: document.sourcePath,
    metadata: {
      ...document.metadata,
      chunkIndex: index,
    },
    contentHash: createContentHash(content),
  }));
}

function splitLongParagraph(paragraph: string, maxLength: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]?/g) ?? [paragraph];
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences.map((entry) => entry.trim()).filter(Boolean)) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length <= maxLength) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }

    if (sentence.length <= maxLength) {
      buffer = sentence;
      continue;
    }

    for (let index = 0; index < sentence.length; index += maxLength) {
      chunks.push(sentence.slice(index, index + maxLength).trim());
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

function readSnapshotFile(cwd: string, source: SnapshotSource) {
  const absolutePath = resolve(cwd, source.path);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = snapshotFileSchema.parse(JSON.parse(raw));
  return parsed;
}

function normalizeKnowledgeDocument(input: {
  cwd: string;
  id: string;
  title?: string;
  content: string;
  sourcePath: string;
  metadata: SourceMetadata;
}): KnowledgeDocument {
  const content = normalizeTextContent(input.content);
  return {
    id: input.id,
    title: input.title,
    content,
    sourcePath: input.sourcePath,
    metadata: input.metadata,
    contentHash: createContentHash(content),
  };
}

function toRelativePath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).replace(/\\/g, "/");
}

function humanizeTitle(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (entry) => entry.toUpperCase());
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
