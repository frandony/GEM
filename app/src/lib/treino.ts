import type { ExercicioDaSessao } from "../telas/SessaoTreino";

/* =====================================================================
   Contas sobre um treino — puras, sem React e sem Supabase.
   =====================================================================
   Diferente de `progressao.ts`, que é especificamente sobre sugestão de
   carga. Aqui mora o que se deriva da LISTA de exercícios de uma sessão.
   ===================================================================== */

/**
 * Grupos musculares únicos (ordem de aparição) e uma estimativa de
 * duração — nem `sessoes` nem `sessao_exercicios` guardam duração, então
 * é uma conta aproximada: cada série custa ~40s de execução + o descanso
 * dela. Não é cronômetro, é só pra dar noção do tamanho do treino.
 *
 * Vive aqui, e não em `EditarPlano.tsx` (de onde saiu), porque a Início
 * mostra o mesmo "~N min" no cartão do carrossel. Duas contas separadas
 * para o mesmo número acabariam divergindo — e a pessoa veria durações
 * diferentes pro mesmo treino em duas telas.
 */
export function resumoDaSessao(exercicios: ExercicioDaSessao[]): {
  grupos: string;
  minutosEstimados: number;
  descansoMedio: number;
} {
  const gruposUnicos = [...new Set(exercicios.map((e) => e.grupoPrimario).filter(Boolean))];
  const listaGrupos = gruposUnicos.join(", ");
  const grupos = listaGrupos ? listaGrupos.charAt(0).toUpperCase() + listaGrupos.slice(1) : "";

  const segundosTotais = exercicios.reduce((s, e) => s + e.series * (40 + e.descansoSeg), 0);
  const descansoMedio = exercicios.length
    ? Math.round(exercicios.reduce((s, e) => s + e.descansoSeg, 0) / exercicios.length)
    : 0;

  return {
    grupos,
    // Arredonda em múltiplos de 5: precisão de minuto seria falsa numa
    // estimativa que já chuta 40s por série.
    minutosEstimados: Math.round(segundosTotais / 60 / 5) * 5,
    descansoMedio,
  };
}
