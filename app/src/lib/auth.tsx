import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, urlDeRetornoDeAuth } from "./supabase";

interface EstadoAuth {
  sessao: Session | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>;
  criarConta: (
    email: string,
    senha: string,
    nome: string,
  ) => Promise<{ erro: string | null; precisaConfirmarEmail: boolean }>;
  /** Reenvia o e-mail de confirmação. Devolve a mensagem de erro, ou null. */
  reenviarConfirmacao: (email: string) => Promise<string | null>;
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
      options: {
        data: { nome },
        // Sem isto o link do e-mail aponta para o Site URL do projeto — que
        // continuou sendo o endereço antigo depois da mudança para
        // megs.digital, e por isso confirmar a conta parava de funcionar.
        emailRedirectTo: urlDeRetornoDeAuth(),
      },
    });
    if (error) return { erro: error.message, precisaConfirmarEmail: false };
    // Se o projeto exige confirmação por e-mail, o signUp não devolve sessão.
    return { erro: null, precisaConfirmarEmail: !data.session };
  }

  async function reenviarConfirmacao(email: string): Promise<string | null> {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: urlDeRetornoDeAuth() },
    });
    return error?.message ?? null;
  }

  async function sair() {
    await supabase.auth.signOut();
  }

  return (
    <Contexto.Provider
      value={{ sessao, carregando, entrar, criarConta, reenviarConfirmacao, sair }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function useAuth(): EstadoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
