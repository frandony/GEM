import { supabase } from "./supabase";
import { novoId } from "./fila";
import { carregarPerfil } from "./dados";

/* =====================================================================
   Camada pública: seguir pessoas + feed a partir de quem você segue.
   =====================================================================
   Separado de `feedGrupo.ts` de propósito — são dois modelos de
   privacidade diferentes. `posts_grupo` só é visível pra quem tem o
   código do grupo; `posts_perfil` é visível pra qualquer autenticado
   (RLS `using (true)`), mas o FEED (o que aparece de cara) só junta
   posts de quem você segue + você mesmo, calculado aqui no cliente —
   mesmo padrão "ids relacionados → .in()" que `carregarGruposDoUsuario`
   já usa em dados.ts, sem precisar de função SQL nova.
   ===================================================================== */

export interface PostSocial {
  id: string;
  autorId: string;
  autorNome: string;
  autorFotoUrl: string | null;
  fotoPath: string | null;
  fotoUrl: string | null;
  texto: string | null;
  criadoEm: string;
  curtidas: number;
  minhaCurtida: boolean;
}

export interface PessoaPublica {
  id: string;
  nome: string;
  fotoUrl: string | null;
  sigo: boolean;
}

const BUCKET = "posts-perfil";
const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/webp"];
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024;
const VALIDADE_URL_SEG = 3600;

function caminhoDaFoto(autorId: string, postId: string): string {
  return `${autorId}/${postId}`;
}

type LinhaPost = {
  id: string;
  autor_id: string;
  foto_path: string | null;
  texto: string | null;
  criado_em: string;
  profiles: { nome: string; foto_url: string | null } | null;
};

/** Monta `PostSocial[]` a partir de linhas cruas: URLs assinadas em lote
    (bucket privado) e curtidas em lote (mesmo formato de `post_reacoes`
    em feedGrupo.ts, só que aqui vira contagem + "eu curti"). */
