import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Heart, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import { Avatar } from "../componentes/Avatar";
import {
  alternarCurtida,
  carregarPerfilPublico,
  deixarDeSeguir,
  excluirPostSocial,
  seguir,
  type PerfilPublicoDados,
  type PostSocial,
} from "../lib/social";

function formatarQuando(criadoEm: string): string {
  const diffMin = Math.floor((Date.now() - new Date(criadoEm).getTime()) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin}min`;
  const horas = Math.floor(diffMin / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias}d`;
  return new Date(criadoEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function PerfilPublico() {
  const { sessao } = useAuth();
  const meuId = sessao!.user.id;
  const { userId } = useParams<{ userId: string }>();
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [dados, setDados] = useState<PerfilPublicoDados | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [seguindoEnvio, setSeguindoEnvio] = useState(false);

  async function recarregar() {
    if (!userId) return;
    setFalhou(null);
    try {
      const d = await carregarPerfilPublico(userId, meuId);
      setDados(d);
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar o perfil.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, meuId]);

  async function alternarSeguir() {
    if (!userId || !dados) return;
    const seguirAgora = !dados.sigo;
    setSeguindoEnvio(true);
    setDados((atual) =>
      atual
        ? { ...atual, sigo: seguirAgora, seguidores: atual.seguidores + (seguirAgora ? 1 : -1) }
        : atual,
    );
    try {
      if (seguirAgora) await seguir(meuId, userId);
      else await deixarDeSeguir(meuId, userId);
    } catch (e) {
      setDados((atual) =>
        atual
          ? { ...atual, sigo: !seguirAgora, seguidores: atual.seguidores + (seguirAgora ? -1 : 1) }
          : atual,
      );
      toast.erro(e instanceof Error ? e.message : "Não deu para atualizar.");
    } finally {
      setSeguindoEnvio(false);
    }
  }

  async function curtir(post: PostSocial) {
    if (!dados) return;
    const curtirAgora = !post.minhaCurtida;
    setDados((atual) =>
      atual
        ? {
            ...atual,
            posts: atual.posts.map((p) =>
              p.id === post.id
                ? { ...p, minhaCurtida: curtirAgora, curtidas: p.curtidas + (curtirAgora ? 1 : -1) }
                : p,
            ),
          }
        : atual,
    );
    try {
      await alternarCurtida(post.id, meuId, curtirAgora);
    } catch (e) {
      setDados((atual) =>
        atual
          ? {
              ...atual,
              posts: atual.posts.map((p) =>
                p.id === post.id
                  ? { ...p, minhaCurtida: !curtirAgora, curtidas: p.curtidas + (curtirAgora ? -1 : 1) }
                  : p,
              ),
            }
          : atual,
      );
      toast.erro(e instanceof Error ? e.message : "Não deu para curtir.");
    }
  }

  async function excluir(post: PostSocial) {
    try {
      await excluirPostSocial(post.id, post.fotoPath);
      setDados((atual) => (atual ? { ...atual, posts: atual.posts.filter((p) => p.id !== post.id) } : atual));
      toast.sucesso("Post excluído.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para excluir o post.");
    }
  }

  if (carregando) {
    return (
      <div className="tela">
        <div className="skeleton" style={{ height: "2.5rem", width: "12rem" }} />
        <div className="skeleton mt-4" style={{ height: "10rem" }} />
      </div>
    );
  }

  if (falhou) {
    return (
      <div className="tela">
        <Voltar to="/grupo" rotulo="Social" className="mb-4" />
        <FalhaAoCarregar mensagem={falhou} onTentarDeNovo={() => void recarregar()} />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-atencao">Perfil não encontrado</span>
          <Voltar to="/grupo" rotulo="Social" />
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <Voltar to="/grupo" rotulo="Social" className="mb-4" />

      <div className="perfil-cabecalho mb-6">
        <Avatar nome={dados.nome} fotoUrl={dados.fotoUrl} tamanhoRem={5} />
        <h1 className="h1 mt-3">{dados.nome}</h1>
        <div className="flex items-center gap-4 text-sm text-ink-muted mt-1">
          <span>
            <span className="num text-ink">{dados.seguidores}</span> seguidores
          </span>
          <span>
            <span className="num text-ink">{dados.seguindo}</span> seguindo
          </span>
        </div>
        {dados.souEu ? (
          <Link to="/conta" className="btn btn-neutro mt-4">
            Editar perfil
          </Link>
        ) : (
          <button
            type="button"
            className={dados.sigo ? "btn btn-neutro mt-4" : "btn btn-social mt-4"}
            onClick={() => void alternarSeguir()}
            disabled={seguindoEnvio}
          >
            {dados.sigo ? "Seguindo" : "Seguir"}
          </button>
        )}
      </div>

      {dados.posts.length === 0 ? (
        <div className="vazio">
          <p>{dados.souEu ? "Você ainda não postou nada." : "Ainda não postou nada."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {dados.posts.map((post) => (
            <div key={post.id} className="card flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-terciario">{formatarQuando(post.criadoEm)}</span>
                {post.autorId === meuId && (
                  <button
                    type="button"
                    className="post-excluir"
                    onClick={() => void excluir(post)}
                    aria-label="Excluir post"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {post.fotoUrl && <img src={post.fotoUrl} alt="" className="post-foto" />}
              {post.texto && <p className="text-sm">{post.texto}</p>}

              <button
                type="button"
                className="curtir-botao"
                aria-pressed={post.minhaCurtida}
                onClick={() => void curtir(post)}
              >
                <Heart size={18} fill={post.minhaCurtida ? "currentColor" : "none"} />
                {post.curtidas > 0 && <span className="num">{post.curtidas}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
