-- =====================================================================
-- 08 — Streak, semana off e revisão semanal
-- =====================================================================
-- Semana = segunda a domingo, o mesmo ciclo da revisão semanal.
-- Streak é DERIVADO, nunca contador armazenado: recalcular evita estado
-- inconsistente (ver 11_rpc_dominio.sql).
-- =====================================================================

create function public.inicio_da_semana(d date)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (date_trunc('week', d::timestamp))::date
$$;

comment on function public.inicio_da_semana is
  'Segunda-feira da semana de `d`. date_trunc(week) é ISO: começa na segunda.';

-- Semestre FIXO: janeiro e julho, contado pelo dia de INÍCIO da semana.
create function public.inicio_do_semestre(d date)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select make_date(
    extract(year from d)::int,
    case when extract(month from d) <= 6 then 1 else 7 end,
    1
  )
$$;


-- ---------------------------------------------------------------------
-- Semana off cobre o PREVISÍVEL (viagem, semana de prova).
-- Vida cobre o IMPREVISTO (gripe na quarta). São coisas diferentes.
--
-- Regras aplicadas em 11_rpc_dominio.sql, não aqui:
--   * declarada até o domingo anterior — sem antecedência, toda semana
--     vira off retroativamente e o streak perde o sentido
--   * máx 6 por semestre
-- ---------------------------------------------------------------------
create table public.semanas_off (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  semana_inicio date not null check (extract(isodow from semana_inicio) = 1),
  declarada_em  timestamptz not null default now(),
  primary key (user_id, semana_inicio)
);


-- ---------------------------------------------------------------------
-- Uma linha por usuário por semana. É a base do streak e dos "números
-- da semana" da home — uma query simples cobre 80% do valor que um
-- gráfico daria no mês 6.
-- ---------------------------------------------------------------------
create table public.semanas_resumo (
  user_id           uuid not null references public.profiles(id) on delete cascade,
  semana_inicio     date not null check (extract(isodow from semana_inicio) = 1),

  meta_treinos      smallint not null default 0,   -- frequência escolhida no onboarding
  treinos_feitos    smallint not null default 0,
  blocos_feitos     smallint not null default 0,
  blocos_planejados smallint not null default 0,
  minutos_estudo    int      not null default 0,

  usou_vida         boolean not null default false,
  off               boolean not null default false,
  contou_streak     boolean not null default false,

  atualizado_em     timestamptz not null default now(),
  primary key (user_id, semana_inicio)
);

comment on table public.semanas_resumo is
  'Streak é derivado daqui (sequência de contou_streak). Semana off CONGELA: não zera, não avança, não consome vida.';

-- Ordem desc: o streak lê de trás pra frente e para no primeiro furo.
create index semanas_resumo_user_semana_idx
  on public.semanas_resumo (user_id, semana_inicio desc);


-- ---------------------------------------------------------------------
-- 4 vidas por mês, renovam no dia 1. PRIVADAS: streak é conquista,
-- vida é vulnerabilidade.
-- ---------------------------------------------------------------------
create table public.vidas_mes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mes_ref date not null check (extract(day from mes_ref) = 1),
  usadas  smallint not null default 0 check (usadas between 0 and 4),
  primary key (user_id, mes_ref)
);


-- ---------------------------------------------------------------------
-- Revisão semanal. Entra na v1 não porque alguém usa o dado agora, mas
-- porque semana não coletada é semana perdida pra sempre.
-- ---------------------------------------------------------------------
create table public.revisoes_semanais (
  id            uuid primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  semana_inicio date not null check (extract(isodow from semana_inicio) = 1),

  energia       smallint check (energia between 1 and 5),

  -- Opções FIXAS (enum), não texto livre. Texto livre puro vira 6 meses
  -- de frase solta pra IA interpretar; enum vira série temporal limpa.
  atrapalhou    motivo_atrapalho[] not null default '{}',
  observacao    text,               -- campo livre OPCIONAL, complementa o enum
  ajuste        text,               -- "o que quer ajustar?" — opcional

  -- Pular também é dado. A linha existe mesmo pulada.
  pulada        boolean not null default false,
  compartilhada boolean not null default false,  -- privada por padrão

  respondida_em timestamptz not null default now(),
  unique (user_id, semana_inicio)
);

create index revisoes_semanais_user_idx
  on public.revisoes_semanais (user_id, semana_inicio desc);
