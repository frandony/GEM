import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  carregarDetalheSessaoTreino,
  carregarHistoricoTreinos,
  type ExercicioDoHistorico,
  type SessaoHistorico,
} from "../lib/dados";

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

function formatarData(data: string): string {
  // `data` é `date` puro (sem hora) — fixar meio-dia evita que o fuso
  // local jogue o dia pra trás na formatação (mesmo risco de `new
  // Date("2026-08-10")`, que o resto do app já evita com este padrão).
  const texto = FORMATO_DATA.format(new Date(`${data}T12:00:00`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarDuracao(iniciadaEm: string, finalizadaEm: string | null): string | null {
  if (!finalizadaEm) return null;
  const min = Math.round((new Date(finalizadaEm).getTime() - new Date(iniciadaEm).getTime()) / 60000);
  return min > 0 ? `${min} min` : null;
}

export function HistoricoTreinos() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [sessoes, setSessoes] = useState<SessaoHistorico[]>([]);
  const [pagina, setPagina] = useState(0);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Record<string, ExercicioDoHistorico[]>>({});

  useEffect(() => {
    void carregarHistoricoTreinos(userId, 0).then(({ sessoes: s, temMais: t }) => {
      setSessoes(s);
      setTemMais(t);
      setCarregando(false);
    });
  }, [userId]);

  async function carregarMais() {
    setCarregandoMais(true);
    const proxima = pagina + 1;
    const { sessoes: s, temMais: t } = await carregarHistoricoTreinos(userId, proxima);
    setSessoes((atual) => [...atual, ...s]);
    setPagina(proxima);
    setTemMais(t);
    setCarregandoMais(false);
  }

  async function alternar(sessaoId: string) {
    if (expandido === sessaoId) {
      setExpandido(null);
      return;
    }
    setExpandido(sessaoId);
    if (!detalhes[sessaoId]) {
      const d = await carregarDetalheSessaoTreino(sessaoId);
      setDetalhes((atual) => ({ ...atual, [sessaoId]: d }));
    }
  }

  return (
    <div className="tela">
      <header className="mb-4">
        <Link className="flex items-center text-sm text-ink-muted mb-1 w-fit" to="/treino">
          <ChevronLeft size={16} /> Treino
        </Link>
        <h1 className="h1">Histórico</h1>
      </header>

      {carregando ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton" style={{ height: "5rem" }} />
          <div className="skeleton" style={{ height: "5rem" }} />
          <div className="skeleton" style={{ height: "5rem" }} />
        </div>
      ) : sessoes.length === 0 ? (
        <div className="vazio">
          <p>Nenhum treino registrado ainda.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-4">
            {sessoes.map((s) => (
              <SessaoCard
                key={s.id}
                sessao={s}
                aberto={expandido === s.id}
                detalhe={detalhes[s.id]}
                onAlternar={() => void alternar(s.id)}
              />
            ))}
          </div>

          {temMais && (
            <button className="btn btn-neutro" onClick={() => void carregarMais()} disabled={carregandoMais}>
              {carregandoMais ? "Carregando…" : "Carregar mais"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SessaoCard({
  sessao,
  aberto,
  detalhe,
  onAlternar,
}: {
  sessao: SessaoHistorico;
  aberto: boolean;
  detalhe: ExercicioDoHistorico[] | undefined;
  onAlternar: () => void;
}) {
  const duracao = formatarDuracao(sessao.iniciadaEm, sessao.finalizadaEm);

  return (
    <div className="card" style={{ padding: 0 }}>
      <button
        type="button"
        className="w-full text-left flex items-center justify-between gap-3"
        style={{ padding: "var(--e-4)" }}
        onClick={onAlternar}
        aria-expanded={aberto}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="h3">
              {sessao.sessaoLetra ? `Treino ${sessao.sessaoLetra}` : "Treino"}
              {sessao.sessaoNome ? ` — ${sessao.sessaoNome}` : ""}
            </span>
            {sessao.status === "abandonada" && <span className="badge badge-atencao">abandonado</span>}
          </div>
          <div className="text-xs text-ink-terciario num">
            {formatarData(sessao.data)}
            {duracao && ` · ${duracao}`}
            {sessao.totalSeries > 0 && ` · ${sessao.totalSeries} séries`}
            {sessao.volumeKg > 0 && ` · ${(sessao.volumeKg / 1000).toFixed(1)}t`}
          </div>
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
          {!detalhe ? (
            <div className="skeleton" style={{ height: "3rem" }} />
          ) : detalhe.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma série registrada nesta sessão.</p>
          ) : (
            <div
              className="flex flex-col gap-3"
              style={{ borderTop: "1px solid var(--hairline)", paddingTop: "var(--e-3)" }}
            >
              {detalhe.map((ex) => (
                <div key={ex.exercicioId}>
                  <div className="text-sm mb-1">{ex.nome}</div>
                  <div className="flex gap-2 flex-wrap">
                    {ex.series.map((serie) => (
                      <span
                        key={serie.numeroSerie}
                        className="chip num"
                        style={{ background: "var(--surface-alta)" }}
                      >
                        {serie.duracaoSeg != null
                          ? `${serie.duracaoSeg}s`
                          : `${serie.reps ?? "—"}×${serie.cargaKg ?? "—"}`}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
