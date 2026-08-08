-- =====================================================================
-- 02 — Enums de domínio
-- =====================================================================
-- Valores com acento são intencionais: batem 1:1 com
-- 02_catalogo_exercicios.csv e com o texto que vai nos prompts de IA.
-- Mudar aqui exige mudar o seed, os prompts e a validação junto.
-- =====================================================================

create type grupo_muscular as enum (
  'peito','costas','ombro','bíceps','tríceps',
  'quadríceps','posterior','glúteo','panturrilha','adutores','abdutores',
  'abdômen','lombar'
);

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
create type enfase_treino    as enum ('superior','inferior','equilibrado');
create type divisao_treino   as enum ('AB','ABC','ABCD','ABCDE');

create type status_sessao    as enum ('em_andamento','concluida','abandonada');
create type tipo_bloco       as enum ('leitura','exercicios','revisao','marco');
create type status_bloco     as enum ('pendente','concluido','parcial','pulado');
create type tipo_evento      as enum ('prova','entrega');
create type dificuldade      as enum ('facil','medio','dificil');
create type status_notif     as enum ('pendente','enviada','cancelada','expirada','falhou');

-- Motivos da revisão semanal. Opções FIXAS de propósito: texto livre puro
-- vira 6 meses de frase solta pra IA interpretar; enum vira série temporal.
create type motivo_atrapalho as enum (
  'tempo','cansaço','prova','desânimo','imprevisto','lesão'
);

-- Origem dos tópicos de uma matéria — muda o aviso de confiança na tela.
create type origem_topicos   as enum ('pdf','manual','ia_nome_materia');
create type confianca_extracao as enum ('alta','media','baixa');
