import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import {
  carregarGruposDoUsuario,
  carregarMembrosDoGrupo,
  carregarPerfil,
  criarGrupo,
  entrarNoGrupo,
  type Grupo as GrupoTipo,
  type MembroDoGrupo,
} from "../lib/dados";

export function Grupo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [grupos, setGrupos] = useState<GrupoTipo[]>([]);
  const [membrosPorGrupo, setMembrosPorGrupo] = useState<Record<string, MembroDoGrupo[]>>({});
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const perfil = await carregarPerfil(userId);
    const tz = perfil?.timezone ?? "America/Sao_Paulo";

    const gs = await carregarGruposDoUsuario(userId);
    setGrupos(gs);

    const entradas = await Promise.all(
      gs.map(async (g) => [g.id, await carregarMembrosDoGrupo(g.id, tz)] as const),
    );
    setMembrosPorGrupo(Object.fromEntries(entradas));
    setCarregando(false);
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (carregando) {
    return (
      <div className="tela">
        <div className="vazio">Carregando…</div>
      </div>
    );
  }

  return (
    <div className="tela">
      <h1 className="text-xl font-semibold mb-6">Grupo</h1>

      {grupos.length === 0 ? (
        <div className="vazio mb-6">
          <p>Você ainda não está em nenhum grupo.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 mb-6">
          {grupos.map((g) => (
            <div key={g.id} className="card">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-lg font-semibold">{g.nome}</h2>
                <span className="text-xs text-ink-muted num">código {g.codigo_convite}</span>
              </div>
              <div className="flex flex-col gap-2">
                {(membrosPorGrupo[g.id] ?? []).map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between">
                    <span>{m.nome}</span>
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      {m.treinou_hoje && <span className="chip chip-ok">hoje</span>}
                      <span className="num">{m.streak} sem.</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {erro && (
        <p className="text-sm mb-4" style={{ color: "var(--perigo-ink)" }}>
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <CriarGrupo
          onCriado={async () => {
            setErro(null);
            await carregar();
          }}
          onErro={setErro}
        />
        <EntrarGrupo
          onEntrou={async () => {
            setErro(null);
            await carregar();
          }}
          onErro={setErro}
        />
      </div>
    </div>
  );
}

function CriarGrupo({
  onCriado,
  onErro,
}: {
  onCriado: () => void | Promise<void>;
  onErro: (msg: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setEnviando(true);
    try {
      await criarGrupo(nome.trim());
      setNome("");
      await onCriado();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não deu para criar o grupo.");
    } finally {
      setEnviando(false);
    }
  }

  // O botão desabilitado é o feedback. Antes o clique com campo vazio caía
  // num `return` silencioso: nada acontecia, nenhuma mensagem, e parecia
  // que o botão estava quebrado.
  const vazio = !nome.trim();

  return (
    <form onSubmit={aoSubmeter} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          className="campo"
          placeholder="Nome do grupo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={40}
          aria-label="Nome do grupo"
        />
        <button className="btn btn-neutro" type="submit" disabled={enviando || vazio}>
          {enviando ? "Criando…" : "Criar"}
        </button>
      </div>
      {vazio && <p className="text-xs text-ink-fraco">Dê um nome ao grupo para criar.</p>}
    </form>
  );
}

function EntrarGrupo({
  onEntrou,
  onErro,
}: {
  onEntrou: () => void | Promise<void>;
  onErro: (msg: string) => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;
    setEnviando(true);
    try {
      await entrarNoGrupo(codigo.trim());
      setCodigo("");
      await onEntrou();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Código inválido.");
    } finally {
      setEnviando(false);
    }
  }

  // O código tem 6 caracteres — antes disso o botão nem tenta.
  const incompleto = codigo.trim().length < 6;

  return (
    <form onSubmit={aoSubmeter} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          className="campo campo-num"
          placeholder="Código de convite"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          aria-label="Código de convite"
        />
        <button className="btn btn-neutro" type="submit" disabled={enviando || incompleto}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </div>
      {incompleto && (
        <p className="text-xs text-ink-fraco">O código do convite tem 6 caracteres.</p>
      )}
    </form>
  );
}
