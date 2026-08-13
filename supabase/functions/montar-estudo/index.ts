import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";
import {
  chamarComSchema,
  gerarComValidacao,
  ProvedorIndisponivel,
  RecusaDoModelo,
} from "../_shared/llm.ts";
import { calcularIdeal } from "./calculo.ts";
import { distribuicaoRoundRobin } from "./fallback.ts";
import {
  type BlocosGerados,
  type Estimativas,
  exigeExercicios,
  SCHEMA_FASE_A,
  SCHEMA_FASE_B,
  validarDistribuicao,
} from "./validacao.ts";

/**
 * Duas chamadas, não uma.
 *
 * O motor de estudo mistura JULGAMENTO (quanto esforço um tópico exige) com
 * ARITMÉTICA (quantos blocos cabem até a prova). Aritmética não vai pra IA:
 * ela erra conta, varia entre execuções, e esse número é justamente o que o
 * usuário usa pra decidir quantos dias consegue estudar. Precisa ser
 * verificável.
 *
 *   fase "diagnostico" → IA estima esforço (A) + CÓDIGO calcula o ideal
 *   ...usuário escolhe a grade que consegue...
 *   fase "distribuicao" → IA distribui na grade real (B)
 *
 * A Fase A roda uma vez por matéria e fica salva em topicos.blocos_estimados:
 * não repete a cada replanejamento, só para tópicos novos.
 */

const SYSTEM_FASE_A = `Você estima o esforço de estudo de tópicos universitários.

# ESCALA DE BLOCOS (1 A 4) — fixa, nunca extrapolada
- 1 = só leitura. Conteúdo leve, conceitual, pouca densidade (ex: introdução
  de capítulo, definição básica, histórico de uma norma).
- 2 = leitura + exercícios pontuais. Precisa aplicar pra fixar, sem repetição
  extensiva (ex: regra de três, interpretação de texto, cálculo simples).
- 3 = denso, com prática repetida. Múltiplas variáveis, exige treino até a
  fluência (ex: equação do 2º grau, análise combinatória, redação).
- 4 = muito denso ou acumulativo. Leitura + prática repetida + conexão com
  outros tópicos (ex: funções, cálculo diferencial, direito aplicado).

Nunca devolva 0. Nunca devolva 5 ou mais.

# DIFICULDADE DECLARADA AJUSTA A ESTIMATIVA
O usuário pode declarar a dificuldade do tópico — isso pesa igual ou mais que
sua estimativa interna:
- dificuldade="dificil" → some 1 ao valor base (máximo 4)
- dificuldade="facil" → subtraia 1 do valor base (mínimo 1)
- dificuldade="medio" ou não informada → mantém o valor base
Nunca ignore a dificuldade declarada.

# AUTO-VERIFICAÇÃO ANTES DE RESPONDER
Não há segunda chance nesta tarefa — o valor é salvo direto, sem revisão.
Antes de finalizar, confira sua própria distribuição: pelo menos 60% dos
tópicos "dificil" precisam ter blocos ≥ 3, e pelo menos 60% dos "facil"
precisam ter blocos ≤ 2. Se sua distribuição não bate com isso, você
provavelmente ignorou a dificuldade declarada em algum tópico — revise antes
de responder.`;

