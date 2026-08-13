import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { SessaoTreino, type ExercicioDaSessao } from "./SessaoTreino";
import {
  abandonarTreinoSessao,
  carregarExerciciosDaSessao,
  carregarPerfil,
  carregarProgramaAtivo,
  finalizarTreinoSessao,
  iniciarTreinoSessao,
  sessaoEmAndamento,
  type ProximaSessao,
} from "../lib/dados";

type Estado =
  | { fase: "carregando" }
  | { fase: "sem-plano" }
  | { fase: "ocioso"; proxima: ProximaSessao | null; timezone: string }
  | {
      fase: "ativo";
      treinoSessaoId: string;
      letra: string;
      exercicios: ExercicioDaSessao[];
      timezone: string;
    }
  // Sessão aberta (ex: reload no meio do treino) sem exercício nenhum
  // carregado — sem isto, a tela ficava em branco: SessaoTreino recebe
  // lista vazia e faz `return null` silenciosamente.
  | { fase: "erro"; mensagem: string; treinoSessaoIdParaAbandonar: string | null };

export function Treino() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [erro, setErro] = useState<string | null>(null);
  // Trava o botão enquanto a sessão está sendo aberta — sem isto, um
  // segundo toque (ex: tela sem retorno visual) tenta abrir outra
  // treino_sessoes enquanto a primeira ainda não sincronizou, e o índice
  // único de "uma sessão aberta por vez" rejeita a segunda.
  const [iniciando, setIniciando] = useState(false);

  async function carregar() {
    setEstado({ fase: "carregando" });
    const perfil = await carregarPerfil(userId);
    if (!perfil) {
      setEstado({ fase: "sem-plano" });
      return;
    }

    const emAndamento = await sessaoEmAndamento(userId);
    if (emAndamento?.sessao_id) {
      const exercicios = await carregarExerciciosDaSessao(emAndamento.sessao_id);
      if (exercicios.length === 0) {
        setEstado({
          fase: "erro",
          mensagem:
            "Não consegui carregar os exercícios da sua sessão em andamento. " +
            "Você pode abandonar este treino e começar de novo.",
          treinoSessaoIdParaAbandonar: emAndamento.id,
        });
        return;
      }
      setEstado({
        fase: "ativo",
        treinoSessaoId: emAndamento.id,
        letra: emAndamento.sessao_letra ?? "",
        exercicios,
        timezone: perfil.timezone,
      });
      return;
    }

    const dados = await carregarProgramaAtivo(userId);
    if (!dados) {
      setEstado({ fase: "sem-plano" });
      return;
    }
    setEstado({ fase: "ocioso", proxima: dados.proxima, timezone: perfil.timezone });
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function iniciar(proxima: ProximaSessao, timezone: string) {
    if (iniciando) return;
    setErro(null);
    setIniciando(true);
    try {
      const treinoSessaoId = await iniciarTreinoSessao(userId, timezone, proxima);
      const exercicios = await carregarExerciciosDaSessao(proxima.id);
      if (exercicios.length === 0) {
        setErro("Essa sessão não tem exercícios cadastrados.");
        return;
      }
      setEstado({ fase: "ativo", treinoSessaoId, letra: proxima.letra, exercicios, timezone });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para iniciar o treino.");
    } finally {
      setIniciando(false);
    }
  }

  if (estado.fase === "carregando") {
    return (
      <div className="tela">
        <div className="vazio">Carregando…</div>
      </div>
    );
  }

  if (estado.fase === "sem-plano") {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-treino">Sem treino montado</span>
          <p>Monte seu plano — leva menos de um minuto para configurar.</p>
          <Link className="btn btn-treino" to="/onboarding">
            Montar treino
          </Link>
        </div>
      </div>
    );
  }

  if (estado.fase === "ativo") {
    return (
      <SessaoTreino
        treinoSessaoId={estado.treinoSessaoId}
        letra={estado.letra}
        exercicios={estado.exercicios}
        aoFinalizar={() => {
          void finalizarTreinoSessao(estado.treinoSessaoId).finally(() => void carregar());
        }}
        aoAbandonar={(exercicioAtualId) => {
          void abandonarTreinoSessao(estado.treinoSessaoId, exercicioAtualId).finally(
            () => void carregar(),
          );
        }}
      />
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="badge badge-atencao">Algo deu errado</span>
          <p>{estado.mensagem}</p>
          {estado.treinoSessaoIdParaAbandonar && (
            <button
              className="btn btn-perigo"
              onClick={() => {
                void abandonarTreinoSessao(estado.treinoSessaoIdParaAbandonar!, null).finally(
                  () => void carregar(),
                );
              }}
            >
              Abandonar treino
            </button>
          )}
        </div>
      </div>
    );
  }

  // fase === "ocioso"
  const { proxima, timezone } = estado;
  return (
    <div className="tela">
      <header className="flex items-baseline justify-between mb-4">
        <h1 className="h1">Treino</h1>
        {/* Único caminho até a edição do plano. Sem ele, depois do
            onboarding o plano ficava congelado para sempre: a tela de
            montar treino só aparecia para quem NÃO tinha plano. */}
        <Link className="text-sm text-ink-muted underline" to="/treino/plano">
          Meu plano
        </Link>
      </header>

      {proxima ? (
        <div className="card card-treino">
          <span className="rotulo-secao text-treino-ink mb-1">Próxima sessão</span>
          <div className="h2 mb-4">
            Treino {proxima.letra} — {proxima.nome}
          </div>
          <button
            className="btn btn-treino btn-bloco"
            onClick={() => void iniciar(proxima, timezone)}
            disabled={iniciando}
          >
            {iniciando ? "Iniciando…" : "Iniciar treino"}
          </button>
        </div>
      ) : (
        <div className="vazio">
          <p>Seu plano não tem sessões configuradas.</p>
          <Link className="btn btn-neutro" to="/treino/plano">
            Ver o plano
          </Link>
        </div>
      )}

      {erro && (
        <p className="text-sm mt-3" style={{ color: "var(--perigo-ink)" }}>
          {erro}
        </p>
      )}
    </div>
  );
}
