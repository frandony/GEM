-- =====================================================================
-- 09 — Feed (painel, não timeline)
-- =====================================================================
-- Timeline de 2 pessoas fica esparsa. Painel — os dois lado a lado,
-- estado atual — sempre parece cheio.
-- Resumo DIÁRIO por pessoa, não evento a evento.
-- =====================================================================

create table public.resumos_diarios (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  data           date not null,

  treinou        boolean  not null default false,
  sessao_letra   text,
  series_total   smallint not null default 0,

  blocos_feitos  smallint not null default 0,
  minutos_estudo int      not null default 0,

  atualizado_em  timestamptz not null default now(),
  primary key (user_id, data)
);

comment on table public.resumos_diarios is
  'Agregado mantido por trigger (12_triggers_agregados.sql). O feed lê daqui, nunca varre series_registros.';

-- O painel busca "os últimos N dias das pessoas do meu grupo".
create index resumos_diarios_data_idx on public.resumos_diarios (data desc);


-- Reação simples no resumo do dia do outro. Sem comentário na v1.
create table public.reacoes_resumo (
  user_id      uuid not null references public.profiles(id) on delete cascade, -- quem reagiu
  alvo_user_id uuid not null references public.profiles(id) on delete cascade, -- de quem é o dia
  data         date not null,
  criada_em    timestamptz not null default now(),
  primary key (user_id, alvo_user_id, data),

  constraint ck_nao_reage_a_si check (user_id <> alvo_user_id)
);

-- "Quantas reações o meu dia recebeu?" — o lado que a tela realmente lê.
create index reacoes_resumo_alvo_idx on public.reacoes_resumo (alvo_user_id, data desc);
