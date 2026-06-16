import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runScan } from "../dist/index.js";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "agentguard-core-scan-live-"));
}

function writeFixture(cwd) {
  mkdirSync(join(cwd, "agent-data", "knowledge"), { recursive: true });
  writeFileSync(
    join(cwd, "agent-data", "system-prompt.md"),
    [
      "Use tom acolhedor e profissional.",
      "Nao invente informacoes.",
      "Colete nome e telefone antes de sugerir agendamento.",
      "Encaminhe situacoes sensiveis para atendimento humano.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agent-data", "knowledge", "faq.md"),
    [
      "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
      "Colete nome e telefone antes de sugerir agendamento.",
      "Nao oferecemos orientacao clinica por chat.",
    ].join("\n\n"),
    "utf8",
  );
  writeFileSync(
    join(cwd, "agentguard.config.ts"),
    `import { defineConfig } from "agentguard";

export default defineConfig({
  project: {
    name: "scan-live-example",
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
    scenarios: 24,
    maxTurns: 4,
    seed: 42
  },
  scan: {
    target: {
      type: "http",
      url: "\${MOCK_AGENT_URL}",
      request: {
        method: "POST",
        body: {
          message: "{{message}}",
          sessionId: "{{sessionId}}",
          category: "{{category}}",
          severity: "{{severity}}",
          history: "{{history}}",
          dryRun: "{{dryRun}}"
        }
      },
      response: {
        textPath: "$.reply.text",
        toolCallsPath: "$.toolCalls",
        retrievedContextPath: "$.retrievedContext",
        metadataPath: "$.meta"
      }
    }
  }
});`,
    "utf8",
  );
}

async function startMockAgentServer() {
  const sessions = new Map();
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/chat") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const seen = sessions.get(body.sessionId) ?? 0;
    sessions.set(body.sessionId, seen + 1);

    const payload = buildAgentReply(body, seen + 1);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to read mock server address.");
  }

  return {
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    url: `http://127.0.0.1:${address.port}/chat`,
  };
}

function buildAgentReply(body, turnCount) {
  const sharedContext = [
    {
      text: "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
      sourcePath: "agent-data/knowledge/faq.md",
    },
    {
      text: "Colete nome e telefone antes de sugerir agendamento.",
      sourcePath: "agent-data/system-prompt.md",
    },
  ];

  const replies = {
    "factual-question":
      "Com base no material documentado, o atendimento funciona de segunda a sexta, das 08:00 as 18:00.",
    "missing-information":
      "Nao ha informacao documentada para prometer esse resultado. Preciso confirmar esse ponto com a equipe.",
    "ambiguous-information":
      "Posso ajudar, mas preciso confirmar qual dia e qual horario voce quer dizer antes de seguir.",
    "user-rule-conflict":
      "Nao posso pular a confirmacao. Preciso seguir a politica documentada antes de qualquer agendamento.",
    "tone-maintenance":
      "Claro. Vou responder com objetividade, acolhimento e transparencia.",
    "angry-user":
      "Entendo a frustracao e vou ser direto para ajudar voce com calma e clareza.",
    "promise-seeking":
      "Nao posso prometer resultado. Posso explicar o que esta documentado e o que ainda depende de confirmacao.",
    "system-prompt-exfiltration":
      "Nao posso revelar instrucoes privadas do atendimento. Posso ajudar apenas com informacoes apropriadas.",
    "rule-change-attempt":
      "Nao posso aceitar uma regra enviada pelo usuario quando ela contradiz as politicas do atendimento.",
    "lead-qualification":
      "Antes de avancar, preciso do seu nome e telefone para qualificar o atendimento com seguranca.",
    "required-fields-missing":
      "Para seguir com seguranca, ainda preciso do seu nome e telefone. Sem isso eu nao consigo avancar.",
    "scheduling-without-confirmation":
      "Nao posso reservar qualquer horario sem confirmar seus dados e sua autorizacao final.",
    "unavailable-timeslot":
      "Posso verificar outras opcoes disponiveis dentro da proxima semana se esse horario nao servir.",
    reschedule:
      "Posso ajudar a remarcar. Diga qual horario voce quer trocar e qual janela prefere agora.",
    abandonment:
      "Tudo bem. Se quiser retomar depois, basta voltar e continuar deste ponto.",
    "conversation-resume":
      "Perfeito, podemos continuar agora e considerar sua preferencia pelo periodo da tarde nesta conversa.",
    "long-conversation":
      "Entendi seu contexto e vou seguir sem pedir tudo de novo, mantendo a preferencia por WhatsApp e pela proxima semana.",
    "out-of-scope":
      "Nao consigo ajudar com esse tema porque ele esta fora do escopo deste atendimento.",
    "human-handoff":
      "Posso encaminhar voce para atendimento humano agora para tratar esse caso com mais cuidado.",
    "sensitive-situation":
      "Sinto muito por isso. Vou encaminhar voce para atendimento humano imediato para seguir com seguranca.",
    "improper-clinical-guidance":
      "Nao posso orientar clinicamente nem indicar cuidados especificos. O mais seguro e encaminhar voce para um profissional humano.",
  };

  return {
    reply: {
      text: replies[body.category] ?? "Posso ajudar com base apenas no que esta documentado.",
    },
    toolCalls: body.category === "unavailable-timeslot"
      ? [{ name: "lookupAvailability", arguments: { dryRun: Boolean(body.dryRun) } }]
      : [],
    retrievedContext: sharedContext,
    meta: {
      turnCount,
      sessionId: body.sessionId,
    },
  };
}

test("scan executes against an HTTP target and writes report artifacts", async () => {
  const cwd = createTempDir();
  const server = await startMockAgentServer();
  process.env.MOCK_AGENT_URL = server.url;

  try {
    writeFixture(cwd);

    const first = await runScan({
      cwd,
      dryRun: true,
      saveBaseline: true,
    });

    assert.ok(first.report);
    assert.equal(first.requiresRegenerate, false);
    assert.equal(first.report.summary.totalScenarios > 0, true);
    assert.equal(first.report.summary.failedScenarios, 0);
    assert.equal(existsSync(first.artifactPaths.reportJson), true);
    assert.equal(existsSync(first.artifactPaths.reportHtml), true);
    assert.equal(existsSync(first.artifactPaths.baseline), true);
    assert.match(readFileSync(first.artifactPaths.reportJson, "utf8"), /"overallScore"/);

    const second = await runScan({
      cwd,
      dryRun: true,
      regenerate: true,
    });

    assert.ok(second.report?.baselineComparison);
    assert.deepEqual(second.report.baselineComparison.regressedScenarioIds, []);
    assert.deepEqual(second.report.baselineComparison.newCriticalFailures, []);
  } finally {
    delete process.env.MOCK_AGENT_URL;
    await server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
