import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronDown, ChevronLeft, Copy } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
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

  useEffect(() => {
    if (!grupoId) return;
    let ativo = true;
    (async () => {
      try {
        const perfil = await carregarPerfil(userId);
        const tz = perfil?.timezone ?? "America/Sao_Paulo";
        const [g, ms] = await Promise.all([
          carregarGrupo(grupoId),
          carregarMembrosDoGrupo(grupoId, tz),
        ]);
        if (!ativo) return;
        setGrupo(g);
        setMembros(ms);
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
        <Link className="flex items-center text-sm text-ink-muted mb-4 w-fit" to="/grupo">
          <ChevronLeft size={16} /> Grupos
        </Link>
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
          <Link className="btn btn-neutro" to="/grupo">
            Voltar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <header className="mb-4">
        <Link className="flex items-center text-sm text-ink-muted mb-1 w-fit" to="/grupo">
          <ChevronLeft size={16} /> Grupos
        </Link>
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
