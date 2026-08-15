import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

/**
 * Par de `Voltar` (ver componentes/Voltar.tsx): leva de um recorte —
 * "3 últimos treinos" — pra lista completa. Mesma linguagem visual,
 * chevron invertido: aqui a pessoa avança para mais detalhe, não volta.
 *
 * Existe porque o "ver todos" da tela de Treino era texto minúsculo
 * sublinhado ao lado de um `rotulo-secao` — o mesmo estilo ad-hoc que a
 * padronização do `Voltar` já tinha eliminado em todo o resto do app.
 */
export function VerTudo({ to, rotulo = "Ver todos" }: { to: string; rotulo?: string }) {
  return (
    <Link className="ver-tudo" to={to}>
      {rotulo}
      <ChevronRight size={14} />
    </Link>
  );
}
