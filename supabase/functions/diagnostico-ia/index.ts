import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";
import {
  chamarComSchema,
  ProvedorIndisponivel,
  RecusaDoModelo,
} from "../_shared/llm.ts";
import { carregarCatalogo, catalogoComoTabela } from "../_shared/catalogo.ts";

/**
 * Testa o provedor configurado antes de você depender dele.
 *
 * Existe por causa do modelo do OmniRoute: 43 pools de free tier com
 * capacidade desigual. "Responde" não é a mesma coisa que "serve para o
 * montar-treino". Esta função separa as duas perguntas, e faz isso sem
 * gravar nada no banco.
 *
 * Roda três provas de dificuldade crescente:
 *   1. Vivo?          — schema trivial, 2 campos
 *   2. Aguenta schema aninhado? — array de objetos, o formato real do app
 *   3. Aguenta o prompt de verdade? — catálogo inteiro + restrição cruzada
 *
 * A prova 3 é a que importa. As outras duas existem para localizar a
 * falha: se a 1 passa e a 3 falha, o problema é capacidade do modelo,
 * não configuração.
 */

interface Prova {
  nome: string;
  descricao: string;
  ok: boolean;
  ms: number;
  detalhe?: string;
  tokens?: { entrada: number; saida: number };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respostaOptions(req);

  const supabase = clienteDoUsuario(req);
  const usuario = await usuarioAtual(supabase);
  if (!usuario) return erro(req, "não autenticado", 401);

  const tarefa = (await req.json().catch(() => ({}))).tarefa ?? "montar-treino";
  const provas: Prova[] = [];

  // --- 1. está vivo? ------------------------------------------------------
  provas.push(
    await medir("vivo", "Responde e devolve JSON com 2 campos", async () => {
      const r = await chamarComSchema<{ ok: boolean; modelo: string }>({
        tarefa,
        system: "Você responde a um teste de conectividade.",
        userPrompt: 'Responda com ok=true e modelo="<o nome do modelo que você é>".',
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" }, modelo: { type: "string" } },
          required: ["ok", "modelo"],
          additionalProperties: false,
        },
        maxTokens: 200,
        esforco: "low",
      });
      return { detalhe: `diz ser "${r.dados.modelo}"`, tokens: r.usoTokens };
    }),
  );

  // --- 2. aguenta schema aninhado? ---------------------------------------
  if (provas[0].ok) {
    provas.push(
      await medir(
        "schema-aninhado",
        "Array de objetos com campos nulos — o formato real do app",
        async () => {
          const r = await chamarComSchema<{ itens: Array<{ id: number; nome: string; valor: number | null }> }>({
            tarefa,
            system: "Você gera dados de teste.",
            userPrompt:
              "Devolva exatamente 3 itens. O item de id 2 precisa ter valor null; os outros, um número.",
            schema: {
              type: "object",
              properties: {
                itens: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      nome: { type: "string" },
                      valor: { type: ["number", "null"] },
                    },
                    required: ["id", "nome", "valor"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["itens"],
              additionalProperties: false,
            },
            maxTokens: 800,
            esforco: "low",
          });

          const itens = r.dados.itens ?? [];
          const nulo = itens.find((i) => i.id === 2);
          if (itens.length !== 3) {
            throw new Error(`pediu 3 itens, veio ${itens.length}`);
          }
          if (nulo && nulo.valor !== null) {
            throw new Error("não respeitou o campo nulo — reps/duracao vão sair errados");
          }
          return { detalhe: "3 itens, campo nulo respeitado", tokens: r.usoTokens };
        },
      ),
    );
  }

  // --- 3. aguenta o prompt real? -----------------------------------------
  // A prova que decide. Catálogo inteiro no contexto + restrição cruzada
  // de grupo, padrão e equipamento — que é o que o montar-treino faz.
  if (provas[1]?.ok) {
    provas.push(
      await medir(
        "prompt-real",
        "Catálogo de 163 exercícios + escolha com restrição cruzada",
        async () => {
          const catalogo = await carregarCatalogo(supabase, usuario.id);

          const r = await chamarComSchema<{
            escolhidos: Array<{ exercicio_id: number; nome: string }>;
          }>({
            tarefa,
            system:
              "Você escolhe exercícios de musculação APENAS do catálogo fornecido. " +
              "Nunca invente id ou nome. O nome precisa ser copiado exatamente do catálogo.",
            systemCacheavel: catalogoComoTabela(catalogo),
            userPrompt:
              "Escolha 3 exercícios que sejam, ao mesmo tempo: grupo_primario = peito, " +
              "padrao_movimento = empurrar horizontal, e comum = 1.",
            schema: {
              type: "object",
              properties: {
                escolhidos: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      exercicio_id: { type: "integer" },
                      nome: { type: "string" },
                    },
                    required: ["exercicio_id", "nome"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["escolhidos"],
              additionalProperties: false,
            },
            maxTokens: 1500,
            esforco: "medium",
          });

          // Valida contra o catálogo real — é a mesma checagem 2/3 do Prompt 1.
          const erros: string[] = [];
          for (const e of r.dados.escolhidos ?? []) {
            const real = catalogo.porId.get(e.exercicio_id);
            if (!real) {
              erros.push(`id ${e.exercicio_id} não existe (alucinou)`);
              continue;
            }
            if (real.nome !== e.nome) {
              erros.push(`id ${e.exercicio_id} é "${real.nome}", disse "${e.nome}"`);
            }
            if (real.grupo_primario !== "peito" || real.padrao_movimento !== "empurrar horizontal") {
              erros.push(`"${real.nome}" não atende o filtro pedido`);
            }
          }

          if (erros.length > 0) throw new Error(erros.join("; "));
          return {
            detalhe: `${r.dados.escolhidos.length} exercícios, todos conferidos contra o catálogo`,
            tokens: r.usoTokens,
          };
        },
      ),
    );
  }

  const todasPassaram = provas.every((p) => p.ok);
  const passouNaReal = provas.find((p) => p.nome === "prompt-real")?.ok ?? false;

  return json(req, {
    tarefa,
    aprovado: todasPassaram,
    provas,
    veredito: veredito(provas, passouNaReal),
  });
});

