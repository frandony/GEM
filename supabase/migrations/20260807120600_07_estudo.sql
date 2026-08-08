-- =====================================================================
-- 07 — Estudo
-- =====================================================================
-- A lógica central é retroplanejamento: conteúdo Y até o dia X, resolvido
-- pra trás. A aritmética fica no código (11_rpc_dominio.sql), o
-- julgamento fica na IA (Edge Function montar-estudo).
-- =====================================================================

create table public.materias (
  id        uuid primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  nome      text not null check (length(trim(nome)) between 1 and 80),
  ativa     boolean not null default true,
  inicio    date,
  fim       date,

  -- De onde vieram os tópicos. Muda o aviso na tela de revisão:
  -- `ia_nome_materia` é sempre rascunho, nunca verdade.
  origem    origem_topicos not null default 'manual',
  confianca confianca_extracao not null default 'alta',

  criada_em timestamptz not null default now(),

  constraint ck_periodo check (fim is null or inicio is null or fim >= inicio)
);

create index materias_user_ativa_idx on public.materias (user_id) where ativa;
create index materias_user_idx       on public.materias (user_id);


create table public.topicos (
  id               uuid primary key,
  materia_id       uuid not null references public.materias(id) on delete cascade,
  nome             text not null check (length(trim(nome)) between 3 and 120),

  -- Vem do plano de ensino (Prompt 3). Resolve o ponto aberto do
  -- Prompt 2: pré-requisito deixa de ser inferido pelo nome.
  ordem            smallint not null check (ordem >= 1),

  -- Fase A do Prompt 2. Fica SALVO: não roda de novo a cada
  -- replanejamento, só para tópicos novos.
  blocos_estimados smallint check (blocos_estimados between 1 and 4),
  exige_exercicios boolean not null default false,

  -- Marcados pelo aluno ao longo do tempo, não no cadastro.
  dificuldade      dificuldade,
  compreendido     boolean,     -- do mini-questionário

  criado_em        timestamptz not null default now(),

  unique (materia_id, ordem) deferrable initially deferred
);

create index topicos_materia_idx on public.topicos (materia_id, ordem);


create table public.eventos (
  id         uuid primary key,
  materia_id uuid not null references public.materias(id) on delete cascade,
  tipo       tipo_evento not null,
  data       date not null,
  descricao  text,
  criado_em  timestamptz not null default now()
);

comment on table public.eventos is
  'Matéria é container; prova/entrega são eventos dentro dela. Resolve o caso-limite de múltiplas datas por matéria.';

create index eventos_materia_data_idx on public.eventos (materia_id, data);


-- Prova = conteúdo a absorver: liga a tópicos.
-- Entrega = coisa a produzir: não liga a tópico nenhum, vira marcos.
create table public.evento_topicos (
  evento_id uuid not null references public.eventos(id) on delete cascade,
  topico_id uuid not null references public.topicos(id) on delete cascade,
  primary key (evento_id, topico_id)
);

create index evento_topicos_topico_idx on public.evento_topicos (topico_id);


-- ---------------------------------------------------------------------
-- Grade FIXA de horários. É de onde vem a disciplina, e o ganho técnico:
-- replanejar vira redistribuir tópicos, não remontar calendário.
-- ---------------------------------------------------------------------
create table public.grade_slots (
  id          uuid primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  dia_semana  smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo
  hora        time not null,
  duracao_min smallint not null check (duracao_min between 15 and 240),
  ativo       boolean not null default true,
  unique (user_id, dia_semana, hora)
);

create index grade_slots_user_idx on public.grade_slots (user_id) where ativo;


create table public.limites_estudo (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  max_blocos_dia  smallint not null default 2   check (max_blocos_dia between 1 and 6),
  max_minutos_dia smallint not null default 180 check (max_minutos_dia between 30 and 600),
  dia_leve        smallint check (dia_leve between 0 and 6)
);

comment on table public.limites_estudo is
  '"Saudável" é número configurável, não regra escondida no prompt.';


create table public.blocos (
  id            uuid primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  materia_id    uuid references public.materias(id) on delete cascade,
  topico_id     uuid references public.topicos(id)  on delete set null,
  evento_id     uuid references public.eventos(id)  on delete cascade,  -- tipo 'marco'

  data          date not null,
  hora          time not null,
  duracao_min   smallint not null check (duracao_min between 15 and 240),
  tipo          tipo_bloco not null,
  titulo        text not null,

  status        status_bloco not null default 'pendente',
  iniciado_em   timestamptz,
  finalizado_em timestamptz,

  -- Do timer, NUNCA o planejado. É o que ensina que o bloco de 60min
  -- rende 35 — e o que faz a Fase A deixar de ser chute na v2.
  tempo_real_seg int check (tempo_real_seg >= 0),

  -- Caso-limite 1: bloco não terminado vira retomada em versão resumida.
  retomada_de   uuid references public.blocos(id) on delete set null,

  criado_em     timestamptz not null default now(),

  constraint ck_marco_tem_evento check (tipo <> 'marco' or evento_id is not null),
  constraint ck_bloco_tem_alvo   check (topico_id is not null or evento_id is not null)
);

create index blocos_user_data_idx on public.blocos (user_id, data);
create index blocos_pendentes_idx on public.blocos (user_id, data)
  where status = 'pendente';
create index blocos_materia_idx   on public.blocos (materia_id);
create index blocos_topico_idx    on public.blocos (topico_id);
create index blocos_evento_idx    on public.blocos (evento_id);
create index blocos_retomada_idx  on public.blocos (retomada_de);


-- ---------------------------------------------------------------------
-- Mini-questionário do fim do bloco. PRIVADO, mesmo dentro do grupo:
-- marcar "não entendi" tem custo emocional.
-- Não pergunta o que o app já sabe — o timer já tem o tempo.
-- ---------------------------------------------------------------------
create table public.bloco_respostas (
  bloco_id      uuid primary key references public.blocos(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  focou         boolean,
  entendeu      boolean,       -- o gatilho de reformulação
  quer_revisar  boolean,       -- marca o tópico pra revisão pré-prova
  dificuldade   dificuldade,
  respondido_em timestamptz not null default now()
);

create index bloco_respostas_user_idx on public.bloco_respostas (user_id, respondido_em desc);


-- ---------------------------------------------------------------------
-- O que a IA não conseguiu alocar. Alimenta o contador de
-- "N tópicos aguardando replanejamento" na home.
-- ---------------------------------------------------------------------
create table public.topicos_pendentes (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  topico_id uuid not null references public.topicos(id)  on delete cascade,
  motivo    text,
  criado_em timestamptz not null default now(),
  primary key (user_id, topico_id)
);

create index topicos_pendentes_topico_idx on public.topicos_pendentes (topico_id);


-- ---------------------------------------------------------------------
-- Avisos que o app parou de mostrar por um tempo.
--
-- Caso-limite 1: "3 blocos não terminados em 7 dias" dispara a pergunta
-- de dificuldade — e ela NÃO se repete por 2 semanas. Sem uma tabela, o
-- app vira o chato que pergunta toda vez.
-- ---------------------------------------------------------------------
create table public.avisos_silenciados (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  aviso       text not null,        -- ex.: 'dificuldade_estudo', 'tornar_troca_permanente'
  silenciado_ate date not null,
  criado_em   timestamptz not null default now(),
  primary key (user_id, aviso)
);
