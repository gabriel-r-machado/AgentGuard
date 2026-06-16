import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-cli-scan-"));
}

function runCli(cwd, args) {
  const cliEntry = join(process.cwd(), "dist/index.js");
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeScanFixture(cwd) {
  mkdirSync(join(cwd, "agent-data", "knowledge"), { recursive: true });
  writeFileSync(
    join(cwd, "agent-data", "system-prompt.md"),
    [
      "Use tom acolhedor e profissional.",
      "Nao invente informacoes.",
      "Colete nome e telefone antes de agendar.",
      "Encaminhe situacoes sensiveis para atendimento humano.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agent-data", "knowledge", "faq.md"),
    [
      "Atendimento inicial por mensagem.",
      "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
      "Nao oferecemos orientacao clinica por chat.",
    ].join("\n\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agentguard.config.ts"),
    `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "cli-scan-example",
    locale: "pt-BR",
    preset: "healthcare-lead-scheduling"
  },
  sources: {
    systemPrompt: {
      type: "file",
      path: "./agent-data/system-prompt.md"
    },
    knowledge: [
      {
        type: "glob",
        pattern: "./agent-data/knowledge/**/*.md"
      }
    ]
  },
  generation: {
    scenarios: 30,
    maxTurns: 5,
    seed: 42
  }
});`,
    "utf8",
  );
}

test("scan --dry-run creates artifacts and reuses them", () => {
  const cwd = createTempDir();
  try {
    writeScanFixture(cwd);

    const first = runCli(cwd, ["scan", "--dry-run"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /Scan summary:/);
    assert.match(first.stdout, /contract: created/);
    assert.match(first.stdout, /suite: created/);
    assert.equal(existsSync(join(cwd, ".agentguard", "contract.json")), true);
    assert.equal(existsSync(join(cwd, ".agentguard", "suite.json")), true);
    assert.equal(existsSync(join(cwd, ".agentguard", "manifest.json")), true);

    const second = runCli(cwd, ["scan", "--dry-run"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /contract: reused/);
    assert.match(second.stdout, /suite: reused/);

    const forced = runCli(cwd, ["scan", "--dry-run", "--regenerate"]);
    assert.equal(forced.status, 0);
    assert.match(forced.stdout, /contract: regenerated/);
    assert.match(forced.stdout, /suite: regenerated/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scan returns exit code 1 when sources changed and --regenerate is missing", () => {
  const cwd = createTempDir();
  try {
    writeScanFixture(cwd);
    const first = runCli(cwd, ["scan", "--dry-run"]);
    assert.equal(first.status, 0);

    writeFileSync(
      join(cwd, "agent-data", "knowledge", "faq.md"),
      [
        "Atendimento inicial por mensagem.",
        "Horarios disponiveis: segunda a sabado, 08:00-18:00.",
        "Nao oferecemos orientacao clinica por chat.",
      ].join("\n\n"),
      "utf8",
    );

    const stale = runCli(cwd, ["scan", "--dry-run"]);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /Warnings:/);
    assert.match(stale.stdout, /--regenerate/);

    const regenerated = runCli(cwd, ["scan", "--dry-run", "--regenerate"]);
    assert.equal(regenerated.status, 0);
    assert.match(regenerated.stdout, /contract: regenerated/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor validates a scan-ready fixture", () => {
  const cwd = createTempDir();
  try {
    writeScanFixture(cwd);
    const result = runCli(cwd, ["doctor"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Doctor status:/);
    assert.match(result.stdout, /\[OK\] config:/);
    assert.match(result.stdout, /\[OK\] sources:/);
    assert.match(result.stdout, /\[OK\] write-permission:/);
    assert.match(result.stdout, /\[WARN\] llm-generator:/);
    assert.match(result.stdout, /\[WARN\] llm-judge:/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
