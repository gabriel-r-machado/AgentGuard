import { createServer } from "node:http";

const port = 4010;
const sessions = new Map();

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
  const turnCount = (sessions.get(body.sessionId) ?? 0) + 1;
  sessions.set(body.sessionId, turnCount);

  const payload = {
    reply: {
      text: replies[body.category] ?? "Posso ajudar com base apenas no que esta documentado.",
    },
    toolCalls: body.category === "unavailable-timeslot"
      ? [{ name: "lookupAvailability", arguments: { dryRun: Boolean(body.dryRun) } }]
      : [],
    retrievedContext: [
      {
        text: "Horarios disponiveis: segunda a sexta, 08:00-18:00.",
        sourcePath: "agent-data/knowledge/faq.md",
      },
      {
        text: "Colete nome e telefone antes de sugerir agendamento.",
        sourcePath: "agent-data/system-prompt.md",
      },
    ],
    meta: {
      sessionId: body.sessionId,
      turnCount,
      historyLength: Array.isArray(body.history) ? body.history.length : 0,
    },
  };

  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Mock agent listening on http://127.0.0.1:${port}/chat\n`);
});
