import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { Nav } from "./componentes/Nav";
import { Login } from "./telas/Login";
import { Onboarding } from "./telas/Onboarding";
import { Home } from "./telas/Home";
import { Treino } from "./telas/Treino";
import { Estudo } from "./telas/Estudo";
import { Grupo } from "./telas/Grupo";

/** Só entra quem tem sessão. Sem isso, qualquer rota do app é pública. */
function Protegido() {
  const { sessao, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="tela">
        <div className="vazio">Carregando…</div>
      </div>
    );
  }
  if (!sessao) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Quem já tem sessão não vê a tela de login de novo. */
function SomenteVisitante() {
  const { sessao, carregando } = useAuth();
  if (carregando) return null;
  if (sessao) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Casca com a barra de navegação — onboarding fica fora dela de propósito. */
function ComNav() {
  return (
    <>
      <Outlet />
      <Nav />
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<SomenteVisitante />}>
            <Route path="/login" element={<Login />} />
          </Route>

          <Route element={<Protegido />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<ComNav />}>
              <Route path="/" element={<Home />} />
              <Route path="/treino" element={<Treino />} />
              <Route path="/estudo" element={<Estudo />} />
              <Route path="/grupo" element={<Grupo />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
