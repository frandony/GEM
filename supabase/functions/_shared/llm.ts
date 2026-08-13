import Anthropic from "npm:@anthropic-ai/sdk@0.116.0";

/**
 * Camada de provedor para as três Edge Functions de IA.
 *
 * Existe para que trocar de modelo — ou de provedor inteiro — seja uma
 * variável de ambiente, não um refactor. Dois caminhos:
 *
 *   "anthropic"      → API nativa da Anthropic. Mantém prompt caching do
 *                      catálogo e saída estruturada GARANTIDA pela API.
 *   "openai-compat"  → qualquer endpoint compatível com OpenAI:
 *                      OpenRouter, OmniRoute auto-hospedado, Together,
 *                      LM Studio local. Muda só a URL base.
 *
 * As duas diferenças que importam entre os caminhos:
 *
 * 1. FORMATO DA SAÍDA. Anthropic usa `output_config.format`; o padrão
 *    OpenAI usa `response_format.json_schema`. Os dois recebem o MESMO
 *    JSON Schema — a conversão é só de envelope.
 *
 * 2. FORÇA DA GARANTIA. Na Anthropic o schema é garantido. Em endpoints
 *    compatíveis a documentação do OpenRouter é explícita: alguns
 *    provedores garantem, outros tratam o schema como "dica forte".
 *    Por isso o caminho compat valida o JSON no cliente antes de
 *    devolver — o que na Anthropic seria redundante.
 */

export type Provedor = "anthropic" | "openai-compat";
export type Esforco = "low" | "medium" | "high" | "xhigh" | "max";

interface ConfigProvedor {
  provedor: Provedor;
  modelo: string;
  baseUrl?: string;
  apiKey?: string;
}

/** Qual função usa qual modelo. Tudo por env, com padrão seguro. */
function configDaTarefa(tarefa: string): ConfigProvedor {
  const prefixo = `LLM_${tarefa.toUpperCase().replace(/-/g, "_")}`;

  const provedor =
    (Deno.env.get(`${prefixo}_PROVEDOR`) ??
      Deno.env.get("LLM_PROVEDOR") ??
      "anthropic") as Provedor;

  const modelo =
    Deno.env.get(`${prefixo}_MODELO`) ??
    Deno.env.get("LLM_MODELO") ??
    (provedor === "anthropic" ? "claude-opus-5" : "anthropic/claude-opus-5");

  if (provedor === "anthropic") {
    return { provedor, modelo, apiKey: Deno.env.get("ANTHROPIC_API_KEY") };
  }

  return {
    provedor,
    modelo,
    // OpenRouter: https://openrouter.ai/api/v1
    // OmniRoute auto-hospedado: https://seu-host/v1  (nunca localhost —
    // a Edge Function roda na infraestrutura do Supabase, não na sua máquina)
    baseUrl: Deno.env.get(`${prefixo}_BASE_URL`) ??
      Deno.env.get("LLM_BASE_URL") ??
      "https://openrouter.ai/api/v1",
    apiKey: Deno.env.get(`${prefixo}_API_KEY`) ?? Deno.env.get("LLM_API_KEY"),
  };
}

/**
 * Segundo provedor, usado só quando o primeiro dá ProvedorIndisponivel.
 * Opcional — sem `LLM_<TAREFA>_FALLBACK_PROVEDOR` configurado, não há
 * fallback e o erro original sobe (503, sem cair no template).
 */
function configFallbackDaTarefa(tarefa: string): ConfigProvedor | null {
  const prefixo = `LLM_${tarefa.toUpperCase().replace(/-/g, "_")}_FALLBACK`;

  const provedor = Deno.env.get(`${prefixo}_PROVEDOR`) as Provedor | undefined;
  const modelo = Deno.env.get(`${prefixo}_MODELO`);
  if (!provedor || !modelo) return null;

  if (provedor === "anthropic") {
    return { provedor, modelo, apiKey: Deno.env.get("ANTHROPIC_API_KEY") };
  }

  return {
    provedor,
    modelo,
    baseUrl: Deno.env.get(`${prefixo}_BASE_URL`),
    apiKey: Deno.env.get(`${prefixo}_API_KEY`),
  };
}

