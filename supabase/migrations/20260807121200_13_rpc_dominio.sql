-- =====================================================================
-- 12 — RPCs de domínio
-- =====================================================================
-- Aqui mora a lógica que NÃO pode viver no cliente nem na IA:
-- rotação da fila, progressão dupla, streak derivado, ênfase calculada.
--
-- Regra geral: SECURITY INVOKER sempre que a RLS já resolve. DEFINER só
-- onde a função precisa enxergar linha de outra pessoa (entrar no grupo,
-- streak do grupo, fechamento de semana pelo cron) — e sempre com
-- checagem explícita de auth.uid() dentro.
--
-- Todas com `set search_path = ''`: nome não qualificado dentro de uma
-- função DEFINER é vetor de sequestro de search_path.
-- =====================================================================


-- =====================================================================
-- GRUPO
-- =====================================================================

create function private.gerar_codigo_convite()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 6 chars de um alfabeto sem 0/O/1/I: o código é digitado a mão.
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;


create function public.criar_grupo(p_nome text)
returns public.grupos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_grupo  public.grupos;
  v_codigo text;
  v_tent   int := 0;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  -- Retenta a colisão de código em vez de confiar na sorte do unique.
  loop
    v_tent  := v_tent + 1;
    v_codigo := private.gerar_codigo_convite();
    exit when not exists (
      select 1 from public.grupos g where g.codigo_convite = v_codigo
    );
    if v_tent > 10 then
      raise exception 'não foi possível gerar código de convite';
    end if;
  end loop;

  insert into public.grupos (nome, criado_por, codigo_convite)
  values (p_nome, v_uid, v_codigo)
  returning * into v_grupo;

  insert into public.grupo_membros (grupo_id, user_id)
  values (v_grupo.id, v_uid);

  return v_grupo;
end;
$$;


create function public.entrar_no_grupo(p_codigo text)
returns public.grupos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_grupo public.grupos;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  -- DEFINER é necessário aqui: quem ainda não é membro não enxerga o
  -- grupo pela RLS, então não teria como resolver o código.
  select * into v_grupo
  from public.grupos g
  where g.codigo_convite = upper(trim(p_codigo));

  if v_grupo.id is null then
    raise exception 'código de convite inválido' using errcode = 'P0002';
  end if;

  insert into public.grupo_membros (grupo_id, user_id)
  values (v_grupo.id, v_uid)
  on conflict do nothing;

  return v_grupo;
end;
$$;


-- =====================================================================
-- TREINO — ÊNFASE DERIVADA
-- =====================================================================
-- Uma função, dois usos: valida a geração da IA (checagem 11 do
-- Prompt 1) e alimenta a tela "peito 2x/18 séries". Volume é métrica
-- mais forte que frequência, e ênfase NÃO é campo no banco.
-- =====================================================================

