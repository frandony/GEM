import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Heart, ImagePlus, Trash2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Avatar } from "../componentes/Avatar";
import { carregarPerfil } from "../lib/dados";
import {
  alternarCurtida,
  carregarFeedSocial,
  criarPostSocial,
  excluirPostSocial,
  type PostSocial,
} from "../lib/social";

/** "agora" / "há 12min" / "há 3h" / "ontem" / "há 5d" / "12/08". */
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

export function FeedSocial() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [posts, setPosts] = useState<PostSocial[]>([]);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [meuNome, setMeuNome] = useState("Você");
  const [meuFotoUrl, setMeuFotoUrl] = useState<string | null>(null);

  const [postando, setPostando] = useState(false);
  const [textoPost, setTextoPost] = useState("");
  const [fotoPost, setFotoPost] = useState<File | null>(null);
  const [publicando, setPublicando] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  async function recarregar() {
    setFalhou(null);
    try {
      const [perfil, ps] = await Promise.all([carregarPerfil(userId), carregarFeedSocial(userId)]);
      setMeuNome(perfil?.nome ?? "Você");
      setMeuFotoUrl(perfil?.foto_url ?? null);
      setPosts(ps);
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar o feed.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (postando) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [postando]);

  async function publicar() {
    if (!textoPost.trim() && !fotoPost) {
      toast.erro("Escreva algo ou escolha uma foto antes de postar.");
      return;
    }
    setPublicando(true);
    try {
      const post = await criarPostSocial(userId, meuNome, meuFotoUrl, textoPost, fotoPost);
      setPosts((atual) => [post, ...atual]);
      setPostando(false);
      setTextoPost("");
      setFotoPost(null);
      toast.sucesso("Publicado.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para publicar.");
    } finally {
      setPublicando(false);
    }
  }

  /** Otimista com rollback, mesmo padrão de `reagir` em DetalheGrupo.tsx. */
  async function curtir(post: PostSocial) {
    const curtirAgora = !post.minhaCurtida;
    setPosts((atual) =>
      atual.map((p) =>
        p.id === post.id
          ? { ...p, minhaCurtida: curtirAgora, curtidas: p.curtidas + (curtirAgora ? 1 : -1) }
          : p,
      ),
    );
    try {
      await alternarCurtida(post.id, userId, curtirAgora);
    } catch (e) {
      setPosts((atual) =>
        atual.map((p) =>
          p.id === post.id
            ? { ...p, minhaCurtida: !curtirAgora, curtidas: p.curtidas + (curtirAgora ? -1 : 1) }
            : p,
        ),
      );
      toast.erro(e instanceof Error ? e.message : "Não deu para curtir.");
    }
  }

  async function excluir(post: PostSocial) {
    try {
      await excluirPostSocial(post.id, post.fotoPath);
      setPosts((atual) => atual.filter((p) => p.id !== post.id));
      toast.sucesso("Post excluído.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para excluir o post.");
    }
  }

  if (carregando) {
    return <div className="skeleton" style={{ height: "10rem" }} />;
  }

  if (falhou) {
    return <FalhaAoCarregar mensagem={falhou} onTentarDeNovo={() => void recarregar()} />;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="rotulo-secao text-ink-muted">Feed</span>
        {!postando && (
          <button
            type="button"
            className="text-xs text-social-ink underline"
            onClick={() => setPostando(true)}
          >
            Postar
          </button>
        )}
      </div>

      {postando && (
        <div ref={formRef} className="card mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="h3">Novo post</span>
            <button
              type="button"
              className="text-ink-muted shrink-0"
              onClick={() => {
                setPostando(false);
                setFotoPost(null);
                setTextoPost("");
              }}
              aria-label="Cancelar"
            >
              <X size={20} />
            </button>
          </div>

          <textarea
            className="campo"
            placeholder="O que você quer contar?"
            rows={3}
            value={textoPost}
            onChange={(e) => setTextoPost(e.target.value)}
          />

          <label className="btn btn-neutro w-fit flex items-center gap-2" style={{ cursor: "pointer" }}>
            <ImagePlus size={16} />
            {fotoPost ? fotoPost.name : "Escolher foto (opcional)"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => setFotoPost(e.target.files?.[0] ?? null)}
            />
          </label>

          <button className="btn btn-social" onClick={() => void publicar()} disabled={publicando}>
            {publicando ? "Publicando…" : "Publicar"}
          </button>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="vazio">
          <p>Ainda não tem nada aqui.</p>
          <p className="text-sm text-ink-muted">
            Siga alguém pra ver os posts na sua timeline.
          </p>
          <Link to="/grupo/descobrir" className="btn btn-social">
            Descobrir pessoas
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <div key={post.id} className="card flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Link to={`/grupo/perfil/${post.autorId}`} className="flex items-center gap-2 min-w-0 flex-1">
                  <Avatar nome={post.autorNome} fotoUrl={post.autorFotoUrl} />
                  <div className="min-w-0">
                    <div className="h3">{post.autorNome}</div>
                    <div className="text-xs text-ink-terciario">{formatarQuando(post.criadoEm)}</div>
                  </div>
                </Link>
                {post.autorId === userId && (
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
    </>
  );
}