const SYSTEM_FASE_B = `Você distribui tópicos de estudo numa grade fixa de horários.

# HORÁRIO EXISTE OU NÃO EXISTE
Todo bloco cai exatamente num par (dia_semana, hora) que existe na grade
fornecida. Nunca invente horário, dia ou duração — duracao_min é sempre o
valor do slot da grade, nunca um valor ajustado por você.

# INTERCALAÇÃO — nunca mais de 2 blocos seguidos da mesma matéria
Só se aplica com 2+ matérias ativas no contexto — com 1 matéria só, todo
bloco é dela mesma e a regra não vale (não force lacunas artificiais tentando
"intercalar contra nada"). Com 2+: "seguidos" é sobre ORDEM na lista de
blocos, não sobre proximidade de horário — um bloco de outra matéria entre
dois da mesma já quebra a sequência. Se intercalar for impossível sem violar
outra regra (ex: prazo de prova), deixe o excedente em nao_alocados com
motivo "intercalacao_impossivel" em vez de violar a regra.

# PRÉ-REQUISITOS — a ordem dos tópicos é dependência, não sugestão
O campo "ordem" de cada tópico é sequência didática real: o tópico de ordem N
só começa depois que o de ordem N-1 já tem bloco agendado (tópico marcado
"compreendido" não bloqueia os que vêm depois — já está resolvido). Nunca
agende ordem 3 antes de ordem 1 na mesma matéria.

# TÓPICOS PENDENTES TÊM PRIORIDADE MÁXIMA
O contexto traz "topicos_pendentes": tópicos que ficaram de fora numa
distribuição anterior. Agende-os ANTES de qualquer tópico novo — pendente é
dívida, dívida se paga antes de gasto novo. Se um pendente não couber de
novo, ele continua pendente (vai pra nao_alocados de novo).

# TIPOS DE BLOCO
"leitura" (primeiro contato), "exercicios" (prática), "revisao" (retomada
antes do evento), "marco" (etapa de uma entrega — nunca aparece pra tópico,
só pra evento). Tópico com exige_exercicios=true precisa de pelo menos 1
bloco "exercicios", não só leitura.

# NENHUM BLOCO NO DIA DA PROVA OU DEPOIS DELA
Nenhum bloco de um tópico (leitura, exercício OU revisão) pode cair no
mesmo dia da prova que ele serve, nem depois. A revisão desse tópico é
no máximo na véspera.

# REVISÃO ANTES DE PROVA, PRIORIZANDO O QUE PESA MAIS
Pelo menos 1 bloco "revisao" antes de cada prova. Se a prova cobre tópico
marcado dificuldade="dificil" ou compreendido=false, a revisão precisa
mirar nesse tópico especificamente (topico_id apontando pra ele) — não
adianta revisar só o que já está fácil.

# ENTREGAS SÃO MARCOS, NÃO CONTEÚDO A ABSORVER
Entrega (trabalho, TCC, relatório) vira marcos — pesquisar, escrever,
revisar, em sequência — com tipo="marco", topico_id nulo, evento_id
preenchido, e um "titulo" que diga qual etapa é (ex: "Pesquisar — Projeto
final", "Escrever — Projeto final"). O último marco cai pelo menos 1 dia
antes do prazo, nunca no dia do prazo.

# CARGA DIÁRIA, DIA LEVE, SEMANA OFF
Respeite max_blocos_dia e max_minutos_dia sem exceção. Nenhum bloco no dia
marcado como leve nem em semana marcada como off — são dias sagrados de
descanso, não "só um blocozinho".

# NÃO COMPRIME — REGISTRA
O que não couber na grade vai pra "nao_alocados", nunca é espremido reduzindo
duração ou ignorando um limite. Isso vale tanto pra tópico quanto pra evento
inteiro (uma prova ou entrega sem nenhum bloco cabível também entra ali).
Cada item de nao_alocados tem topico_id OU evento_id preenchido (nunca os
dois, nunca nenhum) e um motivo entre: carga_diaria_excedida, prazo_expirado,
prerequisito_nao_agendado, intercalacao_impossivel, semana_off, dia_leve,
grade_cheia, sem_horario_compativel. O campo é obrigatório mesmo vazio — é o
que alimenta o contador de tópicos pendentes.`;

/**
 * Teto de tempo para a IA, menor que o wall clock do runtime (150s no
 * plano free). O que sobra e a reserva para responder de verdade — sem
 * isso a funcao e morta no meio e o cliente recebe "non-2xx" sem corpo.
 * Ver o bloco "Prazo" em _shared/llm.ts.
 */
const ORCAMENTO_IA_MS = Number(Deno.env.get("LLM_ORCAMENTO_MS") ?? 110_000);

