-- Pergunta nova no onboarding: intensidade desejada do treino. Reaproveita
-- o enum nivel_perfil ('baixo','moderado','alto') já criado na migration
-- 20 (usado hoje só por "estresse") — mesmo vocabulário, zero tipo novo.
-- NOT NULL com default: diferente de estresse (opcional), intensidade
-- sempre tem valor porque o prompt do montar-treino depende dela.
alter table public.perfil_treino
  add column intensidade nivel_perfil not null default 'moderado';
