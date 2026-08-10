// ---------------------------------------------------------------------------
// Schemas e validação das duas fases do Prompt 2.
// ---------------------------------------------------------------------------

export interface Estimativas {
  estimativas: Array<{ indice: number; blocos: number }>;
}

export const SCHEMA_FASE_A = {
  type: "object",
  properties: {
    estimativas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          indice: { type: "integer" },
          blocos: { type: "integer", enum: [1, 2, 3, 4] },
        },
        required: ["indice", "blocos"],
        additionalProperties: false,
      },
    },
  },
  required: ["estimativas"],
  additionalProperties: false,
} as const;

/**
 * exige_exercicios não vem da IA — é dedutível de `blocos` (regra do
 * prompt: 1 bloco = só leitura, 2+ = leitura com prática). Calcular em
 * código em vez de pedir os dois elimina de vez a chance de a IA
 * contradizer a própria regra que descreve (a inconsistência que a seção
 * "checagem de consistência" do prompt tentava pegar depois do fato).
 */
export function exigeExercicios(blocos: number): boolean {
  return blocos >= 2;
}

export interface BlocoGerado {
  data: string;
  hora: string;
  duracao_min: number;
  materia_id: string;
  topico_id: string | null;
  evento_id: string | null;
  tipo: "leitura" | "exercicios" | "revisao" | "marco";
  titulo: string;
}

/** Só um dos dois preenchido — checado em validarDistribuicao, não no schema
    (JSON Schema não expressa XOR entre campos). */
export interface NaoAlocado {
  topico_id: string | null;
  evento_id: string | null;
  motivo: MotivoNaoAlocado;
}

export const MOTIVOS_NAO_ALOCADO = [
  "carga_diaria_excedida",
  "prazo_expirado",
  "prerequisito_nao_agendado",
  "intercalacao_impossivel",
  "semana_off",
  "dia_leve",
  "grade_cheia",
  "sem_horario_compativel",
] as const;
export type MotivoNaoAlocado = (typeof MOTIVOS_NAO_ALOCADO)[number];

export interface BlocosGerados {
  blocos: BlocoGerado[];
  nao_alocados: NaoAlocado[];
}

export const SCHEMA_FASE_B = {
  type: "object",
  properties: {
    blocos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: "string", format: "date" },
          hora: { type: "string" },
          duracao_min: { type: "integer" },
          materia_id: { type: "string" },
          topico_id: { type: ["string", "null"] },
          evento_id: { type: ["string", "null"] },
          tipo: { type: "string", enum: ["leitura", "exercicios", "revisao", "marco"] },
          titulo: { type: "string" },
        },
        required: [
          "data", "hora", "duracao_min", "materia_id",
          "topico_id", "evento_id", "tipo", "titulo",
        ],
        additionalProperties: false,
      },
    },
    // Obrigatório mesmo vazio: alimenta o contador de "N tópicos aguardando
    // replanejamento" na home e o aviso de plano desatualizado. Aceita
    // topico_id OU evento_id (uma prova/entrega inteira também pode não
    // caber, não só um tópico) — sempre os dois campos presentes, um nulo.
    nao_alocados: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topico_id: { type: ["string", "null"] },
          evento_id: { type: ["string", "null"] },
          motivo: {
            type: "string",
            enum: [
              "carga_diaria_excedida",
              "prazo_expirado",
              "prerequisito_nao_agendado",
              "intercalacao_impossivel",
              "semana_off",
              "dia_leve",
              "grade_cheia",
              "sem_horario_compativel",
            ],
          },
        },
        required: ["topico_id", "evento_id", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["blocos", "nao_alocados"],
  additionalProperties: false,
} as const;

interface ContextoB {
  semana_inicio: string;
  horizonte_semanas: number;
  grade: Array<{ dia_semana: number; hora: string; duracao_min: number }>;
  limites: { max_blocos_dia: number; max_minutos_dia: number; dia_leve: number | null };
  semanas_off: string[];
  materias: Array<Record<string, unknown>>;
}

