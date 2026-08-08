import webpush from "npm:web-push@3.6.7";
import { clienteDeServico } from "../_shared/supabase.ts";

/**
 * Drena a fila de push. Chamada pelo pg_cron a cada minuto via pg_net.
 *
 * Não recebe payload: o cron chama uma vez e esta função busca as
 * notificações vencidas com service_role. Menos HTTP, e o retry fica num
 * lugar só.
 *
 * Autentica por `x-cron-secret`, não por JWT — quem chama é o banco, não um
 * usuário. Por isso `verify_jwt = false` no config.toml.
 */

const LOTE = 100;
const MAX_TENTATIVAS = 3;

interface Notificacao {
  id: string;
  user_id: string;
  tipo: string;
  titulo: string;
  corpo: string | null;
  tag: string | null;
  ttl_seg: number;
  tentativas: number;
}

interface Inscricao {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  falhas_seguidas: number;
}

Deno.serve(async (req: Request) => {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) {
    return new Response("não autorizado", { status: 401 });
  }

  const vapidPublica = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivada = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPublica || !vapidPrivada || !vapidSubject) {
    console.error("VAPID não configurado — nada a fazer");
    return Response.json({ enviadas: 0, motivo: "vapid_ausente" }, { status: 200 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublica, vapidPrivada);

  const supabase = clienteDeServico();

  const { data: fila, error } = await supabase
    .from("notificacoes_agendadas")
    .select("id,user_id,tipo,titulo,corpo,tag,ttl_seg,tentativas")
    .eq("status", "pendente")
    .lte("disparar_em", new Date().toISOString())
    .order("disparar_em")
    .limit(LOTE);

  if (error) {
    console.error("falha ao ler a fila:", error.message);
    return Response.json({ erro: error.message }, { status: 500 });
  }
  if (!fila?.length) return Response.json({ enviadas: 0 });

  // Uma query só para todas as inscrições envolvidas, em vez de uma por
  // notificação — é o mesmo N+1 que derrubaria o feed.
  const userIds = [...new Set(fila.map((n) => n.user_id))];
  const { data: inscricoes } = await supabase
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,falhas_seguidas")
    .in("user_id", userIds);

  const porUsuario = new Map<string, Inscricao[]>();
  for (const i of (inscricoes ?? []) as Inscricao[]) {
    porUsuario.set(i.user_id, [...(porUsuario.get(i.user_id) ?? []), i]);
  }

  let enviadas = 0;
  let falhas = 0;
  const inscricoesMortas: string[] = [];

  for (const n of fila as Notificacao[]) {
    const alvos = porUsuario.get(n.user_id) ?? [];

    if (alvos.length === 0) {
      // Sem inscrição não há como entregar. Marcar como expirada em vez de
      // deixar a linha girando na fila para sempre.
      await supabase
        .from("notificacoes_agendadas")
        .update({ status: "expirada", erro: "usuário sem inscrição de push" })
        .eq("id", n.id);
      continue;
    }

    const payload = JSON.stringify({
      titulo: n.titulo,
      corpo: n.corpo,
      tipo: n.tipo,
      // Mesma tag SUBSTITUI a notificação anterior no aparelho — é o que
      // impede "5 lembretes empilhados" depois de um período offline.
      tag: n.tag ?? n.tipo,
    });

    let algumaEntregou = false;

    for (const alvo of alvos) {
      try {
        await webpush.sendNotification(
          {
            endpoint: alvo.endpoint,
            keys: { p256dh: alvo.p256dh, auth: alvo.auth },
          },
          payload,
          // TTL curto de propósito: aviso atrasado é pior que aviso nenhum.
          { TTL: n.ttl_seg, urgency: n.tipo === "descanso" ? "high" : "normal" },
        );
        algumaEntregou = true;

        if (alvo.falhas_seguidas > 0) {
          await supabase
            .from("push_subscriptions")
            .update({ falhas_seguidas: 0, ultima_falha_em: null })
            .eq("id", alvo.id);
        }
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;

        // 404/410 = inscrição morta (app desinstalado, Safari limpou o
        // storage). Não é erro de entrega: é para apagar.
        if (status === 404 || status === 410) {
          inscricoesMortas.push(alvo.id);
        } else {
          await supabase
            .from("push_subscriptions")
            .update({
              falhas_seguidas: alvo.falhas_seguidas + 1,
              ultima_falha_em: new Date().toISOString(),
            })
            .eq("id", alvo.id);
          console.error(`push falhou (${status ?? "?"}) para ${alvo.id}`);
        }
      }
    }

    if (algumaEntregou) {
      await supabase
        .from("notificacoes_agendadas")
        .update({ status: "enviada", enviada_em: new Date().toISOString() })
        .eq("id", n.id);
      enviadas++;
    } else {
      const tentativas = n.tentativas + 1;
      await supabase
        .from("notificacoes_agendadas")
        .update(
          tentativas >= MAX_TENTATIVAS
            ? { status: "falhou", tentativas, erro: "todas as inscrições falharam" }
            : { tentativas },
        )
        .eq("id", n.id);
      falhas++;
    }
  }

  if (inscricoesMortas.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", inscricoesMortas);
  }

  return Response.json({
    processadas: fila.length,
    enviadas,
    falhas,
    inscricoes_removidas: inscricoesMortas.length,
  });
});
