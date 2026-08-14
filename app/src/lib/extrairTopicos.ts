import { supabase } from "./supabase";

/**
 * Cliente da Edge Function `extrair-topicos` (Prompt 3). Nada é gravado
 * do lado do servidor — a resposta alimenta a tela de revisão editável,
 * e só o que a pessoa confirmar lá vai para `salvar_materia_com_topicos`
 * (via `criarMateriaComTopicos` em dados.ts).
 */

export interface TopicoExtraido {
  ordem: number;
  nome: string;
}

export interface DataExtraidaDoPdf {
  descricao: string;
  dataTexto: string;
  tipo: "prova" | "entrega";
}

export interface ExtracaoDeTopicos {
  materiaDetectada: string | null;
  tipoDocumento: string;
  topicos: TopicoExtraido[];
  datasEncontradas: DataExtraidaDoPdf[];
  confianca: "alta" | "media" | "baixa";
  avisos: string[];
}

interface RespostaExtracao {
  materia_detectada: string | null;
  tipo_documento: string;
  topicos: Array<{ ordem: number; nome: string }>;
  datas_encontradas: Array<{ descricao: string; data_texto: string; tipo: "prova" | "entrega" }>;
  confianca: "alta" | "media" | "baixa";
  avisos: string[];
}

export async function extrairTopicosDoTexto(texto: string): Promise<ExtracaoDeTopicos> {
  const { data, error } = await supabase.functions.invoke<RespostaExtracao>("extrair-topicos", {
    body: { texto },
  });
  if (error) throw new Error(await extrairMensagemDeExtracao(error));
  if (!data) throw new Error("resposta vazia do servidor");

  return {
    materiaDetectada: data.materia_detectada,
    tipoDocumento: data.tipo_documento,
    topicos: data.topicos,
    datasEncontradas: data.datas_encontradas.map((d) => ({
      descricao: d.descricao,
      dataTexto: d.data_texto,
      tipo: d.tipo,
    })),
    confianca: data.confianca,
    avisos: data.avisos,
  };
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
