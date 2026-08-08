-- =====================================================================
-- 01 — Extensões e schemas
-- =====================================================================
-- `private` guarda os helpers de RLS. Não está em [api].schemas do
-- config.toml, então PostgREST não expõe nada daqui. É o que permite
-- usar SECURITY DEFINER sem criar endpoint público por acidente.
-- =====================================================================

create schema if not exists private;

-- Só o dono/service_role enxerga o schema. `authenticated` recebe USAGE
-- porque expressões de policy são avaliadas com os privilégios de quem
-- roda a query — sem USAGE + EXECUTE a policy falha em tempo de query.
-- Não é furo: PostgREST só expõe os schemas listados em [api].schemas.
grant usage on schema private to authenticated, service_role;
revoke all on schema private from anon;

-- pgcrypto não entra: gen_random_uuid() é core desde o Postgres 13 e
-- este projeto roda 17. Menos extensão, menos superfície.
--
-- pg_cron e pg_net criam os próprios schemas (`cron` e `net`). Não
-- passar `with schema` de propósito — forçar outro schema quebra as
-- funções internas das duas.
create extension if not exists pg_cron;
create extension if not exists pg_net;

comment on schema private is
  'Helpers de RLS e lógica interna. Nunca exposto na Data API.';
