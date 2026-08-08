/**
 * O cálculo do ideal. CÓDIGO, nunca IA.
 *
 * Este é o número que o usuário usa pra decidir quantos dias consegue estudar.
 * Precisa ser verificável e igual em toda execução — por isso não vai pro
 * modelo, que erra conta e varia entre chamadas.
 *
 *   blocos_necessarios = soma(estimativas) + reserva_revisao
 *   reserva_revisao    = teto(soma × 0.2)
 *   dias_ate_evento    = data_evento − hoje
 *   blocos_por_semana  = blocos_necessarios ÷ (dias_ate_evento ÷ 7)
 */

export interface EntradaCalculo {
  topicos: Array<{ id: string; nome: string; blocos: number }>;
  duracaoBlocoMin: number;
  dataEvento: string | null;
  /** Blocos/semana da grade que o usuário já tem, se tiver. */
  gradeAtual: number | null;
}

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

export function calcularIdeal(e: EntradaCalculo): Ideal {
  const blocosConteudo = e.topicos.reduce((s, t) => s + Math.max(1, t.blocos), 0);
  const reserva = Math.ceil(blocosConteudo * 0.2);
  const necessarios = blocosConteudo + reserva;
  const minutos = necessarios * e.duracaoBlocoMin;

  if (!e.dataEvento) {
    return {
      blocos_conteudo: blocosConteudo,
      reserva_revisao: reserva,
      blocos_necessarios: necessarios,
      minutos_necessarios: minutos,
      dias_ate_evento: null,
      semanas_ate_evento: null,
      blocos_por_semana_ideal: null,
      cobertura_com_grade_atual: null,
      cabe: null,
      saidas: [],
      resumo:
        `Cobrir os ${e.topicos.length} tópicos leva ${necessarios} blocos ` +
        `(${formatarHoras(minutos)}). Sem data marcada, não dá pra dizer o ritmo.`,
    };
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const evento = new Date(`${e.dataEvento}T00:00:00`);
  const dias = Math.max(
    0,
    Math.round((evento.getTime() - hoje.getTime()) / 86_400_000),
  );
  // Mínimo de 1 semana: dividir por zero (ou por 0.3) devolve número absurdo.
  const semanas = Math.max(1, dias / 7);
  const porSemanaIdeal = Math.ceil(necessarios / semanas);

  let cobertura: number | null = null;
  let cabe: boolean | null = null;
  const saidas: string[] = [];

  if (e.gradeAtual != null && e.gradeAtual > 0) {
    const capacidade = Math.floor(e.gradeAtual * semanas);
    cobertura = Math.min(1, capacidade / necessarios);
    cabe = capacidade >= necessarios;

    if (!cabe) {
      // Nunca espremer silenciosamente um plano de 6h/dia. As saídas são
      // explícitas, e é o usuário que escolhe.
      const faltam = porSemanaIdeal - e.gradeAtual;
      saidas.push(
        `adicionar horários — ${faltam} bloco${faltam > 1 ? "s" : ""} a mais por semana fecha a conta`,
        "priorizar tópicos — escolher o que entra e o que fica de fora",
        `aceitar cobertura parcial — com ${e.gradeAtual} blocos/semana você cobre ${Math.round(cobertura * 100)}% do conteúdo`,
        "reduzir profundidade — menos blocos por tópico, cobrindo tudo mais raso",
      );
    }
  }

  return {
    blocos_conteudo: blocosConteudo,
    reserva_revisao: reserva,
    blocos_necessarios: necessarios,
    minutos_necessarios: minutos,
    dias_ate_evento: dias,
    semanas_ate_evento: Number(semanas.toFixed(1)),
    blocos_por_semana_ideal: porSemanaIdeal,
    cobertura_com_grade_atual: cobertura,
    cabe,
    saidas,
    resumo:
      `Pra cobrir os ${e.topicos.length} tópicos até ${formatarData(e.dataEvento)} ` +
      `você precisaria de ${porSemanaIdeal} bloco${porSemanaIdeal > 1 ? "s" : ""} por semana ` +
      `de ${e.duracaoBlocoMin} min` +
      (cobertura != null && cabe === false
        ? `. Com o que você tem hoje, cobre ${Math.round(cobertura * 100)}%.`
        : "."),
  };
}

function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function formatarData(iso: string): string {
  const [, mes, dia] = iso.split("-");
  const meses = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${dia}/${meses[Number(mes) - 1] ?? mes}`;
}
