// CORS — o PWA chama as funções direto do browser.
const ORIGENS_PERMITIDAS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function corsHeaders(origem: string | null): Record<string, string> {
  // Sem lista configurada (dev local), libera. Em produção, ORIGENS_PERMITIDAS
  // deve conter a URL da Vercel — senão qualquer site chama a função com o
  // token do usuário logado.
  const permitida =
    ORIGENS_PERMITIDAS.length === 0
      ? (origem ?? "*")
      : origem && ORIGENS_PERMITIDAS.includes(origem)
        ? origem
        : ORIGENS_PERMITIDAS[0];

  return {
    "Access-Control-Allow-Origin": permitida,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function respostaOptions(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export function json(req: Request, corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...corsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    },
  });
}

export function erro(
  req: Request,
  mensagem: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return json(req, { erro: mensagem, ...extra }, status);
}
