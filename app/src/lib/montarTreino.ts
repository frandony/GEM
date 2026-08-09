import { supabase } from "./supabase";

export interface PedidoMontarTreino {
  divisao: "AB" | "ABC" | "ABCD" | "ABCDE";
  enfase: "superior" | "inferior" | "equilibrado";
  frequencia_semanal: number;
  dias_lembrete?: number[];
  hora_lembrete?: string | null;
}

export interface RespostaMontarTreino {
  origem: "ia" | "fallback";
  programa_id: string;
  avisos: string[];
  motivo?: string;
}

/**
 * Chama a Edge Function que monta o plano. Pode levar até ~1-2 minutos —
 * é a IA lendo o catálogo inteiro, validando regra por regra, e às vezes
 * tentando de novo. A tela que chama isto precisa mostrar isso, não um
 * spinner mudo.
 */
export async function montarTreino(pedido: PedidoMontarTreino): Promise<RespostaMontarTreino> {
  const { data, error } = await supabase.functions.invoke<RespostaMontarTreino>("montar-treino", {
    body: pedido,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("resposta vazia do servidor");
  return data;
}
