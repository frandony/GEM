import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronDown, Copy, ImagePlus, Trash2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import { Avatar } from "../componentes/Avatar";
import {
  carregarGrupo,
  carregarMembrosDoGrupo,
  carregarPerfil,
  carregarResumoDoPlano,
  carregarUltimosDiasDoMembro,
  sairDoGrupo,
  type DiaDoMembro,
  type Grupo as GrupoTipo,
  type MembroDoGrupo,
  type ResumoDoPlano,
} from "../lib/dados";
import {
  carregarFeedDoGrupo,
  criarPost,
  definirReacao,
  excluirPost,
  type PostDoGrupo,
  type Reacao,
  type TagPost,
} from "../lib/feedGrupo";

/* =====================================================================
   Detalhe do grupo.
   =====================================================================
   O card na lista de grupos parecia clicável e não era. Em vez de tirar a
   aparência de clicável, ganhou destino — porque existe conteúdo que a
   RLS libera para membros do mesmo grupo e que não aparecia em tela
   nenhuma:

   - `programas` / `sessoes` / `sessao_exercicios` → o PLANO do colega
   - `resumos_diarios` → treinou / minutos de estudo por dia

   O que continua privado, e não entra aqui: `treino_sessoes`,
   `series_registros` e `semanas_resumo`. Carga levantada é de quem
   levantou; o grupo vê constância, não desempenho.
   ===================================================================== */

const DIAS_CURTOS = ["D", "S", "T", "Q", "Q", "S", "S"];

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
    suficiente pra situar o post, sem hora exata que ninguém precisa. */
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