export interface OpcoesChamada {
  /** Identifica a chamada para escolher modelo por env. */
  tarefa: string;
  /** Regras do domínio. Prefixo estável. */
  system: string;
  /** Bloco grande e fixo (o catálogo). Recebe o breakpoint de cache. */
  systemCacheavel?: string;
  userPrompt: string;
  /** JSON Schema. Sem minimum/maximum/minLength — não são suportados. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  esforco?: Esforco;
  /**
   * Instante (epoch ms) em que a requisição inteira precisa ter desistido
   * da IA — ver `PRAZO` abaixo. Sem isto, cada chamada usa o timeout
   * padrão por conta própria e a soma estoura o wall clock.
   */
  prazoFinal?: number;
}

export interface UsoTokens {
  entrada: number;
  saida: number;
  cacheEscrito: number;
  cacheLido: number;
}

export interface ResultadoChamada<T> {
  dados: T;
  usoTokens: UsoTokens;
  provedorUsado: Provedor;
  modeloUsado: string;
}

export class RecusaDoModelo extends Error {
  constructor(public categoria: string | null) {
    super(`o modelo recusou a solicitação (categoria: ${categoria ?? "n/d"})`);
    this.name = "RecusaDoModelo";
  }
}

/**
 * O provedor não respondeu — host fora do ar, timeout, 5xx, rate limit.
 *
 * Distinto de erro de GERAÇÃO de propósito. Quem chama trata os dois de
 * formas opostas:
 *
 *   geração ruim   → cai no template. Melhor um plano genérico que nenhum.
 *   indisponível   → NÃO cai no template. Devolve 503 e pede pra tentar
 *                    de novo, porque o plano bom ainda existe do outro
 *                    lado — só não deu pra buscar agora. Salvar um
 *                    template aqui condena a pessoa a um plano pior
 *                    por causa de um reboot.
 *
 * Importa mais com endpoint auto-hospedado (OmniRoute), onde ficar fora
 * do ar é rotina, não exceção.
 */
export class ProvedorIndisponivel extends Error {
  constructor(public detalhe: string, public status?: number) {
    super(`provedor de IA indisponível: ${detalhe}`);
    this.name = "ProvedorIndisponivel";
  }
}

/* ---------------------------------------------------------------------
   Prazo — por que existe

   A Edge Function é morta pelo runtime ao bater o wall clock (150s no
   plano free). Quando isso acontece não há resposta nenhuma: o cliente
   recebe "Edge Function returned a non-2xx status code", sem corpo, sem
   motivo. Nem o 503 de provedor indisponível nem o template de fallback
   chegam a rodar — o processo já morreu.

   Foi exatamente o que aconteceu em produção em 2026-08-13: o Gemini
   devolveu 503 aos ~72s, o fallback de provedor começou com 120s
   próprios (72 + 120 = 192s) e o runtime matou a função aos 150s.

   O timeout por chamada não resolve isso porque ele não sabe quantas
   chamadas vieram antes. O prazo é da REQUISIÇÃO: cada tentativa recebe
   o que sobrou, e quem não cabe no que sobrou não chega a começar.
   --------------------------------------------------------------------- */

/** Teto de uma chamada isolada, quando não há prazo da requisição. */
const TIMEOUT_PADRAO_MS = 120_000;

/**
 * Abaixo disto não vale começar uma chamada: um modelo lento não devolve
 * um plano completo em 15s, e a tentativa só consome o tempo que faltava
 * para responder direito.
 */
const MINIMO_UTIL_MS = 15_000;

