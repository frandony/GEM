-- =====================================================================
-- APP ESTUDO + TREINO — schema v1 (Supabase / Postgres)
-- =====================================================================
-- Convenções:
--   * ids de conteúdo do usuário são uuid gerados no CLIENTE (offline-first).
--     Isso torna o upsert idempotente: a fila local reenvia sem duplicar.
--   * datas de calendário são `date` no fuso do usuário (profiles.timezone).
--     Timestamps de evento são `timestamptz`. Nunca misturar os dois.
--   * o catálogo usa id serial — é dado global, não vem do cliente.
-- =====================================================================


-- =====================================================================
-- 1. ENUMS
-- =====================================================================

create type grupo_muscular as enum (
  'peito','costas','ombro','bíceps','tríceps',
  'quadríceps','posterior','glúteo','panturrilha','adutores','abdutores',
  'abdômen','lombar'
);

-- superior/inferior é DERIVADO daqui, nunca armazenado (ver função regiao_do_grupo)

create type padrao_movimento as enum (
  'empurrar horizontal','empurrar vertical','puxar horizontal','puxar vertical',
  'isolamento de peito','isolamento de costas','isolamento de ombro',
  'isolamento de braço','isolamento de antebraço',
  'dominante de joelho','dominante de quadril','unilateral',
  'isolamento de perna','panturrilha',
  'flexão de tronco','antiextensão','rotação','extensão de tronco',
  'carregamento'
);

create type equipamento as enum (
  'barra','halter','máquina','polia','peso corporal','anilha','elástico'
);

create type medida_exercicio as enum ('reps','tempo');
create type enfase_treino   as enum ('superior','inferior','equilibrado');
create type divisao_treino  as enum ('AB','ABC','ABCD','ABCDE');

create type status_sessao   as enum ('em_andamento','concluida','abandonada');
create type tipo_bloco      as enum ('leitura','exercicios','revisao','marco');
create type status_bloco    as enum ('pendente','concluido','parcial','pulado');
create type tipo_evento     as enum ('prova','entrega');
create type dificuldade     as enum ('facil','medio','dificil');
create type status_notif    as enum ('pendente','enviada','cancelada','expirada');


-- =====================================================================
-- 2. PERFIL E GRUPO
-- =====================================================================

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  nome        text not null,
  foto_url    text,
  timezone    text not null default 'America/Sao_Paulo',
  criado_em   timestamptz not null default now()
);

create table grupos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  criado_por      uuid not null references profiles(id),
  codigo_convite  text not null unique,
  criado_em       timestamptz not null default now()
);

