import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";
import { chamarComSchema, RecusaDoModelo } from "../_shared/llm.ts";

/**
 * Prompt 3 — extrair tópicos do plano de ensino.
 *
 * O mais simples dos três, e o que mais depende do que acontece ANTES da
 * chamada. O PDF não vem pra cá como arquivo: o texto é extraído no cliente
 * (pdf.js) e só o texto chega aqui.
 *
 * NADA É GRAVADO. A resposta alimenta a tela de revisão editável, e só o que
 * o usuário confirmar lá vai para `salvar_materia_com_topicos`. Extração de
 * PDF erra; "importado com sucesso" seria mentira.
 */

const SYSTEM = `Você extrai a lista de tópicos de conteúdo de um plano de ensino universitário.

O que extrair:
- Os tópicos de CONTEÚDO da disciplina (ementa, conteúdo programático, unidades).
- O nome da disciplina, se estiver identificável.

O que NÃO extrair:
- Objetivos, competências, metodologia, critérios de avaliação, bibliografia.
- Nomes de professores, códigos de disciplina, carga horária.
- Numeração das unidades: "1.2 Derivadas" vira "Derivadas".

Granularidade: entre 8 e 15 tópicos.
- Se o documento listar 40 subitens, agrupe nos temas maiores.
- Se listar 3 unidades muito amplas, quebre em subtemas identificáveis no texto.
- Cada tópico cabe em uma frase curta e é estudável isoladamente.

Ordem: preserve a ordem do documento. Ela costuma refletir pré-requisitos, e é
o que o planejamento usa para sequenciar.

Datas: se o documento trouxer cronograma com datas de prova ou entrega, liste
em "datas_encontradas". NUNCA as trate como fato — são sugestões a confirmar.

Se o texto não for um plano de ensino, devolva topicos vazio e preencha
tipo_documento com o que você identificou.`;

const SCHEMA = {
  type: "object",
  properties: {
    materia_detectada: { type: ["string", "null"] },
    tipo_documento: { type: "string" },
    topicos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ordem: { type: "integer" },
          nome: { type: "string" },
        },
        required: ["ordem", "nome"],
        additionalProperties: false,
      },
    },
    datas_encontradas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          data_texto: { type: "string" },
          tipo: { type: "string", enum: ["prova", "entrega"] },
        },
        required: ["descricao", "data_texto", "tipo"],
        additionalProperties: false,
      },
    },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
  },
  required: [
    "materia_detectada",
    "tipo_documento",
    "topicos",
    "datas_encontradas",
    "confianca",
  ],
  additionalProperties: false,
} as const;

interface Extracao {
  materia_detectada: string | null;
  tipo_documento: string;
  topicos: Array<{ ordem: number; nome: string }>;
  datas_encontradas: Array<{ descricao: string; data_texto: string; tipo: string }>;
  confianca: "alta" | "media" | "baixa";
}

const MIN_CARACTERES = 200;
const MAX_CARACTERES = 15_000;

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
  if (!(await usuarioAtual(supabase))) return erro(req, "não autenticado", 401);

  let corpo: { texto?: string; nome_materia?: string; curso?: string };
  try {
    corpo = await req.json();
  } catch {
    return erro(req, "corpo inválido");
  }

  const porNome = !corpo.texto && !!corpo.nome_materia;

  // ------------------------------------------------------------------
  // PDF escaneado é o caso real e frequente — professor que fotocopiou o
  // plano. Chamar a IA com texto vazio gasta token e devolve alucinação.
  // ------------------------------------------------------------------
  if (!porNome) {
    const texto = (corpo.texto ?? "").trim();
    if (texto.length < MIN_CARACTERES) {
      return json(
        req,
        {
          erro: "texto_insuficiente",
          mensagem:
            "Quase não veio texto do arquivo — provavelmente é um PDF escaneado (imagem). Digite os tópicos manualmente.",
          caracteres: texto.length,
        },
        422,
      );
    }
  }

  try {
    const userPrompt = porNome
      ? `Liste os tópicos de conteúdo tipicamente cobertos na disciplina "${corpo.nome_materia}"` +
        (corpo.curso ? ` em um curso de graduação em ${corpo.curso}, no Brasil.` : ", no Brasil.") +
        `\nEntre 8 e 15 tópicos, na ordem usual de ensino.` +
        `\nEsta resposta não vem de documento nenhum: use confianca "baixa",` +
        ` tipo_documento "gerado_por_nome" e datas_encontradas vazio.`
      : `TEXTO EXTRAÍDO DO PDF:\n"""\n${cortar(corpo.texto!)}\n"""`;

    const { dados, usoTokens } = await chamarComSchema<Extracao>({
      tarefa: "extrair-topicos",
      system: SYSTEM,
      userPrompt,
      schema: SCHEMA as unknown as Record<string, unknown>,
      prazoFinal,
      esforco: "medium",
      maxTokens: 4000,
    });

    // A variante "gerar pelo nome" é ponto de partida editável, nunca verdade.
    // A confiança é forçada aqui — não fica a critério do modelo.
    if (porNome) {
      dados.confianca = "baixa";
      dados.datas_encontradas = [];
    }

    const { erros, avisos } = validar(dados);
    if (erros.length > 0) {
      return json(req, { erro: "extracao_invalida", violacoes: erros }, 422);
    }

    return json(req, {
      ...dados,
      origem: porNome ? "ia_nome_materia" : "pdf",
      avisos,
      uso_tokens: usoTokens,
      // Nada foi gravado. A tela seguinte é lista editável, e só o que o
      // usuário confirmar vai para salvar_materia_com_topicos.
      gravado: false,
    });
  } catch (e) {
    const motivo =
      e instanceof RecusaDoModelo
        ? "o modelo recusou a solicitação"
        : e instanceof Error
          ? e.message
          : "erro desconhecido";
    console.error("extrair-topicos falhou:", motivo, e);
    // Sem fallback automático, diferente dos prompts 1 e 2: não existe
    // "plano de ensino genérico" que faça sentido. O caminho é a digitação
    // manual, que já é uma das três entradas previstas.
    return json(
      req,
      {
        erro: "extracao_falhou",
        mensagem: "Não deu pra ler o arquivo. Digite os tópicos manualmente.",
        motivo,
      },
      502,
    );
  }
});

