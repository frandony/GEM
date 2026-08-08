-- =====================================================================
-- 15 — Persistência atômica dos planos gerados
-- =====================================================================
-- A Edge Function valida o JSON e chama UMA função. Sem isto, gravar um
-- programa seria ~40 inserts pelo PostgREST sem transação: uma falha no
-- meio deixaria um plano pela metade, que é pior que nenhum plano.
-- =====================================================================

create function public.salvar_programa(
  p_divisao            public.divisao_treino,
  p_enfase             public.enfase_treino,
  p_frequencia_semanal smallint,
  p_sessoes            jsonb,
  p_dias_lembrete      smallint[] default '{}',
  p_hora_lembrete      time default null,
  p_origem_fallback    boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_programa  uuid := gen_random_uuid();
  v_sessao    uuid;
  v_sx        uuid;
  v_primeira  uuid;
  v_posicao   smallint := 0;
  s           jsonb;
  e           jsonb;
  sub         jsonb;
  v_pos_sub   smallint;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  if jsonb_array_length(p_sessoes) = 0 then
    raise exception 'o plano não tem sessões';
  end if;

  -- Refazer o plano DESATIVA o anterior, nunca apaga: o histórico de
  -- execução ainda aponta para as sessões dele.
  update public.programas set ativo = false
   where user_id = v_uid and ativo;

  insert into public.programas (
    id, user_id, divisao, enfase, frequencia_semanal,
    dias_lembrete, hora_lembrete, origem_fallback, ativo
  )
  values (
    v_programa, v_uid, p_divisao, p_enfase, p_frequencia_semanal,
    coalesce(p_dias_lembrete, '{}'), p_hora_lembrete, p_origem_fallback, true
  );

  for s in select * from jsonb_array_elements(p_sessoes)
  loop
    v_sessao := gen_random_uuid();

    insert into public.sessoes (id, programa_id, letra, nome, posicao)
    values (v_sessao, v_programa, s ->> 'letra', s ->> 'nome', v_posicao);

    if v_posicao = 0 then
      v_primeira := v_sessao;
    end if;
    v_posicao := v_posicao + 1;

    for e in select * from jsonb_array_elements(s -> 'exercicios')
    loop
      v_sx := gen_random_uuid();

      insert into public.sessao_exercicios (
        id, sessao_id, exercicio_id, ordem, series,
        reps_min, reps_max, duracao_seg, descanso_seg
      )
      values (
        v_sx,
        v_sessao,
        (e ->> 'exercicio_id')::int,
        (e ->> 'ordem')::smallint,
        (e ->> 'series')::smallint,
        nullif(e ->> 'reps_min', 'null')::smallint,
        nullif(e ->> 'reps_max', 'null')::smallint,
        nullif(e ->> 'duracao_seg', 'null')::smallint,
        (e ->> 'descanso_seg')::smallint
      );

      v_pos_sub := 0;
      for sub in select * from jsonb_array_elements(coalesce(e -> 'substitutos', '[]'::jsonb))
      loop
        v_pos_sub := v_pos_sub + 1;
        exit when v_pos_sub > 5;

        insert into public.sessao_exercicio_substitutos
          (sessao_exercicio_id, exercicio_id, posicao)
        values (v_sx, sub::text::int, v_pos_sub)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  -- A fila de rotação começa na primeira sessão do ciclo.
  update public.programas
     set proxima_sessao_id = v_primeira
   where id = v_programa;

  return v_programa;
end;
$$;

comment on function public.salvar_programa is
  'Grava o plano inteiro em uma transação. SECURITY INVOKER: a RLS do usuário continua valendo em cada insert.';

revoke execute on function public.salvar_programa(
  public.divisao_treino, public.enfase_treino, smallint, jsonb, smallint[], time, boolean
) from public, anon;

grant execute on function public.salvar_programa(
  public.divisao_treino, public.enfase_treino, smallint, jsonb, smallint[], time, boolean
) to authenticated;


-- =====================================================================
-- Blocos de estudo
-- =====================================================================
-- Replanejamento apaga e regrava SÓ a partir de p_semana_inicio, e só o que
-- ainda está pendente. Duas garantias vêm disso:
--   * a semana corrente fica congelada (regra do caso-limite 5)
--   * bloco já concluído nunca é apagado — o histórico é imutável
-- =====================================================================

create function public.salvar_blocos_estudo(
  p_semana_inicio  date,
  p_blocos         jsonb,
  p_nao_alocados   jsonb default '[]'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_apagados int;
  v_criados  int := 0;
  b          jsonb;
  n          jsonb;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  if extract(isodow from p_semana_inicio) <> 1 then
    raise exception 'semana_inicio precisa ser uma segunda-feira'
      using errcode = '22007';
  end if;

  delete from public.blocos
   where user_id = v_uid
     and data >= p_semana_inicio
     and status = 'pendente'::public.status_bloco;
  get diagnostics v_apagados = row_count;

  for b in select * from jsonb_array_elements(p_blocos)
  loop
    insert into public.blocos (
      id, user_id, materia_id, topico_id, evento_id,
      data, hora, duracao_min, tipo, titulo, status
    )
    values (
      gen_random_uuid(),
      v_uid,
      nullif(b ->> 'materia_id', 'null')::uuid,
      nullif(b ->> 'topico_id',  'null')::uuid,
      nullif(b ->> 'evento_id',  'null')::uuid,
      (b ->> 'data')::date,
      (b ->> 'hora')::time,
      (b ->> 'duracao_min')::smallint,
      (b ->> 'tipo')::public.tipo_bloco,
      b ->> 'titulo',
      'pendente'::public.status_bloco
    );
    v_criados := v_criados + 1;
  end loop;

  -- A lista de pendentes é substituída inteira: o que a IA conseguiu alocar
  -- desta vez sai do contador da home.
  delete from public.topicos_pendentes where user_id = v_uid;

  for n in select * from jsonb_array_elements(p_nao_alocados)
  loop
    insert into public.topicos_pendentes (user_id, topico_id, motivo)
    values (v_uid, (n ->> 'topico_id')::uuid, n ->> 'motivo')
    on conflict (user_id, topico_id) do update set motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'blocos_apagados', v_apagados,
    'blocos_criados',  v_criados,
    'nao_alocados',    jsonb_array_length(p_nao_alocados)
  );
end;
$$;

revoke execute on function public.salvar_blocos_estudo(date, jsonb, jsonb)
  from public, anon;
grant execute on function public.salvar_blocos_estudo(date, jsonb, jsonb)
  to authenticated;


-- =====================================================================
-- Tópicos extraídos do plano de ensino (Prompt 3)
-- =====================================================================
-- Nada é gravado antes da confirmação do usuário: esta função é chamada
-- DEPOIS da tela de revisão editável, com a lista que ele confirmou —
-- nunca direto pela Edge Function de extração.
-- =====================================================================

create function public.salvar_materia_com_topicos(
  p_nome      text,
  p_topicos   jsonb,
  p_origem    public.origem_topicos default 'manual',
  p_confianca public.confianca_extracao default 'alta',
  p_eventos   jsonb default '[]'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_materia uuid := gen_random_uuid();
  v_evento  uuid;
  v_ordem   smallint := 0;
  t         jsonb;
  ev        jsonb;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  insert into public.materias (id, user_id, nome, origem, confianca)
  values (v_materia, v_uid, p_nome, p_origem, p_confianca);

  for t in select * from jsonb_array_elements(p_topicos)
  loop
    v_ordem := v_ordem + 1;
    insert into public.topicos (id, materia_id, nome, ordem, dificuldade)
    values (
      gen_random_uuid(),
      v_materia,
      t ->> 'nome',
      v_ordem,
      nullif(t ->> 'dificuldade', 'null')::public.dificuldade
    );
  end loop;

  -- Datas do PDF chegam DESMARCADAS na tela; aqui só entram as que o
  -- usuário confirmou. Cronograma de faculdade atrasa.
  for ev in select * from jsonb_array_elements(p_eventos)
  loop
    v_evento := gen_random_uuid();
    insert into public.eventos (id, materia_id, tipo, data, descricao)
    values (
      v_evento,
      v_materia,
      (ev ->> 'tipo')::public.tipo_evento,
      (ev ->> 'data')::date,
      ev ->> 'descricao'
    );

    -- Prova sem tópicos listados cobre a matéria inteira.
    if (ev ->> 'tipo') = 'prova' then
      insert into public.evento_topicos (evento_id, topico_id)
      select v_evento, tp.id from public.topicos tp where tp.materia_id = v_materia;
    end if;
  end loop;

  return v_materia;
end;
$$;

revoke execute on function public.salvar_materia_com_topicos(
  text, jsonb, public.origem_topicos, public.confianca_extracao, jsonb
) from public, anon;
grant execute on function public.salvar_materia_com_topicos(
  text, jsonb, public.origem_topicos, public.confianca_extracao, jsonb
) to authenticated;
