import { supabase } from "./supabase";
import { carregarGruposDoUsuario, carregarPerfil, carregarPerfilTreino, carregarPlanoCompleto } from "./dados";

/**
 * Backup pessoal — um JSON com tudo que o usuário vê no app. Cada tabela
 * é filtrada por `user_id`/dono, mas a RLS já garante isso de qualquer
 * forma: mesmo que uma cláusula aqui estivesse errada, o Postgres nunca
 * devolveria linha de outra pessoa.
 *
 * `select("*")` de propósito, sem lista de colunas: isto é "exportar o
 * que existe", não uma tela — não vale manter em dia com cada migration
 * que adiciona campo.
 */
export async function exportarDadosDoUsuario(userId: string): Promise<Record<string, unknown>> {
  const [perfil, perfilTreino, plano, treinoSessoes, seriesRegistros, materias, blocos, grade, limites, grupos] =
    await Promise.all([
      carregarPerfil(userId),
      carregarPerfilTreino(userId),
      carregarPlanoCompleto(userId),
      supabase.from("treino_sessoes").select("*").eq("user_id", userId).order("data", { ascending: true }),
      supabase
        .from("series_registros")
        .select("*")
        .eq("user_id", userId)
        .order("registrada_em", { ascending: true }),
      supabase.from("materias").select("*, topicos(*), eventos(*)").eq("user_id", userId),
      supabase.from("blocos").select("*").eq("user_id", userId).order("data", { ascending: true }),
      supabase.from("grade_slots").select("*").eq("user_id", userId),
      supabase.from("limites_estudo").select("*").eq("user_id", userId).maybeSingle(),
      carregarGruposDoUsuario(userId),
    ]);

  return {
    exportado_em: new Date().toISOString(),
    perfil,
    perfil_treino: perfilTreino,
    plano_de_treino: plano,
    historico_de_treino: {
      sessoes: treinoSessoes.data ?? [],
      series: seriesRegistros.data ?? [],
    },
    materias: materias.data ?? [],
    blocos_de_estudo: blocos.data ?? [],
    grade_de_horarios: grade.data ?? [],
    limites_de_estudo: limites.data ?? null,
    grupos,
  };
}

/** Baixa um objeto como arquivo `.json` — sem servidor, tudo no navegador. */
export function baixarComoJson(dados: unknown, nomeArquivo: string) {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
