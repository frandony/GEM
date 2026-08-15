import { extrairErroDeFuncao, supabase } from "./supabase";

/**
 * Duas chamadas separadas, não uma — espelha a decisão do backend
 * (ver supabase/functions/montar-estudo/index.ts): a Fase A estima
 * esforço e o CÓDIGO calcula o ideal (aritmética não vai pra IA); só
 * depois, com a grade que o usuário realmente tem, a Fase B distribui.
 */

export interface Ideal {
  blocos_conteudo: number;
  reserva_revisao: number;
  blocos_necessarios: number;
  minutos_necessarios: number;
  dias_ate_evento: number | null;
  semanas_ate_evento: number | null;
  blocos_por_semana_ideal: number | null;
  cobertura_com_grade_atual: number | null;
  cabe: boolean | null;
  saidas: string[];
  resumo: string;
}

export interface DiagnosticoResultado {
  materia: { id: string; nome: string };
  topicos: Array<{
    id: string;
    nome: string;
    ordem: number;
    blocos_estimados: number | null;
    exige_exercicios: boolean;
    dificuldade: "facil" | "medio" | "dificil" | null;
  }>;
  eventos: Array<{ id: string; tipo: "prova" | "entrega"; data: string; descricao: string | null }>;
  ideal: Ideal;
}

/** Fase A: roda uma vez por matéria (só reestima tópico sem `blocos_estimados`). */
export async function rodarDiagnostico(
  materiaId: string,
  duracaoBlocoMin: number,
): Promise<DiagnosticoResultado> {
  const { data, error } = await supabase.functions.invoke<DiagnosticoResultado>("montar-estudo", {
    body: { fase: "diagnostico", materia_id: materiaId, duracao_bloco_min: duracaoBlocoMin },
  });
  if (error) throw new Error(await extrairErroDeFuncao(error));
  if (!data) throw new Error("resposta vazia do servidor");
  return data;
}

export interface BlocoGerado {
  data: string;
  hora: string;
  duracao_min: number;
  materia_id: string;
  topico_id: string | null;
  evento_id: string | null;
  tipo: "leitura" | "exercicios" | "revisao" | "marco";
  titulo: string;
}

export interface NaoAlocado {
  topico_id: string | null;
  evento_id: string | null;
  motivo: string;
}

export interface DistribuicaoResultado {
  origem: "ia" | "fallback";
  blocos_criados: number;
  blocos: BlocoGerado[];
  nao_alocados: NaoAlocado[];
  avisos: string[];
  motivo?: string;
}

/**
 * Fase B: distribui os tópicos (de todas as matérias ativas) na grade real.
 *
 * `horizonteSemanas` é opcional de propósito: sem ele, o backend deriva o
 * horizonte da prova/entrega mais distante entre as matérias ativas (ver
 * `horizonteDoPlano` em montar-estudo/index.ts) — 2 semanas por padrão
 * quando não há evento cadastrado, até um teto de 6. O front não deve mais
 * cravar um número fixo: era o que deixava a distribuição sempre no caso
 * mais pesado possível, que foi o que estourou o orçamento de tokens da IA
 * em produção. Passe um valor só se a pessoa escolher explicitamente.
 */
export async function rodarDistribuicao(
  semanaInicio: string,
  horizonteSemanas?: number,
): Promise<DistribuicaoResultado> {
  const { data, error } = await supabase.functions.invoke<DistribuicaoResultado>("montar-estudo", {
    body: {
      fase: "distribuicao",
      semana_inicio: semanaInicio,
      ...(horizonteSemanas != null && { horizonte_semanas: horizonteSemanas }),
    },
  });
  if (error) throw new Error(await extrairErroDeFuncao(error));
  if (!data) throw new Error("resposta vazia do servidor");
  return data;
}
