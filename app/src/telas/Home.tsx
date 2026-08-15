import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarBlocosDoDia,
  carregarDiasDeResumo,
  carregarExerciciosDaSessao,
  carregarMaterias,
  carregarPerfil,
  carregarProgramaAtivo,
  carregarResumoDoPeriodo,
  carregarResumoDoPlano,
  corDaDisciplina,
  hojeNoFuso,
  intervaloDaSemana,
  proximosDiasDeTreino,
  type BlocoEstudo,
  type DiaDoMembro,
  type Materia,
  type Perfil,
  type ProgramaAtivo,
  type ProximaSessao,
  type ResumoSemanal,
  type SessaoDoResumo,
} from "../lib/dados";
import type { ExercicioDaSessao } from "./SessaoTreino";
import { BarChart3, Dumbbell, Download, Flame, Play, Settings, Timer } from "lucide-react";
import { baixarComoJson, exportarDadosDoUsuario } from "../lib/exportarDados";
import { resumoDaSessao } from "../lib/treino";
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

/** Indexado por `getDay()` (0 = domingo), não pela ordem da faixa — a
    faixa começa na segunda, e derivar a letra da data evita ter que
    manter as duas coisas em sincronia. */
const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Janela do bloco "No último mês". 30 e não `date_trunc('month')` de
    propósito: no dia 1º um mês-calendário mostraria quase tudo zerado. */
const DIAS_DO_BLOCO_MENSAL = 30;

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
  concluidoHoje,
}: {
  sessao: SessaoDoResumo;
  posicao: number;
  rotulo: string;
  exercicios: ExercicioDaSessao[] | undefined;
  /** Só o primeiro cartão pode estar concluído — é o único que dá pra iniciar. */
  concluidoHoje: boolean;
}) {
  const cor = CORES_FILA[posicao % CORES_FILA.length];
  // Mesma conta de "Meu plano" (`lib/treino.ts`) — se fossem duas contas
  // separadas, a mesma sessão mostraria durações diferentes em duas telas.
  const minutos = exercicios ? resumoDaSessao(exercicios).minutosEstimados : null;

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
        <div className="flex items-center gap-2 shrink-0">
          {concluidoHoje && <span className="badge badge-ok">concluído</span>}
          {/* O badge de duração só entra quando os exercícios chegaram —
              nada de "~0 min" piscando enquanto carrega. */}
          {minutos !== null && (
            <span className="badge" style={{ background: "var(--surface-alta)" }}>
              ~{minutos} min
            </span>
          )}
          <span className="badge" style={{ background: "var(--surface-alta)" }}>
            {sessao.totalExercicios} {sessao.totalExercicios === 1 ? "exercício" : "exercícios"}
          </span>
        </div>
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
    </Link>
  );
}

/**
 * A semana que está valendo — segunda a domingo, a MESMA que o streak
 * conta (ver `intervaloDaSemana` em lib/dados.ts). Sem isso a faixa
 * seriam sete quadradinhos soltos; com isso ela responde "o que ainda
 * dá pra fazer nesta semana pra ela contar".
 */
