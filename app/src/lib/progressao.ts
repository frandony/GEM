import { supabase } from "./supabase";

/**
 * Sugestão de carga — progressão dupla.
 *
 * A conta mora no banco (`public.proxima_carga`), não aqui. Duas razões:
 * ela depende do histórico inteiro do usuário, e duplicar a regra no
 * cliente criaria duas versões da mesma verdade — que foi exatamente o
 * bug que apareceu no fallback do treino.
 *
 * O cliente só apresenta.
 */
export interface Sugestao {
  primeira_vez: boolean;
  carga_kg: number | null;
  sugeriu_subir: boolean;
  motivo: string;
  unilateral: boolean;
  progride_por: "carga" | "reps";
  incremento_kg?: number;
  ultima_carga_kg?: number | null;
}

export async function sugestaoDeCarga(
  exercicioId: number,
  repsMax: number | null,
): Promise<Sugestao | null> {
  const { data, error } = await supabase.rpc("proxima_carga", {
    p_exercicio_id: exercicioId,
    p_reps_max: repsMax,
  });

  if (error) {
    // Sem rede ou sem histórico: campo vazio é melhor que número errado.
    console.warn("sugestão de carga indisponível:", error.message);
    return null;
  }
  return data as Sugestao;
}

/** Texto curto para a tela. Explica de onde veio o número sugerido. */
export function explicarSugestao(s: Sugestao | null): string | null {
  if (!s) return null;
  if (s.primeira_vez) return "Primeira vez — anote o que usar hoje";
  if (s.progride_por === "reps") return "Progride por repetições, não por carga";
  if (s.sugeriu_subir) {
    return `Subiu ${s.incremento_kg} kg — você fechou o topo da faixa na última`;
  }
  return "Mesma carga da última vez";
}
