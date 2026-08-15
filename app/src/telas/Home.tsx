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
  carregarResumoDoPlano,
  carregarResumoSemanal,
  corDaDisciplina,
  hojeNoFuso,
  proximosDiasDeTreino,
  type BlocoEstudo,
  type Materia,
  type Perfil,
  type ProgramaAtivo,
  type ProximaSessao,
  type ResumoSemanal,
  type SessaoDoResumo,
} from "../lib/dados";
import type { ExercicioDaSessao } from "./SessaoTreino";
import { BarChart3, Dumbbell, Download, Play, Settings, Timer } from "lucide-react";
import { baixarComoJson, exportarDadosDoUsuario } from "../lib/exportarDados";
import { useToast } from "../lib/toast";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";

/** Verde = o de agora, azul = o seguinte, roxo = o terceiro. Mesma
    gramática de cor do resto do app, e o mesmo desenho pedido lá no
    começo do projeto. */
const CORES_FILA = ["var(--treino)", "var(--estudo)", "var(--roxo)"] as const;

/** Quantos treinos futuros o carrossel mostra. Três é o que cabe na
    cabeça: hoje, o próximo, e o depois. */
const CARTOES_NA_FILA = 3;

const FORMATO_DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/**
 * Rótulo de cada cartão. Recebe a data PLANEJADA (de `dias_lembrete`) ou
 * `undefined` quando a pessoa não marcou dias — e nesse caso rotula por
 * posição na fila, em vez de inventar um dia.
 */
