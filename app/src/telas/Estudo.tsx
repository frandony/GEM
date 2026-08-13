import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  carregarBlocosDoDia,
  carregarMaterias,
  carregarPerfil,
  corDaDisciplina,
  criarMateriaSimples,
  hojeNoFuso,
  marcarBloco,
  type BlocoEstudo,
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

  useEffect(() => {
    if (!rodando) return;
    const alvo = Date.now() + restante * 1000;
    const tique = setInterval(() => {
      const restam = Math.max(0, Math.ceil((alvo - Date.now()) / 1000));
      setRestante(restam);
      if (restam <= 0) {
        setRodando(false);
        setToast("Pomodoro concluído!");
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
        <h1 className="h1 mb-4">Estudo</h1>
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

      <span className="text-sm text-ink-muted">Sessão de estudo</span>
      <h1 className="h1 mb-4">Blocos de hoje</h1>

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
