-- =====================================================================
-- 18 — topicos_pendentes passa a aceitar eventos, não só tópicos
-- =====================================================================
-- A Fase B (montar-estudo) pode falhar em encaixar uma prova ou entrega
-- inteira na grade — não só um tópico. Até aqui, `topicos_pendentes`
-- só tinha `topico_id uuid not null` como parte da chave primária: não
-- tinha como registrar "esta prova ficou de fora", só tópicos.
--
-- Efeito antes desta migration: se um evento inteiro não coubesse, a IA
-- não tinha como reportar isso em nao_alocados — o schema não suportava.
-- =====================================================================

alter table public.topicos_pendentes
  add column id uuid not null default gen_random_uuid(),
  add column evento_id uuid references public.eventos(id) on delete cascade;

-- A PK composta precisa sair ANTES de tirar o not null de topico_id —
-- Postgres não deixa afrouxar uma coluna que ainda é chave primária.
alter table public.topicos_pendentes drop constraint topicos_pendentes_pkey;
alter table public.topicos_pendentes alter column topico_id drop not null;
alter table public.topicos_pendentes add primary key (id);

alter table public.topicos_pendentes
  add constraint ck_topico_xor_evento check (
    (topico_id is not null and evento_id is null) or
    (topico_id is null and evento_id is not null)
  );

-- Upsert por (user_id, topico_id) ou (user_id, evento_id) — a RPC precisa
-- de um alvo de conflito único em cada caso; um índice parcial por lado
-- substitui a antiga PK composta.
create unique index topicos_pendentes_user_topico_idx
  on public.topicos_pendentes (user_id, topico_id) where topico_id is not null;
create unique index topicos_pendentes_user_evento_idx
  on public.topicos_pendentes (user_id, evento_id) where evento_id is not null;

create index topicos_pendentes_evento_idx on public.topicos_pendentes (evento_id);

-- private.pode_ver já cobre a visibilidade por user_id; nenhuma policy
-- nova é necessária — RLS existente ("topico pendente: dono") não
-- referencia topico_id, só user_id.

-- ---------------------------------------------------------------------
-- salvar_blocos_estudo: grava topico_id OU evento_id, nunca os dois
-- ---------------------------------------------------------------------
create or replace function public.salvar_blocos_estudo(
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
  v_topico   uuid;
  v_evento   uuid;
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
    v_topico := nullif(n ->> 'topico_id', 'null')::uuid;
    v_evento := nullif(n ->> 'evento_id', 'null')::uuid;

    -- ON CONFLICT só aceita UM alvo por INSERT — como a linha é sempre
    -- tópico OU evento (nunca os dois, ck_topico_xor_evento garante),
    -- cada caso usa o índice parcial correspondente.
    if v_topico is not null then
      insert into public.topicos_pendentes (user_id, topico_id, motivo)
      values (v_uid, v_topico, n ->> 'motivo')
      on conflict (user_id, topico_id) where topico_id is not null
        do update set motivo = excluded.motivo;
    elsif v_evento is not null then
      insert into public.topicos_pendentes (user_id, evento_id, motivo)
      values (v_uid, v_evento, n ->> 'motivo')
      on conflict (user_id, evento_id) where evento_id is not null
        do update set motivo = excluded.motivo;
    end if;
    -- item sem topico_id nem evento_id: ignorado, não derruba a gravação inteira
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
