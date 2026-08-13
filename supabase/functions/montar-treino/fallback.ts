import type { Catalogo, Exercicio } from "../_shared/catalogo.ts";
import { LETRAS_POR_DIVISAO, PADROES_COMPOSTOS } from "../_shared/catalogo.ts";
import type { ExercicioGerado, PlanoGerado, SessaoGerada } from "./validacao.ts";

/**
 * Rede de segurança do Prompt 1: um template por divisão E POR ÊNFASE.
 *
 * Não escolhe exercícios por id fixo — escolhe por (grupo, padrão), e resolve
 * contra o catálogo do usuário em tempo de execução. Assim o fallback continua
 * funcionando para quem marcou equipamentos como indisponíveis, que é
 * justamente quem tem mais chance de ver a geração falhar.
 *
 * ---------------------------------------------------------------------
 * POR QUE A ÊNFASE ENTROU AQUI (antes o template era um só, genérico)
 *
 * Quem pedia ênfase inferior e caía no fallback recebia A=Empurrar,
 * B=Puxar, C=Pernas — 2 dias de superior contra 1 de inferior, ou seja o
 * OPOSTO do que pediu, gravado como plano permanente. O aviso na tela
 * dizia "modelo padrão", o que não deixa claro que a ênfase foi ignorada.
 *
 * A regra aplicada é a mesma do prompt: ênfase se expressa REALOCANDO
 * SESSÃO INTEIRA, nunca misturando superior e inferior no mesmo dia. Com
 * ABC e ênfase inferior isso quer dizer 1 dia de superior completo e 2 de
 * inferior com recortes diferentes (anterior/quadríceps e
 * posterior/glúteo) — que também é o que resolve a ausência de glúteo e
 * de adutores/abdutores no template antigo.
 *
 * AB é a exceção do próprio prompt: com uma sessão de cada lado não há dia
 * para realocar, então a ênfase vira número de exercícios (e, com isso, de
 * séries) dentro dos limites da validação.
 *
 * As proporções resultantes são verificadas por `proporcaoInferior()`, no
 * fim deste arquivo, contra as mesmas faixas que a validação cobra.
 * ---------------------------------------------------------------------
 */

type Vaga = { grupo: string; padrao: string };

const PEITO: Vaga = { grupo: "peito", padrao: "empurrar horizontal" };
const COSTAS_V: Vaga = { grupo: "costas", padrao: "puxar vertical" };
const COSTAS_H: Vaga = { grupo: "costas", padrao: "puxar horizontal" };
const OMBRO: Vaga = { grupo: "ombro", padrao: "empurrar vertical" };
const LATERAL: Vaga = { grupo: "ombro", padrao: "isolamento de ombro" };
const BICEPS: Vaga = { grupo: "bíceps", padrao: "isolamento de braço" };
const TRICEPS: Vaga = { grupo: "tríceps", padrao: "isolamento de braço" };
const PEITO_ISO: Vaga = { grupo: "peito", padrao: "isolamento de peito" };
const QUADRI: Vaga = { grupo: "quadríceps", padrao: "dominante de joelho" };
const QUADRI_ISO: Vaga = { grupo: "quadríceps", padrao: "isolamento de perna" };
const POSTERIOR: Vaga = { grupo: "posterior", padrao: "dominante de quadril" };
const POSTERIOR_ISO: Vaga = { grupo: "posterior", padrao: "isolamento de perna" };
const GLUTEO: Vaga = { grupo: "glúteo", padrao: "dominante de quadril" };
const PANTURRILHA: Vaga = { grupo: "panturrilha", padrao: "panturrilha" };
const ABDOMEN: Vaga = { grupo: "abdômen", padrao: "flexão de tronco" };
// Faltavam no template antigo, e é o que deixava glúteo e o trabalho de
// quadril de fora justamente de quem pediu ênfase inferior.
const GLUTEO_ISO: Vaga = { grupo: "glúteo", padrao: "isolamento de perna" };
const ABDUTORES: Vaga = { grupo: "abdutores", padrao: "isolamento de perna" };
const ADUTORES: Vaga = { grupo: "adutores", padrao: "isolamento de perna" };
const QUADRI_UNI: Vaga = { grupo: "quadríceps", padrao: "unilateral" };

