import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import { Avatar } from "../componentes/Avatar";
import {
  carregarSeguidores,
  carregarSeguindo,
  deixarDeSeguir,
  seguir,
  type PessoaPublica,
} from "../lib/social";

/** Mesma tela pros dois lados do grafo — "quem essa pessoa segue" e
    "quem segue essa pessoa" são a mesma lista renderizada, só a consulta
    muda (ver `carregarSeguindo`/`carregarSeguidores` em `social.ts`). */
export function ListaDeConexoes({ tipo }: { tipo: "seguindo" | "seguidores" }) {
  const { sessao } = useAuth();
  const meuId = sessao!.user.id;
  const { userId } = useParams<{ userId: string }>();
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [pessoas, setPessoas] = useState<PessoaPublica[]>([]);
  const [falhou, setFalhou] = useState<string | null>(null);

  async function carregar() {
    if (!userId) return;
    setFalhou(null);
    try {
      const lista = tipo === "seguindo" ? await carregarSeguindo(userId, meuId) : await carregarSeguidores(userId, meuId);
      setPessoas(lista);
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar a lista.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tipo]);

  async function alternarSeguir(pessoa: PessoaPublica) {
    const seguirAgora = !pessoa.sigo;
    setPessoas((atual) => atual.map((p) => (p.id === pessoa.id ? { ...p, sigo: seguirAgora } : p)));
    try {
      if (seguirAgora) await seguir(meuId, pessoa.id);
      else await deixarDeSeguir(meuId, pessoa.id);
    } catch (e) {
      setPessoas((atual) => atual.map((p) => (p.id === pessoa.id ? { ...p, sigo: !seguirAgora } : p)));
      toast.erro(e instanceof Error ? e.message : "Não deu para atualizar.");
    }
  }

  return (
    <div className="tela">
      <Voltar to={`/grupo/perfil/${userId}`} rotulo="Perfil" className="mb-1" />
      <h1 className="h1 mb-4">{tipo === "seguindo" ? "Seguindo" : "Seguidores"}</h1>

      {falhou ? (
        <FalhaAoCarregar mensagem={falhou} onTentarDeNovo={() => void carregar()} />
      ) : carregando ? (
        <div className="skeleton" style={{ height: "8rem" }} />
      ) : pessoas.length === 0 ? (
        <div className="vazio">
          <p>{tipo === "seguindo" ? "Não segue ninguém ainda." : "Ninguém segue essa pessoa ainda."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pessoas.map((pessoa) => (
            <div key={pessoa.id} className="pessoa-linha">
              <Link to={`/grupo/perfil/${pessoa.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar nome={pessoa.nome} fotoUrl={pessoa.fotoUrl} />
                <span className="min-w-0 truncate">{pessoa.nome}</span>
              </Link>
              {pessoa.id !== meuId && (
                <button
                  type="button"
                  className={pessoa.sigo ? "btn btn-neutro shrink-0" : "btn btn-social shrink-0"}
                  onClick={() => void alternarSeguir(pessoa)}
                >
                  {pessoa.sigo ? "Seguindo" : "Seguir"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
