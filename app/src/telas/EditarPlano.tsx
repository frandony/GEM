import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Dumbbell, Pencil, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { useValidacao } from "../lib/formulario";
import { AvisoDeFormulario, MensagemErro } from "../componentes/MensagemErro";
import { Voltar } from "../componentes/Voltar";
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

/**
 * Grupos musculares únicos (ordem de aparição) e uma estimativa de
 * duração — nem `sessoes` nem `sessao_exercicios` guardam duração, então
 * é uma conta aproximada: cada série custa ~40s de execução + o descanso
 * dela. Não é cronômetro, é só pra dar noção do tamanho do treino.
 */
function resumoDaSessao(exercicios: ExercicioDaSessao[]): {
  grupos: string;
  minutosEstimados: number;
  descansoMedio: number;
} {
  const gruposUnicos = [...new Set(exercicios.map((e) => e.grupoPrimario).filter(Boolean))];
  const listaGrupos = gruposUnicos.join(", ");
  const grupos = listaGrupos ? listaGrupos.charAt(0).toUpperCase() + listaGrupos.slice(1) : "";

  const segundosTotais = exercicios.reduce((s, e) => s + e.series * (40 + e.descansoSeg), 0);
  const descansoMedio = exercicios.length
    ? Math.round(exercicios.reduce((s, e) => s + e.descansoSeg, 0) / exercicios.length)
    : 0;

  return {
    grupos,
    minutosEstimados: Math.round(segundosTotais / 60 / 5) * 5,
    descansoMedio,
  };
}

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
  const toast = useToast();
  // Estado próprio, e não toast, porque muda a TELA e não só a mensagem:
  // falha ao carregar não pode cair no estado "sem plano", que oferece
  // montar outro e faria a pessoa refazer um plano que existe.
  const [falhouAoCarregar, setFalhouAoCarregar] = useState<string | null>(null);

  async function carregar() {
    try {
      const plano = await carregarPlanoCompleto(userId);
      setSessoes(plano?.sessoes ?? null);
      setFalhouAoCarregar(null);
    } catch (e) {
      setFalhouAoCarregar(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setCarregando(false);
    }
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

  if (falhouAoCarregar) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-atencao">Não deu para abrir seu plano</span>
          <p>
            Seu plano continua salvo — o que falhou foi a leitura. Não monte
            outro por causa disto.
          </p>
          <p className="text-xs text-ink-fraco num">{falhouAoCarregar}</p>
          <button className="btn btn-treino" onClick={() => void carregar()}>
            Tentar de novo
          </button>
          <Voltar to="/treino" rotulo="Treino" />
        </div>
      </div>
    );
  }

  if (!sessoes) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-treino">Sem plano ativo</span>
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
      <header className="mb-4">
        <Voltar to="/treino" rotulo="Treino" className="mb-1" />
        <h1 className="h1">Meu plano</h1>
      </header>
      <p className="text-sm text-ink-muted mb-6">
        As mudanças valem do próximo treino em diante. O que já foi registrado
        não muda.
      </p>

      <div className="flex flex-col gap-6">
        {sessoes.map((s) => {
          const resumo = resumoDaSessao(s.exercicios);
          return (
          <section key={s.id} className="card">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="h2">
                Treino {s.letra} — {s.nome}
              </h2>
              <span className="badge badge-treino num">
                {s.exercicios.length} {s.exercicios.length === 1 ? "exercício" : "exercícios"}
              </span>
            </div>
            {resumo.grupos && (
              <p className="text-sm text-ink-muted mb-1">{resumo.grupos}</p>
            )}
            {s.exercicios.length > 0 && (
              <p className="text-xs text-ink-terciario num mb-4">
                ~{resumo.minutosEstimados} min · {resumo.descansoMedio}s descanso médio
              </p>
            )}

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
                  />
                ))}
              </div>
            )}
          </section>
          );
        })}
      </div>

      <ZonaDePerigo
        onExcluir={async () => {
          try {
            await excluirProgramaAtivo(userId);
            // Toast global: o `navigate` abaixo desmonta esta tela, então
            // qualquer estado local de mensagem morreria antes de pintar.
            toast.sucesso("Plano excluído. Vamos montar outro.");
            navegar("/onboarding", { replace: true });
          } catch (e) {
            toast.erro(e instanceof Error ? e.message : "Não deu para excluir o plano.");
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
}: {
  exercicio: ExercicioDaSessao;
  userId: string;
  onMudou: () => Promise<void>;
}) {
  const [modo, setModo] = useState<Modo>("fechado");
  const porTempo = exercicio.duracaoSeg != null;
  // Toast em vez do antigo `onErro` que subia até um banner no topo da
  // tela: estas linhas ficam no fim de uma página longa, e o banner
  // nascia fora da viewport de quem tinha acabado de tocar aqui.
  const toast = useToast();

  const aberto = modo !== "fechado";

  return (
    <div className="rounded-md border border-hairline p-3">
      <div className="exercise-row">
        <span className="exercise-row__icone">
          <Dumbbell size={18} />
        </span>
        <div className="exercise-row__texto">
          <div className="h3">{exercicio.nome}</div>
          <div className="text-xs text-ink-muted num">
            {exercicio.series}×
            {porTempo
              ? `${exercicio.duracaoSeg}s`
              : `${exercicio.repsMin}–${exercicio.repsMax}`}{" "}
            · {exercicio.descansoSeg}s de descanso
          </div>
        </div>
        <button
          className="exercise-row__acao"
          style={aberto ? { opacity: 1 } : undefined}
          onClick={() => setModo((m) => (m === "fechado" ? "ajustar" : "fechado"))}
          aria-label={aberto ? "Fechar edição" : "Editar exercício"}
        >
          {aberto ? <X size={18} /> : <Pencil size={18} />}
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
                toast.sucesso("Ajuste salvo.");
                await onMudou();
              }}
            />
          )}

          {modo === "trocar" && (
            <ListaSubstitutos
              exercicio={exercicio}
              userId={userId}
              onTrocado={async (nomeNovo) => {
                setModo("fechado");
                toast.sucesso(`Trocado por ${nomeNovo}.`);
                await onMudou();
              }}
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
                      toast.sucesso(`${exercicio.nome} saiu do plano.`);
                      await onMudou();
                    } catch (e) {
                      toast.erro(e instanceof Error ? e.message : "Não deu para remover.");
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
}: {
  exercicio: ExercicioDaSessao;
  onSalvo: () => Promise<void>;
}) {
  const porTempo = exercicio.duracaoSeg != null;
  const [series, setSeries] = useState(String(exercicio.series));
  const [repsMin, setRepsMin] = useState(String(exercicio.repsMin ?? ""));
  const [repsMax, setRepsMax] = useState(String(exercicio.repsMax ?? ""));
  const [descanso, setDescanso] = useState(String(exercicio.descansoSeg));
  const [salvando, setSalvando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { campo, erros, idDoErro, limpar, validar } =
    useValidacao<"series" | "descanso" | "repsMin" | "repsMax">();

  // Valida antes de bater no banco: o CHECK do Postgres é a rede de
  // segurança, não a mensagem de erro que a pessoa deveria ler.
  const nSeries = Number(series);
  const nMin = Number(repsMin);
  const nMax = Number(repsMax);
  const nDescanso = Number(descanso);

  async function salvar() {
    setErroServidor(null);
    // Cada regra aponta para o SEU campo. Antes havia uma mensagem só,
    // que dizia "Séries: de 1 a 10" enquanto os quatro inputs ficavam
    // visualmente idênticos — e o botão ficava desabilitado, o que
    // impedia até de tentar.
    const ok = validar([
      {
        campo: "series",
        valido:
          Number.isInteger(nSeries) &&
          nSeries >= LIMITES.series.min &&
          nSeries <= LIMITES.series.max,
        mensagem: `Séries: de ${LIMITES.series.min} a ${LIMITES.series.max}.`,
      },
      {
        campo: "descanso",
        valido:
          Number.isInteger(nDescanso) &&
          nDescanso >= LIMITES.descanso.min &&
          nDescanso <= LIMITES.descanso.max,
        mensagem: `Descanso: de ${LIMITES.descanso.min} a ${LIMITES.descanso.max} segundos.`,
      },
      ...(porTempo
        ? []
        : [
            {
              campo: "repsMin" as const,
              valido:
                Number.isInteger(nMin) && nMin >= LIMITES.reps.min && nMin <= LIMITES.reps.max,
              mensagem: `Reps mínimas: de ${LIMITES.reps.min} a ${LIMITES.reps.max}.`,
            },
            {
              campo: "repsMax" as const,
              // A progressão dupla só fecha com faixa: atingiu o máximo em
              // todas as séries → sobe a carga. Com min > max não há faixa.
              valido:
                Number.isInteger(nMax) &&
                nMax >= LIMITES.reps.min &&
                nMax <= LIMITES.reps.max &&
                nMax >= nMin,
              mensagem:
                Number.isInteger(nMax) && nMax < nMin
                  ? "O máximo precisa ser maior ou igual ao mínimo."
                  : `Reps máximas: de ${LIMITES.reps.min} a ${LIMITES.reps.max}.`,
            },
          ]),
    ]);
    if (!ok) return;

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
      setErroServidor(e instanceof Error ? e.message : "Não deu para salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label>
            <div className="text-xs text-ink-muted mb-1">Séries</div>
            <input
              className="campo campo-num"
              value={series}
              onChange={(e) => {
                setSeries(e.target.value);
                limpar("series");
              }}
              inputMode="numeric"
              aria-label="Número de séries"
              {...campo("series")}
            />
          </label>
          {erros.series && <MensagemErro id={idDoErro("series")}>{erros.series}</MensagemErro>}
        </div>
        <div className="flex-1">
          <label>
            <div className="text-xs text-ink-muted mb-1">Descanso (s)</div>
            <input
              className="campo campo-num"
              value={descanso}
              onChange={(e) => {
                setDescanso(e.target.value);
                limpar("descanso");
              }}
              inputMode="numeric"
              aria-label="Descanso em segundos"
              {...campo("descanso")}
            />
          </label>
          {erros.descanso && (
            <MensagemErro id={idDoErro("descanso")}>{erros.descanso}</MensagemErro>
          )}
        </div>
      </div>

      {porTempo ? (
        <p className="text-xs text-ink-fraco">
          Este exercício é por tempo ({exercicio.duracaoSeg}s por série), então
          não tem faixa de repetições.
        </p>
      ) : (
        <div className="flex gap-3">
          <div className="flex-1">
            <label>
              <div className="text-xs text-ink-muted mb-1">Reps mín.</div>
              <input
                className="campo campo-num"
                value={repsMin}
                onChange={(e) => {
                  setRepsMin(e.target.value);
                  limpar("repsMin");
                }}
                inputMode="numeric"
                aria-label="Repetições mínimas"
                {...campo("repsMin")}
              />
            </label>
            {erros.repsMin && (
              <MensagemErro id={idDoErro("repsMin")}>{erros.repsMin}</MensagemErro>
            )}
          </div>
          <div className="flex-1">
            <label>
              <div className="text-xs text-ink-muted mb-1">Reps máx.</div>
              <input
                className="campo campo-num"
                value={repsMax}
                onChange={(e) => {
                  setRepsMax(e.target.value);
                  limpar("repsMax");
                }}
                inputMode="numeric"
                aria-label="Repetições máximas"
                {...campo("repsMax")}
              />
            </label>
            {erros.repsMax && (
              <MensagemErro id={idDoErro("repsMax")}>{erros.repsMax}</MensagemErro>
            )}
          </div>
        </div>
      )}

      {erroServidor && <AvisoDeFormulario>{erroServidor}</AvisoDeFormulario>}

      {/* Sem `disabled` por valor inválido — ver a regra em index.css. */}
      <button className="btn btn-treino" disabled={salvando} onClick={() => void salvar()}>
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
}: {
  exercicio: ExercicioDaSessao;
  userId: string;
  onTrocado: (nomeNovo: string) => Promise<void>;
}) {
  const [opcoes, setOpcoes] = useState<Substituto[] | null>(null);
  const [trocando, setTrocando] = useState<number | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let ativo = true;
    substitutosDoExercicio(exercicio.sessaoExercicioId)
      .then((s) => ativo && setOpcoes(s))
      .catch((e) => {
        if (ativo) toast.erro(e instanceof Error ? e.message : "Não deu para buscar substitutos.");
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
              await onTrocado(o.nome);
            } catch (e) {
              toast.erro(e instanceof Error ? e.message : "Não deu para trocar.");
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
      <h2 className="text-sm font-medium mb-1">Excluir plano</h2>
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
