import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface EstadoAuth {
  sessao: Session | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>;
  criarConta: (
    email: string,
    senha: string,
    nome: string,
  ) => Promise<{ erro: string | null; precisaConfirmarEmail: boolean }>;
  sair: () => Promise<void>;
}

const Contexto = createContext<EstadoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setCarregando(false);
    });

    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSessao(novaSessao);
    });

    return () => assinatura.subscription.unsubscribe();
  }, []);

  async function entrar(email: string, senha: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return error?.message ?? null;
  }

  async function criarConta(email: string, senha: string, nome: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: { data: { nome } },
    });
    if (error) return { erro: error.message, precisaConfirmarEmail: false };
    // Se o projeto exige confirmação por e-mail, o signUp não devolve sessão.
    return { erro: null, precisaConfirmarEmail: !data.session };
  }

  async function sair() {
    await supabase.auth.signOut();
  }

  return (
    <Contexto.Provider value={{ sessao, carregando, entrar, criarConta, sair }}>
      {children}
    </Contexto.Provider>
  );
}

export function useAuth(): EstadoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
