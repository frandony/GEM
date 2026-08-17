import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router";
import { ChevronDown, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Voltar } from "../componentes/Voltar";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import {
  arquivarMateria,
  arquivarTopico,
  carregarMateriasParaMontagem,
  corDaDisciplina,
  type MateriaParaMontagem,
  type TopicoParaMontagem,
} from "../lib/dados";

const DIFICULDADE_ROTULO = { facil: "fácil", medio: "médio", dificil: "difícil" } as const;

/* =====================================================================
   Matérias — lista + gestão (acordeão de tópicos, excluir tópico ou
   matéria inteira). Extraída de Estudo.tsx: antes vivia na mesma tela
   que o timer/faixa de dias/blocos de hoje, empurrando "Nova matéria"
   pra fora da primeira dobra assim que existiam algumas matérias. Aqui é
   a tela toda, autossuficiente — mesmo padrão de PessoasGrupo.tsx.
   ===================================================================== */
export function MateriasEstudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const location = useLocation();
  const toast = useToast();

  const [carregando, setCarregando] = useState(true);
  const [materias, setMaterias] = useState<MateriaParaMontagem[]>([]);
  const [falhou, setFalhou] = useState<string | null>(null);
  // Id da matéria recém-criada (chega via state da navegação, de
  // NovaMateria.tsx) — só pra destacar e rolar até ela na lista. Não
  // precisa ser state reativo: é lido uma vez, no mount, e não muda
  // durante a vida da tela.
  const materiaNovaId = (location.state as { novaId?: string } | null)?.novaId ?? null;
  const [materiaAberta, setMateriaAberta] = useState<string | null>(null);

  async function carregar() {
    setFalhou(null);
    try {
      setMaterias(await carregarMateriasParaMontagem(userId));
    } catch (e) {
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar suas matérias.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
        <Voltar to="/estudo" rotulo="Estudo" className="mb-4" />
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
      <header className="mb-4">
        <Voltar to="/estudo" rotulo="Estudo" className="mb-1" />
        <h1 className="h1">Matérias</h1>
      </header>

      {/* No topo, não no rodapé — era o que fazia "Nova matéria" sumir
          da primeira dobra assim que existiam algumas matérias na lista. */}
      <Link to="/estudo/materias/nova" className="btn btn-estudo btn-bloco mb-6">
        Nova matéria
      </Link>

      {materias.length === 0 ? (
        <div className="vazio">
          <p>Você ainda não cadastrou nenhuma matéria.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {materias.map((m) => (
            <LinhaDeMateria
              key={m.id}
              materia={m}
              cor={corDaDisciplina(m.id, materias)}
              nova={m.id === materiaNovaId}
              aberta={materiaAberta === m.id}
              onAlternar={() => setMateriaAberta((atual) => (atual === m.id ? null : m.id))}
              onExcluida={async () => {
                toast.sucesso(`Matéria "${m.nome}" excluída.`);
                setMateriaAberta(null);
                await carregar();
              }}
              onTopicoExcluido={async (nomeTopico) => {
                toast.sucesso(`Tópico "${nomeTopico}" excluído.`);
                await carregar();
              }}
              onErro={(msg) => toast.erro(msg)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Matéria na lista: toca para ver os tópicos, e é lá dentro que mora o
 * excluir.
 *
 * A linha era propositalmente inerte porque não havia para onde levar.
 * Agora tem destino (a própria lista de tópicos), então passa a cumprir a
 * regra de affordance do index.css: é `<button>` de verdade e mostra o
 * chevron. O excluir fica DENTRO do painel aberto, não na linha fechada —
 * regra 4: ação com consequência não mora no corpo de uma linha que a
 * pessoa toca para navegar.
 */
function LinhaDeMateria({
  materia,
  cor,
  nova,
  aberta,
  onAlternar,
  onExcluida,
  onTopicoExcluido,
  onErro,
}: {
  materia: MateriaParaMontagem;
  cor: string;
  nova: boolean;
  aberta: boolean;
  onAlternar: () => void;
  onExcluida: () => void | Promise<void>;
  onTopicoExcluido: (nomeTopico: string) => void | Promise<void>;
  onErro: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // Id do tópico sendo excluído — não `boolean`, porque vários podem estar
  // na lista ao mesmo tempo e só UM botão pode ficar "excluindo…" por vez.
  const [excluindoTopico, setExcluindoTopico] = useState<string | null>(null);

  /**
   * Excluir tópico é ação LEVE de propósito, diferente da matéria: sem
   * modal de confirmação em 2 passos. Numa lista de 10 tópicos, exigir
   * confirmação pra cada um vira atrito que faz a pessoa desistir de
   * arrumar a lista. O toast que confirma ("Tópico excluído") é o "OK,
   * entendi" — se errar o dedo, a perda é um item numa lista, não uma
   * matéria inteira com histórico.
   */
  async function excluirTopico(topico: TopicoParaMontagem) {
    setExcluindoTopico(topico.id);
    try {
      await arquivarTopico(topico.id);
      await onTopicoExcluido(topico.nome);
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não deu para excluir o tópico.");
    } finally {
      setExcluindoTopico(null);
    }
  }

  useEffect(() => {
    if (nova) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [nova]);

  const total = materia.topicos.length;
  // "Sem plano" responde exatamente à pergunta "criei a matéria, e agora?".
  // `blocosEstimados` só é preenchido pela Fase A do montar-estudo.
  const semPlano = total > 0 && materia.topicos.every((t) => t.blocosEstimados == null);
  const proximoEvento = materia.eventos
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))[0];

  async function excluir() {
    setExcluindo(true);
    try {
      await arquivarMateria(materia.id);
      await onExcluida();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não deu para excluir a matéria.");
      setExcluindo(false);
    }
  }

  return (
    <div
      ref={ref}
      className={nova ? "card subject-row--nova" : "card"}
      style={{ padding: 0 }}
    >
      <button
        type="button"
        className="subject-row w-full text-left"
        style={{ "--cor": cor, paddingInline: "var(--e-4)" } as CSSProperties}
        onClick={onAlternar}
        aria-expanded={aberta}
      >
        <span className="subject-row__cor" />
        <div className="subject-row__texto">
          <div className="h3">{materia.nome}</div>
          <div className="text-xs text-ink-terciario">
            {total} {total === 1 ? "tópico" : "tópicos"}
            {proximoEvento &&
              ` · ${proximoEvento.tipo === "prova" ? "prova" : "entrega"} em ${proximoEvento.data
                .split("-")
                .reverse()
                .slice(0, 2)
                .join("/")}`}
          </div>
        </div>
        {semPlano ? (
          <span className="badge badge-atencao shrink-0">sem plano</span>
        ) : (
          <span className="badge badge-estudo shrink-0">no plano</span>
        )}
        <ChevronDown
          size={18}
          className="text-ink-muted shrink-0"
          style={{
            transform: aberta ? "rotate(180deg)" : "none",
            transition: "transform var(--d-entrar) var(--ease-out)",
          }}
        />
      </button>

      {aberta && (
        <div style={{ padding: "0 var(--e-4) var(--e-4)" }}>
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: "var(--e-3)" }}>
            {total === 0 ? (
              <p className="text-sm text-ink-muted">Esta matéria não tem tópicos cadastrados.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {materia.topicos.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="text-xs text-ink-fraco num shrink-0" style={{ width: "1.5rem" }}>
                      {t.ordem}.
                    </span>
                    <span className="text-sm flex-1">{t.nome}</span>
                    {t.dificuldade && (
                      <span className="badge shrink-0" style={{ background: "var(--surface-alta)" }}>
                        {DIFICULDADE_ROTULO[t.dificuldade]}
                      </span>
                    )}
                    {/* `compreendido` é tri-state e só desce por resposta do
                        mini-questionário — `null` significa "ainda não
                        respondeu", que não é o mesmo que "não entendeu". */}
                    {t.compreendido === false && (
                      <span className="badge badge-atencao shrink-0">revisar</span>
                    )}
                    <button
                      type="button"
                      className="topico-excluir"
                      onClick={() => void excluirTopico(t)}
                      disabled={excluindoTopico === t.id}
                      aria-label={`Excluir tópico "${t.nome}"`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--hairline)", marginTop: "var(--e-4)", paddingTop: "var(--e-3)" }}>
            {!confirmando ? (
              <button className="btn btn-perigo" onClick={() => setConfirmando(true)}>
                <Trash2 size={16} /> Excluir matéria
              </button>
            ) : (
              <div role="alertdialog" aria-label="Confirmar exclusão da matéria">
                <p className="mb-1">Excluir "{materia.nome}"?</p>
                {/* Diz a verdade sobre o que sobrevive. É arquivamento
                    (`ativa = false`), justamente para não destruir o que
                    está listado abaixo — ver `arquivarMateria` em dados.ts. */}
                <p className="text-sm text-ink-muted mb-4">
                  Ela sai da sua lista e dos próximos planos. O que você já estudou continua
                  contando no seu histórico e no resumo da semana.
                </p>
                <div className="flex gap-2">
                  <button className="btn btn-perigo" onClick={() => void excluir()} disabled={excluindo}>
                    {excluindo ? "Excluindo…" : "Sim, excluir"}
                  </button>
                  <button className="btn btn-neutro" onClick={() => setConfirmando(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
