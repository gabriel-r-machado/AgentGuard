import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-cli-init-"));
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

test("init creates scaffold files and is idempotent", () => {
  const cwd = createTempDir();
  try {
    const first = runCli(cwd, ["init"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /created: agentguard\.config\.ts/);
    assert.match(first.stdout, /created: ai-tests\/example\.test\.ts/);
    assert.match(first.stdout, /created: \.env\.example/);
    assert.match(first.stdout, /created: \.gitignore/);

    assert.equal(existsSync(join(cwd, "agentguard.config.ts")), true);
    assert.equal(existsSync(join(cwd, "ai-tests", "example.test.ts")), true);
    assert.equal(existsSync(join(cwd, ".env.example")), true);
    assert.equal(existsSync(join(cwd, ".gitignore")), true);
    assert.match(readFileSync(join(cwd, ".gitignore"), "utf8"), /\.agentguard\//);
    assert.match(readFileSync(join(cwd, ".gitignore"), "utf8"), /\.agentguard-ci-report\.json/);

    const second = runCli(cwd, ["init"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /unchanged: agentguard\.config\.ts/);
    assert.match(second.stdout, /unchanged: ai-tests\/example\.test\.ts/);
    assert.match(second.stdout, /unchanged: \.env\.example/);
    assert.match(second.stdout, /unchanged: \.gitignore/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("init skips overwrite by default and updates with --yes", () => {
  const cwd = createTempDir();
  try {
    const boot = runCli(cwd, ["init", "--provider", "deepseek"]);
    assert.equal(boot.status, 0);

    const configPath = join(cwd, "agentguard.config.ts");
    writeFileSync(configPath, "export default { hacked: true };", "utf8");

    const withoutYes = runCli(cwd, ["init", "--provider", "deepseek"]);
    assert.equal(withoutYes.status, 0);
    assert.match(withoutYes.stdout, /skipped: agentguard\.config\.ts/);
    assert.match(withoutYes.stdout, /rerun with --yes to overwrite/);
    assert.equal(readFileSync(configPath, "utf8"), "export default { hacked: true };");

    const withYes = runCli(cwd, ["init", "--provider", "deepseek", "--yes"]);
    assert.equal(withYes.status, 0);
    assert.match(withYes.stdout, /updated: agentguard\.config\.ts/);
    assert.match(readFileSync(configPath, "utf8"), /provider: "deepseek"/);
    assert.match(readFileSync(join(cwd, ".env.example"), "utf8"), /DEEPSEEK_API_KEY=/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("init can generate a copy-paste-ready GitHub Actions workflow", () => {
  const cwd = createTempDir();
  try {
    const first = runCli(cwd, ["init", "--with-github-action", "--provider", "openai"]);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /created: \.github\/workflows\/agentguard\.yml/);

    const workflowPath = join(cwd, ".github", "workflows", "agentguard.yml");
    assert.equal(existsSync(workflowPath), true);
    const workflow = readFileSync(workflowPath, "utf8");
    assert.match(workflow, /actions\/checkout@v5/);
    assert.match(workflow, /actions\/setup-node@v6/);
    assert.match(workflow, /node-version: 24/);
    assert.doesNotMatch(workflow, /npm run build:cli/);
    assert.match(workflow, /npx agentguard test --ci --reporter json/);
    assert.match(workflow, /actions\/upload-artifact@v6/);
    assert.match(workflow, /OPENAI_API_KEY: \${{ secrets\.OPENAI_API_KEY }}/);

    const second = runCli(cwd, ["init", "--with-github-action", "--provider", "openai"]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /unchanged: \.github\/workflows\/agentguard\.yml/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
