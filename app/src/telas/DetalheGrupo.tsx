import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ImagePlus, Send, Trash2, Users, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import { Avatar } from "../componentes/Avatar";
import { carregarGrupo, carregarPerfil, type Grupo as GrupoTipo } from "../lib/dados";
import {
  carregarFeedDoGrupo,
  criarPost,
  definirReacao,
  excluirPost,
  type PostDoGrupo,
  type Reacao,
  type TagPost,
} from "../lib/feedGrupo";
import {
  carregarMensagens,
  enviarMensagem,
  excluirMensagem,
  type MensagemGrupo,
} from "../lib/chatGrupo";

/* =====================================================================
   Detalhe do grupo — Feed e Chat.
   =====================================================================
   Só conteúdo consumido o tempo todo mora aqui, em abas (troca instantânea,
   sem navegação). Código de convite, integrantes e "sair do grupo" viraram
   a tela própria `PessoasGrupo`, aberta pelo botão "Pessoas" no cabeçalho
   — é administração, não conteúdo, e não precisa competir por espaço aqui.

   Carga de `grupo` é a ÚNICA que bloqueia a tela inteira. Feed e chat
   carregam cada um no seu próprio try/catch: uma falha num não pode
   esconder o outro nem o cabeçalho (bug corrigido nesta versão — antes
   os três viviam num só `Promise.all`, e qualquer falha no feed derrubava
   a tela toda, cabeçalho incluso).
   ===================================================================== */

const REACOES: Reacao[] = ["🔥", "💪", "📚", "✅"];

/** Cor do chip por tag — treino/estudo reaproveitam a identidade do
    próprio módulo; dica usa a identidade do Social; refeição usa
    atenção (laranja, já existia) em vez de inventar uma quinta cor. */
const CHIP_DA_TAG: Record<TagPost, string> = {
  treino: "treino",
  estudo: "estudo",
  dica: "social",
  refeição: "atencao",
};

/** "agora" / "há 12min" / "há 3h" / "ontem" / "há 5d" / "12/08" — só o
    suficiente pra situar o post ou a mensagem, sem hora exata. */
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

/** Poll simples, sem Realtime (zero uso no projeto hoje — ver decisão em
    CLAUDE.md/plano). Só roda com a aba de chat aberta e a página visível,
    mesmo espírito de `iniciarSincronizacao` em fila.ts. */
const POLL_CHAT_MS = 5000;

type Aba = "feed" | "chat";

