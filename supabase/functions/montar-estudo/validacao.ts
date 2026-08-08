// ---------------------------------------------------------------------------
// Schemas e validação das duas fases do Prompt 2.
// ---------------------------------------------------------------------------

export interface Estimativas {
  estimativas: Array<{ indice: number; blocos: number; exige_exercicios: boolean }>;
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
          exige_exercicios: { type: "boolean" },
        },
        required: ["indice", "blocos", "exige_exercicios"],
        additionalProperties: false,
      },
    },
  },
  required: ["estimativas"],
  additionalProperties: false,
} as const;

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

export interface BlocosGerados {
  blocos: BlocoGerado[];
  nao_alocados: Array<{ topico_id: string; motivo: string }>;
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
    // replanejamento" na home e o aviso de plano desatualizado.
    nao_alocados: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topico_id: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["topico_id", "motivo"],
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

/** As 12 checagens da Fase B: 1-9 bloqueantes, 10-12 avisos. */
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

    // --- 4. nenhum bloco de um tópico depois do evento que ele serve -----
    if (b.topico_id) {
      cobertos.add(b.topico_id);
      for (const [evId, tops] of topicosDoEvento) {
        if (tops.has(b.topico_id) && b.data > (dataDoEvento.get(evId) ?? "9999")) {
          erros.push(
            `${rotulo}: agendado depois da prova de ${dataDoEvento.get(evId)} que este tópico serve`,
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

  // --- 9. todo tópico ou tem bloco, ou está em nao_alocados -------------
  const naoAlocados = new Set((plano.nao_alocados ?? []).map((n) => n.topico_id));
  for (const t of ids.topicos) {
    if (!cobertos.has(t) && !naoAlocados.has(t)) {
      erros.push(
        `tópico ${t} não recebeu bloco e não está em nao_alocados — todo tópico precisa estar em um dos dois`,
      );
    }
  }

  // --- 10. nunca mais de 2 blocos seguidos da mesma matéria (aviso) -----
  const ordenados = [...plano.blocos].sort((a, b) =>
    `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`),
  );
  let seguidos = 1;
  for (let i = 1; i < ordenados.length; i++) {
    seguidos =
      ordenados[i].materia_id === ordenados[i - 1].materia_id ? seguidos + 1 : 1;
    if (seguidos > 2) {
      avisos.push(
        `há ${seguidos} blocos seguidos da mesma matéria por volta de ${ordenados[i].data} — intercale`,
      );
      break;
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

  // --- 12. existe ao menos 1 bloco "revisao" antes de cada prova (aviso) -
  for (const m of ctx.materias) {
    for (const ev of (m.eventos ?? []) as Array<Record<string, unknown>>) {
      if (ev.tipo !== "prova") continue;
      const temRevisao = plano.blocos.some(
        (b) => b.tipo === "revisao" && b.data <= (ev.data as string),
      );
      if (!temRevisao) {
        avisos.push(`a prova de ${ev.data} não tem nenhum bloco de revisão antes`);
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
