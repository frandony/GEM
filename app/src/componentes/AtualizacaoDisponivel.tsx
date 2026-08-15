import { useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

/* =====================================================================
   Barra "Nova versão disponível".
   =====================================================================
   `vite.config.ts` usa `registerType: "prompt"` desde sempre, com o
   comentário "a pessoa decide quando atualizar" — mas a metade que
   PERGUNTA nunca existiu. O efeito prático era o oposto do pretendido:
   com `prompt`, o plugin deixa `skipWaiting` e `clientsClaim` em false,
   então o service worker novo instala e fica em `waiting` até TODOS os
   clientes antigos fecharem. Em PWA standalone no iPhone isso significa
   deslizar o app para fora do multitarefa — gesto que ninguém faz de
   propósito. Na prática: versão nova não chegava.

   O `sw.js` gerado JÁ escuta `postMessage({type:'SKIP_WAITING'})`.
   Faltava só este lado.

   Dois detalhes que não são estilo, são o que faz funcionar:

   1. **Import estático, sempre.** Assim que `virtual:pwa-register` entra
      no grafo de módulos, o plugin para de injetar o `registerSW.js`
      automático (`injectRegister: "auto"` → `false`). É o que evita
      registro duplicado — e também significa que, se este componente
      virar import condicional/lazy, o service worker deixa de ser
      registrado por completo.

   2. **`registro.update()` ao voltar para o primeiro plano.** O
      navegador só rebusca o `sw.js` em navegação de documento, e um PWA
      standalone praticamente nunca navega: quem abre o app todo dia
      podia passar semanas sem o navegador sequer checar se há versão
      nova. A trava de 1h evita bater no servidor a cada alt-tab.
   ===================================================================== */

const INTERVALO_CHECAGEM_MS = 60 * 60 * 1000;

export function AtualizacaoDisponivel() {
  const ultimaChecagem = useRef(0);

  const {
    needRefresh: [precisaAtualizar, setPrecisaAtualizar],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (!registro) return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const agora = Date.now();
        if (agora - ultimaChecagem.current < INTERVALO_CHECAGEM_MS) return;
        ultimaChecagem.current = agora;
        void registro.update();
      });
    },
  });

  // `offlineReady` existe e é deliberadamente ignorado: interromper a
  // pessoa para avisar "pronto para uso offline" é notificação sobre o
  // app, não sobre o que ela veio fazer.
  if (!precisaAtualizar) return null;

  return (
    <div className="barra-atualizacao" role="status">
      <RefreshCw size={18} className="text-treino-ink shrink-0" aria-hidden />
      <span className="text-sm flex-1">Nova versão disponível</span>
      <button className="btn btn-neutro" onClick={() => setPrecisaAtualizar(false)}>
        Agora não
      </button>
      <button className="btn btn-treino" onClick={() => void updateServiceWorker(true)}>
        Atualizar
      </button>
    </div>
  );
}
