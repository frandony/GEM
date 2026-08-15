import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";
import { chamarComSchema, RecusaDoModelo } from "../_shared/llm.ts";

/**
 * Prompt 3 — extrair tópicos de um documento de estudo.
 *
 * O documento não vem pra cá como arquivo: o texto é extraído no cliente
 * (pdf.js pra PDF, OCR no navegador pra foto) e só o texto chega aqui.
 *
 * Devolve uma LISTA de matérias, não uma só. Um plano de ensino normal vira
 * lista de 1 item; uma grade curricular ou lista de disciplinas vira várias
 * — cada uma com seus próprios tópicos. É a mesma extração pros dois casos,
 * só muda quantos itens saem.
 *
 * NADA É GRAVADO. A resposta alimenta a tela de revisão editável, e só o
 * que o usuário confirmar lá vai para `salvar_materia_com_topicos` (uma
 * chamada por matéria confirmada). Extração erra; "importado com sucesso"
 * seria mentira.
 */

const SYSTEM = `Você extrai tópicos de conteúdo de documentos de estudo — pode ser o plano de ensino de UMA disciplina, ou uma grade curricular/lista com VÁRIAS disciplinas no mesmo documento.

Primeiro decida quantas matérias o documento contém:
- Plano de ensino de uma disciplina só → 1 item em "materias".
- Grade curricular, ementa de período, ou lista de disciplinas → 1 item POR disciplina distinta, cada um com nome e tópicos próprios.
- Não invente disciplina que não está no documento.

Para cada matéria, o que extrair:
- Os tópicos de CONTEÚDO (ementa, conteúdo programático, unidades) — específicos DAQUELA disciplina, não misturados com os de outra.
- O nome da disciplina.

O que NÃO extrair:
- Objetivos, competências, metodologia, critérios de avaliação, bibliografia.
- Nomes de professores, códigos de disciplina, carga horária.
- Numeração das unidades: "1.2 Derivadas" vira "Derivadas".

Granularidade por matéria: entre 8 e 15 tópicos.
- Se a matéria tiver poucos tópicos no documento (comum em grade curricular, que às vezes só lista o NOME da disciplina), COMPLEMENTE com os tópicos que essa disciplina costuma cobrir. Use curso/período/ENEM informados no pedido, quando houver, pra calibrar profundidade e pré-requisitos — a mesma disciplina muda de conteúdo conforme o momento do curso.
- Se o documento listar 40 subitens pra uma disciplina, agrupe nos temas maiores.
- Cada tópico cabe em uma frase curta e é estudável isoladamente.

Ordem: preserve a ordem do documento, dentro de cada matéria.

Datas: se o documento trouxer cronograma com datas de prova ou entrega, associe cada data à matéria correta em "datas_encontradas". NUNCA as trate como fato — são sugestões a confirmar.

tipo_documento: descreva o que você identificou — "plano_de_ensino" pra uma disciplina, "grade_curricular" pra várias, ou o que for o caso.

Se o texto não for um documento de estudo, devolva materias vazio.`;

const SCHEMA = {
  type: "object",
  properties: {
    materias: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string" },
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
        },
        required: ["nome", "topicos", "datas_encontradas"],
        additionalProperties: false,
      },
    },
    tipo_documento: { type: "string" },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
  },
  required: ["materias", "tipo_documento", "confianca"],
  additionalProperties: false,
} as const;

interface MateriaExtraida {
  nome: string;
  topicos: Array<{ ordem: number; nome: string }>;
  datas_encontradas: Array<{ descricao: string; data_texto: string; tipo: string }>;
}

interface Extracao {
  materias: MateriaExtraida[];
  tipo_documento: string;
  confianca: "alta" | "media" | "baixa";
}

const MIN_CARACTERES = 200;
const MAX_CARACTERES = 15_000;
const MAX_MATERIAS = 15;

/**
 * Teto de tempo para a IA, menor que o wall clock do runtime (150s no
 * plano free). O que sobra e a reserva para responder de verdade — sem
 * isso a funcao e morta no meio e o cliente recebe "non-2xx" sem corpo.
 * Ver o bloco "Prazo" em _shared/llm.ts.
 */
const ORCAMENTO_IA_MS = Number(Deno.env.get("LLM_ORCAMENTO_MS") ?? 110_000);

type Contexto = "enem" | "faculdade" | "concurso";