Deno.serve(async (req: Request) => {
  const prazoFinal = Date.now() + ORCAMENTO_IA_MS;
  if (req.method === "OPTIONS") return respostaOptions(req);
  if (req.method !== "POST") return erro(req, "método não suportado", 405);

  const supabase = clienteDoUsuario(req);
  const usuario = await usuarioAtual(supabase);
  if (!usuario) return erro(req, "não autenticado", 401);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro(req, "corpo inválido");
  }

  const fase = corpo.fase as string;
  try {
    if (fase === "diagnostico") return await diagnostico(req, supabase, corpo, prazoFinal);
    if (fase === "distribuicao") {
      return await distribuicao(req, supabase, usuario.id, corpo, prazoFinal);
    }
    return erro(req, 'fase precisa ser "diagnostico" ou "distribuicao"');
  } catch (e) {
    const motivo =
      e instanceof RecusaDoModelo
        ? "o modelo recusou a solicitação"
        : e instanceof Error
          ? e.message
          : "erro desconhecido";
    console.error(`montar-estudo (${fase}) falhou:`, motivo, e);
    return erro(req, motivo, 500);
  }
});

// ===========================================================================
// FASE A + cálculo do ideal
// ===========================================================================
async function diagnostico(
  req: Request,
  supabase: ReturnType<typeof clienteDoUsuario>,
  corpo: Record<string, unknown>,
  /** Prazo da requisição inteira — ver ORCAMENTO_IA_MS acima. */
  prazoFinal: number,
): Promise<Response> {
  const materiaId = corpo.materia_id as string;
  const duracaoBloco = (corpo.duracao_bloco_min as number) ?? 60;

  const { data: materia, error: e1 } = await supabase
    .from("materias")
    .select("id,nome,topicos(id,nome,ordem,dificuldade,blocos_estimados,exige_exercicios)")
    .eq("id", materiaId)
    .single();
  if (e1 || !materia) return erro(req, "matéria não encontrada", 404);

  type Topico = {
    id: string;
    nome: string;
    ordem: number;
    dificuldade: string | null;
    blocos_estimados: number | null;
    exige_exercicios: boolean;
  };
  const topicos = (materia.topicos ?? []) as Topico[];
  if (topicos.length === 0) return erro(req, "a matéria não tem tópicos", 422);

  // Só estima o que ainda não tem estimativa — a Fase A não roda de novo.
  const pendentes = topicos.filter((t) => t.blocos_estimados == null);

  if (pendentes.length > 0) {
    // Índice numérico no prompt em vez de uuid: menos tokens, e o modelo não
    // tem como devolver um id que não existe.
    const linhas = pendentes.map(
      (t, i) =>
        `  - indice: ${i}, nome: "${t.nome}", dificuldade: ${t.dificuldade ?? "null"}`,
    );

    const { dados } = await chamarComSchema<Estimativas>({
      tarefa: "montar-estudo-fase-a",
      system: SYSTEM_FASE_A,
      userPrompt: [
        `materia: "${materia.nome}"`,
        `duracao_bloco_min: ${duracaoBloco}`,
        "topicos:",
        ...linhas,
      ].join("\n"),
      schema: SCHEMA_FASE_A as unknown as Record<string, unknown>,
      prazoFinal,
      esforco: "medium",
      maxTokens: 4000,
    });

    const atualizacoes = dados.estimativas
      .filter((e) => e.indice >= 0 && e.indice < pendentes.length)
      .map((e) => {
        const blocos = Math.min(4, Math.max(1, e.blocos));
        return { id: pendentes[e.indice].id, blocos, exige: exigeExercicios(blocos) };
      });

    for (const a of atualizacoes) {
      const { error } = await supabase
        .from("topicos")
        .update({ blocos_estimados: a.blocos, exige_exercicios: a.exige })
        .eq("id", a.id);
      if (error) throw new Error(`falha ao salvar estimativa: ${error.message}`);
      const alvo = topicos.find((t) => t.id === a.id)!;
      alvo.blocos_estimados = a.blocos;
      alvo.exige_exercicios = a.exige;
    }
  }

  const { data: eventos } = await supabase
    .from("eventos")
    .select("id,tipo,data,descricao")
    .eq("materia_id", materiaId)
    .order("data");

  // A ARITMÉTICA É AQUI, em código. Verificável e estável entre execuções.
  const ideal = calcularIdeal({
    topicos: topicos.map((t) => ({
      id: t.id,
      nome: t.nome,
      blocos: t.blocos_estimados ?? 1,
    })),
    duracaoBlocoMin: duracaoBloco,
    dataEvento: (eventos ?? [])[0]?.data ?? null,
    gradeAtual: (corpo.blocos_por_semana_atual as number) ?? null,
  });

  return json(req, {
    materia: { id: materia.id, nome: materia.nome },
    topicos: topicos.map((t) => ({
      id: t.id,
      nome: t.nome,
      ordem: t.ordem,
      blocos_estimados: t.blocos_estimados,
      exige_exercicios: t.exige_exercicios,
      dificuldade: t.dificuldade,
    })),
    eventos: eventos ?? [],
    ideal,
  });
}