/** Quanto resta do prazo, ou o teto padrão quando não há prazo. */
function msDisponiveis(prazoFinal?: number): number {
  if (prazoFinal === undefined) return TIMEOUT_PADRAO_MS;
  return Math.min(TIMEOUT_PADRAO_MS, prazoFinal - Date.now());
}

/**
 * Fatia máxima do prazo que o provedor PRIMÁRIO pode consumir quando
 * existe reserva configurada.
 *
 * Sem este teto a reserva é decorativa: em produção o primário levou 72s
 * para devolver 503, e o que sobrava não dava para gerar um plano
 * completo. Cortar o primário mais cedo troca "espera o primeiro até o
 * fim e a reserva não roda" por "os dois têm chance de responder".
 *
 * Não se aplica quando não há reserva — aí o primário pode usar tudo,
 * porque não existe segundo a quem ceder tempo.
 *
 * Ajustável por env (`LLM_FATIA_PRIMARIO`) porque o número certo depende
 * de quanto o primário demora para falhar e de quanto a reserva precisa
 * para gerar. Com um primário que cai rápido, vale subir; com uma reserva
 * lenta e um primário instável, vale descer.
 */
const FATIA_DO_PRIMARIO = Number(Deno.env.get("LLM_FATIA_PRIMARIO") ?? 0.55);

const ESFORCOS_VALIDOS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Esforço de raciocínio, com override por env
 * (`LLM_<TAREFA>_ESFORCO`). O valor no código é a intenção do produto —
 * `xhigh` no montar-treino porque é a decisão mais importante do fluxo —
 * mas o teto real é o wall clock: num provedor lento, esforço alto é o
 * que faz estourar o prazo e não entregar plano nenhum. Poder baixar sem
 * redeploy é o que permite trocar qualidade por entrega quando o
 * provedor do dia é lento.
 */
function esforcoDaTarefa(tarefa: string, padrao?: Esforco): Esforco | undefined {
  const bruto = Deno.env.get(`LLM_${tarefa.toUpperCase().replace(/-/g, "_")}_ESFORCO`);
  if (!bruto) return padrao;
  if (!ESFORCOS_VALIDOS.includes(bruto)) {
    console.warn(`esforço inválido para ${tarefa}: "${bruto}" — usando ${padrao ?? "o padrão"}`);
    return padrao;
  }
  return bruto as Esforco;
}

export async function chamarComSchema<T>(
  opcoes: OpcoesChamada,
): Promise<ResultadoChamada<T>> {
  const cfg = configDaTarefa(opcoes.tarefa);
  const temReserva = configFallbackDaTarefa(opcoes.tarefa) !== null;
  opcoes = { ...opcoes, esforco: esforcoDaTarefa(opcoes.tarefa, opcoes.esforco) };

  // Só encurta quando há prazo E reserva: sem um dos dois, o primário
  // continua com o prazo cheio.
  const opcoesPrimario =
    temReserva && opcoes.prazoFinal !== undefined
      ? {
          ...opcoes,
          prazoFinal: Date.now() +
            Math.round((opcoes.prazoFinal - Date.now()) * FATIA_DO_PRIMARIO),
        }
      : opcoes;

  try {
    const resultado = await chamarProvedor<T>(opcoesPrimario, cfg);
    return { ...resultado, provedorUsado: cfg.provedor, modeloUsado: cfg.modelo };
  } catch (e) {
    // Só troca de provedor quando o primeiro está fora do ar (rede, 5xx,
    // 429, timeout) — erro de GERAÇÃO não vira fallback de provedor, vira
    // retry de prompt (gerarComValidacao) ou template, como já era.
    if (!(e instanceof ProvedorIndisponivel)) throw e;

    const reserva = configFallbackDaTarefa(opcoes.tarefa);
    if (!reserva) throw e;

    // Não começar o que não dá tempo de terminar. Sem esta guarda o
    // fallback de provedor é justamente o que estoura o wall clock:
    // o primeiro já gastou a maior parte do prazo antes de falhar.
    const sobra = msDisponiveis(opcoes.prazoFinal);
    if (sobra < MINIMO_UTIL_MS) {
      throw new ProvedorIndisponivel(
        `${e.detalhe}; sem tempo para tentar ${reserva.modelo} ` +
          `(restavam ${Math.max(0, Math.round(sobra / 1000))}s do prazo)`,
        e.status,
      );
    }

    console.warn(
      `${opcoes.tarefa}: ${cfg.modelo} indisponível (${e.detalhe}) — tentando ${reserva.modelo} ` +
        `com ${Math.round(sobra / 1000)}s restantes`,
    );

    const resultado = await chamarProvedor<T>(opcoes, reserva);
    return { ...resultado, provedorUsado: reserva.provedor, modeloUsado: reserva.modelo };
  }
}

