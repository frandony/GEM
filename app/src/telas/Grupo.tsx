import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useValidacao } from "../lib/formulario";
import { useToast } from "../lib/toast";
import { AvisoDeFormulario, MensagemErro } from "../componentes/MensagemErro";
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
      <h1 className="h1 mb-6">Grupo</h1>

      {grupos.length === 0 ? (
        <div className="vazio mb-6">
          <p>Você ainda não está em nenhum grupo.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 mb-6">
          {/* Era <div className="card">: tinha toda a aparência de card
              interativo e não reagia a nada. Agora leva ao detalhe do
              grupo, e o chevron diz que leva — ver a regra de affordance
              no index.css. */}
          {grupos.map((g) => (
            <Link key={g.id} to={`/grupo/${g.id}`} className="card block">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h2 className="h2">{g.nome}</h2>
                <span className="flex items-center gap-1 text-xs text-ink-muted shrink-0">
                  {(membrosPorGrupo[g.id] ?? []).length} membros
                  <ChevronRight size={16} />
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {(membrosPorGrupo[g.id] ?? []).map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between">
                    <span>{m.nome}</span>
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      {m.treinou_hoje && <span className="badge badge-ok">hoje</span>}
                      <span className="num">{m.streak} sem.</span>
                    </div>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* O erro de cada formulário mora DENTRO dele agora (`.aviso-form`,
          colado ao botão). O banner que ficava aqui, acima dos dois, era
          longe demais da ação: em tela de celular ele nascia fora da
          viewport de quem tinha acabado de tocar no botão. */}
      <div className="flex flex-col gap-6">
        <CriarGrupo onCriado={carregar} />
        <EntrarGrupo onEntrou={carregar} />
      </div>
    </div>
  );
}

function CriarGrupo({ onCriado }: { onCriado: () => void | Promise<void> }) {
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { campo, erros, idDoErro, limpar, validar } = useValidacao<"nome">();
  const toast = useToast();

  // O botão NÃO desabilita com o campo vazio, de propósito — ele fazia
  // exatamente o oposto do pretendido. Com `.btn:disabled` tendo
  // `pointer-events: none`, tocar num botão desabilitado não gera evento
  // nenhum: quem tentava criar um grupo sem nome recebia silêncio total e
  // concluía que o app estava quebrado (relatado em teste de produção).
  // Agora o toque sempre responde, e é o submit que explica o que falta.
  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErroServidor(null);
    if (!validar([{ campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome ao grupo." }])) {
      return;
    }
    setEnviando(true);
    try {
      await criarGrupo(nome.trim());
      setNome("");
      toast.sucesso("Grupo criado.");
      await onCriado();
    } catch (e) {
      setErroServidor(e instanceof Error ? e.message : "Não deu para criar o grupo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="campo"
          placeholder="Nome do grupo"
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            limpar("nome");
          }}
          maxLength={40}
          aria-label="Nome do grupo"
          {...campo("nome")}
        />
        <button className="btn btn-neutro" type="submit" disabled={enviando}>
          {enviando ? "Criando…" : "Criar"}
        </button>
      </div>
      {erros.nome && <MensagemErro id={idDoErro("nome")}>{erros.nome}</MensagemErro>}
      {erroServidor && <AvisoDeFormulario>{erroServidor}</AvisoDeFormulario>}
    </form>
  );
}

function EntrarGrupo({ onEntrou }: { onEntrou: () => void | Promise<void> }) {
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { campo, erros, idDoErro, limpar, validar } = useValidacao<"codigo">();
  const toast = useToast();

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErroServidor(null);
    if (
      !validar([
        {
          campo: "codigo",
          valido: codigo.trim().length === 6,
          mensagem: "O código do convite tem 6 caracteres.",
        },
      ])
    ) {
      return;
    }
    setEnviando(true);
    try {
      const grupo = await entrarNoGrupo(codigo.trim());
      setCodigo("");
      toast.sucesso(`Você entrou em "${grupo.nome}".`);
      await onEntrou();
    } catch (e) {
      setErroServidor(e instanceof Error ? e.message : "Código inválido.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="campo campo-num"
          placeholder="Código de convite"
          value={codigo}
          onChange={(e) => {
            setCodigo(e.target.value.toUpperCase());
            limpar("codigo");
          }}
          maxLength={6}
          autoCapitalize="characters"
          aria-label="Código de convite"
          {...campo("codigo")}
        />
        <button className="btn btn-neutro" type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </div>
      {erros.codigo ? (
        <MensagemErro id={idDoErro("codigo")}>{erros.codigo}</MensagemErro>
      ) : (
        /* Dica PERMANENTE, não condicional: é regra de formato que
           ninguém adivinha, e mostrá-la só com o campo vazio (como antes)
           faz a informação sumir justo quando a pessoa começa a digitar. */
        <p className="dica-campo">O código do convite tem 6 caracteres.</p>
      )}
      {erroServidor && <AvisoDeFormulario>{erroServidor}</AvisoDeFormulario>}
    </form>
  );
}
