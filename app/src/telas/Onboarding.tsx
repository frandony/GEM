import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { montarTreino, type PedidoMontarTreino } from "../lib/montarTreino";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Onboarding de treino. É uma chamada só, cara (a IA lê o catálogo
 * inteiro e valida regra por regra) — por isso a tela de espera é
 * honesta sobre o tempo em vez de um spinner mudo que parece travado.
 */
export function Onboarding() {
  const { sessao } = useAuth();
  const navigate = useNavigate();

  const [divisao, setDivisao] = useState<PedidoMontarTreino["divisao"]>("ABC");
  const [enfase, setEnfase] = useState<PedidoMontarTreino["enfase"]>("equilibrado");
  const [frequencia, setFrequencia] = useState(3);
  const [diasLembrete, setDiasLembrete] = useState<number[]>([]);
  const [horaLembrete, setHoraLembrete] = useState("");
  const [montando, setMontando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function alternarDia(d: number) {
    setDiasLembrete((atual) =>
      atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d].sort(),
    );
  }

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setMontando(true);
    try {
      const resultado = await montarTreino({
        divisao,
        enfase,
        frequencia_semanal: frequencia,
        dias_lembrete: diasLembrete,
        hora_lembrete: horaLembrete || null,
      });

      if (sessao) {
        await supabase.from("profiles").update({ usa_treino: true }).eq("id", sessao.user.id);
      }

      if (resultado.origem === "fallback") {
        setAviso(
          resultado.avisos[0] ??
            "Montamos um modelo padrão desta vez — dá para gerar de novo depois.",
        );
      }

      navigate("/treino", { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para montar o treino agora.");
    } finally {
      setMontando(false);
    }
  }

  if (montando) {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="chip chip-treino">Montando seu treino</span>
          <p>
            A IA está lendo o catálogo inteiro e escolhendo os exercícios certos para você.
            Costuma levar entre 15 segundos e 2 minutos — não feche o app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <h1 className="text-xl font-semibold mb-1">Vamos montar seu treino</h1>
      <p className="text-sm text-ink-muted mb-6">
        Isso roda uma vez — dá para ajustar exercício por exercício depois.
      </p>

      <form onSubmit={aoSubmeter} className="flex flex-col gap-5">
        <fieldset>
          <legend className="text-sm text-ink-muted mb-2">Divisão</legend>
          <div className="flex gap-2 flex-wrap">
            {(["AB", "ABC", "ABCD", "ABCDE"] as const).map((d) => (
              <button
                type="button"
                key={d}
                className={d === divisao ? "chip chip-treino" : "chip"}
                style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
                onClick={() => setDivisao(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm text-ink-muted mb-2">Ênfase</legend>
          <div className="flex gap-2 flex-wrap">
            {(
              [
                ["superior", "Superior"],
                ["inferior", "Inferior"],
                ["equilibrado", "Equilibrado"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                type="button"
                key={valor}
                className={valor === enfase ? "chip chip-treino" : "chip"}
                style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
                onClick={() => setEnfase(valor)}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        <label>
          <div className="text-sm text-ink-muted mb-1">Frequência semanal ({frequencia}x)</div>
          <input
            className="campo"
            type="range"
            min={2}
            max={6}
            value={frequencia}
            onChange={(e) => setFrequencia(Number(e.target.value))}
          />
        </label>

        <fieldset>
          <legend className="text-sm text-ink-muted mb-2">Lembrete — dias (opcional)</legend>
          <div className="flex gap-2">
            {DIAS.map((rotulo, i) => (
              <button
                type="button"
                key={i}
                className={diasLembrete.includes(i) ? "chip chip-treino" : "chip"}
                onClick={() => alternarDia(i)}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        {diasLembrete.length > 0 && (
          <label>
            <div className="text-sm text-ink-muted mb-1">Horário do lembrete</div>
            <input
              className="campo"
              type="time"
              value={horaLembrete}
              onChange={(e) => setHoraLembrete(e.target.value)}
            />
          </label>
        )}

        {erro && (
          <p className="text-sm" style={{ color: "var(--perigo-ink)" }}>
            {erro}
          </p>
        )}
        {aviso && <p className="text-sm text-atencao-ink">{aviso}</p>}

        <button className="btn btn-treino btn-bloco" type="submit">
          Montar treino
        </button>
      </form>
    </div>
  );
}
