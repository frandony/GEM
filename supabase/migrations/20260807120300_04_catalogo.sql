-- =====================================================================
-- 04 — Catálogo de exercícios (global, somente leitura pro usuário)
-- =====================================================================
-- id serial porque é dado global: não vem do cliente, não precisa ser
-- idempotente contra fila offline. O resto do app usa uuid do cliente.
-- =====================================================================

create table public.exercicios (
  id                  serial primary key,
  nome                text not null unique,
  grupo_primario      grupo_muscular   not null,
  grupos_secundarios  grupo_muscular[] not null default '{}',
  padrao_movimento    padrao_movimento not null,
  equipamento         equipamento      not null,
  incremento_kg       numeric(4,2),
  unilateral          boolean          not null default false,
  medida              medida_exercicio not null default 'reps',
  comum               smallint         not null default 1
                        check (comum between 1 and 3),

  constraint ck_incremento_positivo
    check (incremento_kg is null or incremento_kg > 0)
);

comment on table public.exercicios is
  'Catálogo global. Escrita apenas por service_role (seed/migration).';
comment on column public.exercicios.comum is
  '1 = escolha padrão, 2 = variedade, 3 = só se não houver alternativa. Guia o Prompt 1.';
comment on column public.exercicios.incremento_kg is
  'Degrau de carga: barra 2.5 · halter 2 · máquina 5 · polia 2.5. NULL = progride por reps.';

-- Serve o fallback de substitutos (mesmo grupo + mesmo padrão) e a
-- montagem do catálogo que vai no prompt.
create index exercicios_grupo_padrao_idx
  on public.exercicios (grupo_primario, padrao_movimento);

-- Serve a filtragem por equipamentos_indisponiveis.
create index exercicios_equipamento_idx
  on public.exercicios (equipamento);


-- ---------------------------------------------------------------------
-- Região é DERIVADA, nunca coluna.
-- Uma função, dois usos: valida a ênfase gerada pela IA (checagem 11 do
-- Prompt 1) e alimenta a tela de volume por grupo. É o que faz a ênfase
-- se autovalidar.
-- ---------------------------------------------------------------------
create function public.regiao_do_grupo(g grupo_muscular)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when g in ('peito','costas','ombro','bíceps','tríceps')
      then 'superior'
    when g in ('quadríceps','posterior','glúteo','panturrilha','adutores','abdutores')
      then 'inferior'
    else 'core'
  end
$$;

comment on function public.regiao_do_grupo is
  'superior/inferior/core derivado do grupo muscular. Nunca armazenar.';


-- ---------------------------------------------------------------------
-- Equipamentos aos quais o usuário não tem acesso.
--
-- Decisão do ponto aberto §12 do plano: por EQUIPAMENTO, não por
-- exercício. 7 valores de enum contra 163 exercícios — marcar item a
-- item é onboarding que ninguém termina. Se doer na prática, o upgrade
-- é uma tabela de exceções por exercício, sem mexer nesta.
-- ---------------------------------------------------------------------
create table public.equipamentos_indisponiveis (
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  equipamento equipamento not null,
  criado_em   timestamptz not null default now(),
  primary key (user_id, equipamento)
);


-- ---------------------------------------------------------------------
-- Curtida = preferência declarada, não ação. A IA recebe os ids
-- curtidos no prompt e prioriza. O timestamp existe porque a v2 vai
-- precisar da dimensão temporal (curtiu quando? ainda vale?).
-- ---------------------------------------------------------------------
create table public.exercicios_curtidos (
  user_id      uuid not null references public.profiles(id)  on delete cascade,
  exercicio_id int  not null references public.exercicios(id) on delete cascade,
  curtido_em   timestamptz not null default now(),
  primary key (user_id, exercicio_id)
);

create index exercicios_curtidos_exercicio_idx
  on public.exercicios_curtidos (exercicio_id);
