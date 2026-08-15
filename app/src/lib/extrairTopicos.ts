import { supabase } from "./supabase";

/**
 * Cliente da Edge Function `extrair-topicos` (Prompt 3). Nada é gravado
 * do lado do servidor — a resposta alimenta uma tela de revisão editável,
 * e só o que a pessoa confirmar lá vai para `salvar_materia_com_topicos`,
 * uma chamada por matéria confirmada (ver `criarMateriaSimples` em
 * dados.ts).
 *
 * A resposta é sempre uma LISTA de matérias, mesmo quando é só uma —
 * plano de ensino de uma disciplina só vira lista de 1 item; grade
 * curricular ou lista de disciplinas vira vários, cada um com seus
 * próprios tópicos. Um documento não sabe de antemão quantas matérias
 * tem, então o formato não pode fingir que sabe.
 */

/** Bate com o enum `origem_topicos` do banco (migration 02). */
export type OrigemDosTopicos = "pdf" | "manual" | "ia_nome_materia";

/** O que a pessoa está estudando — muda o prompt inteiro no backend, não
    só calibra um detalhe: tópicos de Biologia pro ENEM e os de uma
    graduação em Medicina são listas bem diferentes. */
export type Contexto = "enem" | "faculdade" | "concurso";

export interface TopicoExtraido {
  ordem: number;
  nome: string;
}

export interface DataExtraidaDoPdf {
  descricao: string;
  dataTexto: string;
  tipo: "prova" | "entrega";
}

export interface MateriaExtraida {
  nome: string;
  topicos: TopicoExtraido[];
  datasEncontradas: DataExtraidaDoPdf[];
}

export interface ExtracaoDeTopicos {
  materias: MateriaExtraida[];
  tipoDocumento: string;
  confianca: "alta" | "media" | "baixa";
  avisos: string[];
  origem: OrigemDosTopicos;
}

interface RespostaExtracao {
  materias: Array<{
    nome: string;
    topicos: Array<{ ordem: number; nome: string }>;
    datas_encontradas: Array<{ descricao: string; data_texto: string; tipo: "prova" | "entrega" }>;
  }>;
  tipo_documento: string;
  confianca: "alta" | "media" | "baixa";
  avisos: string[];
  origem: OrigemDosTopicos;
}

export interface OpcoesDeExtracao {
  /** Curso (faculdade) ou nome do concurso — mesmo campo, sentido muda
      com `contexto`. Ignorado quando `contexto === "enem"`. */
  curso?: string;
  periodo?: number | null;
  contexto?: Contexto | null;
}

function corpoComum(opcoes: OpcoesDeExtracao): Record<string, unknown> {
  return {
    // Omitido quando não informado, em vez de mandar null/"": a função
    // valida cada campo e trata ausente como "não informado" — mandar
    // menos é mandar a mesma coisa, com menos chance de divergir.
    ...(opcoes.curso?.trim() ? { curso: opcoes.curso.trim() } : {}),
    ...(opcoes.periodo ? { periodo: opcoes.periodo } : {}),
    ...(opcoes.contexto ? { contexto: opcoes.contexto } : {}),
  };
}

async function chamar(body: Record<string, unknown>): Promise<ExtracaoDeTopicos> {
  const { data, error } = await supabase.functions.invoke<RespostaExtracao>("extrair-topicos", {
    body,
  });
  if (error) throw new Error(await extrairMensagemDeExtracao(error));
  if (!data) throw new Error("resposta vazia do servidor");

  return {
    materias: data.materias.map((m) => ({
      nome: m.nome,
      topicos: m.topicos,
      datasEncontradas: m.datas_encontradas.map((d) => ({
        descricao: d.descricao,
        dataTexto: d.data_texto,
        tipo: d.tipo,
      })),
    })),
    tipoDocumento: data.tipo_documento,
    confianca: data.confianca,
    avisos: data.avisos,
    origem: data.origem,
  };
}

/** `texto` vem de pdf.ts (PDF nativo) ou ocr.ts (foto) — o backend trata
    os dois igual, é só texto daqui em diante. */
export async function extrairTopicosDoTexto(
  texto: string,
  opcoes: OpcoesDeExtracao = {},
): Promise<ExtracaoDeTopicos> {
  return chamar({ texto, ...corpoComum(opcoes) });
}

/**
 * Caminho sem documento nenhum: a IA lista os tópicos que a disciplina
 * costuma cobrir, a partir só do nome (e curso/período/contexto, se
 * informados). O backend distingue os dois modos por ausência de `texto`
 * (`porNome = !corpo.texto && !!corpo.nome_materia`) — **não mandar
 * `texto` aqui é parte do contrato**, não descuido.
 *
 * A função força `confianca: "baixa"` e limpa `datasEncontradas` do lado
 * de lá: isto é ponto de partida editável, nunca verdade sobre a ementa
 * de ninguém — e sempre devolve exatamente 1 matéria, a que foi pedida.
 */
export async function gerarTopicosPeloNome(
  nomeMateria: string,
  opcoes: OpcoesDeExtracao = {},
): Promise<ExtracaoDeTopicos> {
  return chamar({ nome_materia: nomeMateria, ...corpoComum(opcoes) });
}

/**
 * Diferente de `extrairErroDeFuncao` (supabase.ts): esta função separa
 * `mensagem` (texto pra humano) de `erro` (código curto), e na falha de
 * validação de domínio nem tem `mensagem`, só `violacoes`. Preferência:
 * mensagem → violações juntas → código cru.
 */
async function extrairMensagemDeExtracao(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const contexto = (error as { context?: unknown }).context;
    if (contexto instanceof Response) {
      try {
        const corpo = await contexto.clone().json();
        if (typeof corpo?.mensagem === "string") return corpo.mensagem;
        if (Array.isArray(corpo?.violacoes)) return corpo.violacoes.join("; ");
        if (typeof corpo?.erro === "string") return corpo.erro;
      } catch {
        // corpo não é JSON.
      }
    }
  }
  return error instanceof Error ? error.message : "Não deu para ler o arquivo.";
}
