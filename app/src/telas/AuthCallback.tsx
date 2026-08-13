import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";

/* =====================================================================
   Aterrissagem do link de e-mail.
   =====================================================================
   Antes desta tela o link de confirmação caía na rota `*`, que redireciona
   para `/` — e `/` é protegida. Resultado: a pessoa era jogada no login
   sem explicação nenhuma, mesmo quando o link estava certo. Pior: quando
   o link estava ERRADO (expirado, já usado), o erro vinha no fragmento da
   URL, ninguém lia, e a queixa virava "a confirmação não funciona".

   O que esta tela faz:
   1. Espera o cliente do Supabase ler o token do fragmento (é ele quem
      grava a sessão — `detectSessionInUrl`, ver lib/supabase.ts).
   2. Se veio erro no fragmento, mostra o motivo em português.
   3. Some da história de navegação: `replace`, para o botão voltar não
      trazer de volta uma URL com token já gasto.
   ===================================================================== */

interface ErroDoLink {
  titulo: string;
  detalhe: string;
  podeReenviar: boolean;
}

export function AuthCallback() {
  const { sessao, carregando } = useAuth();
  const navegar = useNavigate();
  const [erro, setErro] = useState<ErroDoLink | null>(null);
  // Só desiste depois de dar tempo do cliente processar o fragmento —
  // sem isto a tela acusaria "link inválido" no primeiro render, antes
  // de o Supabase sequer ter olhado a URL.
  const [desistiu, setDesistiu] = useState(false);

  useEffect(() => {
    const erroLido = lerErroDaUrl();
    if (erroLido) {
      setErro(erroLido);
      return;
    }
    const relogio = setTimeout(() => setDesistiu(true), 6000);
    return () => clearTimeout(relogio);
  }, []);

  useEffect(() => {
    if (sessao) navegar("/", { replace: true });
  }, [sessao, navegar]);

  if (erro) {
    return (
      <Moldura>
        <span className="chip chip-atencao">{erro.titulo}</span>
        <p>{erro.detalhe}</p>
        <Link className="btn btn-treino" to="/login" replace>
          {erro.podeReenviar ? "Reenviar confirmação" : "Voltar ao login"}
        </Link>
      </Moldura>
    );
  }

  if (desistiu && !sessao && !carregando) {
    return (
      <Moldura>
        <span className="chip chip-atencao">Não consegui confirmar</span>
        <p>
          Este link não trouxe uma sessão válida. Ele pode já ter sido usado, ou
          o endereço deste site pode não estar liberado no painel do Supabase.
        </p>
        <Link className="btn btn-treino" to="/login" replace>
          Voltar ao login
        </Link>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <p>Confirmando sua conta…</p>
    </Moldura>
  );
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
      <div className="vazio w-full">{children}</div>
    </div>
  );
}

/**
 * O Supabase devolve erro de link ora no fragmento (`#error=...`, que é o
 * caso do fluxo implícito), ora na query (`?error=...`). Ler os dois é
 * mais barato que descobrir na base de qual jeito veio.
 */
function lerErroDaUrl(): ErroDoLink | null {
  const doHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const daQuery = new URLSearchParams(window.location.search);
  const codigo = doHash.get("error_code") ?? daQuery.get("error_code");
  const tipo = doHash.get("error") ?? daQuery.get("error");
  if (!codigo && !tipo) return null;

  if (codigo === "otp_expired") {
    return {
      titulo: "Link expirado",
      detalhe:
        "Links de confirmação valem por 1 hora. Peça um novo na tela de login, " +
        "com o mesmo e-mail.",
      podeReenviar: true,
    };
  }
  if (tipo === "access_denied") {
    return {
      titulo: "Link já usado",
      detalhe:
        "Este link não vale mais — provavelmente a conta já foi confirmada. " +
        "Tente entrar normalmente.",
      podeReenviar: false,
    };
  }
  const descricao =
    doHash.get("error_description") ?? daQuery.get("error_description");
  return {
    titulo: "Não deu para confirmar",
    detalhe: descricao ? descricao.replace(/\+/g, " ") : "O link veio com erro.",
    podeReenviar: true,
  };
}
