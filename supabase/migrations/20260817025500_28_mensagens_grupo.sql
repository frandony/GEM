-- Chat de verdade do grupo. Mesmo template de posts_grupo (migration 24):
-- RLS por grupo_id in (select private.grupos_do_usuario()), grants
-- explícitos porque auto_expose_new_tables está desligado de propósito
-- (ver CLAUDE.md), sem policy de UPDATE (sem edição de mensagem, mesma
-- doutrina do post). autor_id já nasce referenciando profiles(id) direto
-- (lição da migration 27) para o embed profiles(...) funcionar de cara.
create table public.mensagens_grupo (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references public.grupos(id) on delete cascade,
  autor_id   uuid not null references public.profiles(id) on delete cascade,
  texto      text not null check (char_length(texto) between 1 and 2000),
  criado_em  timestamptz not null default now()
);
create index mensagens_grupo_grupo_id_criado_em_idx
  on public.mensagens_grupo (grupo_id, criado_em desc);

alter table public.mensagens_grupo enable row level security;

create policy "mensagens: membro do grupo lê"
  on public.mensagens_grupo for select to authenticated
  using (grupo_id in (select private.grupos_do_usuario()));

create policy "mensagens: membro do grupo envia"
  on public.mensagens_grupo for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and grupo_id in (select private.grupos_do_usuario())
  );

create policy "mensagens: autor apaga a própria"
  on public.mensagens_grupo for delete to authenticated
  using (autor_id = (select auth.uid()));

grant select, insert, delete on public.mensagens_grupo to authenticated;
