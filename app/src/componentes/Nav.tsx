import { NavLink } from "react-router";
import { BookOpen, Dumbbell, Home, Users } from "lucide-react";
import type { ComponentType } from "react";

const ITENS: { para: string; rotulo: string; Icone: ComponentType<{ size?: number }> }[] = [
  { para: "/", rotulo: "Início", Icone: Home },
  { para: "/treino", rotulo: "Treino", Icone: Dumbbell },
  { para: "/estudo", rotulo: "Estudo", Icone: BookOpen },
  { para: "/grupo", rotulo: "Grupo", Icone: Users },
];

export function Nav() {
  return (
    <nav className="nav" aria-label="Navegação principal">
      {ITENS.map(({ para, rotulo, Icone }) => (
        <NavLink key={para} to={para} end={para === "/"} className="nav-item">
          <Icone size={20} />
          {rotulo}
        </NavLink>
      ))}
    </nav>
  );
}
