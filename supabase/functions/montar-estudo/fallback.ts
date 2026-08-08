import type { BlocoGerado, BlocosGerados } from "./validacao.ts";

/**
 * Fallback determinístico da Fase B.
 *
 * Diferente do fallback do treino, este é BOM — não é rede de segurança pobre:
 * round-robin das matérias pelos slots, na ordem dos tópicos, com os últimos
 * 20% dos blocos marcados como revisão. Sem IA e sem sequenciamento
 * inteligente, mas gera um plano válido e utilizável.
 */

interface Contexto {
  semana_inicio: string;
  horizonte_semanas: number;
  grade: Array<{ dia_semana: number; hora: string; duracao_min: number }>;
  limites: { max_blocos_dia: number; max_minutos_dia: number; dia_leve: number | null };
  semanas_off: string[];
  materias: Array<Record<string, unknown>>;
}

interface Pendencia {
  materiaId: string;
  materiaNome: string;
  topicoId: string;
  topicoNome: string;
  exigeExercicios: boolean;
  restantes: number;
}

export function distribuicaoRoundRobin(ctx: Contexto): BlocosGerados {
  const filas = montarFilas(ctx);
  const slots = gerarSlots(ctx);

  const total = filas.reduce(
    (s, f) => s + f.reduce((a, p) => a + p.restantes, 0),
    0,
  );
  // Últimos 20% viram revisão.
  const limiarRevisao = Math.max(0, total - Math.ceil(total * 0.2));

  const blocos: BlocoGerado[] = [];
  const primeiraVez = new Set<string>();
  let colocados = 0;
  let vez = 0;

  for (const slot of slots) {
    if (filas.every((f) => f.length === 0)) break;

    // Round-robin: circula entre as matérias, nunca duas seguidas da mesma.
    let tentativas = 0;
    while (filas[vez % filas.length].length === 0 && tentativas < filas.length) {
      vez++;
      tentativas++;
    }
    if (tentativas >= filas.length) break;

    const fila = filas[vez % filas.length];
    vez++;

    const p = fila[0];
    const tipo: BlocoGerado["tipo"] =
      colocados >= limiarRevisao
        ? "revisao"
        : primeiraVez.has(p.topicoId)
          ? p.exigeExercicios
            ? "exercicios"
            : "leitura"
          : "leitura";
    primeiraVez.add(p.topicoId);

    blocos.push({
      data: slot.data,
      hora: slot.hora,
      duracao_min: slot.duracao_min,
      materia_id: p.materiaId,
      topico_id: p.topicoId,
      evento_id: null,
      tipo,
      titulo: `${p.topicoNome} — ${rotulo(tipo)}`,
    });

    colocados++;
    p.restantes--;
    if (p.restantes <= 0) fila.shift();
  }

  const naoAlocados = filas.flatMap((f) =>
    f.map((p) => ({
      topico_id: p.topicoId,
      motivo: "sem slot disponível no horizonte planejado",
    })),
  );

  return { blocos, nao_alocados: naoAlocados };
}

function montarFilas(ctx: Contexto): Pendencia[][] {
  return ctx.materias.map((m) => {
    const topicos = ((m.topicos ?? []) as Array<Record<string, unknown>>)
      .slice()
      .sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0));

    return topicos.map((t) => ({
      materiaId: m.id as string,
      materiaNome: m.nome as string,
      topicoId: t.id as string,
      topicoNome: t.nome as string,
      exigeExercicios: Boolean(t.exige_exercicios),
      restantes: Math.max(1, Number(t.blocos_estimados ?? 1)),
    }));
  });
}

function gerarSlots(ctx: Contexto) {
  const off = new Set(ctx.semanas_off);
  const saida: Array<{ data: string; hora: string; duracao_min: number }> = [];
  const inicio = new Date(`${ctx.semana_inicio}T00:00:00`);

  for (let semana = 0; semana < ctx.horizonte_semanas; semana++) {
    const segunda = new Date(inicio);
    segunda.setDate(segunda.getDate() + semana * 7);
    if (off.has(segunda.toISOString().slice(0, 10))) continue;

    for (let dia = 0; dia < 7; dia++) {
      const d = new Date(segunda);
      d.setDate(d.getDate() + dia);
      if (ctx.limites.dia_leve != null && d.getDay() === ctx.limites.dia_leve) {
        continue;
      }

      const doDia = ctx.grade
        .filter((g) => g.dia_semana === d.getDay())
        .sort((a, b) => a.hora.localeCompare(b.hora))
        // Respeita os limites de carga: cortar aqui é mais simples que
        // conferir depois.
        .slice(0, ctx.limites.max_blocos_dia);

      let minutos = 0;
      for (const g of doDia) {
        if (minutos + g.duracao_min > ctx.limites.max_minutos_dia) break;
        minutos += g.duracao_min;
        saida.push({
          data: d.toISOString().slice(0, 10),
          hora: g.hora.slice(0, 5),
          duracao_min: g.duracao_min,
        });
      }
    }
  }

  return saida.sort((a, b) =>
    `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`),
  );
}

function rotulo(tipo: BlocoGerado["tipo"]): string {
  return { leitura: "primeiro contato", exercicios: "prática", revisao: "revisão", marco: "marco" }[tipo];
}
