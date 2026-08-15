import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast } from "../componentes/Toast";

/* =====================================================================
   Toast global.
   =====================================================================
   Era estado local em 3 telas (e ausente em 5). Virou contexto por um
   motivo concreto, não por economia de código:

   Em Onboarding.tsx, `setAviso(...)` era seguido de `navigate(...)` no
   mesmo bloco síncrono — o componente desmontava antes de pintar, e a
   mensagem sobre o plano ter caído no template de fallback era
   **inalcançável**. Estado local de toast não sobrevive à navegação; um
   provider acima do router, sim. O mesmo vale para "criar grupo →
   recarrega a lista → o formulário some".

   A identidade do aviso é um `id` incremental, não o texto. Isso conserta
   o segundo bug do componente antigo: como o efeito dependia de
   `[mensagem]`, mandar a MESMA string duas vezes em menos de 2,5s não
   reiniciava a animação nem o timer — duas séries concluídas em sequência
   produziam um único toast.
   ===================================================================== */

export interface Aviso {
  id: number;
  texto: string;
  tipo: "ok" | "erro";
}

interface ApiToast {
  sucesso: (texto: string) => void;
  erro: (texto: string) => void;
}

const Contexto = createContext<ApiToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const mostrar = useCallback((texto: string, tipo: Aviso["tipo"]) => {
    setAviso((atual) => ({ id: (atual?.id ?? 0) + 1, texto, tipo }));
  }, []);

  const api = useMemo<ApiToast>(
    () => ({
      sucesso: (texto) => mostrar(texto, "ok"),
      erro: (texto) => mostrar(texto, "erro"),
    }),
    [mostrar],
  );

  return (
    <Contexto.Provider value={api}>
      {children}
      {/* `key` no id é o que remonta o componente a cada aviso — é assim
          que a animação e o timer reiniciam mesmo com o texto repetido. */}
      {aviso && <Toast key={aviso.id} aviso={aviso} onFechar={() => setAviso(null)} />}
    </Contexto.Provider>
  );
}

export function useToast(): ApiToast {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useToast precisa estar dentro de ToastProvider");
  return ctx;
}
