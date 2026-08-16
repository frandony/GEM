import { supabase } from "./supabase";
import { novoId } from "./fila";

export type TagPost = "treino" | "estudo" | "dica" | "refeição";
export type Reacao = "🔥" | "💪" | "📚" | "✅";

export interface PostDoGrupo {
  id: string;
  grupoId: string;
  autorId: string;
  autorNome: string;
  autorFotoUrl: string | null;
  /** Caminho no storage — precisa dele (não só da URL assinada) pra
      excluir o arquivo depois. */
  fotoPath: string;
  /** URL assinada (bucket privado) — null se a assinatura falhou. */
  fotoUrl: string | null;
  legenda: string | null;
  tag: TagPost;
  criadoEm: string;
  minhaReacao: Reacao | null;
}

const BUCKET = "posts-grupo";
const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/webp"];
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024;
/** URL assinada dura 1h — expira só numa sessão aberta e parada por muito
    tempo com F5, não durante o uso normal do feed. */
const VALIDADE_URL_SEG = 3600;

function caminhoDaFoto(grupoId: string, autorId: string, postId: string): string {
  return `${grupoId}/${autorId}/${postId}`;
}

/**
 * Posts do grupo + a própria reação de cada um + URLs assinadas das
 * fotos, todas numa chamada só (`createSignedUrls`, não uma por post —
 * evita N+1). O bucket é privado de propósito: foto de post é só pra
 * quem tá no grupo, diferente do avatar (público).
 */
export async function carregarFeedDoGrupo(grupoId: string, userId: string): Promise<PostDoGrupo[]> {
  const { data: posts, error } = await supabase
    .from("posts_grupo")
    .select("id,grupo_id,autor_id,foto_path,legenda,tag,criado_em,profiles(nome,foto_url)")
    .eq("grupo_id", grupoId)
    .order("criado_em", { ascending: false })
    .returns<
      Array<{
        id: string;
        grupo_id: string;
        autor_id: string;
        foto_path: string;
        legenda: string | null;
        tag: TagPost;
        criado_em: string;
        profiles: { nome: string; foto_url: string | null } | null;
      }>
    >();
  if (error) throw new Error(`não deu para carregar o feed: ${error.message}`);
  if (!posts?.length) return [];

  const ids = posts.map((p) => p.id);
  const [{ data: reacoes }, assinadas] = await Promise.all([
    supabase.from("post_reacoes").select("post_id,emoji").eq("user_id", userId).in("post_id", ids),
    supabase.storage.from(BUCKET).createSignedUrls(
      posts.map((p) => p.foto_path),
      VALIDADE_URL_SEG,
    ),
  ]);

  const reacaoPorPost = new Map((reacoes ?? []).map((r) => [r.post_id, r.emoji as Reacao]));
  const urlPorIndice = assinadas.data ?? [];

  return posts.map((p, i) => ({
    id: p.id,
    grupoId: p.grupo_id,
    autorId: p.autor_id,
    autorNome: p.profiles?.nome ?? "Alguém",
    autorFotoUrl: p.profiles?.foto_url ?? null,
    fotoPath: p.foto_path,
    fotoUrl: urlPorIndice[i]?.signedUrl ?? null,
    legenda: p.legenda,
    tag: p.tag,
    criadoEm: p.criado_em,
    minhaReacao: reacaoPorPost.get(p.id) ?? null,
  }));
}

/** Sobe a foto e grava o post. Id gerado no cliente (mesmo padrão do
    resto do app) — o caminho da foto usa esse mesmo id, então os dois
    nascem juntos e nunca ficam órfãos um do outro. */
export async function criarPost(
  grupoId: string,
  autorId: string,
  autorNome: string,
  autorFotoUrl: string | null,
  arquivo: File,
  legenda: string,
  tag: TagPost,
): Promise<PostDoGrupo> {
  if (!TIPOS_PERMITIDOS.includes(arquivo.type)) {
    throw new Error("Envie uma imagem PNG, JPEG ou WEBP.");
  }
  if (arquivo.size > TAMANHO_MAX_BYTES) {
    throw new Error("A imagem precisa ter até 5 MB.");
  }

  const id = novoId();
  const caminho = caminhoDaFoto(grupoId, autorId, id);
  const legendaLimpa = legenda.trim() || null;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, arquivo, { contentType: arquivo.type });
  if (erroUpload) throw new Error(`não deu para enviar a foto: ${erroUpload.message}`);

  const { error: erroInsert } = await supabase.from("posts_grupo").insert({
    id,
    grupo_id: grupoId,
    autor_id: autorId,
    foto_path: caminho,
    legenda: legendaLimpa,
    tag,
  });
  if (erroInsert) throw new Error(`não deu para publicar o post: ${erroInsert.message}`);

  const { data: assinada } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, VALIDADE_URL_SEG);

  return {
    id,
    grupoId,
    autorId,
    autorNome,
    autorFotoUrl,
    fotoPath: caminho,
    fotoUrl: assinada?.signedUrl ?? null,
    legenda: legendaLimpa,
    tag,
    criadoEm: new Date().toISOString(),
    minhaReacao: null,
  };
}

/** `emoji: null` remove a reação — é o "tocar de novo na mesma" do
    componente. Uma reação por pessoa por post: trocar de emoji é upsert
    na mesma linha, não uma segunda reação empilhada. */
export async function definirReacao(
  postId: string,
  userId: string,
  emoji: Reacao | null,
): Promise<void> {
  if (emoji === null) {
    const { error } = await supabase
      .from("post_reacoes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);
    if (error) throw new Error(`não deu para remover a reação: ${error.message}`);
    return;
  }

  const { error } = await supabase
    .from("post_reacoes")
    .upsert({ post_id: postId, user_id: userId, emoji }, { onConflict: "post_id,user_id" });
  if (error) throw new Error(`não deu para reagir: ${error.message}`);
}

/** Apaga a linha (RLS garante que só o autor consegue) e tenta apagar o
    arquivo do storage — falha aqui só loga, mesma doutrina de
    `removerFotoPerfil`: o que a pessoa vê (o post sumiu) já ficou certo. */
export async function excluirPost(postId: string, fotoPath: string): Promise<void> {
  const { error } = await supabase.from("posts_grupo").delete().eq("id", postId);
  if (error) throw new Error(`não deu para excluir o post: ${error.message}`);

  const { error: erroStorage } = await supabase.storage.from(BUCKET).remove([fotoPath]);
  if (erroStorage) console.warn("não deu para remover a foto do post:", erroStorage.message);
}
