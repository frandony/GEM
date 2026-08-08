-- =====================================================================
-- 16 — Índice de cobertura da FK series_registros.exercicio_id
-- =====================================================================
-- Achado por `supabase db advisors` depois do primeiro push.
--
-- Eu tinha assumido que series_registros_progressao_idx
-- (user_id, exercicio_id, registrada_em desc) cobria esta FK. Não cobre:
-- índice composto só serve a busca que começa pela PRIMEIRA coluna, e a
-- checagem de FK busca por exercicio_id sozinho.
--
-- Impacto prático é baixo — exercício de catálogo quase nunca é apagado —
-- mas um delete no catálogo faria seq scan na tabela mais quente do app.
-- =====================================================================

create index series_registros_exercicio_idx
  on public.series_registros (exercicio_id);