Deno.serve(async (req: Request) => {
  const prazoFinal = Date.now() + ORCAMENTO_IA_MS;
  if (req.method === "OPTIONS") return respostaOptions(req);
  if (req.method !== "POST") return erro(req, "método não suportado", 405);

  const supabase = clienteDoUsuario(req);
  if (!(await usuarioAtual(supabase))) return erro(req, "não autenticado", 401);

  let corpo: {
    texto?: string;
    nome_materia?: string;
    curso?: string;
    /** Semestre do curso (1 a 12). Muda a PROFUNDIDADE esperada: "Cálculo"
        no 1º período é limite e derivada; no 3º pode ser várias variáveis. */
    periodo?: number;
    /** O que a pessoa está estudando — muda o prompt inteiro, não só um
        detalhe: "tópicos de Biologia pro ENEM" e "tópicos de Biologia
        numa graduação em Medicina" são listas bem diferentes. */
    contexto?: string;
  };
  try {
    corpo = await req.json();
  } catch {
    return erro(req, "corpo inválido");
  }

  const porNome = !corpo.texto && !!corpo.nome_materia;

  // ------------------------------------------------------------------
  // PDF/foto sem texto suficiente é o caso real e frequente — documento
  // fotocopiado, foto torta, ou OCR que não pegou nada. Chamar a IA com
  // texto vazio gasta token e devolve alucinação.
  // ------------------------------------------------------------------
  if (!porNome) {
    const texto = (corpo.texto ?? "").trim();
    if (texto.length < MIN_CARACTERES) {
      return json(
        req,
        {
          erro: "texto_insuficiente",
          mensagem:
            "Quase não veio texto do documento — a foto pode estar tremida/escura, ou é um PDF escaneado sem OCR. Tente de novo com mais luz, ou digite os tópicos manualmente.",
          caracteres: texto.length,
        },
        422,
      );
    }
  }

  // Número validado, nunca string interpolada: `periodo` entra no prompt,
  // e aqui a defesa é barata — fora da faixa vira "não informado" em vez
  // de virar texto arbitrário no meio das instruções.
  const periodo =
    typeof corpo.periodo === "number" &&
      Number.isInteger(corpo.periodo) &&
      corpo.periodo >= 1 &&
      corpo.periodo <= 12
      ? corpo.periodo
      : null;
  // `curso` é texto livre do usuário — dobra como "concurso" quando
  // contexto for esse (o front reaproveita o mesmo campo, só troca o
  // rótulo). Cortar evita que um colar acidental de página inteira
  // empurre as instruções para fora da janela.
  const curso = corpo.curso?.trim().slice(0, 120) || null;
  const contexto: Contexto | null =
    corpo.contexto === "enem" || corpo.contexto === "faculdade" || corpo.contexto === "concurso"
      ? corpo.contexto
      : null;

  try {
    const userPrompt = porNome
      ? promptPorNome(corpo.nome_materia!, curso, periodo, contexto)
      : promptDoTexto(corpo.texto!, curso, periodo, contexto);

    const { dados, usoTokens } = await chamarComSchema<Extracao>({
      tarefa: "extrair-topicos",
      system: SYSTEM,
      userPrompt,
      schema: SCHEMA as unknown as Record<string, unknown>,
      prazoFinal,
      esforco: "medium",
      maxTokens: 6000,
    });

    // A variante "gerar pelo nome" é ponto de partida editável, nunca
    // verdade — e sempre UMA matéria, a que a pessoa digitou. A confiança
    // é forçada aqui, não fica a critério do modelo.
    if (porNome) {
      dados.confianca = "baixa";
      dados.materias = dados.materias.map((m) => ({ ...m, datas_encontradas: [] }));
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
      // Nada foi gravado. A tela seguinte é lista editável por matéria, e
      // só o que o usuário confirmar vai para salvar_materia_com_topicos
      // — uma chamada por matéria confirmada.
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
    // manual, que já é uma das entradas previstas.
    return json(
      req,
      {
        erro: "extracao_falhou",
        mensagem: "Não deu pra ler o documento. Digite os tópicos manualmente.",
        motivo,
      },
      502,
    );
  }
});

function rotuloDoContexto(contexto: Contexto | null, curso: string | null): string {
  if (contexto === "enem") return "para quem está se preparando para o ENEM (Exame Nacional do Ensino Médio), no Brasil";
  if (contexto === "concurso") {
    return curso ? `para o concurso público de ${curso}, no Brasil` : "para concursos públicos, no Brasil";
  }
  return curso ? `em um curso de graduação em ${curso}, no Brasil` : "em um curso de graduação, no Brasil";
}

function promptPorNome(
  nome: string,
  curso: string | null,
  periodo: number | null,
  contexto: Contexto | null,
): string {
  return (
    `Liste os tópicos de conteúdo tipicamente cobertos na disciplina "${nome}" ${rotuloDoContexto(contexto, curso)}.` +
    (periodo && contexto !== "enem"
      ? `\nCursada no ${periodo}º período (semestre) — ajuste a profundidade a isso.`
      : "") +
    `\nDevolva exatamente 1 item em "materias", com entre 8 e 15 tópicos, na ordem usual de ensino.` +
    `\nEsta resposta não vem de documento nenhum: use confianca "baixa" e tipo_documento "gerado_por_nome".`
  );
}

function promptDoTexto(
  texto: string,
  curso: string | null,
  periodo: number | null,
  contexto: Contexto | null,
): string {
  let contextoTexto = "";
  if (contexto === "enem") {
    contextoTexto = "\nContexto informado pela pessoa: está se preparando para o ENEM — complemente tópicos faltantes pensando nesse nível, não no de graduação.";
  } else if (contexto === "concurso") {
    contextoTexto = `\nContexto informado pela pessoa: estudando para concurso${curso ? ` (${curso})` : ""} — complemente tópicos faltantes pensando nesse nível.`;
  } else if (contexto === "faculdade" || curso || periodo) {
    contextoTexto =
      `\nContexto informado pela pessoa: curso de graduação${curso ? ` em ${curso}` : ""}` +
      `${periodo ? `, ${periodo}º período` : ""} — complemente tópicos faltantes e calibre a profundidade a isso.`;
  }

  return (
    `TEXTO EXTRAÍDO DO DOCUMENTO (PDF ou foto via OCR — pode conter uma ou várias disciplinas):\n"""\n${cortar(texto)}\n"""` +
    contextoTexto
  );
}

function validar(d: Extracao): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];

  if (d.materias.length > MAX_MATERIAS) {
    erros.push(`vieram ${d.materias.length} matérias; o máximo é ${MAX_MATERIAS} — divida o documento`);
  }

  const nomesVistos = new Set<string>();
  for (const m of d.materias) {
    const nomeChave = normalizar(m.nome);
    if (nomesVistos.has(nomeChave)) erros.push(`matéria duplicada: "${m.nome}"`);
    nomesVistos.add(nomeChave);

    const nNome = m.nome.trim().length;
    if (nNome < 1 || nNome > 80) {
      erros.push(`nome de matéria "${m.nome}" tem ${nNome} caracteres; o intervalo é 1 a 80`);
    }

    // --- entre 0 e 25 tópicos por matéria ---------------------------
    if (m.topicos.length > 25) {
      erros.push(`"${m.nome}" veio com ${m.topicos.length} tópicos; o máximo é 25`);
    }

    // --- nenhum tópico duplicado (comparação sem acento/numeração) --
    const vistos = new Set<string>();
    for (const t of m.topicos) {
      const chave = normalizar(t.nome);
      if (vistos.has(chave)) erros.push(`tópico duplicado em "${m.nome}": "${t.nome}"`);
      vistos.add(chave);

      const n = t.nome.trim().length;
      if (n < 3 || n > 120) {
        erros.push(`"${t.nome}" (em "${m.nome}") tem ${n} caracteres; o intervalo é 3 a 120`);
      }
    }

    // --- ordem sequencial a partir de 1, sem buracos -----------------
    const ordens = m.topicos.map((t) => t.ordem).sort((a, b) => a - b);
    for (let i = 0; i < ordens.length; i++) {
      if (ordens[i] !== i + 1) {
        erros.push(`em "${m.nome}", o campo ordem precisa ser sequencial a partir de 1, sem buracos`);
        break;
      }
    }

    if (m.topicos.length > 0 && (m.topicos.length < 8 || m.topicos.length > 15)) {
      avisos.push(`"${m.nome}": ${m.topicos.length} tópicos — o ideal é entre 8 e 15.`);
    }
  }

  if (
    d.tipo_documento !== "plano_de_ensino" &&
    d.tipo_documento !== "grade_curricular" &&
    d.tipo_documento !== "gerado_por_nome"
  ) {
    avisos.push(
      `o documento parece ser "${d.tipo_documento}" — confira a lista com atenção`,
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

  const marcadores = /(ementa|conte[úu]do program[áa]tico|unidades|programa da disciplina|grade curricular)/i;
  const inicio = texto.search(marcadores);
  const base = inicio >= 0 ? texto.slice(inicio) : texto;

  if (base.length <= MAX_CARACTERES) return base;

  const corte = base.slice(0, MAX_CARACTERES);
  const ultimaQuebra = corte.lastIndexOf("\n");
  return ultimaQuebra > MAX_CARACTERES * 0.8 ? corte.slice(0, ultimaQuebra) : corte;
}