create table grupo_membros (
  grupo_id  uuid not null references grupos(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  entrou_em timestamptz not null default now(),
  primary key (grupo_id, user_id)
);

create index on grupo_membros (user_id);


-- =====================================================================
-- 3. CATÁLOGO DE EXERCÍCIOS  (global, somente leitura pro usuário)
-- =====================================================================

create table exercicios (
  id                  serial primary key,
  nome                text not null unique,
  grupo_primario      grupo_muscular not null,
  grupos_secundarios  grupo_muscular[] not null default '{}',
  padrao_movimento    padrao_movimento not null,
  equipamento         equipamento not null,
  incremento_kg       numeric(4,2),        -- null = não progride por carga
  unilateral          boolean not null default false,
  medida              medida_exercicio not null default 'reps',
  comum               smallint not null default 1 check (comum between 1 and 3)
);

create index on exercicios (grupo_primario, padrao_movimento);

-- região é derivada, nunca coluna
create function regiao_do_grupo(g grupo_muscular) returns text
language sql immutable as $$
  select case
    when g in ('peito','costas','ombro','bíceps','tríceps') then 'superior'
    when g in ('quadríceps','posterior','glúteo','panturrilha','adutores','abdutores') then 'inferior'
    else 'core'
  end
$$;


-- =====================================================================
-- 4. TREINO — MOLDE
-- =====================================================================

create table programas (
  id                 uuid primary key,
  user_id            uuid not null references profiles(id) on delete cascade,
  divisao            divisao_treino not null,
  enfase             enfase_treino not null,
  frequencia_semanal smallint not null check (frequencia_semanal between 2 and 6),
  proxima_sessao_id  uuid,                 -- ponteiro da FILA DE ROTAÇÃO
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);

create unique index on programas (user_id) where ativo;

create table sessoes (
  id           uuid primary key,
  programa_id  uuid not null references programas(id) on delete cascade,
  letra        text not null,              -- 'A','B','C'...
  nome         text not null,
  posicao      smallint not null,          -- ordem na fila de rotação
  unique (programa_id, letra)
);

alter table programas
  add constraint fk_proxima_sessao
  foreign key (proxima_sessao_id) references sessoes(id) on delete set null;

create table sessao_exercicios (
  id            uuid primary key,
  sessao_id     uuid not null references sessoes(id) on delete cascade,
  exercicio_id  int  not null references exercicios(id),
  ordem         smallint not null,
  series        smallint not null,
  reps_min      smallint,
  reps_max      smallint,
  duracao_seg   smallint,
  descanso_seg  smallint not null default 90,
  unique (sessao_id, exercicio_id),
  -- espelha a validação 6 do Prompt 1: reps XOR tempo
  check ( (reps_min is not null and duracao_seg is null)
       or (reps_min is null     and duracao_seg is not null) )
);

create index on sessao_exercicios (sessao_id, ordem);

-- substitutos pré-gerados pela IA
create table sessao_exercicio_substitutos (
  sessao_exercicio_id uuid not null references sessao_exercicios(id) on delete cascade,
  exercicio_id        int  not null references exercicios(id),
  posicao             smallint not null,
  primary key (sessao_exercicio_id, exercicio_id)
);


-- =====================================================================
-- 5. TREINO — EXECUÇÃO
-- =====================================================================
-- Camada separada do molde de propósito: editar o plano NUNCA reescreve
-- o passado. Por isso o registro guarda exercicio_id próprio.

create table treino_sessoes (
  id             uuid primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  sessao_id      uuid references sessoes(id) on delete set null,
  data           date not null,            -- no fuso do usuário
  iniciada_em    timestamptz not null,
  finalizada_em  timestamptz,
  status         status_sessao not null default 'em_andamento',
  -- máquina de estado: 'em_andamento' é o que define substituição circunstancial.
  -- encerramento automático por inatividade marca 'abandonada'.
  abandonou_em_exercicio_id int references exercicios(id)
);

create index on treino_sessoes (user_id, data desc);
create index on treino_sessoes (user_id) where status = 'em_andamento';

create table series_registros (
  id                 uuid primary key,     -- gerado no cliente (offline)
  treino_sessao_id   uuid not null references treino_sessoes(id) on delete cascade,
  exercicio_id       int  not null references exercicios(id),   -- o que foi FEITO
  planejado_id       int  references exercicios(id),            -- o que estava no plano
  numero_serie       smallint not null,
  reps               smallint,
  carga_kg           numeric(6,2),
  duracao_seg        smallint,
  completou          boolean not null default true,
  registrada_em      timestamptz not null default now(),
  unique (treino_sessao_id, exercicio_id, numero_serie)
);

create index on series_registros (exercicio_id, registrada_em desc);
-- ^ índice que serve a sugestão de progressão de carga (última carga do exercício)

-- substituição circunstancial = exercicio_id <> planejado_id
-- é o que alimenta o aviso de "trocou 3 das últimas 4 vezes"

create table exercicios_curtidos (
  user_id      uuid not null references profiles(id) on delete cascade,
  exercicio_id int  not null references exercicios(id),
  curtido_em   timestamptz not null default now(),
  primary key (user_id, exercicio_id)
);


-- =====================================================================
-- 6. ESTUDO
-- =====================================================================

create table materias (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  nome        text not null,
  ativa       boolean not null default true,
  inicio      date,
  fim         date,
  criada_em   timestamptz not null default now()
);

create index on materias (user_id) where ativa;

create table topicos (
  id                uuid primary key,
  materia_id        uuid not null references materias(id) on delete cascade,
  nome              text not null,
  ordem             smallint not null,          -- vem do plano de ensino (Prompt 3)
  blocos_estimados  smallint,                   -- Fase A do Prompt 2, fica salvo
  exige_exercicios  boolean not null default false,
  dificuldade       dificuldade,                -- marcada pelo aluno ao longo do tempo
  compreendido      boolean,                    -- do mini-questionário
  unique (materia_id, ordem)
);

create table eventos (
  id          uuid primary key,
  materia_id  uuid not null references materias(id) on delete cascade,
  tipo        tipo_evento not null,
  data        date not null,
  descricao   text
);

create index on eventos (materia_id, data);

create table evento_topicos (
  evento_id  uuid not null references eventos(id) on delete cascade,
  topico_id  uuid not null references topicos(id) on delete cascade,
  primary key (evento_id, topico_id)
);

-- grade fixa de horários (a disciplina vem daqui)
create table grade_slots (
  id           uuid primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  dia_semana   smallint not null check (dia_semana between 0 and 6),
  hora         time not null,
  duracao_min  smallint not null,
  unique (user_id, dia_semana, hora)
);

create table limites_estudo (
  user_id          uuid primary key references profiles(id) on delete cascade,
  max_blocos_dia   smallint not null default 2,
  max_minutos_dia  smallint not null default 180,
  dia_leve         smallint check (dia_leve between 0 and 6)
);

create table blocos (
  id             uuid primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  materia_id     uuid references materias(id) on delete cascade,
  topico_id      uuid references topicos(id) on delete set null,
  evento_id      uuid references eventos(id) on delete cascade,  -- para tipo 'marco'
  data           date not null,
  hora           time not null,
  duracao_min    smallint not null,
  tipo           tipo_bloco not null,
  titulo         text not null,
  status         status_bloco not null default 'pendente',
  iniciado_em    timestamptz,
  finalizado_em  timestamptz,
  tempo_real_seg int                       -- do timer. NUNCA o planejado.
);

create index on blocos (user_id, data);
create index on blocos (user_id, status) where status = 'pendente';

-- mini-questionário sim/não do fim do bloco. PRIVADO, mesmo dentro do grupo.
create table bloco_respostas (
  bloco_id      uuid primary key references blocos(id) on delete cascade,
  focou         boolean,
  entendeu      boolean,
  quer_revisar  boolean,
  dificuldade   dificuldade,
  respondido_em timestamptz not null default now()
);

-- tópicos que a IA não conseguiu alocar → contador na home
create table topicos_pendentes (
  user_id    uuid not null references profiles(id) on delete cascade,
  topico_id  uuid not null references topicos(id) on delete cascade,
  motivo     text,
  criado_em  timestamptz not null default now(),
  primary key (user_id, topico_id)
);


-- =====================================================================
-- 7. STREAK, SEMANA OFF, REVISÃO SEMANAL
-- =====================================================================
-- semana_inicio = sempre a segunda-feira (date_trunc('week', ...))

create table semanas_off (
  user_id        uuid not null references profiles(id) on delete cascade,
  semana_inicio  date not null,
  declarada_em   timestamptz not null default now(),
  primary key (user_id, semana_inicio)
);
-- regras aplicadas em trigger/edge function, não no schema:
--   * declarada_em < semana_inicio  (antecedência: até o domingo anterior)
--   * máx 6 por semestre — semestre fixo, jan e jul, contado pelo dia de INÍCIO

create table semanas_resumo (
  user_id         uuid not null references profiles(id) on delete cascade,
  semana_inicio   date not null,
  meta_treinos    smallint not null,       -- frequência escolhida no onboarding
  treinos_feitos  smallint not null default 0,
  blocos_feitos   smallint not null default 0,
  blocos_planejados smallint not null default 0,
  minutos_estudo  int not null default 0,
  usou_vida       boolean not null default false,
  off             boolean not null default false,
  contou_streak   boolean not null default false,
  primary key (user_id, semana_inicio)
);
-- streak é DERIVADO desta tabela (sequência de contou_streak = true).
-- Não guardar contador — recalcular evita estado inconsistente.

create table vidas_mes (
  user_id     uuid not null references profiles(id) on delete cascade,
  mes_ref     date not null,               -- sempre dia 1
  usadas      smallint not null default 0 check (usadas between 0 and 4),
  primary key (user_id, mes_ref)
);

create table revisoes_semanais (
  id             uuid primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  semana_inicio  date not null,
  energia        smallint check (energia between 1 and 5),
  atrapalhou     text[] not null default '{}',  -- opções FIXAS, não texto livre
  observacao     text,
  pulada         boolean not null default false, -- pular também é dado
  compartilhada  boolean not null default false,
  respondida_em  timestamptz not null default now(),
  unique (user_id, semana_inicio)
);


-- =====================================================================
-- 8. FEED (painel, não timeline)
-- =====================================================================

create table resumos_diarios (
  user_id         uuid not null references profiles(id) on delete cascade,
  data            date not null,
  treinou         boolean not null default false,
  sessao_letra    text,
  series_total    smallint not null default 0,
  blocos_feitos   smallint not null default 0,
  minutos_estudo  int not null default 0,
  atualizado_em   timestamptz not null default now(),
  primary key (user_id, data)
);

create table reacoes_resumo (
  user_id        uuid not null references profiles(id) on delete cascade,
  alvo_user_id   uuid not null references profiles(id) on delete cascade,
  data           date not null,
  criada_em      timestamptz not null default now(),
  primary key (user_id, alvo_user_id, data)
);


-- =====================================================================
-- 9. NOTIFICAÇÕES
-- =====================================================================

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  criada_em  timestamptz not null default now()
);
-- a inscrição se perde (reinstalação, limpeza do Safari).
-- revalidar a cada abertura do app e reinscrever.

