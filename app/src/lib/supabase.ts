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

    // `implicit` explícito, não por acaso — e não `pkce`.
    // No PKCE o verificador fica no localStorage do navegador que pediu o
    // cadastro. Quem se cadastra no celular e abre o e-mail no notebook
    // (ou no navegador embutido do Gmail) cai em "code verifier missing" e
    // não tem como confirmar a conta. O implícito devolve o token no
    // fragmento da URL e funciona em qualquer aparelho.
    flowType: "implicit",

    // Deixa explícito o que faz o /auth/callback funcionar: ao carregar,
    // o cliente lê o fragmento da URL e grava a sessão sozinho.
    detectSessionInUrl: true,
  },
});

/**
 * Para onde o Supabase deve mandar a pessoa depois de clicar no link do
 * e-mail. Precisa ser calculado em tempo de execução, não fixado em build:
 * o mesmo bundle roda em localhost, no preview da Vercel e em
 * megs.digital, e um valor fixo quebraria dois dos três.
 *
 * ATENÇÃO — isto sozinho não basta. Toda URL usada aqui precisa estar na
 * allowlist do painel do Supabase (Authentication → URL Configuration →
 * Redirect URLs). Se não estiver, o Supabase ignora o parâmetro em
 * silêncio e usa o Site URL, que era o motivo dos links de confirmação
 * continuarem indo para o endereço antigo depois da troca de domínio.
 */
export function urlDeRetornoDeAuth(): string {
  return `${window.location.origin}/auth/callback`;
}

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
