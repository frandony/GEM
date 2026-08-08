import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";
import {
  carregarCatalogo,
  catalogoComoTabela,
  LETRAS_POR_DIVISAO,
} from "../_shared/catalogo.ts";
import {
  gerarComValidacao,
  ProvedorIndisponivel,
  RecusaDoModelo,
} from "../_shared/llm.ts";
import {
  type PlanoGerado,
  validarPlano,
  volumePorGrupo,
} from "./validacao.ts";
import { templateFallback } from "./fallback.ts";

// ---------------------------------------------------------------------------
// Regras do domínio. Prefixo ESTÁVEL — não interpolar nada por usuário aqui,
// ou o cache do catálogo (bloco seguinte) é invalidado a cada chamada.
//
// Não há instrução "devolva só JSON": `output_config.format` garante o
// formato pela API. Pedir de novo em prosa é ruído que o modelo tem que
// reconciliar com o schema.
// ---------------------------------------------------------------------------
const SYSTEM_REGRAS = `Você monta planos de treino de musculação.

Escolha exercícios APENAS do catálogo fornecido. Nunca invente nome ou id.
O campo "nome" de cada exercício deve ser copiado exatamente do catálogo — ele
é conferido contra o id.

Priorize exercícios com comum=1. Use comum=2 quando precisar de variedade.
Use comum=3 apenas se não houver alternativa adequada.

Exercícios com medida="tempo" usam duracao_seg, com reps_min e reps_max nulos.
Exercícios com medida="reps" usam reps_min e reps_max, com duracao_seg nulo.

Cada exercício leva 3 substitutos. Um substituto precisa ter o MESMO
grupo_primario e o MESMO padrao_movimento do titular; prefira equipamento
diferente do titular.

Nenhum exercício pode aparecer duas vezes na mesma sessão, e evite repetir
exercício entre sessões do mesmo ciclo.

Estrutura de sessão:
- Comece pelos padrões compostos (empurrar, puxar, dominante de joelho,
  dominante de quadril), termine pelos de isolamento.
- 4 a 7 exercícios por sessão, 10 a 22 séries no total.
- Compostos: 3-5 séries, 5-10 reps, 90-180s de descanso.
- Isolamento: 2-4 séries, 10-15 reps, 45-90s de descanso.
- Abdômen e panturrilha entram como complemento, no fim.

Ênfase — volume é a soma de séries por grupo_primario no ciclo inteiro:
- "superior": ~2/3 do volume em peito, costas, ombro, bíceps, tríceps.
- "inferior": ~2/3 em quadríceps, posterior, glúteo, panturrilha, adutores, abdutores.
- "equilibrado": distribuição próxima de 50/50.`;

// JSON Schema da saída. Sem minimum/maximum/minItems — não são suportados em
// structured outputs; essas faixas são conferidas em validacao.ts.
const SCHEMA = {
  type: "object",
  properties: {
    sessoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          letra: { type: "string", enum: ["A", "B", "C", "D", "E"] },
          nome: { type: "string" },
          exercicios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                exercicio_id: { type: "integer" },
                nome: { type: "string" },
                ordem: { type: "integer" },
                series: { type: "integer" },
                reps_min: { type: ["integer", "null"] },
                reps_max: { type: ["integer", "null"] },
                duracao_seg: { type: ["integer", "null"] },
                descanso_seg: { type: "integer" },
                substitutos: { type: "array", items: { type: "integer" } },
              },
              required: [
                "exercicio_id",
                "nome",
                "ordem",
                "series",
                "reps_min",
                "reps_max",
                "duracao_seg",
                "descanso_seg",
                "substitutos",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["letra", "nome", "exercicios"],
        additionalProperties: false,
      },
    },
  },
  required: ["sessoes"],
  additionalProperties: false,
} as const;

interface Corpo {
  divisao: "AB" | "ABC" | "ABCD" | "ABCDE";
  enfase: "superior" | "inferior" | "equilibrado";
  frequencia_semanal: number;
  modo?: "completo" | "parcial";
  sessoes_a_gerar?: string[];
  programa_id?: string;
  dias_lembrete?: number[];
  hora_lembrete?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respostaOptions(req);
  if (req.method !== "POST") return erro(req, "método não suportado", 405);

  const supabase = clienteDoUsuario(req);
  const usuario = await usuarioAtual(supabase);
  if (!usuario) return erro(req, "não autenticado", 401);

  let corpo: Corpo;
  try {
    corpo = await req.json();
  } catch {
    return erro(req, "corpo inválido");
  }

  if (!LETRAS_POR_DIVISAO[corpo.divisao]) {
    return erro(req, `divisão inválida: ${corpo.divisao}`);
  }
  if (!(corpo.frequencia_semanal >= 2 && corpo.frequencia_semanal <= 6)) {
    return erro(req, "frequencia_semanal precisa estar entre 2 e 6");
  }

  const modo = corpo.modo ?? "completo";

