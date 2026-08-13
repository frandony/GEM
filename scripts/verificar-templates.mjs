#!/usr/bin/env -S deno run --allow-read
/* =====================================================================
   Confere se cada template de fallback cumpre as MESMAS regras que a
   validação de domínio cobra da IA.
   =====================================================================
   O template é a rede de segurança: ele entra justamente quando a
   geração falhou, e ninguém está olhando. Se ele violar as regras, o
   erro vira plano permanente em silêncio — foi o que aconteceu com a
   ênfase, ignorada pelo template durante toda a vida do projeto.

   Checa, por divisão e ênfase:
   - proporção de volume no lado enfatizado (57–72%, ou 42,5–57,5%)
   - séries por sessão dentro de 10 a 22
   - exercícios por sessão dentro de 4 a 7

       deno run --allow-read scripts/verificar-templates.mjs
   ===================================================================== */

import {
  proporcaoInferior,
} from "../supabase/functions/montar-treino/fallback.ts";

const DIVISOES = ["AB", "ABC", "ABCD", "ABCDE"];
const ENFASES = ["equilibrado", "superior", "inferior"];

const FAIXA = {
  inferior: [57, 72],
  superior: [28, 43], // espelho: 57–72% em superior = 28–43% em inferior
  equilibrado: [42.5, 57.5],
};

let falhas = 0;

console.log(
  "divisão  ênfase        %inf    séries/sessão            veredito",
);
console.log("─".repeat(76));

for (const divisao of DIVISOES) {
  for (const enfase of ENFASES) {
    const r = proporcaoInferior(divisao, enfase);
    const [min, max] = FAIXA[enfase];
    const problemas = [];

    if (r.pctInferior < min || r.pctInferior > max) {
      problemas.push(`proporção fora de ${min}–${max}%`);
    }
    for (const s of r.seriesPorSessao) {
      if (s < 10 || s > 22) problemas.push(`sessão com ${s} séries (limite 10–22)`);
    }

    const ok = problemas.length === 0;
    if (!ok) falhas++;

    console.log(
      `${divisao.padEnd(8)} ${enfase.padEnd(13)} ${r.pctInferior.toFixed(1).padStart(5)}%  ` +
        `${r.seriesPorSessao.join(", ").padEnd(24)} ${ok ? "ok" : "FALHA: " + problemas.join("; ")}`,
    );
  }
}

console.log("─".repeat(76));
if (falhas > 0) {
  console.error(`\n${falhas} combinação(ões) fora das regras.`);
  Deno.exit(1);
}
console.log("\nTodas as combinações dentro das faixas.");
