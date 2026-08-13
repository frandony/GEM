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
   Plano de treino — editar e excluir

   Tudo aqui é escrita direta na tabela, sem RPC nova: a RLS já dá ao
   dono UPDATE e DELETE em `sessoes` e `sessao_exercicios`, e as
   invariantes que importam (faixa de séries, reps XOR tempo, exercício
   repetido na mesma sessão) são CHECKs e UNIQUEs do schema. Duplicar
   essas regras numa RPC seria a segunda definição da mesma coisa — o
   erro que já custou caro no `fallback.ts`.
   --------------------------------------------------------------------- */

export interface SessaoDoPlano {
  id: string;
  letra: string;
  nome: string;
  /** Ordem da sessão no rodízio. A coluna chama `posicao`, não `ordem` —
      `ordem` é de `sessao_exercicios`, que é outra tabela. */
  posicao: number;
  exercicios: ExercicioDaSessao[];
}

/**
 * O plano inteiro, para a tela de edição.
 *
 * `null` significa **não existe plano ativo**, e só isso. Falha de
 * consulta LANÇA: as duas coisas são indistinguíveis para quem chama se
 * ambas devolverem null, e a tela acaba dizendo "monte seu treino" para
 * quem tem um plano — que foi exatamente o que aconteceu quando esta
 * função pedia a coluna `ordem`, que não existe em `sessoes`.
 */
export async function carregarPlanoCompleto(userId: string): Promise<{
  programaId: string;
  sessoes: SessaoDoPlano[];
} | null> {
  const { data: programa, error: erroPrograma } = await supabase
    .from("programas")
    .select("id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .maybeSingle();

  if (erroPrograma) throw new Error(`não deu para ler o programa: ${erroPrograma.message}`);
  if (!programa) return null;

  const { data: sessoes, error } = await supabase
    .from("sessoes")
    .select("id,letra,nome,posicao")
    .eq("programa_id", programa.id)
    .order("posicao", { ascending: true })
    .returns<Array<{ id: string; letra: string; nome: string; posicao: number }>>();

  if (error) throw new Error(`não deu para ler as sessões: ${error.message}`);

  const comExercicios = await Promise.all(
    (sessoes ?? []).map(async (s) => ({
      ...s,
      exercicios: await carregarExerciciosDaSessao(s.id),
    })),
  );
  return { programaId: programa.id, sessoes: comExercicios };
}

export interface Substituto {
  exercicio_id: number;
  nome: string;
  equipamento: string;
  comum: number;
  /** `ia` = veio do plano gerado; `catalogo` = mesmo grupo e padrão. */
  origem: "ia" | "catalogo";
  posicao: number;
}

export async function substitutosDoExercicio(
  sessaoExercicioId: string,
): Promise<Substituto[]> {
  // Sem tipos gerados do banco, o supabase-js supõe que toda RPC devolve
  // um objeto só — mas esta é `returns table`. O cast é o que reconcilia.
  const { data, error } = await supabase.rpc("substitutos_do_exercicio", {
    p_sessao_exercicio_id: sessaoExercicioId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as Substituto[] | null) ?? [];
}

/**
 * Troca permanente do exercício no molde. Registra em `plano_alteracoes`
 * junto — é o que permite desfazer depois de fechar o app, e é coleta do
 * dia 1 (§10 do plano).
 *
 * O histórico não é tocado: `series_registros` guarda `exercicio_id` por
 * série, então o que já foi levantado continua sendo do exercício antigo.
 */
export async function trocarExercicioDoPlano(
  userId: string,
  sessaoExercicioId: string,
  exercicioAntigoId: number,
  exercicioNovoId: number,
): Promise<void> {
  const { error } = await supabase
    .from("sessao_exercicios")
    .update({ exercicio_id: exercicioNovoId })
    .eq("id", sessaoExercicioId);

  if (error) {
    // UNIQUE (sessao_id, exercicio_id): o exercício escolhido já está
    // nesta sessão. A mensagem crua do Postgres não diz isso.
    if (error.code === "23505") {
      throw new Error("Esse exercício já está nesta sessão. Escolha outro.");
    }
    throw new Error(error.message);
  }

  const { error: erroLog } = await supabase.from("plano_alteracoes").insert({
    id: novoId(),
    user_id: userId,
    sessao_exercicio_id: sessaoExercicioId,
    exercicio_antigo_id: exercicioAntigoId,
    exercicio_novo_id: exercicioNovoId,
  });
  // A troca já aconteceu e é o que a pessoa pediu. Perder o registro do
  // "desfazer" é ruim, mas desfazer a troca por causa dele seria pior.
  if (erroLog) console.warn("troca não registrada em plano_alteracoes:", erroLog.message);
}

export interface ParametrosDoExercicio {
  series: number;
  repsMin: number | null;
  repsMax: number | null;
  descansoSeg: number;
}

/** Limites espelhados dos CHECKs do schema (migration 05). */
export const LIMITES = {
  series: { min: 1, max: 10 },
  reps: { min: 1, max: 100 },
  descanso: { min: 15, max: 300 },
} as const;

export async function atualizarParametrosDoExercicio(
  sessaoExercicioId: string,
  p: ParametrosDoExercicio,
): Promise<void> {
  const { error } = await supabase
    .from("sessao_exercicios")
    .update({
      series: p.series,
      reps_min: p.repsMin,
      reps_max: p.repsMax,
      descanso_seg: p.descansoSeg,
    })
    .eq("id", sessaoExercicioId);
  if (error) {
    if (error.code === "23514") {
      throw new Error(
        `Valor fora da faixa aceita: séries ${LIMITES.series.min}–${LIMITES.series.max}, ` +
          `reps ${LIMITES.reps.min}–${LIMITES.reps.max}, ` +
          `descanso ${LIMITES.descanso.min}–${LIMITES.descanso.max}s.`,
      );
    }
    throw new Error(error.message);
  }
}

export async function removerExercicioDoPlano(sessaoExercicioId: string): Promise<void> {
  const { error } = await supabase
    .from("sessao_exercicios")
    .delete()
    .eq("id", sessaoExercicioId);
  if (error) throw new Error(error.message);
}

/**
 * Apaga o programa ativo inteiro (sessões e exercícios vão junto, por
 * cascade) para que outro possa ser montado.
 *
 * O histórico **sobrevive**: `treino_sessoes.sessao_id` é
 * `on delete set null`, e a letra e o nome da sessão ficam congelados na
 * própria linha. O streak, que sai de `treino_sessoes`, não muda.
 */
export async function excluirProgramaAtivo(userId: string): Promise<void> {
  const emAndamento = await sessaoEmAndamento(userId);
  if (emAndamento) {
    throw new Error(
      "Você tem um treino em andamento. Finalize ou abandone antes de excluir o plano.",
    );
  }

  const { error } = await supabase
    .from("programas")
    .delete()
    .eq("user_id", userId)
    .eq("ativo", true);
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
