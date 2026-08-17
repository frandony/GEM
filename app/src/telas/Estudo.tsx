import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { CalendarClock, Check, List, Pause, Play, RotateCcw, SkipForward, Sparkles, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { notificarFimDoTimer } from "../lib/notificacaoTimer";
import {
  carregarBlocosDoIntervalo,
  carregarMateriasParaMontagem,
  carregarPerfil,
  corDaDisciplina,
  hojeNoFuso,
  marcarBloco,
  type BlocoEstudo,
  type MateriaParaMontagem,
} from "../lib/dados";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { useToast } from "../lib/toast";

const TIPO_ROTULO: Record<BlocoEstudo["tipo"], string> = {
  leitura: "Leitura",
  exercicios: "Exercícios",
  revisao: "Revisão",
  marco: "Marco",
};

const DURACAO_POMODORO = 25 * 60;

type MetodoDeFoco = "pomodoro" | "simples";

/** Pomodoro é sempre 25 min — é a definição da técnica. "Timer simples" é
    quem usa a duração que a pessoa cadastrou no bloco (`duracao_min`),
    sem os ciclos de pausa do Pomodoro. */
function duracaoAlvoSeg(metodo: MetodoDeFoco, bloco: BlocoEstudo | null): number {
  return metodo === "pomodoro" ? DURACAO_POMODORO : (bloco?.duracao_min ?? 0) * 60;
}

/* ---------------------------------------------------------------------
   Faixa "próximos dias" — janela ROLANTE E CENTRADA em hoje (3 dias
   passados + hoje + 3 seguintes), não a semana de calendário fixa que a
   faixa da Home usa: aqui o objetivo é navegar pra trás e pra frente a
   partir de hoje, e hoje sempre fica no meio — a janela inteira anda um
   dia por dia conforme o tempo passa. Constantes e helpers próprios desta
   tela, de propósito — mesmo raciocínio de `data-tem-horario` não reusar
   `data-estudou` em GradeEstudo: evita acoplar Estudo à Home.
   --------------------------------------------------------------------- */
const DIAS_NA_FAIXA = 7;
const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
const FORMATO_DIA_SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/** `quantos` dias com `hoje` no meio (arredondando pra baixo o lado de
    trás quando `quantos` é par). Com `DIAS_NA_FAIXA = 7`: 3 antes, hoje,
    3 depois. */
function diasDaFaixa(hojeISO: string, quantos: number): string[] {
  const antes = Math.floor((quantos - 1) / 2);
  const datas: string[] = [];
  const cursor = new Date(`${hojeISO}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - antes);
  for (let i = 0; i < quantos; i++) {
    datas.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return datas;
}

/** "ontem" / "hoje" / "amanhã" / "sáb, 22/08" — usado no rótulo da seção
    e no estado vazio, sempre no meio de frase ("Blocos de X", "para X"). */
function rotuloDoDia(dataISO: string, hojeISO: string): string {
  if (dataISO === hojeISO) return "hoje";
  const amanha = new Date(`${hojeISO}T00:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  if (dataISO === amanha.toISOString().slice(0, 10)) return "amanhã";
  const ontem = new Date(`${hojeISO}T00:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (dataISO === ontem.toISOString().slice(0, 10)) return "ontem";
  const d = new Date(`${dataISO}T12:00:00`);
  const semana = FORMATO_DIA_SEMANA.format(d).replace(".", "");
  const dia = dataISO.split("-").reverse().slice(0, 2).join("/");
  return `${semana}, ${dia}`;
}

/** Os action-tiles da tela herdam a cor do módulo (azul de estudo) em vez
    do verde padrão do token — é o que amarra as ações à identidade da aba. */
const CORES_ESTUDO = {
  "--tile-cor": "var(--estudo-ink)",
  "--tile-cor-fraca": "var(--estudo-fraco)",
} as CSSProperties;

/* =====================================================================
   Estudo — "hoje": timer de foco, faixa de dias, blocos do dia
   selecionado. Gestão de matérias (lista, tópicos, criação) mora em
   MateriasEstudo.tsx/NovaMateria.tsx, uma navegação de distância pelo
   botão "Matérias" no cabeçalho — antes vivia tudo aqui (1666 linhas,
   de longe a maior tela do app), com "Nova matéria" empurrado pra fora
   da primeira dobra assim que existiam algumas matérias cadastradas.
   ===================================================================== */
export function Estudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [materias, setMaterias] = useState<MateriaParaMontagem[]>([]);
  // Guarda a janela inteira de `DIAS_NA_FAIXA` dias, não só hoje — a faixa
  // abaixo precisa ver todo mundo de uma vez para pintar cada coluna sem
  // uma consulta por dia.
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [hojeISO, setHojeISO] = useState("");
  const [diaSelecionado, setDiaSelecionado] = useState("");
  const [falhou, setFalhou] = useState<string | null>(null);
  const toast = useToast();

  // Timer de foco — mesma lógica de relógio (Date.now(), não setInterval
  // acumulado) do descanso em SessaoTreino.tsx, adaptada pra suportar
  // pausa: enquanto rodando, um efeito recalcula contra um alvo fixo;
  // ao pausar, `restante` já está congelado no último valor calculado.
  const [restante, setRestante] = useState(DURACAO_POMODORO);
  const [rodando, setRodando] = useState(false);
  // Bloco sendo estudado agora — só o id, nunca uma cópia do objeto. O
  // objeto de verdade sempre vem de `blocos`: se a pessoa concluir o
  // bloco pelo checkbox enquanto o timer dele está aberto, uma cópia à
  // parte ficaria desatualizada.
  const [blocoEmFocoId, setBlocoEmFocoId] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<MetodoDeFoco>("pomodoro");
  const blocoEmFoco = blocos.find((b) => b.id === blocoEmFocoId) ?? null;

  /** Toque em "Estudar" num bloco — troca o alvo do timer e para uma
      contagem que porventura já estivesse rodando contra outro bloco ou
      outro método, pra nunca deixar o timer correndo contra o alvo errado. */
  function iniciarFoco(bloco: BlocoEstudo) {
    setBlocoEmFocoId(bloco.id);
    setRodando(false);
    setRestante(duracaoAlvoSeg(metodo, bloco));
  }

  function trocarMetodo(novo: MetodoDeFoco) {
    setMetodo(novo);
    setRodando(false);
    if (blocoEmFoco) setRestante(duracaoAlvoSeg(novo, blocoEmFoco));
  }

  function encerrarFoco() {
    setRodando(false);
    setBlocoEmFocoId(null);
  }

  // Dá scroll no card do timer quando "Estudar" é tocado num bloco mais
  // abaixo na lista, com o timer fora da tela.
  const timerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (blocoEmFocoId) timerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [blocoEmFocoId]);

  useEffect(() => {
    if (!rodando) return;
    const alvo = Date.now() + restante * 1000;
    const tique = setInterval(() => {
      const restam = Math.max(0, Math.ceil((alvo - Date.now()) / 1000));
      setRestante(restam);
      if (restam <= 0) {
        setRodando(false);
        toast.sucesso(blocoEmFoco ? `"${blocoEmFoco.titulo}" — tempo esgotado!` : "Tempo esgotado!");
        notificarFimDoTimer();
      }
    }, 250);
    return () => clearInterval(tique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodando]);

  async function carregar() {
    setFalhou(null);
    try {
      const perfil = await carregarPerfil(userId);
      const tz = perfil?.timezone ?? "America/Sao_Paulo";
      const hoje = hojeNoFuso(tz);
      const janela = diasDaFaixa(hoje, DIAS_NA_FAIXA);
      const [ms, bs] = await Promise.all([
        // Precisa da lista de matérias pra colorir cada bloco por
        // disciplina (corDaDisciplina) e pra saber se ainda não existe
        // nenhuma — a gestão de tópicos/eventos em si mora em
        // MateriasEstudo.tsx, que carrega os próprios dados.
        carregarMateriasParaMontagem(userId),
        carregarBlocosDoIntervalo(userId, janela[0]!, janela[janela.length - 1]!),
      ]);
      setMaterias(ms);
      setBlocos(bs);
      setHojeISO(hoje);
      // Só inicializa na primeira carga — um recarregamento por outro
      // motivo (tentar de novo) não deve arrancar a pessoa do dia que
      // ela escolheu ver.
      setDiaSelecionado((atual) => atual || hoje);
    } catch (e) {
      // O estado vazio desta tela AFIRMA que você não tem matéria nenhuma
      // e esconde Pomodoro e blocos junto. Cair nele por causa de uma
      // consulta que falhou era o bug que fazia parecer que as
      // funcionalidades novas nem tinham sido implementadas.
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar seu estudo.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /**
   * Marca ou desmarca um bloco. Otimista com rollback: a caixa responde
   * na hora, mas se a gravação falhar ela VOLTA e o toast diz o porquê.
   * Antes não havia try/catch nenhum — offline, o bloco ficava marcado na
   * tela e nada era gravado.
   */
  async function alternarBloco(bloco: BlocoEstudo) {
    const concluindo = bloco.status === "pendente";
    const novoStatus = concluindo ? "concluido" : "pendente";
    const anterior = bloco.status;

    setBlocos((atual) =>
      atual.map((b) => (b.id === bloco.id ? { ...b, status: novoStatus } : b)),
    );

    try {
      await marcarBloco(bloco.id, novoStatus, concluindo ? bloco.duracao_min * 60 : null);
      toast.sucesso(concluindo ? "Bloco concluído." : "Marcação desfeita.");
    } catch (e) {
      setBlocos((atual) =>
        atual.map((b) => (b.id === bloco.id ? { ...b, status: anterior } : b)),
      );
      toast.erro(e instanceof Error ? e.message : "Não deu para marcar o bloco.");
    }
  }

  if (carregando) {
    return (
      <div className="tela">
        <div className="skeleton" style={{ height: "2.5rem", width: "10rem" }} />
        <div className="skeleton mt-4" style={{ height: "13rem" }} />
      </div>
    );
  }

  // ANTES do estado vazio, sempre: "não carreguei" nunca pode ser
  // apresentado como "você não tem matérias".
  if (falhou) {
    return (
      <div className="tela">
        <header className="mb-4">
          <h1 className="h1">Estudo</h1>
        </header>
        <FalhaAoCarregar
          mensagem={falhou}
          onTentarDeNovo={() => {
            setCarregando(true);
            void carregar();
          }}
        />
      </div>
    );
  }

  if (materias.length === 0) {
    return (
      <div className="tela">
        <header className="mb-4">
          <h1 className="h1">Estudo</h1>
        </header>

        {/* Os três passos existem porque cadastrar a matéria sozinho não
            produz bloco nenhum — e sem esse mapa, quem cadastra a primeira
            conclui que o app não fez nada. */}
        <div className="card mb-4">
          <span className="rotulo-secao text-estudo-ink mb-2">Como funciona</span>
          <ol className="text-sm text-ink-muted flex flex-col gap-2">
            <li>
              <strong className="text-ink">1.</strong> Cadastre uma matéria com seus tópicos —
              é o que você vai estudar.
            </li>
            <li>
              <strong className="text-ink">2.</strong> Defina sua{" "}
              <Link className="underline" to="/estudo/grade">
                grade de horários
              </Link>{" "}
              — quando você tem tempo livre.
            </li>
            <li>
              <strong className="text-ink">3.</strong> Monte o plano — a IA distribui os
              tópicos nos seus horários.
            </li>
          </ol>
        </div>

        <Link className="btn btn-estudo btn-bloco" to="/estudo/materias/nova">
          Cadastrar matéria
        </Link>
      </div>
    );
  }

  // Agrupada uma vez por render — a faixa pinta cada coluna a partir dela,
  // e a lista abaixo filtra pelo dia selecionado em vez de assumir hoje.
  const blocosPorDia = new Map<string, BlocoEstudo[]>();
  for (const b of blocos) {
    const doDia = blocosPorDia.get(b.data);
    if (doDia) doDia.push(b);
    else blocosPorDia.set(b.data, [b]);
  }
  const dias = diasDaFaixa(hojeISO, DIAS_NA_FAIXA);
  const blocosDoDia = blocosPorDia.get(diaSelecionado) ?? [];
  const pendentes = blocosDoDia.filter((b) => b.status === "pendente");
  const feitos = blocosDoDia.filter((b) => b.status !== "pendente");
  const minutos = Math.floor(restante / 60);
  const segundos = restante % 60;

  return (
    <div className="tela">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm text-ink-muted">Sessão de estudo</span>
            <h1 className="h1">Estudo</h1>
          </div>
          <Link to="/estudo/materias" className="btn btn-neutro shrink-0">
            <List size={16} /> Matérias
          </Link>
        </div>
      </header>

      {/* As duas ações da tela, lado a lado e do mesmo tamanho.
          "Grade" era um link de texto sublinhado no canto superior
          direito — pequeno demais para o único caminho até uma tela
          obrigatória (sem grade, não existe plano). Agora as duas
          decisões da tela têm o mesmo peso visual e alvo de toque. */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link to="/estudo/montar" className="action-tile" style={CORES_ESTUDO}>
          <span className="action-tile__icone">
            <Sparkles size={20} />
          </span>
          <div>
            <div className="action-tile__label">Montar plano</div>
            <div className="action-tile__sub">A IA distribui seus tópicos</div>
          </div>
        </Link>
        <Link to="/estudo/grade" className="action-tile" style={CORES_ESTUDO}>
          <span className="action-tile__icone">
            <CalendarClock size={20} />
          </span>
          <div>
            <div className="action-tile__label">Grade de horários</div>
            <div className="action-tile__sub">Quando você estuda</div>
          </div>
        </Link>
      </div>

      {/* ---- Timer de foco ---------------------------------------------
          Sem bloco escolhido, é só um convite — não faz sentido mostrar
          contagem ou controles pra nada. Escolher "Estudar" num bloco
          abaixo é o que liga o timer de verdade, já na duração certa. */}
      <div
        ref={timerRef}
        className="card mb-6 flex flex-col items-center gap-4 py-6"
        style={{ borderRadius: "1.25rem", position: "relative" }}
      >
        {!blocoEmFoco ? (
          <p className="text-sm text-ink-muted text-center py-2">
            Escolha um bloco abaixo para começar a estudar.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="text-ink-muted shrink-0"
              style={{ position: "absolute", top: "var(--e-3)", right: "var(--e-3)" }}
              onClick={encerrarFoco}
              aria-label="Encerrar foco"
            >
              <X size={18} />
            </button>

            <div className="text-center">
              <div className="text-sm text-ink-muted mb-1">{blocoEmFoco.titulo}</div>
              <div className="display text-6xl num">
                {String(minutos).padStart(2, "0")}:{String(segundos).padStart(2, "0")}
              </div>
              <span className="text-xs text-ink-terciario">
                {metodo === "pomodoro"
                  ? "Pomodoro · 25 min"
                  : `Timer simples · ${blocoEmFoco.duracao_min} min`}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className={metodo === "pomodoro" ? "chip chip-estudo" : "chip"}
                onClick={() => trocarMetodo("pomodoro")}
              >
                Pomodoro
              </button>
              <button
                type="button"
                className={metodo === "simples" ? "chip chip-estudo" : "chip"}
                onClick={() => trocarMetodo("simples")}
              >
                Timer simples
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                className="stepper-btn"
                style={{ borderRadius: "999px" }}
                onClick={() => {
                  setRodando(false);
                  setRestante(duracaoAlvoSeg(metodo, blocoEmFoco));
                }}
                aria-label="Reiniciar"
              >
                <RotateCcw size={20} />
              </button>
              <button
                type="button"
                className="stepper-btn"
                style={{
                  borderRadius: "999px",
                  width: "3.5rem",
                  height: "3.5rem",
                  background: "var(--treino)",
                  borderColor: "var(--treino)",
                  color: "var(--bg)",
                }}
                onClick={() => setRodando((r) => !r)}
                disabled={restante <= 0}
                aria-label={rodando ? "Pausar" : "Iniciar"}
              >
                {rodando ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <button
                type="button"
                className="stepper-btn"
                style={{ borderRadius: "999px" }}
                onClick={() => {
                  setRodando(false);
                  setRestante(duracaoAlvoSeg(metodo, blocoEmFoco));
                  toast.sucesso("Reiniciado");
                }}
                aria-label="Pular"
              >
                <SkipForward size={20} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Faixa de dias, hoje no meio — mesmo esqueleto visual da faixa da
          semana na Início (letra + círculo), semântica própria: mostra o
          plano de estudo (passado e futuro), não o streak. Tocar num dia
          troca a lista abaixo. */}
      <FaixaDeDias
        dias={dias}
        blocosPorDia={blocosPorDia}
        diaSelecionado={diaSelecionado}
        hojeISO={hojeISO}
        onSelecionar={setDiaSelecionado}
      />

      {/* Este rótulo dizia "Disciplinas" e listava BLOCOS — era a origem
          do "criei uma matéria e ela não aparece em lugar nenhum": o único
          lugar que parecia listar matérias listava outra coisa. */}
      <span className="rotulo-secao text-ink-muted mb-2 block">
        Blocos de {rotuloDoDia(diaSelecionado, hojeISO)}
      </span>
      {blocosDoDia.length === 0 ? (
        <div className="vazio mb-6">
          <p>Nenhum bloco planejado para {rotuloDoDia(diaSelecionado, hojeISO)}.</p>
          <p className="text-sm text-ink-terciario">
            Os blocos nascem do plano — é ele que distribui seus tópicos nos horários da grade.
          </p>
          <Link className="btn btn-estudo" to="/estudo/montar">
            Montar plano
          </Link>
        </div>
      ) : (
        <div className="card">
          {[...pendentes, ...feitos].map((b) => (
            <LinhaDeBloco
              key={b.id}
              bloco={b}
              cor={corDaDisciplina(b.materia_id, materias)}
              onAlternar={() => void alternarBloco(b)}
              onEstudar={() => iniciarFoco(b)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Faixa de dias, hoje no meio.
   ---------------------------------------------------------------------
   Cada coluna é um botão de verdade (não uma div decorativa) — a linha
   inteira alterna o dia selecionado, mesmo alvo de toque generoso que o
   resto do app usa para ações de um toque só.

   O círculo sempre mostra o dia do mês — quem avisa "tem bloco aqui" é a
   borda azul (data-tem-blocos), não o número. A contagem de blocos entra
   só no aria-label, para quem usa leitor de tela.
   --------------------------------------------------------------------- */
function FaixaDeDias({
  dias,
  blocosPorDia,
  diaSelecionado,
  hojeISO,
  onSelecionar,
}: {
  dias: string[];
  blocosPorDia: Map<string, BlocoEstudo[]>;
  diaSelecionado: string;
  hojeISO: string;
  onSelecionar: (data: string) => void;
}) {
  return (
    <section className="faixa-dias-secao mb-6">
      <div className="faixa-dias">
        {dias.map((data) => {
          const doDia = blocosPorDia.get(data) ?? [];
          const numero = Number(data.slice(8, 10));
          const temBlocos = doDia.length > 0;
          const todosConcluidos = temBlocos && doDia.every((b) => b.status !== "pendente");
          const rotulo = rotuloDoDia(data, hojeISO);
          return (
            <button
              key={data}
              type="button"
              className="dia-coluna"
              onClick={() => onSelecionar(data)}
              aria-pressed={data === diaSelecionado}
              aria-label={
                temBlocos
                  ? `${rotulo}, ${doDia.length} ${doDia.length === 1 ? "bloco" : "blocos"}${todosConcluidos ? ", concluído" : ""}`
                  : `${rotulo}, sem blocos`
              }
            >
              <span className="dia-coluna__letra" aria-hidden>
                {DIAS_LETRA[new Date(`${data}T12:00:00`).getDay()]}
              </span>
              <span
                className="dia-ponto num"
                aria-hidden
                data-tem-blocos={temBlocos || undefined}
                data-todos-concluidos={todosConcluidos || undefined}
                data-selecionado={data === diaSelecionado || undefined}
              >
                {numero}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------
   Linha de bloco.
   ---------------------------------------------------------------------
   A linha inteira era um <button> que CONCLUÍA o bloco — irreversível,
   sem confirmação e sem jeito de voltar. Quem tocava esperando abrir um
   detalhe marcava o bloco como feito sem querer; quem tocava num bloco já
   concluído não recebia reação nenhuma (era uma <div>).

   Agora o alvo é só a caixa (48px), e ela alterna nos dois sentidos.
   Desfazer na própria caixa é melhor que um "desfazer" no toast, que
   desapareceria em 2,5s.
   --------------------------------------------------------------------- */
function LinhaDeBloco({
  bloco,
  cor,
  onAlternar,
  onEstudar,
}: {
  bloco: BlocoEstudo;
  cor: string;
  onAlternar: () => void;
  onEstudar: () => void;
}) {
  const concluido = bloco.status !== "pendente";
  return (
    <div className="subject-row" style={{ "--cor": cor } as CSSProperties}>
      <span className="subject-row__cor" />
      <div className="subject-row__texto">
        <div className={concluido ? "h3 text-ink-muted" : "h3"}>{bloco.titulo}</div>
        <div className="text-xs text-ink-terciario">
          {TIPO_ROTULO[bloco.tipo]} · {bloco.hora.slice(0, 5)} · {bloco.duracao_min} min
        </div>
      </div>
      {/* Só em bloco pendente — não faz sentido estudar um já concluído
          ou pulado. Liga o timer de cima já na duração deste bloco. */}
      {!concluido && (
        <button
          type="button"
          className="bloco-estudar"
          onClick={onEstudar}
          aria-label={`Estudar "${bloco.titulo}" agora`}
        >
          <Play size={12} />
        </button>
      )}
      {/* `role="checkbox"` no próprio <button>. Antes havia um
          <span role="checkbox"> DENTRO de um <button> — combinação que
          tecnologia assistiva não sabe anunciar. */}
      <button
        type="button"
        className="subject-row__acao"
        role="checkbox"
        aria-checked={concluido}
        aria-label={`Marcar "${bloco.titulo}" como concluído`}
        onClick={onAlternar}
      >
        <span className="subject-row__caixa" aria-hidden>
          {concluido && <Check size={14} />}
        </span>
      </button>
    </div>
  );
}
