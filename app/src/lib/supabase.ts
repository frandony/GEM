import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !chave) {
  throw new Error(
    "Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env — copie de .env.example",
  );
}

export const supabase = createClient(url, chave, {
  auth: {
    // Sessão persistida e renovada sozinha: o app é aberto na academia,
    // e pedir login entre uma série e outra seria o fim.
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "treino-sessao",
  },
});

/**
 * `supabase.functions.invoke()` erra com "Edge Function returned a non-2xx
 * status code" pra QUALQUER erro — a mensagem de verdade (a que a função
 * devolveu via `erro()` de `_shared/cors.ts`, campo `erro`) fica escondida
 * dentro de `error.context`, um `Response` que precisa ser lido à parte.
 * Sem isto, todo erro de Edge Function vira essa frase genérica na tela.
 */
export async function extrairErroDeFuncao(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const contexto = (error as { context?: unknown }).context;
    if (contexto instanceof Response) {
      try {
        const corpo = await contexto.clone().json();
        if (typeof corpo?.erro === "string") return corpo.erro;
      } catch {
        // corpo não é JSON (ex: 502 de proxy) — cai na mensagem genérica.
      }
    }
  }
  return error instanceof Error ? error.message : "erro desconhecido";
}
