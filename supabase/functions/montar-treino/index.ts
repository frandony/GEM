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

# OBJETIVO
Dividir exercícios em sessões (A, B, C...), definindo séries, reps/duração,
descanso e 3 substitutos por exercício. Roda uma vez no onboarding, e de
novo no modo parcial (refazendo só uma sessão).

# CATÁLOGO É A ÚNICA FONTE
Escolha exercícios APENAS do catálogo fornecido. Nunca invente id, nome ou
atributo. O campo "nome" precisa ser copiado exatamente do catálogo — ele é
conferido contra o id. Sem opção adequada pra um slot, ajuste o slot em vez
de inventar.

# DEFINIÇÃO DE COMPOSTO
Composto é todo exercício que move várias articulações e músculos
principais ao mesmo tempo — não só "empurrar" e "puxar". padrao_movimento
que conta como composto:
- empurrar horizontal, empurrar vertical (supino, desenvolvimento)
- puxar horizontal, puxar vertical (remada, puxada)
- dominante de joelho (agachamento, leg press)
- dominante de quadril (stiff, levantamento terra)
- unilateral (afundo, búlgaro, passada)
- carregamento (farmer walk, suitcase carry)
Todo o resto é isolamento (rosca, tríceps, cadeira extensora, elevação
lateral, crucifixo) ou complemento (abdômen, panturrilha).

Compostos SEMPRE vêm antes de isolamentos na sessão; dentro dos compostos,
o de maior carga/mais articulações primeiro. Abdômen e panturrilha sempre
por último, depois de tudo.

# DIVISÃO = NÚMERO EXATO DE SESSÕES
"divisao" determina exatamente quantas sessões gerar — nunca mais, nunca
menos, sem letra repetida ou inventada: AB→A,B · ABC→A,B,C · ABCD→A,B,C,D ·
ABCDE→A,B,C,D,E.

# COMO DISTRIBUIR OS GRUPOS ENTRE AS SESSÕES
Ponto de partida (ênfase "equilibrado"), um lado do corpo por sessão —
nunca misture superior e inferior na mesma sessão (abdômen/panturrilha à
parte, eles cabem em qualquer uma como complemento):
- AB: A = peito, costas, ombro, bíceps, tríceps (superior) · B = quadríceps,
  posterior, glúteo, panturrilha, abdômen (inferior)
- ABC: A (empurrar) = peito, ombro, tríceps · B (puxar) = costas, bíceps ·
  C (pernas) = quadríceps, posterior, glúteo, panturrilha, abdômen
- ABCD: A = peito, tríceps · B = costas, bíceps · C = quadríceps, glúteo ·
  D = posterior, panturrilha, abdômen — 2 sessões superior, 2 inferior
- ABCDE: A = peito · B = costas, ombro · C = bíceps, tríceps · D =
  quadríceps, glúteo · E = posterior, panturrilha, abdômen — 3 superior,
  2 inferior (ajuste se a ênfase pedir o oposto, ver abaixo)

# ÊNFASE — REALOQUE SESSÕES INTEIRAS, NÃO MISTURE GRUPOS
Quando a ênfase não for "equilibrado", o jeito certo de dar mais volume a
um lado é dedicar MAIS SESSÕES INTEIRAS a ele — como um treinador faria
(um dia a mais de perna), nunca enfiando agachamento no dia de peito.

- "superior": mais sessões superior que inferior no total do ciclo
- "inferior": mais sessões inferior que superior
- "equilibrado": o mais próximo de metade/metade de sessões pra cada lado

Exceção: divisão AB só tem 1 sessão de cada lado — não dá pra realocar dia.
Nesse caso a ênfase se expressa por SÉRIES: a sessão do lado enfatizado fica
perto do teto (≈22 séries), a do outro lado perto do piso (≈10).

Depois de decidir quantas sessões vão pra cada lado, confira o cálculo:
some as séries do ciclo INTEIRO por região do grupo_primario (abdômen e
lombar não entram nesta conta):
- superior: peito, costas, ombro, bíceps, tríceps
- inferior: quadríceps, posterior, glúteo, panturrilha, adutores, abdutores

- enfase="superior": 57% a 72% do volume (superior+inferior) em superior
- enfase="inferior": 57% a 72% em inferior
- enfase="equilibrado": 42,5% a 57,5% de cada lado

Se ainda ficar fora da faixa depois de realocar sessões, ajuste séries
dentro dos limites abaixo até fechar — antes de finalizar.