function validar(d: Extracao): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];

  // --- 2. entre 0 e 25 tópicos -----------------------------------------
  if (d.topicos.length > 25) {
    erros.push(`vieram ${d.topicos.length} tópicos; o máximo é 25`);
  }

  // --- 3. nenhum duplicado (comparação sem acento e sem numeração) ------
  const vistos = new Set<string>();
  for (const t of d.topicos) {
    const chave = normalizar(t.nome);
    if (vistos.has(chave)) erros.push(`tópico duplicado: "${t.nome}"`);
    vistos.add(chave);

    // --- 4. entre 3 e 120 caracteres -----------------------------------
    const n = t.nome.trim().length;
    if (n < 3 || n > 120) {
      erros.push(`"${t.nome}" tem ${n} caracteres; o intervalo é 3 a 120`);
    }
  }

  // --- 5. ordem sequencial a partir de 1, sem buracos -------------------
  const ordens = d.topicos.map((t) => t.ordem).sort((a, b) => a - b);
  for (let i = 0; i < ordens.length; i++) {
    if (ordens[i] !== i + 1) {
      erros.push("o campo ordem precisa ser sequencial a partir de 1, sem buracos");
      break;
    }
  }

  // --- 6 e 7: avisos ----------------------------------------------------
  if (d.topicos.length > 0 && (d.topicos.length < 8 || d.topicos.length > 15)) {
    avisos.push(
      `${d.topicos.length} tópicos — o ideal é entre 8 e 15. Vale agrupar ou dividir na revisão.`,
    );
  }
  if (d.tipo_documento !== "plano_de_ensino" && d.tipo_documento !== "gerado_por_nome") {
    avisos.push(
      `o documento parece ser "${d.tipo_documento}", não um plano de ensino — confira a lista com atenção`,
    );
  }
  if (d.confianca === "baixa") {
    avisos.push("confiança baixa: trate a lista como rascunho e revise item a item");
  }

  return { erros, avisos };
}

/** Sem acento e sem numeração — "1.2 Derivadas" e "Derivadas" são o mesmo tópico. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de combinação (acentos)
    .replace(/^\s*[\d.]+\s*/, "")
    .trim()
    .toLowerCase();
}

/**
 * Documento muito longo: corta pelas seções de ementa/conteúdo em vez de
 * truncar no meio de uma frase.
 */
function cortar(texto: string): string {
  if (texto.length <= MAX_CARACTERES) return texto;

  const marcadores = /(ementa|conte[úu]do program[áa]tico|unidades|programa da disciplina)/i;
  const inicio = texto.search(marcadores);
  const base = inicio >= 0 ? texto.slice(inicio) : texto;

  if (base.length <= MAX_CARACTERES) return base;

  const corte = base.slice(0, MAX_CARACTERES);
  const ultimaQuebra = corte.lastIndexOf("\n");
  return ultimaQuebra > MAX_CARACTERES * 0.8 ? corte.slice(0, ultimaQuebra) : corte;
}
