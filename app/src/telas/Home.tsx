import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarExerciciosDaSessao,
  carregarPerfil,
  carregarProgramaAtivo,
  hojeNoFuso,
  type Perfil,
  type ProximaSessao,
} from "../lib/dados";

/** "Francisco Vasconcelos" → "FV". Só letras — número ou emoji no nome
    (existe gente assim) não vira parte da inicial. */
function iniciais(nome: string): string {
  const letras = nome
    .split(/\s+/)
    .map((p) => p.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  return ((letras[0] ?? "") + (letras[letras.length - 1] ?? "")).toUpperCase() || "?";
}

export function Home() {
  const { sessao, sair } = useAuth();
  const userId = sessao!.user.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [proxima, setProxima] = useState<ProximaSessao | null>(null);
  const [totalExercicios, setTotalExercicios] = useState<number | null>(null);
  const [treinouHoje, setTreinouHoje] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const p = await carregarPerfil(userId);
      if (!ativo || !p) return;
      setPerfil(p);

      const hoje = hojeNoFuso(p.timezone);
      const [programa, resumo, s] = await Promise.all([
        carregarProgramaAtivo(userId),
        supabase.from("resumos_diarios").select("treinou").eq("user_id", userId).eq("data", hoje).maybeSingle(),
        supabase.rpc("streak_de", { p_user_id: null }),
      ]);
      if (!ativo) return;
      setProxima(programa?.proxima ?? null);
      setTreinouHoje(resumo.data?.treinou ?? false);
      setStreak((s.data as number) ?? 0);
      setCarregando(false);

      // Contagem de exercícios pro badge do card — só o card de treino
      // precisa disso, então não entra no Promise.all acima (a tela
      // pinta antes de esperar mais uma volta de rede).
      if (programa?.proxima) {
        const exs = await carregarExerciciosDaSessao(programa.proxima.id);
        if (ativo) setTotalExercicios(exs.length);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [userId]);

  if (carregando || !perfil) {
    return (
      <div className="tela">
        <div className="vazio">Carregando…</div>
      </div>
    );
  }

  return (
    <div className="tela">
      <header className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-ink-muted">Olá,</div>
          <h1 className="h1">{perfil.nome}</h1>
        </div>
        <div className="flex items-center gap-3">
          {streak != null && streak > 0 && (
            <div className="text-right">
              <div className="display text-3xl text-ok-ink">{streak}</div>
              <span className="overline text-ink-muted">semanas</span>
            </div>
          )}
          {/* Sem --avatar-de/--avatar-para: o padrão do componente já é o
              gradiente treino, que é o que faz sentido aqui. */}
          <div className="avatar">{iniciais(perfil.nome)}</div>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <Link to="/treino" className="card card-treino block">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="overline text-treino-ink">Treino</span>
            {perfil.usa_treino && totalExercicios != null && (
              <span className="badge badge-treino">
                {totalExercicios} {totalExercicios === 1 ? "exercício" : "exercícios"}
              </span>
            )}
          </div>
          {perfil.usa_treino ? (
            <>
              <div className="h2">
                {proxima ? `Treino ${proxima.letra} — ${proxima.nome}` : "Sem sessão pendente"}
              </div>
              {treinouHoje && <span className="badge badge-ok mt-2">Treinou hoje</span>}
              {proxima && (
                <div
                  className="progress-bar mt-3"
                  style={{ "--progresso": treinouHoje ? 1 : 0 } as CSSProperties}
                >
                  <span />
                </div>
              )}
            </>
          ) : (
            <div className="h2">Montar meu treino</div>
          )}
        </Link>

        <Link to="/estudo" className="card card-estudo block">
          <span className="overline text-estudo-ink mb-1">Estudo</span>
          <div className="h2">
            {perfil.usa_estudo ? "Ver blocos de hoje" : "Cadastrar minha primeira matéria"}
          </div>
        </Link>

        <Link to="/grupo" className="card block">
          <span className="overline text-ink-muted mb-1">Grupo</span>
          <div className="h2">Ver grupo</div>
        </Link>
      </div>

      <button className="btn btn-neutro mt-8" onClick={() => void sair()}>
        Sair
      </button>
    </div>
  );
}
