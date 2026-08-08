-- =====================================================================
-- 12 — Agregados do feed, mantidos por trigger
-- =====================================================================
-- O painel do grupo mostra resumo DIÁRIO por pessoa. Se ele fosse
-- calculado na leitura, cada abertura do feed varreria series_registros
-- inteira. Mantido na escrita, o feed vira um SELECT por chave primária.
--
-- `recalcular_dia` é idempotente de propósito: pode rodar quantas vezes
-- for, em qualquer ordem. Isso importa porque a fila offline reenvia.
-- =====================================================================

create function private.recalcular_dia(p_user_id uuid, p_data date)
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

  select
    count(*) > 0,
    -- Última sessão concluída do dia dá a letra exibida no painel.
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
    -- Tempo REAL do timer, nunca o planejado.
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


-- ---------------------------------------------------------------------
-- Gatilhos. Cada um só descobre (user_id, data) e delega.
-- ---------------------------------------------------------------------

create function private.trg_serie_recalcula()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_data date;
begin
  select ts.user_id, ts.data into v_user, v_data
  from public.treino_sessoes ts
  where ts.id = coalesce(new.treino_sessao_id, old.treino_sessao_id);

  perform private.recalcular_dia(v_user, v_data);
  return null;
end;
$$;

create trigger trg_series_recalcula_dia
  after insert or update or delete on public.series_registros
  for each row execute function private.trg_serie_recalcula();


create function private.trg_treino_recalcula()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalcular_dia(
    coalesce(new.user_id, old.user_id),
    coalesce(new.data,    old.data)
  );
  -- A data pode ter mudado num update: o dia antigo também precisa
  -- ser recalculado, senão fica um "treinou" fantasma no painel.
  if tg_op = 'UPDATE' and new.data is distinct from old.data then
    perform private.recalcular_dia(old.user_id, old.data);
  end if;
  return null;
end;
$$;

create trigger trg_treino_recalcula_dia
  after insert or update or delete on public.treino_sessoes
  for each row execute function private.trg_treino_recalcula();


create function private.trg_bloco_recalcula()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalcular_dia(
    coalesce(new.user_id, old.user_id),
    coalesce(new.data,    old.data)
  );
  if tg_op = 'UPDATE' and new.data is distinct from old.data then
    perform private.recalcular_dia(old.user_id, old.data);
  end if;
  return null;
end;
$$;

create trigger trg_bloco_recalcula_dia
  after insert or update or delete on public.blocos
  for each row execute function private.trg_bloco_recalcula();


-- ---------------------------------------------------------------------
-- Tópico marcado como "quer revisar" no mini-questionário volta a ser
-- candidato à revisão pré-prova. Propagar aqui evita que a Edge Function
-- do Prompt 2 precise ler bloco_respostas (que é privada até dela).
-- ---------------------------------------------------------------------
create function private.trg_resposta_propaga_topico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topico uuid;
begin
  select b.topico_id into v_topico
  from public.blocos b where b.id = new.bloco_id;

  if v_topico is null then
    return null;
  end if;

  -- `compreendido` só desce para false; um "entendi" isolado não apaga
  -- um "não entendi" anterior. Na dúvida, o app reserva revisão.
  update public.topicos t
     set compreendido = case
           when new.entendeu is false then false
           when new.entendeu is true and t.compreendido is null then true
           else t.compreendido
         end,
         dificuldade = coalesce(new.dificuldade, t.dificuldade)
   where t.id = v_topico;

  return null;
end;
$$;

create trigger trg_resposta_propaga_topico
  after insert or update on public.bloco_respostas
  for each row execute function private.trg_resposta_propaga_topico();


revoke execute on all functions in schema private from public, anon;
grant  execute on all functions in schema private to authenticated, service_role;
