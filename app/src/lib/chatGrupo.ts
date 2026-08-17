import { supabase } from "./supabase";
import { novoId } from "./fila";

export interface MensagemGrupo {
  id: string;
  grupoId: string;
  autorId: string;
  autorNome: string;
  autorFotoUrl: string | null;
  texto: string;
  criadoEm: string;
}

/** Mesmo padrão de `carregarFeedDoGrupo`: embed `profiles(...)` funciona
    porque `mensagens_grupo.autor_id` referencia `profiles(id)` direto
    (não `auth.users`, que o PostgREST não atravessa). */
export async function carregarMensagens(grupoId: string): Promise<MensagemGrupo[]> {
  const { data, error } = await supabase
    .from("mensagens_grupo")
    .select("id,grupo_id,autor_id,texto,criado_em,profiles(nome,foto_url)")
    .eq("grupo_id", grupoId)
    .order("criado_em", { ascending: true })
    .returns<
      Array<{
        id: string;
        grupo_id: string;
        autor_id: string;
        texto: string;
        criado_em: string;
        profiles: { nome: string; foto_url: string | null } | null;
      }>
    >();
  if (error) throw new Error(`não deu para carregar o chat: ${error.message}`);

  return (data ?? []).map((m) => ({
    id: m.id,
    grupoId: m.grupo_id,
    autorId: m.autor_id,
    autorNome: m.profiles?.nome ?? "Alguém",
    autorFotoUrl: m.profiles?.foto_url ?? null,
    texto: m.texto,
    criadoEm: m.criado_em,
  }));
}

/** Id gerado no cliente (mesmo padrão de `criarPost`), insert direto e
    aguardado — sem fila offline (`fila.ts`): chat é conteúdo efêmero, não
    dado de progresso que precise sobreviver a uma queda de rede. */
export async function enviarMensagem(
  grupoId: string,
  autorId: string,
  autorNome: string,
  autorFotoUrl: string | null,
  texto: string,
): Promise<MensagemGrupo> {
  const textoLimpo = texto.trim();
  if (!textoLimpo) throw new Error("Escreva algo antes de enviar.");
  if (textoLimpo.length > 2000) throw new Error("Mensagem muito longa (máx. 2000 caracteres).");

  const id = novoId();
  const { error } = await supabase.from("mensagens_grupo").insert({
    id,
    grupo_id: grupoId,
    autor_id: autorId,
    texto: textoLimpo,
  });
  if (error) throw new Error(`não deu para enviar a mensagem: ${error.message}`);

  return {
    id,
    grupoId,
    autorId,
    autorNome,
    autorFotoUrl,
    texto: textoLimpo,
    criadoEm: new Date().toISOString(),
  };
}

/** RLS garante que só o autor consegue. Sem confirmação de dois passos —
    mesmo nível de risco que `excluirPost`. */
export async function excluirMensagem(id: string): Promise<void> {
  const { error } = await supabase.from("mensagens_grupo").delete().eq("id", id);
  if (error) throw new Error(`não deu para excluir a mensagem: ${error.message}`);
}
