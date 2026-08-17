import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { carregarPerfil } from "../lib/dados";
import { Avatar } from "../componentes/Avatar";
import { FeedSocial } from "./FeedSocial";
import { Grupo } from "./Grupo";

/* =====================================================================
   Hub da Social: Feed (público, quem você segue) e Grupos (privado,
   por código de convite) como abas da mesma tela — dois modelos de
   privacidade diferentes, mas uma porta de entrada só, que é o que o
   Nav já aponta pra cá. Feed é a aba padrão: é o "feed de vdd" que devia
   aparecer de cara, não escondido dentro de um grupo específico.
   ===================================================================== */

type Aba = "feed" | "grupos";

export function Social() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const [aba, setAba] = useState<Aba>("feed");

  // Só pro avatar do cabeçalho — "minhas postagens" é a mesma tela de
  // perfil público que qualquer pessoa vê, só que da sua própria conta
  // (PerfilPublico.tsx já trata `souEu` e troca "Seguir" por "Editar
  // perfil"). Sem isso não existia NENHUM jeito de chegar aos seus
  // próprios posts a não ser clicando neles dentro do feed.
  const [meuNome, setMeuNome] = useState("Você");
  const [meuFotoUrl, setMeuFotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    void carregarPerfil(userId).then((perfil) => {
      if (!ativo) return;
      setMeuNome(perfil?.nome ?? "Você");
      setMeuFotoUrl(perfil?.foto_url ?? null);
    });
    return () => {
      ativo = false;
    };
  }, [userId]);

  return (
    <div className="tela">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="h1">Social</h1>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/grupo/descobrir" className="btn btn-neutro" aria-label="Descobrir pessoas">
            <Search size={16} /> Descobrir
          </Link>
          <Link to={`/grupo/perfil/${userId}`} className="btn btn-neutro" aria-label="Meu perfil">
            <Avatar nome={meuNome} fotoUrl={meuFotoUrl} tamanhoRem={1.5} /> Perfil
          </Link>
        </div>
      </header>

      <div className="tabs mb-4" role="tablist" aria-label="Feed ou grupos">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={aba === "feed"}
          onClick={() => setAba("feed")}
        >
          Feed
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={aba === "grupos"}
          onClick={() => setAba("grupos")}
        >
          Grupos
        </button>
      </div>

      {aba === "feed" ? <FeedSocial /> : <Grupo />}
    </div>
  );
}
