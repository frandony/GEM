import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Download, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { useValidacao } from "../lib/formulario";
import { Voltar } from "../componentes/Voltar";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { MensagemErro } from "../componentes/MensagemErro";
import { Avatar } from "../componentes/Avatar";
import { atualizarNome, carregarPerfil, hojeNoFuso, type Perfil } from "../lib/dados";
import { baixarComoJson, exportarDadosDoUsuario } from "../lib/exportarDados";
import { excluirContaPropria } from "../lib/excluirConta";
import { atualizarFotoPerfil, removerFotoPerfil } from "../lib/fotoPerfil";

/**
 * Tela de conta — reúne o que antes vivia solto: "Exportar meus dados" e
 * "Sair" moravam no rodapé da Início sem casa própria (ver histórico de
 * `Home.tsx`), e "Excluir conta" nunca teve caminho nenhum pelo app, só
 * validação direta no banco. Alcançável pelo avatar e pelo tile
 * "Configurar" da Início.
 */
export function Conta() {
  const { sessao, sair } = useAuth();
  const navigate = useNavigate();
  const userId = sessao!.user.id;
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const nomeValidacao = useValidacao<"nome">();
  const [processandoFoto, setProcessandoFoto] = useState(false);

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const senhaValidacao = useValidacao<"novaSenha" | "confirmarSenha">();

  const [exportando, setExportando] = useState(false);

  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  async function carregar() {
    setFalhou(null);
    try {
      const p = await carregarPerfil(userId);
      setPerfil(p);
      setNome(p?.nome ?? "");
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar sua conta.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function aoEscolherFoto(arquivo: File) {
    setProcessandoFoto(true);
    try {
      const url = await atualizarFotoPerfil(userId, arquivo);
      setPerfil((atual) => (atual ? { ...atual, foto_url: url } : atual));
      toast.sucesso("Foto atualizada.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para enviar a foto.");
    } finally {
      setProcessandoFoto(false);
    }
  }

  async function removerFoto() {
    setProcessandoFoto(true);
    try {
      await removerFotoPerfil(userId);
      setPerfil((atual) => (atual ? { ...atual, foto_url: null } : atual));
      toast.sucesso("Foto removida.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para remover a foto.");
    } finally {
      setProcessandoFoto(false);
    }
  }

  async function salvarNome(e: FormEvent) {
    e.preventDefault();
    if (!nomeValidacao.validar([{ campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome." }])) {
      return;
    }
    setSalvandoNome(true);
    try {
      await atualizarNome(userId, nome.trim());
      toast.sucesso("Nome atualizado.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para salvar o nome.");
    } finally {
      setSalvandoNome(false);
    }
  }

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    const ok = senhaValidacao.validar([
      {
        campo: "novaSenha",
        valido: novaSenha.length >= 6,
        mensagem: "A senha precisa ter pelo menos 6 caracteres.",
      },
      {
        campo: "confirmarSenha",
        valido: novaSenha.length > 0 && confirmarSenha === novaSenha,
        mensagem: "As senhas não coincidem.",
      },
    ]);
    if (!ok) return;

    setTrocandoSenha(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw new Error(error.message);
      setNovaSenha("");
      setConfirmarSenha("");
      toast.sucesso("Senha alterada.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para trocar a senha.");
    } finally {
      setTrocandoSenha(false);
    }
  }

  async function exportar() {
    setExportando(true);
    try {
      const dados = await exportarDadosDoUsuario(userId);
      const hoje = hojeNoFuso(perfil?.timezone ?? "America/Sao_Paulo");
      baixarComoJson(dados, `megs-digital-backup-${hoje}.json`);
      toast.sucesso("Backup baixado.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para gerar o backup.");
    } finally {
      setExportando(false);
    }
  }

  /** Sai da sessão local depois de apagar a conta — sem isso o app fica
      "logado" numa conta que não existe mais até a próxima requisição
      falhar. */
  async function excluirConta() {
    setExcluindo(true);
    try {
      await excluirContaPropria();
      await sair();
      navigate("/login", { replace: true });
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para excluir a conta.");
      setExcluindo(false);
    }
  }

  if (carregando) {
    return (
      <div className="tela">
        <div className="skeleton" style={{ height: "2.5rem", width: "10rem" }} />
        <div className="skeleton mt-4" style={{ height: "13rem" }} />
      </div>
    );
  }

  if (falhou) {
    return (
      <div className="tela">
        <Voltar to="/" rotulo="Início" />
        <header className="mb-4">
          <h1 className="h1">Conta</h1>
        </header>
        <FalhaAoCarregar
          mensagem={falhou}
          onTentarDeNovo={() => {
            setCarregando(true);
            void carregar();
          }}
        />
      </div>
    );
  }

  return (
    <div className="tela">
      <Voltar to="/" rotulo="Início" />
      <header className="mb-6">
        <h1 className="h1">Conta</h1>
      </header>

      {/* ---- Perfil --------------------------------------------------- */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Perfil</span>
      <form onSubmit={(e) => void salvarNome(e)} className="card mb-6 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <Avatar nome={perfil?.nome ?? nome} fotoUrl={perfil?.foto_url ?? null} tamanhoRem={5} />
          <div className="flex items-center gap-3">
            <label className="text-xs text-estudo-ink underline" style={{ cursor: "pointer" }}>
              {processandoFoto ? "Enviando…" : "Trocar foto"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={processandoFoto}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void aoEscolherFoto(arquivo);
                  e.target.value = "";
                }}
              />
            </label>
            {perfil?.foto_url && (
              <button
                type="button"
                className="text-xs text-ink-muted underline"
                onClick={() => void removerFoto()}
                disabled={processandoFoto}
              >
                Remover foto
              </button>
            )}
          </div>
        </div>
        <div>
          <label>
            <div className="text-sm text-ink-muted mb-1">Nome</div>
            <input
              className="campo"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                nomeValidacao.limpar("nome");
              }}
              {...nomeValidacao.campo("nome")}
            />
          </label>
          {nomeValidacao.erros.nome && (
            <MensagemErro id={nomeValidacao.idDoErro("nome")}>{nomeValidacao.erros.nome}</MensagemErro>
          )}
        </div>
        <div>
          <div className="text-sm text-ink-muted mb-1">E-mail</div>
          <p className="text-sm">{sessao!.user.email}</p>
        </div>
        <div>
          {/* Sem seletor: não existe fuso configurável em nenhuma outra
              tela do app hoje, e inventar um aqui mudaria `hojeNoFuso` em
              todo lugar — fora do que foi pedido. */}
          <div className="text-sm text-ink-muted mb-1">Fuso horário</div>
          <p className="text-sm text-ink-terciario">{perfil?.timezone}</p>
        </div>
        <button className="btn btn-estudo w-fit" type="submit" disabled={salvandoNome}>
          {salvandoNome ? "Salvando…" : "Salvar nome"}
        </button>
      </form>

      {/* ---- Segurança -------------------------------------------------
          Direto no supabase-js (`auth.updateUser`) — sem Edge Function,
          é API padrão que já roda no cliente. */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Segurança</span>
      <form onSubmit={(e) => void trocarSenha(e)} className="card mb-6 flex flex-col gap-4">
        <div>
          <label>
            <div className="text-sm text-ink-muted mb-1">Nova senha</div>
            <input
              className="campo"
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => {
                setNovaSenha(e.target.value);
                senhaValidacao.limpar("novaSenha");
              }}
              {...senhaValidacao.campo("novaSenha")}
            />
          </label>
          {senhaValidacao.erros.novaSenha ? (
            <MensagemErro id={senhaValidacao.idDoErro("novaSenha")}>
              {senhaValidacao.erros.novaSenha}
            </MensagemErro>
          ) : (
            <p className="dica-campo">Pelo menos 6 caracteres.</p>
          )}
        </div>
        <div>
          <label>
            <div className="text-sm text-ink-muted mb-1">Confirmar nova senha</div>
            <input
              className="campo"
              type="password"
              autoComplete="new-password"
              value={confirmarSenha}
              onChange={(e) => {
                setConfirmarSenha(e.target.value);
                senhaValidacao.limpar("confirmarSenha");
              }}
              {...senhaValidacao.campo("confirmarSenha")}
            />
          </label>
          {senhaValidacao.erros.confirmarSenha && (
            <MensagemErro id={senhaValidacao.idDoErro("confirmarSenha")}>
              {senhaValidacao.erros.confirmarSenha}
            </MensagemErro>
          )}
        </div>
        <button className="btn btn-neutro w-fit" type="submit" disabled={trocandoSenha}>
          {trocandoSenha ? "Trocando…" : "Trocar senha"}
        </button>
      </form>

      {/* ---- Seus dados ------------------------------------------------- */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Seus dados</span>
      <div className="card mb-6">
        <button
          className="btn btn-neutro flex items-center justify-center gap-2 w-full"
          onClick={() => void exportar()}
          disabled={exportando}
        >
          <Download size={16} />
          {exportando ? "Gerando backup…" : "Exportar meus dados"}
        </button>
      </div>

      {/* ---- Zona de risco ------------------------------------------- */}
      <span className="rotulo-secao text-ink-muted mb-2 block">Zona de risco</span>
      <div className="card flex flex-col gap-3">
        <button
          type="button"
          className="btn btn-neutro flex items-center justify-center gap-2"
          onClick={() => void sair()}
        >
          <LogOut size={16} />
          Sair
        </button>

        {!confirmandoExclusao ? (
          <button
            type="button"
            className="btn btn-perigo flex items-center justify-center gap-2"
            onClick={() => setConfirmandoExclusao(true)}
          >
            <Trash2 size={16} />
            Excluir conta
          </button>
        ) : (
          <div role="alertdialog" aria-label="Confirmar exclusão da conta">
            <p className="mb-1">Excluir sua conta?</p>
            <p className="text-sm text-ink-muted mb-4">
              Isso apaga tudo — treinos, planos de estudo, grupo, histórico. Não tem como
              desfazer.
            </p>
            <div className="flex gap-2">
              <button className="btn btn-perigo" onClick={() => void excluirConta()} disabled={excluindo}>
                {excluindo ? "Excluindo…" : "Sim, excluir"}
              </button>
              <button
                className="btn btn-neutro"
                onClick={() => setConfirmandoExclusao(false)}
                disabled={excluindo}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
