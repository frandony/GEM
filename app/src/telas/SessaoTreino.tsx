import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, Timer } from "lucide-react";
import { enfileirar, novoId } from "../lib/fila";
import { notificarFimDoTimer } from "../lib/notificacaoTimer";
import { explicarSugestao, sugestaoDeCarga, type Sugestao } from "../lib/progressao";
import { IndicadorPendencia } from "../componentes/IndicadorPendencia";
import { useToast } from "../lib/toast";

/* =====================================================================
   Registrar série — a tela que decide o app.
   =====================================================================
   Três decisões que vêm do plano, não de gosto:

   1. **A escrita nunca espera a rede.** `enfileirar` grava local e volta
      na hora. A série aparece marcada antes de qualquer resposta do
      servidor. Se a rede estiver fora, o indicador avisa — mas o treino
      não para.

   2. **O app sugere, a pessoa digita.** A carga vem preenchida pela
      progressão dupla, e o campo continua editável. Nunca travar: o
      número certo é o que a pessoa levantou, não o que o banco calculou.

   3. **Uma decisão por vez.** A tela mostra UM exercício, com a série
      atual em destaque. Lista inteira com tudo editável é o que faz
      errar de linha entre uma série e outra, com o braço cansado.
   ===================================================================== */

export interface ExercicioDaSessao {
  sessaoExercicioId: string;
  exercicioId: number;
  nome: string;
  ordem: number;
  series: number;
  repsMin: number | null;
  repsMax: number | null;
  duracaoSeg: number | null;
  descansoSeg: number;
  unilateral: boolean;
  /** Só pra exibição (ex: "Peito, ombros, tríceps" no card do plano) —
      nunca usado pra decidir nada na execução do treino. */
  grupoPrimario: string;
}

interface Props {
  treinoSessaoId: string;
  letra: string;
  exercicios: ExercicioDaSessao[];
  aoFinalizar: () => void;
  /** Opcional: sem isto, quem fecha o app no meio do treino fica sem
      como abrir outro depois — só existe uma sessão "em_andamento" por vez. */
  aoAbandonar?: (exercicioAtualId: number | null) => void;
}

interface SerieFeita {
  numero: number;
  reps: number | null;
  cargaKg: number | null;
  duracaoSeg: number | null;
}

