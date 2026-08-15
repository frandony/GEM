-- Tópicos ganham `ativo`, espelhando `materias.ativa` — mesmo motivo.
--
-- Excluir um tópico individual de verdade (DELETE) esbarraria na mesma
-- armadilha já documentada para matérias: `blocos.topico_id` é
-- `on delete set null`, e `ck_bloco_tem_alvo check (topico_id is not
-- null or evento_id is not null)` é CHECK imediato — um bloco comum
-- (leitura/exercícios, sem evento_id) violaria essa regra assim que o
-- SET NULL rodasse, abortando a transação inteira. Arquivar em vez de
-- apagar evita a FK por completo.
alter table public.topicos
  add column ativo boolean not null default true;