create table notificacoes_agendadas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  disparar_em  timestamptz not null,
  tipo         text not null,
  titulo       text not null,
  corpo        text,
  tag          text,          -- notificação com mesma tag SUBSTITUI a anterior
  ttl_seg      int not null default 300,  -- curto: aviso atrasado é pior que nenhum
  status       status_notif not null default 'pendente',
  criada_em    timestamptz not null default now()
);

create index on notificacoes_agendadas (disparar_em)
  where status = 'pendente';
-- pg_cron de 1 minuto varre este índice.
-- Cancelar = update para 'cancelada'. A janela de risco é o intervalo do cron.


-- =====================================================================
-- 10. RLS
-- =====================================================================
-- Matriz de visibilidade:
--   próprio          → tudo
--   grupo            → perfil, plano (programa/sessões), resumo diário, streak, curtidas
--   privado sempre   → vidas, revisão semanal, respostas do bloco, notificações

alter table profiles              enable row level security;
alter table grupos                enable row level security;
alter table grupo_membros         enable row level security;
alter table programas             enable row level security;
alter table sessoes               enable row level security;
alter table sessao_exercicios     enable row level security;
alter table sessao_exercicio_substitutos enable row level security;
alter table treino_sessoes        enable row level security;
alter table series_registros      enable row level security;
alter table exercicios_curtidos   enable row level security;
alter table materias              enable row level security;
alter table topicos               enable row level security;
alter table eventos               enable row level security;
alter table evento_topicos        enable row level security;
alter table grade_slots           enable row level security;
alter table limites_estudo        enable row level security;
alter table blocos                enable row level security;
alter table bloco_respostas       enable row level security;
alter table topicos_pendentes     enable row level security;
alter table semanas_off           enable row level security;
alter table semanas_resumo        enable row level security;
alter table vidas_mes             enable row level security;
alter table revisoes_semanais     enable row level security;
alter table resumos_diarios       enable row level security;
alter table reacoes_resumo        enable row level security;
alter table push_subscriptions    enable row level security;
alter table notificacoes_agendadas enable row level security;
alter table exercicios            enable row level security;

