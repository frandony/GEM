-- =====================================================================
-- 11 — RLS e GRANTs
-- =====================================================================
-- Duas camadas independentes, e as duas são obrigatórias:
--
--   GRANT  → a tabela é ALCANÇÁVEL pela Data API?
--   RLS    → uma vez alcançável, QUAIS LINHAS aparecem?
--
-- Desde 2026-04-28 tabelas novas em `public` não recebem GRANT
-- automático. Sem os GRANTs abaixo o app recebe 401/permission denied
-- mesmo com a policy correta. Sem RLS, o GRANT expõe tudo.
--
-- Matriz de visibilidade:
--   próprio        → tudo
--   grupo          → perfil, plano, resumo diário, streak (via RPC), curtidas,
--                    semana off, revisão semanal marcada como compartilhada
--   privado sempre → vidas, respostas do bloco, notificações, execução do
--                    treino, estudo, semanas_resumo
--
-- Toda policy segue três regras da skill do Supabase:
--   1. `to authenticated` — nunca `auth.role()`, nunca policy sem role
--   2. `(select auth.uid())` — subselect faz o Postgres avaliar UMA vez
--      (initplan) em vez de uma vez por linha
--   3. UPDATE precisa de USING **e** WITH CHECK — sem WITH CHECK o
--      usuário reatribui a linha pra outra pessoa
-- =====================================================================


