import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import {
  LIMITES,
  atualizarParametrosDoExercicio,
  carregarPlanoCompleto,
  excluirProgramaAtivo,
  removerExercicioDoPlano,
  substitutosDoExercicio,
  trocarExercicioDoPlano,
  type SessaoDoPlano,
  type Substituto,
} from "../lib/dados";
import type { ExercicioDaSessao } from "./SessaoTreino";

/* =====================================================================
   Editar o plano.
   =====================================================================
   O plano vem da IA e é bom, mas não é sagrado: a academia não tem o
   aparelho, o ombro dói nesse ângulo, o intervalo é longo demais para o
   tempo que a pessoa tem. Sem esta tela a única saída era refazer o
   plano inteiro — e refazer perde o resto, que estava certo.

   Três operações, em ordem de quanto mexem:
   - ajustar séries / reps / descanso  → o exercício continua o mesmo
   - trocar por outro                  → mesmo grupo e padrão de movimento
   - remover                           → tira da sessão

   E, separado do resto por um fio, excluir o plano todo.
   ===================================================================== */

export function EditarPlano() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const navegar = useNavigate();

  const [sessoes, setSessoes] = useState<SessaoDoPlano[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const plano = await carregarPlanoCompleto(userId);
    setSessoes(plano?.sessoes ?? null);
    setCarregando(false);
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (carregando) {
    return (
      <div className="tela">
        <div className="vazio">Carregando…</div>
      </div>
    );
  }

  if (!sessoes) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="chip chip-treino">Sem plano ativo</span>
          <p>Você ainda não tem um treino montado.</p>
          <Link className="btn btn-treino" to="/onboarding">
            Montar treino
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <header className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl font-semibold">Meu plano</h1>
        <Link className="text-sm text-ink-muted underline" to="/treino">
          Voltar
        </Link>
      </header>
      <p className="text-sm text-ink-muted mb-6">
        As mudanças valem do próximo treino em diante. O que já foi registrado
        não muda.
      </p>

      {erro && (
        <p className="text-sm mb-4" style={{ color: "var(--perigo-ink)" }}>
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-6">
        {sessoes.map((s) => (
          <section key={s.id} className="card">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-semibold">
                Treino {s.letra} — {s.nome}
              </h2>
              <span className="text-xs text-ink-muted num">
                {s.exercicios.length} exercícios
              </span>
            </div>

            {s.exercicios.length === 0 ? (
              <p className="text-sm text-ink-fraco">
                Esta sessão ficou sem exercícios. Adicione de volta pelo menos um,
                ou exclua o plano e monte outro.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {s.exercicios.map((ex) => (
                  <LinhaExercicio
                    key={ex.sessaoExercicioId}
                    exercicio={ex}
                    userId={userId}
                    onMudou={carregar}
                    onErro={setErro}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <ZonaDePerigo
        onExcluir={async () => {
          setErro(null);
          try {
            await excluirProgramaAtivo(userId);
            navegar("/onboarding", { replace: true });
          } catch (e) {
            setErro(e instanceof Error ? e.message : "Não deu para excluir o plano.");
          }
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------------- */

type Modo = "fechado" | "ajustar" | "trocar" | "remover";

function LinhaExercicio({
  exercicio,
  userId,
  onMudou,
  onErro,
}: {
  exercicio: ExercicioDaSessao;
  userId: string;
  onMudou: () => Promise<void>;
  onErro: (msg: string) => void;
}) {
  const [modo, setModo] = useState<Modo>("fechado");
  const porTempo = exercicio.duracaoSeg != null;

  return (
    <div className="rounded-md border border-hairline p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{exercicio.nome}</div>
          <div className="text-xs text-ink-muted num">
            {exercicio.series}×
            {porTempo
              ? `${exercicio.duracaoSeg}s`
              : `${exercicio.repsMin}–${exercicio.repsMax}`}{" "}
            · {exercicio.descansoSeg}s de descanso
          </div>
        </div>
        <button
          className="text-xs text-ink-muted underline shrink-0"
          onClick={() => setModo((m) => (m === "fechado" ? "ajustar" : "fechado"))}
        >
          {modo === "fechado" ? "Editar" : "Fechar"}
        </button>
      </div>

      {modo !== "fechado" && (
        <>
          <nav className="flex gap-2 mt-3 mb-3">
            <Aba ativa={modo === "ajustar"} onClick={() => setModo("ajustar")}>
              Ajustar
            </Aba>
            <Aba ativa={modo === "trocar"} onClick={() => setModo("trocar")}>
              Trocar
            </Aba>
            <Aba ativa={modo === "remover"} onClick={() => setModo("remover")}>
              Remover
            </Aba>
          </nav>

          {modo === "ajustar" && (
            <FormAjuste
              exercicio={exercicio}
              onSalvo={async () => {
                setModo("fechado");
                await onMudou();
              }}
              onErro={onErro}
            />
          )}

          {modo === "trocar" && (
            <ListaSubstitutos
              exercicio={exercicio}
              userId={userId}
              onTrocado={async () => {
                setModo("fechado");
                await onMudou();
              }}
              onErro={onErro}
            />
          )}

          {modo === "remover" && (
            <div>
              <p className="text-sm text-ink-muted mb-3">
                Tirar <strong>{exercicio.nome}</strong> desta sessão? O histórico
                de séries que você já fez continua salvo.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-perigo"
                  onClick={async () => {
                    try {
                      await removerExercicioDoPlano(exercicio.sessaoExercicioId);
                      await onMudou();
                    } catch (e) {
                      onErro(e instanceof Error ? e.message : "Não deu para remover.");
                    }
                  }}
                >
                  Remover
                </button>
                <button className="btn btn-neutro" onClick={() => setModo("fechado")}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Aba({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "text-xs px-3 py-1 rounded-sm border",
        ativa
          ? "border-treino text-treino-ink"
          : "border-hairline text-ink-muted",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------- */

function FormAjuste({
  exercicio,
  onSalvo,
  onErro,
}: {
  exercicio: ExercicioDaSessao;
  onSalvo: () => Promise<void>;
  onErro: (msg: string) => void;
}) {
  const porTempo = exercicio.duracaoSeg != null;
  const [series, setSeries] = useState(String(exercicio.series));
  const [repsMin, setRepsMin] = useState(String(exercicio.repsMin ?? ""));
  const [repsMax, setRepsMax] = useState(String(exercicio.repsMax ?? ""));
  const [descanso, setDescanso] = useState(String(exercicio.descansoSeg));
  const [salvando, setSalvando] = useState(false);

  // Valida antes de bater no banco: o CHECK do Postgres é a rede de
  // segurança, não a mensagem de erro que a pessoa deveria ler.
  const nSeries = Number(series);
  const nMin = Number(repsMin);
  const nMax = Number(repsMax);
  const nDescanso = Number(descanso);

  const problema = (() => {
    if (!Number.isInteger(nSeries) || nSeries < LIMITES.series.min || nSeries > LIMITES.series.max)
      return `Séries: de ${LIMITES.series.min} a ${LIMITES.series.max}.`;
    if (
      !Number.isInteger(nDescanso) ||
      nDescanso < LIMITES.descanso.min ||
      nDescanso > LIMITES.descanso.max
    )
      return `Descanso: de ${LIMITES.descanso.min} a ${LIMITES.descanso.max} segundos.`;
    if (porTempo) return null;
    if (!Number.isInteger(nMin) || !Number.isInteger(nMax)) return "Preencha a faixa de reps.";
    if (nMin < LIMITES.reps.min || nMax > LIMITES.reps.max)
      return `Reps: de ${LIMITES.reps.min} a ${LIMITES.reps.max}.`;
    // A progressão dupla só fecha com faixa: atingiu o máximo em todas as
    // séries → sobe a carga. Com min > max não existe faixa nenhuma.
    if (nMax < nMin) return "O máximo de reps precisa ser maior ou igual ao mínimo.";
    return null;
  })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <label className="flex-1">
          <div className="text-xs text-ink-muted mb-1">Séries</div>
          <input
            className="campo campo-num"
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            inputMode="numeric"
            aria-label="Número de séries"
          />
        </label>
        <label className="flex-1">
          <div className="text-xs text-ink-muted mb-1">Descanso (s)</div>
          <input
            className="campo campo-num"
            value={descanso}
            onChange={(e) => setDescanso(e.target.value)}
            inputMode="numeric"
            aria-label="Descanso em segundos"
          />
        </label>
      </div>

      {porTempo ? (
        <p className="text-xs text-ink-fraco">
          Este exercício é por tempo ({exercicio.duracaoSeg}s por série), então
          não tem faixa de repetições.
        </p>
      ) : (
        <div className="flex gap-3">
          <label className="flex-1">
            <div className="text-xs text-ink-muted mb-1">Reps mín.</div>
            <input
              className="campo campo-num"
              value={repsMin}
              onChange={(e) => setRepsMin(e.target.value)}
              inputMode="numeric"
              aria-label="Repetições mínimas"
            />
          </label>
          <label className="flex-1">
            <div className="text-xs text-ink-muted mb-1">Reps máx.</div>
            <input
              className="campo campo-num"
              value={repsMax}
              onChange={(e) => setRepsMax(e.target.value)}
              inputMode="numeric"
              aria-label="Repetições máximas"
            />
          </label>
        </div>
      )}

      {problema && <p className="text-xs" style={{ color: "var(--perigo-ink)" }}>{problema}</p>}

      <button
        className="btn btn-treino"
        disabled={!!problema || salvando}
        onClick={async () => {
          setSalvando(true);
          try {
            await atualizarParametrosDoExercicio(exercicio.sessaoExercicioId, {
              series: nSeries,
              repsMin: porTempo ? null : nMin,
              repsMax: porTempo ? null : nMax,
              descansoSeg: nDescanso,
            });
            await onSalvo();
          } catch (e) {
            onErro(e instanceof Error ? e.message : "Não deu para salvar.");
          } finally {
            setSalvando(false);
          }
        }}
      >
        {salvando ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------- */

function ListaSubstitutos({
  exercicio,
  userId,
  onTrocado,
  onErro,
}: {
  exercicio: ExercicioDaSessao;
  userId: string;
  onTrocado: () => Promise<void>;
  onErro: (msg: string) => void;
}) {
  const [opcoes, setOpcoes] = useState<Substituto[] | null>(null);
  const [trocando, setTrocando] = useState<number | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    let ativo = true;
    substitutosDoExercicio(exercicio.sessaoExercicioId)
      .then((s) => ativo && setOpcoes(s))
      .catch((e) => {
        if (ativo) onErro(e instanceof Error ? e.message : "Não deu para buscar substitutos.");
        if (ativo) setOpcoes([]);
      });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercicio.sessaoExercicioId]);

  if (opcoes === null) return <p className="text-sm text-ink-muted">Buscando opções…</p>;

  if (opcoes.length === 0) {
    return (
      <p className="text-sm text-ink-fraco">
        {/* Acontece de verdade: alguns padrões de movimento têm pouquíssimos
            exercícios no catálogo (§14 do plano). Não é erro. */}
        O catálogo não tem outro exercício com o mesmo grupo e padrão de
        movimento — nem entre os que a IA sugeriu.
      </p>
    );
  }

  // Os 3 da IA primeiro; o resto do catálogo só sob demanda, senão a lista
  // vira um catálogo inteiro dentro de um card.
  const daIa = opcoes.filter((o) => o.origem === "ia");
  const visiveis = verTodos ? opcoes : (daIa.length > 0 ? daIa : opcoes.slice(0, 5));

  return (
    <div className="flex flex-col gap-2">
      {visiveis.map((o) => (
        <button
          key={o.exercicio_id}
          className="flex items-baseline justify-between text-left rounded-md border border-hairline px-3 py-2 disabled:opacity-50"
          disabled={trocando !== null}
          onClick={async () => {
            setTrocando(o.exercicio_id);
            try {
              await trocarExercicioDoPlano(
                userId,
                exercicio.sessaoExercicioId,
                exercicio.exercicioId,
                o.exercicio_id,
              );
              await onTrocado();
            } catch (e) {
              onErro(e instanceof Error ? e.message : "Não deu para trocar.");
            } finally {
              setTrocando(null);
            }
          }}
        >
          <span>{o.nome}</span>
          <span className="text-xs text-ink-muted shrink-0 ml-2">
            {trocando === o.exercicio_id ? "trocando…" : o.equipamento}
          </span>
        </button>
      ))}

      {!verTodos && opcoes.length > visiveis.length && (
        <button className="text-xs text-ink-muted underline" onClick={() => setVerTodos(true)}>
          Ver mais {opcoes.length - visiveis.length} do catálogo
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */

function ZonaDePerigo({ onExcluir }: { onExcluir: () => Promise<void> }) {
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  return (
    <section className="mt-10 pt-6" style={{ borderTop: "1px solid var(--hairline)" }}>
      <h2 className="text-sm font-semibold mb-1">Excluir plano</h2>
      <p className="text-sm text-ink-muted mb-4">
        Apaga as sessões e os exercícios para você montar outro do zero. Seu
        histórico de treinos, o streak e o grupo não são afetados.
      </p>

      {confirmando ? (
        <div className="flex gap-2">
          <button
            className="btn btn-perigo"
            disabled={excluindo}
            onClick={async () => {
              setExcluindo(true);
              try {
                await onExcluir();
              } finally {
                setExcluindo(false);
              }
            }}
          >
            {excluindo ? "Excluindo…" : "Sim, excluir o plano"}
          </button>
          <button className="btn btn-neutro" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button className="btn btn-neutro" onClick={() => setConfirmando(true)}>
          Excluir plano de treino
        </button>
      )}
    </section>
  );
}