export function DetalheGrupo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const { id: grupoId } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [grupo, setGrupo] = useState<GrupoTipo | null>(null);
  const [membros, setMembros] = useState<MembroDoGrupo[]>([]);
  const [dias, setDias] = useState<Record<string, DiaDoMembro[]>>({});
  const [expandido, setExpandido] = useState<string | null>(null);
  const [planos, setPlanos] = useState<Record<string, ResumoDoPlano | null>>({});
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);

  // Feed — conteúdo principal da tela agora, carregado junto com
  // grupo/membros (não é enriquecimento tardio como a faixa de 7 dias).
  const [posts, setPosts] = useState<PostDoGrupo[]>([]);
  const [criandoPost, setCriandoPost] = useState(false);
  const [fotoPost, setFotoPost] = useState<File | null>(null);
  const [legendaPost, setLegendaPost] = useState("");
  const [tagPost, setTagPost] = useState<TagPost>("treino");
  const [publicando, setPublicando] = useState(false);
  const formPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!grupoId) return;
    let ativo = true;
    (async () => {
      try {
        const perfil = await carregarPerfil(userId);
        const tz = perfil?.timezone ?? "America/Sao_Paulo";
        const [g, ms, ps] = await Promise.all([
          carregarGrupo(grupoId),
          carregarMembrosDoGrupo(grupoId, tz),
          carregarFeedDoGrupo(grupoId, userId),
        ]);
        if (!ativo) return;
        setGrupo(g);
        setMembros(ms);
        setPosts(ps);
        setCarregando(false);

        // A faixa de 7 dias entra depois: a tela já pinta com nome e streak,
        // e são N requisições que só enriquecem a linha.
        const entradas = await Promise.all(
          ms.map(
            async (m) => [m.user_id, await carregarUltimosDiasDoMembro(m.user_id, tz)] as const,
          ),
        );
        if (ativo) setDias(Object.fromEntries(entradas));
      } catch (e) {
        // Sem isto, uma falha de leitura cairia no "Grupo não encontrado",
        // que sugere que o grupo foi apagado ou que você foi removido dele.
        if (!ativo) return;
        setFalhou(e instanceof Error ? e.message : "Não deu para carregar o grupo.");
        setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [grupoId, userId]);

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
      const euMesmo = membros.find((m) => m.user_id === userId);
      const post = await criarPost(
        grupoId,
        userId,
        euMesmo?.nome ?? "Você",
        euMesmo?.foto_url ?? null,
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

  async function copiarCodigo() {
    if (!grupo) return;
    try {
      // `navigator.clipboard` só existe em contexto seguro (https ou
      // localhost). No fallback o código vai no próprio toast, que dá
      // para ler e digitar — melhor que um erro sem saída.
      if (!navigator.clipboard) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(grupo.codigo_convite);
      toast.sucesso("Código copiado.");
    } catch {
      toast.erro(`Não deu para copiar. O código é ${grupo.codigo_convite}`);
    }
  }

  async function alternarMembro(membroId: string) {
    if (expandido === membroId) {
      setExpandido(null);
      return;
    }
    setExpandido(membroId);
    if (!(membroId in planos)) {
      const plano = await carregarResumoDoPlano(membroId);
      setPlanos((atual) => ({ ...atual, [membroId]: plano }));
    }
  }

  async function sair() {
    if (!grupoId) return;
    setSaindo(true);
    try {
      await sairDoGrupo(grupoId, userId);
      toast.sucesso("Você saiu do grupo.");
      navegar("/grupo", { replace: true });
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para sair do grupo.");
      setSaindo(false);
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
        <h1 className="h1">{grupo.nome}</h1>
      </header>

      {/* Código de convite. Ele existe para ser passado adiante e não era
          copiável — quem convidava alguém tinha que transcrever à mão. */}
      <div className="card mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="rotulo-secao text-ink-muted mb-1">Código de convite</span>
          <div className="display text-3xl num">{grupo.codigo_convite}</div>
        </div>
        <button className="btn btn-neutro shrink-0" onClick={() => void copiarCodigo()}>
          <Copy size={16} /> Copiar
        </button>
      </div>

      {/* ---- Feed --------------------------------------------------------
          Primeira coisa depois do cabeçalho, de propósito: é o que a
          pessoa vê ao abrir o grupo. Lista de membros, plano e sair do
          grupo continuam abaixo, sem mudar de comportamento. */}
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

          <button className="btn btn-social" onClick={() => void publicarPost()} disabled={publicando}>
            {publicando ? "Publicando…" : "Publicar"}
          </button>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="vazio mb-8">
          <p>Ninguém postou ainda — seja o primeiro.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-8">
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

      <span className="rotulo-secao text-ink-muted mb-2 block">
        {membros.length} {membros.length === 1 ? "membro" : "membros"}
      </span>
      <div className="flex flex-col gap-3 mb-8">
        {membros.map((m) => {
          const aberto = expandido === m.user_id;
          const plano = planos[m.user_id];
          const faixa = dias[m.user_id];
          return (
            <div key={m.user_id} className="card" style={{ padding: 0 }}>
              <button
                type="button"
                className="w-full text-left flex items-center justify-between gap-3"
                style={{ padding: "var(--e-4)" }}
                onClick={() => void alternarMembro(m.user_id)}
                aria-expanded={aberto}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h3">{m.nome}</span>
                    {m.user_id === userId && <span className="badge badge-estudo">você</span>}
                    {m.treinou_hoje && <span className="badge badge-ok">treinou hoje</span>}
                  </div>
                  <div className="text-xs text-ink-terciario num">
                    {m.streak} {m.streak === 1 ? "semana" : "semanas"} seguidas
                  </div>
                  {faixa && (
                    <div className="flex gap-1 mt-2" aria-label="Últimos 7 dias">
                      {faixa.map((d, i) => (
                        <span
                          key={d.data}
                          className="dia-ponto"
                          data-treinou={d.treinou || undefined}
                          data-estudou={d.minutosEstudo > 0 || undefined}
                          title={`${d.data}: ${d.treinou ? "treinou" : "sem treino"}${
                            d.minutosEstudo > 0 ? `, ${d.minutosEstudo} min de estudo` : ""
                          }`}
                        >
                          {DIAS_CURTOS[new Date(`${d.data}T12:00:00`).getDay()] ?? DIAS_CURTOS[i]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ChevronDown
                  size={18}
                  className="text-ink-muted shrink-0"
                  style={{
                    transform: aberto ? "rotate(180deg)" : "none",
                    transition: "transform var(--d-entrar) var(--ease-out)",
                  }}
                />
              </button>

              {aberto && (
                <div style={{ padding: "0 var(--e-4) var(--e-4)" }}>
                  {plano === undefined ? (
                    <div className="skeleton" style={{ height: "3rem" }} />
                  ) : plano === null ? (
                    <p className="text-sm text-ink-muted">
                      {m.user_id === userId
                        ? "Você ainda não montou seu plano."
                        : "Ainda não montou um plano de treino."}
                    </p>
                  ) : (
                    <div
                      style={{ borderTop: "1px solid var(--hairline)", paddingTop: "var(--e-3)" }}
                    >
                      <div className="text-xs text-ink-terciario mb-2">
                        Divisão {plano.divisao} · ênfase {plano.enfase} ·{" "}
                        {plano.frequenciaSemanal}× por semana
                      </div>
                      <div className="flex flex-col gap-1">
                        {plano.sessoes.map((s) => (
                          <div key={s.letra} className="flex justify-between text-sm">
                            <span>
                              {s.letra} — {s.nome}
                            </span>
                            <span className="text-ink-terciario num shrink-0">
                              {s.totalExercicios} ex.
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Zona de perigo — mesmo padrão de EditarPlano: dois passos, e o
          segundo diz o que acontece de fato. */}
      <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: "var(--e-4)" }}>
        {!confirmandoSaida ? (
          <button className="btn btn-perigo" onClick={() => setConfirmandoSaida(true)}>
            Sair do grupo
          </button>
        ) : (
          <div className="card" role="alertdialog" aria-label="Confirmar saída do grupo">
            <p className="mb-1">Sair de "{grupo.nome}"?</p>
            <p className="text-sm text-ink-muted mb-4">
              Seu treino, seu histórico e seu streak continuam intactos — você só deixa de ver
              o pessoal daqui, e eles de ver você. Dá para voltar com o código de convite.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-perigo" onClick={() => void sair()} disabled={saindo}>
                {saindo ? "Saindo…" : "Sim, sair"}
              </button>
              <button className="btn btn-neutro" onClick={() => setConfirmandoSaida(false)}>
                Ficar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
