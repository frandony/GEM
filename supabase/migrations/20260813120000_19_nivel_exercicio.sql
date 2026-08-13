-- =====================================================================
-- 19 — Nível de dificuldade do exercício
-- =====================================================================
-- `comum` (migration 04) é raridade/prioridade de escolha, não
-- dificuldade — um iniciante podia receber Levantamento terra do mesmo
-- jeito que um avançado. `nivel` filtra o catálogo pelo nível efetivo do
-- aluno ANTES do prompt (mesma filosofia de equipamentos_indisponiveis em
-- supabase/functions/_shared/catalogo.ts): o que não está no catálogo
-- filtrado não pode ser escolhido, sem depender da IA respeitar a regra.
-- =====================================================================

create type nivel_exercicio as enum ('básico','intermediário','avançado');

alter table public.exercicios
  add column nivel nivel_exercicio not null default 'básico';

comment on column public.exercicios.nivel is
  'Dificuldade técnica do exercício. Filtra o catálogo pelo nível efetivo do aluno antes do prompt — mesma filosofia de equipamentos_indisponiveis.';
