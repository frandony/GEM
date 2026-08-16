-- Bucket de avatares — foto de perfil. Público de propósito: o link
-- direto serve a imagem sem passar por RLS de leitura, e foto de perfil
-- não é dado sensível (diferente de semanas_resumo/vidas, que são
-- privados). Mesma faixa de tamanho/tipo já declarada em config.toml
-- (que só configura o stack local — isto aqui é o que vale de verdade).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Um objeto por usuário: name = id do próprio usuário, sem pasta nem
-- extensão no caminho (a extensão real é o Content-Type do upload).
-- Trocar de foto é upsert no MESMO caminho — URL estável, sem lixo
-- acumulando. Bucket público: SELECT não passa por RLS (o endpoint
-- /storage/v1/object/public/... do Supabase Storage ignora política de
-- leitura em bucket público), então só INSERT/UPDATE/DELETE precisam de
-- policy própria.
create policy "avatares: dono envia a propria foto"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text);

create policy "avatares: dono substitui a propria foto"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text)
  with check (bucket_id = 'avatares' and name = (select auth.uid())::text);

create policy "avatares: dono remove a propria foto"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatares' and name = (select auth.uid())::text);
