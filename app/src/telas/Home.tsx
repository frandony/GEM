import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarPerfil,
  carregarProgramaAtivo,
  hojeNoFuso,
  type Perfil,
  type ProximaSessao,
} from "../lib/dados";

export function Home() {
  const { sessao, sair } = useAuth();
  const userId = sessao!.user.id;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [proxima, setProxima] = useState<ProximaSessao | null>(null);
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
          <h1 className="text-xl font-semibold">{perfil.nome}</h1>
        </div>
        {streak != null && streak > 0 && (
          <div className="text-right">
            <div className="display text-3xl text-ok-ink">{streak}</div>
            <div className="text-xs text-ink-muted uppercase tracking-wide">semanas</div>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3">
        <Link to="/treino" className="card card-treino block">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-treino-ink mb-1">Treino</div>
              {perfil.usa_treino ? (
                <>
                  <div className="text-lg font-semibold">
                    {proxima ? `Treino ${proxima.letra} — ${proxima.nome}` : "Sem sessão pendente"}
                  </div>
                  {treinouHoje && <span className="chip chip-ok mt-2">Treinou hoje</span>}
                </>
              ) : (
                <div className="text-lg font-semibold">Montar meu treino</div>
              )}
            </div>
          </div>
        </Link>

        <Link to="/estudo" className="card card-estudo block">
          <div className="text-xs uppercase tracking-wide text-estudo-ink mb-1">Estudo</div>
          <div className="text-lg font-semibold">
            {perfil.usa_estudo ? "Ver blocos de hoje" : "Cadastrar minha primeira matéria"}
          </div>
        </Link>

        <Link to="/grupo" className="card block">
          <div className="text-xs uppercase tracking-wide text-ink-muted mb-1">Grupo</div>
          <div className="text-lg font-semibold">Ver grupo</div>
        </Link>
      </div>

      <button className="btn btn-neutro mt-8" onClick={() => void sair()}>
        Sair
      </button>
    </div>
  );
}