async function montarPosts(linhas: LinhaPost[], meuId: string): Promise<PostSocial[]> {
  if (!linhas.length) return [];

  const ids = linhas.map((p) => p.id);
  const comFoto = linhas.filter((p) => p.foto_path);
  const [{ data: curtidas }, assinadas] = await Promise.all([
    supabase.from("curtidas_perfil").select("post_id,user_id").in("post_id", ids),
    comFoto.length
      ? supabase.storage.from(BUCKET).createSignedUrls(
          comFoto.map((p) => p.foto_path!),
          VALIDADE_URL_SEG,
        )
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);

  const urlPorCaminho = new Map(
    (assinadas.data ?? []).map((a) => [a.path, a.signedUrl] as const),
  );
  const curtidasPorPost = new Map<string, { total: number; minha: boolean }>();
  for (const c of curtidas ?? []) {
    const atual = curtidasPorPost.get(c.post_id) ?? { total: 0, minha: false };
    atual.total += 1;
    if (c.user_id === meuId) atual.minha = true;
    curtidasPorPost.set(c.post_id, atual);
  }

  return linhas.map((p) => ({
    id: p.id,
    autorId: p.autor_id,
    autorNome: p.profiles?.nome ?? "Alguém",
    autorFotoUrl: p.profiles?.foto_url ?? null,
    fotoPath: p.foto_path,
    fotoUrl: p.foto_path ? (urlPorCaminho.get(p.foto_path) ?? null) : null,
    texto: p.texto,
    criadoEm: p.criado_em,
    curtidas: curtidasPorPost.get(p.id)?.total ?? 0,
    minhaCurtida: curtidasPorPost.get(p.id)?.minha ?? false,
  }));
}

/** Feed = posts de quem eu sigo + os meus próprios. Passo 1: ids de quem
    sigo. Passo 2: posts desses ids (`.in`), mais recentes primeiro. */
export async function carregarFeedSocial(userId: string): Promise<PostSocial[]> {
  const { data: seguindo } = await supabase
    .from("seguidores")
    .select("seguido_id")
    .eq("seguidor_id", userId);

  const autores = [userId, ...(seguindo ?? []).map((s) => s.seguido_id)];

  const { data, error } = await supabase
    .from("posts_perfil")
    // `curtidas_perfil` também referencia posts_perfil E profiles — sem o
    // hint `!posts_perfil_autor_id_fkey`, o PostgREST enxerga dois
    // caminhos possíveis até profiles (direto por autor_id, e indireto
    // via curtidas_perfil) e recusa o embed por ambiguidade.
    .select("id,autor_id,foto_path,texto,criado_em,profiles!posts_perfil_autor_id_fkey(nome,foto_url)")
    .in("autor_id", autores)
    .order("criado_em", { ascending: false })
    .returns<LinhaPost[]>();
  if (error) throw new Error(`não deu para carregar o feed: ${error.message}`);

  return montarPosts(data ?? [], userId);
}

/** Posts de uma pessoa específica — usado no perfil público dela. */
export async function carregarPostsDaPessoa(userId: string, meuId: string): Promise<PostSocial[]> {
  const { data, error } = await supabase
    .from("posts_perfil")
    // `curtidas_perfil` também referencia posts_perfil E profiles — sem o
    // hint `!posts_perfil_autor_id_fkey`, o PostgREST enxerga dois
    // caminhos possíveis até profiles (direto por autor_id, e indireto
    // via curtidas_perfil) e recusa o embed por ambiguidade.
    .select("id,autor_id,foto_path,texto,criado_em,profiles!posts_perfil_autor_id_fkey(nome,foto_url)")
    .eq("autor_id", userId)
    .order("criado_em", { ascending: false })
    .returns<LinhaPost[]>();
  if (error) throw new Error(`não deu para carregar os posts: ${error.message}`);

  return montarPosts(data ?? [], meuId);
}

/** Foto é opcional aqui (diferente de `criarPost` do grupo) — "postar um
    pensamento" sem foto também vale. Id gerado no cliente, mesmo padrão. */
export async function criarPostSocial(
  autorId: string,
  autorNome: string,
  autorFotoUrl: string | null,
  texto: string,
  arquivo: File | null,
): Promise<PostSocial> {
  const textoLimpo = texto.trim() || null;
  if (!textoLimpo && !arquivo) {
    throw new Error("Escreva algo ou escolha uma foto antes de postar.");
  }
  if (arquivo && !TIPOS_PERMITIDOS.includes(arquivo.type)) {
    throw new Error("Envie uma imagem PNG, JPEG ou WEBP.");
  }
  if (arquivo && arquivo.size > TAMANHO_MAX_BYTES) {
    throw new Error("A imagem precisa ter até 5 MB.");
  }

  const id = novoId();
  let caminho: string | null = null;
  let fotoUrl: string | null = null;

  if (arquivo) {
    caminho = caminhoDaFoto(autorId, id);
    const { error: erroUpload } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, arquivo, { contentType: arquivo.type });
    if (erroUpload) throw new Error(`não deu para enviar a foto: ${erroUpload.message}`);
    const { data: assinada } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(caminho, VALIDADE_URL_SEG);
    fotoUrl = assinada?.signedUrl ?? null;
  }

  const { error: erroInsert } = await supabase.from("posts_perfil").insert({
    id,
    autor_id: autorId,
    foto_path: caminho,
    texto: textoLimpo,
  });
  if (erroInsert) throw new Error(`não deu para publicar: ${erroInsert.message}`);

  return {
    id,
    autorId,
    autorNome,
    autorFotoUrl,
    fotoPath: caminho,
    fotoUrl,
    texto: textoLimpo,
    criadoEm: new Date().toISOString(),
    curtidas: 0,
    minhaCurtida: false,
  };
}

export async function excluirPostSocial(postId: string, fotoPath: string | null): Promise<void> {
  const { error } = await supabase.from("posts_perfil").delete().eq("id", postId);
  if (error) throw new Error(`não deu para excluir o post: ${error.message}`);

  if (fotoPath) {
    const { error: erroStorage } = await supabase.storage.from(BUCKET).remove([fotoPath]);
    if (erroStorage) console.warn("não deu para remover a foto do post:", erroStorage.message);
  }
}