  try {
    const catalogo = await carregarCatalogo(supabase, usuario.id);
    if (catalogo.lista.length < 20) {
      return erro(
        req,
        "sobraram poucos exercícios no catálogo — revise os equipamentos marcados como indisponíveis",
        422,
      );
    }

    const { data: curtidos } = await supabase
      .from("exercicios_curtidos")
      .select("exercicio_id")
      .eq("user_id", usuario.id);

    // Contexto VOLÁTIL vai no user prompt, depois do breakpoint de cache.
    const linhas = [
      `frequencia_semanal: ${corpo.frequencia_semanal}`,
      `divisao: ${corpo.divisao}`,
      `enfase: ${corpo.enfase}`,
      `modo: ${modo}`,
    ];

    if (modo === "parcial" && corpo.sessoes_a_gerar?.length) {
      linhas.push(`sessoes_a_gerar: ${JSON.stringify(corpo.sessoes_a_gerar)}`);
      // No modo parcial a IA precisa VER as outras sessões para não repetir
      // exercício e para manter a ênfase do ciclo.
      const { data: existentes } = await supabase
        .from("sessoes")
        .select("letra,nome,sessao_exercicios(exercicio_id,series,ordem)")
        .eq("programa_id", corpo.programa_id ?? "")
        .not("letra", "in", `(${corpo.sessoes_a_gerar.join(",")})`);
      linhas.push(`sessoes_existentes: ${JSON.stringify(existentes ?? [])}`);
    }

    if (curtidos?.length) {
      linhas.push(
        `exercicios_curtidos: ${JSON.stringify(curtidos.map((c) => c.exercicio_id))}`,
        "(priorize os curtidos quando couberem nas regras — são preferência declarada)",
      );
    }

    const resultado = await gerarComValidacao<PlanoGerado>(
      {
        tarefa: "montar-treino",
        system: SYSTEM_REGRAS,
        systemCacheavel: catalogoComoTabela(catalogo),
        userPrompt: linhas.join("\n"),
        // Montar um plano é a decisão mais importante do onboarding e roda
        // uma vez só. Vale o esforço alto.
        esforco: "xhigh",
        maxTokens: 16000,
        schema: SCHEMA as unknown as Record<string, unknown>,
      },
      (plano) =>
        validarPlano(plano, catalogo, {
          divisao: corpo.divisao,
          enfase: corpo.enfase,
        }),
    );

    const salvo = await persistir(supabase, corpo, resultado.dados, false);

    return json(req, {
      origem: "ia",
      programa_id: salvo,
      plano: resultado.dados,
      volume_por_grupo: volumePorGrupo(resultado.dados, catalogo),
      avisos: resultado.avisos,
      tentativas: resultado.tentativas,
      uso_tokens: resultado.usoTokens,
    });
  } catch (e) {
    // ---------------------------------------------------------------------
    // Provedor fora do ar NÃO cai no template.
    //
    // O template é resposta para "a IA gerou algo inválido". Para "não deu
    // pra falar com a IA", ele é a resposta errada: gravaria um plano pior
    // de forma permanente por causa de uma indisponibilidade passageira.
    // Melhor devolver 503 e deixar a pessoa tentar de novo — o plano bom
    // continua do outro lado.
    // ---------------------------------------------------------------------
    if (e instanceof ProvedorIndisponivel) {
      console.error("montar-treino: provedor indisponível —", e.detalhe);
      return erro(
        req,
        "Não consegui falar com a IA agora. Seu plano não foi criado — tente de novo em alguns minutos.",
        503,
        { motivo: e.detalhe, pode_tentar_de_novo: true },
      );
    }

    // ---------------------------------------------------------------------
    // Fallback: template fixo por divisão, sem ênfase. Genérico de propósito
    // — é rede de segurança, não produto. A tela avisa e oferece refazer.
    // ---------------------------------------------------------------------
    const motivo =
      e instanceof RecusaDoModelo
        ? "o modelo recusou a solicitação"
        : e instanceof Error
          ? e.message
          : "erro desconhecido";
    console.error("montar-treino caiu no fallback:", motivo, e);

    try {
      const catalogo = await carregarCatalogo(supabase, usuario.id);
      const plano = templateFallback(corpo.divisao, catalogo);
      const salvo = await persistir(supabase, corpo, plano, true);

      return json(req, {
        origem: "fallback",
        programa_id: salvo,
        plano,
        volume_por_grupo: volumePorGrupo(plano, catalogo),
        avisos: [
          "Este é um modelo padrão, não um plano montado para você. Ajuste os exercícios ou tente gerar de novo.",
        ],
        motivo,
      });
    } catch (e2) {
      console.error("o fallback também falhou:", e2);
      return erro(req, "não foi possível montar o treino", 500, { motivo });
    }
  }
});

/** Gravação atômica via RPC: programa + sessões + exercícios + substitutos. */
async function persistir(
  supabase: ReturnType<typeof clienteDoUsuario>,
  corpo: Corpo,
  plano: PlanoGerado,
  fallback: boolean,
): Promise<string> {
  const { data, error } = await supabase.rpc("salvar_programa", {
    p_divisao: corpo.divisao,
    p_enfase: corpo.enfase,
    p_frequencia_semanal: corpo.frequencia_semanal,
    p_dias_lembrete: corpo.dias_lembrete ?? [],
    p_hora_lembrete: corpo.hora_lembrete ?? null,
    p_origem_fallback: fallback,
    p_sessoes: plano.sessoes,
  });
  if (error) throw new Error(`falha ao gravar o programa: ${error.message}`);
  return data as string;
}