function FaixaDaSemana({
  dias,
  hojeISO,
  streak,
}: {
  dias: DiaDoMembro[];
  hojeISO: string;
  streak: number | null;
}) {
  return (
    <section className="card mb-6 flex items-center gap-2">
      <div className="streak-chama" data-aceso={(streak ?? 0) > 0 || undefined}>
        <span className="streak-chama__valor">
          <Flame size={16} />
          <span className="num">{streak ?? 0}</span>
        </span>
        <span className="streak-chama__rotulo">
          {streak === 1 ? "semana" : "semanas"}
        </span>
      </div>

      <div className="faixa-semana">
        {dias.map((d) => {
          const eHoje = d.data === hojeISO;
          const futuro = d.data > hojeISO;
          const numero = Number(d.data.slice(8, 10));
          return (
            <div key={d.data} className="dia-coluna">
              <span className="dia-coluna__letra">
                {DIAS_LETRA[new Date(`${d.data}T12:00:00`).getDay()]}
              </span>
              <span
                className="dia-ponto num"
                data-treinou={d.treinou || undefined}
                data-estudou={d.minutosEstudo > 0 || undefined}
                data-hoje={eHoje || undefined}
                data-futuro={futuro || undefined}
                title={
                  futuro
                    ? `${numero}: ainda não chegou`
                    : `${numero}: ${d.treinou ? `treino ${d.sessaoLetra ?? ""}`.trim() : "sem treino"}` +
                      (d.minutosEstudo > 0 ? `, ${d.minutosEstudo} min de estudo` : "")
                }
              >
                {/* A letra da sessão substitui o número quando houve
                    treino: qual treino foi feito informa mais que o dia
                    do mês, que a coluna já posiciona. */}
                {d.treinou && d.sessaoLetra ? d.sessaoLetra : numero}
              </span>
            </div>
          );
        })}
      </div>
    </section>
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
  const [diasDaSemana, setDiasDaSemana] = useState<DiaDoMembro[]>([]);
  const [hojeISO, setHojeISO] = useState("");
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
      setHojeISO(hoje);
      const semana = intervaloDaSemana(hoje);

      const [programa, resumoDia, s, resumoMensal, dias] = await Promise.all([
        carregarProgramaAtivo(userId),
        supabase.from("resumos_diarios").select("treinou").eq("user_id", userId).eq("data", hoje).maybeSingle(),
        supabase.rpc("streak_de", { p_user_id: null }),
        // 30 dias, não 7: o bloco da tela agora é "No último mês".
        carregarResumoDoPeriodo(userId, p.timezone, DIAS_DO_BLOCO_MENSAL),
        carregarDiasDeResumo(userId, semana.de, semana.ate),
      ]);
      setProxima(programa?.proxima ?? null);
      setTreinouHoje(resumoDia.data?.treinou ?? false);
      setStreak((s.data as number) ?? 0);
      setResumo(resumoMensal);
      setDiasDaSemana(dias);

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

  // Progresso do MÊS, não da sessão: sessões concluídas contra a meta
  // escalada da frequência semanal. O `min(1)` evita a barra estourar
  // quando alguém treina mais que a própria meta — o número ao lado
  // continua mostrando o excedente ("14 de 12").
  const progressoMes = resumo && resumo.treinosMeta > 0
    ? Math.min(1, resumo.treinosFeitos / resumo.treinosMeta)
    : 0;

  return (
    <div className="tela">
      {/* O streak saiu daqui e foi pra faixa da semana, onde ele tem
          contexto: os dias que ainda podem fazer esta semana contar. */}
      <header className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-ink-muted">Olá,</div>
          <h1 className="h1">{perfil.nome}</h1>
        </div>
        <div className="avatar">{iniciais(perfil.nome)}</div>
      </header>

      {diasDaSemana.length > 0 && (
        <FaixaDaSemana dias={diasDaSemana} hojeISO={hojeISO} streak={streak} />
      )}

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
                concluidoHoje={i === 0 && treinouHoje}
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

          {/* Progresso do MÊS, fora do cartão de propósito: não é
              progresso daquela sessão. Só aparece com meta definida —
              sem `frequencia_semanal` o denominador seria zero. */}
          {resumo && resumo.treinosMeta > 0 && (
            <div className="mt-4">
              <div
                className="progress-bar"
                style={{ "--progresso": progressoMes } as CSSProperties}
              >
                <span />
              </div>
              <div className="progress-bar-rotulo mt-2">
                <span>
                  <span className="num">{resumo.treinosFeitos}</span> de{" "}
                  <span className="num">{resumo.treinosMeta}</span> treinos este mês
                </span>
                <span className="num">{Math.round(progressoMes * 100)}%</span>
              </div>
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

      {/* ---- No último mês ---------------------------------------------
          Substituiu o "Resumo da semana" (4 pills): a faixa lá em cima já
          mostra a semana visualmente, e repetir a mesma semana em número
          logo abaixo era a mesma informação duas vezes. */}
      {resumo && (
        <section className="mb-6">
          <span className="rotulo-secao text-ink-muted mb-3 block">No último mês</span>
          <div className="flex justify-around gap-3">
            <div className="stat-circulo">
              <div className="stat-circulo__valor num">{resumo.treinosFeitos}</div>
              <div className="stat-circulo__rotulo">Treinos feitos</div>
            </div>
            {/* Só pra quem usa estudo: pra quem não usa, seria um zero
                permanente que parece defeito, não informação. */}
            {perfil.usa_estudo && (
              <div className="stat-circulo">
                <div className="stat-circulo__valor num">{resumo.blocosEstudo}</div>
                <div className="stat-circulo__rotulo">Blocos de estudo</div>
              </div>
            )}
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
