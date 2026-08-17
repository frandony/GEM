-- Perfis viram publicamente legíveis: destrava busca de pessoas e perfil
-- público. profiles só tem id/nome/foto_url/timezone/usa_treino/usa_estudo
-- — nada sensível (dado de saúde já mora em perfil_treino, separado
-- exatamente por causa dessa exposição). Substitui a política antiga
-- (dono ou mesmo grupo), não empilha.
drop policy "perfil: dono ou grupo lê" on public.profiles;
create policy "perfil: qualquer autenticado lê" on public.profiles
  for select to authenticated using (true);

-- Seguir pessoas. Sem aprovação (conta pública) — bate com "todo mundo
-- pode ver". Grafo é público: qualquer autenticado vê quem segue quem.
create table public.seguidores (
  seguidor_id uuid not null references public.profiles(id) on delete cascade,
  seguido_id  uuid not null references public.profiles(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (seguidor_id, seguido_id),
  check (seguidor_id <> seguido_id)
);
alter table public.seguidores enable row level security;
create policy "seguidores: qualquer autenticado lê" on public.seguidores
  for select to authenticated using (true);
create policy "seguidores: eu sigo" on public.seguidores
  for insert to authenticated with check (seguidor_id = (select auth.uid()));
create policy "seguidores: eu deixo de seguir" on public.seguidores
  for delete to authenticated using (seguidor_id = (select auth.uid()));
grant select, insert, delete on public.seguidores to authenticated;

-- Posts do feed público. autor_id já referencia profiles(id) direto
-- (lição da migration 27 — embed profiles(...) só resolve assim). Foto
-- opcional (diferente de posts_grupo): "postar um pensamento" também vale.
create table public.posts_perfil (
  id         uuid primary key default gen_random_uuid(),
  autor_id   uuid not null references public.profiles(id) on delete cascade,
  foto_path  text,
  texto      text,
  criado_em  timestamptz not null default now(),
  constraint posts_perfil_tem_conteudo check (foto_path is not null or texto is not null)
);
create index posts_perfil_autor_id_criado_em_idx on public.posts_perfil (autor_id, criado_em desc);
alter table public.posts_perfil enable row level security;
create policy "posts_perfil: qualquer autenticado lê" on public.posts_perfil
  for select to authenticated using (true);
create policy "posts_perfil: autor publica" on public.posts_perfil
  for insert to authenticated with check (autor_id = (select auth.uid()));
create policy "posts_perfil: autor apaga" on public.posts_perfil
  for delete to authenticated using (autor_id = (select auth.uid()));
grant select, insert, delete on public.posts_perfil to authenticated;

create table public.curtidas_perfil (
  post_id   uuid not null references public.posts_perfil(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.curtidas_perfil enable row level security;
create policy "curtidas: qualquer autenticado lê" on public.curtidas_perfil
  for select to authenticated using (true);
create policy "curtidas: eu curto" on public.curtidas_perfil
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "curtidas: eu descurto" on public.curtidas_perfil
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, delete on public.curtidas_perfil to authenticated;

-- Bucket privado, mesmo padrão de posts-grupo, path {autor_id}/{post_id}
-- (sem grupo_id — não tem essa dimensão aqui). SELECT é público (qualquer
-- autenticado), só INSERT/DELETE são restritos ao dono.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts-perfil', 'posts-perfil', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "posts-perfil: qualquer autenticado vê" on storage.objects
  for select to authenticated using (bucket_id = 'posts-perfil');
create policy "posts-perfil: dono envia" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'posts-perfil' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "posts-perfil: dono apaga" on storage.objects
  for delete to authenticated using (
    bucket_id = 'posts-perfil' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
