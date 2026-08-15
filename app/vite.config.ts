import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      // `prompt` e não `autoUpdate`: trocar o app por baixo no meio de um
      // treino perde o estado da tela. A pessoa decide quando atualizar —
      // quem pergunta é `componentes/AtualizacaoDisponivel.tsx`.
      //
      // Esta opção só funciona EM PAR com aquele componente. Sozinha, ela
      // deixa o service worker novo parado em `waiting` para sempre (foi o
      // que aconteceu por meses). E não é preciso setar `injectRegister`:
      // o import de `virtual:pwa-register/react` lá desliga sozinho a
      // injeção do `registerSW.js` automático, então não há registro
      // duplicado.
      // `fontes/*.woff2` saiu daqui: o redesign de 2026-08 trocou as três
      // famílias (IBM Plex Sans/Mono, Instrument Serif) por `system-ui`, e
      // desde então NENHUM @font-face referencia esses arquivos —
      // verificado no CSS compilado. Eram ~65 KB baixados no install do
      // PWA para nunca serem usados. Os arquivos seguem em public/fontes/
      // (não custam nada parados); apagar é decisão à parte.
      includeAssets: ["icones/*.png"],
      manifest: {
        name: "Estudo + Treino",
        short_name: "Treino",
        description: "Treino e estudo, no mesmo lugar",
        lang: "pt-BR",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0c10",
        theme_color: "#0a0c10",
        orientation: "portrait",
        icons: [
          { src: "/icones/192.png", sizes: "192x192", type: "image/png" },
          { src: "/icones/512.png", sizes: "512x512", type: "image/png" },
          { src: "/icones/512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        // pdf.js (core + worker) só é importado sob demanda em "Nova
        // matéria → Importar PDF" — a maioria nunca abre essa tela. Sem
        // isto, o chunk de ~330 KB entrava no precache do app inteiro
        // (quase metade do precache total) só para instalar o PWA.
        // Continua sendo baixado normalmente na hora do uso, só não é
        // puxado de propósito no install.
        // O `globPatterns` acima também varre woff2 — sem esta linha, as
        // fontes órfãs voltariam ao precache pela porta dos fundos.
        // tesseract.js (OCR de foto) segue o mesmo raciocínio do pdf.js
        // logo abaixo: import dinâmico, só carrega quem realmente tira
        // foto, não faz sentido no precache de quem nunca vai usar.
        globIgnores: [
          "**/pdf-*.js",
          "**/pdf.worker*",
          "**/fontes/*.woff2",
          "**/tesseract*",
          "**/worker-script*",
        ],
        // O catálogo de exercícios é global e quase imutável — vale cache
        // longo. Já as chamadas de dado do usuário nunca são cacheadas:
        // servir treino velho é pior que não servir.
        runtimeCaching: [
          {
            urlPattern: /\/rest\/v1\/exercicios/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "catalogo",
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
