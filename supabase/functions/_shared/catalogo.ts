import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

export interface Exercicio {
  id: number;
  nome: string;
  grupo_primario: string;
  padrao_movimento: string;
  equipamento: string;
  medida: "reps" | "tempo";
  comum: number;
  unilateral: boolean;
  incremento_kg: number | null;
}

export interface Catalogo {
  lista: Exercicio[];
  porId: Map<number, Exercicio>;
}

/**
 * Carrega o catálogo já filtrado pelos equipamentos que o usuário não tem.
 *
 * Filtrar ANTES de montar o prompt é melhor que pedir para a IA respeitar a
 * restrição: o que não está no catálogo não pode ser escolhido, e a validação
 * 8 do Prompt 1 vira redundância defensiva em vez de linha de frente.
 */
export async function carregarCatalogo(
  supabase: SupabaseClient,
  userId: string,
): Promise<Catalogo> {
  const { data: indisponiveis, error: e1 } = await supabase
    .from("equipamentos_indisponiveis")
    .select("equipamento")
    .eq("user_id", userId);
  if (e1) throw new Error(`falha ao ler equipamentos: ${e1.message}`);

  const bloqueados = (indisponiveis ?? []).map((r) => r.equipamento as string);

  let query = supabase
    .from("exercicios")
    .select(
      "id,nome,grupo_primario,padrao_movimento,equipamento,medida,comum,unilateral,incremento_kg",
    )
    .order("id");

  if (bloqueados.length > 0) {
    query = query.not(
      "equipamento",
      "in",
      `(${bloqueados.map((b) => `"${b}"`).join(",")})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`falha ao ler catálogo: ${error.message}`);

  const lista = (data ?? []) as Exercicio[];
  return { lista, porId: new Map(lista.map((e) => [e.id, e])) };
}

/**
 * Tabela pipe-delimited em vez de JSON: mais compacta (menos tokens por
 * exercício) e o modelo lê igualmente bem. 163 linhas cabem sem problema.
 */
export function catalogoComoTabela(catalogo: Catalogo): string {
  const linhas = catalogo.lista.map(
    (e) =>
      `${e.id} | ${e.nome} | ${e.grupo_primario} | ${e.padrao_movimento} | ${e.equipamento} | ${e.medida} | ${e.comum}`,
  );
  return [
    "CATÁLOGO DE EXERCÍCIOS",
    "id | nome | grupo_primario | padrao_movimento | equipamento | medida | comum",
    ...linhas,
  ].join("\n");
}

// Espelha public.regiao_do_grupo(). Duplicado de propósito: o SQL valida o que
// está gravado, este valida o que a IA acabou de propor — antes de gravar.
export function regiaoDoGrupo(grupo: string): "superior" | "inferior" | "core" {
  if (["peito", "costas", "ombro", "bíceps", "tríceps"].includes(grupo)) {
    return "superior";
  }
  if (
    [
      "quadríceps",
      "posterior",
      "glúteo",
      "panturrilha",
      "adutores",
      "abdutores",
    ].includes(grupo)
  ) {
    return "inferior";
  }
  return "core";
}

export const LETRAS_POR_DIVISAO: Record<string, string[]> = {
  AB: ["A", "B"],
  ABC: ["A", "B", "C"],
  ABCD: ["A", "B", "C", "D"],
  ABCDE: ["A", "B", "C", "D", "E"],
};

export const PADROES_COMPOSTOS = new Set([
  "empurrar horizontal",
  "empurrar vertical",
  "puxar horizontal",
  "puxar vertical",
  "dominante de joelho",
  "dominante de quadril",
  "unilateral",
  "carregamento",
]);
