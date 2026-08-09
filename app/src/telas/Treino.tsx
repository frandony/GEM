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
    };

export function Treino() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [erro, setErro] = useState<string | null>(null);

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
    setErro(null);
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
          <span className="chip chip-treino">Sem treino montado</span>
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

  // fase === "ocioso"
  const { proxima, timezone } = estado;
  return (
    <div className="tela">
      <h1 className="text-xl font-semibold mb-4">Treino</h1>

      {proxima ? (
        <div className="card card-treino">
          <div className="text-xs uppercase tracking-wide text-treino-ink mb-1">
            Próxima sessão
          </div>
          <div className="text-lg font-semibold mb-4">
            Treino {proxima.letra} — {proxima.nome}
          </div>
          <button
            className="btn btn-treino btn-bloco"
            onClick={() => void iniciar(proxima, timezone)}
          >
            Iniciar treino
          </button>
        </div>
      ) : (
        <div className="vazio">
          <p>Seu plano não tem sessões configuradas.</p>
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
