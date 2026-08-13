import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { montarTreino, type PedidoMontarTreino } from "../lib/montarTreino";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  salvarPerfilTreino,
  type AcessoEquipamento,
  type CondicaoSaude,
  type Dieta,
  type Experiencia,
  type Horario,
  type Lesao,
  type NivelSubjetivo,
  type Objetivo,
  type PerfilTreino,
  type Qualidade,
  type Sexo,
  type TempoParado,
  type Trabalho,
} from "../lib/dados";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Onboarding de treino. É uma chamada só, cara (a IA lê o catálogo
 * inteiro e valida regra por regra) — por isso a tela de espera é
 * honesta sobre o tempo em vez de um spinner mudo que parece travado.
 *
 * O formulário fica maior que o mínimo técnico porque idade, lesão,
 * condição de saúde e nível declarado filtram o catálogo ANTES do
 * prompt (ver supabase/functions/_shared/perfilTreino.ts) — sem isso a
 * IA não tem como saber que um iniciante não deveria receber
 * Levantamento terra.
 */
export function Onboarding() {
  const { sessao } = useAuth();
  const navigate = useNavigate();

  const [divisao, setDivisao] = useState<PedidoMontarTreino["divisao"]>("ABC");
  const [enfase, setEnfase] = useState<PedidoMontarTreino["enfase"]>("equilibrado");
  const [frequencia, setFrequencia] = useState(3);
  const [diasLembrete, setDiasLembrete] = useState<number[]>([]);
  const [horaLembrete, setHoraLembrete] = useState("");

  const [idade, setIdade] = useState("");
  const [sexo, setSexo] = useState<Sexo | null>(null);
  const [pesoKg, setPesoKg] = useState("");
  const [alturaCm, setAlturaCm] = useState("");
  const [nivelDeclarado, setNivelDeclarado] =
    useState<PerfilTreino["nivel_declarado"]>("básico");

  const [jaTreinou, setJaTreinou] = useState(false);
  const [tempoParado, setTempoParado] = useState<TempoParado>("ativo");
  const [experiencia, setExperiencia] = useState<Experiencia>("nenhuma");
  const [lesoes, setLesoes] = useState<Lesao[]>([]);
  const [condicoesSaude, setCondicoesSaude] = useState<CondicaoSaude[]>([]);

  const [objetivo, setObjetivo] = useState<Objetivo>("hipertrofia");

  const [tempoSessao, setTempoSessao] = useState(60);
  const [horarioPreferido, setHorarioPreferido] = useState<Horario | null>(null);

  const [acessoEquipamento, setAcessoEquipamento] =
    useState<AcessoEquipamento>("academia_completa");

  const [trabalho, setTrabalho] = useState<Trabalho | null>(null);
  const [sono, setSono] = useState<Qualidade | null>(null);
  const [estresse, setEstresse] = useState<NivelSubjetivo | null>(null);
  const [dieta, setDieta] = useState<Dieta | null>(null);

  const [montando, setMontando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function alternarDia(d: number) {
    setDiasLembrete((atual) =>
      atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d].sort(),
    );
  }

  function alternarLesao(l: Lesao) {
    setLesoes((atual) => (atual.includes(l) ? atual.filter((x) => x !== l) : [...atual, l]));
  }

  function alternarCondicao(c: CondicaoSaude) {
    setCondicoesSaude((atual) =>
      atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c],
    );
  }

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);

    if (!sessao) {
      setErro("Sessão expirada — faça login de novo.");
      return;
    }

    setMontando(true);
    try {
      const perfil: PerfilTreino = {
        idade: idade.trim() ? Number(idade) : null,
        sexo,
        peso_kg: pesoKg.trim() ? Number(pesoKg) : null,
        altura_cm: alturaCm.trim() ? Number(alturaCm) : null,
        nivel_declarado: nivelDeclarado,
        ja_treinou: jaTreinou,
        tempo_parado: jaTreinou ? tempoParado : null,
        experiencia,
        lesoes,
        condicoes_saude: condicoesSaude,
        objetivo,
        tempo_sessao_min: tempoSessao,
        horario_preferido: horarioPreferido,
        acesso_equipamento: acessoEquipamento,
        trabalho,
        sono,
        estresse,
        dieta,
      };
      // Grava ANTES de montar: a Edge Function lê perfil_treino direto do
      // banco (mesmo padrão de equipamentos_indisponiveis), não recebe
      // esses campos no corpo da chamada.
      await salvarPerfilTreino(sessao.user.id, perfil);

      const resultado = await montarTreino({
        divisao,
        enfase,
        frequencia_semanal: frequencia,
        dias_lembrete: diasLembrete,
        hora_lembrete: horaLembrete || null,
      });

      await supabase.from("profiles").update({ usa_treino: true }).eq("id", sessao.user.id);

      if (resultado.origem === "fallback") {
        setAviso(
          resultado.avisos[0] ??
            "Montamos um modelo padrão desta vez — dá para gerar de novo depois.",
        );
      }

      navigate("/treino", { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para montar o treino agora.");
    } finally {
      setMontando(false);
    }
  }

  if (montando) {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-treino">Montando seu treino</span>
          <p>
            A IA está lendo o catálogo inteiro e escolhendo os exercícios certos para você.
            Costuma levar entre 15 segundos e 2 minutos — não feche o app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tela">
      <h1 className="h1 mb-1">Vamos montar seu treino</h1>
      <p className="text-sm text-ink-muted mb-6">
        Isso roda uma vez — dá para ajustar exercício por exercício depois.
      </p>

      <form onSubmit={aoSubmeter} className="flex flex-col gap-5">
        <Secao titulo="Dados básicos">
          <div className="flex gap-3">
            <label className="flex-1">
              <div className="text-sm text-ink-muted mb-1">Idade (opcional)</div>
              <input
                className="campo campo-num"
                value={idade}
                onChange={(e) => setIdade(e.target.value)}
                inputMode="numeric"
                placeholder="—"
              />
            </label>
            <label className="flex-1">
              <div className="text-sm text-ink-muted mb-1">Peso (kg, opcional)</div>
              <input
                className="campo campo-num"
                value={pesoKg}
                onChange={(e) => setPesoKg(e.target.value)}
                inputMode="decimal"
                placeholder="—"
              />
            </label>
            <label className="flex-1">
              <div className="text-sm text-ink-muted mb-1">Altura (cm, opcional)</div>
              <input
                className="campo campo-num"
                value={alturaCm}
                onChange={(e) => setAlturaCm(e.target.value)}
                inputMode="numeric"
                placeholder="—"
              />
            </label>
          </div>

          <Selecao
            legend="Sexo (opcional — ajusta a ênfase biomecânica sugerida)"
            valor={sexo}
            onChange={setSexo}
            opcoes={[
              ["feminino", "Feminino"],
              ["masculino", "Masculino"],
              ["outro", "Outro"],
            ]}
          />

          <Selecao
            legend="Nível de condicionamento"
            valor={nivelDeclarado}
            onChange={setNivelDeclarado}
            opcoes={[
              ["básico", "Iniciante"],
              ["intermediário", "Intermediário"],
              ["avançado", "Avançado"],
            ]}
          />
        </Secao>

        <Secao titulo="Histórico">
          <fieldset>
            <legend className="text-sm text-ink-muted mb-2">Já treinou antes?</legend>
            <div className="flex gap-2">
              <Chip ativo={jaTreinou} onClick={() => setJaTreinou(true)}>
                Sim
              </Chip>
              <Chip ativo={!jaTreinou} onClick={() => setJaTreinou(false)}>
                Não
              </Chip>
            </div>
          </fieldset>

          {jaTreinou && (
            <Selecao
              legend="Está treinando agora ou parou?"
              valor={tempoParado}
              onChange={setTempoParado}
              opcoes={[
                ["ativo", "Treinando"],
                ["ate_6_meses", "Parei, até 6 meses"],
                ["mais_6_meses", "Parei, mais de 6 meses"],
              ]}
            />
          )}

          <Selecao
            legend="Experiência"
            valor={experiencia}
            onChange={setExperiencia}
            opcoes={[
              ["nenhuma", "Nenhuma"],
              ["musculacao", "Musculação"],
              ["crossfit", "Crossfit"],
              ["calistenia", "Calistenia"],
            ]}
          />

          <SelecaoMultipla
            legend="Lesões (marque as que tiver)"
            valores={lesoes}
            onToggle={alternarLesao}
            opcoes={[
              ["coluna", "Coluna"],
              ["joelho", "Joelho"],
              ["ombro", "Ombro"],
              ["punho", "Punho"],
            ]}
          />

          <SelecaoMultipla
            legend="Condições de saúde diagnosticadas"
            valores={condicoesSaude}
            onToggle={alternarCondicao}
            opcoes={[
              ["hipertensao", "Hipertensão"],
              ["hernia_discal", "Hérnia de disco"],
            ]}
          />
        </Secao>

        <Secao titulo="Objetivo">
          <Selecao
            legend="O que você quer alcançar?"
            valor={objetivo}
            onChange={setObjetivo}
            opcoes={[
              ["hipertrofia", "Hipertrofia"],
              ["forca", "Força"],
              ["emagrecimento", "Emagrecimento"],
              ["condicionamento", "Condicionamento"],
              ["saude_geral", "Saúde geral"],
              ["reabilitacao", "Reabilitação"],
            ]}
          />
        </Secao>

        <Secao titulo="Rotina">
          <fieldset>
            <legend className="text-sm text-ink-muted mb-2">Divisão</legend>
            <div className="flex gap-2 flex-wrap">
              {(["AB", "ABC", "ABCD", "ABCDE"] as const).map((d) => (
                <button
                  type="button"
                  key={d}
                  className={d === divisao ? "chip chip-treino" : "chip"}
                  style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
                  onClick={() => setDivisao(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm text-ink-muted mb-2">Ênfase</legend>
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  ["superior", "Superior"],
                  ["inferior", "Inferior"],
                  ["equilibrado", "Equilibrado"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  type="button"
                  key={valor}
                  className={valor === enfase ? "chip chip-treino" : "chip"}
                  style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
                  onClick={() => setEnfase(valor)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            <div className="text-sm text-ink-muted mb-1">Frequência semanal ({frequencia}x)</div>
            <input
              className="campo"
              type="range"
              min={2}
              max={6}
              value={frequencia}
              onChange={(e) => setFrequencia(Number(e.target.value))}
            />
          </label>

          <label>
            <div className="text-sm text-ink-muted mb-1">
              Tempo por sessão ({tempoSessao} min)
            </div>
            <input
              className="campo"
              type="range"
              min={20}
              max={120}
              step={5}
              value={tempoSessao}
              onChange={(e) => setTempoSessao(Number(e.target.value))}
            />
          </label>

          <Selecao
            legend="Horário preferido (opcional)"
            valor={horarioPreferido}
            onChange={setHorarioPreferido}
            opcoes={[
              ["manha", "Manhã"],
              ["tarde", "Tarde"],
              ["noite", "Noite"],
            ]}
          />

          <fieldset>
            <legend className="text-sm text-ink-muted mb-2">Lembrete — dias (opcional)</legend>
            <div className="flex gap-2">
              {DIAS.map((rotulo, i) => (
                <button
                  type="button"
                  key={i}
                  className={diasLembrete.includes(i) ? "chip chip-treino" : "chip"}
                  onClick={() => alternarDia(i)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </fieldset>

          {diasLembrete.length > 0 && (
            <label>
              <div className="text-sm text-ink-muted mb-1">Horário do lembrete</div>
              <input
                className="campo"
                type="time"
                value={horaLembrete}
                onChange={(e) => setHoraLembrete(e.target.value)}
              />
            </label>
          )}
        </Secao>

        <Secao titulo="Equipamento">
          <Selecao
            legend="Onde você treina?"
            valor={acessoEquipamento}
            onChange={setAcessoEquipamento}
            opcoes={[
              ["academia_completa", "Academia completa"],
              ["academia_condominio", "Academia de condomínio"],
              ["home_gym", "Home gym"],
              ["sem_equipamento", "Sem equipamento"],
            ]}
          />
        </Secao>

        <Secao titulo="Estilo de vida">
          <Selecao
            legend="Trabalho (opcional)"
            valor={trabalho}
            onChange={setTrabalho}
            opcoes={[
              ["sedentario", "Sedentário"],
              ["ativo", "Ativo"],
            ]}
          />
          <Selecao
            legend="Sono (opcional)"
            valor={sono}
            onChange={setSono}
            opcoes={[
              ["bom", "Bom"],
              ["regular", "Regular"],
              ["ruim", "Ruim"],
            ]}
          />
          <Selecao
            legend="Estresse (opcional)"
            valor={estresse}
            onChange={setEstresse}
            opcoes={[
              ["baixo", "Baixo"],
              ["moderado", "Moderado"],
              ["alto", "Alto"],
            ]}
          />
          <Selecao
            legend="Dieta (opcional)"
            valor={dieta}
            onChange={setDieta}
            opcoes={[
              ["deficit", "Déficit"],
              ["manutencao", "Manutenção"],
              ["superavit", "Superávit"],
            ]}
          />
        </Secao>

        {erro && (
          <p className="text-sm" style={{ color: "var(--perigo-ink)" }}>
            {erro}
          </p>
        )}
        {aviso && <p className="text-sm text-atencao-ink">{aviso}</p>}

        <button className="btn btn-treino btn-bloco" type="submit">
          Montar treino
        </button>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------------- */

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
      <h2 className="overline text-ink-muted">{titulo}</h2>
      {children}
    </section>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={ativo ? "chip chip-treino" : "chip"}
      style={{ minHeight: "var(--toque-min)", paddingInline: "var(--e-4)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Uma escolha entre N opções fixas — o padrão de chip já usado em toda a tela. */
function Selecao<T extends string>({
  legend,
  valor,
  onChange,
  opcoes,
}: {
  legend: string;
  valor: T | null;
  onChange: (v: T) => void;
  opcoes: readonly (readonly [T, string])[];
}) {
  return (
    <fieldset>
      <legend className="text-sm text-ink-muted mb-2">{legend}</legend>
      <div className="flex gap-2 flex-wrap">
        {opcoes.map(([v, rotulo]) => (
          <Chip key={v} ativo={valor === v} onClick={() => onChange(v)}>
            {rotulo}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

/** Zero ou mais opções marcadas — lesões e condições de saúde, nunca uma só. */
function SelecaoMultipla<T extends string>({
  legend,
  valores,
  onToggle,
  opcoes,
}: {
  legend: string;
  valores: T[];
  onToggle: (v: T) => void;
  opcoes: readonly (readonly [T, string])[];
}) {
  return (
    <fieldset>
      <legend className="text-sm text-ink-muted mb-2">{legend}</legend>
      <div className="flex gap-2 flex-wrap">
        {opcoes.map(([v, rotulo]) => (
          <Chip key={v} ativo={valores.includes(v)} onClick={() => onToggle(v)}>
            {rotulo}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}
