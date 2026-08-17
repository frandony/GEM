import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Calendar, Camera, Sparkles, Upload, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Voltar } from "../componentes/Voltar";
import { extrairTextoDoPdf } from "../lib/pdf";
import { extrairTextoDaImagem } from "../lib/ocr";
import {
  extrairTopicosDoTexto,
  gerarTopicosPeloNome,
  type Contexto,
  type DataExtraidaDoPdf,
  type ExtracaoDeTopicos,
  type OrigemDosTopicos,
} from "../lib/extrairTopicos";
import { criarMateriaSimples, ligarUsaEstudo, type EventoNovo } from "../lib/dados";
import { useValidacao } from "../lib/formulario";
import { AvisoDeFormulario, MensagemErro } from "../componentes/MensagemErro";

/** Um card da revisão multi-matéria — só o nome é editável; os tópicos
    ficam como a IA devolveu, porque afinar tópico por tópico já existe
    DEPOIS de criada (a lixeira em "Matérias") — reeditar aqui em cima de
    N cards seria a mesma ferramenta duas vezes. */
interface PropostaMateria {
  nome: string;
  incluir: boolean;
  topicos: string[];
  datas: DataExtraidaDoPdf[];
}

/* =====================================================================
   Nova matéria — tela própria (antes era um formulário togglável no
   rodapé de Estudo.tsx, empurrado pra fora da primeira dobra assim que
   existiam algumas matérias/blocos acima dele). Lógica e estado
   inalterados nesta extração — só ganhou Voltar/h1 de página no lugar do
   cabeçalho interno (h2 + X de cancelar), que ficava redundante: sair
   sem salvar já é o que Voltar faz, mesmo padrão de MontarPlanoEstudo.tsx.
   ===================================================================== */
