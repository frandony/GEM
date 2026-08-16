-- Feed do grupo (Social) — primeira peça do documento de visão publicado
-- nesta sessão. Post pertence a UM grupo (grupo_id), então a checagem de
-- RLS certa é "grupo_id está entre os grupos de quem chama"
-- (private.grupos_do_usuario()), não private.pode_ver()/mesmo_grupo(),
-- que respondem "esse OUTRO usuário compartilha ALGUM grupo comigo" —
-- pergunta errada pra quem pode estar em mais de um grupo.

create type public.tag_post_grupo as enum ('treino', 'estudo', 'dica', 'refeição');

create table public.posts_grupo (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references public.grupos(id) on delete cascade,
  autor_id   uuid not null references auth.users(id) on delete cascade,
  -- Caminho no storage, não URL: o bucket posts-grupo é PRIVADO (foto de
  -- post não é pra qualquer um com o link, só pra quem tá no grupo) — a
  -- URL de verdade é assinada sob demanda, ver lib/feedGrupo.ts.
  foto_path  text not null,
  legenda    text,
  tag        public.tag_post_grupo not null,
  criado_em  timestamptz not null default now()
);
create index posts_grupo_grupo_id_criado_em_idx on public.posts_grupo (grupo_id, criado_em desc);

create table public.post_reacoes (
  post_id    uuid not null references public.posts_grupo(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Só os 4 emojis do documento de visão — reação simples, não vira
  -- campo livre.
  emoji      text not null check (emoji in ('🔥', '💪', '📚', '✅')),
  criado_em  timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.posts_grupo enable row level security;
alter table public.post_reacoes enable row level security;

create policy "posts: membro do grupo ve"
  on public.posts_grupo for select
  to authenticated
  using (grupo_id in (select private.grupos_do_usuario()));

create policy "posts: membro posta no proprio grupo"
  on public.posts_grupo for insert
  to authenticated
  with check (
    autor_id = (select auth.uid())
    and grupo_id in (select private.grupos_do_usuario())
  );

create policy "posts: autor exclui o proprio"
  on public.posts_grupo for delete
  to authenticated
  using (autor_id = (select auth.uid()));

create policy "reacoes: membro do grupo do post ve"
  on public.post_reacoes for select
  to authenticated
  using (
    exists (
      select 1 from public.posts_grupo p
      where p.id = post_reacoes.post_id
        and p.grupo_id in (select private.grupos_do_usuario())
    )
  );

create policy "reacoes: membro reage"
  on public.post_reacoes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.posts_grupo p
      where p.id = post_reacoes.post_id
        and p.grupo_id in (select private.grupos_do_usuario())
    )
  );

create policy "reacoes: dono atualiza a propria"
  on public.post_reacoes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "reacoes: dono remove a propria"
  on public.post_reacoes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- auto_expose_new_tables está desligado neste projeto — sem GRANT
-- explícito a Data API nega mesmo com policy certa (ver CLAUDE.md).
grant select, insert, delete on public.posts_grupo to authenticated;
grant select, insert, update, delete on public.post_reacoes to authenticated;

-- Bucket privado (diferente do avatares, que é público): foto de post é
-- só pra quem tá no grupo. Caminho {grupo_id}/{autor_id}/{post_id} —
-- padrão por PASTA que resolveu o bug de RLS do upload de avatar nesta
-- mesma sessão, reaproveitado de propósito.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts-grupo', 'posts-grupo', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "posts-grupo: membro do grupo ve as fotos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'posts-grupo'
    and (storage.foldername(name))[1]::uuid in (select private.grupos_do_usuario())
  );

create policy "posts-grupo: autor envia no proprio grupo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'posts-grupo'
    and (storage.foldername(name))[1]::uuid in (select private.grupos_do_usuario())
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "posts-grupo: autor remove a propria foto"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'posts-grupo'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
