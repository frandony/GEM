-- Upload real falhou com "new row violates row-level security policy for
-- table objects" mesmo a pessoa sendo dona do próprio arquivo — simulado
-- direto no banco (set role authenticated + request.jwt.claims), a
-- checagem por nome plano (name = auth.uid()::text) avalia certo, então
-- o problema não é a lógica da policy em si. Troca pro padrão oficial do
-- Supabase (pasta por usuário + storage.foldername), que é o caminho
-- mais testado do mundo real — reduz a chance de esbarrar em alguma
-- particularidade do storage-api com nome de objeto sem pasta.
drop policy "avatares: dono envia a propria foto" on storage.objects;
drop policy "avatares: dono substitui a propria foto" on storage.objects;
drop policy "avatares: dono remove a propria foto" on storage.objects;

create policy "avatares: dono envia a propria foto"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatares: dono substitui a propria foto"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatares: dono remove a propria foto"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Pedido do usuário: 2 MB -> 5 MB.
update storage.buckets set file_size_limit = 5242880 where id = 'avatares';