export function SessaoTreino({
  treinoSessaoId,
  letra,
  exercicios,
  aoFinalizar,
  aoAbandonar,
}: Props) {
  const [indice, setIndice] = useState(0);
  const [feitas, setFeitas] = useState<Record<string, SerieFeita[]>>({});
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  // Numérico, não string: o stepper ajusta a partir do valor sugerido —
  // ninguém digita mais, então não precisa lidar com vírgula/ponto do
  // teclado. 0 continua significando "em branco" pro registro (vira null).
  const [carga, setCarga] = useState(0);
  const [reps, setReps] = useState(0);
  const [descansando, setDescansando] = useState<number | null>(null);
  const toast = useToast();
  // Abandonar descarta a sessão inteira e é irreversível. Um toque só,
  // num link pequeno ao lado do contador, é fácil demais de acertar sem
  // querer com o polegar.
  const [confirmandoAbandono, setConfirmandoAbandono] = useState(false);

  const atual = exercicios[indice];
  const jaFeitas = atual ? (feitas[atual.sessaoExercicioId] ?? []) : [];
  const proximaSerie = jaFeitas.length + 1;
  const porTempo = atual?.duracaoSeg != null;

  /* Sugestão de carga ao trocar de exercício. */
  useEffect(() => {
    if (!atual) return;
    let ativo = true;

    setSugestao(null);
    setReps(porTempo ? 0 : (atual.repsMax ?? 0));

    void sugestaoDeCarga(atual.exercicioId, atual.repsMax).then((s) => {
      if (!ativo) return;
      setSugestao(s);
      // Preenche, mas não trava: o stepper parte daqui, sem forçar nada.
      setCarga(s?.carga_kg ?? 0);
    });

    return () => { ativo = false; };
  }, [atual?.sessaoExercicioId]);

  /* Timer de descanso. Conta pelo relógio, não por setInterval acumulado —
     se a tela dormir, o setInterval atrasa e o número mente. */
  useEffect(() => {
    if (descansando == null) return;
    const fim = descansando;
    const tique = setInterval(() => {
      if (Date.now() >= fim) {
        setDescansando(null);
        notificarFimDoTimer();
      } else {
        setDescansando((d) => d); // força re-render
      }
    }, 250);
    return () => clearInterval(tique);
  }, [descansando]);

  if (!atual) return null;

  const segundosRestantes =
    descansando != null ? Math.max(0, Math.ceil((descansando - Date.now()) / 1000)) : 0;

  async function registrar() {
    // O guard acima já garante `atual`, mas ele não alcança dentro do
    // callback — o TypeScript não sabe que o componente não re-renderizou
    // entre o `return null` e o toque no botão.
    if (!atual) return;
    const ex = atual;

    const serie: SerieFeita = {
      numero: proximaSerie,
      reps: porTempo ? null : reps || null,
      cargaKg: porTempo ? null : carga || null,
      duracaoSeg: porTempo ? ex.duracaoSeg : null,
    };

    // 1. UI primeiro. A série aparece marcada imediatamente.
    setFeitas((f) => ({
      ...f,
      [ex.sessaoExercicioId]: [...(f[ex.sessaoExercicioId] ?? []), serie],
    }));
    toast.sucesso("Série concluída!");

    // 2. Fila depois. Não esperamos: o id é do cliente, então reenviar
    //    não duplica, e a rede pode demorar o quanto quiser.
    void enfileirar("series_registros", {
      id: novoId(),
      treino_sessao_id: treinoSessaoId,
      exercicio_id: ex.exercicioId,
      planejado_id: ex.exercicioId,
      numero_serie: serie.numero,
      reps: serie.reps,
      carga_kg: serie.cargaKg,
      duracao_seg: serie.duracaoSeg,
      completou: true,
    });

    // 3. Descanso começa sozinho — ninguém toca em "iniciar descanso"
    //    com a mão no halter.
    if (serie.numero < ex.series) {
      setDescansando(Date.now() + ex.descansoSeg * 1000);
    }
  }

  const terminouExercicio = jaFeitas.length >= atual.series;
  const ultimoExercicio = indice >= exercicios.length - 1;

  // Progresso do treino inteiro (todos os exercícios, não só o atual) —
  // a barra fina do topo é a mesma métrica do card na Home.
  const totalSeriesSessao = exercicios.reduce((s, e) => s + e.series, 0);
  const feitasSessao = Object.values(feitas).reduce((s, fs) => s + fs.length, 0);
  const progressoSessao = totalSeriesSessao > 0 ? feitasSessao / totalSeriesSessao : 0;

  return (
    <div className="tela">
      <div
        className="progress-bar"
        style={{
          position: "fixed", top: 0, insetInline: 0, height: 3,
          borderRadius: 0, zIndex: 60,
          "--progresso": progressoSessao,
        } as CSSProperties}
      >
        <span />
      </div>

      {/* ---- Cabeçalho: onde estou ---------------------------------- */}
      <header className="mb-1">
        <div className="flex items-center justify-between mb-1">
          <span className="flex items-center text-sm text-ink-muted">
            <ChevronLeft size={16} /> Treino {letra}
          </span>
          <div className="flex items-center gap-3">
            <div className="text-sm text-ink-muted num">
              {indice + 1}/{exercicios.length}
            </div>
            {aoAbandonar && (
              <button
                className="text-xs text-ink-muted underline"
                onClick={() => setConfirmandoAbandono(true)}
              >
                Abandonar
              </button>
            )}
          </div>
        </div>
        <h1 className="h1">{atual.nome}</h1>
        <p className="text-sm text-ink-muted num">
          Série {proximaSerie > atual.series ? atual.series : proximaSerie} de {atual.series}
          {!porTempo && carga > 0 && ` · ${carga} kg`}
          {!porTempo && ` · ${reps} reps`}
        </p>
      </header>

      <IndicadorPendencia />

      {confirmandoAbandono && aoAbandonar && (
        <div className="card mt-4" role="alertdialog" aria-label="Confirmar abandono">
          <p className="mb-1">Abandonar este treino?</p>
          <p className="text-sm text-ink-muted mb-4">
            {/* Diz o que sobrevive: as séries já registradas foram para a fila
                e não somem. O que se perde é a sessão em si. */}
            As séries que você já registrou ficam salvas. A sessão é encerrada
            como abandonada e o treino {letra} continua sendo o próximo.
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-perigo"
              onClick={() => aoAbandonar(atual.exercicioId)}
            >
              Sim, abandonar
            </button>
            <button className="btn btn-neutro" onClick={() => setConfirmandoAbandono(false)}>
              Continuar treinando
            </button>
          </div>
        </div>
      )}

      {!descansando && !terminouExercicio && (
        <div className="text-center my-5">
          <div className="display text-6xl num">{proximaSerie}<span className="text-ink-terciario">/{atual.series}</span></div>
          <span className="rotulo-secao text-ink-muted">série atual</span>
        </div>
      )}

      {/* ---- Séries: o que já foi ----------------------------------- */}
      <div className="flex gap-2 my-5" role="list" aria-label="Séries">
        {Array.from({ length: atual.series }, (_, i) => {
          const feita = jaFeitas[i];
          const agora = i === jaFeitas.length;
          return (
            <div
              key={i}
              role="listitem"
              className={[
                "flex-1 rounded-md py-2 text-center num text-sm border",
                feita
                  ? "bg-ok-fraco text-ok-ink border-transparent"
                  : agora
                    ? "border-treino text-treino-ink"
                    : "border-hairline text-ink-fraco",
              ].join(" ")}
            >
              {feita
                ? porTempo
                  ? `${feita.duracaoSeg}s`
                  : `${feita.reps ?? "—"}×${feita.cargaKg ?? "—"}`
                : i + 1}
            </div>
          );
        })}
      </div>

      {/* ---- Descanso ----------------------------------------------
          Ocupa o lugar dos campos em vez de aparecer sobre eles: no meio
          do descanso não há nada a digitar, e um modal exigiria fechar. */}
      {descansando != null ? (
        <div className="card flex flex-col items-center gap-3 py-8">
          <span className="rotulo-secao text-ink-muted flex items-center gap-1">
            <Timer size={14} /> Descanso
          </span>
          <div className="display text-6xl num text-treino-ink">
            {String(Math.floor(segundosRestantes / 60)).padStart(2, "0")}:
            {String(segundosRestantes % 60).padStart(2, "0")}
          </div>
          <button className="btn btn-neutro" onClick={() => setDescansando(null)}>
            Pular descanso
          </button>
        </div>
      ) : terminouExercicio ? (
        <div className="card flex flex-col gap-3 items-center py-6">
          <span className="badge badge-ok">Exercício concluído</span>
          <button
            className="btn btn-treino btn-bloco"
            onClick={() => (ultimoExercicio ? aoFinalizar() : setIndice((i) => i + 1))}
          >
            {ultimoExercicio ? "Finalizar treino" : "Próximo exercício"}
          </button>
        </div>
      ) : (
        <>
          {/* ---- Entrada: reps e carga, por stepper ------------------
              Parte sempre do valor sugerido (progressão ou última carga),
              então o toque típico é só um ajuste fino — não construir o
              número do zero. */}
          {porTempo ? (
            <p className="text-center text-sm text-ink-muted mb-3">
              Por tempo: {atual.duracaoSeg}s nesta série.
            </p>
          ) : (
            <>
              <div className="mb-4">
                <div className="text-sm text-ink-muted mb-2">
                  Repetições <span className="text-ink-terciario">({atual.repsMin}–{atual.repsMax})</span>
                </div>
                <div className="stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setReps((r) => Math.max(0, r - 1))}
                    disabled={reps <= 0}
                    aria-label="Diminuir repetições"
                  >
                    −
                  </button>
                  <div className="stepper-valor num">{reps}</div>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setReps((r) => Math.min(50, r + 1))}
                    aria-label="Aumentar repetições"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="mb-2">
                <div className="text-sm text-ink-muted mb-2">
                  Peso{atual.unilateral && <span className="text-ink-terciario"> · por lado</span>}
                </div>
                <div className="stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setCarga((c) => Math.max(0, Math.round((c - 2.5) * 10) / 10))}
                    disabled={carga <= 0}
                    aria-label="Diminuir peso"
                  >
                    −
                  </button>
                  <div className="stepper-valor num">
                    {carga}<span className="unidade">kg</span>
                  </div>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() => setCarga((c) => Math.min(500, Math.round((c + 2.5) * 10) / 10))}
                    aria-label="Aumentar peso"
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Explica de onde veio o número. Sem isso a sugestão parece
              mágica — e a pessoa não sabe se pode confiar. */}
          {explicarSugestao(sugestao) && (
            <p className="text-xs text-ink-muted mt-2">{explicarSugestao(sugestao)}</p>
          )}

          <button className="btn btn-treino btn-bloco mt-5" onClick={registrar}>
            Concluir série {proximaSerie}
          </button>
        </>
      )}

      {/* ---- Navegação entre exercícios ------------------------------ */}
      <nav className="flex justify-between mt-6" aria-label="Exercícios">
        <button
          className="btn btn-neutro"
          disabled={indice === 0}
          onClick={() => setIndice((i) => i - 1)}
        >
          Anterior
        </button>
        <button
          className="btn btn-neutro"
          disabled={ultimoExercicio}
          onClick={() => setIndice((i) => i + 1)}
        >
          Pular
        </button>
      </nav>
    </div>
  );
}