-- ---------------------------------------------------------------------
-- Helpers de posse. Em `private` porque precisam furar RLS para
-- responder "de quem é a linha pai?" sem recursão de policy.
-- ---------------------------------------------------------------------
create function private.dono_do_programa(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.programas where id = p
$$;

create function private.dono_da_sessao(s uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pr.user_id from public.sessoes se
  join public.programas pr on pr.id = se.programa_id
  where se.id = s
$$;

create function private.dono_do_sessao_exercicio(se uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pr.user_id from public.sessao_exercicios sx
  join public.sessoes s   on s.id  = sx.sessao_id
  join public.programas pr on pr.id = s.programa_id
  where sx.id = se
$$;

create function private.dono_da_treino_sessao(t uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.treino_sessoes where id = t
$$;

create function private.dono_da_materia(m uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.materias where id = m
$$;

create function private.dono_do_topico(t uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.topicos tp
  join public.materias m on m.id = tp.materia_id
  where tp.id = t
$$;

create function private.dono_do_evento(e uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.eventos ev
  join public.materias m on m.id = ev.materia_id
  where ev.id = e
$$;

create function private.dono_do_bloco(b uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.blocos where id = b
$$;


-- ---------------------------------------------------------------------
-- GRANTs — o que é ALCANÇÁVEL pela Data API
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- `anon` não recebe nada: o app inteiro vive atrás de login.
-- (auth.users / signup não passa por este schema.)

-- Catálogo: leitura para logado, escrita só por service_role (seed).
grant select on table public.exercicios to authenticated;
grant all    on table public.exercicios to service_role;
grant usage, select on sequence public.exercicios_id_seq to service_role;

-- Tabelas do usuário: CRUD completo — quem filtra é a RLS, não o GRANT.
grant select, insert, update, delete on table
  public.profiles,
  public.grupos,
  public.grupo_membros,
  public.equipamentos_indisponiveis,
  public.exercicios_curtidos,
  public.programas,
  public.sessoes,
  public.sessao_exercicios,
  public.sessao_exercicio_substitutos,
  public.plano_alteracoes,
  public.treino_sessoes,
  public.series_registros,
  public.materias,
  public.topicos,
  public.eventos,
  public.evento_topicos,
  public.grade_slots,
  public.limites_estudo,
  public.blocos,
  public.bloco_respostas,
  public.topicos_pendentes,
  public.avisos_silenciados,
  public.semanas_off,
  public.semanas_resumo,
  public.vidas_mes,
  public.revisoes_semanais,
  public.resumos_diarios,
  public.reacoes_resumo,
  public.push_subscriptions,
  public.notificacoes_agendadas
to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;


-- ---------------------------------------------------------------------
-- RLS ligada em TODAS as tabelas de `public`.
-- Tabela com RLS ligada e sem policy = ninguém lê nada. Por isso cada
-- uma abaixo ganha policy explícita logo em seguida.
-- ---------------------------------------------------------------------
alter table public.exercicios                   enable row level security;
alter table public.profiles                     enable row level security;
alter table public.grupos                       enable row level security;
alter table public.grupo_membros                enable row level security;
alter table public.equipamentos_indisponiveis   enable row level security;
alter table public.exercicios_curtidos          enable row level security;
alter table public.programas                    enable row level security;
alter table public.sessoes                      enable row level security;
alter table public.sessao_exercicios            enable row level security;
alter table public.sessao_exercicio_substitutos enable row level security;
alter table public.plano_alteracoes             enable row level security;
alter table public.treino_sessoes               enable row level security;
alter table public.series_registros             enable row level security;
alter table public.materias                     enable row level security;
alter table public.topicos                      enable row level security;
alter table public.eventos                      enable row level security;
alter table public.evento_topicos               enable row level security;
alter table public.grade_slots                  enable row level security;
alter table public.limites_estudo               enable row level security;
alter table public.blocos                       enable row level security;
alter table public.bloco_respostas              enable row level security;
alter table public.topicos_pendentes            enable row level security;
alter table public.avisos_silenciados           enable row level security;
alter table public.semanas_off                  enable row level security;
alter table public.semanas_resumo               enable row level security;
alter table public.vidas_mes                    enable row level security;
alter table public.revisoes_semanais            enable row level security;
alter table public.resumos_diarios              enable row level security;
alter table public.reacoes_resumo               enable row level security;
alter table public.push_subscriptions           enable row level security;
alter table public.notificacoes_agendadas       enable row level security;


-- =====================================================================
-- CATÁLOGO — leitura global, escrita só por service_role
-- =====================================================================
create policy "catalogo: qualquer logado lê" on public.exercicios
  for select to authenticated using (true);
-- Sem policy de escrita: authenticated não insere nem altera.
-- service_role tem bypassrls e continua podendo semear.


-- =====================================================================
-- PERFIL E GRUPO
-- =====================================================================
create policy "perfil: dono ou grupo lê" on public.profiles
  for select to authenticated
  using (private.pode_ver(id));

create policy "perfil: dono insere" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy "perfil: dono edita" on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));


create policy "grupo: membro lê" on public.grupos
  for select to authenticated
  using (id in (select private.grupos_do_usuario()));

create policy "grupo: criador cria" on public.grupos
  for insert to authenticated
  with check (criado_por = (select auth.uid()));

create policy "grupo: criador edita" on public.grupos
  for update to authenticated
  using      (criado_por = (select auth.uid()))
  with check (criado_por = (select auth.uid()));

create policy "grupo: criador apaga" on public.grupos
  for delete to authenticated
  using (criado_por = (select auth.uid()));


-- grupos_do_usuario() é SECURITY DEFINER: sem ela esta policy consultaria
-- grupo_membros dentro da policy de grupo_membros → recursão (42P17).
create policy "membros: mesmo grupo lê" on public.grupo_membros
  for select to authenticated
  using (grupo_id in (select private.grupos_do_usuario()));

-- Entrar é só pela RPC entrar_no_grupo(codigo): quem não é membro não
-- consegue nem enxergar o grupo pra descobrir o id.
create policy "membros: sai do próprio grupo" on public.grupo_membros
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =====================================================================
-- PREFERÊNCIAS DE TREINO
-- =====================================================================
create policy "equipamentos: dono" on public.equipamentos_indisponiveis
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "curtidas: dono ou grupo lê" on public.exercicios_curtidos
  for select to authenticated
  using (private.pode_ver(user_id));

create policy "curtidas: dono escreve" on public.exercicios_curtidos
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "curtidas: dono descurte" on public.exercicios_curtidos
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =====================================================================
-- TREINO — MOLDE (visível ao grupo: "planos do dia lado a lado")
-- =====================================================================
create policy "programa: dono ou grupo lê" on public.programas
  for select to authenticated
  using (private.pode_ver(user_id));

create policy "programa: dono escreve" on public.programas
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "programa: dono edita" on public.programas
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "programa: dono apaga" on public.programas
  for delete to authenticated
  using (user_id = (select auth.uid()));


create policy "sessao: dono ou grupo lê" on public.sessoes
  for select to authenticated
  using (private.pode_ver(private.dono_do_programa(programa_id)));

create policy "sessao: dono escreve" on public.sessoes
  for insert to authenticated
  with check (private.dono_do_programa(programa_id) = (select auth.uid()));

create policy "sessao: dono edita" on public.sessoes
  for update to authenticated
  using      (private.dono_do_programa(programa_id) = (select auth.uid()))
  with check (private.dono_do_programa(programa_id) = (select auth.uid()));

create policy "sessao: dono apaga" on public.sessoes
  for delete to authenticated
  using (private.dono_do_programa(programa_id) = (select auth.uid()));


create policy "exercicio do plano: dono ou grupo lê" on public.sessao_exercicios
  for select to authenticated
  using (private.pode_ver(private.dono_da_sessao(sessao_id)));

create policy "exercicio do plano: dono escreve" on public.sessao_exercicios
  for insert to authenticated
  with check (private.dono_da_sessao(sessao_id) = (select auth.uid()));

create policy "exercicio do plano: dono edita" on public.sessao_exercicios
  for update to authenticated
  using      (private.dono_da_sessao(sessao_id) = (select auth.uid()))
  with check (private.dono_da_sessao(sessao_id) = (select auth.uid()));

create policy "exercicio do plano: dono apaga" on public.sessao_exercicios
  for delete to authenticated
  using (private.dono_da_sessao(sessao_id) = (select auth.uid()));


create policy "substitutos: dono ou grupo lê" on public.sessao_exercicio_substitutos
  for select to authenticated
  using (private.pode_ver(private.dono_do_sessao_exercicio(sessao_exercicio_id)));

create policy "substitutos: dono escreve" on public.sessao_exercicio_substitutos
  for insert to authenticated
  with check (private.dono_do_sessao_exercicio(sessao_exercicio_id) = (select auth.uid()));

create policy "substitutos: dono apaga" on public.sessao_exercicio_substitutos
  for delete to authenticated
  using (private.dono_do_sessao_exercicio(sessao_exercicio_id) = (select auth.uid()));


create policy "alteracoes do plano: dono" on public.plano_alteracoes
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- =====================================================================
-- TREINO — EXECUÇÃO (privada; o grupo vê só o resumo diário)
-- =====================================================================
create policy "treino: dono" on public.treino_sessoes
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Checa pelo PAI, não por new.user_id: o valor de user_id é preenchido
-- por trigger, e a policy não deve depender da ordem trigger x RLS.
create policy "serie: dono" on public.series_registros
  for all to authenticated
  using      (private.dono_da_treino_sessao(treino_sessao_id) = (select auth.uid()))
  with check (private.dono_da_treino_sessao(treino_sessao_id) = (select auth.uid()));


-- =====================================================================
-- ESTUDO (inteiramente privado)
-- =====================================================================
create policy "materia: dono" on public.materias
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "topico: dono" on public.topicos
  for all to authenticated
  using      (private.dono_da_materia(materia_id) = (select auth.uid()))
  with check (private.dono_da_materia(materia_id) = (select auth.uid()));

create policy "evento: dono" on public.eventos
  for all to authenticated
  using      (private.dono_da_materia(materia_id) = (select auth.uid()))
  with check (private.dono_da_materia(materia_id) = (select auth.uid()));

create policy "evento_topico: dono" on public.evento_topicos
  for all to authenticated
  using      (private.dono_do_evento(evento_id) = (select auth.uid()))
  with check (private.dono_do_evento(evento_id) = (select auth.uid()));

create policy "grade: dono" on public.grade_slots
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "limites: dono" on public.limites_estudo
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "bloco: dono" on public.blocos
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Mini-questionário: privado mesmo dentro do grupo, sem exceção.
create policy "resposta do bloco: dono" on public.bloco_respostas
  for all to authenticated
  using      (private.dono_do_bloco(bloco_id) = (select auth.uid()))
  with check (private.dono_do_bloco(bloco_id) = (select auth.uid()));

create policy "topico pendente: dono" on public.topicos_pendentes
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "aviso silenciado: dono" on public.avisos_silenciados
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- =====================================================================
-- STREAK E SEMANAS
-- =====================================================================
-- Semana off é visível ao grupo: é o que explica um "sumiço" no painel
-- sem ninguém precisar avisar.
create policy "semana off: dono ou grupo lê" on public.semanas_off
  for select to authenticated
  using (private.pode_ver(user_id));

create policy "semana off: dono declara" on public.semanas_off
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "semana off: dono cancela" on public.semanas_off
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- PRIVADA, apesar do streak ser público: a linha carrega `usou_vida`, e
-- vida é vulnerabilidade. O grupo lê o streak pela RPC streak_de(),
-- que devolve só o número.
create policy "semana resumo: dono" on public.semanas_resumo
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "vidas: dono" on public.vidas_mes
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- Privada por padrão, com opção EXPLÍCITA de compartilhar.
create policy "revisao: dono lê" on public.revisoes_semanais
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (compartilhada and private.mesmo_grupo(user_id))
  );

create policy "revisao: dono escreve" on public.revisoes_semanais
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "revisao: dono edita" on public.revisoes_semanais
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- =====================================================================
-- FEED
-- =====================================================================
create policy "resumo diario: dono ou grupo lê" on public.resumos_diarios
  for select to authenticated
  using (private.pode_ver(user_id));

-- Escrita é por trigger/RPC (service_role), mas o dono pode corrigir.
create policy "resumo diario: dono escreve" on public.resumos_diarios
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "resumo diario: dono edita" on public.resumos_diarios
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


create policy "reacao: visível a quem divide grupo" on public.reacoes_resumo
  for select to authenticated
  using (user_id = (select auth.uid()) or private.pode_ver(alvo_user_id));

-- Só reage a quem está no seu grupo.
create policy "reacao: dono reage" on public.reacoes_resumo
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.mesmo_grupo(alvo_user_id)
  );

create policy "reacao: dono desfaz" on public.reacoes_resumo
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- =====================================================================
-- NOTIFICAÇÕES (privadas sempre)
-- =====================================================================
create policy "inscricao push: dono" on public.push_subscriptions
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "notificacao: dono" on public.notificacoes_agendadas
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- Funções: fechar o default do Postgres.
-- Todo CREATE FUNCTION concede EXECUTE a PUBLIC automaticamente. Para as
-- de `private` isso importa pouco (anon não tem USAGE no schema), mas
-- explícito é melhor que implícito.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant  execute on all functions in schema private to authenticated, service_role;
