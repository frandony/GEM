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

/* =====================================================================
   Doutrina de leitura deste arquivo — vale para tudo abaixo.
   =====================================================================
   **Falha de consulta LANÇA. Nunca vira lista vazia.**

   O motivo está escrito desde sempre em `carregarPlanoCompleto`: se
   "não deu para carregar" e "você não tem nada" devolvem a mesma coisa,
   quem chama não consegue distinguir, e a tela acaba AFIRMANDO que o
   usuário não tem dado nenhum quando na verdade a rede caiu. Isso já
   custou caro — a tela de Estudo inteira (Pomodoro, card de montar
   plano, blocos e a lista de matérias) sumia atrás de um "você ainda não
   tem matérias" por causa de um erro engolido, e era indistinguível de
   "a funcionalidade não foi implementada".

   A exceção é estreita e deliberada: função que só ENRIQUECE algo já
   pintado na tela (cor de disciplina, contagem num card) pode degradar
   em silêncio — derrubar a tela por causa dela seria pior. Cada uma
   dessas está marcada com o motivo no próprio corpo.
   ===================================================================== */

export async function carregarPerfil(userId: string): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,nome,foto_url,timezone,usa_treino,usa_estudo")
    .eq("id", userId)
    .maybeSingle();
  // `maybeSingle` + throw: com `.single()` a ausência de linha também virava
  // erro, então "perfil ainda não criado" e "banco fora do ar" eram a mesma
  // coisa. Agora `null` significa só a primeira.
  if (error) throw new Error(`não deu para carregar seu perfil: ${error.message}`);
  return data;
}

