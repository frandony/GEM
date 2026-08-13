import type { Catalogo, Exercicio, NivelExercicio } from "./catalogo.ts";

/* =====================================================================
   Perfil de treino — dados do onboarding rico (migration 20).

   Duas responsabilidades, as duas resolvidas ANTES do prompt, na mesma
   filosofia de equipamentos_indisponiveis: o que não está no catálogo
   filtrado não pode ser escolhido.

   1. Nível efetivo: o nível declarado pode ser REBAIXADO por fatores de
      risco (§3 do documento de classificação). Vira filtro em
      carregarCatalogo — ver _shared/catalogo.ts.
   2. Exclusão por lesão/condição: alguns exercícios são contraindicados
      por lesão específica (§4), e alguns padrões de movimento carregados
      são contraindicados por condição de saúde.
   ===================================================================== */

export type Lesao = "coluna" | "joelho" | "ombro" | "punho";
export type CondicaoSaude = "hipertensao" | "hernia_discal";
export type AcessoEquipamento =
  | "academia_completa"
  | "academia_condominio"
  | "home_gym"
  | "sem_equipamento";
export type Objetivo =
  | "hipertrofia"
  | "forca"
  | "emagrecimento"
  | "condicionamento"
  | "saude_geral"
  | "reabilitacao";

export interface PerfilTreino {
  idade: number | null;
  nivel_declarado: NivelExercicio;
  tempo_parado: "ativo" | "ate_6_meses" | "mais_6_meses" | null;
  lesoes: Lesao[];
  condicoes_saude: CondicaoSaude[];
  objetivo: Objetivo;
  acesso_equipamento: AcessoEquipamento;
  sono: "bom" | "regular" | "ruim" | null;
  estresse: "baixo" | "moderado" | "alto" | null;
}

const ORDEM_NIVEL: Record<NivelExercicio, number> = {
  "básico": 0,
  "intermediário": 1,
  "avançado": 2,
};
const NIVEL_POR_ORDEM: NivelExercicio[] = ["básico", "intermediário", "avançado"];

/**
 * §3 do documento de classificação: o nível declarado pode ser rebaixado
 * por fatores de risco. Penalidades de 1 tier inteiro (descondicionado,
 * lesão, condição de saúde, idade>55) e de meio tier (sono ruim, estresse
 * alto) — duas penalidades de meio tier juntas derrubam um tier inteiro,
 * uma sozinha não.
 */
export function calcularNivelEfetivo(perfil: PerfilTreino): NivelExercicio {
  let pontos = ORDEM_NIVEL[perfil.nivel_declarado];

  if (perfil.tempo_parado === "mais_6_meses") pontos -= 1;
  if (perfil.lesoes.length > 0) pontos -= 1;
  if (perfil.condicoes_saude.length > 0) pontos -= 1;
  if (perfil.idade != null && perfil.idade > 55) pontos -= 1;
  if (perfil.sono === "ruim") pontos -= 0.5;
  if (perfil.estresse === "alto") pontos -= 0.5;

  const indice = Math.max(0, Math.floor(pontos));
  return NIVEL_POR_ORDEM[indice];
}

/**
 * Ids do catálogo (ver 02_catalogo_exercicios.csv) contraindicados por
 * lesão específica — §4 do documento de classificação. Mapeado por id, não
 * por nome: nomes podem mudar, ids não. "Good Morning" e variantes
 * "pesado(a)" citadas no documento não existem como linha própria no
 * catálogo atual e por isso não entram aqui.
 */
const EXCLUSOES_POR_LESAO: Record<Lesao, number[]> = {
  // Levantamento terra, Remada curvada, Agachamento livre, Stiff
  coluna: [125, 52, 53, 136, 128],
  // Agachamento livre, Agachamento frontal, Sissy Squat, Leg press (45),
  // Afundo (com halteres)
  joelho: [136, 134, 143, 142, 147],
  // Desenvolvimento militar, Supino reto barra, Remada alta, High Pull
  ombro: [81, 114, 97, 96],
  // Rosca direta barra, Supino reto barra, Remada curvada
  punho: [38, 114, 52, 53],
};

export function idsExcluidosPorLesao(lesoes: Lesao[]): number[] {
  const ids = new Set<number>();
  for (const lesao of lesoes) {
    for (const id of EXCLUSOES_POR_LESAO[lesao] ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Condição de saúde não mira exercícios específicos, mira PADRÃO DE
 * MOVIMENTO carregado — hérnia discal evita flexão de tronco e rotação
 * COM CARGA (peso corporal continua liberado); hipertensão evita
 * isometria longa (padrão antiextensão). Por isso opera sobre o catálogo
 * já carregado, não sobre uma lista fixa de ids.
 */
export function idsExcluidosPorCondicao(
  lista: Exercicio[],
  condicoes: CondicaoSaude[],
): number[] {
  const ids = new Set<number>();
  for (const ex of lista) {
    if (
      condicoes.includes("hernia_discal") &&
      (ex.padrao_movimento === "flexão de tronco" || ex.padrao_movimento === "rotação") &&
      ex.equipamento !== "peso corporal"
    ) {
      ids.add(ex.id);
    }
    if (condicoes.includes("hipertensao") && ex.padrao_movimento === "antiextensão") {
      ids.add(ex.id);
    }
  }
  return [...ids];
}

/**
 * §5 do documento de classificação: tipo de acesso → equipamentos
 * NÃO permitidos. "academia_completa" não exclui nada.
 */
const EXCLUSOES_POR_ACESSO: Record<AcessoEquipamento, string[]> = {
  academia_completa: [],
  academia_condominio: ["barra", "polia", "anilha"],
  home_gym: ["máquina", "polia"],
  sem_equipamento: ["barra", "halter", "máquina", "polia", "anilha"],
};

export function equipamentosExcluidosPorAcesso(acesso: AcessoEquipamento): string[] {
  return EXCLUSOES_POR_ACESSO[acesso];
}

/** Remove ids de um catálogo já carregado, sem nova consulta ao banco. */
export function excluirIds(catalogo: Catalogo, ids: number[]): Catalogo {
  if (ids.length === 0) return catalogo;
  const excluidos = new Set(ids);
  const lista = catalogo.lista.filter((e) => !excluidos.has(e.id));
  return { lista, porId: new Map(lista.map((e) => [e.id, e])) };
}