function chamarProvedor<T>(
  opcoes: OpcoesChamada,
  cfg: ConfigProvedor,
): Promise<{ dados: T; usoTokens: UsoTokens }> {
  return cfg.provedor === "anthropic"
    ? viaAnthropic<T>(opcoes, cfg)
    : viaOpenAICompat<T>(opcoes, cfg);
}

// ---------------------------------------------------------------------------
// Caminho Anthropic — schema garantido pela API, cache de prefixo no catálogo
// ---------------------------------------------------------------------------
async function viaAnthropic<T>(
  o: OpcoesChamada,
  cfg: ConfigProvedor,
): Promise<{ dados: T; usoTokens: UsoTokens }> {
  // O SDK tem retry e timeout próprios; sem amarrá-los ao prazo da
  // requisição, ele reagenda por conta e estoura o wall clock igual.
  const limite = msDisponiveis(o.prazoFinal);
  if (limite <= 0) {
    throw new ProvedorIndisponivel(
      `o prazo da requisição acabou antes de chamar ${cfg.modelo}`,
    );
  }
  const cliente = new Anthropic({ apiKey: cfg.apiKey, timeout: limite, maxRetries: 1 });

  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: o.system }];
  if (o.systemCacheavel) {
    system.push({
      type: "text",
      text: o.systemCacheavel,
      // Breakpoint no último bloco estável: cacheia regras + catálogo juntos.
      cache_control: { type: "ephemeral" },
    });
  }

  const r = await cliente.messages.create({
    model: cfg.modelo,
    max_tokens: o.maxTokens ?? 16000,
    system,
    messages: [{ role: "user", content: o.userPrompt }],
    output_config: {
      effort: o.esforco ?? "high",
      format: { type: "json_schema", schema: o.schema },
    },
    // Sem `temperature`: removido nesta geração, devolve 400.
  });

  if (r.stop_reason === "refusal") {
    throw new RecusaDoModelo(r.stop_details?.category ?? null);
  }
  if (r.stop_reason === "max_tokens") {
    throw new Error("resposta truncada por max_tokens — aumente maxTokens");
  }

  const bloco = r.content.find((b) => b.type === "text");
  if (!bloco || bloco.type !== "text") {
    throw new Error("a resposta não trouxe bloco de texto");
  }

  return {
    dados: JSON.parse(bloco.text) as T,
    usoTokens: {
      entrada: r.usage.input_tokens,
      saida: r.usage.output_tokens,
      cacheEscrito: r.usage.cache_creation_input_tokens ?? 0,
      cacheLido: r.usage.cache_read_input_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Caminho compatível com OpenAI — OpenRouter, OmniRoute, Together, local
// ---------------------------------------------------------------------------
async function viaOpenAICompat<T>(
  o: OpcoesChamada,
  cfg: ConfigProvedor,
): Promise<{ dados: T; usoTokens: UsoTokens }> {
  if (!cfg.baseUrl) throw new Error("LLM_BASE_URL não configurada");

  // Aqui system e catálogo viram UMA mensagem só: o padrão OpenAI não tem
  // breakpoint de cache explícito. Quem cacheia (ou não) é o provedor.
  const systemBase = o.systemCacheavel
    ? `${o.system}\n\n${o.systemCacheavel}`
    : o.system;

  // Instrução de JSON em prosa. Só entra quando o provedor NÃO aceita
  // response_format — nos que aceitam, repetir a regra em texto é ruído
  // que o modelo tem que reconciliar com o schema.
  const instrucaoJson =
    `\n\nResponda com um único objeto JSON válido que obedeça exatamente a este JSON Schema. ` +
    `Sem markdown, sem cercas de código, sem texto antes ou depois.\n` +
    `SCHEMA:\n${JSON.stringify(o.schema)}`;

  // Uma tentativa com response_format; se o provedor não conhecer o
  // parâmetro, repete sem ele e com a instrução em prosa.
  //
  // Isso importa porque o OmniRoute agrega 43 pools de capacidade
  // desigual: parte aceita json_schema, parte ignora, parte rejeita com
  // 400. Sem essa degradação, um provedor mais fraco na cascata derruba
  // a geração inteira.
  let json: Record<string, unknown> | undefined;
  let usouSchemaNativo = true;

  // `reasoning_effort` usa o MESMO vocabulário do nosso `esforco`
  // (low/medium/high/xhigh) na x.ai e no endpoint compatível do Gemini.
  // Sem enviá-lo, o modelo assume o padrão dele — que na x.ai é `high`,
  // ou seja, raciocínio longo que ninguém pediu, gasto do prazo à toa.
  //
  // "max" não existe lá: é valor só do caminho Anthropic, então vira o
  // teto que o outro lado conhece.
  const esforcoCompat = o.esforco === "max" ? "xhigh" : o.esforco;
  let comEsforco = esforcoCompat !== undefined;
  let comSchema = true;

  // Até três tentativas porque há DOIS parâmetros opcionais que um
  // provedor pode rejeitar, e eles se largam de forma independente: uma
  // lista fixa `[true, false]` faria dropar o esforço custar o schema
  // junto, que é a garantia mais cara de perder.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const corpo: Record<string, unknown> = {
      model: cfg.modelo,
      max_tokens: o.maxTokens ?? 16000,
      messages: [
        { role: "system", content: comSchema ? systemBase : systemBase + instrucaoJson },
        { role: "user", content: o.userPrompt },
      ],
    };
    if (comSchema) {
      corpo.response_format = {
        type: "json_schema",
        json_schema: {
          name: o.tarefa.replace(/-/g, "_"),
          strict: true,
          schema: o.schema,
        },
      };
    }
    if (comEsforco) corpo.reasoning_effort = esforcoCompat;

    const r = await postar(cfg, o.prazoFinal, corpo);

    if (r.ok) {
      json = r.json;
      usouSchemaNativo = comSchema;
      break;
    }

    // Queixa sobre o esforço vem antes da do schema: dropar só o
    // `reasoning_effort` preserva a garantia de formato, enquanto cair
    // para a instrução em prosa a perde. Sem esta separação, um provedor
    // que só desconhece o esforço perderia o schema nativo junto.
    if (comEsforco && /reasoning_effort|reasoning|effort/i.test(r.corpo)) {
      console.warn(`${cfg.modelo} não aceita reasoning_effort — repetindo sem ele`);
      comEsforco = false;
      continue;
    }

    // Só vale tentar de novo sem schema se a queixa foi sobre o schema.
    const reclamouDoSchema =
      /response_format|json_schema|structured|schema|not support/i.test(r.corpo);
    if (comSchema && reclamouDoSchema) {
      console.warn(
        `${cfg.modelo} não aceita response_format — repetindo com instrução em prosa`,
      );
      comSchema = false;
      continue;
    }

    // 429/413 = limite de taxa ou de tamanho (TPM etc) — capacidade, não
    // geração ruim. O outro provedor pode aguentar o mesmo pedido numa
    // cota diferente, então é exatamente o caso do fallback de provedor.
    if (r.status >= 500 || r.status === 429 || r.status === 413) {
      throw new ProvedorIndisponivel(
        `${cfg.baseUrl} devolveu ${r.status}: ${r.corpo.slice(0, 200)}`,
        r.status,
      );
    }
    throw new Error(`${cfg.baseUrl} devolveu ${r.status}: ${r.corpo.slice(0, 400)}`);
  }

  if (!json) throw new Error("nenhuma resposta utilizável do provedor");

  const escolha = (json.choices as Array<Record<string, never>> | undefined)?.[0] as
    | { finish_reason?: string; message?: { content?: string } }
    | undefined;

  if (escolha?.finish_reason === "content_filter") {
    throw new RecusaDoModelo("content_filter");
  }
  if (escolha?.finish_reason === "length") {
    throw new Error("resposta truncada por max_tokens — aumente maxTokens");
  }

  const texto = escolha?.message?.content;
  if (typeof texto !== "string" || texto.length === 0) {
    throw new Error(
      `a resposta não trouxe conteúdo de texto (finish_reason=${escolha?.finish_reason ?? "?"})`,
    );
  }

  const uso = json.usage as
    | { prompt_tokens?: number; completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number } }
    | undefined;

  let dados: T;
  try {
    dados = extrairJson<T>(texto);
  } catch {
    // Reparo: devolve o texto quebrado e pede só o JSON de volta.
    // É o caso comum em modelo free — prosa antes do objeto, cerca de
    // markdown, vírgula sobrando. Uma tentativa; se falhar, desiste.
    console.warn(`${cfg.modelo} devolveu JSON inválido — tentando reparar`);

    const r = await postar(cfg, o.prazoFinal, {
      model: cfg.modelo,
      max_tokens: o.maxTokens ?? 16000,
      messages: [
        {
          role: "system",
          content:
            "Você corrige JSON malformado. Devolva APENAS o objeto JSON válido, " +
            "sem markdown e sem comentário. Não invente dados: preserve o conteúdo original.",
        },
        { role: "user", content: `Corrija para casar com este schema:\n${JSON.stringify(o.schema)}\n\nJSON quebrado:\n${texto}` },
      ],
    });

    if (!r.ok) {
      throw new Error(
        `${cfg.modelo} não devolveu JSON válido e o reparo falhou (${r.status})`,
      );
    }

    const reparado = (r.json.choices as Array<{ message?: { content?: string } }>)?.[0]
      ?.message?.content;
    if (typeof reparado !== "string") {
      throw new Error(`${cfg.modelo} não devolveu JSON válido e o reparo veio vazio`);
    }

    try {
      dados = extrairJson<T>(reparado);
    } catch {
      throw new Error(
        `${cfg.modelo} não devolveu JSON válido nem após reparo ` +
          `(finish_reason=${escolha?.finish_reason ?? "?"}, ${texto.length} caractere(s)). ` +
          `Este provedor provavelmente não serve para "${o.tarefa}". Trecho: ${texto.slice(0, 200) || "(vazio)"}`,
      );
    }
  }

  if (!usouSchemaNativo) {
    console.warn(
      `${o.tarefa}: ${cfg.modelo} rodou SEM schema nativo — a validação de domínio é a única rede aqui`,
    );
  }

  return {
    dados,
    usoTokens: {
      entrada: uso?.prompt_tokens ?? 0,
      saida: uso?.completion_tokens ?? 0,
      cacheEscrito: 0,
      cacheLido: uso?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

/**
 * POST único, limitado pelo que resta do prazo da requisição.
 * Erro de rede vira ProvedorIndisponivel.
 */
async function postar(
  cfg: ConfigProvedor,
  prazoFinal: number | undefined,
  corpo: Record<string, unknown>,
): Promise<
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; status: number; corpo: string }
> {
  const limite = msDisponiveis(prazoFinal);
  if (limite <= 0) {
    throw new ProvedorIndisponivel(
      `o prazo da requisição acabou antes de chamar ${cfg.modelo}`,
    );
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), limite);

  let resposta: Response;
  try {
    resposta = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controle.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        // OpenRouter usa estes dois para atribuição; endpoints que não
        // conhecem simplesmente ignoram.
        "HTTP-Referer": Deno.env.get("ORIGENS_PERMITIDAS")?.split(",")[0] ?? "",
        "X-Title": "App Estudo + Treino",
      },
      // stream:false explícito — sem isto, ao menos um pool do agregador
      // (visto em produção) manda SSE de qualquer jeito. reconstruirDeSSE
      // abaixo é a rede de segurança para quem ignorar mesmo assim.
      body: JSON.stringify({ ...corpo, stream: false }),
    });
  } catch (e) {
    // DNS, conexão recusada, host fora do ar, timeout. Nada disso é culpa
    // da geração — o plano bom existe, só não deu pra buscar.
    throw new ProvedorIndisponivel(
      e instanceof Error && e.name === "AbortError"
        ? `${cfg.baseUrl} não respondeu em ${Math.round(limite / 1000)}s`
        : `não foi possível alcançar ${cfg.baseUrl} (${e instanceof Error ? e.message : e})`,
    );
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    return { ok: false, status: resposta.status, corpo: await resposta.text() };
  }

  const bruto = await resposta.text();
  try {
    return { ok: true, json: interpretarCorpoChat(bruto) };
  } catch (e) {
    // Respondeu 200, mas o corpo não é JSON nem SSE reconhecível. O
    // provedor está no ar — isto é erro de GERAÇÃO, não indisponibilidade;
    // não é ProvedorIndisponivel, então cai no template como qualquer
    // outra saída malformada, em vez de virar 503 indevido.
    throw new Error(
      `${cfg.baseUrl} devolveu 200 com corpo ilegível: ` +
        `${e instanceof Error ? e.message : String(e)}. Trecho: ${bruto.slice(0, 200)}`,
    );
  }
}