create function public.volume_por_grupo(p_programa_id uuid)
returns table (
  grupo_primario public.grupo_muscular,
  regiao         text,
  sessoes        bigint,
  series         bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.grupo_primario,
    public.regiao_do_grupo(e.grupo_primario) as regiao,
    count(distinct s.id)                     as sessoes,
    sum(sx.series)::bigint                   as series
  from public.sessao_exercicios sx
  join public.sessoes    s on s.id = sx.sessao_id
  join public.exercicios e on e.id = sx.exercicio_id
  where s.programa_id = p_programa_id
  group by e.grupo_primario
  order by series desc
$$;


create function public.proporcao_enfase(p_programa_id uuid)
returns table (regiao text, series bigint, proporcao numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select public.regiao_do_grupo(e.grupo_primario) as regiao,
           sum(sx.series)::bigint                   as series
    from public.sessao_exercicios sx
    join public.sessoes    s on s.id = sx.sessao_id
    join public.exercicios e on e.id = sx.exercicio_id
    where s.programa_id = p_programa_id
    group by 1
  ),
  -- Core (abdômen, lombar) sai da conta: é complemento, não ênfase.
  base as (select sum(series) total from v where regiao in ('superior','inferior'))
  select v.regiao,
         v.series,
         case when b.total > 0
              then round(v.series::numeric / b.total, 4)
              else 0 end
  from v cross join base b
  where v.regiao in ('superior','inferior')
$$;


-- =====================================================================
-- TREINO — PROGRESSÃO DUPLA
-- =====================================================================
-- Regra: repete a carga da última vez. Completou reps_max em TODAS as
-- séries → sugere um degrau acima. Degrau vem de incremento_kg.
-- incremento_kg nulo (peso corporal, elástico) → progride por reps.
-- Primeira vez → campo vazio.
-- =====================================================================

create function public.proxima_carga(
  p_exercicio_id int,
  p_reps_max     smallint default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_incremento numeric;
  v_unilateral boolean;
  v_medida     public.medida_exercicio;
  v_sessao     uuid;
  v_data       timestamptz;
  v_carga      numeric;
  v_bateu_topo boolean;
begin
  select e.incremento_kg, e.unilateral, e.medida
    into v_incremento, v_unilateral, v_medida
  from public.exercicios e where e.id = p_exercicio_id;

  if not found then
    raise exception 'exercício % não existe', p_exercicio_id;
  end if;

  -- Última vez que ESTE usuário fez ESTE exercício.
  -- Usa series_registros_progressao_idx (user_id, exercicio_id, registrada_em desc).
  select sr.treino_sessao_id, sr.registrada_em
    into v_sessao, v_data
  from public.series_registros sr
  where sr.user_id = v_uid
    and sr.exercicio_id = p_exercicio_id
  order by sr.registrada_em desc
  limit 1;

  if v_sessao is null then
    return jsonb_build_object(
      'primeira_vez',  true,
      'carga_kg',      null,
      'sugeriu_subir', false,
      'motivo',        'sem histórico',
      'unilateral',    v_unilateral,
      'progride_por',  case when v_incremento is null then 'reps' else 'carga' end
    );
  end if;

  -- Carga daquela sessão (a maior série vale como "a carga do dia").
  select max(sr.carga_kg)
    into v_carga
  from public.series_registros sr
  where sr.treino_sessao_id = v_sessao
    and sr.exercicio_id = p_exercicio_id;

  -- Bateu o topo da faixa em TODAS as séries daquela sessão?
  select p_reps_max is not null
     and count(*) > 0
     and bool_and(sr.completou and sr.reps >= p_reps_max)
    into v_bateu_topo
  from public.series_registros sr
  where sr.treino_sessao_id = v_sessao
    and sr.exercicio_id = p_exercicio_id;

  -- Sem incremento_kg (peso corporal, elástico): progride por reps.
  if v_incremento is null then
    return jsonb_build_object(
      'primeira_vez',   false,
      'carga_kg',       v_carga,
      'sugeriu_subir',  false,
      'motivo',         'progride por reps, não por carga',
      'unilateral',     v_unilateral,
      'progride_por',   'reps',
      'ultima_carga_kg', v_carga,
      'ultima_em',      v_data
    );
  end if;

  return jsonb_build_object(
    'primeira_vez',    false,
    'carga_kg',        case when coalesce(v_bateu_topo, false)
                            then coalesce(v_carga, 0) + v_incremento
                            else v_carga end,
    'sugeriu_subir',   coalesce(v_bateu_topo, false),
    'motivo',          case when coalesce(v_bateu_topo, false)
                            then 'completou o topo da faixa em todas as séries'
                            else 'repete a carga da última vez' end,
    'incremento_kg',   v_incremento,
    'unilateral',      v_unilateral,
    'progride_por',    'carga',
    'ultima_carga_kg', v_carga,
    'ultima_em',       v_data
  );
end;
$$;

comment on function public.proxima_carga is
  'Sugestão de carga por progressão dupla. O app SUGERE, o usuário pode digitar. Carga por lado quando unilateral.';


-- =====================================================================
-- TREINO — SUBSTITUIÇÃO
-- =====================================================================

-- Os 3 da IA no topo; "ver mais" cai no catálogo filtrado por grupo
-- primário + padrão de movimento. Funciona offline e cobre o exercício
-- que entrou por troca permanente e não tem substitutos próprios.
create function public.substitutos_do_exercicio(p_sessao_exercicio_id uuid)
returns table (
  exercicio_id int,
  nome         text,
  equipamento  public.equipamento,
  comum        smallint,
  origem       text,
  posicao      smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with titular as (
    select e.id, e.grupo_primario, e.padrao_movimento, e.equipamento
    from public.sessao_exercicios sx
    join public.exercicios e on e.id = sx.exercicio_id
    where sx.id = p_sessao_exercicio_id
  ),
  indisponiveis as (
    select ei.equipamento
    from public.equipamentos_indisponiveis ei
    where ei.user_id = (select auth.uid())
  ),
  da_ia as (
    select e.id, e.nome, e.equipamento, e.comum, 'ia'::text as origem, s.posicao
    from public.sessao_exercicio_substitutos s
    join public.exercicios e on e.id = s.exercicio_id
    where s.sessao_exercicio_id = p_sessao_exercicio_id
      and e.equipamento not in (select equipamento from indisponiveis)
  ),
  do_catalogo as (
    select e.id, e.nome, e.equipamento, e.comum,
           'catalogo'::text as origem,
           (10 + e.comum)::smallint as posicao
    from public.exercicios e, titular t
    where e.grupo_primario   = t.grupo_primario
      and e.padrao_movimento = t.padrao_movimento
      and e.id <> t.id
      and e.id not in (select id from da_ia)
      and e.equipamento not in (select equipamento from indisponiveis)
  )
  select * from da_ia
  union all
  select * from do_catalogo
  order by posicao, comum, nome
$$;


-- "Trocou 3 das últimas 4 vezes → quer tornar permanente?"
-- Só contagem, sem IA.
create function public.trocas_recentes(
  p_planejado_id int,
  p_janela       int default 4
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ultimas as (
    select distinct on (sr.treino_sessao_id)
           sr.treino_sessao_id,
           sr.exercicio_id,
           sr.planejado_id,
           sr.registrada_em
    from public.series_registros sr
    where sr.user_id = (select auth.uid())
      and sr.planejado_id = p_planejado_id
    order by sr.treino_sessao_id, sr.registrada_em desc
  ),
  janela as (
    select * from ultimas order by registrada_em desc limit p_janela
  )
  select jsonb_build_object(
    'sessoes_avaliadas', count(*),
    'trocas',            count(*) filter (where exercicio_id <> p_planejado_id),
    'substituto_mais_usado', (
      select j.exercicio_id from janela j
      where j.exercicio_id <> p_planejado_id
      group by j.exercicio_id
      order by count(*) desc
      limit 1
    )
  )
  from janela
$$;


-- =====================================================================
-- TREINO — MÁQUINA DE ESTADO E ROTAÇÃO
-- =====================================================================
-- Os dias planejados existem SÓ pra agendar lembrete. O conteúdo vem da
-- fila, que avança a cada sessão CONCLUÍDA. Furou a terça, o A não se
-- perde: acontece na quinta.
-- =====================================================================

create function public.finalizar_treino(p_treino_sessao_id uuid)
returns public.treino_sessoes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_treino   public.treino_sessoes;
  v_programa uuid;
  v_posicao  smallint;
  v_total    int;
  v_proxima  uuid;
begin
  update public.treino_sessoes ts
     set status        = 'concluida'::public.status_sessao,
         finalizada_em = now()
   where ts.id = p_treino_sessao_id
     and ts.user_id = v_uid
     and ts.status  = 'em_andamento'::public.status_sessao
  returning * into v_treino;

  if v_treino.id is null then
    raise exception 'sessão % não está em andamento para este usuário', p_treino_sessao_id
      using errcode = 'P0002';
  end if;

  -- Avança a fila a partir da sessão que ACABOU de ser feita — não do
  -- ponteiro atual. Assim escolher manualmente o C fora de ordem
  -- reposiciona a fila em vez de bagunçá-la.
  if v_treino.sessao_id is not null then
    select s.programa_id, s.posicao into v_programa, v_posicao
    from public.sessoes s where s.id = v_treino.sessao_id;

    if v_programa is not null then
      select count(*) into v_total
      from public.sessoes s where s.programa_id = v_programa;

      select s.id into v_proxima
      from public.sessoes s
      where s.programa_id = v_programa
        and s.posicao = ((v_posicao + 1) % v_total);

      update public.programas p
         set proxima_sessao_id = v_proxima
       where p.id = v_programa;
    end if;
  end if;

  perform private.recalcular_dia(v_uid, v_treino.data);
  return v_treino;
end;
$$;


create function public.abandonar_treino(
  p_treino_sessao_id uuid,
  p_exercicio_id     int default null
)
returns public.treino_sessoes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_treino public.treino_sessoes;
begin
  -- Não avança a fila: sessão abandonada não conta como feita, então o
  -- mesmo treino continua sendo o próximo.
  update public.treino_sessoes ts
     set status        = 'abandonada'::public.status_sessao,
         finalizada_em = now(),
         abandonou_em_exercicio_id = coalesce(p_exercicio_id, ts.abandonou_em_exercicio_id)
   where ts.id = p_treino_sessao_id
     and ts.user_id = (select auth.uid())
     and ts.status  = 'em_andamento'::public.status_sessao
  returning * into v_treino;

  if v_treino.id is null then
    raise exception 'sessão % não está em andamento para este usuário', p_treino_sessao_id
      using errcode = 'P0002';
  end if;

  perform private.recalcular_dia(v_treino.user_id, v_treino.data);
  return v_treino;
end;
$$;


-- =====================================================================
-- SEMANA OFF
-- =====================================================================

-- Semana off cobre o PREVISÍVEL, e por isso exige antecedência:
-- declarada até o domingo anterior. Sem essa regra, toda semana ruim
-- vira off retroativamente e o streak não significa nada.
create function public.declarar_semana_off(p_semana_inicio date)
returns public.semanas_off
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_hoje   date;
  v_usadas int;
  v_row    public.semanas_off;
begin
  if extract(isodow from p_semana_inicio) <> 1 then
    raise exception 'semana_inicio precisa ser uma segunda-feira'
      using errcode = '22007';
  end if;

  -- "Hoje" no fuso do usuário, não no do servidor.
  select (now() at time zone p.timezone)::date into v_hoje
  from public.profiles p where p.id = v_uid;

  if v_hoje is null then
    raise exception 'perfil não encontrado' using errcode = '28000';
  end if;

  if v_hoje >= p_semana_inicio then
    raise exception 'semana off precisa ser declarada até o domingo anterior'
      using errcode = 'P0001';
  end if;

  -- Máximo 6 por semestre. Semestre fixo (jan/jul), contado pelo dia de
  -- INÍCIO da semana.
  select count(*) into v_usadas
  from public.semanas_off so
  where so.user_id = v_uid
    and public.inicio_do_semestre(so.semana_inicio)
      = public.inicio_do_semestre(p_semana_inicio);

  if v_usadas >= 6 then
    raise exception 'limite de 6 semanas off por semestre já atingido'
      using errcode = 'P0001';
  end if;

  insert into public.semanas_off (user_id, semana_inicio)
  values (v_uid, p_semana_inicio)
  on conflict (user_id, semana_inicio) do update
    set declarada_em = public.semanas_off.declarada_em
  returning * into v_row;

  return v_row;
end;
$$;


-- =====================================================================
-- FECHAMENTO DE SEMANA E STREAK
-- =====================================================================
-- Streak é DERIVADO, nunca contador armazenado. O que é armazenado é o
-- fato da semana (fechou a meta? estava off? gastou vida?), e o streak
-- se recalcula a partir disso — o que torna estado inconsistente
-- impossível por construção.
-- =====================================================================

create function private.fechar_semana(p_user_id uuid, p_semana_inicio date)
returns public.semanas_resumo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fim       date := p_semana_inicio + 6;
  v_meta      smallint := 0;
  v_treinos   smallint := 0;
  v_bl_feitos smallint := 0;
  v_bl_plan   smallint := 0;
  v_minutos   int := 0;
  v_off       boolean;
  v_mes       date := date_trunc('month', p_semana_inicio)::date;
  v_disp      int;
  v_falta     int;
  v_usou_vida boolean := false;
  v_contou    boolean := false;
  v_row       public.semanas_resumo;
begin
  select coalesce(p.frequencia_semanal, 0) into v_meta
  from public.programas p
  where p.user_id = p_user_id and p.ativo;
  v_meta := coalesce(v_meta, 0);

  select count(*)::smallint into v_treinos
  from public.treino_sessoes ts
  where ts.user_id = p_user_id
    and ts.data between p_semana_inicio and v_fim
    and ts.status = 'concluida'::public.status_sessao;

  select
    count(*) filter (where b.status = 'concluido'::public.status_bloco)::smallint,
    count(*)::smallint,
    coalesce(sum(b.tempo_real_seg) / 60, 0)::int
  into v_bl_feitos, v_bl_plan, v_minutos
  from public.blocos b
  where b.user_id = p_user_id
    and b.data between p_semana_inicio and v_fim;

  v_off := exists (
    select 1 from public.semanas_off so
    where so.user_id = p_user_id and so.semana_inicio = p_semana_inicio
  );

  if v_off then
    -- Semana off CONGELA: não zera, não avança, não consome vida.
    v_contou := false;

  elsif v_meta = 0 then
    -- Sem programa de treino ativo, a semana não pesa contra o streak.
    v_contou := false;

  elsif v_treinos >= v_meta then
    v_contou := true;

  else
    -- Vida cobre o IMPREVISTO: uma por treino faltante, até 4 no mês.
    v_falta := v_meta - v_treinos;

    insert into public.vidas_mes (user_id, mes_ref, usadas)
    values (p_user_id, v_mes, 0)
    on conflict (user_id, mes_ref) do nothing;

    select 4 - vm.usadas into v_disp
    from public.vidas_mes vm
    where vm.user_id = p_user_id and vm.mes_ref = v_mes;

    if v_disp >= v_falta then
      update public.vidas_mes vm
         set usadas = vm.usadas + v_falta
       where vm.user_id = p_user_id and vm.mes_ref = v_mes;
      v_usou_vida := true;
      v_contou    := true;
    end if;
  end if;

  insert into public.semanas_resumo (
    user_id, semana_inicio, meta_treinos, treinos_feitos,
    blocos_feitos, blocos_planejados, minutos_estudo,
    usou_vida, off, contou_streak, atualizado_em
  )
  values (
    p_user_id, p_semana_inicio, v_meta, v_treinos,
    v_bl_feitos, v_bl_plan, v_minutos,
    v_usou_vida, v_off, v_contou, now()
  )
  on conflict (user_id, semana_inicio) do update set
    meta_treinos      = excluded.meta_treinos,
    treinos_feitos    = excluded.treinos_feitos,
    blocos_feitos     = excluded.blocos_feitos,
    blocos_planejados = excluded.blocos_planejados,
    minutos_estudo    = excluded.minutos_estudo,
    usou_vida         = excluded.usou_vida,
    off               = excluded.off,
    contou_streak     = excluded.contou_streak,
    atualizado_em     = now()
  returning * into v_row;

  return v_row;
end;
$$;


-- Streak visível ao grupo — mas só o NÚMERO. semanas_resumo continua
-- privada porque carrega `usou_vida`, e vida é vulnerabilidade.
create function public.streak_de(p_user_id uuid default null)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alvo    uuid := coalesce(p_user_id, (select auth.uid()));
  v_semana  date;
  v_streak  int := 0;
  v_off     boolean;
  v_contou  boolean;
  v_existe  boolean;
begin
  if v_alvo is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  -- DEFINER exige a checagem de visibilidade AQUI dentro, senão a função
  -- vira endpoint público de streak alheio.
  if not private.pode_ver(v_alvo) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;

  -- Começa na última semana FECHADA: a corrente ainda pode virar.
  v_semana := public.inicio_da_semana(current_date) - 7;

  loop
    select true, sr.off, sr.contou_streak
      into v_existe, v_off, v_contou
    from public.semanas_resumo sr
    where sr.user_id = v_alvo and sr.semana_inicio = v_semana;

    -- Semana sem registro = semana sem atividade: quebra o streak.
    exit when not coalesce(v_existe, false);

    if v_off then
      -- Congela: não soma, não quebra. Só pula.
      null;
    elsif v_contou then
      v_streak := v_streak + 1;
    else
      exit;
    end if;

    v_semana := v_semana - 7;
    v_existe := false;

    -- Guarda-corpo: 5 anos de semanas é mais que suficiente.
    exit when v_streak > 260;
  end loop;

  return v_streak;
end;
$$;

comment on function public.streak_de is
  'Streak derivado de semanas_resumo. Conta por FREQUÊNCIA semanal, não por dia específico — coerente com a rotação.';


-- =====================================================================
-- GRANTs das RPCs
-- =====================================================================
-- Postgres concede EXECUTE a PUBLIC em todo CREATE FUNCTION. Fechar e
-- reabrir explicitamente é o que evita endpoint por acidente — ainda
-- mais em função SECURITY DEFINER, que roda com privilégio do criador.
revoke execute on function
  public.criar_grupo(text),
  public.entrar_no_grupo(text),
  public.volume_por_grupo(uuid),
  public.proporcao_enfase(uuid),
  public.proxima_carga(int, smallint),
  public.substitutos_do_exercicio(uuid),
  public.trocas_recentes(int, int),
  public.finalizar_treino(uuid),
  public.abandonar_treino(uuid, int),
  public.declarar_semana_off(date),
  public.streak_de(uuid)
from public, anon;

grant execute on function
  public.criar_grupo(text),
  public.entrar_no_grupo(text),
  public.volume_por_grupo(uuid),
  public.proporcao_enfase(uuid),
  public.proxima_carga(int, smallint),
  public.substitutos_do_exercicio(uuid),
  public.trocas_recentes(int, int),
  public.finalizar_treino(uuid),
  public.abandonar_treino(uuid, int),
  public.declarar_semana_off(date),
  public.streak_de(uuid)
to authenticated;

-- fechar_semana é chamada pelo cron, nunca pelo app.
revoke execute on function private.fechar_semana(uuid, date) from public, anon, authenticated;
grant  execute on function private.fechar_semana(uuid, date) to service_role;
