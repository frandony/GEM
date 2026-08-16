import { extrairErroDeFuncao, supabase } from "./supabase";

/**
 * Apaga a conta autenticada — sempre a de quem chama, nunca um id que o
 * cliente escolhe: a Edge Function resolve o usuário pelo próprio token,
 * não por parâmetro (ver supabase/functions/excluir-conta/index.ts).
 * Precisa de Edge Function porque apagar `auth.users` exige privilégio de
 * admin, que a chave anônima do cliente não tem.
 */
export async function excluirContaPropria(): Promise<void> {
  const { error } = await supabase.functions.invoke("excluir-conta", { body: {} });
  if (error) throw new Error(await extrairErroDeFuncao(error));
}
