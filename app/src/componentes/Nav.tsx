import { NavLink } from "react-router";

const ITENS = [
  { para: "/", rotulo: "Início" },
  { para: "/treino", rotulo: "Treino" },
  { para: "/estudo", rotulo: "Estudo" },
  { para: "/grupo", rotulo: "Grupo" },
];

export function Nav() {
  return (
    <nav className="nav" aria-label="Navegação principal">
      {ITENS.map((item) => (
        <NavLink
          key={item.para}
          to={item.para}
          end={item.para === "/"}
          className="nav-item"
        >
          {item.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}
