import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router";
import { Calendar, Check, Pause, Play, RotateCcw, SkipForward, Upload, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { notificarFimDoTimer } from "../lib/notificacaoTimer";
import { extrairTextoDoPdf } from "../lib/pdf";
import { extrairTopicosDoTexto, type DataExtraidaDoPdf } from "../lib/extrairTopicos";
import {
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
} from "../lib/dados";
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

export function Estudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [materias, setMaterias] = useState<MateriaParaMontagem[]>([]);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [criando, setCriando] = useState(false);
  // Guarda qual matéria acabou de nascer, só para destacá-la na lista.
  // Sem isso, "criei e não aconteceu nada" continuaria valendo mesmo com
  // a lista existindo: ela entraria no meio de outras seis, sem aviso.
  const [materiaNovaId, setMateriaNovaId] = useState<string | null>(null);
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
    setCarregando(false);
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

  if (materias.length === 0) {
    return (
      <div className="tela">
        <header className="flex items-baseline justify-between mb-4">
          <h1 className="h1">Estudo</h1>
          <Link className="text-sm text-ink-muted underline" to="/estudo/grade">
            Grade
          </Link>
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
            if (sessao) {
              await supabase.from("profiles").update({ usa_estudo: true }).eq("id", sessao.user.id);
            }
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
      <header className="flex items-baseline justify-between mb-4">
        <div>
          <span className="text-sm text-ink-muted">Sessão de estudo</span>
          <h1 className="h1">Blocos de hoje</h1>
        </div>
        <Link className="text-sm text-ink-muted underline" to="/estudo/grade">
          Grade
        </Link>
      </header>

      <Link to="/estudo/montar" className="card card-estudo block mb-6">
        <span className="rotulo-secao text-estudo-ink mb-1">Plano de estudo</span>
        <div className="h2">Montar plano de estudo</div>
        <p className="text-sm text-ink-muted mt-1">
          A IA estima o esforço de cada tópico e distribui na sua grade de horários.
        </p>
      </Link>

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
      <div className="card mb-6">
        {materias.map((m) => (
          <LinhaDeMateria
            key={m.id}
            materia={m}
            cor={corDaDisciplina(m.id, materias)}
            nova={m.id === materiaNovaId}
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

/** Linha de matéria — informativa, não clicável (não existe tela de
    matéria). Ver a regra de affordance em index.css: card/linha que não
    leva a lugar nenhum não ganha hover, cursor nem chevron. */
function LinhaDeMateria({
  materia,
  cor,
  nova,
}: {
  materia: MateriaParaMontagem;
  cor: string;
  nova: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={ref}
      className={nova ? "subject-row subject-row--nova" : "subject-row"}
      style={{ "--cor": cor } as CSSProperties}
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
  // "alta" até uma extração de PDF ter sucesso, e não voltam atrás só
  // porque a pessoa reabriu o modo manual pra ajustar um tópico.
  const [modo, setModo] = useState<"manual" | "pdf">("manual");
  const [origemAtual, setOrigemAtual] = useState<"manual" | "pdf">("manual");
  const [confiancaAtual, setConfiancaAtual] = useState<"alta" | "media" | "baixa">("alta");
  const [pdfEstado, setPdfEstado] = useState<"ocioso" | "lendo" | "analisando" | "erro">("ocioso");
  const [pdfErro, setPdfErro] = useState<string | null>(null);
  const [pdfNomeArquivo, setPdfNomeArquivo] = useState<string | null>(null);
  const [pdfAvisos, setPdfAvisos] = useState<string[]>([]);
  const [pdfDatas, setPdfDatas] = useState<DataExtraidaDoPdf[]>([]);

  async function aoEscolherPdf(arquivo: File) {
    setPdfNomeArquivo(arquivo.name);
    setPdfErro(null);
    setPdfAvisos([]);
    setPdfDatas([]);
    setPdfEstado("lendo");
    try {
      const texto = await extrairTextoDoPdf(arquivo);
      setPdfEstado("analisando");
      const extracao = await extrairTopicosDoTexto(texto);

      setTopicos(extracao.topicos.length > 0 ? extracao.topicos.map((t) => t.nome) : [""]);
      if (!nome.trim() && extracao.materiaDetectada) setNome(extracao.materiaDetectada);
      setOrigemAtual("pdf");
      setConfiancaAtual(extracao.confianca);
      setPdfDatas(extracao.datasEncontradas);
      setPdfAvisos(
        extracao.topicos.length === 0
          ? ["Nenhum tópico identificado neste arquivo — digite manualmente abaixo."]
          : extracao.avisos,
      );
      setPdfEstado("ocioso");
    } catch (e) {
      setPdfErro(e instanceof Error ? e.message : "Não deu para ler o arquivo.");
      setPdfEstado("erro");
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
        <div className="flex gap-2 mb-3">
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
        </div>

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

            {pdfEstado === "lendo" && <p className="text-sm text-ink-muted">Lendo o PDF…</p>}
            {pdfEstado === "analisando" && (
              <p className="text-sm text-ink-muted">
                A IA está identificando os tópicos — pode levar até um minuto.
              </p>
            )}
            {pdfEstado === "erro" && pdfErro && <AvisoDeFormulario>{pdfErro}</AvisoDeFormulario>}
            {pdfEstado === "ocioso" && origemAtual === "pdf" && (
              <div className="flex flex-col gap-1">
                <span className="badge badge-estudo w-fit">
                  {topicos.filter((t) => t.trim()).length} tópicos extraídos — revise abaixo antes de salvar
                </span>
                {confiancaAtual === "baixa" && (
                  <p className="text-xs text-atencao-ink">Confiança baixa: confira cada tópico com atenção.</p>
                )}
                {pdfAvisos.map((a, i) => (
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

      {(modo === "manual" || origemAtual === "pdf") && (
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
