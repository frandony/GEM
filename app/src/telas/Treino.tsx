import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Dumbbell, Flame, History, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../lib/auth";
import { AvisoDeFormulario } from "../componentes/MensagemErro";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { VerTudo } from "../componentes/VerTudo";
import { SessaoTreino, type ExercicioDaSessao } from "./SessaoTreino";
import {
  abandonarTreinoSessao,
  carregarExerciciosDaSessao,
  carregarHistoricoTreinos,
  carregarPerfil,
  carregarProgramaAtivo,
  carregarResumoDoPlano,
  carregarResumoSemanal,
  finalizarTreinoSessao,
  iniciarTreinoSessao,
  sessaoEmAndamento,
  type ProximaSessao,
  type ResumoDoPlano,
  type ResumoSemanal,
  type SessaoHistorico,
} from "../lib/dados";

type Estado =
  | { fase: "carregando" }
  | { fase: "sem-plano" }
  | { fase: "ocioso"; proxima: ProximaSessao | null; timezone: string }
  | {
      fase: "ativo";
      treinoSessaoId: string;
      letra: string;
      exercicios: ExercicioDaSessao[];
      timezone: string;
    }
  // Sessão aberta (ex: reload no meio do treino) sem exercício nenhum
  // carregado — sem isto, a tela ficava em branco: SessaoTreino recebe
  // lista vazia e faz `return null` silenciosamente.
  | { fase: "erro"; mensagem: string; treinoSessaoIdParaAbandonar: string | null }
  | { fase: "falhou"; mensagem: string };

/** Tudo que enriquece a tela mas não decide se ela pinta. Carregado
    depois do essencial, e cada peça pode faltar sozinha. */
interface Extras {
  resumo: ResumoSemanal | null;
  plano: ResumoDoPlano | null;
  ultimos: SessaoHistorico[];
}

const CORES_TREINO = {
  "--tile-cor": "var(--treino-ink)",
  "--tile-cor-fraca": "var(--treino-fraco)",
} as CSSProperties;

const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

