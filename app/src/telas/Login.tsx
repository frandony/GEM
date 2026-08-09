import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";

export function Login() {
  const { entrar, criarConta } = useAuth();
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmarEmail, setConfirmarEmail] = useState(false);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      if (modo === "entrar") {
        const msg = await entrar(email, senha);
        if (msg) setErro(traduzirErro(msg));
      } else {
        const r = await criarConta(email, senha, nome);
        if (r.erro) setErro(traduzirErro(r.erro));
        else if (r.precisaConfirmarEmail) setConfirmarEmail(true);
      }
    } finally {
      setEnviando(false);
    }
  }

  if (confirmarEmail) {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="chip chip-ok">Quase lá</span>
          <p>Enviamos um link de confirmação para {email}. Abra o e-mail para ativar sua conta.</p>
          <button className="btn btn-neutro" onClick={() => setConfirmarEmail(false)}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tela flex flex-col justify-center" style={{ minHeight: "100dvh" }}>
      <h1 className="display text-3xl mb-1">Estudo + Treino</h1>
      <p className="text-sm text-ink-muted mb-6">
        {modo === "entrar" ? "Entre na sua conta" : "Crie sua conta"}
      </p>

      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        {modo === "criar" && (
          <label>
            <div className="text-sm text-ink-muted mb-1">Nome</div>
            <input
              className="campo"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={1}
              maxLength={60}
              autoComplete="name"
            />
          </label>
        )}

        <label>
          <div className="text-sm text-ink-muted mb-1">E-mail</div>
          <input
            className="campo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            enterKeyHint="next"
          />
        </label>

        <label>
          <div className="text-sm text-ink-muted mb-1">Senha</div>
          <input
            className="campo"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={6}
            autoComplete={modo === "entrar" ? "current-password" : "new-password"}
            enterKeyHint="done"
          />
        </label>

        {erro && (
          <p className="text-sm" style={{ color: "var(--perigo-ink)" }}>
            {erro}
          </p>
        )}

        <button className="btn btn-treino btn-bloco" type="submit" disabled={enviando}>
          {enviando ? "Um momento…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <button
        className="btn btn-neutro mt-4"
        onClick={() => {
          setErro(null);
          setModo((m) => (m === "entrar" ? "criar" : "entrar"));
        }}
      >
        {modo === "entrar" ? "Não tenho conta ainda" : "Já tenho conta"}
      </button>
    </div>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(msg)) return "Já existe uma conta com este e-mail.";
  if (/password.*at least/i.test(msg)) return "A senha precisa de pelo menos 6 caracteres.";
  return msg;
}
