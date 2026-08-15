import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router";
import {
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { notificarFimDoTimer } from "../lib/notificacaoTimer";
import { extrairTextoDoPdf } from "../lib/pdf";
import {
  extrairTopicosDoTexto,
  gerarTopicosPeloNome,
  type DataExtraidaDoPdf,
  type ExtracaoDeTopicos,
  type OrigemDosTopicos,
} from "../lib/extrairTopicos";
import {
  arquivarMateria,
  arquivarTopico,
  carregarBlocosDoDia,
  carregarMateriasParaMontagem,
  carregarPerfil,
  corDaDisciplina,
  criarMateriaSimples,
  hojeNoFuso,
  marcarBloco,
  type BlocoEstudo,
  type EventoNovo,
  type MateriaParaMontagem,
  type TopicoParaMontagem,
} from "../lib/dados";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { useToast } from "../lib/toast";
import { useValidacao } from "../lib/formulario";
import { AvisoDeFormulario, MensagemErro } from "../componentes/MensagemErro";

const TIPO_ROTULO: Record<BlocoEstudo["tipo"], string> = {
  leitura: "Leitura",
  exercicios: "Exercícios",
  revisao: "Revisão",
  marco: "Marco",
};

const DURACAO_POMODORO = 25 * 60;

/** Os action-tiles da tela herdam a cor do módulo (azul de estudo) em vez
    do verde padrão do token — é o que amarra as ações à identidade da aba. */
const CORES_ESTUDO = {
  "--tile-cor": "var(--estudo-ink)",
  "--tile-cor-fraca": "var(--estudo-fraco)",
} as CSSProperties;

export function Estudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [materias, setMaterias] = useState<MateriaParaMontagem[]>([]);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [criando, setCriando] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);
  // Guarda qual matéria acabou de nascer, só para destacá-la na lista.
  // Sem isso, "criei e não aconteceu nada" continuaria valendo mesmo com
  // a lista existindo: ela entraria no meio de outras seis, sem aviso.
  const [materiaNovaId, setMateriaNovaId] = useState<string | null>(null);
  const [materiaAberta, setMateriaAberta] = useState<string | null>(null);
  const toast = useToast();

  // Timer Pomodoro — mesma lógica de relógio (Date.now(), não setInterval
  // acumulado) do descanso em SessaoTreino.tsx, adaptada pra suportar
  // pausa: enquanto rodando, um efeito recalcula contra um alvo fixo;
  // ao pausar, `restante` já está congelado no último valor calculado.
  const [restante, setRestante] = useState(DURACAO_POMODORO);
  const [rodando, setRodando] = useState(false);

  // O formulário de nova matéria abre no fim da página, embaixo da lista
  // de disciplinas — sem isso, o toque em "Nova matéria" não muda nada
  // visível na tela (o card nasce fora da viewport).
  const formNovaMateriaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (criando) formNovaMateriaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [criando]);

  useEffect(() => {
    if (!rodando) return;
    const alvo = Date.now() + restante * 1000;
    const tique = setInterval(() => {
      const restam = Math.max(0, Math.ceil((alvo - Date.now()) / 1000));
      setRestante(restam);
      if (restam <= 0) {
        setRodando(false);
        toast.sucesso("Pomodoro concluído!");
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
      const [ms, bs] = await Promise.all([
        // `...ParaMontagem` e não `carregarMaterias`: traz tópicos e eventos
        // no mesmo round-trip, que é o que a lista de matérias mostra. As
        // duas consultas filtram e ordenam igual, então a cor de cada
        // disciplina (que sai da posição na lista) não muda.
        carregarMateriasParaMontagem(userId),
        carregarBlocosDoDia(userId, hojeNoFuso(tz)),
      ]);
      setMaterias(ms);
      setBlocos(bs);
    } catch (e) {
      // O estado vazio desta tela AFIRMA que você não tem matéria nenhuma
      // e esconde Pomodoro, plano e blocos junto. Cair nele por causa de
      // uma consulta que falhou era o bug que fazia parecer que as
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
   * Liga a flag que faz o card "Estudo de hoje" existir na Home.
   *
   * Era chamada só no caminho do estado vazio. Quem criasse a primeira
   * matéria pelo botão "Nova matéria" do fim da tela ficava com a flag
   * falsa — e aí o Estudo sumia da Home, e a Home nem carregava blocos e
   * matérias (`Home.tsx` só busca isso quando `usa_estudo`). O erro
   * também não era conferido: o Supabase não lança sozinho.
   */
  async function ligarUsaEstudo() {
    const { error } = await supabase
      .from("profiles")
      .update({ usa_estudo: true })
      .eq("id", userId);
    if (error) console.warn("não deu para ligar usa_estudo:", error.message);
  }

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

        <NovaMateria
          onCriada={async (_id, nomeCriado) => {
            await ligarUsaEstudo();
            toast.sucesso(`Matéria "${nomeCriado}" criada.`);
            await carregar();
          }}
        />
      </div>
    );
  }

  const pendentes = blocos.filter((b) => b.status === "pendente");
  const feitos = blocos.filter((b) => b.status !== "pendente");
  const minutos = Math.floor(restante / 60);
  const segundos = restante % 60;

  return (
    <div className="tela">
      <header className="mb-4">
        <span className="text-sm text-ink-muted">Sessão de estudo</span>
        <h1 className="h1">Estudo</h1>
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

      {/* ---- Timer Pomodoro ------------------------------------------- */}
      <div className="card mb-6 flex flex-col items-center gap-4 py-6" style={{ borderRadius: "1.25rem" }}>
        <div className="text-center">
          <div className="display text-6xl num">
            {String(minutos).padStart(2, "0")}:{String(segundos).padStart(2, "0")}
          </div>
          <span className="text-xs text-ink-terciario">Foco total · Pomodoro</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="stepper-btn"
            style={{ borderRadius: "999px" }}
            onClick={() => {
              setRodando(false);
              setRestante(DURACAO_POMODORO);
            }}
            aria-label="Reiniciar pomodoro"
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
              setRestante(DURACAO_POMODORO);
              toast.sucesso("Pomodoro reiniciado");
            }}
            aria-label="Pular pomodoro"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      {/* Este rótulo dizia "Disciplinas" e listava BLOCOS — era a origem
          do "criei uma matéria e ela não aparece em lugar nenhum": o único
          lugar que parecia listar matérias listava outra coisa. */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Blocos de hoje</span>
      {blocos.length === 0 ? (
        <div className="vazio mb-6">
          <p>Nenhum bloco planejado para hoje.</p>
          <p className="text-sm text-ink-terciario">
            Os blocos nascem do plano — é ele que distribui seus tópicos nos horários da grade.
          </p>
          <Link className="btn btn-estudo" to="/estudo/montar">
            Montar plano
          </Link>
        </div>
      ) : (
        <div className="card mb-6">
          {[...pendentes, ...feitos].map((b) => (
            <LinhaDeBloco
              key={b.id}
              bloco={b}
              cor={corDaDisciplina(b.materia_id, materias)}
              onAlternar={() => void alternarBloco(b)}
            />
          ))}
        </div>
      )}

      {/* ---- Suas matérias --------------------------------------------
          A seção que não existia. Sem ela, criar matéria era uma escrita
          sem retorno: o dado ia pro banco e não tinha onde aparecer. */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Suas matérias</span>
      <div className="flex flex-col gap-3 mb-6">
        {materias.map((m) => (
          <LinhaDeMateria
            key={m.id}
            materia={m}
            cor={corDaDisciplina(m.id, materias)}
            nova={m.id === materiaNovaId}
            aberta={materiaAberta === m.id}
            onAlternar={() => setMateriaAberta((atual) => (atual === m.id ? null : m.id))}
            onExcluida={async () => {
              toast.sucesso(`Matéria "${m.nome}" excluída.`);
              setMateriaAberta(null);
              await carregar();
            }}
            onTopicoExcluido={async (nomeTopico) => {
              toast.sucesso(`Tópico "${nomeTopico}" excluído.`);
              await carregar();
            }}
            onErro={(msg) => toast.erro(msg)}
          />
        ))}
      </div>

      {!criando ? (
        <button className="btn btn-neutro" onClick={() => setCriando(true)}>
          Nova matéria
        </button>
      ) : (
        <div ref={formNovaMateriaRef}>
          <NovaMateria
            onCriada={async (materiaId, nomeCriado) => {
              setCriando(false);
              setMateriaNovaId(materiaId);
              // Também aqui: era o caminho que esquecia a flag.
              await ligarUsaEstudo();
              toast.sucesso(`Matéria "${nomeCriado}" criada.`);
              await carregar();
            }}
            onCancelar={() => setCriando(false)}
          />
        </div>
      )}
    </div>
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
}: {
  bloco: BlocoEstudo;
  cor: string;
  onAlternar: () => void;
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

const DIFICULDADE_ROTULO = { facil: "fácil", medio: "médio", dificil: "difícil" } as const;

/**
 * Matéria na lista: toca para ver os tópicos, e é lá dentro que mora o
 * excluir.
 *
 * A linha era propositalmente inerte porque não havia para onde levar.
 * Agora tem destino (a própria lista de tópicos), então passa a cumprir a
 * regra de affordance do index.css: é `<button>` de verdade e mostra o
 * chevron. O excluir fica DENTRO do painel aberto, não na linha fechada —
 * regra 4: ação com consequência não mora no corpo de uma linha que a
 * pessoa toca para navegar.
 */
function LinhaDeMateria({
  materia,
  cor,
  nova,
  aberta,
  onAlternar,
  onExcluida,
  onTopicoExcluido,
  onErro,
}: {
  materia: MateriaParaMontagem;
  cor: string;
  nova: boolean;
  aberta: boolean;
  onAlternar: () => void;
  onExcluida: () => void | Promise<void>;
  onTopicoExcluido: (nomeTopico: string) => void | Promise<void>;
  onErro: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // Id do tópico sendo excluído — não `boolean`, porque vários podem estar
  // na lista ao mesmo tempo e só UM botão pode ficar "excluindo…" por vez.
  const [excluindoTopico, setExcluindoTopico] = useState<string | null>(null);

  /**
   * Excluir tópico é ação LEVE de propósito, diferente da matéria: sem
   * modal de confirmação em 2 passos. Numa lista de 10 tópicos, exigir
   * confirmação pra cada um vira atrito que faz a pessoa desistir de
   * arrumar a lista. O toast que confirma ("Tópico excluído") é o "OK,
   * entendi" — se errar o dedo, a perda é um item numa lista, não uma
   * matéria inteira com histórico.
   */
  async function excluirTopico(topico: TopicoParaMontagem) {
    setExcluindoTopico(topico.id);
    try {
      await arquivarTopico(topico.id);
      await onTopicoExcluido(topico.nome);
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não deu para excluir o tópico.");
    } finally {
      setExcluindoTopico(null);
    }
  }

  useEffect(() => {
    if (nova) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [nova]);

  const total = materia.topicos.length;
  // "Sem plano" responde exatamente à pergunta "criei a matéria, e agora?".
  // `blocosEstimados` só é preenchido pela Fase A do montar-estudo.
  const semPlano = total > 0 && materia.topicos.every((t) => t.blocosEstimados == null);
  const proximoEvento = materia.eventos
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))[0];

  async function excluir() {
    setExcluindo(true);
    try {
      await arquivarMateria(materia.id);
      await onExcluida();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não deu para excluir a matéria.");
      setExcluindo(false);
    }
  }

  return (
    <div
      ref={ref}
      className={nova ? "card subject-row--nova" : "card"}
      style={{ padding: 0 }}
    >
      <button
        type="button"
        className="subject-row w-full text-left"
        style={{ "--cor": cor, paddingInline: "var(--e-4)" } as CSSProperties}
        onClick={onAlternar}
        aria-expanded={aberta}
      >
        <span className="subject-row__cor" />
        <div className="subject-row__texto">
          <div className="h3">{materia.nome}</div>
          <div className="text-xs text-ink-terciario">
            {total} {total === 1 ? "tópico" : "tópicos"}
            {proximoEvento &&
              ` · ${proximoEvento.tipo === "prova" ? "prova" : "entrega"} em ${proximoEvento.data
                .split("-")
                .reverse()
                .slice(0, 2)
                .join("/")}`}
          </div>
        </div>
        {semPlano ? (
          <span className="badge badge-atencao shrink-0">sem plano</span>
        ) : (
          <span className="badge badge-estudo shrink-0">no plano</span>
        )}
        <ChevronDown
          size={18}
          className="text-ink-muted shrink-0"
          style={{
            transform: aberta ? "rotate(180deg)" : "none",
            transition: "transform var(--d-entrar) var(--ease-out)",
          }}
        />
      </button>

      {aberta && (
        <div style={{ padding: "0 var(--e-4) var(--e-4)" }}>
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: "var(--e-3)" }}>
            {total === 0 ? (
              <p className="text-sm text-ink-muted">Esta matéria não tem tópicos cadastrados.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {materia.topicos.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="text-xs text-ink-fraco num shrink-0" style={{ width: "1.5rem" }}>
                      {t.ordem}.
                    </span>
                    <span className="text-sm flex-1">{t.nome}</span>
                    {t.dificuldade && (
                      <span className="badge shrink-0" style={{ background: "var(--surface-alta)" }}>
                        {DIFICULDADE_ROTULO[t.dificuldade]}
                      </span>
                    )}
                    {/* `compreendido` é tri-state e só desce por resposta do
                        mini-questionário — `null` significa "ainda não
                        respondeu", que não é o mesmo que "não entendeu". */}
                    {t.compreendido === false && (
                      <span className="badge badge-atencao shrink-0">revisar</span>
                    )}
                    <button
                      type="button"
                      className="topico-excluir"
                      onClick={() => void excluirTopico(t)}
                      disabled={excluindoTopico === t.id}
                      aria-label={`Excluir tópico "${t.nome}"`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--hairline)", marginTop: "var(--e-4)", paddingTop: "var(--e-3)" }}>
            {!confirmando ? (
              <button className="btn btn-perigo" onClick={() => setConfirmando(true)}>
                <Trash2 size={16} /> Excluir matéria
              </button>
            ) : (
              <div role="alertdialog" aria-label="Confirmar exclusão da matéria">
                <p className="mb-1">Excluir "{materia.nome}"?</p>
                {/* Diz a verdade sobre o que sobrevive. É arquivamento
                    (`ativa = false`), justamente para não destruir o que
                    está listado abaixo — ver `arquivarMateria` em dados.ts. */}
                <p className="text-sm text-ink-muted mb-4">
                  Ela sai da sua lista e dos próximos planos. O que você já estudou continua
                  contando no seu histórico e no resumo da semana.
                </p>
                <div className="flex gap-2">
                  <button className="btn btn-perigo" onClick={() => void excluir()} disabled={excluindo}>
                    {excluindo ? "Excluindo…" : "Sim, excluir"}
                  </button>
                  <button className="btn btn-neutro" onClick={() => setConfirmando(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NovaMateria({
  onCriada,
  onCancelar,
}: {
  onCriada: (materiaId: string, nome: string) => void | Promise<void>;
  onCancelar?: () => void;
}) {
  const [nome, setNome] = useState("");
  const [topicos, setTopicos] = useState(["", "", ""]);
  const [eventos, setEventos] = useState<EventoNovo[]>([]);
  const [tipoEventoNovo, setTipoEventoNovo] = useState<"prova" | "entrega">("prova");
  const [dataEventoNovo, setDataEventoNovo] = useState("");
  const [descEventoNovo, setDescEventoNovo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { campo, erros, errosSemCampo, idDoErro, limpar, validar } =
    useValidacao<"nome" | "topico">();

  // Modo só decide qual entrada de tópico aparece. `origemAtual` e
  // `confiancaAtual` são o que de fato vai pro banco — ficam "manual"/
  // "alta" até uma extração ter sucesso, e não voltam atrás só porque a
  // pessoa reabriu o modo manual pra ajustar um tópico.
  const [modo, setModo] = useState<"manual" | "pdf" | "ia">("manual");
  const [origemAtual, setOrigemAtual] = useState<OrigemDosTopicos>("manual");
  const [confiancaAtual, setConfiancaAtual] = useState<"alta" | "media" | "baixa">("alta");
  const [curso, setCurso] = useState("");
  const [periodo, setPeriodo] = useState<number | null>(null);
  // Estado compartilhado pelos DOIS caminhos de IA (PDF e por nome): o
  // fluxo depois da resposta é idêntico — revisar a lista e salvar —,
  // então duplicar seria só chance de os dois divergirem.
  const [iaEstado, setIaEstado] = useState<"ocioso" | "lendo" | "analisando" | "erro">("ocioso");
  const [iaErro, setIaErro] = useState<string | null>(null);
  const [pdfNomeArquivo, setPdfNomeArquivo] = useState<string | null>(null);
  const [iaAvisos, setIaAvisos] = useState<string[]>([]);
  const [pdfDatas, setPdfDatas] = useState<DataExtraidaDoPdf[]>([]);

  /** Ponto único onde uma extração vira estado do formulário. */
  function aplicarExtracao(extracao: ExtracaoDeTopicos, vazioMsg: string) {
    setTopicos(extracao.topicos.length > 0 ? extracao.topicos.map((t) => t.nome) : [""]);
    if (!nome.trim() && extracao.materiaDetectada) setNome(extracao.materiaDetectada);
    setOrigemAtual(extracao.origem);
    setConfiancaAtual(extracao.confianca);
    setPdfDatas(extracao.datasEncontradas);
    setIaAvisos(extracao.topicos.length === 0 ? [vazioMsg] : extracao.avisos);
    setIaEstado("ocioso");
    limpar("topico");
  }

  async function aoEscolherPdf(arquivo: File) {
    setPdfNomeArquivo(arquivo.name);
    setIaErro(null);
    setIaAvisos([]);
    setPdfDatas([]);
    setIaEstado("lendo");
    try {
      const texto = await extrairTextoDoPdf(arquivo);
      setIaEstado("analisando");
      aplicarExtracao(
        await extrairTopicosDoTexto(texto),
        "Nenhum tópico identificado neste arquivo — digite manualmente abaixo.",
      );
    } catch (e) {
      setIaErro(e instanceof Error ? e.message : "Não deu para ler o arquivo.");
      setIaEstado("erro");
    }
  }

  /**
   * Gera os tópicos só com o nome da matéria — sem documento nenhum.
   * Usa o campo "Nome da matéria" lá de cima, então valida ele primeiro:
   * sem isso, o toque no botão não faria nada e a pessoa não saberia por quê.
   */
  async function gerarPeloNome() {
    setIaErro(null);
    if (!validar([{ campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome à matéria primeiro." }])) {
      return;
    }
    setIaAvisos([]);
    setPdfDatas([]);
    setIaEstado("analisando");
    try {
      aplicarExtracao(
        await gerarTopicosPeloNome(nome.trim(), curso, periodo),
        "A IA não conseguiu listar tópicos para essa matéria — digite manualmente abaixo.",
      );
    } catch (e) {
      setIaErro(e instanceof Error ? e.message : "Não deu para gerar os tópicos.");
      setIaEstado("erro");
    }
  }

  function adicionarEvento() {
    if (!dataEventoNovo) return;
    setEventos((atual) => [
      ...atual,
      { tipo: tipoEventoNovo, data: dataEventoNovo, descricao: descEventoNovo.trim() || null },
    ]);
    setDataEventoNovo("");
    setDescEventoNovo("");
  }

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErroServidor(null);
    const nomesTopicos = topicos.map((t) => t.trim()).filter(Boolean);

    // Duas regras separadas, não uma mensagem única no fim do formulário:
    // o foco vai para o campo que de fato faltou. Quando o modo é PDF os
    // inputs de tópico nem estão montados — aí o hook joga a mensagem em
    // `errosSemCampo`, que sai no `.aviso-form` acima do botão.
    const passou = validar([
      { campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome à matéria." },
      {
        campo: "topico",
        valido: nomesTopicos.length > 0,
        mensagem: "Cadastre pelo menos um tópico.",
      },
    ]);
    if (!passou) return;

    setEnviando(true);
    try {
      const materiaId = await criarMateriaSimples(
        nome.trim(),
        nomesTopicos.map((n) => ({ nome: n, dificuldade: null })),
        eventos,
        origemAtual,
        confiancaAtual,
      );
      await onCriada(materiaId, nome.trim());
    } catch (e) {
      setErroServidor(e instanceof Error ? e.message : "Não deu para criar a matéria.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className="card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="h2">Nova matéria</span>
        {onCancelar && (
          <button
            type="button"
            className="text-ink-muted shrink-0"
            onClick={onCancelar}
            aria-label="Cancelar"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div>
        <label>
          <div className="text-sm text-ink-muted mb-1">Nome da matéria</div>
          <input
            className="campo"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              limpar("nome");
            }}
            {...campo("nome")}
          />
        </label>
        {erros.nome && <MensagemErro id={idDoErro("nome")}>{erros.nome}</MensagemErro>}
      </div>

      <div>
        <div className="text-sm text-ink-muted mb-1">Como cadastrar os tópicos</div>
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            type="button"
            className={modo === "manual" ? "chip chip-estudo" : "chip"}
            onClick={() => setModo("manual")}
          >
            Digitar
          </button>
          <button
            type="button"
            className={modo === "pdf" ? "chip chip-estudo" : "chip"}
            onClick={() => setModo("pdf")}
          >
            Importar PDF
          </button>
          <button
            type="button"
            className={modo === "ia" ? "chip chip-estudo" : "chip"}
            onClick={() => setModo("ia")}
          >
            Gerar pela IA
          </button>
        </div>

        {modo === "ia" && (
          <div className="flex flex-col gap-2 mb-3">
            <p className="text-sm text-ink-muted">
              Sem plano de ensino em mãos? A IA lista os tópicos que essa disciplina costuma
              cobrir — você revisa e ajusta antes de salvar.
            </p>
            <label>
              <div className="text-sm text-ink-muted mb-1">
                Curso <span className="text-ink-terciario">(opcional, melhora o palpite)</span>
              </div>
              <input
                className="campo"
                placeholder="Engenharia de Software, Direito, Medicina…"
                value={curso}
                onChange={(e) => setCurso(e.target.value)}
                maxLength={120}
              />
            </label>
            <div>
              <div className="text-sm text-ink-muted mb-1">
                Período <span className="text-ink-terciario">(opcional)</span>
              </div>
              {/* Chip, não <select>: um <select> customizado (appearance:none
                  + seta própria) esbarrou num bug real do motor Chromium —
                  o menu suspenso nativo é medido pela caixa inteira do
                  campo, e cada opção virava um bloco enorme, lista quase
                  em branco. Chip é o padrão que já funciona neste app
                  (GradeEstudo usa o mesmo pros dias da semana) — sem
                  depender de popup nenhum renderizado pelo SO. */}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className={periodo === null ? "chip chip-estudo" : "chip"}
                  onClick={() => setPeriodo(null)}
                >
                  Não informar
                </button>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={periodo === n ? "chip chip-estudo" : "chip"}
                    onClick={() => setPeriodo(n)}
                  >
                    {n}º
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-neutro w-fit"
              onClick={() => void gerarPeloNome()}
              disabled={iaEstado === "analisando"}
            >
              <Sparkles size={16} />
              {iaEstado === "analisando" ? "Gerando…" : "Gerar tópicos"}
            </button>
            {/* A confiança vem forçada como "baixa" pelo backend, e é
                verdade: isto é palpite sobre a ementa típica, não a ementa
                do SEU professor. */}
            <p className="dica-campo">
              A lista é um ponto de partida — confira com o plano de ensino da sua turma.
            </p>

            {iaEstado === "analisando" && (
              <p className="text-sm text-ink-muted">
                Consultando a IA — pode levar até um minuto.
              </p>
            )}
            {iaEstado === "erro" && iaErro && <AvisoDeFormulario>{iaErro}</AvisoDeFormulario>}
            {iaEstado === "ocioso" && origemAtual === "ia_nome_materia" && (
              <div className="flex flex-col gap-1">
                <span className="badge badge-estudo w-fit">
                  {topicos.filter((t) => t.trim()).length} tópicos sugeridos — revise abaixo antes de salvar
                </span>
                {iaAvisos.map((a, i) => (
                  <p key={i} className="text-xs text-ink-terciario">· {a}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {modo === "pdf" && (
          <div className="flex flex-col gap-2 mb-3">
            <label className="btn btn-neutro w-fit flex items-center gap-2" style={{ cursor: "pointer" }}>
              <Upload size={16} />
              {pdfNomeArquivo ? "Trocar arquivo" : "Escolher PDF do plano de ensino"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void aoEscolherPdf(arquivo);
                  e.target.value = "";
                }}
              />
            </label>
            {pdfNomeArquivo && <p className="text-xs text-ink-terciario num">{pdfNomeArquivo}</p>}

            {iaEstado === "lendo" && <p className="text-sm text-ink-muted">Lendo o PDF…</p>}
            {iaEstado === "analisando" && (
              <p className="text-sm text-ink-muted">
                A IA está identificando os tópicos — pode levar até um minuto.
              </p>
            )}
            {iaEstado === "erro" && iaErro && (
              <>
                <AvisoDeFormulario>{iaErro}</AvisoDeFormulario>
                {/* PDF escaneado (foto do plano fotocopiado) é o caso que o
                    backend rejeita por falta de texto — e até aqui a única
                    saída oferecida era "digite manualmente", ou seja, 12
                    linhas na mão. Agora tem um caminho de verdade. */}
                <button
                  type="button"
                  className="btn btn-neutro w-fit"
                  onClick={() => {
                    setModo("ia");
                    setIaErro(null);
                    setIaEstado("ocioso");
                  }}
                >
                  <Sparkles size={16} /> Gerar pelo nome da matéria
                </button>
              </>
            )}
            {iaEstado === "ocioso" && origemAtual === "pdf" && (
              <div className="flex flex-col gap-1">
                <span className="badge badge-estudo w-fit">
                  {topicos.filter((t) => t.trim()).length} tópicos extraídos — revise abaixo antes de salvar
                </span>
                {confiancaAtual === "baixa" && (
                  <p className="text-xs text-atencao-ink">Confiança baixa: confira cada tópico com atenção.</p>
                )}
                {iaAvisos.map((a, i) => (
                  <p key={i} className="text-xs text-ink-terciario">· {a}</p>
                ))}
              </div>
            )}

            {pdfDatas.length > 0 && (
              <div className="mt-1">
                <div className="text-sm text-ink-muted mb-1">Datas encontradas no documento</div>
                <div className="flex flex-col gap-2">
                  {pdfDatas.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-hairline px-3 py-2">
                      <Calendar size={16} className="text-ink-muted shrink-0" />
                      <span className="text-sm flex-1">
                        {d.tipo === "prova" ? "Prova" : "Entrega"} — "{d.dataTexto}"
                        {d.descricao && ` · ${d.descricao}`}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-estudo-ink underline shrink-0"
                        onClick={() => {
                          setTipoEventoNovo(d.tipo);
                          setDescEventoNovo(d.descricao ?? "");
                        }}
                      >
                        Usar
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-terciario mt-1">
                  O texto da data não é confiável — escolha a data certa embaixo antes de adicionar.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* A lista editável aparece no modo manual e sempre que já existe
          resultado de IA para revisar — é ela a "tela de revisão" que o
          backend pressupõe ao nunca gravar nada por conta própria. */}
      {(modo === "manual" || origemAtual !== "manual") && (
      <div>
        <div className="text-sm text-ink-muted mb-1">Tópicos</div>
        {topicos.map((t, i) => (
          <input
            key={i}
            className="campo mb-2"
            placeholder={`Tópico ${i + 1}`}
            value={t}
            onChange={(e) => {
              setTopicos((atual) => atual.map((x, j) => (j === i ? e.target.value : x)))
              limpar("topico");
            }}
            /* Só o primeiro input recebe o gancho de validação: a regra é
               "pelo menos um tópico", então é para ele que o foco vai. */
            {...(i === 0 ? campo("topico") : {})}
          />
        ))}
        {erros.topico && <MensagemErro id={idDoErro("topico")}>{erros.topico}</MensagemErro>}
        <button
          type="button"
          className="btn btn-neutro"
          onClick={() => setTopicos((atual) => [...atual, ""])}
        >
          + tópico
        </button>
      </div>
      )}

      <div>
        <div className="text-sm text-ink-muted mb-1">
          Provas e entregas <span className="text-ink-terciario">(opcional)</span>
        </div>
        {/* Prova cobre a matéria inteira automaticamente (a RPC liga todo
            tópico já cadastrado a ela) — não precisa escolher quais. */}
        {eventos.length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {eventos.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-hairline px-3 py-2">
                <Calendar size={16} className="text-ink-muted shrink-0" />
                <span className="text-sm flex-1">
                  {ev.tipo === "prova" ? "Prova" : "Entrega"} em {ev.data.split("-").reverse().join("/")}
                  {ev.descricao && ` — ${ev.descricao}`}
                </span>
                <button
                  type="button"
                  className="text-ink-muted shrink-0"
                  onClick={() => setEventos((atual) => atual.filter((_, j) => j !== i))}
                  aria-label="Remover evento"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            className={tipoEventoNovo === "prova" ? "chip chip-estudo" : "chip"}
            onClick={() => setTipoEventoNovo("prova")}
          >
            Prova
          </button>
          <button
            type="button"
            className={tipoEventoNovo === "entrega" ? "chip chip-estudo" : "chip"}
            onClick={() => setTipoEventoNovo("entrega")}
          >
            Entrega
          </button>
        </div>
        <div className="flex gap-2 mb-2">
          <input
            className="campo flex-1"
            type="date"
            value={dataEventoNovo}
            onChange={(e) => setDataEventoNovo(e.target.value)}
            aria-label="Data do evento"
          />
        </div>
        <input
          className="campo mb-2"
          placeholder="Descrição (opcional)"
          value={descEventoNovo}
          onChange={(e) => setDescEventoNovo(e.target.value)}
        />
        <button type="button" className="btn btn-neutro" onClick={adicionarEvento} disabled={!dataEventoNovo}>
          Adicionar evento
        </button>
      </div>

      {/* Colado ao botão de propósito — é onde o polegar já está. */}
      {errosSemCampo.length > 0 && (
        <AvisoDeFormulario>
          {errosSemCampo.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </AvisoDeFormulario>
      )}
      {erroServidor && <AvisoDeFormulario>{erroServidor}</AvisoDeFormulario>}

      <button className="btn btn-estudo btn-bloco" type="submit" disabled={enviando}>
        {enviando ? "Criando…" : "Criar matéria"}
      </button>
    </form>
  );
}
