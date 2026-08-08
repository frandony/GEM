-- =====================================================================
-- 03 — Perfil e grupo
-- =====================================================================
-- `profiles` é a raiz de tudo: todo dado do usuário pendura aqui, não em
-- auth.users direto. Assim o app nunca lê o schema `auth` fora do login.
-- =====================================================================

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null check (length(trim(nome)) between 1 and 60),
  foto_url   text,
  timezone   text not null default 'America/Sao_Paulo',
  -- Camada 1 do onboarding: "o que quer usar". Aba de módulo não
  -- configurado fica oculta na navegação.
  usa_treino boolean not null default false,
  usa_estudo boolean not null default false,
  criado_em  timestamptz not null default now()
);

comment on column public.profiles.timezone is
  'Fuso do usuário. Toda coluna `date` do app é calendário NESTE fuso; timestamptz é instante.';


-- ---------------------------------------------------------------------
-- Cria o perfil junto com o usuário. Sem isso o app tem uma janela em
-- que auth.users existe e profiles não — e todo FK quebra nela.
-- ---------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nome'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- ---------------------------------------------------------------------
-- Grupo fechado por convite. Um só na v1; a estrutura suporta o terceiro.
-- ---------------------------------------------------------------------
create table public.grupos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 1 and 60),
  criado_por     uuid not null references public.profiles(id) on delete cascade,
  codigo_convite text not null unique
                   check (codigo_convite ~ '^[A-Z0-9]{6}$'),
  criado_em      timestamptz not null default now()
);

create index grupos_criado_por_idx on public.grupos (criado_por);

create table public.grupo_membros (
  grupo_id  uuid not null references public.grupos(id)   on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  entrou_em timestamptz not null default now(),
  primary key (grupo_id, user_id)
);

-- FK invertida da PK: sem isto, "quais grupos eu participo?" faz seq scan.
create index grupo_membros_user_idx on public.grupo_membros (user_id);


-- ---------------------------------------------------------------------
-- Helpers de grupo, em `private` porque precisam furar RLS.
--
-- Sem isto a policy de grupo_membros consulta grupo_membros e entra em
-- recursão infinita (erro 42P17). É a armadilha clássica de RLS em
-- tabela de associação — resolver aqui, uma vez.
-- ---------------------------------------------------------------------
create function private.grupos_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gm.grupo_id
  from public.grupo_membros gm
  where gm.user_id = (select auth.uid())
$$;

create function private.mesmo_grupo(outro uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grupo_membros gm
    where gm.user_id  = outro
      and gm.grupo_id in (select private.grupos_do_usuario())
  )
$$;

comment on function private.mesmo_grupo is
  'Os dois usuários compartilham grupo? SECURITY DEFINER para furar a RLS de grupo_membros e evitar recursão de policy.';

-- Visível para o dono OU para quem divide grupo com ele. Um predicado só,
-- usado por todas as policies de leitura compartilhada.
create function private.pode_ver(dono uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dono = (select auth.uid()) or private.mesmo_grupo(dono)
$$;