/** JSON direto, ou SSE reconstruído — ver interpretarCorpoChat. */
function interpretarCorpoChat(bruto: string): Record<string, unknown> {
  const texto = bruto.trim();
  if (texto.startsWith("data:") || texto.startsWith("event:")) {
    return reconstruirDeSSE(texto);
  }
  return JSON.parse(texto);
}

/**
 * Alguns pools do agregador ignoram `stream:false` e mandam Server-Sent
 * Events mesmo assim. Reconstrói o formato não-streaming (mesma forma que
 * o resto do código já espera) juntando os deltas — assim quem chama não
 * precisa saber que isto aconteceu.
 */
function reconstruirDeSSE(corpoTexto: string): Record<string, unknown> {
  const conteudoPorIndice = new Map<number, string>();
  const finishReasonPorIndice = new Map<number, string>();
  let usage: unknown;
  let modelo: unknown;
  let id: unknown;

  for (const linhaBruta of corpoTexto.split("\n")) {
    const linha = linhaBruta.trim();
    if (!linha.startsWith("data:")) continue;
    const dado = linha.slice(5).trim();
    if (dado === "" || dado === "[DONE]") continue;

    let pedaco: Record<string, unknown>;
    try {
      pedaco = JSON.parse(dado);
    } catch {
      continue; // linha truncada — o resto do stream cobre o conteúdo
    }

    id ??= pedaco.id;
    modelo ??= pedaco.model;
    if (pedaco.usage) usage = pedaco.usage;

    const escolhas = pedaco.choices as
      | Array<{ index?: number; delta?: { content?: string }; finish_reason?: string | null }>
      | undefined;
    for (const c of escolhas ?? []) {
      const indice = c.index ?? 0;
      if (c.delta?.content) {
        conteudoPorIndice.set(indice, (conteudoPorIndice.get(indice) ?? "") + c.delta.content);
      }
      if (c.finish_reason) finishReasonPorIndice.set(indice, c.finish_reason);
    }
  }

  const indices = [...new Set([...conteudoPorIndice.keys(), ...finishReasonPorIndice.keys()])].sort(
    (a, b) => a - b,
  );

  return {
    id,
    model: modelo,
    usage,
    choices: indices.map((i) => ({
      index: i,
      message: { role: "assistant", content: conteudoPorIndice.get(i) ?? "" },
      finish_reason: finishReasonPorIndice.get(i) ?? null,
    })),
  };
}