/** Data de hoje no fuso do usuário — nunca `new Date().toISOString()`, que é UTC. */
export function hojeNoFuso(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/**
 * Próximas datas em que a pessoa PLANEJOU treinar, a partir de
 * `programas.dias_lembrete` (0 = domingo).
 *
 * Serve só para ROTULAR o carrossel da Início ("hoje", "amanhã", "qui").
 * Não decide o conteúdo de dia nenhum — quem decide é a fila
 * (`proxima_sessao_id`), que avança por sessão CONCLUÍDA e não por
 * calendário. A migration 05 é explícita sobre isso: "misturar as duas
 * coisas é o que quebra a maioria dos apps de treino". Se a pessoa furar
 * a terça, o treino A não vira o de quarta — ele continua sendo o próximo,
 * e é só o rótulo de data que anda.
 *
 * Devolve `[]` quando não há dias planejados; aí a tela rotula por posição
 * na fila ("próximo", "depois") em vez de inventar data.
 *
 * Aritmética em UTC de propósito: `hojeISO` já vem convertido para o fuso
 * do usuário, e somar dias em horário local esbarraria em horário de verão.
 */
export function proximosDiasDeTreino(
  diasLembrete: number[],
  hojeISO: string,
  quantos: number,
  incluirHoje: boolean,
): string[] {
  if (diasLembrete.length === 0 || quantos <= 0) return [];
  const dias = new Set(diasLembrete);
  const datas: string[] = [];
  const cursor = new Date(`${hojeISO}T00:00:00Z`);
  if (!incluirHoje) cursor.setUTCDate(cursor.getUTCDate() + 1);

  // Teto de 8 semanas: com `dias_lembrete` não-vazio nunca chega perto,
  // mas garante que dado estranho no banco não vire laço infinito.
  for (let i = 0; i < 56 && datas.length < quantos; i++) {
    if (dias.has(cursor.getUTCDay())) datas.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return datas;
}

/* ---------------------------------------------------------------------
   Perfil de treino — onboarding rico (migration 20). Tabela própria,
   privada ao dono: diferente de `profiles`, não é visível pro grupo.
   --------------------------------------------------------------------- */

export type Sexo = "feminino" | "masculino" | "outro";
export type Experiencia = "nenhuma" | "musculacao" | "crossfit" | "calistenia";
export type TempoParado = "ativo" | "ate_6_meses" | "mais_6_meses";
export type Lesao = "coluna" | "joelho" | "ombro" | "punho";
export type CondicaoSaude = "hipertensao" | "hernia_discal";
export type Objetivo =
  | "hipertrofia"
  | "forca"
  | "emagrecimento"
  | "condicionamento"
  | "saude_geral"
  | "reabilitacao";
export type Horario = "manha" | "tarde" | "noite";
export type AcessoEquipamento =
  | "academia_completa"
  | "academia_condominio"
  | "home_gym"
  | "sem_equipamento";
export type Trabalho = "sedentario" | "ativo";
export type Qualidade = "bom" | "regular" | "ruim";
export type NivelSubjetivo = "baixo" | "moderado" | "alto";
export type Dieta = "deficit" | "manutencao" | "superavit";

export interface PerfilTreino {
  idade: number | null;
  sexo: Sexo | null;
  peso_kg: number | null;
  altura_cm: number | null;
  nivel_declarado: "básico" | "intermediário" | "avançado";
  ja_treinou: boolean;
  tempo_parado: TempoParado | null;
  experiencia: Experiencia;
  lesoes: Lesao[];
  condicoes_saude: CondicaoSaude[];
  objetivo: Objetivo;
  tempo_sessao_min: number | null;
  horario_preferido: Horario | null;
  acesso_equipamento: AcessoEquipamento;
  trabalho: Trabalho | null;
  sono: Qualidade | null;
  estresse: NivelSubjetivo | null;
  dieta: Dieta | null;
}

export async function carregarPerfilTreino(userId: string): Promise<PerfilTreino | null> {
  const { data, error } = await supabase
    .from("perfil_treino")
    .select(
      "idade,sexo,peso_kg,altura_cm,nivel_declarado,ja_treinou,tempo_parado,experiencia,lesoes,condicoes_saude,objetivo,tempo_sessao_min,horario_preferido,acesso_equipamento,trabalho,sono,estresse,dieta",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("perfil de treino indisponível:", error.message);
    return null;
  }
  return data;
}

/** Upsert: a tela de onboarding grava tudo de uma vez, sempre a linha inteira. */
export async function salvarPerfilTreino(
  userId: string,
  dados: PerfilTreino,
): Promise<void> {
  const { error } = await supabase
    .from("perfil_treino")
    .upsert({ user_id: userId, ...dados });
  if (error) throw new Error(`não foi possível salvar seu perfil: ${error.message}`);
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
  /** Dias da semana planejados (0 = domingo). Existem para LEMBRETE, não
      para decidir o conteúdo do dia — ver o comentário na migration 05. */
  dias_lembrete: number[];
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
    .select("id,divisao,enfase,frequencia_semanal,proxima_sessao_id,dias_lembrete")
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

export interface ResumoSemanal {
  /** SESSÕES concluídas no período, não dias com treino. Dois treinos no
      mesmo dia contam 2 — `resumos_diarios.treinou` é booleano por dia e
      não serve pra isso. */
  treinosFeitos: number;
  /** Meta já escalada pro período (frequência semanal × semanas). */
  treinosMeta: number;
  minutosTreino: number;
  volumeKg: number;
  minutosEstudo: number;
  blocosEstudo: number;
}

/**
 * Agregado dos últimos N dias (hoje incluso), no fuso do usuário. Sem
 * agregado pronto pra "minutos de treino" nem "volume" — soma na hora a
 * partir de `treino_sessoes`/`series_registros`. `resumos_diarios` já
 * resolve minutos e blocos de estudo (mantido por trigger).
 *
 * `semanas_resumo` NÃO serve aqui apesar do nome: é preenchida pelo cron
 * ao fechar a semana, então a semana corrente costuma não ter linha —
 * somar as linhas dela subestimaria justamente os dias recentes.
 */
export async function carregarResumoDoPeriodo(
  userId: string,
  timezone: string,
  dias = 7,
): Promise<ResumoSemanal> {
  const hoje = hojeNoFuso(timezone);
  const primeiroDia = new Date(`${hoje}T00:00:00Z`);
  primeiroDia.setUTCDate(primeiroDia.getUTCDate() - (dias - 1));
  const inicio = primeiroDia.toISOString().slice(0, 10);

  const [resumos, programa, sessoes] = await Promise.all([
    supabase
      .from("resumos_diarios")
      .select("minutos_estudo,blocos_feitos")
      .eq("user_id", userId)
      .gte("data", inicio)
      .lte("data", hoje),
    supabase
      .from("programas")
      .select("frequencia_semanal")
      .eq("user_id", userId)
      .eq("ativo", true)
      .maybeSingle(),
    supabase
      .from("treino_sessoes")
      .select("id,iniciada_em,finalizada_em")
      .eq("user_id", userId)
      .eq("status", "concluida")
      .gte("data", inicio)
      .lte("data", hoje),
  ]);

  const minutosEstudo = (resumos.data ?? []).reduce(
    (soma, r) => soma + (r.minutos_estudo ?? 0),
    0,
  );
  const blocosEstudo = (resumos.data ?? []).reduce(
    (soma, r) => soma + (r.blocos_feitos ?? 0),
    0,
  );

  const listaSessoes = sessoes.data ?? [];
  // Contagem de SESSÕES. Antes era `resumos_diarios.filter(treinou)`, que
  // é um booleano por dia: quem treinasse duas vezes num dia via "1".
  const treinosFeitos = listaSessoes.length;

  // A frequência do onboarding é SEMANAL; num período de N dias a meta
  // precisa escalar, senão "8 de 3 treinos no mês" apareceria na tela.
  const porSemana = programa.data?.frequencia_semanal ?? 0;
  const treinosMeta = Math.round(porSemana * (dias / 7));

  const minutosTreino = listaSessoes.reduce((soma, s) => {
    if (!s.finalizada_em) return soma;
    const min = (new Date(s.finalizada_em).getTime() - new Date(s.iniciada_em).getTime()) / 60000;
    return soma + Math.max(0, min);
  }, 0);

  let volumeKg = 0;
  const idsSessoes = listaSessoes.map((s) => s.id);
  if (idsSessoes.length > 0) {
    const { data: series } = await supabase
      .from("series_registros")
      .select("carga_kg,reps")
      .in("treino_sessao_id", idsSessoes)
      .not("carga_kg", "is", null);
    volumeKg = (series ?? []).reduce((soma, r) => soma + (r.carga_kg ?? 0) * (r.reps ?? 0), 0);
  }

  return {
    treinosFeitos,
    treinosMeta,
    minutosTreino: Math.round(minutosTreino),
    volumeKg: Math.round(volumeKg),
    minutosEstudo,
    blocosEstudo,
  };
}

/** Atalho de 7 dias — o recorte que a tela de Treino usa. */
export async function carregarResumoSemanal(
  userId: string,
  timezone: string,
): Promise<ResumoSemanal> {
  return carregarResumoDoPeriodo(userId, timezone, 7);
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
  exercicios: { nome: string; unilateral: boolean; grupo_primario: string } | null;
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
      "id,exercicio_id,ordem,series,reps_min,reps_max,duracao_seg,descanso_seg,exercicios!sessao_exercicios_exercicio_id_fkey(nome,unilateral,grupo_primario)",
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
    grupoPrimario: l.exercicios?.grupo_primario ?? "",
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
   Histórico de treinos — sessões passadas, com o que foi realmente
   registrado (não confundir com `carregarPlanoCompleto`, que é o MOLDE).
   --------------------------------------------------------------------- */

export interface SessaoHistorico {
  id: string;
  data: string;
  sessaoLetra: string | null;
  sessaoNome: string | null;
  status: "concluida" | "abandonada";
  iniciadaEm: string;
  finalizadaEm: string | null;
  totalSeries: number;
  volumeKg: number;
}

const HISTORICO_POR_PAGINA = 15;

/**
 * Sessões concluídas ou abandonadas, mais recentes primeiro. Paginado por
 * offset — pede uma linha a mais que o tamanho da página só para saber se
 * existe próxima, sem precisar de `count`.
 */
export async function carregarHistoricoTreinos(
  userId: string,
  pagina: number,
): Promise<{ sessoes: SessaoHistorico[]; temMais: boolean }> {
  const de = pagina * HISTORICO_POR_PAGINA;
  const ate = de + HISTORICO_POR_PAGINA;

  const { data, error } = await supabase
    .from("treino_sessoes")
    .select("id,data,sessao_letra,sessao_nome,status,iniciada_em,finalizada_em")
    .eq("user_id", userId)
    .neq("status", "em_andamento")
    .order("data", { ascending: false })
    .order("iniciada_em", { ascending: false })
    .range(de, ate)
    .returns<
      Array<{
        id: string;
        data: string;
        sessao_letra: string | null;
        sessao_nome: string | null;
        status: "concluida" | "abandonada";
        iniciada_em: string;
        finalizada_em: string | null;
      }>
    >();

  // "Nenhum treino registrado ainda" para quem treina há meses é o tipo de
  // mentira que faz desconfiar do app inteiro.
  if (error) throw new Error(`não deu para carregar o histórico: ${error.message}`);
  if (!data) return { sessoes: [], temMais: false };

  const temMais = data.length > HISTORICO_POR_PAGINA;
  const linhas = data.slice(0, HISTORICO_POR_PAGINA);
  const ids = linhas.map((s) => s.id);

  const porSessao = new Map<string, { series: number; volume: number }>();
  if (ids.length > 0) {
    const { data: series } = await supabase
      .from("series_registros")
      .select("treino_sessao_id,carga_kg,reps")
      .in("treino_sessao_id", ids);
    for (const r of series ?? []) {
      const atual = porSessao.get(r.treino_sessao_id) ?? { series: 0, volume: 0 };
      atual.series += 1;
      atual.volume += (r.carga_kg ?? 0) * (r.reps ?? 0);
      porSessao.set(r.treino_sessao_id, atual);
    }
  }

  return {
    sessoes: linhas.map((s) => ({
      id: s.id,
      data: s.data,
      sessaoLetra: s.sessao_letra,
      sessaoNome: s.sessao_nome,
      status: s.status,
      iniciadaEm: s.iniciada_em,
      finalizadaEm: s.finalizada_em,
      totalSeries: porSessao.get(s.id)?.series ?? 0,
      volumeKg: Math.round(porSessao.get(s.id)?.volume ?? 0),
    })),
    temMais,
  };
}

export interface SerieDoHistorico {
  numeroSerie: number;
  reps: number | null;
  cargaKg: number | null;
  duracaoSeg: number | null;
}

export interface ExercicioDoHistorico {
  exercicioId: number;
  nome: string;
  series: SerieDoHistorico[];
}

/**
 * Detalhe de uma sessão: séries de fato registradas, agrupadas por
 * exercício na ordem em que foram feitas — não na ordem do molde, que
 * pode ter mudado desde então.
 */
export async function carregarDetalheSessaoTreino(
  treinoSessaoId: string,
): Promise<ExercicioDoHistorico[]> {
  const { data, error } = await supabase
    .from("series_registros")
    .select(
      // Mesmo motivo do hint em `carregarExerciciosDaSessao`: a coluna
      // `planejado_id` também referencia `exercicios`, então o embed sem
      // hint fica ambíguo entre as duas FKs.
      "exercicio_id,numero_serie,reps,carga_kg,duracao_seg,exercicios!series_registros_exercicio_id_fkey(nome)",
    )
    .eq("treino_sessao_id", treinoSessaoId)
    .order("registrada_em", { ascending: true })
    .returns<
      Array<{
        exercicio_id: number;
        numero_serie: number;
        reps: number | null;
        carga_kg: number | null;
        duracao_seg: number | null;
        exercicios: { nome: string } | null;
      }>
    >();

  if (error) throw new Error(`não deu para carregar as séries: ${error.message}`);
  if (!data) return [];

  const porExercicio = new Map<number, ExercicioDoHistorico>();
  for (const r of data) {
    let ex = porExercicio.get(r.exercicio_id);
    if (!ex) {
      ex = { exercicioId: r.exercicio_id, nome: r.exercicios?.nome ?? "Exercício", series: [] };
      porExercicio.set(r.exercicio_id, ex);
    }
    ex.series.push({
      numeroSerie: r.numero_serie,
      reps: r.reps,
      cargaKg: r.carga_kg,
      duracaoSeg: r.duracao_seg,
    });
  }
  return Array.from(porExercicio.values());
}

/* ---------------------------------------------------------------------
   Estudo
   --------------------------------------------------------------------- */

export interface Materia {
  id: string;
  nome: string;
  ativa: boolean;
}

/** Exceção à doutrina: na Home isto só dá cor e contagem a um card que
    já está pintado. Falhar aqui não pode derrubar a tela inteira. */
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
  // "Nenhum bloco planejado para hoje" é uma AFIRMAÇÃO sobre o dia da
  // pessoa. Não pode sair de uma consulta que falhou.
  if (error) throw new Error(`não deu para carregar os blocos de hoje: ${error.message}`);
  return blocos;
}

/**
 * Mesma consulta que `carregarBlocosDoDia`, mas num intervalo — usada pela
 * faixa "próximos dias" da tela de Estudo, que precisa ver a janela
 * inteira de uma vez para pintar cada coluna sem uma consulta por dia.
 * Mesma doutrina de erro: lança, não devolve vazio.
 */
export async function carregarBlocosDoIntervalo(
  userId: string,
  de: string,
  ate: string,
): Promise<BlocoEstudo[]> {
  const { data: blocos, error } = await supabase
    .from("blocos")
    .select("id,materia_id,topico_id,data,hora,duracao_min,tipo,titulo,status")
    .eq("user_id", userId)
    .gte("data", de)
    .lte("data", ate)
    .order("data", { ascending: true })
    .order("hora", { ascending: true });
  if (error) throw new Error(`não deu para carregar seus próximos blocos: ${error.message}`);
  return blocos;
}

/**
 * Marca (ou desmarca) um bloco. `"pendente"` existe para o desfazer: sem
 * ele, tocar sem querer no bloco de estudo era irreversível pela UI —
 * e a linha inteira era o alvo do toque.
 *
 * Voltar para pendente limpa `finalizado_em` e `tempo_real_seg` junto:
 * bloco pendente com hora de conclusão é estado incoerente, e o agregado
 * de minutos de estudo leria tempo de algo que não foi feito.
 */
export async function marcarBloco(
  blocoId: string,
  status: "concluido" | "parcial" | "pulado" | "pendente",
  tempoRealSeg: number | null,
): Promise<void> {
  const voltandoAPendente = status === "pendente";
  const { error } = await supabase
    .from("blocos")
    .update({
      status,
      finalizado_em: voltandoAPendente ? null : new Date().toISOString(),
      tempo_real_seg: voltandoAPendente ? null : tempoRealSeg,
    })
    .eq("id", blocoId);
  if (error) throw new Error(error.message);
}

// `materias` não tem coluna de cor — cicla numa paleta fixa pela posição
// da matéria na lista do usuário, pra ficar estável entre Home e Estudo
// (mesma matéria, mesma cor, em qualquer tela).
const PALETA_DISCIPLINA = ["estudo", "roxo", "atencao"] as const;
/** Recebe qualquer lista que tenha `id` — serve tanto para `Materia`
    quanto para `MateriaParaMontagem`, que é o que a tela de Estudo passou
    a carregar. A ordem da lista é o que fixa a cor, então as duas
    consultas precisam ordenar igual (ambas: `ativa = true`, `criada_em` asc). */
export function corDaDisciplina(
  materiaId: string | null,
  materias: Array<{ id: string }>,
): string {
  if (!materiaId) return "var(--estudo)";
  const i = materias.findIndex((m) => m.id === materiaId);
  const token = PALETA_DISCIPLINA[i < 0 ? 0 : i % PALETA_DISCIPLINA.length];
  return `var(--${token})`;
}

/* ---------------------------------------------------------------------
   Grade de horários — pré-requisito duro da Fase B (montar-estudo):
   sem nenhum slot ativo, a function devolve 422 direto. CRUD simples,
   sem RPC — RLS já é "dono", igual equipamentos_indisponiveis.
   --------------------------------------------------------------------- */

export interface SlotGrade {
  id: string;
  /** 0 = domingo, igual à convenção de `grade_slots.dia_semana` e de
      `Date.getDay()` — não precisa converter em lugar nenhum. */
  diaSemana: number;
  hora: string;
  duracaoMin: number;
}

export async function carregarGrade(userId: string): Promise<SlotGrade[]> {
  const { data, error } = await supabase
    .from("grade_slots")
    .select("id,dia_semana,hora,duracao_min")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("dia_semana", { ascending: true })
    .order("hora", { ascending: true });
  // "Nenhum horário cadastrado" bloqueia o fluxo inteiro de montar plano —
  // mandar alguém cadastrar o que já existe é o pior desfecho possível.
  if (error) throw new Error(`não deu para carregar sua grade: ${error.message}`);
  return data.map((s) => ({
    id: s.id,
    diaSemana: s.dia_semana,
    hora: String(s.hora).slice(0, 5),
    duracaoMin: s.duracao_min,
  }));
}

export async function adicionarSlot(
  userId: string,
  slot: { diaSemana: number; hora: string; duracaoMin: number },
): Promise<void> {
  const { error } = await supabase.from("grade_slots").insert({
    id: novoId(),
    user_id: userId,
    dia_semana: slot.diaSemana,
    hora: slot.hora,
    duracao_min: slot.duracaoMin,
  });
  if (error) {
    // UNIQUE (user_id, dia_semana, hora): já existe compromisso nesse horário.
    if (error.code === "23505") throw new Error("Você já tem um horário marcado nesse dia e hora.");
    throw new Error(error.message);
  }
}

export async function removerSlot(slotId: string): Promise<void> {
  const { error } = await supabase.from("grade_slots").delete().eq("id", slotId);
  if (error) throw new Error(error.message);
}

export interface LimitesEstudo {
  maxBlocosDia: number;
  maxMinutosDia: number;
  /** 0 = domingo, mesma convenção de SlotGrade.diaSemana. */
  diaLeve: number | null;
}

const LIMITES_ESTUDO_PADRAO: LimitesEstudo = { maxBlocosDia: 2, maxMinutosDia: 180, diaLeve: null };

export async function carregarLimites(userId: string): Promise<LimitesEstudo> {
  const { data } = await supabase
    .from("limites_estudo")
    .select("max_blocos_dia,max_minutos_dia,dia_leve")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return LIMITES_ESTUDO_PADRAO;
  return {
    maxBlocosDia: data.max_blocos_dia,
    maxMinutosDia: data.max_minutos_dia,
    diaLeve: data.dia_leve,
  };
}

export async function salvarLimites(userId: string, limites: LimitesEstudo): Promise<void> {
  const { error } = await supabase.from("limites_estudo").upsert({
    user_id: userId,
    max_blocos_dia: limites.maxBlocosDia,
    max_minutos_dia: limites.maxMinutosDia,
    dia_leve: limites.diaLeve,
  });
  if (error) throw new Error(error.message);
}

export interface EventoNovo {
  tipo: "prova" | "entrega";
  data: string;
  descricao: string | null;
}

export async function criarMateriaSimples(
  nome: string,
  topicos: Array<{ nome: string; dificuldade: "facil" | "medio" | "dificil" | null }>,
  eventos: EventoNovo[] = [],
  // Os três valores do enum `origem_topicos` (migration 02). `ia_nome_materia`
  // é a geração sem documento — vale registrar de onde veio, porque muda
  // quanto dá para confiar na lista depois.
  origem: "manual" | "pdf" | "ia_nome_materia" = "manual",
  confianca: "alta" | "media" | "baixa" = "alta",
): Promise<string> {
  const { data, error } = await supabase.rpc("salvar_materia_com_topicos", {
    p_nome: nome,
    p_topicos: topicos,
    p_origem: origem,
    p_confianca: confianca,
    p_eventos: eventos,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface TopicoParaMontagem {
  id: string;
  nome: string;
  ordem: number;
  blocosEstimados: number | null;
  dificuldade: "facil" | "medio" | "dificil" | null;
  /** Tri-state vindo do mini-questionário: `null` = ainda não respondeu. */
  compreendido: boolean | null;
}

export interface EventoDaMateria {
  id: string;
  tipo: "prova" | "entrega";
  data: string;
  descricao: string | null;
}

export interface MateriaParaMontagem {
  id: string;
  nome: string;
  topicos: TopicoParaMontagem[];
  eventos: EventoDaMateria[];
}

interface LinhaMateriaParaMontagem {
  id: string;
  nome: string;
  topicos: Array<{
    id: string;
    nome: string;
    ordem: number;
    blocos_estimados: number | null;
    dificuldade: "facil" | "medio" | "dificil" | null;
    compreendido: boolean | null;
    ativo: boolean;
  }>;
  eventos: Array<{ id: string; tipo: "prova" | "entrega"; data: string; descricao: string | null }>;
}

/**
 * Matérias ativas com tópicos (pra saber quais ainda não têm
 * `blocos_estimados`, ou seja, precisam de diagnóstico) e eventos (pra
 * mostrar "prova em 20/09" na tela de montar plano).
 *
 * Também alimenta a lista "Suas matérias" na tela de Estudo, incluindo a
 * lista de tópicos que abre ao tocar na matéria — por isso traz `ordem`,
 * `dificuldade` e `compreendido`.
 */
export async function carregarMateriasParaMontagem(userId: string): Promise<MateriaParaMontagem[]> {
  const { data, error } = await supabase
    .from("materias")
    .select(
      "id,nome,topicos(id,nome,ordem,blocos_estimados,dificuldade,compreendido,ativo),eventos(id,tipo,data,descricao)",
    )
    .eq("user_id", userId)
    .eq("ativa", true)
    .order("criada_em", { ascending: true })
    .returns<LinhaMateriaParaMontagem[]>();
  // ESTE aqui é o que motivou a doutrina no topo do arquivo. Devolvendo
  // `[]` em erro, a tela de Estudo caía no return antecipado de
  // "materias.length === 0" e escondia TUDO — Pomodoro, card de montar
  // plano, blocos e a própria lista — afirmando que não havia matéria
  // nenhuma. Igualzinho a "a funcionalidade não foi implementada".
  if (error) throw new Error(`não deu para carregar suas matérias: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.id,
    nome: m.nome,
    // Filtro em JS, não na query: um <select> embutido do PostgREST com
    // filtro no aninhado (`topicos.ativo=eq.true`) precisaria de `!inner`,
    // que vira INNER JOIN e sumiria com a matéria inteira quando TODOS os
    // tópicos dela estivessem arquivados — o oposto do que se quer aqui.
    topicos: (m.topicos ?? [])
      .filter((t) => t.ativo)
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .map((t) => ({
        id: t.id,
        nome: t.nome,
        ordem: t.ordem,
        blocosEstimados: t.blocos_estimados,
        dificuldade: t.dificuldade,
        compreendido: t.compreendido,
      })),
    eventos: (m.eventos ?? []).map((e) => ({
      id: e.id,
      tipo: e.tipo,
      data: e.data,
      descricao: e.descricao,
    })),
  }));
}

/**
 * Tira a matéria da lista. É `ativa = false`, **não** um DELETE — e a
 * escolha é deliberada, não preguiça:
 *
 * `blocos.materia_id` é `on delete cascade`, sem filtro de status. Um
 * DELETE levaria junto todo bloco JÁ CONCLUÍDO daquela matéria, com
 * `tempo_real_seg` e as respostas do mini-questionário. Pior: o trigger
 * `trg_bloco_recalcula_dia` recomputa `resumos_diarios` a cada bloco
 * apagado, então minutos de estudo de dias passados seriam reescritos —
 * e `resumos_diarios` é justamente o que o GRUPO enxerga. Apagar uma
 * matéria mudaria, retroativamente, dias que seus amigos já viram.
 *
 * A coluna `ativa` já existia com `default true` e índice parcial
 * `where ativa`, e todas as consultas de matéria já filtravam por ela —
 * era um mecanismo pronto e nunca usado.
 */
export async function arquivarMateria(materiaId: string): Promise<void> {
  const { error } = await supabase
    .from("materias")
    .update({ ativa: false })
    .eq("id", materiaId);
  if (error) throw new Error(`não deu para excluir a matéria: ${error.message}`);
}

/**
 * Mesmo raciocínio de `arquivarMateria`, um nível abaixo: `ativo = false`
 * no tópico, nunca DELETE. `blocos.topico_id` é `on delete set null`, e
 * `ck_bloco_tem_alvo` (CHECK imediato) exige `topico_id` OU `evento_id`
 * preenchido — um bloco comum sem evento violaria essa regra assim que o
 * SET NULL rodasse, abortando a transação. Migration 21.
 */
export async function arquivarTopico(topicoId: string): Promise<void> {
  const { error } = await supabase
    .from("topicos")
    .update({ ativo: false })
    .eq("id", topicoId);
  if (error) throw new Error(`não deu para excluir o tópico: ${error.message}`);
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

export async function carregarGrupo(grupoId: string): Promise<Grupo | null> {
  const { data } = await supabase
    .from("grupos")
    .select("id,nome,codigo_convite")
    .eq("id", grupoId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Sai do grupo. Sem RPC: a policy "membros: sai do próprio grupo"
 * (migration 11) já permite `delete` em `grupo_membros` para a própria
 * linha — e é só a própria, mesmo que o id de outra pessoa fosse passado.
 */
export async function sairDoGrupo(grupoId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("grupo_membros")
    .delete()
    .eq("grupo_id", grupoId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export interface MembroDoGrupo {
  user_id: string;
  nome: string;
  foto_url: string | null;
  streak: number;
  treinou_hoje: boolean;
}

/** Um dia da faixa de atividade. `treinou` e `minutosEstudo` são o que a
    RLS libera para o grupo (`resumos_diarios`); a execução do treino em
    si — séries, cargas — continua privada. `sessaoLetra` é a letra da
    última sessão concluída no dia, e é o que a Início mostra dentro do
    círculo do dia. */
export interface DiaDoMembro {
  data: string;
  treinou: boolean;
  minutosEstudo: number;
  sessaoLetra: string | null;
}

/**
 * Dias de `resumos_diarios` num intervalo, SEM buracos: dia sem linha na
 * tabela é dia sem atividade, e precisa aparecer como lacuna em vez de
 * sumir da faixa.
 *
 * Serve tanto para o próprio usuário quanto para membro de grupo — a
 * policy é `pode_ver(user_id)`, que já cobre "sou eu" no primeiro termo.
 *
 * Consulta coberta pela PK `(user_id, data)` de `resumos_diarios`.
 */
export async function carregarDiasDeResumo(
  userId: string,
  de: string,
  ate: string,
): Promise<DiaDoMembro[]> {
  const { data, error } = await supabase
    .from("resumos_diarios")
    .select("data,treinou,minutos_estudo,sessao_letra")
    .eq("user_id", userId)
    .gte("data", de)
    .lte("data", ate);
  // Lança, não devolve dias zerados: uma faixa toda apagada é uma
  // AFIRMAÇÃO ("você não treinou nenhum dia") e não pode sair de uma
  // consulta que falhou — ver a doutrina no topo deste arquivo.
  if (error) throw new Error(`não deu para carregar seus dias: ${error.message}`);

  const porData = new Map(
    (data ?? []).map((r) => [
      r.data as string,
      r as { treinou: boolean; minutos_estudo: number; sessao_letra: string | null },
    ]),
  );

  const dias: DiaDoMembro[] = [];
  const cursor = new Date(`${de}T00:00:00Z`);
  const fim = new Date(`${ate}T00:00:00Z`);
  // Teto de segurança: intervalo estranho não pode virar laço infinito.
  while (cursor <= fim && dias.length < 400) {
    const iso = cursor.toISOString().slice(0, 10);
    const linha = porData.get(iso);
    dias.push({
      data: iso,
      treinou: linha?.treinou ?? false,
      minutosEstudo: linha?.minutos_estudo ?? 0,
      sessaoLetra: linha?.sessao_letra ?? null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/** Janela rolante de 7 dias terminando hoje — o recorte do DetalheGrupo
    ("como anda a constância recente do colega"). A Início usa outro
    recorte, a semana de calendário: ver `intervaloDaSemana`. */
export async function carregarUltimosDiasDoMembro(
  membroId: string,
  timezone: string,
): Promise<DiaDoMembro[]> {
  const hoje = hojeNoFuso(timezone);
  const inicio = new Date(`${hoje}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - 6);
  return carregarDiasDeResumo(membroId, inicio.toISOString().slice(0, 10), hoje);
}

/**
 * Segunda a domingo da semana em que `hojeISO` cai.
 *
 * Segunda-feira porque é a semana que o STREAK conta: `inicio_da_semana`
 * usa `date_trunc('week')` (segunda, no Postgres) e
 * `semanas_resumo.semana_inicio` tem `check (isodow = 1)`. Alinhar a
 * faixa a isso é o que faz ela significar "estes são os dias que contam
 * pra esta semana" em vez de sete quadradinhos soltos.
 */
export function intervaloDaSemana(hojeISO: string): { de: string; ate: string } {
  const d = new Date(`${hojeISO}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  // Domingo pertence à semana que começou na segunda anterior, não à
  // seguinte — daí o -6 em vez de +1.
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const de = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { de, ate: d.toISOString().slice(0, 10) };
}

export interface SessaoDoResumo {
  /** Necessário para buscar os exercícios da sessão no carrossel da Início. */
  id: string;
  letra: string;
  nome: string;
  totalExercicios: number;
}

export interface ResumoDoPlano {
  divisao: string;
  enfase: string;
  frequenciaSemanal: number;
  /** Na ordem da fila de rotação (`sessoes.posicao`), sempre. */
  sessoes: SessaoDoResumo[];
}

/**
 * Plano de treino de outro membro do grupo. É o conteúdo que a RLS libera
 * (`programa: dono ou grupo lê` / `sessao: dono ou grupo lê`) e que não
 * aparecia em tela nenhuma — o card de grupo mostrava só nome e streak.
 */
export async function carregarResumoDoPlano(membroId: string): Promise<ResumoDoPlano | null> {
  const { data: programa } = await supabase
    .from("programas")
    .select("id,divisao,enfase,frequencia_semanal")
    .eq("user_id", membroId)
    .eq("ativo", true)
    .maybeSingle();
  if (!programa) return null;

  const { data: sessoes } = await supabase
    .from("sessoes")
    .select("id,letra,nome")
    .eq("programa_id", programa.id)
    .order("posicao", { ascending: true })
    .returns<Array<{ id: string; letra: string; nome: string }>>();

  const comContagem = await Promise.all(
    (sessoes ?? []).map(async (s) => {
      // `head: true` — só o número, sem trazer as linhas.
      const { count } = await supabase
        .from("sessao_exercicios")
        .select("id", { count: "exact", head: true })
        .eq("sessao_id", s.id);
      return { id: s.id, letra: s.letra, nome: s.nome, totalExercicios: count ?? 0 };
    }),
  );

  return {
    divisao: programa.divisao,
    enfase: programa.enfase,
    frequenciaSemanal: programa.frequencia_semanal,
    sessoes: comContagem,
  };
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
