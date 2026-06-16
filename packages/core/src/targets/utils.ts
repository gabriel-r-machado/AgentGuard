import { createContentHash } from "../contract/source-hash.js";

export function interpolateEnvTemplate(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => env[key] ?? "");
}

export function collectEnvTemplateSecrets(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const secrets = new Set<string>();
  walkValues(input, (value) => {
    if (typeof value !== "string") {
      return;
    }
    for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      const secret = env[match[1]];
      if (secret) {
        secrets.add(secret);
      }
    }
  });
  return [...secrets];
}

export function redactSecrets(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets.filter((entry) => entry.length > 0)) {
    redacted = redacted.split(secret).join(`[REDACTED:${createContentHash(secret).slice(0, 6)}]`);
  }
  return redacted;
}

export function renderTemplateValue(
  value: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([^}]+)\}\}$/u);
    if (exact) {
      return getContextValue(context, exact[1].trim());
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
      const resolved = getContextValue(context, key.trim());
      if (resolved === undefined || resolved === null) {
        return "";
      }
      if (typeof resolved === "string") {
        return resolved;
      }
      return JSON.stringify(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, context));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        renderTemplateValue(child, context),
      ]),
    );
  }

  return value;
}

export function resolveJsonPath(value: unknown, path: string | undefined): unknown {
  if (!path || path === "$") {
    return value;
  }

  if (!path.startsWith("$")) {
    throw new Error(`Unsupported JSON path "${path}". Paths must start with "$".`);
  }

  const tokens = [...path.matchAll(/\.([A-Za-z0-9_-]+)|\[([0-9]+)\]/g)];
  let current: unknown = value;
  for (const token of tokens) {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (token[1]) {
      current = (current as Record<string, unknown>)[token[1]];
      continue;
    }
    if (token[2]) {
      current = (current as unknown[])[Number(token[2])];
    }
  }
  return current;
}

function getContextValue(context: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = context;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function walkValues(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkValues(entry, visitor);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      walkValues(child, visitor);
    }
  }
}
