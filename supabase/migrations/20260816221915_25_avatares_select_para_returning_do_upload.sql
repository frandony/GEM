-- Causa real do bug de upload de avatar: faltava política de SELECT em
-- storage.objects para o bucket avatares. Upload faz INSERT e depois lê
-- a linha de volta (RETURNING) — é assim que a Storage API confirma o
-- que foi salvo e monta a resposta. Sem SELECT liberado, essa leitura é
-- negada e Postgres rejeita a operação inteira com "new row violates
-- row-level security policy", mesmo o INSERT em si sendo permitido.
--
-- Confirmado empiricamente: um INSERT sem RETURNING passava; o mesmo
-- INSERT com RETURNING falhava — mesmo com uma policy de INSERT
-- incondicionalmente verdadeira (WITH CHECK (true)) testada à parte.
-- Reproduzido de novo, agora com sucesso, depois desta policy.
--
-- Não precisava disso antes: o bucket é público, e a leitura via URL
-- pública (/storage/v1/object/public/...) não passa por RLS — só o
-- FLUXO DE UPLOAD (via API autenticada) precisa desta policy.
create policy "avatares: dono le a propria foto"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
