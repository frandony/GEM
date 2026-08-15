import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarBlocosDoDia,
  carregarExerciciosDaSessao,
  carregarMaterias,
  carregarPerfil,
  carregarProgramaAtivo,
  carregarResumoSemanal,
  corDaDisciplina,
  hojeNoFuso,
  type BlocoEstudo,
  type Materia,
  type Perfil,
  type ProximaSessao,
  type ResumoSemanal,
} from "../lib/dados";
import type { ExercicioDaSessao } from "./SessaoTreino";
import { BarChart3, Dumbbell, Download, Play, Settings, Timer } from "lucide-react";
import { baixarComoJson, exportarDadosDoUsuario } from "../lib/exportarDados";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";

/** "Francisco Vasconcelos" → "FV". Só letras — número ou emoji no nome
    (existe gente assim) não vira parte da inicial. */
function iniciais(nome: string): string {
  const letras = nome
    .split(/\s+/)
    .map((p) => p.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  return ((letras[0] ?? "") + (letras[letras.length - 1] ?? "")).toUpperCase() || "?";
}

export function Home() {
  const { sessao, sair } = useAuth();
  const userId = sessao!.user.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [proxima, setProxima] = useState<ProximaSessao | null>(null);
  const [exercicios, setExercicios] = useState<ExercicioDaSessao[] | null>(null);
  const [treinouHoje, setTreinouHoje] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [resumo, setResumo] = useState<ResumoSemanal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const toast = useToast();

  async function carregar() {
    setFalhou(null);
    try {
      const p = await carregarPerfil(userId);
      if (!p) {
        setFalhou("Seu perfil ainda não foi criado. Saia e entre de novo.");
        return;
      }
      setPerfil(p);

      const hoje = hojeNoFuso(p.timezone);
      const [programa, resumoDia, s, resumoSemanal] = await Promise.all([
        carregarProgramaAtivo(userId),
        supabase.from("resumos_diarios").select("treinou").eq("user_id", userId).eq("data", hoje).maybeSingle(),
        supabase.rpc("streak_de", { p_user_id: null }),
        carregarResumoSemanal(userId, p.timezone),
      ]);
      setProxima(programa?.proxima ?? null);
      setTreinouHoje(resumoDia.data?.treinou ?? false);
      setStreak((s.data as number) ?? 0);
      setResumo(resumoSemanal);

      // Exercícios da próxima sessão e blocos de estudo de hoje entram
      // depois: a tela já pinta com o resto, essas duas listas só enriquecem
      // os cards — não vale atrasar o primeiro paint por elas.
      if (programa?.proxima) {
        void carregarExerciciosDaSessao(programa.proxima.id).then(setExercicios);
      }
      if (p.usa_estudo) {
        void Promise.all([carregarBlocosDoDia(userId, hoje), carregarMaterias(userId)])
          .then(([bs, ms]) => {
            setBlocos(bs);
            setMaterias(ms);
          })
          // Enriquecimento: falhar aqui não pode derrubar a Home inteira,
          // mas também não pode sumir sem deixar rastro no console.
          .catch((e) => console.warn("blocos/matérias da Home indisponíveis:", e));
      }
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar sua Início.");
    } finally {
      // No `finally`, sempre. Antes o `return` do perfil nulo pulava esta
      // linha e a tela ficava presa no skeleton PARA SEMPRE — sem
      // mensagem, sem retry, e sem o botão de exportar que vive no rodapé.
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function exportar() {
    setExportando(true);
    try {
      const dados = await exportarDadosDoUsuario(userId);
      const hoje = hojeNoFuso(perfil?.timezone ?? "America/Sao_Paulo");
      baixarComoJson(dados, `megs-digital-backup-${hoje}.json`);
      // O download é silencioso em boa parte dos navegadores (vai direto
      // pra pasta, sem diálogo) — sem isto, o toque no botão não produz
      // nada visível dentro do app.
      toast.sucesso("Backup baixado.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para gerar o backup.");
    } finally {
      setExportando(false);
    }
  }

  if (carregando) {
    return (
      <div className="tela">
        <div className="flex items-center justify-between mb-6">
          <div className="skeleton" style={{ width: "10rem", height: "2.5rem" }} />
          <div className="skeleton" style={{ width: "2.25rem", height: "2.25rem", borderRadius: "999px" }} />
        </div>
        <div className="flex flex-col gap-3">
          <div className="skeleton" style={{ height: "11rem" }} />
          <div className="skeleton" style={{ height: "9rem" }} />
        </div>
      </div>
    );
  }

  if (falhou || !perfil) {
    return (
      <div className="tela">
        <FalhaAoCarregar
          mensagem={falhou ?? "Não deu para carregar sua Início."}
          onTentarDeNovo={() => {
            setCarregando(true);
            void carregar();
          }}
        />
      </div>
    );
  }

  const blocosFeitos = blocos.filter((b) => b.status !== "pendente").length;
  const progressoEstudo = blocos.length > 0 ? blocosFeitos / blocos.length : 0;

  // A Home não acompanha série a série (isso é papel do SessaoTreino) —
  // o progresso aqui é binário: já treinou hoje, ou ainda não.
  const progressoTreino = treinouHoje ? 1 : 0;

  return (
    <div className="tela">
      <header className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-ink-muted">Olá,</div>
          <h1 className="h1">{perfil.nome}</h1>
        </div>
        <div className="flex items-center gap-3">
          {streak != null && streak > 0 && (
            <div className="text-right">
              <div className="display text-3xl text-ok-ink">{streak}</div>
              <span className="rotulo-secao text-ink-muted">semanas</span>
            </div>
          )}
          <div className="avatar">{iniciais(perfil.nome)}</div>
        </div>
      </header>

      <div className="flex flex-col gap-3 mb-6">
        {/* ---- Treino de hoje ------------------------------------------- */}
        <Link to="/treino" className="card card-treino block">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="rotulo-secao text-treino-ink">Treino de hoje</span>
            {perfil.usa_treino && exercicios && (
              <span className="badge badge-treino">
                {exercicios.length} {exercicios.length === 1 ? "exercício" : "exercícios"}
              </span>
            )}
          </div>

          {perfil.usa_treino ? (
            <>
              <div className="h2 mb-1">
                {proxima ? `${proxima.letra} — ${proxima.nome}` : "Sem sessão pendente"}
              </div>

              {exercicios && exercicios.length > 0 && (
                <div className="mt-2">
                  {exercicios.slice(0, 3).map((ex) => (
                    <div key={ex.sessaoExercicioId} className="exercise-row">
                      <span className="exercise-row__icone">
                        <Dumbbell size={18} />
                      </span>
                      <div className="exercise-row__texto">
                        <div className="h3">{ex.nome}</div>
                        <div className="text-xs text-ink-terciario num">
                          {ex.series} séries · {ex.repsMin}–{ex.repsMax} ·{" "}
                          {Math.round(ex.descansoSeg / 60 * 10) / 10} min
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {proxima && (
                <>
                  <div
                    className="progress-bar mt-3"
                    style={{ "--progresso": progressoTreino } as CSSProperties}
                  >
                    <span />
                  </div>
                  <div className="progress-bar-rotulo mt-2">
                    <span>{treinouHoje ? "Treino concluído" : "Progresso do treino"}</span>
                    <span className="num">{Math.round(progressoTreino * 100)}%</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="h2">Montar meu treino</div>
          )}
        </Link>

        {/* ---- Estudo de hoje --------------------------------------------- */}
        {perfil.usa_estudo && (
          <Link to="/estudo" className="card card-estudo block">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="rotulo-secao text-estudo-ink">Estudo de hoje</span>
              {materias.length > 0 && (
                <span className="badge badge-estudo">
                  {materias.length} {materias.length === 1 ? "disciplina" : "disciplinas"}
                </span>
              )}
            </div>

            <div className="h2 mb-1">Blocos de estudo</div>

            {blocos.length > 0 ? (
              <>
                <div className="mt-2">
                  {blocos.slice(0, 3).map((b) => (
                    <div
                      key={b.id}
                      className="subject-row"
                      style={{ "--cor": corDaDisciplina(b.materia_id, materias) } as CSSProperties}
                    >
                      <span className="subject-row__cor" />
                      <div className="subject-row__texto">
                        <div className="h3">{b.titulo}</div>
                        <div className="text-xs text-ink-terciario">{b.duracao_min} min</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="progress-bar mt-3" style={{ "--progresso-cor": "var(--estudo)", "--progresso": progressoEstudo } as CSSProperties}>
                  <span />
                </div>
                <div className="progress-bar-rotulo mt-2">
                  <span>Progresso de estudo</span>
                  <span className="num">{Math.round(progressoEstudo * 100)}%</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Nenhum bloco planejado para hoje.</p>
            )}
          </Link>
        )}
      </div>

      {/* ---- Resumo da semana ----------------------------------------- */}
      {resumo && (
        <section className="mb-6">
          <span className="rotulo-secao text-ink-muted mb-2 block">Resumo da semana</span>
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            <div className="stat-pill">
              <div className="stat-pill-valor num">
                {resumo.treinosFeitos}/{resumo.treinosMeta || "–"}
              </div>
              <div className="stat-pill-rotulo">Treinos</div>
            </div>
            <div className="stat-pill">
              <div className="stat-pill-valor num">{resumo.minutosTreino}</div>
              <div className="stat-pill-rotulo">Minutos</div>
            </div>
            <div className="stat-pill">
              <div className="stat-pill-valor num">{(resumo.volumeKg / 1000).toFixed(1)}t</div>
              <div className="stat-pill-rotulo">Volume</div>
            </div>
            <div className="stat-pill">
              <div className="stat-pill-valor num">
                {resumo.minutosEstudo >= 60 ? `${Math.round(resumo.minutosEstudo / 60)}h` : `${resumo.minutosEstudo}min`}
              </div>
              <div className="stat-pill-rotulo">Estudo</div>
            </div>
          </div>
        </section>
      )}

      {/* ---- Ações rápidas ---------------------------------------------
          Evolução e Configurar não têm tela própria ainda — ficam
          visualmente presentes (o mockup pede) mas inertes, em vez de
          linkar pra uma rota que não existe. */}
      <section className="mb-8">
        <span className="rotulo-secao text-ink-muted mb-2 block">Ações rápidas</span>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/treino" className="action-tile" style={{ "--tile-cor": "var(--treino-ink)", "--tile-cor-fraca": "var(--treino-fraco)" } as CSSProperties}>
            <span className="action-tile__icone">
              <Play size={20} />
            </span>
            <div>
              <div className="action-tile__label">Iniciar treino</div>
              <div className="action-tile__sub">{proxima ? `Treino ${proxima.letra} — ${proxima.nome}` : "Montar treino"}</div>
            </div>
          </Link>
          <Link to="/estudo" className="action-tile" style={{ "--tile-cor": "var(--estudo-ink)", "--tile-cor-fraca": "var(--estudo-fraco)" } as CSSProperties}>
            <span className="action-tile__icone">
              <Timer size={20} />
            </span>
            <div>
              <div className="action-tile__label">Timer de estudo</div>
              <div className="action-tile__sub">Pomodoro · 25 min</div>
            </div>
          </Link>
          <div className="action-tile opacity-50" style={{ "--tile-cor": "var(--atencao-ink)", "--tile-cor-fraca": "var(--atencao-fraco)" } as CSSProperties}>
            <span className="action-tile__icone">
              <BarChart3 size={20} />
            </span>
            <div>
              <div className="action-tile__label">Evolução</div>
              <div className="action-tile__sub">Em breve</div>
            </div>
          </div>
          <div className="action-tile opacity-50">
            <span className="action-tile__icone">
              <Settings size={20} />
            </span>
            <div>
              <div className="action-tile__label">Configurar</div>
              <div className="action-tile__sub">Em breve</div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <button className="btn btn-neutro flex items-center justify-center gap-2" onClick={() => void exportar()} disabled={exportando}>
          <Download size={16} />
          {exportando ? "Gerando backup…" : "Exportar meus dados"}
        </button>
        <button className="btn btn-neutro" onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </div>
  );
}
