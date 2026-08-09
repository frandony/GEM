import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarBlocosDoDia,
  carregarMaterias,
  carregarPerfil,
  criarMateriaSimples,
  hojeNoFuso,
  marcarBloco,
  type BlocoEstudo,
  type Materia,
} from "../lib/dados";

const TIPO_ROTULO: Record<BlocoEstudo["tipo"], string> = {
  leitura: "Leitura",
  exercicios: "Exercícios",
  revisao: "Revisão",
  marco: "Marco",
};

export function Estudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [blocos, setBlocos] = useState<BlocoEstudo[]>([]);
  const [criando, setCriando] = useState(false);

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
        <div className="vazio">Carregando…</div>
      </div>
    );
  }

  if (materias.length === 0) {
    return (
      <div className="tela">
        <h1 className="text-xl font-semibold mb-4">Estudo</h1>
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

  return (
    <div className="tela">
      <h1 className="text-xl font-semibold mb-1">Estudo</h1>
      <p className="text-sm text-ink-muted mb-6">
        {materias.length} {materias.length === 1 ? "matéria ativa" : "matérias ativas"}
      </p>

      <h2 className="text-sm text-ink-muted uppercase tracking-wide mb-2">Hoje</h2>
      {blocos.length === 0 ? (
        <div className="vazio mb-6">
          <p>Nenhum bloco de estudo planejado para hoje.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-6">
          {pendentes.map((b) => (
            <div key={b.id} className="card card-estudo flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-estudo-ink uppercase tracking-wide">
                  {TIPO_ROTULO[b.tipo]} · {b.hora.slice(0, 5)} · {b.duracao_min} min
                </div>
                <div className="font-semibold">{b.titulo}</div>
              </div>
              <button className="btn btn-estudo" onClick={() => void concluirBloco(b)}>
                Concluir
              </button>
            </div>
          ))}
          {feitos.map((b) => (
            <div key={b.id} className="card flex items-center justify-between gap-3 opacity-60">
              <div>
                <div className="text-xs text-ink-muted uppercase tracking-wide">
                  {TIPO_ROTULO[b.tipo]}
                </div>
                <div className="font-semibold">{b.titulo}</div>
              </div>
              <span className="chip chip-ok">{b.status}</span>
            </div>
          ))}
        </div>
      )}

      {!criando ? (
        <button className="btn btn-neutro" onClick={() => setCriando(true)}>
          Nova matéria
        </button>
      ) : (
        <NovaMateria
          onCriada={async () => {
            setCriando(false);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function NovaMateria({ onCriada }: { onCriada: () => void | Promise<void> }) {
  const [nome, setNome] = useState("");
  const [topicos, setTopicos] = useState(["", "", ""]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
      <label>
        <div className="text-sm text-ink-muted mb-1">Nome da matéria</div>
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>

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
