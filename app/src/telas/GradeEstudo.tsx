import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { AvisoDeFormulario } from "../componentes/MensagemErro";
import { FalhaAoCarregar } from "../componentes/FalhaAoCarregar";
import { Voltar } from "../componentes/Voltar";
import {
  adicionarSlot,
  carregarGrade,
  carregarLimites,
  removerSlot,
  salvarLimites,
  type LimitesEstudo,
  type SlotGrade,
} from "../lib/dados";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Grade de horários fixos — pré-requisito duro pra montar o plano de
 * estudo: a Fase B da Edge Function recusa rodar sem nenhum slot ativo
 * (422 direto, "nenhum horário na grade"). Fica separada do cadastro de
 * matéria de propósito: a grade é sobre TEMPO disponível, não sobre
 * conteúdo — muda bem menos vezes que a lista de matérias.
 */
export function GradeEstudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;

  const [carregando, setCarregando] = useState(true);
  const [slots, setSlots] = useState<SlotGrade[]>([]);
  const [limites, setLimites] = useState<LimitesEstudo>({
    maxBlocosDia: 2,
    maxMinutosDia: 180,
    diaLeve: null,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const toast = useToast();

  const [diaNovo, setDiaNovo] = useState(1); // segunda, o mais comum
  const [horaNova, setHoraNova] = useState("19:00");
  const [duracaoNova, setDuracaoNova] = useState(60);
  const [adicionando, setAdicionando] = useState(false);

  async function carregar() {
    setFalhou(null);
    try {
      const [g, l] = await Promise.all([carregarGrade(userId), carregarLimites(userId)]);
      setSlots(g);
      setLimites(l);
    } catch (e) {
      // "Nenhum horário cadastrado" mandaria a pessoa recadastrar o que já
      // existe — e horário duplicado é rejeitado pelo unique do banco.
      setFalhou(e instanceof Error ? e.message : "Não deu para carregar sua grade.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function aoAdicionar() {
    setErro(null);
    setAdicionando(true);
    try {
      await adicionarSlot(userId, { diaSemana: diaNovo, hora: horaNova, duracaoMin: duracaoNova });
      await carregar();
      toast.sucesso(`Horário de ${DIAS[diaNovo]} às ${horaNova} adicionado.`);
    } catch (e) {
      // Fica no `.aviso-form` do card de adicionar, não em toast: o erro
      // típico aqui é "já existe horário nesse dia e hora", que é sobre o
      // formulário aberto e precisa ficar visível enquanto ela corrige.
      setErro(e instanceof Error ? e.message : "Não deu para adicionar o horário.");
    } finally {
      setAdicionando(false);
    }
  }

  async function aoRemover(slotId: string) {
    setSlots((atual) => atual.filter((s) => s.id !== slotId)); // otimista
    try {
      await removerSlot(slotId);
      toast.sucesso("Horário removido.");
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para remover o horário.");
      await carregar(); // desfaz o otimismo se falhou
    }
  }

  async function atualizarLimites(parcial: Partial<LimitesEstudo>) {
    const novo = { ...limites, ...parcial };
    setLimites(novo); // otimista — o stepper precisa responder na hora
    try {
      await salvarLimites(userId, novo);
      // Sem toast de sucesso de propósito: o número no stepper já mudou na
      // tela, e um toast a cada toque no +/- viraria ruído.
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : "Não deu para salvar os limites.");
      await carregar(); // o número na tela precisa voltar ao que está gravado
    }
  }

  if (carregando) {
    return (
      <div className="tela">
        <div className="skeleton" style={{ height: "2.5rem", width: "12rem" }} />
        <div className="skeleton mt-4" style={{ height: "10rem" }} />
      </div>
    );
  }

  return (
    <div className="tela">
      <header className="mb-4">
        <Voltar to="/estudo" rotulo="Estudo" className="mb-1" />
        <h1 className="h1">Grade de horários</h1>
      </header>
      <p className="text-sm text-ink-muted mb-6">
        Os horários fixos que você reserva pra estudar. Sem pelo menos um, não dá
        pra montar o plano — é a partir daqui que a distribuição decide onde cada
        tópico cabe.
      </p>

      {falhou && (
        <div className="mb-6">
          <FalhaAoCarregar
            mensagem={falhou}
            onTentarDeNovo={() => {
              setCarregando(true);
              void carregar();
            }}
          />
        </div>
      )}

      <span className="rotulo-secao text-estudo-ink mb-2 block">Seus horários</span>
      {/* `!falhou &&`: sem isso, uma consulta que falhou apareceria como
          "nenhum horário cadastrado" logo abaixo do aviso de falha. */}
      {!falhou && slots.length === 0 ? (
        <div className="vazio mb-6">
          <p>Nenhum horário cadastrado ainda.</p>
        </div>
      ) : (
        <div className="card mb-6">
          {slots.map((s) => (
            <div key={s.id} className="exercise-row">
              <div className="exercise-row__texto">
                <div className="h3">{DIAS[s.diaSemana]} · {s.hora}</div>
                <div className="text-xs text-ink-terciario num">{s.duracaoMin} min</div>
              </div>
              <button
                className="exercise-row__acao"
                style={{ opacity: 0.6 }}
                onClick={() => void aoRemover(s.id)}
                aria-label={`Remover horário de ${DIAS[s.diaSemana]} às ${s.hora}`}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-6 flex flex-col gap-4">
        <span className="text-sm text-ink-muted">Adicionar horário</span>
        <div className="flex gap-2 flex-wrap">
          {DIAS.map((rotulo, i) => (
            <button
              key={i}
              type="button"
              className={i === diaNovo ? "chip chip-estudo" : "chip"}
              style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
              onClick={() => setDiaNovo(i)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex gap-3 items-end">
          <label className="flex-1">
            <div className="text-xs text-ink-muted mb-1">Horário</div>
            <input
              className="campo"
              type="time"
              value={horaNova}
              onChange={(e) => setHoraNova(e.target.value)}
            />
          </label>
          <div className="flex-1">
            <div className="text-xs text-ink-muted mb-1">Duração</div>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                style={{ width: "2.25rem", height: "2.25rem" }}
                onClick={() => setDuracaoNova((d) => Math.max(15, d - 15))}
              >
                −
              </button>
              <div className="stepper-valor num" style={{ fontSize: "var(--t-lg)", minWidth: "3.5rem" }}>
                {duracaoNova}
                <span className="unidade">min</span>
              </div>
              <button
                type="button"
                className="stepper-btn"
                style={{ width: "2.25rem", height: "2.25rem" }}
                onClick={() => setDuracaoNova((d) => Math.min(240, d + 15))}
              >
                +
              </button>
            </div>
          </div>
        </div>
        {/* Colado ao botão. Antes ficava no topo da tela, acima da lista
            de horários — em celular, fora da viewport de quem tinha
            acabado de tocar aqui embaixo. */}
        {erro && <AvisoDeFormulario>{erro}</AvisoDeFormulario>}
        <button className="btn btn-estudo btn-bloco" onClick={() => void aoAdicionar()} disabled={adicionando}>
          {adicionando ? "Adicionando…" : "+ Adicionar horário"}
        </button>
      </div>

      <span className="rotulo-secao text-ink-muted mb-2 block">Limites diários</span>
      <div className="card flex flex-col gap-5">
        <div>
          <div className="text-sm text-ink-muted mb-2">Máximo de blocos por dia</div>
          <div className="stepper">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => void atualizarLimites({ maxBlocosDia: Math.max(1, limites.maxBlocosDia - 1) })}
              disabled={limites.maxBlocosDia <= 1}
            >
              −
            </button>
            <div className="stepper-valor num">{limites.maxBlocosDia}</div>
            <button
              type="button"
              className="stepper-btn"
              onClick={() => void atualizarLimites({ maxBlocosDia: Math.min(6, limites.maxBlocosDia + 1) })}
              disabled={limites.maxBlocosDia >= 6}
            >
              +
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm text-ink-muted mb-2">Máximo de minutos por dia</div>
          <div className="stepper">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => void atualizarLimites({ maxMinutosDia: Math.max(30, limites.maxMinutosDia - 15) })}
              disabled={limites.maxMinutosDia <= 30}
            >
              −
            </button>
            <div className="stepper-valor num">
              {limites.maxMinutosDia}
              <span className="unidade">min</span>
            </div>
            <button
              type="button"
              className="stepper-btn"
              onClick={() => void atualizarLimites({ maxMinutosDia: Math.min(600, limites.maxMinutosDia + 15) })}
              disabled={limites.maxMinutosDia >= 600}
            >
              +
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm text-ink-muted mb-2">
            Dia leve <span className="text-ink-terciario">(nunca recebe bloco — opcional)</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className={limites.diaLeve == null ? "chip chip-estudo" : "chip"}
              onClick={() => void atualizarLimites({ diaLeve: null })}
            >
              Nenhum
            </button>
            {DIAS.map((rotulo, i) => (
              <button
                key={i}
                type="button"
                className={limites.diaLeve === i ? "chip chip-estudo" : "chip"}
                onClick={() => void atualizarLimites({ diaLeve: i })}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {slots.length > 0 ? (
        <Link className="btn btn-estudo btn-bloco mt-6" to="/estudo/montar">
          Montar plano de estudo
        </Link>
      ) : (
        <p className="text-sm text-ink-muted text-center mt-6">
          Adicione pelo menos um horário pra poder montar o plano.
        </p>
      )}
    </div>
  );
}
