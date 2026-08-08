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

Para cada tópico, estime quantos blocos de estudo ele exige, considerando a
densidade conceitual do tópico, se exige prática de exercícios além de leitura,
e a dificuldade declarada pelo aluno quando houver.

Escala: 1 bloco = tópico simples, só leitura. 2 = leitura + exercícios.
3 = tópico denso, exige prática repetida. Nunca mais que 4.

Se a dificuldade declarada for "dificil", some 1 à sua estimativa (máximo 4).
Se for "facil", subtraia 1 (mínimo 1).`;

const SYSTEM_FASE_B = `Você distribui tópicos de estudo numa grade fixa de horários.

Regras absolutas:
- Todo bloco cai exatamente num par (dia_semana, hora) que existe na grade
  fornecida. Nunca invente horário.
- Nenhum bloco de um tópico pode ser agendado depois do evento que ele serve.
- Respeite os limites de carga informados. Nunca ultrapasse.
- Nenhum bloco no dia leve, nem em semana marcada como off.

Sequenciamento:
- Com mais de uma matéria ativa, INTERCALE. Nunca mais de 2 blocos seguidos da
  mesma matéria.
- Dentro de uma matéria, respeite pré-requisitos: use o campo "ordem" dos
  tópicos, que vem do plano de ensino.
- Tipos de bloco: "leitura" (primeiro contato), "exercicios" (prática),
  "revisao" (retomada antes do evento), "marco" (etapa de uma entrega).
- Tópico com exige_exercicios=true precisa de pelo menos 1 bloco "exercicios".
- Reserve os últimos blocos antes de cada prova como "revisao", priorizando
  tópicos com dificuldade "dificil" ou marcados como não compreendidos.

Eventos do tipo "entrega" não são conteúdo a absorver, são trabalho a produzir.
Distribua como marcos (pesquisar → escrever → revisar), com topico_id nulo e
evento_id preenchido. O último marco cai pelo menos 1 dia antes do prazo.

Se o conteúdo não couber na grade, NÃO comprima. Agende o que cabe respeitando
prioridade e liste o que ficou de fora em "nao_alocados". Esse campo é
obrigatório mesmo vazio — é o que alimenta o contador de tópicos pendentes.`;

Deno.serve(async (req: Request) => {
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
    if (fase === "diagnostico") return await diagnostico(req, supabase, corpo);
    if (fase === "distribuicao") return await distribuicao(req, supabase, usuario.id, corpo);
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
      esforco: "medium",
      maxTokens: 4000,
    });

    const atualizacoes = dados.estimativas
      .filter((e) => e.indice >= 0 && e.indice < pendentes.length)
      .map((e) => ({
        id: pendentes[e.indice].id,
        blocos: Math.min(4, Math.max(1, e.blocos)),
        exige: e.exige_exercicios,
      }));

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