export function Treino() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [erro, setErro] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extras>({ resumo: null, plano: null, ultimos: [] });
  // Trava o botão enquanto a sessão está sendo aberta — sem isto, um
  // segundo toque (ex: tela sem retorno visual) tenta abrir outra
  // treino_sessoes enquanto a primeira ainda não sincronizou, e o índice
  // único de "uma sessão aberta por vez" rejeita a segunda.
  const [iniciando, setIniciando] = useState(false);

  async function carregar() {
    setEstado({ fase: "carregando" });
    try {
      const perfil = await carregarPerfil(userId);
      if (!perfil) {
        setEstado({ fase: "sem-plano" });
        return;
      }

      const emAndamento = await sessaoEmAndamento(userId);
      if (emAndamento?.sessao_id) {
        const exercicios = await carregarExerciciosDaSessao(emAndamento.sessao_id);
        if (exercicios.length === 0) {
          setEstado({
            fase: "erro",
            mensagem:
              "Não consegui carregar os exercícios da sua sessão em andamento. " +
              "Você pode abandonar este treino e começar de novo.",
            treinoSessaoIdParaAbandonar: emAndamento.id,
          });
          return;
        }
        setEstado({
          fase: "ativo",
          treinoSessaoId: emAndamento.id,
          letra: emAndamento.sessao_letra ?? "",
          exercicios,
          timezone: perfil.timezone,
        });
        return;
      }

      const dados = await carregarProgramaAtivo(userId);
      if (!dados) {
        setEstado({ fase: "sem-plano" });
        return;
      }
      setEstado({ fase: "ocioso", proxima: dados.proxima, timezone: perfil.timezone });

      // Enriquecimento depois do primeiro paint: a decisão da tela
      // ("iniciar treino") não espera por resumo nem histórico.
      void carregarExtras(perfil.timezone);
    } catch (e) {
      // Distinto de "sem-plano": mandar montar um plano para quem já tem
      // um, por causa de uma consulta que falhou, é o pior desfecho.
      setEstado({
        fase: "falhou",
        mensagem: e instanceof Error ? e.message : "Não deu para carregar seu treino.",
      });
    }
  }

  async function carregarExtras(timezone: string) {
    const [resumo, plano, historico] = await Promise.all([
      carregarResumoSemanal(userId, timezone).catch(() => null),
      carregarResumoDoPlano(userId).catch(() => null),
      carregarHistoricoTreinos(userId, 0).catch(() => ({ sessoes: [], temMais: false })),
    ]);
    setExtras({ resumo, plano, ultimos: historico.sessoes.slice(0, 3) });
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function iniciar(proxima: ProximaSessao, timezone: string) {
    if (iniciando) return;
    setErro(null);
    setIniciando(true);
    try {
      const treinoSessaoId = await iniciarTreinoSessao(userId, timezone, proxima);
      const exercicios = await carregarExerciciosDaSessao(proxima.id);
      if (exercicios.length === 0) {
        setErro("Essa sessão não tem exercícios cadastrados.");
        return;
      }
      setEstado({ fase: "ativo", treinoSessaoId, letra: proxima.letra, exercicios, timezone });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para iniciar o treino.");
    } finally {
      setIniciando(false);
    }
  }

  /* A sessão em andamento ocupa a tela inteira — é a única fase sem o
     cabeçalho de navegação, porque ali a pessoa está levantando peso. */
  if (estado.fase === "ativo") {
    return (
      <SessaoTreino
        treinoSessaoId={estado.treinoSessaoId}
        letra={estado.letra}
        exercicios={estado.exercicios}
        aoFinalizar={() => {
          void finalizarTreinoSessao(estado.treinoSessaoId).finally(() => void carregar());
        }}
        aoAbandonar={(exercicioAtualId) => {
          void abandonarTreinoSessao(estado.treinoSessaoId, exercicioAtualId).finally(
            () => void carregar(),
          );
        }}
      />
    );
  }

  return (
    <div className="tela">
      {/* O cabeçalho fica FORA dos ramos de estado. Antes ele vivia só no
          ramo "ocioso", então quem não tinha plano — justamente quem mais
          iria olhar o histórico — não tinha caminho nenhum até ele. */}
      <header className="mb-4">
        <span className="text-sm text-ink-muted">Musculação</span>
        <h1 className="h1">Treino</h1>
      </header>

      {estado.fase !== "carregando" && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Link to="/treino/historico" className="action-tile" style={CORES_TREINO}>
            <span className="action-tile__icone">
              <History size={20} />
            </span>
            <div>
              <div className="action-tile__label">Histórico</div>
              <div className="action-tile__sub">Treinos que você já fez</div>
            </div>
          </Link>
          <Link to="/treino/plano" className="action-tile" style={CORES_TREINO}>
            <span className="action-tile__icone">
              <SlidersHorizontal size={20} />
            </span>
            <div>
              <div className="action-tile__label">Meu plano</div>
              <div className="action-tile__sub">Ajustar séries e trocar</div>
            </div>
          </Link>
        </div>
      )}

      {estado.fase === "carregando" && (
        <>
          <div className="skeleton mb-3" style={{ height: "5rem" }} />
          <div className="skeleton" style={{ height: "9rem" }} />
        </>
      )}

      {estado.fase === "falhou" && (
        <FalhaAoCarregar mensagem={estado.mensagem} onTentarDeNovo={() => void carregar()} />
      )}

      {estado.fase === "sem-plano" && (
        <div className="vazio">
          <span className="badge badge-treino">Sem treino montado</span>
          <p>Monte seu plano — leva menos de um minuto para configurar.</p>
          <Link className="btn btn-treino" to="/onboarding">
            Montar treino
          </Link>
        </div>
      )}

      {estado.fase === "erro" && (
        <div className="vazio">
          <span className="badge badge-atencao">Algo deu errado</span>
          <p>{estado.mensagem}</p>
          {estado.treinoSessaoIdParaAbandonar && (
            <button
              className="btn btn-perigo"
              onClick={() => {
                void abandonarTreinoSessao(estado.treinoSessaoIdParaAbandonar!, null).finally(
                  () => void carregar(),
                );
              }}
            >
              Abandonar treino
            </button>
          )}
        </div>
      )}

      {estado.fase === "ocioso" && (
        <>
          {estado.proxima ? (
            <div className="card card-treino mb-6">
              <span className="rotulo-secao text-treino-ink mb-1">Próxima sessão</span>
              <div className="h2 mb-4">
                Treino {estado.proxima.letra} — {estado.proxima.nome}
              </div>
              {erro && (
                <div className="mb-3">
                  <AvisoDeFormulario>{erro}</AvisoDeFormulario>
                </div>
              )}
              <button
                className="btn btn-treino btn-bloco"
                onClick={() => void iniciar(estado.proxima!, estado.timezone)}
                disabled={iniciando}
              >
                {iniciando ? "Iniciando…" : "Iniciar treino"}
              </button>
            </div>
          ) : (
            <div className="vazio mb-6">
              <p>Seu plano não tem sessões configuradas.</p>
              <Link className="btn btn-neutro" to="/treino/plano">
                Ver o plano
              </Link>
            </div>
          )}

          {/* ---- O que preenchia o vazio da tela ----------------------
              Três blocos, todos de dado que já existia e não era mostrado
              em lugar nenhum: como vai a semana, qual é o rodízio, e o que
              foi feito por último. */}
          {extras.resumo && (
            <div className="flex gap-3 overflow-x-auto pb-1 mb-6" style={{ scrollbarWidth: "none" }}>
              <div className="stat-pill">
                <div className="stat-pill-valor num">
                  {extras.resumo.treinosFeitos}/{extras.resumo.treinosMeta || "–"}
                </div>
                <div className="stat-pill-rotulo">Treinos na semana</div>
              </div>
              <div className="stat-pill">
                <div className="stat-pill-valor num">{extras.resumo.minutosTreino}</div>
                <div className="stat-pill-rotulo">Minutos</div>
              </div>
              <div className="stat-pill">
                <div className="stat-pill-valor num">
                  {(extras.resumo.volumeKg / 1000).toFixed(1)}t
                </div>
                <div className="stat-pill-rotulo">Volume levantado</div>
              </div>
            </div>
          )}

          {extras.plano && extras.plano.sessoes.length > 0 && (
            <section className="mb-6">
              <span className="rotulo-secao text-ink-muted mb-2 block">Seu rodízio</span>
              <div className="card">
                {extras.plano.sessoes.map((s) => {
                  const eProxima = s.letra === estado.proxima?.letra;
                  return (
                    <div
                      key={s.letra}
                      className="exercise-row"
                      style={{ opacity: eProxima ? 1 : 0.55 }}
                    >
                      <span
                        className="exercise-row__icone"
                        style={
                          eProxima
                            ? { background: "var(--treino-fraco)", color: "var(--treino-ink)" }
                            : undefined
                        }
                      >
                        <Dumbbell size={18} />
                      </span>
                      <div className="exercise-row__texto">
                        <div className="h3">
                          Treino {s.letra} — {s.nome}
                        </div>
                        <div className="text-xs text-ink-terciario num">
                          {s.totalExercicios} exercícios
                        </div>
                      </div>
                      {eProxima && <span className="badge badge-treino shrink-0">próximo</span>}
                    </div>
                  );
                })}
                <div className="text-xs text-ink-terciario mt-3">
                  Divisão {extras.plano.divisao} · ênfase {extras.plano.enfase} ·{" "}
                  {extras.plano.frequenciaSemanal}× por semana
                </div>
              </div>
            </section>
          )}

          {extras.ultimos.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="rotulo-secao text-ink-muted">Últimos treinos</span>
                <VerTudo to="/treino/historico" />
              </div>
              <div className="card">
                {extras.ultimos.map((s) => (
                  <div key={s.id} className="subject-row" style={{ "--cor": "var(--treino)" } as CSSProperties}>
                    <span className="subject-row__cor" />
                    <div className="subject-row__texto">
                      <div className="h3">
                        {s.sessaoLetra ? `Treino ${s.sessaoLetra}` : "Treino"}
                        {s.sessaoNome ? ` — ${s.sessaoNome}` : ""}
                      </div>
                      <div className="text-xs text-ink-terciario num">
                        {FORMATO_DIA.format(new Date(`${s.data}T12:00:00`))}
                        {s.totalSeries > 0 && ` · ${s.totalSeries} séries`}
                        {s.volumeKg > 0 && ` · ${(s.volumeKg / 1000).toFixed(1)}t`}
                      </div>
                    </div>
                    {s.status === "abandonada" ? (
                      <span className="badge badge-atencao shrink-0">abandonado</span>
                    ) : (
                      <span className="badge badge-ok shrink-0">
                        <Flame size={12} /> feito
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Só aparece para quem ainda não tem histórico nenhum: sem isto,
              a tela de quem acabou de montar o plano fica com um vão grande
              embaixo do card de iniciar. */}
          {extras.ultimos.length === 0 && extras.resumo !== null && (
            <div className="vazio">
              <span className="badge badge-treino">Primeiro treino</span>
              <p>
                Assim que você concluir a primeira sessão, o histórico e o volume da semana
                aparecem aqui.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
