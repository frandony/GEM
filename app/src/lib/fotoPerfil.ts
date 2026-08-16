import { supabase } from "./supabase";

const BUCKET = "avatares";
const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/webp"];
const TAMANHO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Sobe a foto e grava a URL em `profiles.foto_url`. Um objeto por
 * usuário — o caminho é sempre o próprio id (ver a migration do bucket
 * `avatares`), então trocar de foto é upsert no MESMO caminho.
 */
export async function atualizarFotoPerfil(userId: string, arquivo: File): Promise<string> {
  if (!TIPOS_PERMITIDOS.includes(arquivo.type)) {
    throw new Error("Envie uma imagem PNG, JPEG ou WEBP.");
  }
  if (arquivo.size > TAMANHO_MAX_BYTES) {
    throw new Error("A imagem precisa ter até 2 MB.");
  }

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(userId, arquivo, { upsert: true, contentType: arquivo.type });
  if (erroUpload) throw new Error(`não deu para enviar a foto: ${erroUpload.message}`);

  // Cache-busting: como o caminho não muda entre trocas, sem isto o
  // navegador continuaria mostrando a foto antiga que já tinha em cache.
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(userId);
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error: erroPerfil } = await supabase.from("profiles").update({ foto_url: url }).eq("id", userId);
  if (erroPerfil) throw new Error(`não deu para salvar a foto no perfil: ${erroPerfil.message}`);

  return url;
}

/**
 * Limpa `profiles.foto_url` primeiro — o que a pessoa vê fica certo
 * mesmo se o passo seguinte falhar. O arquivo órfão no bucket é limpeza,
 * não faz a operação inteira falhar aos olhos de quem pediu (mesma
 * doutrina de `ligarUsaEstudo` em Estudo.tsx).
 */
export async function removerFotoPerfil(userId: string): Promise<void> {
  const { error: erroPerfil } = await supabase.from("profiles").update({ foto_url: null }).eq("id", userId);
  if (erroPerfil) throw new Error(`não deu para remover a foto: ${erroPerfil.message}`);

  const { error: erroStorage } = await supabase.storage.from(BUCKET).remove([userId]);
  if (erroStorage) console.warn("não deu para remover o arquivo do bucket:", erroStorage.message);
}
