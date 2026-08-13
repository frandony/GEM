#!/usr/bin/env node
/* =====================================================================
   Gera os ícones do PWA em app/public/icones/.
   =====================================================================
   Por que um script e não três PNGs commitados: o ícone é derivado dos
   tokens de cor (tokens.css). Se a paleta mudar, regerar é um comando —
   contra abrir um editor de imagem e tentar acertar o hex de novo.

   Sem dependência: escreve o PNG na mão (zlib do próprio Node). Um ícone
   é uma forma geométrica em cor chapada; não vale arrastar canvas nativo
   para dentro do projeto por isso.

   A marca é o "+" de "Estudo + Treino", com degradê da cor de treino
   (ciano) para a de estudo (roxo). O nome do app já é a marca.

       node scripts/gerar-icones.mjs
   ===================================================================== */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "app", "public", "icones");

/* --- Tokens (espelham app/src/styles/tokens.css) -------------------- */
const FUNDO = [0x0a, 0x0c, 0x10]; // --bg
const TREINO = [0x00, 0xe5, 0xcc]; // --treino
const ESTUDO = [0x7c, 0x4d, 0xff]; // --estudo

/* --- PNG ------------------------------------------------------------ */

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** rgba: Uint8Array de lado*lado*4. */
function png(lado, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // 10..12 = compressão, filtro, entrelaçamento — todos 0.

  // Cada linha leva um byte de filtro na frente. Filtro 0 (nenhum):
  // a imagem é área chapada, então filtro melhor não paga o custo.
  const bruto = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    const origem = y * lado * 4;
    const destino = y * (lado * 4 + 1);
    bruto[destino] = 0;
    Buffer.from(rgba.buffer, origem, lado * 4).copy(bruto, destino + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(bruto, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- Desenho -------------------------------------------------------- */

/**
 * O "+" com cantos arredondados, como união de dois retângulos.
 * `p` vai de 0 a 1 nos dois eixos — desenhar em coordenada normalizada
 * deixa o mesmo código servir a qualquer tamanho.
 *
 * @param proporcao largura do braço do "+" em relação ao lado
 * @param extensao  comprimento do braço em relação ao lado
 */
function dentroDoMais(x, y, proporcao, extensao) {
  const meio = 0.5;
  const meiaLargura = proporcao / 2;
  const meioComprimento = extensao / 2;
  const raio = meiaLargura * 0.28;

  const naBarra = (dx, dy, mx, my) => {
    // Retângulo arredondado centrado: distância ao "miolo" reto.
    const px = Math.max(Math.abs(dx) - (mx - raio), 0);
    const py = Math.max(Math.abs(dy) - (my - raio), 0);
    return Math.hypot(px, py) <= raio;
  };

  const dx = x - meio;
  const dy = y - meio;
  return (
    naBarra(dx, dy, meioComprimento, meiaLargura) ||
    naBarra(dx, dy, meiaLargura, meioComprimento)
  );
}

/**
 * Supersampling 4×4: a forma é decidida em 16 pontos por pixel e a
 * cobertura vira alfa. Sem isto, a curva do canto vira escada visível já
 * em 192px.
 */
function desenhar(lado, extensao) {
  const rgba = new Uint8Array(lado * lado * 4);
  const AMOSTRAS = 4;
  const proporcao = extensao * 0.3;

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let cobertura = 0;
      for (let sy = 0; sy < AMOSTRAS; sy++) {
        for (let sx = 0; sx < AMOSTRAS; sx++) {
          const px = (x + (sx + 0.5) / AMOSTRAS) / lado;
          const py = (y + (sy + 0.5) / AMOSTRAS) / lado;
          if (dentroDoMais(px, py, proporcao, extensao)) cobertura++;
        }
      }
      cobertura /= AMOSTRAS * AMOSTRAS;

      // Degradê na diagonal: treino no topo-esquerda, estudo embaixo-direita.
      // Normalizado pela extensão da MARCA, não pelo quadro: medido no
      // quadro inteiro, os braços do "+" ficam todos perto do meio da
      // rampa, e o ciano e o roxo nunca aparecem — só o azul do meio.
      const inicio = 0.5 - extensao / 2;
      const t = Math.min(1, Math.max(0, ((x / lado + y / lado) / 2 - inicio) / extensao));
      const i = (y * lado + x) * 4;
      for (let c = 0; c < 3; c++) {
        const marca = TREINO[c] + (ESTUDO[c] - TREINO[c]) * t;
        // Composição sobre o fundo opaco: o ícone nunca é transparente,
        // porque maskable exige que a arte cubra o recorte inteiro.
        rgba[i + c] = Math.round(FUNDO[c] + (marca - FUNDO[c]) * cobertura);
      }
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/* --- Saída ---------------------------------------------------------- */

mkdirSync(DESTINO, { recursive: true });

const arquivos = [
  // `any`: a marca ocupa bastante do quadro, como todo ícone de app.
  { nome: "192.png", lado: 192, extensao: 0.62 },
  { nome: "512.png", lado: 512, extensao: 0.62 },
  // `maskable`: o Android recorta até 20% de cada borda. A marca fica
  // dentro da zona segura (círculo central de 80%), senão o "+" aparece
  // com os braços cortados nos aparelhos que usam recorte circular.
  { nome: "512-maskable.png", lado: 512, extensao: 0.44 },
  // Ícone da aba do navegador. 32px é o que o Chrome pede.
  { nome: "favicon.png", lado: 32, extensao: 0.66 },
];

for (const { nome, lado, extensao } of arquivos) {
  const buffer = png(lado, desenhar(lado, extensao));
  writeFileSync(join(DESTINO, nome), buffer);
  console.log(`✓ ${nome.padEnd(18)} ${lado}×${lado}  ${(buffer.length / 1024).toFixed(1)} kB`);
}

console.log(`\nGerados em app/public/icones/`);
