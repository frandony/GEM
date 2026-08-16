import { erro, json, respostaOptions } from "../_shared/cors.ts";
import { clienteDeServico, clienteDoUsuario, usuarioAtual } from "../_shared/supabase.ts";

/**
 * Apaga a conta de quem chama — nunca recebe id no corpo da requisição.
 * O usuário vem SEMPRE do JWT (verify_jwt garante que existe um token
 * válido; `usuarioAtual` resolve quem é), então não há parâmetro nenhum
 * pra adulterar e apagar a conta de outra pessoa.
 *
 * `auth.admin.deleteUser` exige service_role — a chave anônima do cliente
 * não alcança. Depois de apagar `auth.users`, o `ON DELETE CASCADE` do
 * schema limpa o resto sozinho (testado contra o banco real — ver
 * CLAUDE.md §1, "Exclusão de conta: cascade limpo, zero resíduo").
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respostaOptions(req);
  if (req.method !== "POST") return erro(req, "método não suportado", 405);

  const supabase = clienteDoUsuario(req);
  const usuario = await usuarioAtual(supabase);
  if (!usuario) return erro(req, "não autenticado", 401);

  const servico = clienteDeServico();
  const { error } = await servico.auth.admin.deleteUser(usuario.id);
  if (error) {
    console.error(`excluir-conta: falha ao apagar ${usuario.id}:`, error.message);
    return erro(req, "não foi possível excluir a conta agora — tente de novo em instantes", 500);
  }

  return json(req, { ok: true });
});
