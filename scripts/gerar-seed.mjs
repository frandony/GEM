import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// scripts/ está um nível abaixo da raiz do projeto.
const BASE = fileURLToPath(new URL('..', import.meta.url));
const csv = readFileSync(`${BASE}/02_catalogo_exercicios.csv`, 'utf8');

const linhas = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
const cabecalho = linhas.shift().split(',');

const esperado = ['id','nome','grupo_primario','grupos_secundarios','padrao_movimento',
  'equipamento','incremento_kg','unilateral','medida','comum','nivel'];
if (cabecalho.join(',') !== esperado.join(',')) {
  throw new Error(`Cabecalho inesperado: ${cabecalho.join(',')}`);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Valores validos dos enums — o seed falha cedo se o CSV divergir.
const GRUPOS = new Set(['peito','costas','ombro','bíceps','tríceps','quadríceps',
  'posterior','glúteo','panturrilha','adutores','abdutores','abdômen','lombar']);
const PADROES = new Set(['empurrar horizontal','empurrar vertical','puxar horizontal',
  'puxar vertical','isolamento de peito','isolamento de costas','isolamento de ombro',
  'isolamento de braço','isolamento de antebraço','dominante de joelho',
  'dominante de quadril','unilateral','isolamento de perna','panturrilha',
  'flexão de tronco','antiextensão','rotação','extensão de tronco','carregamento']);
const EQUIPS = new Set(['barra','halter','máquina','polia','peso corporal','anilha','elástico']);
const MEDIDAS = new Set(['reps','tempo']);
const NIVEIS = new Set(['básico','intermediário','avançado']);

const erros = [];
const valores = [];
const stats = { porGrupo: {}, porPadrao: {}, porComum: {}, porNivel: {}, semIncremento: 0, unilaterais: 0 };

for (const [i, linha] of linhas.entries()) {
  const c = linha.split(',');
  if (c.length !== 11) { erros.push(`linha ${i + 2}: ${c.length} colunas`); continue; }

  const [id, nome, grupo, secundarios, padrao, equip, incr, uni, medida, comum, nivel] = c;

  if (!GRUPOS.has(grupo))   erros.push(`linha ${i + 2}: grupo_primario "${grupo}"`);
  if (!PADROES.has(padrao)) erros.push(`linha ${i + 2}: padrao_movimento "${padrao}"`);
  if (!EQUIPS.has(equip))   erros.push(`linha ${i + 2}: equipamento "${equip}"`);
  if (!MEDIDAS.has(medida)) erros.push(`linha ${i + 2}: medida "${medida}"`);
  if (!NIVEIS.has(nivel))   erros.push(`linha ${i + 2}: nivel "${nivel}"`);

  const sec = secundarios.trim() ? secundarios.split(';').map((s) => s.trim()) : [];
  for (const s of sec) if (!GRUPOS.has(s)) erros.push(`linha ${i + 2}: grupo_secundario "${s}"`);

  const arr = sec.length
    ? `array[${sec.map(q).join(',')}]::grupo_muscular[]`
    : `'{}'::grupo_muscular[]`;

  valores.push(
    `  (${id}, ${q(nome)}, ${q(grupo)}, ${arr}, ${q(padrao)}, ${q(equip)}, ` +
    `${incr.trim() ? incr : 'null'}, ${uni.toLowerCase() === 'true'}, ${q(medida)}, ${comum}, ${q(nivel)})`
  );

  stats.porGrupo[grupo]   = (stats.porGrupo[grupo] || 0) + 1;
  stats.porPadrao[padrao] = (stats.porPadrao[padrao] || 0) + 1;
  stats.porComum[comum]   = (stats.porComum[comum] || 0) + 1;
  stats.porNivel[nivel]   = (stats.porNivel[nivel] || 0) + 1;
  if (!incr.trim()) stats.semIncremento++;
  if (uni.toLowerCase() === 'true') stats.unilaterais++;
}

if (erros.length) {
  console.error('ERROS:\n' + erros.join('\n'));
  process.exit(1);
}

const sql = `-- =====================================================================
-- SEED — catálogo de exercícios
-- =====================================================================
-- Gerado a partir de 02_catalogo_exercicios.csv (${valores.length} exercícios).
-- NÃO editar à mão: reexecutar \`npm run seed:gerar\` depois de mudar o CSV.
--
-- Idempotente: \`on conflict (id) do update\` permite reaplicar o seed
-- sobre um banco já populado sem quebrar as FKs de sessao_exercicios.
-- =====================================================================

insert into public.exercicios
  (id, nome, grupo_primario, grupos_secundarios, padrao_movimento,
   equipamento, incremento_kg, unilateral, medida, comum, nivel)
values
${valores.join(',\n')}
on conflict (id) do update set
  nome               = excluded.nome,
  grupo_primario     = excluded.grupo_primario,
  grupos_secundarios = excluded.grupos_secundarios,
  padrao_movimento   = excluded.padrao_movimento,
  equipamento        = excluded.equipamento,
  incremento_kg      = excluded.incremento_kg,
  unilateral         = excluded.unilateral,
  medida             = excluded.medida,
  comum              = excluded.comum,
  nivel              = excluded.nivel;

-- O catálogo usa id serial, mas o seed traz ids explícitos. Sem isto o
-- próximo insert sem id colide na primary key.
select setval(
  pg_get_serial_sequence('public.exercicios', 'id'),
  (select max(id) from public.exercicios)
);
`;

writeFileSync(`${BASE}/supabase/seed.sql`, sql, 'utf8');

console.log(`OK: ${valores.length} exercicios -> supabase/seed.sql`);
console.log(`unilaterais: ${stats.unilaterais} | sem incremento_kg: ${stats.semIncremento}`);
console.log('\npadroes com poucos exercicios (risco de fallback vazio):');
for (const [p, n] of Object.entries(stats.porPadrao).sort((a, b) => a[1] - b[1])) {
  if (n <= 4) console.log(`  ${n.toString().padStart(2)}  ${p}`);
}
console.log('\ncomum:', JSON.stringify(stats.porComum));
console.log('nivel:', JSON.stringify(stats.porNivel));
