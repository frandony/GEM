import { supabase } from "./supabase";
import { enfileirar, novoId } from "./fila";
import type { ExercicioDaSessao } from "../telas/SessaoTreino";

/* =====================================================================
   Camada de dados — uma função por pergunta que uma tela faz.
   Nada de RPC duplicada no cliente: cálculo mora no banco (progressão,
   streak, volume). Aqui só busca e formata para a tela.
   ===================================================================== */

export interface Perfil {
  id: string;
  nome: string;
  foto_url: string | null;
  timezone: string;
  usa_treino: boolean;
  usa_estudo: boolean;
}

export async function carregarPerfil(userId: string): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,nome,foto_url,timezone,usa_treino,usa_estudo")
    .eq("id", userId)
    .single();
  if (error) {
    console.warn("perfil indisponível:", error.message);
    return null;
  }
  return data;
}

/** Data de hoje no fuso do usuário — nunca `new Date().toISOString()`, que é UTC. */
export function hojeNoFuso(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/* ---------------------------------------------------------------------
   Treino
   --------------------------------------------------------------------- */

export interface ProgramaAtivo {
  id: string;
  divisao: "AB" | "ABC" | "ABCD" | "ABCDE";
  enfase: "superior" | "inferior" | "equilibrado";
  frequencia_semanal: number;
  proxima_sessao_id: string | null;
}

export interface ProximaSessao {
  id: string;
  letra: string;
  nome: string;
}

export async function carregarProgramaAtivo(
  userId: string,
): Promise<{ programa: ProgramaAtivo; proxima: ProximaSessao | null } | null> {
  const { data: programa, error } = await supabase
    .from("programas")
    .select("id,divisao,enfase,frequencia_semanal,proxima_sessao_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !programa) return null;

  if (!programa.proxima_sessao_id) return { programa, proxima: null };

  // Busca separada de propósito: `programas` e `sessoes` têm DUAS relações
  // entre si (proxima_sessao_id E sessoes.programa_id) — um embed do
  // PostgREST ficaria ambíguo sem hint de constraint.
  const { data: proxima } = await supabase
    .from("sessoes")
    .select("id,letra,nome")
    .eq("id", programa.proxima_sessao_id)
    .maybeSingle();

  return { programa, proxima: proxima ?? null };
}

interface LinhaSessaoExercicio {
  id: string;
  exercicio_id: number;
  ordem: number;
  series: number;
  reps_min: number | null;
  reps_max: number | null;
  duracao_seg: number | null;
  descanso_seg: number;
  exercicios: { nome: string; unilateral: boolean } | null;
}

export async function carregarExerciciosDaSessao(
  sessaoId: string,
): Promise<ExercicioDaSessao[]> {
  const { data, error } = await supabase
    .from("sessao_exercicios")
    .select(
      // Hint explícito da FK: sessao_exercicio_substitutos também liga
      // sessao_exercicios <-> exercicios (é uma tabela de junção — tem FK
      // pras duas), então o PostgREST enxerga DOIS caminhos possíveis e
      // recusa o embed sem dizer qual. Sem o hint, a tela de treino
      // ficava em branco (o catch engolia o erro em silêncio).
      "id,exercicio_id,ordem,series,reps_min,reps_max,duracao_seg,descanso_seg,exercicios!sessao_exercicios_exercicio_id_fkey(nome,unilateral)",
    )
    .eq("sessao_id", sessaoId)
    .order("ordem", { ascending: true })
    .returns<LinhaSessaoExercicio[]>();

  if (error || !data) {
    console.warn("exercícios da sessão indisponíveis:", error?.message);
    return [];
  }

  return data.map((l) => ({
    sessaoExercicioId: l.id,
    exercicioId: l.exercicio_id,
    nome: l.exercicios?.nome ?? "Exercício",
    ordem: l.ordem,
    series: l.series,
    repsMin: l.reps_min,
    repsMax: l.reps_max,
    duracaoSeg: l.duracao_seg,
    descansoSeg: l.descanso_seg,
    unilateral: l.exercicios?.unilateral ?? false,
  }));
}

export interface TreinoSessaoAberta {
  id: string;
  sessao_id: string | null;
  sessao_letra: string | null;
  sessao_nome: string | null;
  iniciada_em: string;
}

/** Sessão que ficou `em_andamento` — reload no meio do treino, por exemplo. */
export async function sessaoEmAndamento(userId: string): Promise<TreinoSessaoAberta | null> {
  const { data } = await supabase
    .from("treino_sessoes")
    .select("id,sessao_id,sessao_letra,sessao_nome,iniciada_em")
    .eq("user_id", userId)
    .eq("status", "em_andamento")
    .maybeSingle();
  return data ?? null;
}

/** Abre uma treino_sessoes nova. Offline-first: enfileira e volta na hora. */
export async function iniciarTreinoSessao(
  userId: string,
  timezone: string,
  sessao: ProximaSessao,
): Promise<string> {
  const id = novoId();
  await enfileirar("treino_sessoes", {
    id,
    user_id: userId,
    sessao_id: sessao.id,
    sessao_letra: sessao.letra,
    sessao_nome: sessao.nome,
    data: hojeNoFuso(timezone),
    iniciada_em: new Date().toISOString(),
    status: "em_andamento",
  });
  return id;
}

export async function finalizarTreinoSessao(treinoSessaoId: string): Promise<void> {
  const { error } = await supabase.rpc("finalizar_treino", {
    p_treino_sessao_id: treinoSessaoId,
  });
  if (error) throw new Error(error.message);
}

export async function abandonarTreinoSessao(
  treinoSessaoId: string,
  exercicioId: number | null,
): Promise<void> {
  const { error } = await supabase.rpc("abandonar_treino", {
    p_treino_sessao_id: treinoSessaoId,
    p_exercicio_id: exercicioId,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------------
   Estudo
   --------------------------------------------------------------------- */

export interface Materia {
  id: string;
  nome: string;
  ativa: boolean;
}

export async function carregarMaterias(userId: string): Promise<Materia[]> {
  const { data, error } = await supabase
    .from("materias")
    .select("id,nome,ativa")
    .eq("user_id", userId)
    .eq("ativa", true)
    .order("criada_em", { ascending: true });
  if (error) {
    console.warn("matérias indisponíveis:", error.message);
    return [];
  }
  return data;
}

export interface BlocoEstudo {
  id: string;
  materia_id: string | null;
  topico_id: string | null;
  data: string;
  hora: string;
  duracao_min: number;
  tipo: "leitura" | "exercicios" | "revisao" | "marco";
  titulo: string;
  status: "pendente" | "concluido" | "parcial" | "pulado";
}

export async function carregarBlocosDoDia(userId: string, data: string): Promise<BlocoEstudo[]> {
  const { data: blocos, error } = await supabase
    .from("blocos")
    .select("id,materia_id,topico_id,data,hora,duracao_min,tipo,titulo,status")
    .eq("user_id", userId)
    .eq("data", data)
    .order("hora", { ascending: true });
  if (error) {
    console.warn("blocos do dia indisponíveis:", error.message);
    return [];
  }
  return blocos;
}

export async function marcarBloco(
  blocoId: string,
  status: "concluido" | "parcial" | "pulado",
  tempoRealSeg: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("blocos")
    .update({
      status,
      finalizado_em: new Date().toISOString(),
      tempo_real_seg: tempoRealSeg,
    })
    .eq("id", blocoId);
  if (error) throw new Error(error.message);
}

export async function criarMateriaSimples(
  nome: string,
  topicos: Array<{ nome: string; dificuldade: "facil" | "medio" | "dificil" | null }>,
): Promise<string> {
  const { data, error } = await supabase.rpc("salvar_materia_com_topicos", {
    p_nome: nome,
    p_topicos: topicos,
    p_origem: "manual",
    p_confianca: "alta",
    p_eventos: [],
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ---------------------------------------------------------------------
   Grupo
   --------------------------------------------------------------------- */

export interface Grupo {
  id: string;
  nome: string;
  codigo_convite: string;
}

export async function carregarGruposDoUsuario(userId: string): Promise<Grupo[]> {
  const { data: membros, error } = await supabase
    .from("grupo_membros")
    .select("grupo_id")
    .eq("user_id", userId);
  if (error || !membros?.length) return [];

  const { data: grupos } = await supabase
    .from("grupos")
    .select("id,nome,codigo_convite")
    .in(
      "id",
      membros.map((m) => m.grupo_id),
    );
  return grupos ?? [];
}

export async function criarGrupo(nome: string): Promise<Grupo> {
  const { data, error } = await supabase.rpc("criar_grupo", { p_nome: nome });
  if (error) throw new Error(error.message);
  return data as Grupo;
}

export async function entrarNoGrupo(codigo: string): Promise<Grupo> {
  const { data, error } = await supabase.rpc("entrar_no_grupo", { p_codigo: codigo });
  if (error) throw new Error(error.message);
  return data as Grupo;
}

export interface MembroDoGrupo {
  user_id: string;
  nome: string;
  foto_url: string | null;
  streak: number;
  treinou_hoje: boolean;
}

export async function carregarMembrosDoGrupo(
  grupoId: string,
  timezone: string,
): Promise<MembroDoGrupo[]> {
  const { data: membros } = await supabase
    .from("grupo_membros")
    .select("user_id, profiles(nome, foto_url)")
    .eq("grupo_id", grupoId)
    .returns<Array<{ user_id: string; profiles: { nome: string; foto_url: string | null } | null }>>();

  if (!membros?.length) return [];
  const hoje = hojeNoFuso(timezone);

  return Promise.all(
    membros.map(async (m) => {
      const [{ data: streak }, { data: resumo }] = await Promise.all([
        supabase.rpc("streak_de", { p_user_id: m.user_id }),
        supabase
          .from("resumos_diarios")
          .select("treinou")
          .eq("user_id", m.user_id)
          .eq("data", hoje)
          .maybeSingle(),
      ]);
      return {
        user_id: m.user_id,
        nome: m.profiles?.nome ?? "—",
        foto_url: m.profiles?.foto_url ?? null,
        streak: (streak as number) ?? 0,
        treinou_hoje: resumo?.treinou ?? false,
      };
    }),
  );
}
