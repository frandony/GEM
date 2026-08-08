-- =====================================================================
-- 06 — Treino: a EXECUÇÃO
-- =====================================================================
-- Camada separada do molde. O registro guarda `exercicio_id` próprio,
-- então editar o plano não reescreve o passado.
--
-- Esta é a tabela mais crítica do app: registrar série NUNCA pode falhar
-- por rede. Escrita otimista no cliente, fila local, sync depois. Por
-- isso todo id vem do cliente e todo upsert é idempotente.
-- =====================================================================

create table public.treino_sessoes (
  id            uuid primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,

  -- `set null`: se o plano for refeito, a execução passada continua
  -- existindo mesmo perdendo o vínculo com o molde.
  sessao_id     uuid references public.sessoes(id) on delete set null,

  -- Congelados no início. Se o molde mudar depois, o histórico ainda diz
  -- "isto foi o treino B". `sessao_id` sozinho não garante isso.
  sessao_letra  text,
  sessao_nome   text,

  data          date not null,              -- calendário no fuso do usuário
  iniciada_em   timestamptz not null,       -- horário REAL, não só a data (§10)
  finalizada_em timestamptz,

  status        status_sessao not null default 'em_andamento',

  -- Onde parou, não só "abandonou". Coleta do dia 1.
  abandonou_em_exercicio_id int references public.exercicios(id),

  criada_em     timestamptz not null default now(),

  constraint ck_finalizada_coerente check (
       (status = 'em_andamento' and finalizada_em is null)
    or (status <> 'em_andamento' and finalizada_em is not null)
  ),
  constraint ck_ordem_temporal check (
    finalizada_em is null or finalizada_em >= iniciada_em
  )
);

comment on table public.treino_sessoes is
  'Máquina de estado: em_andamento → concluida | abandonada. Iniciar é obrigatório: é o que define se uma substituição é circunstancial.';

create index treino_sessoes_user_data_idx
  on public.treino_sessoes (user_id, data desc);

-- Parcial: só existe 0 ou 1 linha por usuário aqui. Índice minúsculo,
-- responde "tem treino aberto?" sem tocar no histórico inteiro.
create index treino_sessoes_em_andamento_idx
  on public.treino_sessoes (user_id, iniciada_em)
  where status = 'em_andamento';

create index treino_sessoes_sessao_idx
  on public.treino_sessoes (sessao_id);
create index treino_sessoes_abandono_idx
  on public.treino_sessoes (abandonou_em_exercicio_id);

-- Um treino aberto por vez. Sem isto, um app offline que reabre em dois
-- dispositivos cria duas sessões e o registro de série se divide.
create unique index treino_sessoes_um_aberto_idx
  on public.treino_sessoes (user_id)
  where status = 'em_andamento';


create table public.series_registros (
  id               uuid primary key,        -- gerado no cliente (offline)
  treino_sessao_id uuid not null references public.treino_sessoes(id) on delete cascade,

  -- user_id DESNORMALIZADO de propósito. Duas razões:
  --   1. A sugestão de carga é "última carga DESTE exercício PRA MIM" —
  --      sem esta coluna a query vira join com treino_sessoes e o índice
  --      (exercicio_id, registrada_em) devolve dado de outra pessoa.
  --   2. Policy de RLS vira lookup indexado em vez de EXISTS aninhado.
  -- A coerência com treino_sessoes.user_id é garantida por trigger.
  user_id          uuid not null references public.profiles(id) on delete cascade,

  exercicio_id     int  not null references public.exercicios(id),  -- o que foi FEITO
  planejado_id     int  references public.exercicios(id),           -- o que estava no plano

  numero_serie     smallint not null check (numero_serie between 1 and 20),
  reps             smallint check (reps between 0 and 200),

  -- Unilateral: carga POR LADO (flag `unilateral` no catálogo).
  carga_kg         numeric(6,2) check (carga_kg >= 0),
  duracao_seg      smallint check (duracao_seg between 0 and 3600),

  completou        boolean not null default true,
  registrada_em    timestamptz not null default now(),

  unique (treino_sessao_id, exercicio_id, numero_serie)
);

comment on column public.series_registros.planejado_id is
  'Diferente de exercicio_id = substituição circunstancial. Alimenta o aviso "trocou 3 das últimas 4 vezes".';

-- O índice que serve a progressão de carga. Composto e na ordem certa:
-- igualdade (user_id, exercicio_id) primeiro, range/ordenação por último.
create index series_registros_progressao_idx
  on public.series_registros (user_id, exercicio_id, registrada_em desc);

create index series_registros_sessao_idx
  on public.series_registros (treino_sessao_id);
create index series_registros_planejado_idx
  on public.series_registros (planejado_id);

-- Parcial: só as substituições. É uma fração das linhas, e é o único
-- recorte que a regra de "tornar permanente?" consulta.
create index series_registros_substituicoes_idx
  on public.series_registros (user_id, planejado_id, registrada_em desc)
  where planejado_id is not null and planejado_id <> exercicio_id;


-- ---------------------------------------------------------------------
-- Garante que o user_id desnormalizado não diverge do dono da sessão.
-- Roda antes do insert: o cliente pode até mandar errado, o banco
-- corrige a partir da fonte da verdade.
-- ---------------------------------------------------------------------
create function private.serie_herda_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono uuid;
begin
  select ts.user_id into v_dono
  from public.treino_sessoes ts
  where ts.id = new.treino_sessao_id;

  if v_dono is null then
    raise exception 'treino_sessao_id % não existe', new.treino_sessao_id
      using errcode = 'foreign_key_violation';
  end if;

  new.user_id := v_dono;
  return new;
end;
$$;

create trigger trg_serie_herda_user_id
  before insert or update of treino_sessao_id on public.series_registros
  for each row execute function private.serie_herda_user_id();
