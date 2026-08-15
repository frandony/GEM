import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";

/**
 * Um "voltar" só, usado em toda a tela — chevron + nome do destino, sem
 * moldura de botão. Antes existiam três variações da mesma ideia: botão
 * cheio dizendo "Voltar" (48px, largura do conteúdo do card), link
 * sublinhado ao lado do `h1`, e uma versão quase igual a esta copiada em
 * duas telas com classe utilitária repetida à mão.
 *
 * Vai ACIMA do `h1` (nunca ao lado — lado a lado empurra o título para
 * fora do centro visual em tela estreita) ou solto dentro de um estado
 * `.vazio`, onde o pai já centraliza.
 *
 * Duas formas: `to` navega de verdade (`<Link>`); `onClick` é para
 * quando "voltar" só desfaz um estado local, sem trocar de rota — a tela
 * de confirmação de e-mail do Login, por exemplo, onde não existe uma
 * rota própria para "voltar".
 */
type Props = { rotulo: string; className?: string } & (
  | { to: string; onClick?: never }
  | { to?: never; onClick: () => void }
);

export function Voltar({ rotulo, className, to, onClick }: Props) {
  const classes = className ? `voltar ${className}` : "voltar";
  if (to) {
    return (
      <Link className={classes} to={to}>
        <ChevronLeft size={16} />
        {rotulo}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      <ChevronLeft size={16} />
      {rotulo}
    </button>
  );
}