/** Toggle simples — curtir de novo remove. */
export async function alternarCurtida(postId: string, userId: string, curtir: boolean): Promise<void> {
  if (curtir) {
    const { error } = await supabase.from("curtidas_perfil").insert({ post_id: postId, user_id: userId });
    if (error) throw new Error(`não deu para curtir: ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from("curtidas_perfil")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) throw new Error(`não deu para descurtir: ${error.message}`);
}

/** Preenche `sigo` numa lista de pessoas já montada — passo repetido em
    busca, "quem eu sigo" e "quem me segue" (nos três casos o botão de
    seguir da linha precisa saber se EU (meuId) já sigo cada uma). */
async function marcarSigo(
  pessoas: Array<{ id: string; nome: string; fotoUrl: string | null }>,
  meuId: string,
): Promise<PessoaPublica[]> {
  if (!pessoas.length) return [];
  const { data: seguindo } = await supabase
    .from("seguidores")
    .select("seguido_id")
    .eq("seguidor_id", meuId)
    .in(
      "seguido_id",
      pessoas.map((p) => p.id),
    );
  const idsQueSigo = new Set((seguindo ?? []).map((s) => s.seguido_id));
  return pessoas.map((p) => ({ ...p, sigo: idsQueSigo.has(p.id) }));
}

export async function buscarPessoas(termo: string, meuId: string): Promise<PessoaPublica[]> {
  const termoLimpo = termo.trim();
  let consulta = supabase.from("profiles").select("id,nome,foto_url").neq("id", meuId).limit(20);
  if (termoLimpo) consulta = consulta.ilike("nome", `%${termoLimpo}%`);
  const { data: pessoas, error } = await consulta.order("nome");
  if (error) throw new Error(`não deu para buscar pessoas: ${error.message}`);
  if (!pessoas?.length) return [];

  return marcarSigo(
    pessoas.map((p) => ({ id: p.id, nome: p.nome, fotoUrl: p.foto_url })),
    meuId,
  );
}

/** Pessoas que `userId` segue. `seguidores` tem DUAS fks pra profiles
    (seguidor_id e seguido_id) — o embed exige hint explícito de qual
    usar, senão o PostgREST recusa por ambiguidade (mesmo problema do
    feed, causa diferente: aqui são duas fks na MESMA tabela pro MESMO
    destino, lá eram duas tabelas apontando pro mesmo destino). */
export async function carregarSeguindo(userId: string, meuId: string): Promise<PessoaPublica[]> {
  const { data, error } = await supabase
    .from("seguidores")
    .select("seguido_id,profiles!seguidores_seguido_id_fkey(nome,foto_url)")
    .eq("seguidor_id", userId)
    .order("criado_em", { ascending: false })
    .returns<Array<{ seguido_id: string; profiles: { nome: string; foto_url: string | null } | null }>>();
  if (error) throw new Error(`não deu para carregar quem é seguido: ${error.message}`);
  if (!data?.length) return [];

  return marcarSigo(
    data.map((l) => ({ id: l.seguido_id, nome: l.profiles?.nome ?? "Alguém", fotoUrl: l.profiles?.foto_url ?? null })),
    meuId,
  );
}

/** Pessoas que seguem `userId`. */
export async function carregarSeguidores(userId: string, meuId: string): Promise<PessoaPublica[]> {
  const { data, error } = await supabase
    .from("seguidores")
    .select("seguidor_id,profiles!seguidores_seguidor_id_fkey(nome,foto_url)")
    .eq("seguido_id", userId)
    .order("criado_em", { ascending: false })
    .returns<Array<{ seguidor_id: string; profiles: { nome: string; foto_url: string | null } | null }>>();
  if (error) throw new Error(`não deu para carregar seguidores: ${error.message}`);
  if (!data?.length) return [];

  return marcarSigo(
    data.map((l) => ({ id: l.seguidor_id, nome: l.profiles?.nome ?? "Alguém", fotoUrl: l.profiles?.foto_url ?? null })),
    meuId,
  );
}

export async function seguir(seguidorId: string, seguidoId: string): Promise<void> {
  const { error } = await supabase
    .from("seguidores")
    .insert({ seguidor_id: seguidorId, seguido_id: seguidoId });
  if (error) throw new Error(`não deu para seguir: ${error.message}`);
}

export async function deixarDeSeguir(seguidorId: string, seguidoId: string): Promise<void> {
  const { error } = await supabase
    .from("seguidores")
    .delete()
    .eq("seguidor_id", seguidorId)
    .eq("seguido_id", seguidoId);
  if (error) throw new Error(`não deu para deixar de seguir: ${error.message}`);
}

export interface PerfilPublicoDados {
  nome: string;
  fotoUrl: string | null;
  seguidores: number;
  seguindo: number;
  souEu: boolean;
  sigo: boolean;
  posts: PostSocial[];
}

export async function carregarPerfilPublico(
  userId: string,
  meuId: string,
): Promise<PerfilPublicoDados | null> {
  const souEu = userId === meuId;
  const [perfil, seguidoresCount, seguindoCount, jaSigo, posts] = await Promise.all([
    carregarPerfil(userId),
    supabase.from("seguidores").select("*", { count: "exact", head: true }).eq("seguido_id", userId),
    supabase.from("seguidores").select("*", { count: "exact", head: true }).eq("seguidor_id", userId),
    souEu
      ? Promise.resolve({ data: null })
      : supabase
          .from("seguidores")
          .select("seguido_id")
          .eq("seguidor_id", meuId)
          .eq("seguido_id", userId)
          .maybeSingle(),
    carregarPostsDaPessoa(userId, meuId),
  ]);

  if (!perfil) return null;

  return {
    nome: perfil.nome,
    fotoUrl: perfil.foto_url,
    seguidores: seguidoresCount.count ?? 0,
    seguindo: seguindoCount.count ?? 0,
    souEu,
    sigo: !!jaSigo.data,
    posts,
  };
}
