-- =====================================================================
-- 05 — Treino: o MOLDE (plano)
-- =====================================================================
-- Camada separada da execução de propósito: editar o plano NUNCA
-- reescreve o passado. Ver 06_treino_execucao.sql.
--
-- ids uuid gerados no CLIENTE (offline-first): o upsert vira idempotente
-- e a fila local reenvia sem duplicar.
-- =====================================================================

create table public.programas (
  id                 uuid primary key,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  divisao            divisao_treino not null,
  enfase             enfase_treino  not null,
  frequencia_semanal smallint not null check (frequencia_semanal between 2 and 6),

  -- Ponteiro da FILA DE ROTAÇÃO. Avança a cada sessão CONCLUÍDA, não por
  -- calendário: furou a terça, o A não se perde — acontece na quinta.
  proxima_sessao_id  uuid,

  -- Dias planejados existem SÓ para agendar lembrete. O conteúdo do dia
  -- vem da fila acima. Misturar as duas coisas é o que quebra a maioria
  -- dos apps de treino.
  dias_lembrete      smallint[] not null default '{}'
                       check (dias_lembrete <@ array[0,1,2,3,4,5,6]::smallint[]),
  hora_lembrete      time,

  -- Marca que o plano veio do fallback de template, não da IA. A tela
  -- avisa e oferece refazer.
  origem_fallback    boolean not null default false,

  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);

-- Um programa ativo por usuário. Refazer o plano desativa o anterior,
-- nunca apaga: o histórico de execução ainda aponta pras sessões dele.
create unique index programas_um_ativo_idx
  on public.programas (user_id) where ativo;

create index programas_user_idx on public.programas (user_id);


create table public.sessoes (
  id          uuid primary key,
  programa_id uuid not null references public.programas(id) on delete cascade,
  letra       text not null check (letra ~ '^[A-E]$'),
  nome        text not null,
  posicao     smallint not null check (posicao >= 0),   -- ordem na fila de rotação
  unique (programa_id, letra),
  unique (programa_id, posicao)
);

create index sessoes_programa_idx on public.sessoes (programa_id);

-- FK circular: programas.proxima_sessao_id → sessoes.id.
-- Só pode ser criada depois das duas tabelas existirem.
alter table public.programas
  add constraint fk_programas_proxima_sessao
  foreign key (proxima_sessao_id) references public.sessoes(id) on delete set null;

create index programas_proxima_sessao_idx
  on public.programas (proxima_sessao_id);


create table public.sessao_exercicios (
  id           uuid primary key,
  sessao_id    uuid not null references public.sessoes(id)    on delete cascade,
  exercicio_id int  not null references public.exercicios(id),
  ordem        smallint not null check (ordem >= 1),
  series       smallint not null check (series between 1 and 10),

  -- Faixa min–max é o que fecha a progressão dupla: atingiu reps_max em
  -- TODAS as séries → sugere subir a carga; senão, repete.
  reps_min     smallint check (reps_min between 1 and 100),
  reps_max     smallint check (reps_max between 1 and 100),
  duracao_seg  smallint check (duracao_seg between 5 and 600),
  descanso_seg smallint not null default 90
                 check (descanso_seg between 15 and 300),

  unique (sessao_id, exercicio_id),
  unique (sessao_id, ordem) deferrable initially deferred,

  -- Espelha a validação 6 do Prompt 1: reps XOR tempo.
  -- O banco é a última linha de defesa contra alucinação da IA.
  constraint ck_reps_xor_tempo check (
       (reps_min is not null and reps_max is not null and duracao_seg is null)
    or (reps_min is null     and reps_max is null     and duracao_seg is not null)
  ),
  constraint ck_faixa_reps check (reps_max is null or reps_max >= reps_min)
);

create index sessao_exercicios_sessao_ordem_idx
  on public.sessao_exercicios (sessao_id, ordem);
create index sessao_exercicios_exercicio_idx
  on public.sessao_exercicios (exercicio_id);


-- ---------------------------------------------------------------------
-- Substitutos pré-gerados pela IA. Salvos e invisíveis até a pessoa
-- tocar em "substituir". São 3 por exercício (Prompt 1).
-- ---------------------------------------------------------------------
create table public.sessao_exercicio_substitutos (
  sessao_exercicio_id uuid not null
                        references public.sessao_exercicios(id) on delete cascade,
  exercicio_id        int  not null references public.exercicios(id),
  posicao             smallint not null check (posicao between 1 and 5),
  primary key (sessao_exercicio_id, exercicio_id)
);

create index sessao_exercicio_substitutos_exercicio_idx
  on public.sessao_exercicio_substitutos (exercicio_id);


-- ---------------------------------------------------------------------
-- Log de alteração PERMANENTE do plano (troca feita fora da sessão).
--
-- Existe por dois motivos:
--   1. "Desfazer" sobrevive a um reload — a regra "fora da sessão é
--      permanente" é implícita, então erro é inevitável e o desfazer
--      precisa ser confiável, não só um toast em memória.
--   2. É coleta do dia 1 (§10): revela o que a pessoa evita no molde,
--      não só na execução.
-- ---------------------------------------------------------------------
create table public.plano_alteracoes (
  id                  uuid primary key,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  sessao_exercicio_id uuid not null references public.sessao_exercicios(id) on delete cascade,
  exercicio_antigo_id int  not null references public.exercicios(id),
  exercicio_novo_id   int  not null references public.exercicios(id),
  desfeita            boolean not null default false,
  criada_em           timestamptz not null default now()
);

create index plano_alteracoes_user_idx
  on public.plano_alteracoes (user_id, criada_em desc);
create index plano_alteracoes_sessao_exercicio_idx
  on public.plano_alteracoes (sessao_exercicio_id);
create index plano_alteracoes_exercicio_antigo_idx
  on public.plano_alteracoes (exercicio_antigo_id);
create index plano_alteracoes_exercicio_novo_idx
  on public.plano_alteracoes (exercicio_novo_id);