-- catálogo: leitura para qualquer autenticado, escrita só por service_role
create policy "catalogo leitura" on exercicios
  for select to authenticated using (true);

-- helper: os dois usuários compartilham grupo?
create function mesmo_grupo(outro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grupo_membros a
    join grupo_membros b on a.grupo_id = b.grupo_id
    where a.user_id = auth.uid() and b.user_id = outro
  )
$$;

-- === privado: só o dono ===
-- aplicar este padrão a: vidas_mes, revisoes_semanais, bloco_respostas,
-- push_subscriptions, notificacoes_agendadas, limites_estudo, grade_slots,
-- topicos_pendentes, semanas_resumo, treino_sessoes, series_registros,
-- blocos, materias, topicos, eventos
create policy "dono" on vidas_mes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- === visível ao grupo (leitura) + dono escreve ===
create policy "perfil visivel ao grupo" on profiles
  for select using (id = auth.uid() or mesmo_grupo(id));
create policy "perfil dono escreve" on profiles
  for update using (id = auth.uid());

create policy "plano visivel ao grupo" on programas
  for select using (user_id = auth.uid() or mesmo_grupo(user_id));
create policy "plano dono escreve" on programas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "resumo visivel ao grupo" on resumos_diarios
  for select using (user_id = auth.uid() or mesmo_grupo(user_id));
create policy "resumo dono escreve" on resumos_diarios
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "semana visivel ao grupo" on semanas_off
  for select using (user_id = auth.uid() or mesmo_grupo(user_id));
create policy "semana dono escreve" on semanas_off
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "curtidas visiveis ao grupo" on exercicios_curtidos
  for select using (user_id = auth.uid() or mesmo_grupo(user_id));
create policy "curtidas dono escreve" on exercicios_curtidos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