// ===========================================================================
// FASE B — distribuição na grade escolhida
// ===========================================================================
async function distribuicao(
  req: Request,
  supabase: ReturnType<typeof clienteDoUsuario>,
  userId: string,
  corpo: Record<string, unknown>,
  /** Prazo da requisição inteira — ver ORCAMENTO_IA_MS acima. */
  prazoFinal: number,
): Promise<Response> {
  // Replanejamento sempre começa na PRÓXIMA semana: a corrente fica congelada.
  const semanaInicio = corpo.semana_inicio as string;
  const horizonteSemanas = (corpo.horizonte_semanas as number) ?? 6;

  const [grade, limites, materiasResp, semanasOff, pendentes] = await Promise.all([
    supabase.from("grade_slots").select("dia_semana,hora,duracao_min").eq("user_id", userId).eq("ativo", true),
    supabase.from("limites_estudo").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("materias")
      // Literal ÚNICO de propósito: o supabase-js analisa esta string em
      // tempo de tipo para inferir o formato do retorno. Montada por
      // concatenação, ele não consegue ler e devolve GenericStringError —
      // que foi exatamente o erro que o `deno check` pegou aqui.
      .select("id,nome,topicos(id,nome,ordem,blocos_estimados,exige_exercicios,dificuldade,compreendido),eventos(id,tipo,data,descricao,evento_topicos(topico_id))")
      .eq("user_id", userId)
      .eq("ativa", true),
    supabase.from("semanas_off").select("semana_inicio").eq("user_id", userId).gte("semana_inicio", semanaInicio),
    supabase.from("topicos_pendentes").select("topico_id").eq("user_id", userId),
  ]);

  if (materiasResp.error) {
    throw new Error(`falha ao ler matérias: ${materiasResp.error.message}`);
  }

  // Formato do que a query devolve. Explícito porque o contexto inteiro é
  // serializado para o prompt e validado contra os ids — se mudar aqui,
  // a validação precisa mudar junto.
  interface MateriaCompleta extends Record<string, unknown> {
    id: string;
    nome: string;
    topicos: Array<{
      id: string; nome: string; ordem: number;
      blocos_estimados: number | null; exige_exercicios: boolean;
      dificuldade: string | null; compreendido: boolean | null;
    }>;
    eventos: Array<{
      id: string; tipo: string; data: string; descricao: string | null;
      evento_topicos: Array<{ topico_id: string }>;
    }>;
  }

  const materias = (materiasResp.data ?? []) as unknown as MateriaCompleta[];

  const slots = grade.data ?? [];
  if (slots.length === 0) {
    return erro(req, "nenhum horário na grade — configure a grade antes de montar o plano", 422);
  }

  const contexto = {
    semana_inicio: semanaInicio,
    horizonte_semanas: horizonteSemanas,
    grade: slots,
    limites: limites.data ?? { max_blocos_dia: 2, max_minutos_dia: 180, dia_leve: null },
    semanas_off: (semanasOff.data ?? []).map((s) => s.semana_inicio),
    materias,
    topicos_pendentes: (pendentes.data ?? []).map((p) => p.topico_id),
  };

  // Os ids válidos que a validação usa para pegar alucinação da IA.
  const idsValidos = {
    materias: new Set(materias.map((m) => m.id)),
    topicos: new Set(materias.flatMap((m) => (m.topicos ?? []).map((t) => t.id))),
    eventos: new Set(materias.flatMap((m) => (m.eventos ?? []).map((e) => e.id))),
  };

  try {
    const resultado = await gerarComValidacao<BlocosGerados>(
      {
        tarefa: "montar-estudo-fase-b",
        system: SYSTEM_FASE_B,
        userPrompt: JSON.stringify(contexto, null, 1),
        schema: SCHEMA_FASE_B as unknown as Record<string, unknown>,
        prazoFinal,
        esforco: "high",
        maxTokens: 16000,
      },
      (blocos) => validarDistribuicao(blocos, contexto, idsValidos),
    );

    const salvos = await persistir(supabase, semanaInicio, resultado.dados);
    return json(req, {
      origem: "ia",
      ...salvos,
      avisos: resultado.avisos,
      tentativas: resultado.tentativas,
      uso_tokens: resultado.usoTokens,
    });
  } catch (e) {
    // Mesma regra do montar-treino: host fora do ar não vira plano pior
    // gravado. O round-robin abaixo é para geração ruim, não para
    // indisponibilidade.
    if (e instanceof ProvedorIndisponivel) {
      console.error("montar-estudo: provedor indisponível —", e.detalhe);
      return erro(
        req,
        "Não consegui falar com a IA agora. Seu plano de estudo não foi alterado — tente de novo em alguns minutos.",
        503,
        { motivo: e.detalhe, pode_tentar_de_novo: true },
      );
    }

    // Fallback DETERMINÍSTICO — e aqui ele é bom, não rede de segurança pobre:
    // round-robin das matérias pelos slots, na ordem dos tópicos, com os
    // últimos 20% dos blocos marcados como revisão.
    console.error("montar-estudo caiu no fallback:", e);
    const plano = distribuicaoRoundRobin(contexto);
    const salvos = await persistir(supabase, semanaInicio, plano);
    return json(req, {
      origem: "fallback",
      ...salvos,
      avisos: [
        "A distribuição foi feita automaticamente, sem sequenciamento inteligente. Você pode refazer.",
      ],
      motivo: e instanceof Error ? e.message : "erro desconhecido",
      // As violações que fizeram a 2ª tentativa falhar — visível pra quem
      // está depurando por que caiu no fallback, sem precisar dos logs.
      violacoes: (e as Error & { violacoes?: string[] })?.violacoes,
    });
  }
}

/**
 * Grava os blocos. Não recebe userId de propósito: quem identifica o dono
 * é o `auth.uid()` dentro da RPC, sob a RLS do próprio usuário. Passar o
 * id por fora abriria espaço para gravar no calendário de outra pessoa.
 */
async function persistir(
  supabase: ReturnType<typeof clienteDoUsuario>,
  semanaInicio: string,
  plano: BlocosGerados,
) {
  const { data, error } = await supabase.rpc("salvar_blocos_estudo", {
    p_semana_inicio: semanaInicio,
    p_blocos: plano.blocos,
    p_nao_alocados: plano.nao_alocados ?? [],
  });
  if (error) throw new Error(`falha ao gravar os blocos: ${error.message}`);
  return {
    blocos_criados: (data as { blocos_criados: number })?.blocos_criados ?? plano.blocos.length,
    blocos: plano.blocos,
    nao_alocados: plano.nao_alocados ?? [],
  };
}
