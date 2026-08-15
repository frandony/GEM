import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { LevantadorPixel } from "../componentes/CarregandoIA";
import { Voltar } from "../componentes/Voltar";
import { useAuth } from "../lib/auth";
import {
  carregarGrade,
  carregarMateriasParaMontagem,
  carregarPerfil,
  hojeNoFuso,
  type MateriaParaMontagem,
  type SlotGrade,
} from "../lib/dados";
import { rodarDiagnostico, rodarDistribuicao, type DiagnosticoResultado, type DistribuicaoResultado } from "../lib/montarEstudo";

/** Segunda-feira da semana ATUAL (não da próxima) — isso é a primeira
    montagem, não um replanejamento; não faz sentido pular a semana em
    que a pessoa está. A regra "sempre a próxima semana" do prompt é
    especificamente pra replanejar um ciclo já em andamento. */
function segundaDestaSemana(hojeISO: string): string {
  const d = new Date(`${hojeISO}T00:00:00`);
  const dow = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

type Passo =
  | { fase: "carregando" }
  | { fase: "sem-grade" }
  | { fase: "sem-materias" }
  | { fase: "diagnosticando"; materiaAtual: string }
  | { fase: "resumo"; diagnosticos: DiagnosticoResultado[] }
  | { fase: "distribuindo" }
  | { fase: "resultado"; resultado: DistribuicaoResultado }
  | { fase: "erro"; mensagem: string };

/**
 * "Montar plano de estudo" — mesmo espírito do Onboarding de treino
 * (uma tela de espera honesta sobre o tempo, não um spinner mudo), só
 * que em duas chamadas: primeiro a IA estima esforço por matéria
 * (Fase A) e o CÓDIGO calcula quantos dias/semana seriam ideais — só
 * depois, com a grade real, a Fase B distribui de verdade.
 */
export function MontarPlanoEstudo() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const navegar = useNavigate();

  const [passo, setPasso] = useState<Passo>({ fase: "carregando" });

  useEffect(() => {
    let ativo = true;
    (async () => {
      // `carregarGrade` e `carregarMateriasParaMontagem` LANÇAM em falha de
      // consulta (ver a doutrina no topo de lib/dados.ts). Sem este catch, a
      // rejeição não teria dono e a tela ficaria em "carregando" para
      // sempre — e as duas alternativas do caminho feliz ("sem-grade",
      // "sem-materias") mandariam cadastrar o que já existe.
      let grade: SlotGrade[];
      let materias: MateriaParaMontagem[];
      try {
        [grade, materias] = await Promise.all([
          carregarGrade(userId),
          carregarMateriasParaMontagem(userId),
        ]);
      } catch (e) {
        if (!ativo) return;
        setPasso({
          fase: "erro",
          mensagem: e instanceof Error ? e.message : "Não deu para carregar seus dados.",
        });
        return;
      }
      if (!ativo) return;

      if (grade.length === 0) {
        setPasso({ fase: "sem-grade" });
        return;
      }
      const materiasComTopicos = materias.filter((m) => m.topicos.length > 0);
      if (materiasComTopicos.length === 0) {
        setPasso({ fase: "sem-materias" });
        return;
      }

      // duracao_bloco_min é fixo por matéria na Fase A (ponto aberto
      // documentado no prompt) — uso a média dos slots da grade como
      // valor representativo, em vez de chutar 60 fixo.
      const duracaoBlocoMin = Math.round(
        grade.reduce((s, g) => s + g.duracaoMin, 0) / grade.length,
      );

      const diagnosticos: DiagnosticoResultado[] = [];
      for (const m of materiasComTopicos) {
        if (!ativo) return;
        setPasso({ fase: "diagnosticando", materiaAtual: m.nome });
        try {
          const d = await rodarDiagnostico(m.id, duracaoBlocoMin);
          diagnosticos.push(d);
        } catch (e) {
          if (!ativo) return;
          setPasso({
            fase: "erro",
            mensagem: e instanceof Error ? e.message : `Não deu para avaliar "${m.nome}".`,
          });
          return;
        }
      }
      if (!ativo) return;
      setPasso({ fase: "resumo", diagnosticos });
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function distribuir() {
    setPasso({ fase: "distribuindo" });
    try {
      const perfil = await carregarPerfil(userId);
      const tz = perfil?.timezone ?? "America/Sao_Paulo";
      const semanaInicio = segundaDestaSemana(hojeNoFuso(tz));
      const resultado = await rodarDistribuicao(semanaInicio, 6);
      setPasso({ fase: "resultado", resultado });
    } catch (e) {
      setPasso({
        fase: "erro",
        mensagem: e instanceof Error ? e.message : "Não deu para montar a distribuição.",
      });
    }
  }

  if (passo.fase === "carregando") {
    return (
      <div className="tela">
        <div className="skeleton" style={{ height: "2.5rem", width: "12rem" }} />
        <div className="skeleton mt-4" style={{ height: "8rem" }} />
      </div>
    );
  }

  if (passo.fase === "sem-grade") {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-atencao">Falta configurar a grade</span>
          <p>
            Você ainda não tem nenhum horário fixo cadastrado. É a partir dela que a
            distribuição decide onde cada tópico cabe — sem isso não tem como montar.
          </p>
          <Link className="btn btn-estudo" to="/estudo/grade">
            Configurar grade
          </Link>
          <Voltar to="/estudo" rotulo="Estudo" />
        </div>
      </div>
    );
  }

  if (passo.fase === "sem-materias") {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-atencao">Nenhuma matéria com tópico</span>
          <p>Cadastre pelo menos uma matéria com tópicos antes de montar o plano.</p>
          <Voltar to="/estudo" rotulo="Estudo" />
        </div>
      </div>
    );
  }

  if (passo.fase === "diagnosticando") {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-estudo">Avaliando</span>
          <LevantadorPixel cor="var(--estudo)" />
          <p className="text-sm text-ink-muted">
            Lendo os tópicos de <strong>{passo.materiaAtual}</strong>… A IA estima o
            esforço de cada um antes de calcular o ritmo ideal. Pode levar até um
            minuto por matéria — não feche o app.
          </p>
        </div>
      </div>
    );
  }

  if (passo.fase === "distribuindo") {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-estudo">Montando sua semana</span>
          <LevantadorPixel cor="var(--estudo)" />
          <p className="text-sm text-ink-muted">
            Distribuindo os tópicos na sua grade de horários — pode levar um pouco.
          </p>
        </div>
      </div>
    );
  }

  if (passo.fase === "erro") {
    return (
      <div className="tela flex items-center" style={{ minHeight: "100dvh" }}>
        <div className="vazio w-full">
          <span className="badge badge-atencao">Não deu certo</span>
          <p>{passo.mensagem}</p>
          <Voltar to="/estudo" rotulo="Estudo" />
        </div>
      </div>
    );
  }

  if (passo.fase === "resultado") {
    const { resultado } = passo;
    return (
      <div className="tela">
        <header className="mb-4">
          <span className="rotulo-secao text-estudo-ink mb-1">Plano de estudo</span>
          <h1 className="h1">
            {resultado.origem === "ia" ? "Sua semana está montada" : "Semana montada (modelo simples)"}
          </h1>
        </header>

        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={18} className="text-ok-ink shrink-0" />
            <span className="h3">
              {resultado.blocos_criados} {resultado.blocos_criados === 1 ? "bloco criado" : "blocos criados"}
            </span>
          </div>
          {resultado.origem === "fallback" && (
            <p className="text-sm text-ink-muted">
              A IA não conseguiu terminar dessa vez, então a distribuição foi feita de
              forma simples (rodízio entre matérias). Dá pra tentar de novo mais tarde.
            </p>
          )}
          {resultado.avisos.length > 0 && (
            <ul className="text-sm text-ink-muted mt-2 flex flex-col gap-1">
              {resultado.avisos.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          )}
        </div>

        {resultado.nao_alocados.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-atencao-ink shrink-0" />
              <span className="h3">
                {resultado.nao_alocados.length} {resultado.nao_alocados.length === 1 ? "item ficou" : "itens ficaram"} de fora
              </span>
            </div>
            <ul className="text-sm text-ink-muted flex flex-col gap-1">
              {resultado.nao_alocados.map((n, i) => (
                <li key={i}>· {n.motivo.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </div>
        )}

        <button className="btn btn-estudo btn-bloco" onClick={() => navegar("/estudo", { replace: true })}>
          Ver meu plano
        </button>
      </div>
    );
  }

  // passo.fase === "resumo"
  return (
    <div className="tela">
      <header className="mb-4">
        <span className="rotulo-secao text-estudo-ink mb-1">Plano de estudo</span>
        <h1 className="h1">O que a gente descobriu</h1>
        <p className="text-sm text-ink-muted mt-1">
          O ritmo que você precisaria pra cobrir cada matéria. Não muda nada ainda —
          isso só acontece quando você tocar em "Montar minha semana".
        </p>
      </header>

      <div className="flex flex-col gap-3 mb-6">
        {passo.diagnosticos.map((d) => (
          <div key={d.materia.id} className="card">
            <div className="h2 mb-1">{d.materia.nome}</div>
            <p className="text-sm text-ink-muted">{d.ideal.resumo}</p>
            {d.ideal.saidas.length > 0 && (
              <ul className="text-xs text-ink-terciario mt-2 flex flex-col gap-1">
                {d.ideal.saidas.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <button className="btn btn-estudo btn-bloco" onClick={() => void distribuir()}>
        Montar minha semana
      </button>
    </div>
  );
}
