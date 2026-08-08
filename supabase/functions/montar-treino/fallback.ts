import type { Catalogo, Exercicio } from "../_shared/catalogo.ts";
import { LETRAS_POR_DIVISAO, PADROES_COMPOSTOS } from "../_shared/catalogo.ts";
import type { ExercicioGerado, PlanoGerado, SessaoGerada } from "./validacao.ts";

/**
 * Rede de segurança do Prompt 1: um template por divisão, sem ênfase.
 *
 * Não escolhe exercícios por id fixo — escolhe por (grupo, padrão), e resolve
 * contra o catálogo do usuário em tempo de execução. Assim o fallback continua
 * funcionando para quem marcou equipamentos como indisponíveis, que é
 * justamente quem tem mais chance de ver a geração falhar.
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

const TEMPLATES: Record<string, Array<{ nome: string; vagas: Vaga[] }>> = {
  AB: [
    { nome: "Superior", vagas: [PEITO, COSTAS_V, OMBRO, COSTAS_H, TRICEPS, BICEPS] },
    { nome: "Inferior", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, POSTERIOR_ISO, PANTURRILHA, ABDOMEN] },
  ],
  ABC: [
    { nome: "Empurrar", vagas: [PEITO, OMBRO, PEITO_ISO, LATERAL, TRICEPS] },
    { nome: "Puxar", vagas: [COSTAS_V, COSTAS_H, BICEPS, ABDOMEN] },
    { nome: "Pernas", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, POSTERIOR_ISO, PANTURRILHA] },
  ],
  ABCD: [
    { nome: "Peito e tríceps", vagas: [PEITO, PEITO_ISO, TRICEPS, ABDOMEN] },
    { nome: "Costas e bíceps", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
    { nome: "Pernas", vagas: [QUADRI, POSTERIOR, QUADRI_ISO, PANTURRILHA] },
    { nome: "Ombro e core", vagas: [OMBRO, LATERAL, GLUTEO, ABDOMEN] },
  ],
  ABCDE: [
    { nome: "Peito", vagas: [PEITO, PEITO_ISO, TRICEPS] },
    { nome: "Costas", vagas: [COSTAS_V, COSTAS_H, BICEPS] },
    { nome: "Pernas — quadríceps", vagas: [QUADRI, QUADRI_ISO, PANTURRILHA] },
    { nome: "Ombro e braços", vagas: [OMBRO, LATERAL, BICEPS, TRICEPS] },
    { nome: "Posterior e glúteo", vagas: [POSTERIOR, GLUTEO, POSTERIOR_ISO, ABDOMEN] },
  ],
};

export function templateFallback(divisao: string, catalogo: Catalogo): PlanoGerado {
  const letras = LETRAS_POR_DIVISAO[divisao] ?? LETRAS_POR_DIVISAO.ABC;
  const modelo = TEMPLATES[divisao] ?? TEMPLATES.ABC;
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
