import {
  type Catalogo,
  LETRAS_POR_DIVISAO,
  PADROES_COMPOSTOS,
  regiaoDoGrupo,
} from "../_shared/catalogo.ts";

export interface ExercicioGerado {
  exercicio_id: number;
  nome: string;
  ordem: number;
  series: number;
  reps_min: number | null;
  reps_max: number | null;
  duracao_seg: number | null;
  descanso_seg: number;
  substitutos: number[];
}

export interface SessaoGerada {
  letra: string;
  nome: string;
  exercicios: ExercicioGerado[];
}

export interface PlanoGerado {
  sessoes: SessaoGerada[];
}

/**
 * As 12 checagens do Prompt 1.
 *
 * Bloqueantes (1-8) impedem a gravação. Avisos (9-12) não impedem, mas entram
 * no retry — é a chance barata de melhorar volume e ênfase antes de aceitar.
 *
 * As checagens 1 (parse/schema) e 6 (reps XOR tempo, parcialmente) já são
 * garantidas pelo `output_config.format` da API. Continuam aqui porque o
 * schema não expressa a regra CRUZADA: qual campo é obrigatório depende de
 * `medida` no catálogo, que o schema não conhece.
 */
export function validarPlano(
  plano: PlanoGerado,
  catalogo: Catalogo,
  contexto: { divisao: string; enfase: string },
): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];

  // --- 5. número e letras das sessões batem com a divisão ---------------
  const esperadas = LETRAS_POR_DIVISAO[contexto.divisao] ?? [];
  const recebidas = plano.sessoes.map((s) => s.letra);
  if (
    recebidas.length !== esperadas.length ||
    !esperadas.every((l) => recebidas.includes(l))
  ) {
    erros.push(
      `divisão ${contexto.divisao} exige as sessões [${esperadas.join(", ")}], vieram [${recebidas.join(", ")}]`,
    );
  }

  const vistosNoCiclo = new Map<number, string[]>();

  for (const sessao of plano.sessoes) {
    const rotulo = `sessão ${sessao.letra}`;
    const idsNaSessao = new Set<number>();

    for (const ex of sessao.exercicios) {
      // --- 2. o id existe no catálogo ------------------------------------
      const doCatalogo = catalogo.porId.get(ex.exercicio_id);
      if (!doCatalogo) {
        // Cobre também a checagem 8: o catálogo já vem filtrado pelos
        // equipamentos indisponíveis, então um id fora dele é um dos dois.
        erros.push(
          `${rotulo}: exercício ${ex.exercicio_id} não existe no catálogo disponível`,
        );
        continue;
      }

      // --- 3. nome bate com o id ----------------------------------------
      // O `nome` é redundante com o id DE PROPÓSITO: se os dois não batem,
      // o modelo alucinou e a validação pega.
      if (ex.nome !== doCatalogo.nome) {
        erros.push(
          `${rotulo}: id ${ex.exercicio_id} é "${doCatalogo.nome}", veio "${ex.nome}"`,
        );
      }

      // --- 4. nenhum id repetido na mesma sessão ------------------------
      if (idsNaSessao.has(ex.exercicio_id)) {
        erros.push(`${rotulo}: exercício ${doCatalogo.nome} aparece duas vezes`);
      }
      idsNaSessao.add(ex.exercicio_id);

      // --- 6. medida="tempo" → duracao_seg; medida="reps" → reps_min/max --
      if (doCatalogo.medida === "tempo") {
        if (ex.duracao_seg == null || ex.reps_min != null || ex.reps_max != null) {
          erros.push(
            `${rotulo}: ${doCatalogo.nome} é medido em tempo — precisa de duracao_seg e reps nulos`,
          );
        }
      } else {
        if (ex.reps_min == null || ex.reps_max == null || ex.duracao_seg != null) {
          erros.push(
            `${rotulo}: ${doCatalogo.nome} é medido em reps — precisa de reps_min/reps_max e duracao_seg nulo`,
          );
        } else if (ex.reps_max < ex.reps_min) {
          erros.push(
            `${rotulo}: ${doCatalogo.nome} tem reps_max (${ex.reps_max}) menor que reps_min (${ex.reps_min})`,
          );
        }
      }

      // --- 7. substitutos: mesmo grupo e mesmo padrão -------------------
      for (const subId of ex.substitutos) {
        const sub = catalogo.porId.get(subId);
        if (!sub) {
          erros.push(
            `${rotulo}: substituto ${subId} de ${doCatalogo.nome} não existe no catálogo disponível`,
          );
          continue;
        }
        if (subId === ex.exercicio_id) {
          erros.push(
            `${rotulo}: ${doCatalogo.nome} aparece como substituto de si mesmo`,
          );
          continue;
        }
        if (
          sub.grupo_primario !== doCatalogo.grupo_primario ||
          sub.padrao_movimento !== doCatalogo.padrao_movimento
        ) {
          erros.push(
            `${rotulo}: "${sub.nome}" não serve de substituto de "${doCatalogo.nome}" — ` +
              `precisa do mesmo grupo (${doCatalogo.grupo_primario}) e do mesmo padrão (${doCatalogo.padrao_movimento})`,
          );
        }
      }

      const onde = vistosNoCiclo.get(ex.exercicio_id) ?? [];
      onde.push(sessao.letra);
      vistosNoCiclo.set(ex.exercicio_id, onde);
    }

    // --- 9. séries por sessão entre 10 e 22 (aviso) ---------------------
    const totalSeries = sessao.exercicios.reduce((s, e) => s + e.series, 0);
    if (totalSeries < 10 || totalSeries > 22) {
      avisos.push(
        `${rotulo}: ${totalSeries} séries no total — o alvo é entre 10 e 22`,
      );
    }

    // --- 10. 4 a 7 exercícios por sessão (aviso) ------------------------
    if (sessao.exercicios.length < 4 || sessao.exercicios.length > 7) {
      avisos.push(
        `${rotulo}: ${sessao.exercicios.length} exercícios — o alvo é entre 4 e 7`,
      );
    }

    // Compostos primeiro, isolamento no fim.
    const ordenados = [...sessao.exercicios].sort((a, b) => a.ordem - b.ordem);
    const ehComposto = (e: ExercicioGerado) =>
      PADROES_COMPOSTOS.has(
        catalogo.porId.get(e.exercicio_id)?.padrao_movimento ?? "",
      );
    const ultimoComposto = ordenados.reduce(
      (idx, e, i) => (ehComposto(e) ? i : idx),
      -1,
    );
    const primeiroIsolamento = ordenados.findIndex((e) => !ehComposto(e));
    if (
      primeiroIsolamento !== -1 &&
      ultimoComposto !== -1 &&
      primeiroIsolamento < ultimoComposto
    ) {
      avisos.push(
        `${rotulo}: há exercício de isolamento antes de um composto — compostos vêm primeiro`,
      );
    }
  }

  // Repetição entre sessões do mesmo ciclo (aviso: "salvo necessidade real").
  for (const [id, letras] of vistosNoCiclo) {
    if (letras.length > 1) {
      avisos.push(
        `"${catalogo.porId.get(id)?.nome}" se repete nas sessões ${letras.join(" e ")}`,
      );
    }
  }

  // --- 11. proporção de ênfase dentro de ±15% do alvo (aviso) ----------
  // A checagem que fecha o ciclo do produto: a ênfase se autovalida.
  const porRegiao = { superior: 0, inferior: 0, core: 0 };
  for (const sessao of plano.sessoes) {
    for (const ex of sessao.exercicios) {
      const g = catalogo.porId.get(ex.exercicio_id)?.grupo_primario;
      if (g) porRegiao[regiaoDoGrupo(g)] += ex.series;
    }
  }
  const baseEnfase = porRegiao.superior + porRegiao.inferior;
  if (baseEnfase > 0) {
    const alvo =
      contexto.enfase === "superior"
        ? 2 / 3
        : contexto.enfase === "inferior"
          ? 1 / 3
          : 0.5;
    const real = porRegiao.superior / baseEnfase;
    if (Math.abs(real - alvo) > 0.15) {
      avisos.push(
        `ênfase "${contexto.enfase}" pede ~${Math.round(alvo * 100)}% do volume em superior, ` +
          `mas saiu ${Math.round(real * 100)}% ` +
          `(${porRegiao.superior} séries superior / ${porRegiao.inferior} inferior)`,
      );
    }
  }

  // --- 12. menos de 20% dos exercícios com comum=3 (aviso) -------------
  const todos = plano.sessoes.flatMap((s) => s.exercicios);
  const raros = todos.filter(
    (e) => (catalogo.porId.get(e.exercicio_id)?.comum ?? 1) === 3,
  ).length;
  if (todos.length > 0 && raros / todos.length > 0.2) {
    avisos.push(
      `${raros} de ${todos.length} exercícios são comum=3 — use mais exercícios comuns (comum=1)`,
    );
  }

  return { erros, avisos };
}

/** Volume por grupo muscular — a mesma conta que alimenta a tela de ênfase. */
export function volumePorGrupo(
  plano: PlanoGerado,
  catalogo: Catalogo,
): Array<{ grupo: string; regiao: string; series: number; sessoes: number }> {
  const acc = new Map<string, { series: number; sessoes: Set<string> }>();
  for (const sessao of plano.sessoes) {
    for (const ex of sessao.exercicios) {
      const g = catalogo.porId.get(ex.exercicio_id)?.grupo_primario;
      if (!g) continue;
      const atual = acc.get(g) ?? { series: 0, sessoes: new Set<string>() };
      atual.series += ex.series;
      atual.sessoes.add(sessao.letra);
      acc.set(g, atual);
    }
  }
  return [...acc.entries()]
    .map(([grupo, v]) => ({
      grupo,
      regiao: regiaoDoGrupo(grupo),
      series: v.series,
      sessoes: v.sessoes.size,
    }))
    .sort((a, b) => b.series - a.series);
}
