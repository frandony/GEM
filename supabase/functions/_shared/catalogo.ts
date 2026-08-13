import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

export type NivelExercicio = "básico" | "intermediário" | "avançado";

// Ordem de dificuldade — usada pra filtrar o catálogo pelo nível efetivo
// do aluno. Índice maior = mais difícil.
const ORDEM_NIVEL: Record<NivelExercicio, number> = {
  "básico": 0,
  "intermediário": 1,
  "avançado": 2,
};

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
  nivel: NivelExercicio;
}

export interface Catalogo {
  lista: Exercicio[];
  porId: Map<number, Exercicio>;
}

/**
 * Carrega o catálogo já filtrado pelos equipamentos que o usuário não tem,
 * pelo nível efetivo do aluno e por ids excluídos por lesão declarada.
 *
 * Filtrar ANTES de montar o prompt é melhor que pedir para a IA respeitar a
 * restrição: o que não está no catálogo não pode ser escolhido, e a validação
 * 8 do Prompt 1 vira redundância defensiva em vez de linha de frente. Nível e
 * lesão seguem a mesma lógica — nenhuma das duas precisa virar regra no
 * prompt.
 */
export async function carregarCatalogo(
  supabase: SupabaseClient,
  userId: string,
  opcoes?: {
    nivelEfetivo?: NivelExercicio;
    idsExcluidos?: number[];
    equipamentosExtras?: string[];
  },
): Promise<Catalogo> {
  const { data: indisponiveis, error: e1 } = await supabase
    .from("equipamentos_indisponiveis")
    .select("equipamento")
    .eq("user_id", userId);
  if (e1) throw new Error(`falha ao ler equipamentos: ${e1.message}`);

  // União com o que o tipo de acesso (academia completa/condomínio/home gym/
  // sem equipamento) já exclui — ver perfilTreino.ts. Mesma lista, duas
  // origens: marcado item a item nas configurações, ou herdado do onboarding.
  const bloqueados = [
    ...new Set([
      ...(indisponiveis ?? []).map((r) => r.equipamento as string),
      ...(opcoes?.equipamentosExtras ?? []),
    ]),
  ];

  let query = supabase
    .from("exercicios")
    .select(
      "id,nome,grupo_primario,padrao_movimento,equipamento,medida,comum,unilateral,incremento_kg,nivel",
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

  let lista = (data ?? []) as Exercicio[];

  if (opcoes?.nivelEfetivo) {
    const teto = ORDEM_NIVEL[opcoes.nivelEfetivo];
    lista = lista.filter((e) => ORDEM_NIVEL[e.nivel] <= teto);
  }

  if (opcoes?.idsExcluidos?.length) {
    const excluidos = new Set(opcoes.idsExcluidos);
    lista = lista.filter((e) => !excluidos.has(e.id));
  }

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