# FAIXAS DE SÉRIES, REPS E DESCANSO — a validação rejeita o que sair daqui
- Composto: 3 a 5 séries, 5 a 10 reps, 90 a 180s de descanso
- Isolamento: 2 a 4 séries, 10 a 15 reps, 45 a 90s de descanso
- Abdômen/panturrilha (complemento): 2 a 4 séries; 10 a 20 reps se
  medida="reps", 20 a 60s se medida="tempo"; 30 a 60s de descanso
- Sessão inteira: 4 a 7 exercícios, 10 a 22 séries no total

# MEDIDA DO EXERCÍCIO
medida="reps" no catálogo → preencha reps_min e reps_max, duracao_seg nulo.
medida="tempo" → preencha duracao_seg, reps_min e reps_max nulos. Nunca
misture os dois nem deixe o par errado nulo.

# SUBSTITUTOS
Cada exercício leva EXATAMENTE 3 substitutos. Cada substituto precisa: ser
do mesmo grupo_primario e mesmo padrao_movimento do titular; ter
equipamento diferente do titular quando houver opção; nunca ser o próprio
id do titular; nunca ser um id que já está na mesma sessão.

# NÃO REPETIR EXERCÍCIO
Nunca repita o mesmo id na mesma sessão. Evite repetir entre sessões do
mesmo ciclo — só aceitável se o catálogo disponível for pequeno demais
pra evitar. No modo parcial, nunca reutilize um id que já aparece nas
sessões que NÃO estão sendo refeitas.

# ABDÔMEN E PANTURRILHA
Sempre por último na sessão, depois de compostos e isolamentos. No máximo
2 exercícios de abdômen+panturrilha combinados por sessão, e no máximo 20%
das séries da sessão vindo deles.

# COMUM (RARIDADE)
comum=1 é prioridade. comum=2 por variedade quando comum=1 não cobre o
slot. comum=3 só sem alternativa em comum=1/2 — no máximo 20% dos
exercícios do ciclo inteiro podem ser comum=3.

# EXERCÍCIOS CURTIDOS
Se vier uma lista de curtidos, priorize-os quando couberem no
grupo_primario e padrao_movimento do slot. Um curtido nunca quebra a ordem
composto→isolamento, a faixa de séries/reps, nem a regra de não-repetição
— se violar alguma, ignore-o para aquele slot.

# MODO PARCIAL
Quando modo="parcial": gere APENAS as sessões pedidas em sessoes_a_gerar.
As sessões existentes (recebidas no contexto) permanecem como estão — não
as reescreva, nunca reutilize um id delas. A ênfase considerada é a do
ciclo COMPLETO (existentes + novas), não só das sessões novas.

# ORDEM DE MONTAGEM DE CADA SESSÃO
1. Decida quantas sessões do ciclo vão pra cada lado (ver ÊNFASE)
2. Grupos musculares desta sessão específica, pela distribuição acima
3. Compostos primeiro: maior carga/mais articulações do grupo principal,
   depois os demais, do maior pro menor
4. Isolamentos do grupo principal, depois de grupos secundários
5. Abdômen/panturrilha por último, se couberem
6. Para cada slot: grupo_primario e padrao_movimento certos pro tipo,
   comum=1 antes de 2 antes de 3, sem repetir na sessão
7. Séries/reps/descanso dentro da faixa do tipo
8. Confira o total da sessão (10-22 séries, 4-7 exercícios) e ajuste
9. Gere os 3 substitutos de cada exercício
10. Confira a ênfase do ciclo completo e o limite de comum=3 antes de
    devolver`;

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

/* ---------------------------------------------------------------------
   Orçamento de tempo da requisição.

   O runtime mata a função ao bater o wall clock (150s no plano free) e
   nesse caso NADA é devolvido: nem o 503 de provedor indisponível, nem o
   template de fallback. O cliente vê só "Edge Function returned a
   non-2xx status code" — sem corpo, sem motivo. Foi o que aconteceu em
   2026-08-13 quando o provedor primário caiu e o fallback começou tarde
   demais.

   Por isso a IA ganha um teto MENOR que o wall clock: o que sobra é a
   reserva para gravar o template e responder de verdade.

   Ajustável por env porque o limite muda com o plano do Supabase.
   --------------------------------------------------------------------- */
const ORCAMENTO_IA_MS = Number(Deno.env.get("LLM_ORCAMENTO_MS") ?? 110_000);

Deno.serve(async (req: Request) => {
  const inicio = Date.now();
  const prazoFinal = inicio + ORCAMENTO_IA_MS;

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
        prazoFinal,
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
      console.error(
        `montar-treino: provedor indisponível após ${Math.round((Date.now() - inicio) / 1000)}s —`,
        e.detalhe,
      );
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
      const plano = templateFallback(corpo.divisao, catalogo, corpo.enfase);
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
