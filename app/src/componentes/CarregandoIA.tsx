import type { CSSProperties } from "react";

/**
 * Mascote pixel-art pra tela de espera de IA — sprite de 2 poses (barra
 * na altura do ombro / barra acima da cabeça) que troca em `steps(1)`,
 * sem crossfade, pra manter a cara de sprite de jogo em vez de ícone
 * animado suave. `prefers-reduced-motion` já desliga isso globalmente
 * (ver index.css @layer base) — não precisa de regra própria aqui.
 */
export function LevantadorPixel({ cor = "var(--treino)" }: { cor?: string }) {
  return (
    <svg
      className="pixel-levantador"
      viewBox="0 0 16 18"
      shapeRendering="crispEdges"
      style={{ color: cor } as CSSProperties}
      aria-hidden="true"
    >
      {/* cabeça, tronco e pernas — igual nas duas poses */}
      <g fill="currentColor">
        <rect x="7" y="4" width="2" height="2" />
        <rect x="6" y="6" width="4" height="4" />
        <rect x="6" y="10" width="4" height="1" />
        <rect x="6" y="11" width="2" height="6" />
        <rect x="8" y="11" width="2" height="6" />
      </g>
      {/* pose 1: barra na altura do ombro */}
      <g className="pixel-levantador__baixo" fill="currentColor">
        <rect x="4" y="6" width="2" height="2" />
        <rect x="10" y="6" width="2" height="2" />
        <rect x="3" y="6" width="10" height="1" />
        <rect x="2" y="5" width="1" height="3" />
        <rect x="13" y="5" width="1" height="3" />
      </g>
      {/* pose 2: barra pressionada acima da cabeça */}
      <g className="pixel-levantador__cima" fill="currentColor">
        <rect x="4" y="2" width="2" height="4" />
        <rect x="10" y="2" width="2" height="4" />
        <rect x="3" y="2" width="10" height="1" />
        <rect x="2" y="1" width="1" height="3" />
        <rect x="13" y="1" width="1" height="3" />
      </g>
    </svg>
  );
}
