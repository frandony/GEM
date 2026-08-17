import { useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
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
  const [aba, setAba] = useState<Aba>("feed");

  return (
    <div className="tela">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="h1">Social</h1>
        <Link to="/grupo/descobrir" className="btn btn-neutro shrink-0" aria-label="Descobrir pessoas">
          <Search size={16} /> Descobrir
        </Link>
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
