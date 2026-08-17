-- Bug: o feed do grupo quebrava com "Could not find a relationship between
-- 'posts_grupo' and 'profiles' in the schema cache". O PostgREST só resolve
-- o embed profiles(...) em cima de uma FK que aponte DIRETO para
-- public.profiles — grupo_membros.user_id já faz isso (referencia
-- profiles(id)) e por isso o embed funciona lá; posts_grupo.autor_id
-- apontava para auth.users(id), que o PostgREST não atravessa.
-- profiles.id já referencia auth.users(id) on delete cascade, então trocar
-- o alvo da FK não muda o comportamento de cascade — só abre o caminho que
-- o PostgREST precisa.
alter table public.posts_grupo drop constraint posts_grupo_autor_id_fkey;
alter table public.posts_grupo
  add constraint posts_grupo_autor_id_fkey
  foreign key (autor_id) references public.profiles(id) on delete cascade;
