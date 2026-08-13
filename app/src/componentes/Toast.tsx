import { useEffect, useState } from "react";

/**
 * Confirmação rápida (série concluída, pomodoro concluído). Controlado
 * pelo pai: `mensagem` vira texto → toast aparece → some sozinho e chama
 * `onFechar` (o pai só precisa zerar o estado, não agendar nada).
 *
 * Monta fora da tela e entra no frame seguinte de propósito — trocar
 * `display` e a transição de posição no mesmo frame não anima nada.
 */
export function Toast({
  mensagem,
  onFechar,
}: {
  mensagem: string | null;
  onFechar: () => void;
}) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!mensagem) return;
    const entrar = requestAnimationFrame(() => setVisivel(true));
    const relogio = setTimeout(() => {
      setVisivel(false);
      setTimeout(onFechar, 250);
    }, 2500);
    return () => {
      cancelAnimationFrame(entrar);
      clearTimeout(relogio);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagem]);

  if (!mensagem) return null;

  return (
    <div className={visivel ? "toast toast--visivel" : "toast"} role="status">
      {mensagem}
    </div>
  );
}
