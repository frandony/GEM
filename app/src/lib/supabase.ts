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
