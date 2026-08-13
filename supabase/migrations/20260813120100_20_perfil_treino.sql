-- =====================================================================
-- 20 — Perfil de treino (onboarding rico)
-- =====================================================================
-- Idade, sexo, peso/altura, lesões, condições de saúde, objetivo,
-- estilo de vida. Vive em tabela PRÓPRIA, não em `profiles`, porque
-- `profiles` é visível para quem divide grupo (private.pode_ver) — dado
-- de saúde não pode vazar pra colega de grupo. Segue o mesmo padrão de
-- privacidade de equipamentos_indisponiveis e semanas_resumo: dono, sempre.
-- =====================================================================

create type sexo_perfil           as enum ('feminino','masculino','outro');
create type experiencia_treino    as enum ('nenhuma','musculacao','crossfit','calistenia');
create type tempo_parado_treino   as enum ('ativo','ate_6_meses','mais_6_meses');
create type objetivo_treino       as enum
  ('hipertrofia','forca','emagrecimento','condicionamento','saude_geral','reabilitacao');
create type horario_treino        as enum ('manha','tarde','noite');
create type trabalho_perfil       as enum ('sedentario','ativo');
create type qualidade_perfil      as enum ('bom','regular','ruim');
create type nivel_perfil          as enum ('baixo','moderado','alto');
create type dieta_perfil          as enum ('deficit','manutencao','superavit');
create type lesao_treino          as enum ('coluna','joelho','ombro','punho');
create type condicao_saude_treino as enum ('hipertensao','hernia_discal');
create type acesso_equipamento    as enum
  ('academia_completa','academia_condominio','home_gym','sem_equipamento');

create table public.perfil_treino (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  idade              smallint check (idade between 13 and 100),
  sexo               sexo_perfil,
  peso_kg            numeric(5,2) check (peso_kg is null or peso_kg > 0),
  altura_cm          smallint     check (altura_cm is null or altura_cm > 0),
  nivel_declarado    nivel_exercicio not null default 'básico',
  ja_treinou         boolean not null default false,
  tempo_parado       tempo_parado_treino,
  experiencia        experiencia_treino not null default 'nenhuma',
  lesoes             lesao_treino[] not null default '{}',
  condicoes_saude    condicao_saude_treino[] not null default '{}',
  objetivo           objetivo_treino not null default 'hipertrofia',
  tempo_sessao_min   smallint check (tempo_sessao_min is null or tempo_sessao_min > 0),
  horario_preferido  horario_treino,
  acesso_equipamento acesso_equipamento not null default 'academia_completa',
  trabalho           trabalho_perfil,
  sono               qualidade_perfil,
  estresse           nivel_perfil,
  dieta              dieta_perfil,
  atualizado_em      timestamptz not null default now()
);

comment on table public.perfil_treino is
  'Dados pessoais/saúde do onboarding de treino. Privado ao dono — nunca visível ao grupo, ao contrário de profiles.';

alter table public.perfil_treino enable row level security;

create policy "perfil de treino: dono" on public.perfil_treino
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.perfil_treino to authenticated;