/**
 * Extrai o objeto JSON de uma resposta que pode vir suja.
 *
 * Modelo sem schema nativo costuma embrulhar em ```json, escrever
 * "Aqui está o plano:" antes, ou comentar depois. Recortar do primeiro
 * `{` até o último `}` resolve os três casos sem regex frágil.
 */
function extrairJson<T>(texto: string): T {
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(limpo) as T;
  } catch {
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio === -1 || fim <= inicio) throw new Error("sem objeto JSON no texto");
    return JSON.parse(limpo.slice(inicio, fim + 1)) as T;
  }
}

/**
 * Gera → valida → se falhou, tenta UMA vez com os erros anexados.
 * Vale para os dois provedores.
 */
export async function gerarComValidacao<T>(
  opcoes: OpcoesChamada,
  validar: (dados: T) => { erros: string[]; avisos: string[] },
): Promise<{
  dados: T;
  avisos: string[];
  tentativas: number;
  usoTokens: UsoTokens;
  provedorUsado: Provedor;
  modeloUsado: string;
}> {
  const primeira = await chamarComSchema<T>(opcoes);
  const r1 = validar(primeira.dados);

  if (r1.erros.length === 0) {
    return { ...primeira, avisos: r1.avisos, tentativas: 1 };
  }

  const violacoes = [...r1.erros, ...r1.avisos];

  // Sem tempo para o retry, desiste como GERAÇÃO ruim e não como provedor
  // fora do ar: o modelo respondeu, só respondeu errado. A distinção troca
  // o que a pessoa recebe — template gravado (aqui) em vez de 503 sem
  // plano nenhum. Erro comum seria deixar o ProvedorIndisponivel de
  // `postar` subir daqui e virar 503 por falta de relógio.
  if (msDisponiveis(opcoes.prazoFinal) < MINIMO_UTIL_MS) {
    const e = new Error(
      "a geração violou as regras e não sobrou tempo no prazo para tentar de novo",
    );
    (e as Error & { violacoes?: string[] }).violacoes = r1.erros;
    throw e;
  }

  const segunda = await chamarComSchema<T>({
    ...opcoes,
    userPrompt:
      `${opcoes.userPrompt}\n\n` +
      `A resposta anterior violou as regras abaixo. Corrija TODAS e devolva o plano novamente.\n` +
      violacoes.map((v) => `- ${v}`).join("\n"),
  });

  const r2 = validar(segunda.dados);
  if (r2.erros.length > 0) {
    const e = new Error("a geração falhou na validação após o retry");
    (e as Error & { violacoes?: string[] }).violacoes = r2.erros;
    throw e;
  }

  return {
    ...segunda,
    avisos: r2.avisos,
    tentativas: 2,
    usoTokens: {
      entrada: primeira.usoTokens.entrada + segunda.usoTokens.entrada,
      saida: primeira.usoTokens.saida + segunda.usoTokens.saida,
      cacheEscrito: primeira.usoTokens.cacheEscrito + segunda.usoTokens.cacheEscrito,
      cacheLido: primeira.usoTokens.cacheLido + segunda.usoTokens.cacheLido,
    },
  };
}
