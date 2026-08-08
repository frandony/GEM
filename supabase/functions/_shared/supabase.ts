import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

/**
 * Cliente que age COMO O USUÁRIO: repassa o JWT do request, então toda a RLS
 * continua valendo dentro da Edge Function. É o padrão a usar em qualquer
 * leitura ou escrita de dado do usuário.
 */
export function clienteDoUsuario(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    },
  );
}

/**
 * Cliente com service_role: FURA A RLS. Usar apenas onde a função age em nome
 * do sistema, não do usuário — hoje só na drenagem da fila de push.
 */
export function clienteDeServico(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Resolve o usuário do JWT. Null = não autenticado. */
export async function usuarioAtual(
  supabase: SupabaseClient,
): Promise<{ id: string } | null> {
  // getUser() valida o token no servidor de auth. getSession() apenas decodifica
  // localmente e aceitaria um JWT forjado — nunca usar aqui.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}