type Sessao = { nome: string; vagas: Vaga[] };
type PorEnfase = { equilibrado: Sessao[]; superior?: Sessao[]; inferior?: Sessao[] };

/* Blocos reaproveitados entre divisões. */
const SUPERIOR_COMPLETO: Sessao = {
  nome: "Superior completo",
  vagas: [PEITO, COSTAS_V, OMBRO, LATERAL, TRICEPS, BICEPS],
};
const INFERIOR_ANTERIOR: Sessao = {
  nome: "Inferior — quadríceps",
  vagas: [QUADRI, QUADRI_UNI, QUADRI_ISO, PANTURRILHA, ABDUTORES],
};
const INFERIOR_POSTERIOR: Sessao = {
  nome: "Inferior — posterior e glúteo",
  vagas: [POSTERIOR, GLUTEO, POSTERIOR_ISO, PANTURRILHA, ADUTORES, ABDOMEN],
};

const TEMPLATES: Record<string, PorEnfase> = {
  AB: {
    equilibrado: [
      { nome: "Superior", vagas: [PEITO, COSTAS_V, OMBRO, COSTAS_H, TRICEPS, BICEPS] },
      { nome: "Inferior", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, POSTERIOR_ISO, PANTURRILHA, ABDOMEN] },
    ],
    // Sem dia para realocar: a ênfase vira quantidade de trabalho por lado.
    inferior: [
      { nome: "Superior", vagas: [PEITO, COSTAS_V, LATERAL, TRICEPS] },
      { nome: "Inferior", vagas: [QUADRI, POSTERIOR, GLUTEO, QUADRI_ISO, POSTERIOR_ISO, PANTURRILHA] },
    ],
    superior: [
      // Sem COSTAS_H: com ele a sessão ia a 25 séries, acima do teto de 22.
      { nome: "Superior", vagas: [PEITO, COSTAS_V, OMBRO, LATERAL, TRICEPS, BICEPS] },
      { nome: "Inferior", vagas: [QUADRI, POSTERIOR, PANTURRILHA, ABDOMEN] },
    ],
  },
  ABC: {
    equilibrado: [
      { nome: "Empurrar", vagas: [PEITO, OMBRO, PEITO_ISO, LATERAL, TRICEPS] },
      { nome: "Puxar", vagas: [COSTAS_V, COSTAS_H, BICEPS, ABDOMEN] },
      { nome: "Pernas", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, POSTERIOR_ISO, PANTURRILHA] },
    ],
    // 2 dos 3 dias no lado enfatizado, com recortes diferentes para não
    // repetir exercício nem deixar buraco (glúteo, adutores, abdutores).
    inferior: [SUPERIOR_COMPLETO, INFERIOR_ANTERIOR, INFERIOR_POSTERIOR],
    superior: [
      { nome: "Empurrar", vagas: [PEITO, OMBRO, PEITO_ISO, LATERAL, TRICEPS] },
      { nome: "Puxar", vagas: [COSTAS_V, COSTAS_H, BICEPS, ABDOMEN] },
      { nome: "Inferior completo", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, PANTURRILHA] },
    ],
  },
  ABCD: {
    equilibrado: [
      { nome: "Peito e tríceps", vagas: [PEITO, PEITO_ISO, TRICEPS, ABDOMEN] },
      { nome: "Costas e bíceps", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
      { nome: "Pernas", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, PANTURRILHA] },
      { nome: "Ombro e core", vagas: [OMBRO, LATERAL, GLUTEO, ABDOMEN] },
    ],
    inferior: [
      SUPERIOR_COMPLETO,
      INFERIOR_ANTERIOR,
      INFERIOR_POSTERIOR,
      { nome: "Inferior — unilateral e glúteo", vagas: [QUADRI, GLUTEO, GLUTEO_ISO, PANTURRILHA] },
    ],
    superior: [
      { nome: "Peito e tríceps", vagas: [PEITO, PEITO_ISO, TRICEPS, ABDOMEN] },
      { nome: "Costas e bíceps", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
      { nome: "Ombro e braços", vagas: [OMBRO, LATERAL, TRICEPS, BICEPS] },
      { nome: "Inferior completo", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, PANTURRILHA] },
    ],
  },
  ABCDE: {
    equilibrado: [
      { nome: "Peito", vagas: [PEITO, PEITO_ISO, TRICEPS] },
      { nome: "Costas", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
      { nome: "Pernas — quadríceps", vagas: [QUADRI, QUADRI_ISO, PANTURRILHA] },
      { nome: "Ombro e braços", vagas: [OMBRO, LATERAL, BICEPS, TRICEPS] },
      { nome: "Posterior e glúteo", vagas: [POSTERIOR, GLUTEO, POSTERIOR_ISO, ABDOMEN] },
    ],
    inferior: [
      { nome: "Superior — empurrar", vagas: [PEITO, OMBRO, LATERAL, TRICEPS] },
      { nome: "Superior — puxar", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
      INFERIOR_ANTERIOR,
      INFERIOR_POSTERIOR,
      { nome: "Inferior — unilateral e glúteo", vagas: [QUADRI, GLUTEO, GLUTEO_ISO, PANTURRILHA] },
    ],
    superior: [
      { nome: "Peito", vagas: [PEITO, PEITO_ISO, TRICEPS] },
      { nome: "Costas", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
      { nome: "Ombro e braços", vagas: [OMBRO, LATERAL, BICEPS, TRICEPS] },
      { nome: "Peito e costas — volume", vagas: [PEITO, COSTAS_V, PEITO_ISO, ABDOMEN] },
      // Com GLUTEO: sem ele a proporção caía a 23,7% de inferior, abaixo do
      // piso de 28% — ênfase superior não significa abandonar a perna.
      { nome: "Inferior completo", vagas: [QUADRI, POSTERIOR, GLUTEO, QUADRI_ISO, PANTURRILHA] },
    ],
  },
};

export type Enfase = "superior" | "inferior" | "equilibrado";

export function templateFallback(
  divisao: string,
  catalogo: Catalogo,
  enfase: Enfase = "equilibrado",
): PlanoGerado {
  const letras = LETRAS_POR_DIVISAO[divisao] ?? LETRAS_POR_DIVISAO.ABC;
  const porEnfase = TEMPLATES[divisao] ?? TEMPLATES.ABC;
  // Cai no equilibrado se a divisão não tiver variante — melhor um plano
  // sem ênfase que nenhum plano.
  const modelo = porEnfase[enfase] ?? porEnfase.equilibrado;
  const jaUsados = new Set<number>();

  const sessoes: SessaoGerada[] = modelo.map((tpl, i) => {
    const exercicios: ExercicioGerado[] = [];

    for (const vaga of tpl.vagas) {
      const escolhido = escolher(catalogo, vaga, jaUsados);
      if (!escolhido) continue;
      jaUsados.add(escolhido.id);

      // BUG achado no primeiro teste real: aqui havia
      // `!padrao_movimento.startsWith("isolamento")`, um palpite que
      // divergia da lista usada pela validação. Cinco padrões caíam no
      // lado errado — `panturrilha`, `flexão de tronco`, `antiextensão`,
      // `rotação` e `extensão de tronco` — e viravam 4x6-10 com 120s de
      // descanso, quando o spec pede complemento (3x10-15, 60s).
      //
      // Duas definições de "composto" no mesmo código é bug esperando
      // acontecer. PADROES_COMPOSTOS é a única fonte da verdade.
      const composto = PADROES_COMPOSTOS.has(escolhido.padrao_movimento);
      const porTempo = escolhido.medida === "tempo";

      exercicios.push({
        exercicio_id: escolhido.id,
        nome: escolhido.nome,
        ordem: exercicios.length + 1,
        series: composto ? 4 : 3,
        reps_min: porTempo ? null : composto ? 6 : 10,
        reps_max: porTempo ? null : composto ? 10 : 15,
        duracao_seg: porTempo ? 40 : null,
        descanso_seg: composto ? 120 : 60,
        substitutos: substitutos(catalogo, escolhido),
      });
    }

    return { letra: letras[i], nome: tpl.nome, exercicios };
  });

  return { sessoes };
}

/* ---------------------------------------------------------------------
   Verificação das proporções — mesma conta que a validação de domínio.

   Existe para que as faixas de ênfase sejam MEDIDAS e não estimadas no
   olho: os totais dependem de quais padrões são compostos (4 séries) e
   quais não são (3), e errar isso à mão é fácil. Roda em
   `scripts/verificar-templates.mjs`.

   Abdômen e lombar ficam de fora da conta, como manda o prompt.
   --------------------------------------------------------------------- */

const GRUPOS_SUPERIOR = new Set(["peito", "costas", "ombro", "bíceps", "tríceps"]);
const GRUPOS_INFERIOR = new Set([
  "quadríceps",
  "posterior",
  "glúteo",
  "panturrilha",
  "adutores",
  "abdutores",
]);

/** Séries que o template atribui a uma vaga — espelha `templateFallback`. */
function seriesDaVaga(v: Vaga): number {
  return PADROES_COMPOSTOS.has(v.padrao) ? 4 : 3;
}

export function proporcaoInferior(
  divisao: string,
  enfase: Enfase,
): { inferior: number; superior: number; pctInferior: number; seriesPorSessao: number[] } {
  const porEnfase = TEMPLATES[divisao] ?? TEMPLATES.ABC;
  const modelo = porEnfase[enfase] ?? porEnfase.equilibrado;

  let inferior = 0;
  let superior = 0;
  const seriesPorSessao: number[] = [];

  for (const sessao of modelo) {
    let total = 0;
    for (const v of sessao.vagas) {
      const s = seriesDaVaga(v);
      total += s;
      if (GRUPOS_SUPERIOR.has(v.grupo)) superior += s;
      else if (GRUPOS_INFERIOR.has(v.grupo)) inferior += s;
    }
    seriesPorSessao.push(total);
  }

  const base = inferior + superior;
  return {
    inferior,
    superior,
    pctInferior: base === 0 ? 0 : (inferior / base) * 100,
    seriesPorSessao,
  };
}

/** Prefere comum=1, e um exercício ainda não usado no ciclo. */
function escolher(
  catalogo: Catalogo,
  vaga: Vaga,
  jaUsados: Set<number>,
): Exercicio | null {
  const candidatos = catalogo.lista
    .filter(
      (e) => e.grupo_primario === vaga.grupo && e.padrao_movimento === vaga.padrao,
    )
    .sort((a, b) => a.comum - b.comum || a.id - b.id);

  return candidatos.find((e) => !jaUsados.has(e.id)) ?? candidatos[0] ?? null;
}

/**
 * Mesmo grupo + mesmo padrão, preferindo equipamento diferente do titular.
 * É a mesma regra do fallback de substituição em runtime — e o motivo de
 * quatro padrões do catálogo (carregamento, isolamento de antebraço,
 * isolamento de costas, rotação) devolverem lista curta ou vazia aqui.
 */
function substitutos(catalogo: Catalogo, titular: Exercicio): number[] {
  return catalogo.lista
    .filter(
      (e) =>
        e.id !== titular.id &&
        e.grupo_primario === titular.grupo_primario &&
        e.padrao_movimento === titular.padrao_movimento,
    )
    .sort(
      (a, b) =>
        Number(a.equipamento === titular.equipamento) -
          Number(b.equipamento === titular.equipamento) ||
        a.comum - b.comum,
    )
    .slice(0, 3)
    .map((e) => e.id);
}