export function DetalheGrupo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const { id: grupoId } = useParams<{ id: string }>();
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [grupo, setGrupo] = useState<GrupoTipo | null>(null);
  const [meuNome, setMeuNome] = useState("Você");
  const [meuFotoUrl, setMeuFotoUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  const [aba, setAba] = useState<Aba>("feed");

  // Feed
  const [posts, setPosts] = useState<PostDoGrupo[]>([]);
  const [feedFalhou, setFeedFalhou] = useState<string | null>(null);
  const [criandoPost, setCriandoPost] = useState(false);
  const [fotoPost, setFotoPost] = useState<File | null>(null);
  const [legendaPost, setLegendaPost] = useState("");
  const [tagPost, setTagPost] = useState<TagPost>("treino");
  const [publicando, setPublicando] = useState(false);
  const formPostRef = useRef<HTMLDivElement>(null);

  // Chat
  const [mensagens, setMensagens] = useState<MensagemGrupo[]>([]);
  const [chatCarregado, setChatCarregado] = useState(false);
  const [chatFalhou, setChatFalhou] = useState<string | null>(null);
  const [textoMsg, setTextoMsg] = useState("");
  const [enviandoMsg, setEnviandoMsg] = useState(false);
  const fimDoChatRef = useRef<HTMLDivElement>(null);

  // Cabeçalho: nome do grupo + o próprio perfil (autor de post/mensagem).
  // Única carga que legitimamente bloqueia a tela — sem grupo não há nada
  // para mostrar, feed ou chat.
  useEffect(() => {
    if (!grupoId) return;
    let ativo = true;
    (async () => {
      try {
        const [g, perfil] = await Promise.all([carregarGrupo(grupoId), carregarPerfil(userId)]);
        if (!ativo) return;
        setGrupo(g);
        setMeuNome(perfil?.nome ?? "Você");
        setMeuFotoUrl(perfil?.foto_url ?? null);
        setCarregando(false);
      } catch (e) {
        if (!ativo) return;
        setFalhou(e instanceof Error ? e.message : "Não deu para carregar o grupo.");
        setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [grupoId, userId]);

  async function recarregarFeed() {
    if (!grupoId) return;
    setFeedFalhou(null);
    try {
      const ps = await carregarFeedDoGrupo(grupoId, userId);
      setPosts(ps);
    } catch (e) {
      setFeedFalhou(e instanceof Error ? e.message : "Não deu para carregar o feed.");
    }
  }

  useEffect(() => {
    void recarregarFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoId]);

  async function recarregarChat() {
    if (!grupoId) return;
    setChatFalhou(null);
    try {
      const ms = await carregarMensagens(grupoId);
      setMensagens(ms);
      setChatCarregado(true);
    } catch (e) {
      setChatFalhou(e instanceof Error ? e.message : "Não deu para carregar o chat.");
    }
  }

  // Chat carrega sob demanda, só na primeira vez que a aba abre.
  useEffect(() => {
    if (aba !== "chat" || chatCarregado) return;
    void recarregarChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, chatCarregado]);

  // Poll — só com a aba aberta, já carregada, e a página visível.
  useEffect(() => {
    if (aba !== "chat" || !grupoId || !chatCarregado) return;
    const tentar = () => {
      if (document.visibilityState !== "visible") return;
      carregarMensagens(grupoId).then(setMensagens).catch(() => {});
    };
    const intervalo = window.setInterval(tentar, POLL_CHAT_MS);
    return () => window.clearInterval(intervalo);
  }, [aba, grupoId, chatCarregado]);

  useEffect(() => {
    if (aba === "chat") fimDoChatRef.current?.scrollIntoView({ block: "end" });
  }, [aba, mensagens.length]);

  useEffect(() => {
    if (criandoPost) formPostRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [criandoPost]);

  async function publicarPost() {
    if (!grupoId) return;
    if (!fotoPost) {
      toast.erro("Escolha uma foto para o post.");
      return;
    }
    setPublicando(true);
    try {
      const post = await criarPost(
        grupoId,
        userId,
        meuNome,
        meuFotoUrl,
        fotoPost,
        legendaPost,
        tagPost,
      );
      setPosts((atual) => [post, ...atual]);
      setCriandoPost(false);
      setFotoPost(null);
      setLegendaPost("");
      setTagPost("treino");
      toast.sucesso("Post publicado.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para publicar o post.");
    } finally {
      setPublicando(false);
    }
  }

  /** Otimista com rollback, mesmo padrão de `alternarBloco` em
      Estudo.tsx: tocar na mesma reação de novo remove; tocar em outra
      troca — nunca empilha. */
  async function reagir(post: PostDoGrupo, emoji: Reacao) {
    const novaReacao = post.minhaReacao === emoji ? null : emoji;
    const anterior = post.minhaReacao;
    setPosts((atual) => atual.map((p) => (p.id === post.id ? { ...p, minhaReacao: novaReacao } : p)));
    try {
      await definirReacao(post.id, userId, novaReacao);
    } catch (e) {
      setPosts((atual) => atual.map((p) => (p.id === post.id ? { ...p, minhaReacao: anterior } : p)));
      toast.erro(e instanceof Error ? e.message : "Não deu para reagir.");
    }
  }

  /** Sem confirmação de dois passos — mesmo nível de risco que "excluir
      tópico" em Estudo.tsx, não o de "sair do grupo"/"excluir conta". */
  async function excluirPostDoFeed(post: PostDoGrupo) {
    try {
      await excluirPost(post.id, post.fotoPath);
      setPosts((atual) => atual.filter((p) => p.id !== post.id));
      toast.sucesso("Post excluído.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para excluir o post.");
    }
  }

  async function enviarMsg() {
    if (!grupoId) return;
    const texto = textoMsg.trim();
    // Botão nunca desabilita por campo vazio (mesma doutrina de
    // CriarGrupo/EntrarGrupo) — o toque sempre responde, e é o próprio
    // envio que explica o que falta.
    if (!texto) {
      toast.erro("Escreva algo antes de enviar.");
      return;
    }
    setEnviandoMsg(true);
    try {
      const msg = await enviarMensagem(grupoId, userId, meuNome, meuFotoUrl, texto);
      setMensagens((atual) => [...atual, msg]);
      setTextoMsg("");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para enviar a mensagem.");
    } finally {
      setEnviandoMsg(false);
    }
  }

  async function excluirMsg(msg: MensagemGrupo) {
    try {
      await excluirMensagem(msg.id);
      setMensagens((atual) => atual.filter((m) => m.id !== msg.id));
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para excluir a mensagem.");
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
        <Voltar to="/grupo" rotulo="Grupos" className="mb-4" />
        <FalhaAoCarregar mensagem={falhou} onTentarDeNovo={() => window.location.reload()} />
      </div>
    );
  }

  if (!grupo) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-atencao">Grupo não encontrado</span>
          <p>Ele pode ter sido apagado, ou você não é mais membro.</p>
          <Voltar to="/grupo" rotulo="Grupos" />
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <header className="mb-4">
        <Voltar to="/grupo" rotulo="Grupos" className="mb-1" />
        <div className="flex items-center justify-between gap-3">
          <h1 className="h1 min-w-0 truncate">{grupo.nome}</h1>
          <Link to={`/grupo/${grupoId}/pessoas`} className="btn btn-neutro shrink-0">
            <Users size={16} /> Pessoas
          </Link>
        </div>
      </header>

      <div className="tabs mb-4" role="tablist" aria-label="Feed ou chat do grupo">
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
          aria-selected={aba === "chat"}
          onClick={() => setAba("chat")}
        >
          Chat
        </button>
      </div>

      {aba === "feed" ? (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="rotulo-secao text-ink-muted">Feed</span>
            {!criandoPost && (
              <button
                type="button"
                className="text-xs text-social-ink underline"
                onClick={() => setCriandoPost(true)}
              >
                Novo post
              </button>
            )}
          </div>

          {criandoPost && (
            <div ref={formPostRef} className="card mb-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="h3">Novo post</span>
                <button
                  type="button"
                  className="text-ink-muted shrink-0"
                  onClick={() => {
                    setCriandoPost(false);
                    setFotoPost(null);
                  }}
                  aria-label="Cancelar"
                >
                  <X size={20} />
                </button>
              </div>

              <label
                className="btn btn-neutro w-fit flex items-center gap-2"
                style={{ cursor: "pointer" }}
              >
                <ImagePlus size={16} />
                {fotoPost ? fotoPost.name : "Escolher foto"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => setFotoPost(e.target.files?.[0] ?? null)}
                />
              </label>

              <textarea
                className="campo"
                placeholder="Legenda (opcional)"
                rows={2}
                value={legendaPost}
                onChange={(e) => setLegendaPost(e.target.value)}
              />

              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    ["treino", "#treino"],
                    ["estudo", "#estudo"],
                    ["dica", "#dica"],
                    ["refeição", "#refeição"],
                  ] as const
                ).map(([valor, rotulo]) => (
                  <button
                    key={valor}
                    type="button"
                    className={tagPost === valor ? "chip chip-social" : "chip"}
                    onClick={() => setTagPost(valor)}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              <button
                className="btn btn-social"
                onClick={() => void publicarPost()}
                disabled={publicando}
              >
                {publicando ? "Publicando…" : "Publicar"}
              </button>
            </div>
          )}

          {feedFalhou ? (
            <FalhaAoCarregar mensagem={feedFalhou} onTentarDeNovo={() => void recarregarFeed()} />
          ) : posts.length === 0 ? (
            <div className="vazio">
              <p>Ninguém postou ainda — seja o primeiro.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {posts.map((post) => (
                <div key={post.id} className="card flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Avatar nome={post.autorNome} fotoUrl={post.autorFotoUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="h3">{post.autorNome}</div>
                      <div className="text-xs text-ink-terciario">{formatarQuando(post.criadoEm)}</div>
                    </div>
                    {post.autorId === userId && (
                      <button
                        type="button"
                        className="post-excluir"
                        onClick={() => void excluirPostDoFeed(post)}
                        aria-label="Excluir post"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {post.fotoUrl && <img src={post.fotoUrl} alt="" className="post-foto" />}
                  {post.legenda && <p className="text-sm">{post.legenda}</p>}

                  <div className="flex items-center justify-between">
                    <span className={`chip chip-${CHIP_DA_TAG[post.tag]}`}>#{post.tag}</span>
                    <div className="post-reacoes" role="group" aria-label="Reagir ao post">
                      {REACOES.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="post-reacao"
                          aria-pressed={post.minhaReacao === emoji}
                          aria-label={`Reagir com ${emoji}`}
                          onClick={() => void reagir(post, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {chatFalhou ? (
            <FalhaAoCarregar mensagem={chatFalhou} onTentarDeNovo={() => void recarregarChat()} />
          ) : !chatCarregado ? (
            <div className="skeleton" style={{ height: "8rem" }} />
          ) : (
            <>
              {mensagens.length === 0 ? (
                <div className="vazio">
                  <p>Nenhuma mensagem ainda — comece a conversa.</p>
                </div>
              ) : (
                <div className="chat-lista">
                  {mensagens.map((m) => {
                    const minha = m.autorId === userId;
                    return (
                      <div key={m.id} className={minha ? "chat-bolha chat-bolha--eu" : "chat-bolha"}>
                        {!minha && <div className="chat-bolha__autor">{m.autorNome}</div>}
                        <p>{m.texto}</p>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="chat-bolha__hora">{formatarQuando(m.criadoEm)}</span>
                          {minha && (
                            <button
                              type="button"
                              className="post-excluir"
                              onClick={() => void excluirMsg(m)}
                              aria-label="Excluir mensagem"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={fimDoChatRef} />
                </div>
              )}

              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void enviarMsg();
                }}
              >
                <input
                  className="campo"
                  placeholder="Escreva uma mensagem…"
                  value={textoMsg}
                  onChange={(e) => setTextoMsg(e.target.value)}
                  maxLength={2000}
                  aria-label="Mensagem"
                />
                <button
                  className="btn btn-social shrink-0"
                  type="submit"
                  disabled={enviandoMsg}
                  aria-label="Enviar"
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