export function NovaMateria() {
  const { sessao } = useAuth();
  const userId = sessao!.user.id;
  const navegar = useNavigate();
  const toast = useToast();

  const [nome, setNome] = useState("");
  const [topicos, setTopicos] = useState(["", "", ""]);
  const [eventos, setEventos] = useState<EventoNovo[]>([]);
  const [tipoEventoNovo, setTipoEventoNovo] = useState<"prova" | "entrega">("prova");
  const [dataEventoNovo, setDataEventoNovo] = useState("");
  const [descEventoNovo, setDescEventoNovo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const { campo, erros, errosSemCampo, idDoErro, limpar, validar } =
    useValidacao<"nome" | "topico">();

  // Modo só decide qual entrada de tópico aparece. `origemAtual` e
  // `confiancaAtual` são o que de fato vai pro banco — ficam "manual"/
  // "alta" até uma extração ter sucesso, e não voltam atrás só porque a
  // pessoa reabriu o modo manual pra ajustar um tópico.
  const [modo, setModo] = useState<"manual" | "pdf" | "ia">("manual");
  const [origemAtual, setOrigemAtual] = useState<OrigemDosTopicos>("manual");
  const [confiancaAtual, setConfiancaAtual] = useState<"alta" | "media" | "baixa">("alta");
  // Contexto/curso/período valem pros DOIS caminhos de IA (documento e
  // por nome) — o backend usa os dois pra "completar" tópicos que o
  // documento não deixou explícitos, não só pro caminho sem documento.
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [curso, setCurso] = useState("");
  const [periodo, setPeriodo] = useState<number | null>(null);
  // Estado compartilhado pelos caminhos de IA (documento e por nome): o
  // fluxo depois da resposta é o mesmo — revisar e salvar —, então
  // duplicar seria só chance de os dois divergirem.
  const [iaEstado, setIaEstado] = useState<"ocioso" | "lendo" | "analisando" | "erro">("ocioso");
  const [iaErro, setIaErro] = useState<string | null>(null);
  const [pdfNomeArquivo, setPdfNomeArquivo] = useState<string | null>(null);
  const [iaAvisos, setIaAvisos] = useState<string[]>([]);
  const [pdfDatas, setPdfDatas] = useState<DataExtraidaDoPdf[]>([]);
  // `null` = modo de uma matéria só (o de sempre). Só o caminho de
  // documento pode virar N matérias — "gerar pela IA" sempre devolve 1,
  // o backend garante isso no prompt.
  const [propostas, setPropostas] = useState<PropostaMateria[] | null>(null);

  /** Ponto único onde uma extração vira estado do formulário. */
  function aplicarExtracao(extracao: ExtracaoDeTopicos, vazioMsg: string) {
    setOrigemAtual(extracao.origem);
    setConfiancaAtual(extracao.confianca);

    const semNada =
      extracao.materias.length === 0 ||
      (extracao.materias.length === 1 && extracao.materias[0]!.topicos.length === 0);
    setIaAvisos(semNada ? [vazioMsg] : extracao.avisos);
    setIaEstado("ocioso");

    if (extracao.materias.length > 1) {
      // Documento com várias disciplinas (grade curricular, por
      // exemplo): cada uma vira um card revisável, todas pré-marcadas —
      // a pessoa desmarca a que não quer, em vez de marcar uma por uma.
      setPropostas(
        extracao.materias.map((m) => ({
          nome: m.nome,
          incluir: true,
          topicos: m.topicos.map((t) => t.nome),
          datas: m.datasEncontradas,
        })),
      );
      return;
    }

    // Caso comum: uma matéria só. Continua populando os campos de
    // sempre — não vale complicar o caminho principal por causa do raro.
    setPropostas(null);
    const m = extracao.materias[0];
    setTopicos(m && m.topicos.length > 0 ? m.topicos.map((t) => t.nome) : [""]);
    if (!nome.trim() && m?.nome) setNome(m.nome);
    setPdfDatas(m?.datasEncontradas ?? []);
    limpar("topico");
  }

  async function aoEscolherPdf(arquivo: File) {
    setPdfNomeArquivo(arquivo.name);
    setIaErro(null);
    setIaAvisos([]);
    setPdfDatas([]);
    setIaEstado("lendo");
    try {
      const texto = await extrairTextoDoPdf(arquivo);
      setIaEstado("analisando");
      aplicarExtracao(
        await extrairTopicosDoTexto(texto, { curso, periodo, contexto }),
        "Nenhum tópico identificado neste arquivo — digite manualmente abaixo.",
      );
    } catch (e) {
      setIaErro(e instanceof Error ? e.message : "Não deu para ler o arquivo.");
      setIaEstado("erro");
    }
  }

  /** Mesmo pipeline do PDF a partir daqui — só a extração de texto muda
      (OCR em vez de pdf.js). O resto (extrair-topicos, revisão, criação)
      é idêntico, por isso os dois caem no mesmo `aplicarExtracao`. */
  async function aoEscolherFoto(arquivo: File) {
    setPdfNomeArquivo(arquivo.name || "Foto");
    setIaErro(null);
    setIaAvisos([]);
    setPdfDatas([]);
    setIaEstado("lendo");
    try {
      const texto = await extrairTextoDaImagem(arquivo);
      setIaEstado("analisando");
      aplicarExtracao(
        await extrairTopicosDoTexto(texto, { curso, periodo, contexto }),
        "Nenhum tópico identificado nesta foto — digite manualmente abaixo.",
      );
    } catch (e) {
      setIaErro(e instanceof Error ? e.message : "Não deu para ler a foto.");
      setIaEstado("erro");
    }
  }

  /**
   * Gera os tópicos só com o nome da matéria — sem documento nenhum.
   * Usa o campo "Nome da matéria" lá de cima, então valida ele primeiro:
   * sem isso, o toque no botão não faria nada e a pessoa não saberia por quê.
   */
  async function gerarPeloNome() {
    setIaErro(null);
    if (!validar([{ campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome à matéria primeiro." }])) {
      return;
    }
    setIaAvisos([]);
    setPdfDatas([]);
    setIaEstado("analisando");
    try {
      aplicarExtracao(
        await gerarTopicosPeloNome(nome.trim(), { curso, periodo, contexto }),
        "A IA não conseguiu listar tópicos para essa matéria — digite manualmente abaixo.",
      );
    } catch (e) {
      setIaErro(e instanceof Error ? e.message : "Não deu para gerar os tópicos.");
      setIaEstado("erro");
    }
  }

  function adicionarEvento() {
    if (!dataEventoNovo) return;
    setEventos((atual) => [
      ...atual,
      { tipo: tipoEventoNovo, data: dataEventoNovo, descricao: descEventoNovo.trim() || null },
    ]);
    setDataEventoNovo("");
    setDescEventoNovo("");
  }

  /** Depois de criar (uma matéria ou várias): liga a flag que faz o card
      "Estudo de hoje" existir na Home, avisa e volta pra lista — com o id
      da(s) recém-criada(s) no state da navegação, pra a lista destacar e
      rolar até ela (mesmo prop `nova` que LinhaDeMateria já sabia usar). */
  async function aoCriar(ids: string[], nomes: string[]) {
    await ligarUsaEstudo(userId);
    toast.sucesso(
      nomes.length === 1 ? `Matéria "${nomes[0]}" criada.` : `${nomes.length} matérias criadas.`,
    );
    navegar("/estudo/materias", { state: { novaId: ids[0] ?? null } });
  }

  /**
   * Cria as matérias marcadas nos cards de revisão, uma chamada de RPC
   * por matéria — não existe (nem deveria existir) uma versão em lote de
   * `salvar_materia_com_topicos`: cada matéria é uma transação própria,
   * e se uma falhar as outras não devem ficar reféns dela.
   *
   * Eventos (provas/entregas) ficam de fora aqui de propósito: em N
   * matérias, a quem cada data pertence deixa de ser óbvio, e a UI
   * compartilhada de eventos do formulário não faz sentido pra N
   * matérias ao mesmo tempo. Fica pra v2 se aparecer pedido de verdade.
   */
  async function criarVarias(selecionadas: PropostaMateria[]) {
    const criadasIds: string[] = [];
    const criadasNomes: string[] = [];
    const falhas: string[] = [];

    for (const p of selecionadas) {
      const nomesTopicos = p.topicos.map((t) => t.trim()).filter(Boolean);
      try {
        const id = await criarMateriaSimples(
          p.nome.trim(),
          nomesTopicos.map((n) => ({ nome: n, dificuldade: null })),
          [],
          origemAtual,
          confiancaAtual,
        );
        criadasIds.push(id);
        criadasNomes.push(p.nome.trim());
      } catch (e) {
        falhas.push(`${p.nome.trim()}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
    }

    if (criadasIds.length > 0) await aoCriar(criadasIds, criadasNomes);
    if (falhas.length > 0) {
      setErroServidor(
        criadasIds.length > 0
          ? `${criadasIds.length} criada(s). Não deu certo: ${falhas.join("; ")}`
          : `Nenhuma matéria foi criada: ${falhas.join("; ")}`,
      );
    }
  }

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setErroServidor(null);

    if (propostas) {
      const selecionadas = propostas.filter((p) => p.incluir && p.nome.trim());
      if (selecionadas.length === 0) {
        setErroServidor("Marque pelo menos uma matéria para criar.");
        return;
      }
      setEnviando(true);
      await criarVarias(selecionadas);
      setEnviando(false);
      return;
    }

    const nomesTopicos = topicos.map((t) => t.trim()).filter(Boolean);

    // Duas regras separadas, não uma mensagem única no fim do formulário:
    // o foco vai para o campo que de fato faltou. Quando o modo é PDF os
    // inputs de tópico nem estão montados — aí o hook joga a mensagem em
    // `errosSemCampo`, que sai no `.aviso-form` acima do botão.
    const passou = validar([
      { campo: "nome", valido: !!nome.trim(), mensagem: "Dê um nome à matéria." },
      {
        campo: "topico",
        valido: nomesTopicos.length > 0,
        mensagem: "Cadastre pelo menos um tópico.",
      },
    ]);
    if (!passou) return;

    setEnviando(true);
    try {
      const materiaId = await criarMateriaSimples(
        nome.trim(),
        nomesTopicos.map((n) => ({ nome: n, dificuldade: null })),
        eventos,
        origemAtual,
        confiancaAtual,
      );
      await aoCriar([materiaId], [nome.trim()]);
    } catch (e) {
      setErroServidor(e instanceof Error ? e.message : "Não deu para criar a matéria.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela">
      <header className="mb-4">
        <Voltar to="/estudo/materias" rotulo="Matérias" className="mb-1" />
        <h1 className="h1">Nova matéria</h1>
      </header>

      <form onSubmit={aoSubmeter} className="card flex flex-col gap-4">
        {/* Some quando a extração virou N matérias: cada card de baixo tem
            seu próprio nome editável, um campo "Nome da matéria" no topo
            ficaria sobrando e confuso ("nome de qual das cinco?"). */}
        {!propostas && (
          <div>
            <label>
              <div className="text-sm text-ink-muted mb-1">Nome da matéria</div>
              <input
                className="campo"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  limpar("nome");
                }}
                {...campo("nome")}
              />
            </label>
            {erros.nome && <MensagemErro id={idDoErro("nome")}>{erros.nome}</MensagemErro>}
          </div>
        )}

        <div>
          <div className="text-sm text-ink-muted mb-1">Como cadastrar os tópicos</div>
          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              type="button"
              className={modo === "manual" ? "chip chip-estudo" : "chip"}
              onClick={() => setModo("manual")}
            >
              Digitar
            </button>
            <button
              type="button"
              className={modo === "pdf" ? "chip chip-estudo" : "chip"}
              onClick={() => setModo("pdf")}
            >
              PDF ou foto
            </button>
            <button
              type="button"
              className={modo === "ia" ? "chip chip-estudo" : "chip"}
              onClick={() => setModo("ia")}
            >
              Gerar pela IA
            </button>
          </div>

          {/* Contexto/curso/período valem pros dois modos de IA — documento
              E por nome —, então ficam num bloco só entre os chips de modo
              e o painel específico, em vez de duplicados dentro de cada um. */}
          {modo !== "manual" && (
            <div className="flex flex-col gap-2 mb-3">
              <div>
                <div className="text-sm text-ink-muted mb-1">
                  O que você está estudando? <span className="text-ink-terciario">(opcional)</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      ["faculdade", "Faculdade"],
                      ["enem", "ENEM"],
                      ["concurso", "Concurso"],
                    ] as const
                  ).map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      type="button"
                      className={contexto === valor ? "chip chip-estudo" : "chip"}
                      onClick={() => setContexto((atual) => (atual === valor ? null : valor))}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </div>

              {/* ENEM não tem "curso" — a pergunta nem faz sentido pro exame.
                  Faculdade e concurso reaproveitam o MESMO campo `curso`, só
                  o rótulo/placeholder mudam: são a mesma pergunta ("em que
                  contexto calibrar os tópicos?"), não duas perguntas. */}
              {contexto !== "enem" && (
                <label>
                  <div className="text-sm text-ink-muted mb-1">
                    {contexto === "concurso" ? "Concurso" : "Curso"}{" "}
                    <span className="text-ink-terciario">(opcional, melhora o palpite)</span>
                  </div>
                  <input
                    className="campo"
                    placeholder={
                      contexto === "concurso"
                        ? "Receita Federal, TRF, Polícia Federal…"
                        : "Engenharia de Software, Direito, Medicina…"
                    }
                    value={curso}
                    onChange={(e) => setCurso(e.target.value)}
                    maxLength={120}
                  />
                </label>
              )}

              <div>
                <div className="text-sm text-ink-muted mb-1">
                  Período <span className="text-ink-terciario">(opcional)</span>
                </div>
                {/* Chip, não <select>: um <select> customizado (appearance:none
                    + seta própria) esbarrou num bug real do motor Chromium —
                    o menu suspenso nativo é medido pela caixa inteira do
                    campo, e cada opção virava um bloco enorme, lista quase
                    em branco. Chip é o padrão que já funciona neste app
                    (GradeEstudo usa o mesmo pros dias da semana) — sem
                    depender de popup nenhum renderizado pelo SO. */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    className={periodo === null ? "chip chip-estudo" : "chip"}
                    onClick={() => setPeriodo(null)}
                  >
                    Não informar
                  </button>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={periodo === n ? "chip chip-estudo" : "chip"}
                      onClick={() => setPeriodo(n)}
                    >
                      {n}º
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {modo === "ia" && (
            <div className="flex flex-col gap-2 mb-3">
              <p className="text-sm text-ink-muted">
                Sem plano de ensino em mãos? A IA lista os tópicos que essa disciplina costuma
                cobrir — você revisa e ajusta antes de salvar.
              </p>
              <button
                type="button"
                className="btn btn-neutro w-fit"
                onClick={() => void gerarPeloNome()}
                disabled={iaEstado === "analisando"}
              >
                <Sparkles size={16} />
                {iaEstado === "analisando" ? "Gerando…" : "Gerar tópicos"}
              </button>
              {/* A confiança vem forçada como "baixa" pelo backend, e é
                  verdade: isto é palpite sobre a ementa típica, não a ementa
                  do SEU professor. */}
              <p className="dica-campo">
                A lista é um ponto de partida — confira com o plano de ensino da sua turma.
              </p>

              {iaEstado === "analisando" && (
                <p className="text-sm text-ink-muted">
                  Consultando a IA — pode levar até um minuto.
                </p>
              )}
              {iaEstado === "erro" && iaErro && <AvisoDeFormulario>{iaErro}</AvisoDeFormulario>}
              {iaEstado === "ocioso" && origemAtual === "ia_nome_materia" && (
                <div className="flex flex-col gap-1">
                  <span className="badge badge-estudo w-fit">
                    {topicos.filter((t) => t.trim()).length} tópicos sugeridos — revise abaixo antes de salvar
                  </span>
                  {iaAvisos.map((a, i) => (
                    <p key={i} className="text-xs text-ink-terciario">· {a}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {modo === "pdf" && (
            <div className="flex flex-col gap-2 mb-3">
              <p className="text-sm text-ink-muted">
                PDF ou foto — os dois viram só texto antes de qualquer coisa sair do seu aparelho.
                Um documento com várias disciplinas (grade curricular, por exemplo) vira uma matéria
                por disciplina, pra você revisar e escolher quais criar.
              </p>
              <div className="flex gap-2 flex-wrap">
                <label className="btn btn-neutro w-fit flex items-center gap-2" style={{ cursor: "pointer" }}>
                  <Upload size={16} />
                  {pdfNomeArquivo ? "Trocar arquivo" : "Escolher PDF"}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) void aoEscolherPdf(arquivo);
                      e.target.value = "";
                    }}
                  />
                </label>
                {/* `capture="environment"` abre a câmera traseira direto no
                    celular; no desktop cai de volta pro seletor de arquivo
                    normal, sem quebrar nada. */}
                <label className="btn btn-neutro w-fit flex items-center gap-2" style={{ cursor: "pointer" }}>
                  <Camera size={16} />
                  Tirar foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) void aoEscolherFoto(arquivo);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {pdfNomeArquivo && <p className="text-xs text-ink-terciario num">{pdfNomeArquivo}</p>}

              {iaEstado === "lendo" && <p className="text-sm text-ink-muted">Lendo o documento…</p>}
              {iaEstado === "analisando" && (
                <p className="text-sm text-ink-muted">
                  A IA está identificando os tópicos — pode levar até um minuto.
                </p>
              )}
              {iaEstado === "erro" && iaErro && (
                <>
                  <AvisoDeFormulario>{iaErro}</AvisoDeFormulario>
                  {/* PDF escaneado ou foto ilegível é o caso que o backend
                      rejeita por falta de texto — e até aqui a única saída
                      oferecida era "digite manualmente", ou seja, 12 linhas
                      na mão. Agora tem um caminho de verdade. */}
                  <button
                    type="button"
                    className="btn btn-neutro w-fit"
                    onClick={() => {
                      setModo("ia");
                      setIaErro(null);
                      setIaEstado("ocioso");
                    }}
                  >
                    <Sparkles size={16} /> Gerar pelo nome da matéria
                  </button>
                </>
              )}
              {iaEstado === "ocioso" && origemAtual === "pdf" && propostas && (
                <span className="badge badge-estudo w-fit">
                  {propostas.length} matérias encontradas — revise abaixo antes de criar
                </span>
              )}
              {iaEstado === "ocioso" && origemAtual === "pdf" && !propostas && (
                <div className="flex flex-col gap-1">
                  <span className="badge badge-estudo w-fit">
                    {topicos.filter((t) => t.trim()).length} tópicos extraídos — revise abaixo antes de salvar
                  </span>
                  {confiancaAtual === "baixa" && (
                    <p className="text-xs text-atencao-ink">Confiança baixa: confira cada tópico com atenção.</p>
                  )}
                  {iaAvisos.map((a, i) => (
                    <p key={i} className="text-xs text-ink-terciario">· {a}</p>
                  ))}
                </div>
              )}

              {pdfDatas.length > 0 && !propostas && (
                <div className="mt-1">
                  <div className="text-sm text-ink-muted mb-1">Datas encontradas no documento</div>
                  <div className="flex flex-col gap-2">
                    {pdfDatas.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border border-hairline px-3 py-2">
                        <Calendar size={16} className="text-ink-muted shrink-0" />
                        <span className="text-sm flex-1">
                          {d.tipo === "prova" ? "Prova" : "Entrega"} — "{d.dataTexto}"
                          {d.descricao && ` · ${d.descricao}`}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-estudo-ink underline shrink-0"
                          onClick={() => {
                            setTipoEventoNovo(d.tipo);
                            setDescEventoNovo(d.descricao ?? "");
                          }}
                        >
                          Usar
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-ink-terciario mt-1">
                    O texto da data não é confiável — escolha a data certa embaixo antes de adicionar.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Revisão de várias matérias — um documento que virou N disciplinas.
            Só o nome é editável aqui; ajuste fino de tópico por tópico já
            existe DEPOIS de criada (a lixeira em "Matérias"), reeditar
            em cima de N cards seria a mesma ferramenta duas vezes. */}
        {propostas && (
          <div className="flex flex-col gap-2">
            {propostas.map((p, i) => (
              <div key={i} className="rounded-md border border-hairline p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={p.incluir}
                    onChange={() =>
                      setPropostas((atual) =>
                        atual!.map((x, j) => (j === i ? { ...x, incluir: !x.incluir } : x)),
                      )
                    }
                  />
                  <div className="flex-1 min-w-0" style={{ opacity: p.incluir ? 1 : 0.5 }}>
                    <input
                      className="campo mb-1"
                      value={p.nome}
                      disabled={!p.incluir}
                      onChange={(e) =>
                        setPropostas((atual) =>
                          atual!.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                        )
                      }
                    />
                    <p className="text-xs text-ink-terciario">
                      {p.topicos.length} {p.topicos.length === 1 ? "tópico" : "tópicos"}
                      {p.topicos.length > 0 && `: ${p.topicos.join(" · ")}`}
                    </p>
                  </div>
                </label>
              </div>
            ))}
          </div>
        )}

        {/* A lista editável aparece no modo manual e sempre que já existe
            resultado de IA para revisar (matéria única) — é ela a "tela de
            revisão" que o backend pressupõe ao nunca gravar nada por conta
            própria. Some quando virou revisão de VÁRIAS (`propostas`), que
            tem a revisão própria acima. */}
        {!propostas && (modo === "manual" || origemAtual !== "manual") && (
        <div>
          <div className="text-sm text-ink-muted mb-1">Tópicos</div>
          {topicos.map((t, i) => (
            <input
              key={i}
              className="campo mb-2"
              placeholder={`Tópico ${i + 1}`}
              value={t}
              onChange={(e) => {
                setTopicos((atual) => atual.map((x, j) => (j === i ? e.target.value : x)))
                limpar("topico");
              }}
              /* Só o primeiro input recebe o gancho de validação: a regra é
                 "pelo menos um tópico", então é para ele que o foco vai. */
              {...(i === 0 ? campo("topico") : {})}
            />
          ))}
          {erros.topico && <MensagemErro id={idDoErro("topico")}>{erros.topico}</MensagemErro>}
          <button
            type="button"
            className="btn btn-neutro"
            onClick={() => setTopicos((atual) => [...atual, ""])}
          >
            + tópico
          </button>
        </div>
        )}

        {/* Some em modo várias matérias: a quem cada evento pertence deixa
            de ser óbvio com N matérias na mesa — ver o comentário grande em
            `criarVarias`. */}
        {!propostas && (
        <div>
          <div className="text-sm text-ink-muted mb-1">
            Provas e entregas <span className="text-ink-terciario">(opcional)</span>
          </div>
          {/* Prova cobre a matéria inteira automaticamente (a RPC liga todo
              tópico já cadastrado a ela) — não precisa escolher quais. */}
          {eventos.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {eventos.map((ev, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-hairline px-3 py-2">
                  <Calendar size={16} className="text-ink-muted shrink-0" />
                  <span className="text-sm flex-1">
                    {ev.tipo === "prova" ? "Prova" : "Entrega"} em {ev.data.split("-").reverse().join("/")}
                    {ev.descricao && ` — ${ev.descricao}`}
                  </span>
                  <button
                    type="button"
                    className="text-ink-muted shrink-0"
                    onClick={() => setEventos((atual) => atual.filter((_, j) => j !== i))}
                    aria-label="Remover evento"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              className={tipoEventoNovo === "prova" ? "chip chip-estudo" : "chip"}
              onClick={() => setTipoEventoNovo("prova")}
            >
              Prova
            </button>
            <button
              type="button"
              className={tipoEventoNovo === "entrega" ? "chip chip-estudo" : "chip"}
              onClick={() => setTipoEventoNovo("entrega")}
            >
              Entrega
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              className="campo flex-1"
              type="date"
              value={dataEventoNovo}
              onChange={(e) => setDataEventoNovo(e.target.value)}
              aria-label="Data do evento"
            />
          </div>
          <input
            className="campo mb-2"
            placeholder="Descrição (opcional)"
            value={descEventoNovo}
            onChange={(e) => setDescEventoNovo(e.target.value)}
          />
          <button type="button" className="btn btn-neutro" onClick={adicionarEvento} disabled={!dataEventoNovo}>
            Adicionar evento
          </button>
        </div>
        )}

        {/* Colado ao botão de propósito — é onde o polegar já está. */}
        {errosSemCampo.length > 0 && (
          <AvisoDeFormulario>
            {errosSemCampo.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </AvisoDeFormulario>
        )}
        {erroServidor && <AvisoDeFormulario>{erroServidor}</AvisoDeFormulario>}

        <button className="btn btn-estudo btn-bloco" type="submit" disabled={enviando}>
          {enviando
            ? "Criando…"
            : propostas
              ? `Criar ${propostas.filter((p) => p.incluir).length} ${
                  propostas.filter((p) => p.incluir).length === 1 ? "matéria" : "matérias"
                }`
              : "Criar matéria"}
        </button>
      </form>
    </div>
  );
}
