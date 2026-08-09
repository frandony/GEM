import { useEffect, useState } from "react";
import { enfileirar, novoId } from "../lib/fila";
import { explicarSugestao, sugestaoDeCarga, type Sugestao } from "../lib/progressao";
import { IndicadorPendencia } from "../componentes/IndicadorPendencia";

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
  const [carga, setCarga] = useState("");
  const [reps, setReps] = useState("");
  const [descansando, setDescansando] = useState<number | null>(null);

  const atual = exercicios[indice];
  const jaFeitas = atual ? (feitas[atual.sessaoExercicioId] ?? []) : [];
  const proximaSerie = jaFeitas.length + 1;
  const porTempo = atual?.duracaoSeg != null;

  /* Sugestão de carga ao trocar de exercício. */
  useEffect(() => {
    if (!atual) return;
    let ativo = true;

    setSugestao(null);
    setReps(porTempo ? "" : String(atual.repsMax ?? ""));

    void sugestaoDeCarga(atual.exercicioId, atual.repsMax).then((s) => {
      if (!ativo) return;
      setSugestao(s);
      // Preenche, mas não trava: o campo segue editável.
      setCarga(s?.carga_kg != null ? String(s.carga_kg).replace(".", ",") : "");
    });

    return () => { ativo = false; };
  }, [atual?.sessaoExercicioId]);

  /* Timer de descanso. Conta pelo relógio, não por setInterval acumulado —
     se a tela dormir, o setInterval atrasa e o número mente. */
  useEffect(() => {
    if (descansando == null) return;
    const fim = descansando;
    const tique = setInterval(() => {
      if (Date.now() >= fim) setDescansando(null);
      else setDescansando((d) => d); // força re-render
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
      reps: porTempo ? null : Number(reps.replace(",", ".")) || null,
      cargaKg: porTempo ? null : Number(carga.replace(",", ".")) || null,
      duracaoSeg: porTempo ? ex.duracaoSeg : null,
    };

    // 1. UI primeiro. A série aparece marcada imediatamente.
    setFeitas((f) => ({
      ...f,
      [ex.sessaoExercicioId]: [...(f[ex.sessaoExercicioId] ?? []), serie],
    }));

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

  return (
    <div className="tela">
      {/* ---- Cabeçalho: onde estou ---------------------------------- */}
      <header className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-muted">
            Treino {letra}
          </div>
          <h1 className="text-xl font-semibold">{atual.nome}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-ink-muted num">
            {indice + 1}/{exercicios.length}
          </div>
          {aoAbandonar && (
            <button
              className="text-xs text-ink-muted underline"
              onClick={() => aoAbandonar(atual.exercicioId)}
            >
              Abandonar
            </button>
          )}
        </div>
      </header>

      <IndicadorPendencia />

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
          <div className="text-xs uppercase tracking-wide text-ink-muted">Descanso</div>
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
          <span className="chip chip-ok">Exercício concluído</span>
          <button
            className="btn btn-treino btn-bloco"
            onClick={() => (ultimoExercicio ? aoFinalizar() : setIndice((i) => i + 1))}
          >
            {ultimoExercicio ? "Finalizar treino" : "Próximo exercício"}
          </button>
        </div>
      ) : (
        <>
          {/* ---- Entrada: carga e reps ------------------------------ */}
          <div className="flex gap-3">
            {!porTempo && (
              <label className="flex-1">
                <div className="text-sm text-ink-muted mb-1">
                  Carga (kg){atual.unilateral && <span className="text-ink-fraco"> · por lado</span>}
                </div>
                <input
                  className="campo campo-num"
                  value={carga}
                  onChange={(e) => setCarga(e.target.value)}
                  inputMode="decimal"
                  enterKeyHint="done"
                  aria-label="Carga em quilos"
                />
              </label>
            )}
            <label className="flex-1">
              <div className="text-sm text-ink-muted mb-1">
                {porTempo ? "Segundos" : `Reps (${atual.repsMin}–${atual.repsMax})`}
              </div>
              <input
                className="campo campo-num"
                value={porTempo ? String(atual.duracaoSeg) : reps}
                onChange={(e) => setReps(e.target.value)}
                inputMode="numeric"
                enterKeyHint="done"
                readOnly={porTempo}
                aria-label={porTempo ? "Duração em segundos" : "Repetições"}
              />
            </label>
          </div>

          {/* Explica de onde veio o número. Sem isso a sugestão parece
              mágica — e a pessoa não sabe se pode confiar. */}
          {explicarSugestao(sugestao) && (
            <p className="text-xs text-ink-muted mt-2">{explicarSugestao(sugestao)}</p>
          )}

          <button className="btn btn-treino btn-bloco mt-5" onClick={registrar}>
            Registrar série {proximaSerie}
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