function veredito(provas: Prova[], passouNaReal: boolean): string {
  const falhou = provas.find((p) => !p.ok);

  if (!falhou) {
    return "Serve para montar treino. Pode usar em produção.";
  }
  if (falhou.nome === "vivo") {
    return "O provedor não respondeu ou não devolveu JSON. Confira LLM_BASE_URL, LLM_API_KEY e se o host está no ar.";
  }
  if (falhou.nome === "schema-aninhado") {
    return "Responde, mas erra estrutura aninhada e campo nulo. Serve no máximo para extrair-topicos; NÃO use em montar-treino (reps/duração vão sair trocados).";
  }
  if (!passouNaReal) {
    return "Aguenta JSON, mas erra ao escolher com o catálogo inteiro no contexto — alucina id ou ignora filtro. Troque LLM_MONTAR_TREINO_MODELO por um modelo mais forte; os outros usos podem ficar neste.";
  }
  return "Falha parcial — veja as provas.";
}

async function medir(
  nome: string,
  descricao: string,
  corpo: () => Promise<{ detalhe?: string; tokens?: { entrada: number; saida: number } }>,
): Promise<Prova> {
  const t0 = Date.now();
  try {
    const r = await corpo();
    return { nome, descricao, ok: true, ms: Date.now() - t0, ...r };
  } catch (e) {
    const detalhe =
      e instanceof ProvedorIndisponivel
        ? `indisponível: ${e.detalhe}`
        : e instanceof RecusaDoModelo
          ? "o modelo recusou a solicitação"
          : e instanceof Error
            ? e.message
            : String(e);
    return { nome, descricao, ok: false, ms: Date.now() - t0, detalhe };
  }
}
