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
  carregarMaterias,
  carregarPerfil,
  corDaDisciplina,
  criarMateriaSimples,
  hojeNoFuso,
  marcarBloco,
  type BlocoEstudo,
  type EventoNovo,
  type Materia,
} from "../lib/dados";
import { Toast } from "../componentes/Toast";

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
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [criando, setCriando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
        setToast("Pomodoro concluído!");
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
      carregarMaterias(userId),
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

  async function concluirBloco(bloco: BlocoEstudo) {
    await marcarBloco(bloco.id, "concluido", bloco.duracao_min * 60);
    setBlocos((atual) =>
      atual.map((b) => (b.id === bloco.id ? { ...b, status: "concluido" } : b)),
    );
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
        <NovaMateria
          onCriada={async () => {
            if (sessao) {
              await supabase.from("profiles").update({ usa_estudo: true }).eq("id", sessao.user.id);
            }
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
      <Toast mensagem={toast} onFechar={() => setToast(null)} />

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
              setToast("Pomodoro pulado");
            }}
            aria-label="Pular pomodoro"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      <span className="rotulo-secao text-ink-muted mb-2 block">Disciplinas</span>
      {blocos.length === 0 ? (
        <div className="vazio mb-6">
          <p>Nenhum bloco de estudo planejado para hoje.</p>
        </div>
      ) : (
        <div className="card mb-6">
          {pendentes.map((b) => (
            <button
              key={b.id}
              type="button"
              className="subject-row w-full text-left"
              style={{ "--cor": corDaDisciplina(b.materia_id, materias) } as CSSProperties}
              onClick={() => void concluirBloco(b)}
            >
              <span className="subject-row__cor" />
              <div className="subject-row__texto">
                <div className="h3">{b.titulo}</div>
                <div className="text-xs text-ink-terciario">
                  {TIPO_ROTULO[b.tipo]} · {b.hora.slice(0, 5)} · {b.duracao_min} min planejados
                </div>
              </div>
              <span className="subject-row__caixa" aria-checked="false" role="checkbox" />
            </button>
          ))}
          {feitos.map((b) => (
            <div
              key={b.id}
              className="subject-row"
              style={{ "--cor": corDaDisciplina(b.materia_id, materias) } as CSSProperties}
            >
              <span className="subject-row__cor" />
              <div className="subject-row__texto">
                <div className="h3 text-ink-muted">{b.titulo}</div>
                <div className="text-xs text-ink-terciario">{b.duracao_min} min planejados</div>
              </div>
              <span className="subject-row__caixa" aria-checked="true" role="checkbox">
                <Check size={14} />
              </span>
            </div>
          ))}
        </div>
      )}

      {!criando ? (
        <button className="btn btn-neutro" onClick={() => setCriando(true)}>
          Nova matéria
        </button>
      ) : (
        <div ref={formNovaMateriaRef}>
          <NovaMateria
            onCriada={async () => {
              setCriando(false);
              await carregar();
            }}
            onCancelar={() => setCriando(false)}
          />
        </div>
      )}
    </div>
  );
}

function NovaMateria({
  onCriada,
  onCancelar,
}: {
  onCriada: () => void | Promise<void>;
  onCancelar?: () => void;
}) {
  const [nome, setNome] = useState("");
  const [topicos, setTopicos] = useState(["", "", ""]);
  const [eventos, setEventos] = useState<EventoNovo[]>([]);
  const [tipoEventoNovo, setTipoEventoNovo] = useState<"prova" | "entrega">("prova");
  const [dataEventoNovo, setDataEventoNovo] = useState("");
  const [descEventoNovo, setDescEventoNovo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    setErro(null);
    const nomesTopicos = topicos.map((t) => t.trim()).filter(Boolean);
    if (!nome.trim() || nomesTopicos.length === 0) {
      setErro("Dê um nome à matéria e pelo menos um tópico.");
      return;
    }
    setEnviando(true);
    try {
      await criarMateriaSimples(
        nome.trim(),
        nomesTopicos.map((n) => ({ nome: n, dificuldade: null })),
        eventos,
        origemAtual,
        confiancaAtual,
      );
      await onCriada();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para criar a matéria.");
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

      <label>
        <div className="text-sm text-ink-muted mb-1">Nome da matéria</div>
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>

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
            {pdfEstado === "erro" && pdfErro && (
              <p className="text-sm" style={{ color: "var(--perigo-ink)" }}>{pdfErro}</p>
            )}
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
            onChange={(e) =>
              setTopicos((atual) => atual.map((x, j) => (j === i ? e.target.value : x)))
            }
          />
        ))}
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

      {erro && (
        <p className="text-sm" style={{ color: "var(--perigo-ink)" }}>
          {erro}
        </p>
      )}

      <button className="btn btn-estudo btn-bloco" type="submit" disabled={enviando}>
        {enviando ? "Criando…" : "Criar matéria"}
      </button>
    </form>
  );
}
