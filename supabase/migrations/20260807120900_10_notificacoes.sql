-- =====================================================================
-- 10 — Notificações (Web Push)
-- =====================================================================
-- Zero push por atividade individual do grupo — o feed é consultado, não
-- persegue. Push só para: lembrete de treino, fim de bloco de estudo,
-- revisão semanal. Todos toleram erro de dezenas de segundos.
--
-- O uso como TIMER DE DESCANSO é hipótese a validar (01_teste_opcao_1).
-- O schema suporta os dois casos; o produto decide depois do teste.
-- =====================================================================

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,

  -- Diagnóstico do teste da Opção 1 e do suporte a dois níveis de
  -- capacidade (iPhone x Android). Detecção de RECURSO, nunca de sistema.
  user_agent    text,
  suporta_vibracao boolean,

  ultima_falha_em  timestamptz,
  falhas_seguidas  smallint not null default 0,

  criada_em     timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'A inscrição se perde (reinstalação, limpeza do Safari). Revalidar a cada abertura do app e reinscrever.';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);


create table public.notificacoes_agendadas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,

  disparar_em timestamptz not null,
  tipo        text not null,      -- 'lembrete_treino' | 'fim_bloco' | 'revisao_semanal' | 'descanso'
  titulo      text not null,
  corpo       text,

  -- Notificação com a mesma tag SUBSTITUI a anterior no aparelho.
  -- É o que impede o efeito "5 lembretes empilhados" depois de um
  -- período offline.
  tag         text,

  -- TTL curto de propósito: aviso atrasado é pior que aviso nenhum.
  ttl_seg     int not null default 300 check (ttl_seg between 0 and 86400),

  status      status_notif not null default 'pendente',
  enviada_em  timestamptz,
  erro        text,
  tentativas  smallint not null default 0,

  criada_em   timestamptz not null default now()
);

-- O pg_cron de 1 minuto varre EXATAMENTE este índice. Parcial: a fila
-- pendente é minúscula perto do histórico de enviadas.
create index notificacoes_pendentes_idx
  on public.notificacoes_agendadas (disparar_em)
  where status = 'pendente';

create index notificacoes_user_idx
  on public.notificacoes_agendadas (user_id, criada_em desc);

-- Cancelar = update para 'cancelada'. A janela de risco é o intervalo
-- do cron: uma notificação cancelada dentro do minuto corrente pode
-- escapar. Aceitável para lembrete; é justamente o que reprova push
-- como timer de descanso se o teste da Opção 1 falhar.
