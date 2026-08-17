import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import { Avatar } from "../componentes/Avatar";
import { buscarPessoas, deixarDeSeguir, seguir, type PessoaPublica } from "../lib/social";

export function DescobrirPessoas() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const toast = useToast();

  const [termo, setTermo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [pessoas, setPessoas] = useState<PessoaPublica[]>([]);
  const [falhou, setFalhou] = useState<string | null>(null);

  async function buscar(valor: string) {
    setFalhou(null);
    try {
      const lista = await buscarPessoas(valor, userId);
      setPessoas(lista);
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para buscar pessoas.");
    } finally {
      setCarregando(false);
    }
  }

  // Debounce simples: espera a pessoa parar de digitar por 300ms antes de
  // buscar de novo — sem isso, cada tecla vira uma consulta.
  useEffect(() => {
    setCarregando(true);
    const id = window.setTimeout(() => void buscar(termo), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  async function alternarSeguir(pessoa: PessoaPublica) {
    const seguirAgora = !pessoa.sigo;
    setPessoas((atual) => atual.map((p) => (p.id === pessoa.id ? { ...p, sigo: seguirAgora } : p)));
    try {
      if (seguirAgora) await seguir(userId, pessoa.id);
      else await deixarDeSeguir(userId, pessoa.id);
    } catch (e) {
      setPessoas((atual) => atual.map((p) => (p.id === pessoa.id ? { ...p, sigo: !seguirAgora } : p)));
      toast.erro(e instanceof Error ? e.message : "Não deu para atualizar.");
    }
  }

  return (
    <div className="tela">
      <Voltar to="/grupo" rotulo="Social" className="mb-1" />
      <h1 className="h1 mb-4">Descobrir</h1>

      <div className="campo flex items-center gap-2 mb-4">
        <Search size={16} className="text-ink-muted shrink-0" />
        <input
          className="flex-1"
          style={{ background: "transparent", border: 0, outline: "none" }}
          placeholder="Buscar por nome"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          aria-label="Buscar pessoas"
        />
      </div>

      {falhou ? (
        <FalhaAoCarregar mensagem={falhou} onTentarDeNovo={() => void buscar(termo)} />
      ) : carregando ? (
        <div className="skeleton" style={{ height: "8rem" }} />
      ) : pessoas.length === 0 ? (
        <div className="vazio">
          <p>{termo ? "Ninguém com esse nome." : "Ninguém pra mostrar ainda."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pessoas.map((pessoa) => (
            <div key={pessoa.id} className="pessoa-linha">
              <Link to={`/grupo/perfil/${pessoa.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <Avatar nome={pessoa.nome} fotoUrl={pessoa.fotoUrl} />
                <span className="min-w-0 truncate">{pessoa.nome}</span>
              </Link>
              <button
                type="button"
                className={pessoa.sigo ? "btn btn-neutro shrink-0" : "btn btn-social shrink-0"}
                onClick={() => void alternarSeguir(pessoa)}
              >
                {pessoa.sigo ? "Seguindo" : "Seguir"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