function rotuloDaFila(dataISO: string | undefined, hojeISO: string, posicao: number): string {
  if (!dataISO) return posicao === 0 ? "Próximo treino" : `${posicao + 1}º da fila`;
  if (dataISO === hojeISO) return "Treino de hoje";

  const amanha = new Date(`${hojeISO}T00:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  if (dataISO === amanha.toISOString().slice(0, 10)) return "Amanhã";

  const d = new Date(`${dataISO}T12:00:00`);
  const semana = FORMATO_DIA_SEMANA.format(d).replace(".", "");
  const dia = dataISO.split("-").reverse().slice(0, 2).join("/");
  return `${semana.charAt(0).toUpperCase() + semana.slice(1)}, ${dia}`;
}

/**
 * Um treino da fila.
 *
 * O rótulo de data é PROJEÇÃO, não promessa: vem dos dias que a pessoa
 * planejou (`dias_lembrete`), enquanto o conteúdo vem da fila, que só
 * anda quando um treino é CONCLUÍDO. Furou a terça? O treino não vira o
 * de quarta — ele continua sendo o próximo, e só o rótulo de data muda.
 * A migration 05 documenta essa separação como decisão de projeto.
 */
function CartaoDaFila({
  sessao,
  posicao,
  rotulo,
  exercicios,
  progresso,
  treinouHoje,
}: {
  sessao: SessaoDoResumo;
  posicao: number;
  rotulo: string;
  exercicios: ExercicioDaSessao[] | undefined;
  /** Só o primeiro cartão mostra progresso — é o único que dá para iniciar. */
  progresso: number | null;
  treinouHoje: boolean;
}) {
  const cor = CORES_FILA[posicao % CORES_FILA.length];
  return (
    <Link
      to="/treino"
      className="card card-fila block"
      style={{ "--cor-fila": cor } as CSSProperties}
      aria-label={`${rotulo}: treino ${sessao.letra}, ${sessao.nome}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="rotulo-secao" style={{ color: cor }}>
          {rotulo}
        </span>
        <span className="badge shrink-0" style={{ background: "var(--surface-alta)" }}>
          {sessao.totalExercicios} {sessao.totalExercicios === 1 ? "exercício" : "exercícios"}
        </span>
      </div>

      <div className="h2 mb-1">
        {sessao.letra} — {sessao.nome}
      </div>

      {exercicios === undefined ? (
        <div className="skeleton mt-3" style={{ height: "3.5rem" }} />
      ) : (
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
                  {Math.round((ex.descansoSeg / 60) * 10) / 10} min
                </div>
              </div>
            </div>
          ))}
          {exercicios.length > 3 && (
            <div className="text-xs text-ink-terciario mt-2">
              + {exercicios.length - 3} exercícios
            </div>
          )}
        </div>
      )}

      {progresso !== null && (
        <>
          <div
            className="progress-bar mt-3"
            style={{ "--progresso": progresso, "--progresso-cor": cor } as CSSProperties}
          >
            <span />
          </div>
          <div className="progress-bar-rotulo mt-2">
            <span>{treinouHoje ? "Treino concluído" : "Progresso do treino"}</span>
            <span className="num">{Math.round(progresso * 100)}%</span>
          </div>
        </>
      )}
    </Link>
  );
}

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
  const [treinouHoje, setTreinouHoje] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [resumo, setResumo] = useState<ResumoSemanal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const toast = useToast();

  // Fila de treino do carrossel: as sessões na ordem da rotação, já
  // giradas para começar na próxima.
  const [fila, setFila] = useState<SessaoDoResumo[]>([]);
  const [rotulos, setRotulos] = useState<string[]>([]);
  const [exerciciosPorSessao, setExerciciosPorSessao] = useState<
    Record<string, ExercicioDaSessao[]>
  >({});
  const [cartaoVisivel, setCartaoVisivel] = useState(0);

  /**
   * Monta a fila do carrossel: gira a lista de sessões para começar na
   * próxima, corta em três, e busca os exercícios de cada uma.
   *
   * O giro é o ponto: `sessoes` vem na ordem de `posicao` (A, B, C), mas
   * a fila real começa em `proxima_sessao_id`. Quem está com o B pendente
   * precisa ver B, C, A — não A, B, C.
   */
  async function montarFila(
    programa: { programa: ProgramaAtivo; proxima: ProximaSessao | null },
    hojeISO: string,
    jaTreinouHoje: boolean,
  ) {
    const resumo = await carregarResumoDoPlano(userId);
    if (!resumo || resumo.sessoes.length === 0) return;

    const inicio = resumo.sessoes.findIndex((s) => s.id === programa.proxima?.id);
    const girada =
      inicio <= 0
        ? resumo.sessoes
        : [...resumo.sessoes.slice(inicio), ...resumo.sessoes.slice(0, inicio)];
    const proximas = girada.slice(0, CARTOES_NA_FILA);
    setFila(proximas);

    // Se já treinou hoje, hoje sai da conta: o próximo da fila acontece no
    // próximo dia planejado, não de novo hoje.
    const datas = proximosDiasDeTreino(
      programa.programa.dias_lembrete,
      hojeISO,
      proximas.length,
      !jaTreinouHoje,
    );
    setRotulos(proximas.map((_, i) => rotuloDaFila(datas[i], hojeISO, i)));

    const listas = await Promise.all(
      proximas.map(async (s) => [s.id, await carregarExerciciosDaSessao(s.id)] as const),
    );
    setExerciciosPorSessao(Object.fromEntries(listas));
  }

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

      // Fila do carrossel e blocos de estudo entram depois: a tela já
      // pinta com o resto, e essas listas só enriquecem os cards — não
      // vale atrasar o primeiro paint por elas.
      if (programa?.proxima) {
        void montarFila(programa, hoje, resumoDia.data?.treinou ?? false).catch((e) =>
          console.warn("fila de treino indisponível:", e),
        );
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

      {/* ---- Fila de treino, arrastável ------------------------------
          Um card por treino da rotação: o de agora, o seguinte, o
          terceiro. Ver `CartaoDaFila` para o porquê dos rótulos de data
          serem projeção e não promessa. */}
      {perfil.usa_treino && fila.length > 0 ? (
        <section className="mb-6">
          <div
            className="carrossel"
            onScroll={(e) => {
              // Compara com a posição REAL de cada cartão em vez de dividir
              // a largura total: gap e padding do container fariam a conta
              // por média errar justamente nas pontas.
              const el = e.currentTarget;
              const filhos = Array.from(el.children) as HTMLElement[];
              let maisProximo = 0;
              let menorDistancia = Infinity;
              filhos.forEach((filho, i) => {
                const distancia = Math.abs(filho.offsetLeft - el.scrollLeft - el.offsetLeft);
                if (distancia < menorDistancia) {
                  menorDistancia = distancia;
                  maisProximo = i;
                }
              });
              setCartaoVisivel(maisProximo);
            }}
          >
            {fila.map((s, i) => (
              <CartaoDaFila
                key={s.id}
                sessao={s}
                posicao={i}
                rotulo={rotulos[i] ?? ""}
                exercicios={exerciciosPorSessao[s.id]}
                progresso={i === 0 ? progressoTreino : null}
                treinouHoje={treinouHoje}
              />
            ))}
          </div>
          {fila.length > 1 && (
            <div className="carrossel-pontos" aria-hidden>
              {fila.map((s, i) => (
                <span
                  key={s.id}
                  className="carrossel-ponto"
                  data-ativo={i === cartaoVisivel || undefined}
                  style={{ "--cor-fila": CORES_FILA[i % CORES_FILA.length] } as CSSProperties}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="mb-6">
          <Link to="/treino" className="card card-treino block">
            <span className="rotulo-secao text-treino-ink mb-3 block">Treino</span>
            <div className="h2">
              {perfil.usa_treino ? "Sem sessão pendente" : "Montar meu treino"}
            </div>
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
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