/**
 * Checagens da Fase B. Bloqueantes: horário existe na grade, dentro do
 * horizonte, fora de semana off / dia leve, ids existem, bloco não cai no
 * dia da prova (ou depois) que o tópico serve, carga diária, marco de
 * entrega ≥1 dia antes do prazo, todo tópico/entrega coberto ou em
 * nao_alocados (com alvo válido), pré-requisito de ordem, nunca >2 blocos
 * seguidos da mesma matéria. Avisos: exige_exercicios sem bloco de
 * prática, revisão ausente ou não priorizando tópico difícil/não
 * compreendido antes da prova.
 */
export function validarDistribuicao(
  plano: BlocosGerados,
  ctx: ContextoB,
  ids: { materias: Set<string>; topicos: Set<string>; eventos: Set<string> },
): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];

  const slots = new Set(
    ctx.grade.map((g) => `${g.dia_semana}|${normalizarHora(g.hora)}`),
  );
  const off = new Set(ctx.semanas_off);
  const inicio = new Date(`${ctx.semana_inicio}T00:00:00`);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + ctx.horizonte_semanas * 7);

  // Datas dos eventos, para a checagem 4 (bloco depois da prova).
  const dataDoEvento = new Map<string, string>();
  const topicosDoEvento = new Map<string, Set<string>>();
  for (const m of ctx.materias) {
    for (const ev of (m.eventos ?? []) as Array<Record<string, unknown>>) {
      dataDoEvento.set(ev.id as string, ev.data as string);
      topicosDoEvento.set(
        ev.id as string,
        new Set(
          ((ev.evento_topicos ?? []) as Array<{ topico_id: string }>).map(
            (t) => t.topico_id,
          ),
        ),
      );
    }
  }

  const porDia = new Map<string, { blocos: number; minutos: number }>();
  const cobertos = new Set<string>();

  for (const b of plano.blocos) {
    const rotulo = `bloco ${b.data} ${b.hora}`;
    const d = new Date(`${b.data}T00:00:00`);
    if (Number.isNaN(d.getTime())) {
      erros.push(`${rotulo}: data inválida`);
      continue;
    }

    // --- 2. cai num par (dia_semana, hora) que existe na grade -----------
    if (!slots.has(`${d.getDay()}|${normalizarHora(b.hora)}`)) {
      erros.push(`${rotulo}: esse horário não existe na grade`);
    }

    if (d < inicio || d >= fim) {
      erros.push(
        `${rotulo}: fora do horizonte (${ctx.semana_inicio} + ${ctx.horizonte_semanas} semanas)`,
      );
    }

    // --- 3. nenhum bloco em semana off -----------------------------------
    if (off.has(segundaDaSemana(d))) {
      erros.push(`${rotulo}: cai em semana declarada como off`);
    }

    // --- 7. nenhum bloco no dia leve -------------------------------------
    if (ctx.limites.dia_leve != null && d.getDay() === ctx.limites.dia_leve) {
      erros.push(`${rotulo}: cai no dia leve da semana`);
    }

    // --- 5. materia_id / topico_id / evento_id existem -------------------
    if (!ids.materias.has(b.materia_id)) {
      erros.push(`${rotulo}: materia_id ${b.materia_id} não existe`);
    }
    if (b.topico_id && !ids.topicos.has(b.topico_id)) {
      erros.push(`${rotulo}: topico_id ${b.topico_id} não existe`);
    }
    if (b.evento_id && !ids.eventos.has(b.evento_id)) {
      erros.push(`${rotulo}: evento_id ${b.evento_id} não existe`);
    }
    if (!b.topico_id && !b.evento_id) {
      erros.push(`${rotulo}: precisa apontar para um tópico ou para um evento`);
    }
    if (b.tipo === "marco" && !b.evento_id) {
      erros.push(`${rotulo}: bloco do tipo "marco" precisa de evento_id`);
    }

    // --- 4. nenhum bloco de um tópico no dia da prova ou depois dela -----
    // `>=`, não `>`: estudar conteúdo novo (ou revisar) no PRÓPRIO dia da
    // prova também é proibido, só até a véspera.
    if (b.topico_id) {
      cobertos.add(b.topico_id);
      for (const [evId, tops] of topicosDoEvento) {
        if (tops.has(b.topico_id) && b.data >= (dataDoEvento.get(evId) ?? "9999")) {
          erros.push(
            `${rotulo}: agendado no dia da prova de ${dataDoEvento.get(evId)} ou depois — este tópico serve essa prova`,
          );
        }
      }
    }

    // --- 6. limites de carga ---------------------------------------------
    const acc = porDia.get(b.data) ?? { blocos: 0, minutos: 0 };
    acc.blocos += 1;
    acc.minutos += b.duracao_min;
    porDia.set(b.data, acc);
  }

  for (const [data, acc] of porDia) {
    if (acc.blocos > ctx.limites.max_blocos_dia) {
      erros.push(
        `${data}: ${acc.blocos} blocos, o limite é ${ctx.limites.max_blocos_dia}`,
      );
    }
    if (acc.minutos > ctx.limites.max_minutos_dia) {
      erros.push(
        `${data}: ${acc.minutos} minutos, o limite é ${ctx.limites.max_minutos_dia}`,
      );
    }
  }

  // --- 8. último marco de cada entrega ≥ 1 dia antes do prazo -----------
  const marcosPorEvento = new Map<string, string[]>();
  for (const b of plano.blocos) {
    if (b.tipo === "marco" && b.evento_id) {
      marcosPorEvento.set(b.evento_id, [
        ...(marcosPorEvento.get(b.evento_id) ?? []),
        b.data,
      ]);
    }
  }
  for (const [evId, datas] of marcosPorEvento) {
    const prazo = dataDoEvento.get(evId);
    if (!prazo) continue;
    const ultimo = datas.sort().at(-1)!;
    const limite = new Date(`${prazo}T00:00:00`);
    limite.setDate(limite.getDate() - 1);
    if (new Date(`${ultimo}T00:00:00`) > limite) {
      erros.push(
        `entrega de ${prazo}: o último marco (${ultimo}) precisa cair pelo menos 1 dia antes do prazo`,
      );
    }
  }

  // --- 9a. todo item de nao_alocados aponta pra exatamente um alvo -----
  for (const n of plano.nao_alocados ?? []) {
    if (!n.topico_id && !n.evento_id) {
      erros.push(`um item de nao_alocados não tem topico_id nem evento_id — precisa de um dos dois`);
    } else if (n.topico_id && n.evento_id) {
      erros.push(`um item de nao_alocados tem topico_id E evento_id — só pode ter um`);
    }
  }

  // --- 9b. todo tópico ou tem bloco, ou está em nao_alocados ------------
  const naoAlocados = new Set(
    (plano.nao_alocados ?? []).map((n) => n.topico_id).filter((id): id is string => id != null),
  );
  for (const t of ids.topicos) {
    if (!cobertos.has(t) && !naoAlocados.has(t)) {
      erros.push(
        `tópico ${t} não recebeu bloco e não está em nao_alocados — todo tópico precisa estar em um dos dois`,
      );
    }
  }

  // --- 9c. toda ENTREGA tem marco agendado, ou está em nao_alocados -----
  // Provas não entram aqui: elas são cobertas indiretamente pelos blocos
  // dos tópicos que exigem, não por um bloco com evento_id apontado nela.
  const eventosCobertos = new Set(
    plano.blocos.filter((b) => b.evento_id).map((b) => b.evento_id as string),
  );
  const eventosNaoAlocados = new Set(
    (plano.nao_alocados ?? []).map((n) => n.evento_id).filter((id): id is string => id != null),
  );
  for (const m of ctx.materias) {
    for (const ev of (m.eventos ?? []) as Array<Record<string, unknown>>) {
      if (ev.tipo !== "entrega") continue;
      const evId = ev.id as string;
      if (!eventosCobertos.has(evId) && !eventosNaoAlocados.has(evId)) {
        erros.push(
          `entrega de ${ev.data} não tem nenhum marco agendado e não está em nao_alocados`,
        );
      }
    }
  }

  // --- 9d. pré-requisitos: ordem N só começa depois de ordem N-1 --------
  // "Começa" = a data do primeiro bloco. Tópico já compreendido não conta
  // como pré-requisito pendente — não precisa ocupar bloco pra "liberar"
  // o próximo.
  for (const m of ctx.materias) {
    const topicos = ((m.topicos ?? []) as Array<Record<string, unknown>>)
      .filter((t) => !t.compreendido)
      .sort((a, b) => Number(a.ordem) - Number(b.ordem));

    let dataDoAnterior: string | null = null;
    let nomeDoAnterior = "";
    for (const t of topicos) {
      const id = t.id as string;
      const primeiraData = plano.blocos
        .filter((b) => b.topico_id === id)
        .map((b) => b.data)
        .sort()[0];

      if (primeiraData && dataDoAnterior && primeiraData < dataDoAnterior) {
        erros.push(
          `"${t.nome}" (ordem ${t.ordem}) começou em ${primeiraData}, antes do pré-requisito ` +
            `"${nomeDoAnterior}" (${dataDoAnterior})`,
        );
      }
      if (primeiraData) {
        dataDoAnterior = primeiraData;
        nomeDoAnterior = t.nome as string;
      }
      // tópico não agendado (foi pra nao_alocados): não atualiza o
      // marcador — o próximo da ordem só precisa vir depois do ÚLTIMO
      // que de fato entrou na grade, não de quem ficou de fora.
    }
  }

  // --- 10. nunca mais de 2 blocos seguidos da mesma matéria -------------
  // Bloqueante: "consecutivo" é sobre ORDEM na grade, não sobre intervalo
  // de tempo — um bloco de outra matéria entre os dois já quebra a
  // sequência, mesmo que os horários sejam próximos.
  //
  // Só faz sentido com 2+ matérias ativas — com 1 só, TODO bloco é
  // necessariamente "da mesma matéria" e a regra vira impossível de
  // satisfazer por construção, não por falha da distribuição.
  if (ctx.materias.length > 1) {
    const ordenados = [...plano.blocos].sort((a, b) =>
      `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`),
    );
    let seguidos = 1;
    for (let i = 1; i < ordenados.length; i++) {
      seguidos =
        ordenados[i].materia_id === ordenados[i - 1].materia_id ? seguidos + 1 : 1;
      if (seguidos > 2) {
        erros.push(
          `há ${seguidos} blocos seguidos da mesma matéria por volta de ${ordenados[i].data} — ` +
            `nunca mais de 2; intercale ou deixe o excedente em nao_alocados (intercalacao_impossivel)`,
        );
        break;
      }
    }
  }

  // --- 11. tópico com exige_exercicios tem ao menos 1 bloco "exercicios" -
  for (const m of ctx.materias) {
    for (const t of (m.topicos ?? []) as Array<Record<string, unknown>>) {
      if (!t.exige_exercicios) continue;
      const id = t.id as string;
      if (naoAlocados.has(id)) continue;
      const temPratica = plano.blocos.some(
        (b) => b.topico_id === id && b.tipo === "exercicios",
      );
      if (!temPratica) {
        avisos.push(`"${t.nome}" exige prática mas não recebeu bloco de exercícios`);
      }
    }
  }

  // --- 12. revisão antes de cada prova, priorizando difícil/não-compreendido (aviso) -
  for (const m of ctx.materias) {
    for (const ev of (m.eventos ?? []) as Array<Record<string, unknown>>) {
      if (ev.tipo !== "prova") continue;
      const evId = ev.id as string;
      const revisoesAntes = plano.blocos.filter(
        (b) => b.tipo === "revisao" && b.data <= (ev.data as string),
      );
      if (revisoesAntes.length === 0) {
        avisos.push(`a prova de ${ev.data} não tem nenhum bloco de revisão antes`);
        continue;
      }

      const topicosDaProva = topicosDoEvento.get(evId) ?? new Set<string>();
      const criticos = new Set(
        ((m.topicos ?? []) as Array<Record<string, unknown>>)
          .filter(
            (t) =>
              topicosDaProva.has(t.id as string) &&
              (t.dificuldade === "dificil" || t.compreendido === false),
          )
          .map((t) => t.id as string),
      );
      if (
        criticos.size > 0 &&
        !revisoesAntes.some((b) => b.topico_id && criticos.has(b.topico_id))
      ) {
        avisos.push(
          `a prova de ${ev.data} tem tópico difícil ou não compreendido sem revisão dedicada antes`,
        );
      }
    }
  }

  return { erros, avisos };
}

function normalizarHora(h: string): string {
  return h.slice(0, 5);
}

/** Segunda-feira da semana de `d`, em ISO. Mesma regra do SQL. */
function segundaDaSemana(d: Date): string {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7; // 0 = segunda
  c.setDate(c.getDate() - dow);
  return c.toISOString().slice(0, 10);
}
