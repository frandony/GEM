-- =====================================================================
-- 17 — Correção: apagar a conta era impossível
-- =====================================================================
-- BUG encontrado ao limpar os usuários de teste do primeiro deploy.
--
-- Sequência que quebrava:
--   1. delete em auth.users
--   2. cascade apaga public.profiles
--   3. cascade apaga treino_sessoes (e blocos)
--   4. o trigger AFTER DELETE dessas tabelas chama recalcular_dia()
--   5. recalcular_dia() faz INSERT em resumos_diarios com um user_id que
--      o passo 2 já removeu de profiles
--   6. viola resumos_diarios_user_id_fkey → o DELETE inteiro é revertido
--
-- Efeito: "excluir minha conta" falhava com erro de FK, e não havia como
-- remover um usuário do sistema.
--
-- Correção: o agregado só faz sentido enquanto o dono existe. Se o perfil
-- sumiu, não há dia a recalcular — sai em silêncio e deixa o cascade
-- apagar resumos_diarios normalmente.
--
-- Lição para agregados mantidos por trigger: todo trigger AFTER DELETE que
-- escreve em OUTRA tabela precisa tolerar o caso em que o pai já se foi.
-- =====================================================================

create or replace function private.recalcular_dia(p_user_id uuid, p_data date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_treinou boolean := false;
  v_letra   text;
  v_series  smallint := 0;
  v_blocos  smallint := 0;
  v_minutos int := 0;
begin
  if p_user_id is null or p_data is null then
    return;
  end if;

  -- Guarda contra o cascade de exclusão de conta.
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return;
  end if;

  select
    count(*) > 0,
    (array_agg(ts.sessao_letra order by ts.finalizada_em desc nulls last))[1]
  into v_treinou, v_letra
  from public.treino_sessoes ts
  where ts.user_id = p_user_id
    and ts.data = p_data
    and ts.status = 'concluida'::public.status_sessao;

  select count(*)::smallint into v_series
  from public.series_registros sr
  join public.treino_sessoes ts on ts.id = sr.treino_sessao_id
  where ts.user_id = p_user_id
    and ts.data = p_data;

  select
    count(*) filter (where b.status = 'concluido'::public.status_bloco)::smallint,
    coalesce(sum(b.tempo_real_seg) / 60, 0)::int
  into v_blocos, v_minutos
  from public.blocos b
  where b.user_id = p_user_id and b.data = p_data;

  insert into public.resumos_diarios (
    user_id, data, treinou, sessao_letra, series_total,
    blocos_feitos, minutos_estudo, atualizado_em
  )
  values (
    p_user_id, p_data, coalesce(v_treinou, false), v_letra, coalesce(v_series, 0),
    coalesce(v_blocos, 0), coalesce(v_minutos, 0), now()
  )
  on conflict (user_id, data) do update set
    treinou        = excluded.treinou,
    sessao_letra   = excluded.sessao_letra,
    series_total   = excluded.series_total,
    blocos_feitos  = excluded.blocos_feitos,
    minutos_estudo = excluded.minutos_estudo,
    atualizado_em  = now();
end;
$$;
