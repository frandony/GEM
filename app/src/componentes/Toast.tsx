import { useEffect, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { Aviso } from "../lib/toast";

/**
 * Confirmação efêmera. Controlado pelo `ToastProvider` (lib/toast.tsx),
 * que remonta este componente a cada aviso via `key` — por isso aqui não
 * há nenhuma lógica de "mudou a mensagem?".
 *
 * Monta fora da tela e entra no frame seguinte de propósito: trocar
 * `display` e a transição de posição no mesmo frame não anima nada.
 *
 * Erro dura quase o dobro do sucesso. "Série concluída" é confirmação de
 * algo que a pessoa já sabe que fez; "não deu para salvar" precisa ser
 * lido, e às vezes relido.
 */
const DURACAO_MS = { ok: 2500, erro: 4500 } as const;

export function Toast({ aviso, onFechar }: { aviso: Aviso; onFechar: () => void }) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const entrar = requestAnimationFrame(() => setVisivel(true));
    const sair = setTimeout(() => setVisivel(false), DURACAO_MS[aviso.tipo]);
    // Guardado e limpo junto com os outros: antes este timer era agendado
    // DENTRO do callback do primeiro e ficava fora do cleanup, então
    // `onFechar` podia rodar depois da desmontagem.
    const fechar = setTimeout(onFechar, DURACAO_MS[aviso.tipo] + 250);

    return () => {
      cancelAnimationFrame(entrar);
      clearTimeout(sair);
      clearTimeout(fechar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icone = aviso.tipo === "ok" ? CheckCircle2 : TriangleAlert;

  return (
    <div
      className={[
        "toast",
        aviso.tipo === "ok" ? "toast--ok" : "toast--erro",
        visivel ? "toast--visivel" : "",
      ].join(" ")}
      // Sucesso é `status` (polite, espera a fala corrente terminar);
      // erro é `alert` (assertive, interrompe).
      role={aviso.tipo === "ok" ? "status" : "alert"}
    >
      <Icone size={16} aria-hidden />
      {aviso.texto}
    </div>
  );
}
