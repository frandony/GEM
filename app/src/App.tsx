import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { Nav } from "./componentes/Nav";
import { AtualizacaoDisponivel } from "./componentes/AtualizacaoDisponivel";
import { Login } from "./telas/Login";
import { AuthCallback } from "./telas/AuthCallback";
import { Onboarding } from "./telas/Onboarding";
import { Home } from "./telas/Home";
import { Treino } from "./telas/Treino";
import { EditarPlano } from "./telas/EditarPlano";
import { HistoricoTreinos } from "./telas/HistoricoTreinos";
import { Estudo } from "./telas/Estudo";
import { GradeEstudo } from "./telas/GradeEstudo";
import { MontarPlanoEstudo } from "./telas/MontarPlanoEstudo";
import { Social } from "./telas/Social";
import { DetalheGrupo } from "./telas/DetalheGrupo";
import { PessoasGrupo } from "./telas/PessoasGrupo";
import { DescobrirPessoas } from "./telas/DescobrirPessoas";
import { PerfilPublico } from "./telas/PerfilPublico";
import { ListaDeConexoes } from "./telas/ListaDeConexoes";
import { Conta } from "./telas/Conta";

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

/**
 * Rota desconhecida. Caminho normal volta para a Início; caminho que
 * PARECE arquivo (tem extensão) não: se `/icones/192.png` cair aqui, é
 * porque o arquivo não existe no servidor, e mandar a pessoa para a
 * Início esconde justamente o que está quebrado. Era isso que deixava a
 * tela presa em "Carregando…" ao abrir um asset inexistente.
 */
function NaoEncontrado() {
  const { pathname } = useLocation();
  const pareceArquivo = /\.[a-z0-9]{2,5}$/i.test(pathname);

  if (!pareceArquivo) return <Navigate to="/" replace />;

  return (
    <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
      <div className="vazio w-full">
        <span className="badge badge-atencao">Arquivo não encontrado</span>
        <p className="num text-sm">{pathname}</p>
        <a className="btn btn-treino" href="/">
          Ir para a Início
        </a>
      </div>
    </div>
  );
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
      {/* Acima do router de propósito: sem isso, um toast disparado logo
          antes de um `navigate` morre com a tela que o pediu — era o caso
          do aviso de plano gerado por template no Onboarding. */}
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<SomenteVisitante />}>
            <Route path="/login" element={<Login />} />
          </Route>

          {/* Fora dos dois guardas: quem chega aqui vem do link do e-mail e
              ainda não tem sessão, mas também não pode ser mandado ao login
              antes de o token do fragmento ser lido. */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route element={<Protegido />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route element={<ComNav />}>
              <Route path="/" element={<Home />} />
              <Route path="/treino" element={<Treino />} />
              <Route path="/treino/plano" element={<EditarPlano />} />
              <Route path="/treino/historico" element={<HistoricoTreinos />} />
              <Route path="/estudo" element={<Estudo />} />
              <Route path="/estudo/grade" element={<GradeEstudo />} />
              <Route path="/estudo/montar" element={<MontarPlanoEstudo />} />
              <Route path="/grupo" element={<Social />} />
              <Route path="/grupo/descobrir" element={<DescobrirPessoas />} />
              <Route path="/grupo/perfil/:userId" element={<PerfilPublico />} />
              <Route
                path="/grupo/perfil/:userId/seguindo"
                element={<ListaDeConexoes tipo="seguindo" />}
              />
              <Route
                path="/grupo/perfil/:userId/seguidores"
                element={<ListaDeConexoes tipo="seguidores" />}
              />
              <Route path="/grupo/:id" element={<DetalheGrupo />} />
              <Route path="/grupo/:id/pessoas" element={<PessoasGrupo />} />
              <Route path="/conta" element={<Conta />} />
            </Route>
          </Route>

          <Route path="*" element={<NaoEncontrado />} />
        </Routes>
      </BrowserRouter>

      {/* Fora do router de propósito: o aviso de versão nova não depende
          de rota e precisa aparecer também em /login e /onboarding, que
          ficam fora da casca com navegação. */}
      <AtualizacaoDisponivel />
      </ToastProvider>
    </AuthProvider>
  );
}
