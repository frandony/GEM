-- =====================================================================
-- 14 — pg_cron: rotinas de servidor
-- =====================================================================
-- Isto é o que faz o projeto ser infraestrutura real e não CRUD: cron,
-- fila e Edge Function conversando.
--
-- Granularidade mínima do pg_cron é 1 minuto — erro aleatório de 0 a 60s
-- dependendo de onde a hora alvo cai na janela. Aceitável para lembrete;
-- é exatamente o que reprova push como timer de descanso se o teste da
-- Opção 1 falhar (ver 01_teste_opcao_1.md).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Configuração de servidor. Sem RLS e sem GRANT: só service_role e
-- postgres alcançam. É onde ficam a URL do projeto e o segredo do cron.
--
-- Preencher DEPOIS do deploy (ver CLAUDE.md):
--   insert into private.config (chave, valor) values
--     ('projeto_url', 'https://<ref>.supabase.co'),
--     ('cron_secret',  '<segredo forte>');
-- ---------------------------------------------------------------------
create table private.config (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

revoke all on table private.config from public, anon, authenticated;

create function private.cfg(p_chave text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select valor from private.config where chave = p_chave
$$;

revoke execute on function private.cfg(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. Disparo da fila de push — a cada minuto.
--
-- Não manda uma requisição por notificação: chama a Edge Function uma
-- vez e ela drena a fila com service_role. Menos HTTP, e o retry fica
-- num lugar só.
-- ---------------------------------------------------------------------
create function private.disparar_fila_push()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text := private.cfg('projeto_url');
  v_secret text := private.cfg('cron_secret');
  v_pendentes int;
begin
  if v_url is null or v_secret is null then
    -- Ainda não configurado. Sai quieto em vez de encher o log a cada
    -- minuto — o app funciona sem push.
    return;
  end if;

  select count(*) into v_pendentes
  from public.notificacoes_agendadas n
  where n.status = 'pendente'::public.status_notif
    and n.disparar_em <= now();

  if v_pendentes = 0 then
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/disparar-notificacoes',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

select cron.schedule(
  'disparar-fila-push',
  '* * * * *',
  $$ select private.disparar_fila_push() $$
);


-- ---------------------------------------------------------------------
-- 2. Expirar notificação atrasada — a cada 5 minutos.
--
-- TTL curto é decisão de produto: aviso atrasado é pior que aviso
-- nenhum. Um lembrete de treino que chega 40 minutos depois só ensina
-- a ignorar notificação do app.
-- ---------------------------------------------------------------------
create function private.expirar_notificacoes()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notificacoes_agendadas n
     set status = 'expirada'::public.status_notif
   where n.status = 'pendente'::public.status_notif
     and n.disparar_em + make_interval(secs => n.ttl_seg) < now()
$$;

select cron.schedule(
  'expirar-notificacoes',
  '*/5 * * * *',
  $$ select private.expirar_notificacoes() $$
);


-- ---------------------------------------------------------------------
-- 3. Encerramento por inatividade — a cada 15 minutos.
--
-- Sem geolocalização: registrar uma série JÁ É prova de presença, com
-- 100% de precisão e sem pedir permissão nenhuma. Se parou de registrar
-- há 2h, a sessão acabou — e o app guarda EM QUAL exercício parou.
-- ---------------------------------------------------------------------
create function private.encerrar_sessoes_ociosas(p_limite interval default '2 hours')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd int := 0;
  r record;
begin
  for r in
    select ts.id, ts.user_id, ts.data,
           (select sr.exercicio_id
              from public.series_registros sr
             where sr.treino_sessao_id = ts.id
             order by sr.registrada_em desc
             limit 1) as ultimo_exercicio
    from public.treino_sessoes ts
    where ts.status = 'em_andamento'::public.status_sessao
      and greatest(
            ts.iniciada_em,
            coalesce((select max(sr.registrada_em)
                        from public.series_registros sr
                       where sr.treino_sessao_id = ts.id), ts.iniciada_em)
          ) < now() - p_limite
  loop
    update public.treino_sessoes
       set status        = 'abandonada'::public.status_sessao,
           finalizada_em = now(),
           abandonou_em_exercicio_id =
             coalesce(abandonou_em_exercicio_id, r.ultimo_exercicio)
     where id = r.id;

    perform private.recalcular_dia(r.user_id, r.data);
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

select cron.schedule(
  'encerrar-sessoes-ociosas',
  '*/15 * * * *',
  $$ select private.encerrar_sessoes_ociosas() $$
);


-- ---------------------------------------------------------------------
-- 4. Fechamento semanal — segunda-feira 00:10 UTC.
--
-- Consolida semanas_resumo da semana que acabou, aplica vida e semana
-- off. O streak nunca é gravado: é derivado disto (streak_de()).
--
-- 00:10 UTC = 21:10 de domingo em São Paulo. A semana do usuário ainda
-- não fechou nesse instante, então o fechamento roda para a semana
-- ANTERIOR à corrente, com folga de sobra para qualquer fuso.
-- ---------------------------------------------------------------------
create function private.fechar_semana_todos(p_semana_inicio date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana date := coalesce(p_semana_inicio, public.inicio_da_semana(current_date) - 7);
  v_qtd int := 0;
  r record;
begin
  for r in select p.id from public.profiles p loop
    perform private.fechar_semana(r.id, v_semana);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

select cron.schedule(
  'fechar-semana',
  '10 0 * * 1',
  $$ select private.fechar_semana_todos() $$
);


-- ---------------------------------------------------------------------
-- 5. Agendar lembretes do dia seguinte — todo dia 03:00 UTC.
--
-- Os dias planejados do programa existem SÓ pra isto. O CONTEÚDO do
-- treino continua vindo da fila de rotação — por isso o corpo do
-- lembrete diz "próximo: treino B", lido de proxima_sessao_id, e não
-- "treino de terça".
-- ---------------------------------------------------------------------
create function private.agendar_lembretes_treino()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd int := 0;
  r record;
  v_quando timestamptz;
  v_dia_local date;
begin
  for r in
    select p.user_id,
           p.hora_lembrete,
           p.dias_lembrete,
           pr.timezone,
           s.letra,
           s.nome
    from public.programas p
    join public.profiles pr on pr.id = p.user_id
    left join public.sessoes s on s.id = p.proxima_sessao_id
    where p.ativo
      and p.hora_lembrete is not null
      and array_length(p.dias_lembrete, 1) > 0
  loop
    -- "Amanhã" no fuso do usuário, não no do servidor.
    v_dia_local := ((now() at time zone r.timezone)::date) + 1;

    continue when not (
      extract(dow from v_dia_local)::smallint = any (r.dias_lembrete)
    );

    -- Monta o instante local e converte de volta pra timestamptz.
    v_quando := (v_dia_local + r.hora_lembrete) at time zone r.timezone;

    insert into public.notificacoes_agendadas
      (user_id, disparar_em, tipo, titulo, corpo, tag, ttl_seg)
    select
      r.user_id,
      v_quando,
      'lembrete_treino',
      'Treino hoje',
      coalesce('Próximo: treino ' || r.letra || ' · ' || r.nome,
               'Seu treino de hoje está esperando'),
      -- Mesma tag por dia: se o cron rodar duas vezes, o aparelho
      -- substitui em vez de empilhar.
      'treino-' || v_dia_local::text,
      1800
    where not exists (
      select 1 from public.notificacoes_agendadas n
      where n.user_id = r.user_id
        and n.tag = 'treino-' || v_dia_local::text
        and n.status = 'pendente'::public.status_notif
    );

    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

select cron.schedule(
  'agendar-lembretes-treino',
  '0 3 * * *',
  $$ select private.agendar_lembretes_treino() $$
);


-- ---------------------------------------------------------------------
-- 6. Limpeza — domingo 04:00 UTC.
-- Histórico de notificação não é dado de produto: 90 dias bastam.
-- ---------------------------------------------------------------------
select cron.schedule(
  'limpar-notificacoes-antigas',
  '0 4 * * 0',
  $$ delete from public.notificacoes_agendadas
      where status <> 'pendente' and criada_em < now() - interval '90 days' $$
);


-- ---------------------------------------------------------------------
-- pg_cron roda como `postgres`. Nenhuma destas funções é alcançável
-- pelo app — nem por REST (schema `private` fora de [api].schemas), nem
-- por GRANT.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant  execute on all functions in schema private to authenticated, service_role;

revoke execute on function
  private.cfg(text),
  private.disparar_fila_push(),
  private.expirar_notificacoes(),
  private.encerrar_sessoes_ociosas(interval),
  private.fechar_semana_todos(date),
  private.agendar_lembretes_treino()
from authenticated;
